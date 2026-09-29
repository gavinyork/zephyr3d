import type { Nullable, Vector3 } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';
import { MAX_GLOBAL_LIGHTS, MAX_SHADOW_MASK_LIGHTS } from '../values';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
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
 * on WebGL1, which keeps the first 8 lights of a cluster rather than the brightest) the
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
  private readonly _lights: Float32Array<ArrayBuffer>;
  /** View-space bounding sphere of each light in `_lights`, for culling. See writeLight. */
  private readonly _lightSpheres: Float32Array<ArrayBuffer>;
  /** Buffer indices of the lights shaded outside the clusters, zero-terminated. */
  private readonly _globalLights: Int32Array<ArrayBuffer>;
  private _lightIndexTexture: Nullable<Texture2D>;
  private _lightIndexFramebuffer: Nullable<FrameBuffer>;
  private _lightIndexProgram: Nullable<GPUProgram>;
  private _bindGroup: Nullable<BindGroup>;
  private _lightIndexVertexLayout: Nullable<VertexLayout>;
  /** Not released by disposing the layout, so kept to be disposed along with it. */
  private _lightIndexVertexBuffer: Nullable<StructuredBuffer>;
  private _lightIndexRenderStates: Nullable<RenderStateSet>;
  private _lightBuffer: Nullable<StructuredBuffer>;
  private _lightSphereBuffer: Nullable<StructuredBuffer>;
  private readonly _sizeParam: Vector4;
  private _countParam: Int32Array<ArrayBuffer>;
  private readonly _clusterParam: Vector4;
  /** Perspective depth slicing: split depth, first exponential slice, exponential slice count. */
  private readonly _sliceParam: Vector4;
  private _numShadowLights: number;
  private _orthographic: boolean;
  /** Scratch list of the lights competing for the slots after the mask-backed ones. */
  private readonly _rest: PunctualLight[];
  constructor() {
    this._tileCountX = 0;
    this._tileCountY = 0;
    this._tileCountZ = TILE_COUNT_Z;
    this._lights = new Float32Array(16 * (ShaderHelper.getMaxClusterLights() + 1));
    this._lightSpheres = new Float32Array(4 * getSphereStride() * (ShaderHelper.getMaxClusterLights() + 1));
    this._globalLights = new Int32Array(MAX_GLOBAL_LIGHTS);
    this._lightIndexTexture = null;
    this._lightIndexFramebuffer = null;
    this._lightIndexProgram = null;
    this._lightBuffer = null;
    this._lightSphereBuffer = null;
    this._bindGroup = null;
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
  }
  get lightBuffer() {
    return this._lightBuffer;
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
  get lightIndexTexture() {
    return this._lightIndexTexture;
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
  }
  private createRenderState(device: AbstractDevice) {
    this._lightIndexRenderStates = device.createRenderStateSet();
    this._lightIndexRenderStates.useDepthState().enableTest(false).enableWrite(false);
    this._lightIndexRenderStates.useRasterizerState().setCullMode('none');
  }
  private createProgram(device: AbstractDevice) {
    const webgl1 = device.type === 'webgl';
    const sphereStride = getSphereStride();
    this._lightIndexProgram = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = (webgl1 ? pb.vec3() : pb.vec2()).attrib('position');
        this.$outputs.value = webgl1 ? pb.vec4() : pb.uvec4();
        this.invProjMatrix = pb.mat4().uniform(0);
        this.sizeParam = pb.vec4().uniform(0);
        this.countParam = pb.ivec4().uniform(0);
        this.orthoProj = pb.int().uniform(0);
        this.sliceParam = pb.vec4().uniform(0);
        // Already in view space: transformed once per light on the CPU rather than once
        // per light in each of the clusters. See writeLight for the layout.
        this[UNIFORM_NAME_LIGHT_SPHERES] =
          pb.vec4[(ShaderHelper.getMaxClusterLights() + 1) * sphereStride]().uniformBuffer(0);
        pb.func('lineIntersectionToZPlane', [pb.vec3('a'), pb.vec3('b'), pb.float('zDistance')], function () {
          this.$l.normal = pb.vec3(0, 0, 1);
          this.$l.ab = pb.sub(this.b, this.a);
          this.$l.t = pb.div(
            pb.sub(this.zDistance, pb.dot(this.normal, this.a)),
            pb.dot(this.normal, this.ab)
          );
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
            pb.or(
              pb.equal(this.sphere.w, 0),
              pb.lessThanEqual(this.distSq, pb.mul(this.sphere.w, this.sphere.w))
            )
          );
        });
        pb.main(function () {
          if (pb.getDevice().type !== 'webgpu') {
            this.$builtins.pointSize = 1;
          }
          this.$builtins.position = pb.vec4(this.$inputs.pos.xy, 0, 1);
          if (pb.getDevice().type === 'webgpu') {
            this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, -1, 1, 1));
          }
          this.$l.tileIndex = webgl1 ? pb.int(this.$inputs.pos.z) : pb.int(this.$builtins.vertexIndex);
          this.$l.tileSize = pb.div(this.sizeParam.xy, pb.vec2(this.countParam.xy));
          this.$l.zIndex = pb.div(this.tileIndex, pb.mul(this.countParam.x, this.countParam.y));
          this.$l.yIndex = pb.div(
            pb.sub(this.tileIndex, pb.mul(this.zIndex, this.countParam.x, this.countParam.y)),
            this.countParam.x
          );
          this.$l.xIndex = pb.sub(
            this.tileIndex,
            pb.add(
              pb.mul(this.zIndex, this.countParam.x, this.countParam.y),
              pb.mul(this.yIndex, this.countParam.x)
            )
          );
          this.$l.maxPoint_sS = pb.vec4(
            pb.mul(
              pb.vec2(pb.float(pb.add(this.xIndex, 1)), pb.float(pb.add(this.yIndex, 1))),
              this.tileSize
            ),
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
            this.$l.minPointNear = this.lineIntersectionToZPlane(
              this.eyePos,
              this.minPoint_vS,
              this.tileNear
            );
            this.$l.minPointFar = this.lineIntersectionToZPlane(this.eyePos, this.minPoint_vS, this.tileFar);
            this.$l.maxPointNear = this.lineIntersectionToZPlane(
              this.eyePos,
              this.maxPoint_vS,
              this.tileNear
            );
            this.$l.maxPointFar = this.lineIntersectionToZPlane(this.eyePos, this.maxPoint_vS, this.tileFar);
            this.aabbMin = pb.min(
              pb.min(this.minPointNear, this.minPointFar),
              pb.min(this.maxPointNear, this.maxPointFar)
            );
            this.aabbMax = pb.max(
              pb.max(this.minPointNear, this.minPointFar),
              pb.max(this.maxPointNear, this.maxPointFar)
            );
          });
          this.$l.n = pb.int(0);
          if (webgl1) {
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
              this.$if(this.sphereReachesAABB(this.lightPos, this.distSq), function () {
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
              });
            });
            this.$outputs.value.r = pb.add(pb.mul(this.lightIndices[0], 256), this.lightIndices[1]);
            this.$outputs.value.g = pb.add(pb.mul(this.lightIndices[2], 256), this.lightIndices[3]);
            this.$outputs.value.b = pb.add(pb.mul(this.lightIndices[4], 256), this.lightIndices[5]);
            this.$outputs.value.a = pb.add(pb.mul(this.lightIndices[6], 256), this.lightIndices[7]);
          } else {
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
            // Half the cluster diagonal: the irradiance estimate is taken at the cluster
            // center but not closer than this, so a light inside the cluster stays finite.
            this.$l.halfDiagSq = pb.mul(
              pb.dot(pb.sub(this.aabbMax, this.aabbMin), pb.sub(this.aabbMax, this.aabbMin)),
              0.25
            );
            this.$l.center = pb.mul(pb.add(this.aabbMin, this.aabbMax), 0.5);
            this.$for(pb.uint('i'), 1, pb.uint(this.countParam.w), function () {
              this.$l.lightPos = this[UNIFORM_NAME_LIGHT_SPHERES].at(pb.mul(this.i, sphereStride));
              // Negative radius: shaded through a global slot, never through the clusters.
              this.$if(pb.lessThan(this.lightPos.w, 0), function () {
                this.$continue();
              });
              this.$l.distSq = this.aabbDistSq(this.lightPos.xyz, this.aabbMin, this.aabbMax);
              this.$if(this.sphereReachesAABB(this.lightPos, this.distSq), function () {
                // Brightness times the lit shader's range window at the nearest point of
                // the cluster, over the squared distance to its center.
                this.$l.score = pb.float(3.0e38);
                this.$if(pb.greaterThan(this.lightPos.w, 0), function () {
                  this.$l.brightness = this[UNIFORM_NAME_LIGHT_SPHERES].at(
                    pb.add(pb.mul(this.i, sphereStride), 1)
                  ).x;
                  this.$l.f = pb.clamp(
                    pb.sub(1, pb.div(this.distSq, pb.mul(this.lightPos.w, this.lightPos.w))),
                    0,
                    1
                  );
                  this.$l.toCenter = pb.sub(this.center, this.lightPos.xyz);
                  this.score = pb.div(
                    pb.mul(this.brightness, this.f, this.f),
                    pb.max(pb.dot(this.toCenter, this.toCenter), pb.max(this.halfDiagSq, 1e-6))
                  );
                });
                this.$if(pb.lessThan(this.n, 16), function () {
                  this.lightIndex.setAt(this.n, this.i);
                  this.lightScore.setAt(this.n, this.score);
                  this.n = pb.add(this.n, 1);
                })
                  .$elseif(pb.greaterThan(this.score, this.minScore), function () {
                    this.lightIndex.setAt(this.minSlot, this.i);
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
            });
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
            this.$outputs.value = pb.uvec4(this.r, this.g, this.b, this.a);
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
    this._lightIndexProgram.name = '@ClusteredLight_Index';
    this._bindGroup = device.createBindGroup(this._lightIndexProgram.bindGroupLayouts[0]);
    this._lightSphereBuffer?.dispose();
    const sphereBufferType = this._lightIndexProgram.getBindingInfo(UNIFORM_NAME_LIGHT_SPHERES)!.type;
    this._lightSphereBuffer = device.createStructuredBuffer(sphereBufferType as PBStructTypeInfo, {
      usage: 'uniform'
    });
  }
  /** Creates the light buffer read by the lit shaders, laid out as ShaderHelper declares it. */
  private createLightBuffer(device: AbstractDevice) {
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
    const numLights = this.getVisibleLights(
      camera,
      renderQueue,
      this._lights,
      screenSpaceShadowMask,
      preExposure
    );
    const device = getDevice();
    this.resizeGrid(width, height);
    if (!this._lightIndexTexture) {
      this.createLightIndexTexture(device);
    }
    if (!this._lightIndexProgram) {
      this.createProgram(device);
    }
    if (!this._lightBuffer) {
      this.createLightBuffer(device);
    }
    if (!this._lightIndexVertexLayout) {
      this.createVertexLayout(device, this._lightIndexTexture!.width, this._lightIndexTexture!.height);
    }
    if (!this._lightIndexRenderStates) {
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
    device.pushDeviceStates();
    device.setFramebuffer(this._lightIndexFramebuffer);
    // setFramebuffer may no-op, so reset viewport and scissor explicitly.
    device.setViewport(null);
    device.setScissor(null);
    if (numLights > 0) {
      if (this._lightBuffer!.disposed) {
        this._lightBuffer!.reload();
      }
      if (this._lightSphereBuffer!.disposed) {
        this._lightSphereBuffer!.reload();
      }
      // Slot 0 is never read, so upload only up to the last light.
      this._lightBuffer!.bufferSubData(0, this._lights, 0, (numLights + 1) * 16);
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
      device.setVertexLayout(this._lightIndexVertexLayout);
      device.setBindGroup(0, this._bindGroup!);
      const savedRS = device.getRenderStates();
      device.setRenderStates(this._lightIndexRenderStates);
      device.draw('point-list', 0, this._tileCountX * this._tileCountY * this._tileCountZ);
      device.setRenderStates(savedRS);
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
   * `luminance * range^2 / (range^2 + d^2)`, with `d` the camera's distance to the
   * light's sphere of influence: 0 from anywhere inside it, falling off with distance
   * beyond it, and larger for lights that reach further. Directional lights have no
   * range and light everything, so they always rank first.
   */
  private prioritize(lights: PunctualLight[], eye: Vector3) {
    if (lights.length < 2) {
      return;
    }
    const candidates = lights.map((light) => {
      const posRange = light.positionAndRange;
      const range = posRange.w;
      let score: number;
      if (light.isDirectionLight() || range <= 0) {
        score = Infinity;
      } else {
        const color = light.diffuseAndIntensity;
        const dx = posRange.x - eye.x;
        const dy = posRange.y - eye.y;
        const dz = posRange.z - eye.z;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - range, 0);
        const range2 = range * range;
        score = (Math.max(color.x, color.y, color.z) * color.w * range2) / (range2 + d * d);
      }
      return { light, score };
    });
    // Stable, so equally important lights keep their traversal order frame to frame.
    // Compared rather than subtracted: two directional lights would give Infinity - Infinity.
    candidates.sort((a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0));
    for (let i = 0; i < lights.length; i++) {
      lights[i] = candidates[i].light;
    }
  }
  private getVisibleLights(
    camera: Camera,
    renderQueue: RenderQueue,
    lights: Float32Array,
    useShadowMask: boolean,
    preExposure: number
  ) {
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
      let x = posRange.x;
      let y = posRange.y;
      let z = posRange.z;
      let radius = posRange.w;
      if (radius <= 0) {
        if (numGlobal < MAX_GLOBAL_LIGHTS) {
          globalLights[numGlobal++] = slot;
          radius = -1;
        } else {
          radius = 0;
        }
      } else if (light.isSpotLight()) {
        // Smallest sphere around the cone sector the spot lights (the cone clipped by
        // its range sphere): for a half-angle up to 45 degrees it passes through the
        // apex and the rim, beyond that it is centered on the rim's plane.
        const cosAngle = Math.min(dirCutoff.w, 1);
        if (cosAngle > 0) {
          const len = Math.hypot(dirCutoff.x, dirCutoff.y, dirCutoff.z) || 1;
          let dist: number;
          if (cosAngle >= Math.SQRT1_2) {
            dist = radius / (2 * cosAngle);
            radius = dist;
          } else {
            dist = radius * cosAngle;
            radius = radius * Math.sqrt(1 - cosAngle * cosAngle);
          }
          x += (dirCutoff.x / len) * dist;
          y += (dirCutoff.y / len) * dist;
          z += (dirCutoff.z / len) * dist;
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
        spheres[s + 4] = Math.max(colorIntensity.x, colorIntensity.y, colorIntensity.z) * colorIntensity.w;
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
