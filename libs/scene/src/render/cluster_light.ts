import type { Nullable, Vector3 } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';
import { MAX_GLOBAL_LIGHTS, MAX_SHADOW_MASK_LIGHTS } from '../values';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  RenderStateSet,
  StructuredBuffer,
  Texture2D,
  VertexLayout
} from '@zephyr3d/device';
import { PBArrayTypeInfo, PBPrimitiveType, PBPrimitiveTypeInfo, PBStructTypeInfo } from '@zephyr3d/device';
import type { Camera } from '../camera/camera';
import type { RenderQueue } from './render_queue';
import type { PunctualLight } from '../scene/light';
import { ShaderHelper } from '../material/shader/helper';
import { getDevice } from '../app/api';

/** Name of the index pass's per-light view-space bounding spheres. */
const UNIFORM_NAME_LIGHT_SPHERES = 'lightSpheres';
/**
 * vec4s per light in the index pass's sphere buffer: the bounding sphere, then (except
 * on WebGL1, which keeps the first 8 lights of a cluster rather than the strongest) the
 * light's brightness in x.
 */
function getSphereStride() {
  return getDevice().type === 'webgl' ? 1 : 2;
}
/** Target size in pixels of a cluster tile on screen. */
const TILE_SIZE_PX = 64;
/** Bound on the tile count along each screen axis, which caps the index pass cost at high resolution. */
const MAX_TILES_PER_AXIS = 64;
/** Number of depth slices. */
const TILE_COUNT_Z = 32;
/**
 * View depth in meters where the exponential slices of a perspective camera begin.
 * Everything nearer shares slice 0: exponential slicing would otherwise spend a quarter
 * of the slices on the first meter in front of a 0.1 m near plane, where little is lit.
 */
const NEAR_SLICE_METERS = 1;
/** Clusters per workgroup of the WebGPU index pass, and lights per shared batch. */
const INDEX_GROUP_SIZE = 64;
/**
 * Average list length per cluster the WebGPU light list starts out sized for, once there
 * are more lights than this (with fewer, every cluster fits all of them). It then grows
 * to what the clusters asked for, read back from the GPU.
 */
const LIST_LIGHTS_PER_CLUSTER = 64;
/** Bound on the entries of the WebGPU light list: 64 MB. */
const MAX_LIST_ENTRIES = 1 << 24;
/**
 * Buckets of the per-cluster histogram of light scores that picks which lights a
 * cluster keeps when its list is cut. Each spans a factor of 4 in score.
 */
const SCORE_BUCKETS = 32;

/**
 * Declares the uniforms and helper functions shared by the index pass programs.
 */
function declareIndexPassScope(
  pb: ProgramBuilder,
  scope: PBGlobalScope,
  sphereStride: number,
  storage: boolean
) {
  (function (this: PBGlobalScope) {
    this.invProjMatrix = pb.mat4().uniform(0);
    this.sizeParam = pb.vec4().uniform(0);
    this.countParam = pb.ivec4().uniform(0);
    this.orthoProj = pb.int().uniform(0);
    this.sliceParam = pb.vec4().uniform(0);
    // Already in view space: transformed once per light on the CPU rather than once
    // per light in each of the clusters. See writeLight for the layout.
    this[UNIFORM_NAME_LIGHT_SPHERES] = storage
      ? pb.vec4[0]().storageBufferReadonly(0)
      : pb.vec4[(ShaderHelper.getMaxClusterLights() + 1) * sphereStride]().uniformBuffer(0);
    pb.func('lineIntersectionToZPlane', [pb.vec3('a'), pb.vec3('b'), pb.float('zDistance')], function () {
      this.$l.normal = pb.vec3(0, 0, 1);
      this.$l.ab = pb.sub(this.b, this.a);
      this.$l.t = pb.div(pb.sub(this.zDistance, pb.dot(this.normal, this.a)), pb.dot(this.normal, this.ab));
      this.$return(pb.add(this.a, pb.mul(this.t, this.ab)));
    });
    // View depth where perspective slice k begins: slices before the first exponential
    // one form the near slice, which begins at the near plane.
    pb.func('sliceDepth', [pb.float('k')], function () {
      this.$if(pb.lessThan(this.k, this.sliceParam.y), function () {
        this.$return(this.sizeParam.z);
      });
      this.$return(
        pb.mul(
          this.sliceParam.x,
          pb.pow(
            pb.div(this.sizeParam.w, this.sliceParam.x),
            pb.div(pb.sub(this.k, this.sliceParam.y), this.sliceParam.z)
          )
        )
      );
    });
    pb.func('clipToView', [pb.vec4('clip')], function () {
      this.$l.view = pb.mul(this.invProjMatrix, this.clip);
      this.$return(pb.div(this.view, this.view.w));
    });
    pb.func('screenToView', [pb.vec4('screen')], function () {
      this.$l.texCoord = pb.div(this.screen.xy, this.sizeParam.xy);
      this.$l.clip = pb.vec4(
        pb.sub(pb.mul(pb.vec2(this.texCoord.x, pb.sub(1, this.texCoord.y)), 2), pb.vec2(1)),
        this.screen.z,
        this.screen.w
      );
      this.$return(this.clipToView(this.clip));
    });
    // Squared distance from a point to the box, zero inside it.
    pb.func('aabbDistSq', [pb.vec3('p'), pb.vec3('aabbMin'), pb.vec3('aabbMax')], function () {
      this.$l.d = pb.max(pb.max(pb.sub(this.aabbMin, this.p), pb.sub(this.p, this.aabbMax)), pb.vec3(0));
      this.$return(pb.dot(this.d, this.d));
    });
    // Radius 0 marks an unbounded light that no global slot took: it reaches every cluster.
    pb.func('sphereReachesAABB', [pb.vec4('sphere'), pb.float('distSq')], function () {
      this.$return(
        pb.or(pb.equal(this.sphere.w, 0), pb.lessThanEqual(this.distSq, pb.mul(this.sphere.w, this.sphere.w)))
      );
    });
    // Whether the sphere lies entirely outside one of the tile frustum's side planes
    // (inward unit normals through the eye). The box of a far slice is much wider than
    // the frustum it bounds, and this rejects the lights reaching only its corners.
    pb.func(
      'sphereOutsideTile',
      [pb.vec4('sphere'), pb.vec3('left'), pb.vec3('right'), pb.vec3('bottom'), pb.vec3('top')],
      function () {
        this.$l.r = pb.neg(this.sphere.w);
        this.$return(
          pb.and(
            pb.greaterThan(this.sphere.w, 0),
            pb.or(
              pb.or(
                pb.lessThan(pb.dot(this.left, this.sphere.xyz), this.r),
                pb.lessThan(pb.dot(this.right, this.sphere.xyz), this.r)
              ),
              pb.or(
                pb.lessThan(pb.dot(this.bottom, this.sphere.xyz), this.r),
                pb.lessThan(pb.dot(this.top, this.sphere.xyz), this.r)
              )
            )
          )
        );
      }
    );
  }).call(scope);
}

/**
 * Emits the view-space bounds of cluster `tileIndex` (an int): locals `aabbMin`/`aabbMax`
 * and the inward side-plane normals `planeLeft`/`planeRight`/`planeBottom`/`planeTop`.
 */
function emitClusterBounds(this: PBInsideFunctionScope, pb: ProgramBuilder, tileIndex: PBShaderExp) {
  this.$l.tileIndex = tileIndex;
  this.$l.tileSize = pb.div(this.sizeParam.xy, pb.vec2(this.countParam.xy));
  this.$l.zIndex = pb.div(this.tileIndex, pb.mul(this.countParam.x, this.countParam.y));
  this.$l.yIndex = pb.div(
    pb.sub(this.tileIndex, pb.mul(this.zIndex, this.countParam.x, this.countParam.y)),
    this.countParam.x
  );
  this.$l.xIndex = pb.sub(
    this.tileIndex,
    pb.add(pb.mul(this.zIndex, this.countParam.x, this.countParam.y), pb.mul(this.yIndex, this.countParam.x))
  );
  this.$l.maxPoint_sS = pb.vec4(
    pb.mul(pb.vec2(pb.float(pb.add(this.xIndex, 1)), pb.float(pb.add(this.yIndex, 1))), this.tileSize),
    0.0,
    1.0
  );
  this.$l.minPoint_sS = pb.vec4(
    pb.mul(pb.vec2(pb.float(this.xIndex), pb.float(this.yIndex)), this.tileSize),
    0.0,
    1.0
  );
  this.$l.maxPoint_vS = this.screenToView(this.maxPoint_sS).xyz;
  this.$l.minPoint_vS = this.screenToView(this.minPoint_sS).xyz;
  this.$l.sliceNear = pb.div(pb.float(this.zIndex), pb.float(this.countParam.z));
  this.$l.sliceFar = pb.div(pb.add(pb.float(this.zIndex), 1), pb.float(this.countParam.z));
  this.$l.aabbMin = pb.vec3();
  this.$l.aabbMax = pb.vec3();
  // Zero normals never reject: an orthographic tile is exactly its box.
  this.$l.planeLeft = pb.vec3(0);
  this.$l.planeRight = pb.vec3(0);
  this.$l.planeBottom = pb.vec3(0);
  this.$l.planeTop = pb.vec3(0);
  this.$if(pb.notEqual(this.orthoProj, 0), function () {
    // Orthographic: view rays are parallel, so a tile's view-space x/y extent does not
    // depend on depth, and slices are linear because near may be zero or negative.
    this.$l.tileNear = pb.neg(pb.mix(this.sizeParam.z, this.sizeParam.w, this.sliceNear));
    this.$l.tileFar = pb.neg(pb.mix(this.sizeParam.z, this.sizeParam.w, this.sliceFar));
    this.aabbMin = pb.vec3(pb.min(this.minPoint_vS.xy, this.maxPoint_vS.xy), this.tileFar);
    this.aabbMax = pb.vec3(pb.max(this.minPoint_vS.xy, this.maxPoint_vS.xy), this.tileNear);
  }).$else(function () {
    this.$l.tileNear = pb.neg(this.sliceDepth(pb.float(this.zIndex)));
    this.$l.tileFar = pb.neg(this.sliceDepth(pb.add(pb.float(this.zIndex), 1)));
    this.$l.eyePos = pb.vec3(0);
    this.$l.minPointNear = this.lineIntersectionToZPlane(this.eyePos, this.minPoint_vS, this.tileNear);
    this.$l.minPointFar = this.lineIntersectionToZPlane(this.eyePos, this.minPoint_vS, this.tileFar);
    this.$l.maxPointNear = this.lineIntersectionToZPlane(this.eyePos, this.maxPoint_vS, this.tileNear);
    this.$l.maxPointFar = this.lineIntersectionToZPlane(this.eyePos, this.maxPoint_vS, this.tileFar);
    this.aabbMin = pb.min(
      pb.min(this.minPointNear, this.minPointFar),
      pb.min(this.maxPointNear, this.maxPointFar)
    );
    this.aabbMax = pb.max(
      pb.max(this.minPointNear, this.minPointFar),
      pb.max(this.maxPointNear, this.maxPointFar)
    );
    // Side planes through the eye and the tile edges at z = tileNear (< 0), with
    // normals facing into the tile.
    this.$l.lo = pb.min(this.minPointNear.xy, this.maxPointNear.xy);
    this.$l.hi = pb.max(this.minPointNear.xy, this.maxPointNear.xy);
    this.planeLeft = pb.normalize(pb.vec3(pb.neg(this.tileNear), 0, this.lo.x));
    this.planeRight = pb.normalize(pb.vec3(this.tileNear, 0, pb.neg(this.hi.x)));
    this.planeBottom = pb.normalize(pb.vec3(0, pb.neg(this.tileNear), this.lo.y));
    this.planeTop = pb.normalize(pb.vec3(0, this.tileNear, pb.neg(this.hi.y)));
  });
}

/**
 * Emits the state of a cluster keeping its 16 strongest lights. Needs the bounds from
 * emitClusterBounds.
 */
function emitSelectionInit(this: PBInsideFunctionScope, pb: ProgramBuilder) {
  this.$l.n = pb.int(0);
  this.$l.lightIndex = [
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0),
    pb.uint(0)
  ];
  this.$l.lightScore = [
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0),
    pb.float(0)
  ];
  // Once all slots are taken, the weakest one is replaced by any light scoring
  // higher, so a crowded cluster keeps the lights that matter most to it rather
  // than whichever happen to come first in the buffer.
  this.$l.minSlot = pb.int(0);
  this.$l.minScore = pb.float(0);
  emitScoreSetup.call(this, pb);
}

/** Emits the locals emitLightScore needs. Needs the bounds from emitClusterBounds. */
function emitScoreSetup(this: PBInsideFunctionScope, pb: ProgramBuilder) {
  // Half the cluster diagonal: the irradiance estimate is taken at the cluster
  // center but not closer than this, so a light inside the cluster stays finite.
  this.$l.halfDiagSq = pb.mul(
    pb.dot(pb.sub(this.aabbMax, this.aabbMin), pb.sub(this.aabbMax, this.aabbMin)),
    0.25
  );
  this.$l.center = pb.mul(pb.add(this.aabbMin, this.aabbMax), 0.5);
}

/**
 * Emits the local `score` of the light in `lightPos`, which emitLightReaches found to
 * reach the cluster: its brightness times the lit shader's range window at the nearest
 * point of the cluster, over the squared distance to the cluster center. Unbounded
 * lights score highest.
 */
function emitLightScore(this: PBInsideFunctionScope, pb: ProgramBuilder, brightness: PBShaderExp) {
  this.$l.score = pb.float(3.0e38);
  this.$if(pb.greaterThan(this.lightPos.w, 0), function () {
    this.$l.f = pb.clamp(pb.sub(1, pb.div(this.distSq, pb.mul(this.lightPos.w, this.lightPos.w))), 0, 1);
    this.$l.toCenter = pb.sub(this.center, this.lightPos.xyz);
    this.score = pb.div(
      pb.mul(brightness, this.f, this.f),
      pb.max(pb.dot(this.toCenter, this.toCenter), pb.max(this.halfDiagSq, 1e-6))
    );
  });
}

/**
 * Emits the test of the light at buffer index `index` (a uint) with view-space bounding
 * sphere `sphere` and brightness `brightness` against the cluster, keeping it when it
 * reaches the cluster and is among its 16 strongest. Must be emitted inside a loop over
 * the lights: rejecting a light continues it.
 */
/**
 * Emits whether the light whose view-space bounding sphere is in the local `lightPos`
 * reaches the cluster, declaring the local `distSq` (its squared distance to the box).
 * Needs the bounds from emitClusterBounds.
 */
function emitLightReaches(this: PBInsideFunctionScope, pb: ProgramBuilder): PBShaderExp {
  this.$l.distSq = this.aabbDistSq(this.lightPos.xyz, this.aabbMin, this.aabbMax);
  // Negative radius: shaded through a global slot, never through the clusters.
  return pb.and(
    pb.greaterThanEqual(this.lightPos.w, 0),
    pb.and(
      this.sphereReachesAABB(this.lightPos, this.distSq),
      pb.not(
        this.sphereOutsideTile(
          this.lightPos,
          this.planeLeft,
          this.planeRight,
          this.planeBottom,
          this.planeTop
        )
      )
    )
  );
}

function emitConsiderLight(
  this: PBInsideFunctionScope,
  pb: ProgramBuilder,
  index: PBShaderExp,
  sphere: PBShaderExp,
  brightness: PBShaderExp
) {
  this.$l.lightPos = sphere;
  this.$if(emitLightReaches.call(this, pb), function () {
    emitLightScore.call(this, pb, brightness);
    this.$if(pb.lessThan(this.n, 16), function () {
      this.lightIndex.setAt(this.n, index);
      this.lightScore.setAt(this.n, this.score);
      this.n = pb.add(this.n, 1);
    })
      .$elseif(pb.greaterThan(this.score, this.minScore), function () {
        this.lightIndex.setAt(this.minSlot, index);
        this.lightScore.setAt(this.minSlot, this.score);
      })
      .$else(function () {
        this.$continue();
      });
    this.$if(pb.equal(this.n, 16), function () {
      this.minSlot = 0;
      this.minScore = this.lightScore[0];
      this.$for(pb.int('k'), 1, 16, function () {
        this.$if(pb.lessThan(this.lightScore.at(this.k), this.minScore), function () {
          this.minSlot = this.k;
          this.minScore = this.lightScore.at(this.k);
        });
      });
    });
  });
}

/** Emits the packing of the selected light indices, one byte each, front to back. */
function emitPackSelection(this: PBInsideFunctionScope, pb: ProgramBuilder): PBShaderExp {
  this.$l.r = pb.add(
    pb.sal(this.lightIndex[0], 24),
    pb.sal(this.lightIndex[1], 16),
    pb.sal(this.lightIndex[2], 8),
    this.lightIndex[3]
  );
  this.$l.g = pb.add(
    pb.sal(this.lightIndex[4], 24),
    pb.sal(this.lightIndex[5], 16),
    pb.sal(this.lightIndex[6], 8),
    this.lightIndex[7]
  );
  this.$l.b = pb.add(
    pb.sal(this.lightIndex[8], 24),
    pb.sal(this.lightIndex[9], 16),
    pb.sal(this.lightIndex[10], 8),
    this.lightIndex[11]
  );
  this.$l.a = pb.add(
    pb.sal(this.lightIndex[12], 24),
    pb.sal(this.lightIndex[13], 16),
    pb.sal(this.lightIndex[14], 8),
    this.lightIndex[15]
  );
  return pb.uvec4(this.r, this.g, this.b, this.a);
}

/**
 * The strength a light is ranked by: its peak color channel times its intensity, times
 * the area for rect lights, whose intensity is per unit area.
 */
function lightBrightness(light: PunctualLight) {
  const c = light.diffuseAndIntensity;
  const brightness = Math.max(c.x, c.y, c.z) * c.w;
  return light.isRectLight() ? brightness * light.width * light.height : brightness;
}

/**
 * Writes the world-space sphere bounding the region `light` lights into `out` (center,
 * radius). The range sphere, except for spot lights: the smallest sphere around the cone
 * sector they light (the cone clipped by the range sphere), which for a half-angle up to
 * 45 degrees passes through the apex and the rim, and beyond that is centered on the
 * rim's plane. Radius <= 0 for unbounded lights.
 */
function getLightBounds(light: PunctualLight, out: Float32Array) {
  const posRange = light.positionAndRange;
  out[0] = posRange.x;
  out[1] = posRange.y;
  out[2] = posRange.z;
  out[3] = posRange.w;
  if (posRange.w > 0 && light.isSpotLight()) {
    const dirCutoff = light.directionAndCutoff;
    const cosAngle = Math.min(dirCutoff.w, 1);
    if (cosAngle > 0) {
      const len = Math.hypot(dirCutoff.x, dirCutoff.y, dirCutoff.z) || 1;
      let dist: number;
      if (cosAngle >= Math.SQRT1_2) {
        dist = posRange.w / (2 * cosAngle);
        out[3] = dist;
      } else {
        dist = posRange.w * cosAngle;
        out[3] = posRange.w * Math.sqrt(1 - cosAngle * cosAngle);
      }
      out[0] += (dirCutoff.x / len) * dist;
      out[1] += (dirCutoff.y / len) * dist;
      out[2] += (dirCutoff.z / len) * dist;
    }
  }
}
const _bounds = new Float32Array(4);

export class ClusteredLight {
  /** Emit the shadow-mask overflow warning only once per session. */
  private static _warnedShadowMaskOverflow = false;
  /** Instances returned by {@link ClusteredLight.release}, reused to keep their GPU resources. */
  private static readonly _pool: ClusteredLight[] = [];
  /**
   * Fetches an instance from the pool, creating one if it is empty.
   *
   * @param width - Width in device pixels of the target it will be built for.
   * @param height - Height in device pixels of that target.
   *
   * @remarks
   * The GPU work reading an instance's buffers may still be pending when the render
   * code is done with it, so release it only after the render graph has executed.
   */
  static acquire(width: number, height: number): ClusteredLight {
    // Prefer an instance already sized for this target, so alternating targets do not
    // rebuild the index texture every frame.
    const x = ClusteredLight.tileCount(width);
    const y = ClusteredLight.tileCount(height);
    const index = this._pool.findIndex((cl) => cl._tileCountX === x && cl._tileCountY === y);
    if (index >= 0) {
      return this._pool.splice(index, 1)[0];
    }
    return this._pool.pop() ?? new ClusteredLight();
  }
  /** Tile count along a screen axis of `size` pixels. */
  private static tileCount(size: number) {
    return Math.min(Math.max(Math.ceil(size / TILE_SIZE_PX), 1), MAX_TILES_PER_AXIS);
  }
  /** Returns an instance obtained from {@link ClusteredLight.acquire} to the pool. */
  static release(cl: ClusteredLight) {
    this._pool.push(cl);
  }
  private _tileCountX: number;
  private _tileCountY: number;
  private readonly _tileCountZ: number;
  private _lights: Float32Array<ArrayBuffer>;
  /** View-space bounding sphere of each light in `_lights`, for culling. See writeLight. */
  private _lightSpheres: Float32Array<ArrayBuffer>;
  /** Buffer indices of the lights shaded outside the clusters, zero-terminated. */
  private readonly _globalLights: Int32Array<ArrayBuffer>;
  private _lightIndexTexture: Nullable<Texture2D>;
  private _lightIndexFramebuffer: Nullable<FrameBuffer>;
  private _lightIndexProgram: Nullable<GPUProgram>;
  private _bindGroup: Nullable<BindGroup>;
  /** WebGPU only: the pass counting each cluster's lights ahead of the index pass. */
  private _lightCountProgram: Nullable<GPUProgram>;
  private _countBindGroup: Nullable<BindGroup>;
  /** WebGPU only: list entries the clusters asked for, as last read back from the GPU. */
  private _requestedListEntries: number;
  private _readbackPending: boolean;
  private readonly _readback: Uint8Array<ArrayBuffer>;
  private _warnedListOverflow: boolean;
  private _lightIndexVertexLayout: Nullable<VertexLayout>;
  /** Not released by disposing the layout, so kept to be disposed along with it. */
  private _lightIndexVertexBuffer: Nullable<StructuredBuffer>;
  private _lightIndexRenderStates: Nullable<RenderStateSet>;
  private _lightBuffer: Nullable<GPUDataBuffer>;
  /** WebGL1 only, in place of `_lightBuffer`: the lights as float texels, a row each. */
  private _lightTexture: Nullable<Texture2D>;
  private _lightSphereBuffer: Nullable<GPUDataBuffer>;
  /** Lights the WebGPU storage buffers above hold, slot 0 included. */
  private _storageLightCapacity: number;
  /**
   * WebGPU only: per cluster, the offset of its list in `_lightListBuffer` and its
   * length, two uints each.
   */
  private _clusterGridBuffer: Nullable<GPUDataBuffer>;
  /** WebGPU only: light buffer indices of every cluster's lights, one list after another. */
  private _lightListBuffer: Nullable<GPUDataBuffer>;
  private _lightListCapacity: number;
  /** WebGPU only: the atomic allocating list room, zeroed before each build. */
  private _listCounterBuffer: Nullable<GPUDataBuffer>;
  private readonly _listCounterZero: Uint32Array<ArrayBuffer>;
  private readonly _lightIndexTexSize: Int32Array<ArrayBuffer>;
  private readonly _sizeParam: Vector4;
  private _countParam: Int32Array<ArrayBuffer>;
  private readonly _clusterParam: Vector4;
  /** Perspective depth slicing: split depth, first exponential slice, exponential slice count. */
  private readonly _sliceParam: Vector4;
  private _numShadowLights: number;
  private _orthographic: boolean;
  /** Scratch list of the lights competing for the slots after the mask-backed ones. */
  private readonly _rest: PunctualLight[];
  /** Scratch for prioritize(). */
  private _sortScores: Float64Array<ArrayBuffer>;
  private _sortOrder: Uint32Array<ArrayBuffer>;
  private readonly _sortScratch: PunctualLight[];
  constructor() {
    this._tileCountX = 0;
    this._tileCountY = 0;
    this._tileCountZ = TILE_COUNT_Z;
    // Grown to fit the frame's lights, see ensureLightArrayCapacity.
    this._lights = new Float32Array(16 * 64);
    this._lightSpheres = new Float32Array(4 * getSphereStride() * 64);
    this._globalLights = new Int32Array(MAX_GLOBAL_LIGHTS);
    this._lightIndexTexture = null;
    this._lightIndexFramebuffer = null;
    this._lightIndexProgram = null;
    this._lightBuffer = null;
    this._lightSphereBuffer = null;
    this._lightTexture = null;
    this._storageLightCapacity = 0;
    this._clusterGridBuffer = null;
    this._lightListBuffer = null;
    this._lightListCapacity = 0;
    this._listCounterBuffer = null;
    this._listCounterZero = new Uint32Array(4);
    this._lightIndexTexSize = new Int32Array(2);
    this._bindGroup = null;
    this._lightCountProgram = null;
    this._countBindGroup = null;
    this._requestedListEntries = 0;
    this._readbackPending = false;
    this._readback = new Uint8Array(16);
    this._warnedListOverflow = false;
    this._lightIndexVertexLayout = null;
    this._lightIndexVertexBuffer = null;
    this._lightIndexRenderStates = null;
    this._sizeParam = new Vector4();
    this._countParam = new Int32Array(4);
    this._clusterParam = new Vector4();
    this._sliceParam = new Vector4();
    this._numShadowLights = 0;
    this._orthographic = false;
    this._rest = [];
    this._sortScores = new Float64Array(64);
    this._sortOrder = new Uint32Array(64);
    this._sortScratch = [];
  }
  get lightBuffer() {
    return this._lightBuffer;
  }
  /** See {@link ClusteredLight._lightTexture}. WebGL1 only. */
  get lightTexture() {
    return this._lightTexture;
  }
  /**
   * Number of shadow-casting lights placed at the head of the clustered light
   * buffer (indices `1..N`), each backed by a screen-space shadow mask slot.
   * Zero unless the screen-space shadow mask path is active.
   */
  get numShadowLights() {
    return this._numShadowLights;
  }
  /**
   * Whether the clusters were built for an orthographic camera, which slices depth linearly
   * rather than exponentially. The lit shader reads it to compute the matching slice.
   */
  get orthographic() {
    return this._orthographic;
  }
  /**
   * Buffer indices of the lights every fragment shades regardless of its cluster
   * (directional lights, up to {@link MAX_GLOBAL_LIGHTS}), zero-terminated. Kept out of
   * the clusters so they do not take one of the few slots in each.
   */
  get globalLights() {
    return this._globalLights;
  }
  get clusterParam() {
    return this._clusterParam;
  }
  get countParam() {
    return this._countParam;
  }
  /** The per-cluster light slots, except on WebGPU where the clusters hold lists. */
  get lightIndexTexture() {
    return this._lightIndexTexture;
  }
  get lightIndexTexSize() {
    return this._lightIndexTexSize;
  }
  /** See {@link ShaderHelper.getClusterGrid}. WebGPU only. */
  get clusterGridBuffer() {
    return this._clusterGridBuffer;
  }
  /** See {@link ShaderHelper.getClusterLightList}. WebGPU only. */
  get lightListBuffer() {
    return this._lightListBuffer;
  }
  private createVertexLayout(device: AbstractDevice, textureWidth: number, textureHeight: number) {
    let vb: StructuredBuffer;
    const numClusters = this._tileCountX * this._tileCountY * this._tileCountZ;
    if (device.type === 'webgl') {
      const vertices = new Float32Array(numClusters * 3);
      for (let i = 0; i < numClusters; i++) {
        const ix = i % textureWidth;
        const iy = Math.floor(i / textureWidth);
        vertices[i * 3 + 0] = (2 * (ix + 0.5)) / textureWidth - 1;
        vertices[i * 3 + 1] = (2 * (iy + 0.5)) / textureHeight - 1;
        vertices[i * 3 + 2] = i;
      }
      vb = device.createVertexBuffer('position_f32x3', vertices)!;
    } else {
      const vertices = new Float32Array(numClusters * 2);
      for (let i = 0; i < numClusters; i++) {
        const ix = i % textureWidth;
        const iy = Math.floor(i / textureWidth);
        vertices[i * 2 + 0] = (2 * (ix + 0.5)) / textureWidth - 1;
        vertices[i * 2 + 1] = (2 * (iy + 0.5)) / textureHeight - 1;
      }
      vb = device.createVertexBuffer('position_f32x2', vertices)!;
    }
    this._lightIndexVertexBuffer = vb;
    this._lightIndexVertexLayout = device.createVertexLayout({
      vertexBuffers: [{ buffer: vb }]
    });
  }
  /** Sizes the grid for a target, dropping the resources built for another grid. */
  private resizeGrid(width: number, height: number) {
    const x = ClusteredLight.tileCount(width);
    const y = ClusteredLight.tileCount(height);
    if (x === this._tileCountX && y === this._tileCountY) {
      return;
    }
    this._tileCountX = x;
    this._tileCountY = y;
    this._lightIndexFramebuffer?.dispose();
    this._lightIndexFramebuffer = null;
    this._lightIndexTexture?.dispose();
    this._lightIndexTexture = null;
    this._lightIndexVertexLayout?.dispose();
    this._lightIndexVertexLayout = null;
    this._lightIndexVertexBuffer?.dispose();
    this._lightIndexVertexBuffer = null;
    this._clusterGridBuffer?.dispose();
    this._clusterGridBuffer = null;
    this._lightListBuffer?.dispose();
    this._lightListBuffer = null;
    this._lightListCapacity = 0;
  }
  private createRenderState(device: AbstractDevice) {
    this._lightIndexRenderStates = device.createRenderStateSet();
    this._lightIndexRenderStates.useDepthState().enableTest(false).enableWrite(false);
    this._lightIndexRenderStates.useRasterizerState().setCullMode('none');
  }
  private createProgram(device: AbstractDevice) {
    const webgl1 = device.type === 'webgl';
    const sphereStride = getSphereStride();
    if (device.type === 'webgpu') {
      // Declares what both passes use and returns the batched light loop: runs `body`
      // for each light of each batch the workgroup loads, with the light's index in
      // `lightId`, its sphere in `lightPos` and its brightness in `brightness`, for the
      // threads where `test` holds. Also emits the cluster bounds and the locals below.
      const setup = function (this: PBGlobalScope) {
        declareIndexPassScope(pb0!, this, sphereStride, true);
        this.clusterGrid = pb0!.uint[0]().storageBuffer(0);
        this.listCounter = pb0!.atomic_uint[0]().storageBuffer(0);
        // One batch of lights, loaded by the whole workgroup and then tested by each of
        // its clusters, instead of every cluster reading every light on its own.
        this.batchSpheres = pb0!.vec4[INDEX_GROUP_SIZE]().workgroup();
        this.batchBrightness = pb0!.float[INDEX_GROUP_SIZE]().workgroup();
      };
      let pb0: Nullable<ProgramBuilder> = null;
      const emitMainSetup = function (this: PBInsideFunctionScope, pb: ProgramBuilder) {
        this.$l.numClusters = pb.mul(this.countParam.x, this.countParam.y, this.countParam.z);
        this.$l.cluster = pb.int(this.$builtins.globalInvocationId.x);
        // Threads past the last cluster still take part in loading the batches.
        this.$l.valid = pb.lessThan(this.cluster, this.numClusters);
        emitClusterBounds.call(this, pb, pb.min(this.cluster, pb.sub(this.numClusters, 1)));
        this.$l.cell = pb.mul(pb.uint(pb.min(this.cluster, pb.sub(this.numClusters, 1))), 2);
        this.$l.local = pb.uint(this.$builtins.localInvocationId.x);
        this.$l.numLights = pb.uint(pb.sub(this.countParam.w, 1));
        this.$l.numBatches = pb.div(pb.add(this.numLights, INDEX_GROUP_SIZE - 1), INDEX_GROUP_SIZE);
      };
      const forEachBatchedLight = function (
        this: PBInsideFunctionScope,
        pb: ProgramBuilder,
        test: () => PBShaderExp,
        body: (this: PBInsideFunctionScope) => void
      ) {
        this.$for(pb.uint('b'), 0, this.numBatches, function () {
          this.$l.base = pb.add(pb.mul(this.b, INDEX_GROUP_SIZE), 1);
          this.$l.li = pb.add(this.base, this.local);
          this.$if(pb.lessThan(this.li, pb.uint(this.countParam.w)), function () {
            this.batchSpheres.setAt(this.local, this[UNIFORM_NAME_LIGHT_SPHERES].at(pb.mul(this.li, 2)));
            this.batchBrightness.setAt(
              this.local,
              this[UNIFORM_NAME_LIGHT_SPHERES].at(pb.add(pb.mul(this.li, 2), 1)).x
            );
          });
          pb.workgroupBarrier();
          this.$if(test.call(this), function () {
            this.$l.batchCount = pb.min(pb.sub(pb.uint(this.countParam.w), this.base), INDEX_GROUP_SIZE);
            this.$for(pb.uint('j'), 0, this.batchCount, function () {
              this.$l.lightId = pb.add(this.base, this.j);
              this.$l.lightPos = this.batchSpheres.at(this.j);
              this.$l.brightness = this.batchBrightness.at(this.j);
              body.call(this);
            });
          });
          // The next batch overwrites the one still being read.
          pb.workgroupBarrier();
        });
      };
      // Count pass: how many lights reach each cluster, and in total. The total decides
      // in the write pass whether the lists fit, which no single pass could know before
      // every cluster had allocated its list.
      this._lightCountProgram = device.buildComputeProgram({
        label: 'ClusteredLightCount',
        workgroupSize: [INDEX_GROUP_SIZE, 1, 1],
        compute(pb) {
          pb0 = pb;
          setup.call(this);
          pb.main(function () {
            emitMainSetup.call(this, pb);
            this.$l.listCount = pb.uint(0);
            forEachBatchedLight.call(
              this,
              pb,
              () => this.valid,
              function () {
                this.$if(emitLightReaches.call(this, pb), function () {
                  this.listCount = pb.add(this.listCount, 1);
                });
              }
            );
            this.$if(this.valid, function () {
              this.clusterGrid.setAt(pb.add(this.cell, 1), this.listCount);
              pb.atomicAdd(this.listCounter.at(1), this.listCount);
            });
          });
        }
      })!;
      this._lightCountProgram.name = '@ClusteredLight_Count';
      this._countBindGroup = device.createBindGroup(this._lightCountProgram.bindGroupLayouts[0]);
      // Write pass: allocates each cluster's list and fills it.
      this._lightIndexProgram = device.buildComputeProgram({
        label: 'ClusteredLightIndex',
        workgroupSize: [INDEX_GROUP_SIZE, 1, 1],
        compute(pb) {
          pb0 = pb;
          setup.call(this);
          this.listCapacity = pb.uint().uniform(0);
          this.lightList = pb.uint[0]().storageBuffer(0);
          // The bucket of a score, higher for stronger lights.
          pb.func('scoreBucket', [pb.float('score')], function () {
            this.$return(
              pb.uint(
                pb.clamp(
                  pb.add(pb.floor(pb.mul(pb.log2(pb.max(this.score, 1e-30)), 0.5)), SCORE_BUCKETS / 2),
                  0,
                  SCORE_BUCKETS - 1
                )
              )
            );
          });
          pb.main(function () {
            emitMainSetup.call(this, pb);
            emitScoreSetup.call(this, pb);
            this.$l.need = pb.uint(0);
            this.$if(this.valid, function () {
              this.need = this.clusterGrid.at(pb.add(this.cell, 1));
            });
            // When the lists do not all fit, every cluster gives up the same share of its
            // lights, so the sum fits and none is left empty. The margin absorbs the
            // rounding of the float scale.
            this.$l.total = pb.atomicLoad(this.listCounter.at(1));
            this.$l.allowed = this.need;
            this.$if(pb.greaterThan(this.total, this.listCapacity), function () {
              this.allowed = pb.uint(
                pb.floor(
                  pb.mul(
                    pb.float(this.need),
                    pb.div(pb.float(this.listCapacity), pb.float(this.total)),
                    0.999
                  )
                )
              );
            });
            this.$l.truncated = pb.lessThan(this.allowed, this.need);
            // A cut list keeps the strongest lights for this cluster: the buckets above
            // `cutBucket` whole, and of that bucket only the first `cutRoom`.
            this.$l.hist = pb.uint[SCORE_BUCKETS]();
            this.$for(pb.int('h'), 0, SCORE_BUCKETS, function () {
              this.hist.setAt(this.h, 0);
            });
            forEachBatchedLight.call(
              this,
              pb,
              () => pb.and(this.valid, this.truncated),
              function () {
                this.$if(emitLightReaches.call(this, pb), function () {
                  emitLightScore.call(this, pb, this.brightness);
                  this.$l.bucket = this.scoreBucket(this.score);
                  this.hist.setAt(this.bucket, pb.add(this.hist.at(this.bucket), 1));
                });
              }
            );
            this.$l.cutBucket = pb.int(-1);
            this.$l.cutRoom = pb.uint(0);
            this.$if(this.truncated, function () {
              this.$l.kept = pb.uint(0);
              this.$for(pb.int('h'), SCORE_BUCKETS - 1, 0, false, true, function () {
                this.$if(pb.greaterThan(pb.add(this.kept, this.hist.at(this.h)), this.allowed), function () {
                  this.cutBucket = this.h;
                  this.cutRoom = pb.sub(this.allowed, this.kept);
                  this.$break();
                });
                this.kept = pb.add(this.kept, this.hist.at(this.h));
              });
            });
            this.$l.listOffset = pb.uint(0);
            this.$if(pb.and(this.valid, pb.greaterThan(this.allowed, 0)), function () {
              this.listOffset = pb.atomicAdd(this.listCounter.at(0), this.allowed);
              // Only rounding can leave the sum above the capacity; trim the last lists.
              this.allowed = pb.select(
                pb.uint(0),
                pb.min(this.allowed, pb.sub(this.listCapacity, this.listOffset)),
                pb.lessThan(this.listOffset, this.listCapacity)
              );
            });
            this.$l.written = pb.uint(0);
            forEachBatchedLight.call(
              this,
              pb,
              () => pb.and(this.valid, pb.lessThan(this.written, this.allowed)),
              function () {
                this.$if(pb.greaterThanEqual(this.written, this.allowed), function () {
                  this.$break();
                });
                this.$if(emitLightReaches.call(this, pb), function () {
                  this.$l.keep = true;
                  this.$if(this.truncated, function () {
                    emitLightScore.call(this, pb, this.brightness);
                    this.$l.bucket = pb.int(this.scoreBucket(this.score));
                    this.keep = pb.greaterThan(this.bucket, this.cutBucket);
                    this.$if(
                      pb.and(pb.equal(this.bucket, this.cutBucket), pb.greaterThan(this.cutRoom, 0)),
                      function () {
                        this.keep = true;
                        this.cutRoom = pb.sub(this.cutRoom, 1);
                      }
                    );
                  });
                  this.$if(this.keep, function () {
                    this.lightList.setAt(pb.add(this.listOffset, this.written), this.lightId);
                    this.written = pb.add(this.written, 1);
                  });
                });
              }
            );
            this.$if(this.valid, function () {
              this.clusterGrid.setAt(this.cell, this.listOffset);
              this.clusterGrid.setAt(pb.add(this.cell, 1), this.written);
            });
          });
        }
      })!;
    } else {
      this._lightIndexProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = (webgl1 ? pb.vec3() : pb.vec2()).attrib('position');
          this.$outputs.value = webgl1 ? pb.vec4() : pb.uvec4();
          declareIndexPassScope(pb, this, sphereStride, false);
          pb.main(function () {
            this.$builtins.pointSize = 1;
            this.$builtins.position = pb.vec4(this.$inputs.pos.xy, 0, 1);
            emitClusterBounds.call(
              this,
              pb,
              webgl1 ? pb.int(this.$inputs.pos.z) : pb.int(this.$builtins.vertexIndex)
            );
            if (webgl1) {
              this.$l.n = pb.int(0);
              this.$l.lightIndices = pb.float[8]();
              this.$for(pb.int('i'), 0, 8, function () {
                this.lightIndices.setAt(this.i, 0);
              });
              this.$for(pb.int('i'), 1, ShaderHelper.getMaxClusterLights() + 1, function () {
                this.$if(pb.equal(this.i, this.countParam.w), function () {
                  this.$break();
                });
                this.$l.lightPos = this[UNIFORM_NAME_LIGHT_SPHERES].at(this.i);
                // Negative radius: shaded through a global slot, never through the clusters.
                this.$if(pb.lessThan(this.lightPos.w, 0), function () {
                  this.$continue();
                });
                this.$l.distSq = this.aabbDistSq(this.lightPos.xyz, this.aabbMin, this.aabbMax);
                this.$if(
                  pb.and(
                    this.sphereReachesAABB(this.lightPos, this.distSq),
                    pb.not(
                      this.sphereOutsideTile(
                        this.lightPos,
                        this.planeLeft,
                        this.planeRight,
                        this.planeBottom,
                        this.planeTop
                      )
                    )
                  ),
                  function () {
                    this.$for(pb.int('j'), 0, 8, function () {
                      this.$if(pb.equal(this.j, this.n), function () {
                        this.lightIndices.setAt(this.j, pb.float(this.i));
                        this.n = pb.add(this.n, 1);
                        this.$break();
                      });
                    });
                    this.$if(pb.equal(this.n, 8), function () {
                      this.$break();
                    });
                  }
                );
              });
              this.$outputs.value.r = pb.add(pb.mul(this.lightIndices[0], 256), this.lightIndices[1]);
              this.$outputs.value.g = pb.add(pb.mul(this.lightIndices[2], 256), this.lightIndices[3]);
              this.$outputs.value.b = pb.add(pb.mul(this.lightIndices[4], 256), this.lightIndices[5]);
              this.$outputs.value.a = pb.add(pb.mul(this.lightIndices[6], 256), this.lightIndices[7]);
            } else {
              emitSelectionInit.call(this, pb);
              this.$for(pb.uint('i'), 1, pb.uint(this.countParam.w), function () {
                emitConsiderLight.call(
                  this,
                  pb,
                  this.i,
                  this[UNIFORM_NAME_LIGHT_SPHERES].at(pb.mul(this.i, sphereStride)),
                  this[UNIFORM_NAME_LIGHT_SPHERES].at(pb.add(pb.mul(this.i, sphereStride), 1)).x
                );
              });
              this.$outputs.value = emitPackSelection.call(this, pb);
            }
          });
        },
        fragment(pb) {
          this.$outputs.color = webgl1 ? pb.vec4() : pb.uvec4();
          pb.main(function () {
            this.$outputs.color = this.$inputs.value;
          });
        }
      })!;
    }
    this._lightIndexProgram.name = '@ClusteredLight_Index';
    this._bindGroup = device.createBindGroup(this._lightIndexProgram.bindGroupLayouts[0]);
    if (!ShaderHelper.usesClusterLightLists()) {
      this._lightSphereBuffer?.dispose();
      const sphereBufferType = this._lightIndexProgram.getBindingInfo(UNIFORM_NAME_LIGHT_SPHERES)!.type;
      this._lightSphereBuffer = device.createStructuredBuffer(sphereBufferType as PBStructTypeInfo, {
        usage: 'uniform'
      });
    }
  }
  /**
   * Grows the WebGPU light and sphere storage buffers to hold `count` entries (slot 0
   * included). The contents are rewritten every frame, so nothing is copied.
   */
  private ensureStorageLightCapacity(device: AbstractDevice, count: number) {
    if (this._storageLightCapacity >= count && this._lightBuffer && this._lightSphereBuffer) {
      return;
    }
    const capacity = Math.max(64, 1 << Math.ceil(Math.log2(count)));
    this._lightBuffer?.dispose();
    this._lightSphereBuffer?.dispose();
    this._lightBuffer = device.createBuffer(capacity * 64, { usage: 'uniform', storage: true })!;
    this._lightSphereBuffer = device.createBuffer(capacity * 16 * getSphereStride(), {
      usage: 'uniform',
      storage: true
    })!;
    this._storageLightCapacity = capacity;
  }
  /**
   * Makes the WebGPU cluster grid and light list buffers fit the current grid and
   * `numLights` lights. The list grows but is not shrunk.
   */
  private ensureListBuffers(device: AbstractDevice, numLights: number) {
    const numClusters = this._tileCountX * this._tileCountY * this._tileCountZ;
    if (!this._clusterGridBuffer) {
      this._clusterGridBuffer = device.createBuffer(numClusters * 8, { usage: 'uniform', storage: true })!;
    }
    const capacity = Math.min(
      Math.max(
        numClusters * Math.min(Math.max(numLights, 1), LIST_LIGHTS_PER_CLUSTER),
        // With some headroom, as moving lights change what the clusters ask for.
        Math.ceil(this._requestedListEntries * 1.25)
      ),
      MAX_LIST_ENTRIES
    );
    if (!this._lightListBuffer || this._lightListCapacity < capacity) {
      this._lightListBuffer?.dispose();
      this._lightListBuffer = device.createBuffer(capacity * 4, { usage: 'uniform', storage: true })!;
      this._lightListCapacity = capacity;
    }
    if (!this._listCounterBuffer) {
      this._listCounterBuffer = device.createBuffer(16, { usage: 'uniform', storage: true })!;
    }
  }
  /**
   * Reads back how many list entries the clusters asked for, so the next builds can
   * size the list to fit. One read is in flight at a time.
   */
  private readBackListRequest() {
    if (this._readbackPending) {
      return;
    }
    this._readbackPending = true;
    this._listCounterBuffer!.getBufferSubData(this._readback, 0, 16).then(
      () => {
        this._readbackPending = false;
        const requested = new Uint32Array(this._readback.buffer, 0, 4)[1];
        this._requestedListEntries = requested;
        if (requested > MAX_LIST_ENTRIES && !this._warnedListOverflow) {
          this._warnedListOverflow = true;
          console.warn(
            `ClusteredLight: the light clusters ask for ${requested} list entries, above the ` +
              `${MAX_LIST_ENTRIES} budget; crowded clusters keep only their strongest lights. ` +
              `Giving lights a finite range usually cuts this down by orders of magnitude.`
          );
        }
      },
      () => {
        this._readbackPending = false;
      }
    );
  }
  /** Grows the CPU-side light arrays to hold `count` entries (slot 0 included). */
  private ensureLightArrayCapacity(count: number) {
    const stride = getSphereStride();
    if (this._lights.length >= count * 16) {
      return;
    }
    const capacity = 1 << Math.ceil(Math.log2(count));
    this._lights = new Float32Array(capacity * 16);
    this._lightSpheres = new Float32Array(capacity * 4 * stride);
  }
  /** Creates the uniform light buffer read by the lit shaders, laid out as ShaderHelper declares it. */
  private createLightBuffer(device: AbstractDevice) {
    if (device.type === 'webgl') {
      this._lightTexture = device.createTexture2D('rgba32f', 4, ShaderHelper.getMaxClusterLights() + 1, {
        mipmapping: false
      })!;
      this._lightTexture.name = 'ClusterLights';
      return;
    }
    const lightBufferType = new PBStructTypeInfo('ClusteredLightBuffer', 'std140', [
      {
        name: ShaderHelper.getLightBufferUniformName(),
        type: new PBArrayTypeInfo(
          new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
          (ShaderHelper.getMaxClusterLights() + 1) * 4
        )
      }
    ]);
    this._lightBuffer = device.createStructuredBuffer(lightBufferType, { usage: 'uniform' });
  }
  private createLightIndexTexture(device: AbstractDevice) {
    // One texel per cluster in row-major order; the tail of the last row is unused.
    const numClusters = this._tileCountX * this._tileCountY * this._tileCountZ;
    const textureWidth = Math.min(
      1 << Math.ceil(Math.log2(Math.ceil(Math.sqrt(numClusters)))),
      device.getDeviceCaps().textureCaps.maxTextureSize
    );
    const textureHeight = Math.ceil(numClusters / textureWidth);
    this._lightIndexTexture = device.createTexture2D(
      device.type === 'webgl' ? 'rgba32f' : 'rgba32ui',
      textureWidth,
      textureHeight,
      { mipmapping: false }
    )!;
    this._lightIndexTexture.name = 'ClusterLightIndex';
    this._lightIndexTexSize[0] = textureWidth;
    this._lightIndexTexSize[1] = textureHeight;
    this._lightIndexFramebuffer?.dispose();
    this._lightIndexFramebuffer = device.createFrameBuffer([this._lightIndexTexture], null);
  }
  /**
   * Builds the per-cluster light lists for a camera.
   *
   * @param width - Width in device pixels of the target the lit pass will draw into.
   * @param height - Height in device pixels of that target.
   *
   * @remarks
   * The lit shader maps `fragCoord` to a tile with `width`/`height`, so they must be the
   * size of the target it actually renders to, not whatever viewport is current here.
   */
  calculateLightIndex(
    camera: Camera,
    renderQueue: RenderQueue,
    width: number,
    height: number,
    screenSpaceShadowMask = camera.screenSpaceShadowMask,
    preExposure = 1
  ) {
    const numLights = this.getVisibleLights(camera, renderQueue, screenSpaceShadowMask, preExposure);
    const device = getDevice();
    const compute = ShaderHelper.usesClusterLightLists();
    this.resizeGrid(width, height);
    if (compute) {
      this.ensureStorageLightCapacity(device, numLights + 1);
      this.ensureListBuffers(device, numLights);
    } else if (!this._lightIndexTexture) {
      this.createLightIndexTexture(device);
    }
    if (!this._lightIndexProgram) {
      this.createProgram(device);
    }
    if (!compute && !this._lightBuffer && !this._lightTexture) {
      this.createLightBuffer(device);
    }
    if (!compute && !this._lightIndexVertexLayout) {
      this.createVertexLayout(device, this._lightIndexTexture!.width, this._lightIndexTexture!.height);
    }
    if (!compute && !this._lightIndexRenderStates) {
      this.createRenderState(device);
    }
    const vw = width;
    const vh = height;
    const near = camera.getNearPlane();
    const far = camera.getFarPlane();
    // The lit shader computes slice = t * scale + bias, where t is log2(view depth) for
    // perspective (exponential slices) and the view depth itself for orthographic (linear
    // slices: an orthographic near plane may be zero or negative, where log2 is undefined).
    this._orthographic = !camera.isPerspective();
    let scale: number;
    let bias: number;
    if (this._orthographic) {
      scale = this._tileCountZ / (far - near);
      bias = -near * scale;
    } else {
      // A near slice pays off only when it spans more than one regular exponential slice.
      const split = NEAR_SLICE_METERS / (camera.scene?.metersPerUnit ?? 1);
      const nearSlice = split > near * Math.pow(far / near, 1 / this._tileCountZ) && split < far;
      const expStart = nearSlice ? split : near;
      const firstExpSlice = nearSlice ? 1 : 0;
      const numExpSlices = this._tileCountZ - firstExpSlice;
      scale = numExpSlices / Math.log2(far / expStart);
      // Depths before the split land below firstExpSlice, which the lit shader's clamp
      // and integer conversion take to slice 0.
      bias = firstExpSlice - Math.log2(expStart) * scale;
      this._sliceParam.setXYZW(expStart, firstExpSlice, numExpSlices, 0);
    }
    this._clusterParam.setXYZW(vw, vh, scale, bias);
    this._sizeParam.setXYZW(vw, vh, near, far);
    this._countParam[0] = this._tileCountX;
    this._countParam[1] = this._tileCountY;
    this._countParam[2] = this._tileCountZ;
    // countParam.w stores light count + 1 because clustered indices start from 1.
    // Keep it valid even when there are no unshadowed punctual lights so clustered
    // shading math stays well-defined for emissive and environment lighting paths.
    this._countParam[3] = numLights + 1;
    const numClusters = this._tileCountX * this._tileCountY * this._tileCountZ;
    device.pushDeviceStates();
    if (!compute) {
      device.setFramebuffer(this._lightIndexFramebuffer);
      // setFramebuffer may no-op, so reset viewport and scissor explicitly.
      device.setViewport(null);
      device.setScissor(null);
    }
    // The compute pass writes every cluster itself, empty ones included.
    if (compute || numLights > 0) {
      if (this._lightSphereBuffer!.disposed) {
        this._lightSphereBuffer!.reload();
      }
      // Slot 0 is never read, so upload only up to the last light.
      if (this._lightTexture) {
        this._lightTexture.update(this._lights.subarray(0, (numLights + 1) * 16), 0, 0, 4, numLights + 1);
      } else {
        if (this._lightBuffer!.disposed) {
          this._lightBuffer!.reload();
        }
        this._lightBuffer!.bufferSubData(0, this._lights, 0, (numLights + 1) * 16);
      }
      this._lightSphereBuffer!.bufferSubData(
        0,
        this._lightSpheres,
        0,
        (numLights + 1) * 4 * getSphereStride()
      );
      this._bindGroup!.setValue('invProjMatrix', camera.getInvProjectionMatrix());
      this._bindGroup!.setValue('sizeParam', this._sizeParam);
      this._bindGroup!.setValue('countParam', this._countParam);
      this._bindGroup!.setValue('orthoProj', this._orthographic ? 1 : 0);
      this._bindGroup!.setValue('sliceParam', this._sliceParam);
      this._bindGroup!.setBuffer(UNIFORM_NAME_LIGHT_SPHERES, this._lightSphereBuffer!);
      device.setProgram(this._lightIndexProgram);
      if (compute) {
        const numGroups = Math.ceil(numClusters / INDEX_GROUP_SIZE);
        this._listCounterBuffer!.bufferSubData(0, this._listCounterZero);
        const countBindGroup = this._countBindGroup!;
        countBindGroup.setValue('invProjMatrix', camera.getInvProjectionMatrix());
        countBindGroup.setValue('sizeParam', this._sizeParam);
        countBindGroup.setValue('countParam', this._countParam);
        countBindGroup.setValue('orthoProj', this._orthographic ? 1 : 0);
        countBindGroup.setValue('sliceParam', this._sliceParam);
        countBindGroup.setBuffer(UNIFORM_NAME_LIGHT_SPHERES, this._lightSphereBuffer!);
        countBindGroup.setBuffer('clusterGrid', this._clusterGridBuffer!);
        countBindGroup.setBuffer('listCounter', this._listCounterBuffer!);
        device.setProgram(this._lightCountProgram);
        device.setBindGroup(0, countBindGroup);
        device.compute(numGroups, 1, 1);
        this._bindGroup!.setValue('listCapacity', this._lightListCapacity);
        this._bindGroup!.setBuffer('clusterGrid', this._clusterGridBuffer!);
        this._bindGroup!.setBuffer('lightList', this._lightListBuffer!);
        this._bindGroup!.setBuffer('listCounter', this._listCounterBuffer!);
        device.setProgram(this._lightIndexProgram);
        device.setBindGroup(0, this._bindGroup!);
        device.compute(numGroups, 1, 1);
        this.readBackListRequest();
      } else {
        device.setVertexLayout(this._lightIndexVertexLayout);
        device.setBindGroup(0, this._bindGroup!);
        const savedRS = device.getRenderStates();
        device.setRenderStates(this._lightIndexRenderStates);
        device.draw('point-list', 0, numClusters);
        device.setRenderStates(savedRS);
      }
    } else {
      device.clearFrameBuffer(new Vector4(0, 0, 0, 0), DEPTH_CLEAR_VALUE, 0);
    }
    device.popDeviceStates();
  }
  /**
   * Orders `lights` by estimated contribution at the camera, most important first.
   *
   * @remarks
   * Both caps drop lights by buffer index - the global one truncates the tail, and
   * a full cluster keeps its lowest 16 indices - so without this whichever lights the
   * scene traversal happened to reach last are the ones that vanish. The score is
   * `brightness * r^2 / (r^2 + d^2)`, with `r` the radius of the sphere bounding the
   * lit region and `d` the camera's distance to it: 0 from anywhere inside it, falling
   * off with distance beyond it, and larger for lights that reach further. The sphere is
   * getLightBounds', so a spot light pointing away from the camera ranks by where it
   * shines rather than where it stands, and the brightness is lightBrightness', so a
   * rect light counts its whole area. Directional lights have no range and light
   * everything, so they always rank first.
   */
  private prioritize(lights: PunctualLight[], eye: Vector3) {
    if (lights.length < 2) {
      return;
    }
    // Scores and a permutation in reused typed arrays, so a frame allocates nothing.
    const n = lights.length;
    if (this._sortScores.length < n) {
      const capacity = 1 << Math.ceil(Math.log2(n));
      this._sortScores = new Float64Array(capacity);
      this._sortOrder = new Uint32Array(capacity);
    }
    const scores = this._sortScores;
    const order = this._sortOrder.subarray(0, n);
    const sorted = this._sortScratch;
    sorted.length = n;
    for (let i = 0; i < n; i++) {
      const light = lights[i];
      getLightBounds(light, _bounds);
      const range = _bounds[3];
      let score: number;
      if (light.isDirectionLight() || range <= 0) {
        score = Infinity;
      } else {
        const dx = _bounds[0] - eye.x;
        const dy = _bounds[1] - eye.y;
        const dz = _bounds[2] - eye.z;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - range, 0);
        const range2 = range * range;
        score = (lightBrightness(light) * range2) / (range2 + d * d);
      }
      scores[i] = score;
      order[i] = i;
      sorted[i] = light;
    }
    order.sort(this._compareScores);
    for (let i = 0; i < n; i++) {
      lights[i] = sorted[order[i]];
    }
    sorted.length = 0;
  }
  /**
   * Orders buffer positions by descending score. Ties go to the lower position, which
   * keeps equally important lights in traversal order frame to frame. Compared rather
   * than subtracted: two directional lights would give Infinity - Infinity.
   */
  private readonly _compareScores = (a: number, b: number) => {
    const sa = this._sortScores[a];
    const sb = this._sortScores[b];
    return sa > sb ? -1 : sa < sb ? 1 : a - b;
  };
  private getVisibleLights(
    camera: Camera,
    renderQueue: RenderQueue,
    useShadowMask: boolean,
    preExposure: number
  ) {
    this.ensureLightArrayCapacity(
      Math.min(
        renderQueue.shadowedLights.length + renderQueue.unshadowedLights.length,
        ShaderHelper.getMaxClusterLights()
      ) + 1
    );
    const lights = this._lights;
    const view = camera.viewMatrix;
    const spheres = this._lightSpheres;
    const sphereStride = getSphereStride();
    const globalLights = this._globalLights;
    globalLights.fill(0);
    let numGlobal = 0;
    const writeLight = (light: PunctualLight, slot: number) => {
      const offset = slot * 16;
      const colorIntensity = light.diffuseAndIntensity;
      const posRange = light.positionAndRange;
      const dirCutoff = light.directionAndCutoff;
      lights.set(posRange, offset);
      // Culling sphere: radius < 0 = shaded through a global slot, skipped by the index
      // pass; 0 = unbounded, in every cluster; otherwise it bounds the lit region.
      getLightBounds(light, _bounds);
      const x = _bounds[0];
      const y = _bounds[1];
      const z = _bounds[2];
      let radius = _bounds[3];
      if (radius <= 0) {
        if (numGlobal < MAX_GLOBAL_LIGHTS) {
          globalLights[numGlobal++] = slot;
          radius = -1;
        } else {
          radius = 0;
        }
      }
      // The view matrix is column-major.
      const s = slot * 4 * sphereStride;
      spheres[s + 0] = view[0] * x + view[4] * y + view[8] * z + view[12];
      spheres[s + 1] = view[1] * x + view[5] * y + view[9] * z + view[13];
      spheres[s + 2] = view[2] * x + view[6] * y + view[10] * z + view[14];
      spheres[s + 3] = radius;
      if (sphereStride > 1) {
        // Ranks the lights competing for a crowded cluster; same measure as prioritize().
        spheres[s + 4] = lightBrightness(light);
      }
      lights.set(dirCutoff, offset + 4);
      // Only the intensity carries the camera pre-exposure; the color stays as authored. The
      // light's own cached vector must not be mutated because it is shared across cameras.
      lights[offset + 8] = colorIntensity.x;
      lights[offset + 9] = colorIntensity.y;
      lights[offset + 10] = colorIntensity.z;
      lights[offset + 11] = colorIntensity.w * preExposure;
      lights.set(light.extraParams, offset + 12);
    };
    // When the screen-space shadow mask is active, shadow-casting lights occupy
    // the head of the buffer (slots 1..N) in the exact order of
    // renderQueue.shadowedLights. The mask pass must assign layers/channels from
    // the SAME list in the SAME order so that a light's buffer index maps to its
    // mask slot without storing a per-light index. Keep these two in lockstep.
    let numShadow = 0;
    let slot = 0;
    if (useShadowMask) {
      numShadow = Math.min(
        renderQueue.shadowedLights.length,
        MAX_SHADOW_MASK_LIGHTS,
        ShaderHelper.getMaxClusterLights()
      );
      for (let i = 1; i <= numShadow; i++) {
        writeLight(renderQueue.shadowedLights[i - 1], i);
      }
      slot = numShadow;
    }
    // Everything without a mask slot fills the region after the mask-backed shadow
    // lights: the unshadowed lights, plus shadow-casting lights beyond the mask
    // capacity (MAX_SHADOW_MASK_LIGHTS). Rather than dropping the latter silently they
    // are still lit here - without a mask sample, i.e. degraded to no shadow. Both
    // compete for the remaining slots on equal terms, most important first.
    const rest = this._rest;
    rest.length = 0;
    for (const light of renderQueue.unshadowedLights) {
      rest.push(light);
    }
    const overflow = useShadowMask ? renderQueue.shadowedLights.length - numShadow : 0;
    for (let k = 0; k < overflow; k++) {
      rest.push(renderQueue.shadowedLights[numShadow + k]);
    }
    this.prioritize(rest, camera.getWorldPosition());
    const numRest = Math.min(rest.length, ShaderHelper.getMaxClusterLights() - slot);
    for (let j = 0; j < numRest; j++) {
      writeLight(rest[j], slot + j + 1);
    }
    slot += numRest;
    if (overflow > 0 && !ClusteredLight._warnedShadowMaskOverflow) {
      ClusteredLight._warnedShadowMaskOverflow = true;
      const dropped = rest.length - numRest;
      console.warn(
        `ClusteredLight: ${renderQueue.shadowedLights.length} shadow-casting lights exceed the ` +
          `screen-space shadow mask capacity (${MAX_SHADOW_MASK_LIGHTS}); ${overflow} light(s) are ` +
          `lit without shadows${dropped > 0 ? `, and the ${dropped} least important light(s) dropped` : ''}.`
      );
    }
    rest.length = 0;
    this._numShadowLights = numShadow;
    return slot;
  }
}
