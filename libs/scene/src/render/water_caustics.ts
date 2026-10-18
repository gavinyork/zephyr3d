import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, REVERSE_Z, Vector3, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  IndexBuffer,
  PBGlobalScope,
  PBRenderOptions,
  ProgramBuilder,
  RenderStateSet,
  Texture2D,
  Texture2DArray,
  TextureFormat,
  VertexLayout
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import type { WaveGenerator } from './wavegenerator';
import type { Water } from '../scene/water';
import type { PunctualLight } from '../scene/light';
import type { Camera } from '../camera/camera';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { CAUSTIC_HEIGHT_BIAS, MAX_CAUSTIC_WATERS, ShaderHelper } from '../material/shader/helper';
import { warnUnsupported } from '../utility/unsupported';

/** Index of refraction of water relative to air. */
const WATER_IOR = 1.333;
/** Air-to-water eta used when refracting the sun ray at the surface. */
const WATER_ETA = 1 / WATER_IOR;
/**
 * Minimum |sin(sun elevation)| for caustics to be generated; below it the
 * photon sweep degenerates and the pass switches off.
 */
const MIN_SUN_ELEVATION = 0.15;
/**
 * Fixed-point steps taken to land a photon on the scene rather than on the
 * focal plane. Two suffice for a flat receiver; the third covers a steep slope.
 */
const SCENE_DEPTH_ITERATIONS = 3;
/**
 * Photons per covered map texel the automatic grid size solves for. Four lands
 * within about 4% of a converged (16x denser) map.
 */
const PHOTONS_PER_TEXEL = 4;
/** Automatic edge fade width, as a fraction of the map half-extent. */
const AUTO_FADE_FRACTION = 0.2;
/** Floor in meters under the automatic fade width. */
const AUTO_FADE_MIN_DISTANCE = 3;
/** Bounds on the share of the map half-extent the fade may consume. */
const MIN_FADE_FRACTION = 0.001;
const MAX_FADE_FRACTION = 0.9;
/**
 * Largest ratio between the fitted slice's two half-extents. The map is square,
 * so an anisotropic slice resolves the pattern at different frequencies along
 * each axis.
 */
const MAX_SLICE_ASPECT = 2;
/**
 * Steps per octave the fitted half-extents are quantised to. Four costs at most
 * 19% of linear resolution and keeps a level change from reading as a pop.
 */
const SLICE_QUANTISE_STEPS = 4;
/** Smallest half-extent in meters a fitted slice may shrink to. */
const MIN_SLICE_EXTENT = 0.5;
/**
 * Divisions of the half-extent the slice centre snaps to under a warp. A warped
 * map must be resampled whenever the centre moves, so it snaps coarsely.
 */
const WARPED_CENTER_SNAP_DIVISIONS = 8;
/**
 * How far past the map border the photon grid is laid out, as a fraction of the
 * half-extent, on the sides where the range - not the water - is what bounds it.
 *
 * Horizontal displacement carries photons across the border both ways, so
 * launching from a margin outside keeps the border density consistent.
 * `_gridFraction` accounts for the larger launch area, so density per texel is
 * unchanged.
 */
const GRID_BORDER_MARGIN = 0.15;

/**
 * Concentrates a map coordinate towards the centre. CPU twin of
 * `ShaderHelper.warpCausticNDC`.
 *
 * @internal
 */
function warpCausticNDC(ndc: number, strength: number): number {
  return (ndc * (1 + strength)) / (1 + strength * Math.abs(ndc));
}

/**
 * Rounds a fitted half-extent up onto a discrete ladder below `range`.
 *
 * The ladder is geometric and anchored at `range`, so water that fills the range
 * lands exactly on a level.
 *
 * @internal
 */
function quantiseSliceExtent(half: number, range: number): number {
  if (!(half > 0) || half >= range) {
    return range;
  }
  const steps = Math.floor(Math.log2(range / half) * SLICE_QUANTISE_STEPS);
  return range / Math.pow(2, steps / SLICE_QUANTISE_STEPS);
}

/**
 * CPU-side parameters describing the caustic map, uploaded to the light pass.
 *
 * The map is a single orthographic slice of light space, fitted to the water
 * within range of the camera. `frameX`/`frameY` are the two axes perpendicular
 * to the light direction, carrying the reciprocal of the slice's half-extent
 * along each, so a world position projects into the map with two dot products
 * and no matrix.
 *
 * @public
 */
export interface WaterCausticUniforms {
  /** (right.xyz, 1 / half-extent along right) */
  frameX: Vector4;
  /** (up.xyz, 1 / half-extent along up) */
  frameY: Vector4;
  /** (center.xyz, water surface level) */
  center: Vector4;
  /** (lightDir.xyz, 1 / max(-lightDir.y, MIN_SUN_ELEVATION)) */
  lightDir: Vector4;
  /** (intensity, focal depth, defocus rate, edge fade start in map-radius units) */
  params: Vector4;
  /** (minimum water depth, unused.yz, warp strength). The medium is in {@link waterMedia}. */
  extinction: Vector4;
  /** Water bodies contributing to this map, at most {@link MAX_CAUSTIC_WATERS}. */
  waterCount: number;
  /** Per body, world XZ footprint: (minX, minZ, maxX, maxZ). */
  waterRegions: Float32Array<ArrayBuffer>;
  /** Per body, (sigma_t.xyz, surface height). */
  waterMedia: Float32Array<ArrayBuffer>;
}

/** Shadow cascade reused as a light-space depth map of the scene. @internal */
type SceneDepthBinding = {
  texture: Texture2DArray;
  layer: number;
  size: number;
  matrix: Matrix4x4;
  matrixInv: Matrix4x4;
};

/**
 * Vertices per side of the grid the height map rasterises the surface with, laid
 * out in warped map space over the body's footprint.
 */
const HEIGHT_GRID_SIZE = 256;

/** @internal */
type SplatProgramInfo = {
  program: GPUProgram;
  /** One per water slot; see _getSplatBindGroup. */
  bindGroups: BindGroup[];
};

/**
 * Shader for the photon splat pass.
 *
 * One vertex is one photon, emitted where it lands; the fragment stage deposits
 * the weight, which additive blending accumulates.
 *
 * Returned as a descriptor so it can be compiled against a bare
 * {@link ProgramBuilder} in tests, without a device.
 *
 * @param waveGenerator - Supplies the surface displacement and normal.
 * @internal
 */
export function createCausticSplatShader(waveGenerator: WaveGenerator, sceneDepth: boolean): PBRenderOptions {
  const setupUniforms = (scope: PBGlobalScope) => {
    const pb = scope.$builder;
    scope.causticFrameX = pb.vec4().uniform(0);
    scope.causticFrameY = pb.vec4().uniform(0);
    scope.causticCenter = pb.vec4().uniform(0);
    scope.causticLightDir = pb.vec4().uniform(0);
    scope.causticRegion = pb.vec4().uniform(0);
    /** Map-NDC rectangle the photon grid is laid out over: (minX, minY, maxX, maxY). */
    scope.causticGridBounds = pb.vec4().uniform(0);
    scope.causticSplatParams = pb.vec4().uniform(0);
    /** (grid size, 1 / grid size, 0, 0) */
    scope.causticPhotonParams = pb.vec4().uniform(0);
    if (sceneDepth) {
      // The sun's shadow cascade, reused as an orthographic light-space depth map.
      scope.causticSceneMatrix = pb.mat4().uniform(0);
      scope.causticSceneMatrixInv = pb.mat4().uniform(0);
      /** (cascade layer, 0, 0, 0) */
      scope.causticSceneParams = pb.vec4().uniform(0);
      // Read for its stored depth, not compared.
      scope.causticSceneDepth = pb.tex2DArrayShadow().uniform(0);
    }
    // Wave generators animate from camera.elapsedTime, which this standalone
    // pass supplies itself.
    ShaderHelper.declareStandaloneCameraTime(scope, 0);
    waveGenerator.setupUniforms(scope, 0);
  };
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      // Photon ordinal; the grid coordinate is derived from it, so the buffer
      // serves any grid size.
      this.$inputs.photonIndex = pb.float().attrib('position');
      this.$outputs.photonWeight = pb.float();
      setupUniforms(this);
      pb.main(function () {
        // Per-axis: the slice's two half-extents are independent.
        this.$l.invRadius = pb.vec2(this.causticFrameX.w, this.causticFrameY.w);
        this.$l.radius = pb.div(pb.vec2(1), this.invRadius);
        this.$l.focalDepth = this.causticSplatParams.y;
        this.$l.eta = this.causticSplatParams.z;
        this.$l.L = this.causticLightDir.xyz;
        this.$l.waterLevel = this.causticCenter.w;
        // Grid position on the orthographic slice through the map centre. The
        // grid spans only the part of the slice the water casts through, and is
        // uniform in warped map space so calm water keeps photon (i,j) on texel
        // (i,j) and the map normalised to 1.0.
        //
        // Ordinal to grid coordinate: row is the quotient, column the remainder.
        this.$l.gridSize = this.causticPhotonParams.x;
        this.$l.invGrid = this.causticPhotonParams.y;
        this.$l.photonRow = pb.floor(pb.mul(this.$inputs.photonIndex, this.invGrid));
        this.$l.photonCol = pb.sub(this.$inputs.photonIndex, pb.mul(this.photonRow, this.gridSize));
        this.$l.photonUV = pb.mul(
          pb.add(pb.vec2(this.photonCol, this.photonRow), pb.vec2(0.5)),
          this.invGrid
        );
        this.$l.warpedNDC = pb.mix(this.causticGridBounds.xy, this.causticGridBounds.zw, this.photonUV);
        this.$l.ndc = ShaderHelper.unwarpCausticNDC(this, this.warpedNDC, this.causticSplatParams.x);
        this.$l.planePos = pb.add(
          this.causticCenter.xyz,
          pb.mul(this.causticFrameX.xyz, pb.mul(this.ndc.x, this.radius.x)),
          pb.mul(this.causticFrameY.xyz, pb.mul(this.ndc.y, this.radius.y))
        );
        // Sweep along the light direction onto the undisturbed water plane.
        this.$l.sweep = pb.div(pb.sub(this.waterLevel, this.planePos.y), this.L.y);
        this.$l.surfaceXZ = pb.add(this.planePos, pb.mul(this.L, this.sweep));
        this.$l.outside = pb.or(
          pb.any(pb.lessThan(this.surfaceXZ.xz, this.causticRegion.xy)),
          pb.any(pb.greaterThan(this.surfaceXZ.xz, this.causticRegion.zw))
        );
        // Displaced surface point and the detail normal that bends the ray. The
        // wave generators sample with an explicit LOD, legal in a vertex shader.
        //
        // Launching from the rest point over-weights compressed crests by 1/J;
        // inverting the displacement does not converge where the surface folds.
        this.$l.surfacePos = pb.vec3();
        this.$l.coarseNormal = pb.vec3();
        waveGenerator.calcVertexPositionAndNormal(this, this.surfaceXZ, this.surfacePos, this.coarseNormal);
        this.$l.normal = waveGenerator.calcFragmentNormal(this, this.surfaceXZ.xz, this.coarseNormal);
        // Refract, then subtract the deflection a flat surface would have
        // produced. Calm water then leaves the ray parallel to L, which lands
        // photon (i,j) back on texel (i,j) and normalises the map to 1.
        this.$l.refracted = pb.refract(this.L, this.normal, this.eta);
        this.$l.refractedFlat = pb.refract(this.L, pb.vec3(0, 1, 0), this.eta);
        this.$l.dir = pb.normalize(pb.add(pb.sub(this.refracted, this.refractedFlat), this.L));
        // Intersect the horizontal focal plane below the surface; clamped so a
        // grazing ray cannot produce an enormous or negative step.
        this.$l.invDirY = pb.min(this.dir.y, -1e-4);
        this.$l.targetY = pb.sub(this.waterLevel, this.focalDepth);
        this.$l.hitT = pb.div(pb.sub(this.targetY, this.surfacePos.y), this.invDirY);
        this.$l.hitPos = pb.add(this.surfacePos, pb.mul(this.dir, pb.max(this.hitT, 0)));
        if (sceneDepth) {
          // Land the photon on the scene by fixed-point iteration: read the scene
          // height under the current guess, re-intersect the ray with a
          // horizontal plane at that height, repeat. One fetch per step; at a
          // silhouette it lands on one of the two surfaces rather than diverging.
          this.$l.probe = this.hitPos;
          this.$l.layer = pb.int(this.causticSceneParams.x);
          for (let i = 0; i < SCENE_DEPTH_ITERATIONS; i++) {
            this.$l[`clip${i}`] = pb.mul(this.causticSceneMatrix, pb.vec4(this.probe, 1));
            this.$l[`ndc${i}`] = pb.div(this[`clip${i}`].xyz, this[`clip${i}`].w);
            this.$l[`uv${i}`] = pb.add(pb.mul(this[`ndc${i}`].xy, 0.5), pb.vec2(0.5));
            // Outside the cascade, keep the previous step's result.
            this.$l[`inside${i}`] = pb.and(
              pb.all(pb.greaterThanEqual(this[`uv${i}`], pb.vec2(0))),
              pb.all(pb.lessThanEqual(this[`uv${i}`], pb.vec2(1)))
            );
            // texelFetch, since filtered depths across a silhouette are wrong.
            // WebGPU only - GLSL ES 3.0 forbids texelFetch on a shadow-sampler
            // texture, which gates this whole path.
            this.$l[`depth${i}`] = pb.textureArrayLoad(
              this.causticSceneDepth,
              pb.ivec2(pb.mul(this[`uv${i}`], this.causticSceneParams.y)),
              this.layer,
              pb.int(0)
            );
            // Back to a world position through the orthographic cascade.
            this.$l[`sceneNDC${i}`] = pb.vec3(
              this[`ndc${i}`].xy,
              REVERSE_Z ? this[`depth${i}`] : pb.sub(pb.mul(this[`depth${i}`], 2), 1)
            );
            this.$l[`sceneClip${i}`] = pb.mul(this.causticSceneMatrixInv, pb.vec4(this[`sceneNDC${i}`], 1));
            this.$l[`scenePos${i}`] = pb.div(this[`sceneClip${i}`].xyz, this[`sceneClip${i}`].w);
            // Re-intersect at the height just read, accepted only below the
            // *displaced* surface at this photon's entry (not the rest level).
            this.$l[`t${i}`] = pb.div(pb.sub(this[`scenePos${i}`].y, this.surfacePos.y), this.invDirY);
            this.$l[`next${i}`] = pb.add(this.surfacePos, pb.mul(this.dir, pb.max(this[`t${i}`], 0)));
            // mix rather than select: the builder has no vec3 select.
            this.probe = pb.mix(
              this.probe,
              this[`next${i}`],
              pb.float(pb.and(this[`inside${i}`], pb.lessThan(this[`scenePos${i}`].y, this.surfacePos.y)))
            );
          }
          this.hitPos = this.probe;
        }
        // Project the hit back into the map. frameX/frameY are perpendicular to
        // L and to each other, so this is just two dot products.
        this.$l.rel = pb.sub(this.hitPos, this.causticCenter.xyz);
        this.$l.hitNDC = pb.mul(
          pb.vec2(pb.dot(this.rel, this.causticFrameX.xyz), pb.dot(this.rel, this.causticFrameY.xyz)),
          this.invRadius
        );
        // Into warped space, where the map's texels live.
        this.$l.hitWarped = ShaderHelper.warpCausticNDC(this, this.hitNDC, this.causticSplatParams.x);
        this.$outputs.photonWeight = this.causticSplatParams.w;
        // No per-backend y flip here; the blur and resolve quads account for it.
        this.$builtins.position = pb.vec4(this.hitWarped, 0, 1);
        if (pb.getDevice().type !== 'webgpu') {
          // GLSL rasterises nothing unless gl_PointSize is written; WebGPU points
          // are always one pixel.
          this.$builtins.pointSize = 1;
        }
        this.$if(this.outside, function () {
          // Park the photon outside the clip volume; w stays 1 to avoid NaN.
          this.$builtins.position = pb.vec4(-2, -2, 0, 1);
        });
      });
    },
    fragment(this: PBGlobalScope, pb: ProgramBuilder) {
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$outputs.outColor = pb.vec4(this.$inputs.photonWeight, 0, 0, 1);
      });
    }
  };
}

/**
 * Shader for the displaced surface height map.
 *
 * Rasterises the water surface into the light-space slice, one body per draw. A
 * grid over the body's footprint in warped map space is swept along the light
 * onto the rest plane, displaced by the wave generator, and projected back into
 * the map. The fragment writes its height above the rest plane, offset by
 * `CAUSTIC_HEIGHT_BIAS`, into this body's channel via a colour write mask (last
 * triangle wins). A texel the surface never reaches stays zero, which the
 * receiver reads as "no water on this ray".
 *
 * Rasterising handles horizontal displacement without inverting it, and keeps
 * the footprint edge exact. The receiver looks this up with the same uv as the
 * caustic pattern, since the projection is invariant along the light.
 *
 * @param waveGenerator - Supplies the surface displacement of this body.
 * @internal
 */
export function createCausticHeightShader(waveGenerator: WaveGenerator): PBRenderOptions {
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      // Vertex ordinal; the grid coordinate is derived from it.
      this.$inputs.vertexIndex = pb.float().attrib('position');
      this.$outputs.height = pb.float();
      this.$outputs.inside = pb.float();
      this.causticFrameX = pb.vec4().uniform(0);
      this.causticFrameY = pb.vec4().uniform(0);
      /** (slice centre.xyz, this body's rest level) */
      this.causticCenter = pb.vec4().uniform(0);
      this.causticLightDir = pb.vec4().uniform(0);
      this.causticRegion = pb.vec4().uniform(0);
      /** Map-NDC rectangle the grid is laid out over: (minX, minY, maxX, maxY). */
      this.causticGridBounds = pb.vec4().uniform(0);
      /** (warp strength, grid size, 1 / (grid size + 1), 1 / grid size) */
      this.causticHeightParams = pb.vec4().uniform(0);
      ShaderHelper.declareStandaloneCameraTime(this, 0);
      waveGenerator.setupUniforms(this, 0);
      pb.main(function () {
        this.$l.invRadius = pb.vec2(this.causticFrameX.w, this.causticFrameY.w);
        this.$l.radius = pb.div(pb.vec2(1), this.invRadius);
        this.$l.L = this.causticLightDir.xyz;
        this.$l.waterLevel = this.causticCenter.w;
        // Ordinal to grid coordinate, (gridSize + 1) vertices per side. The +0.5
        // keeps the inexact reciprocal from rounding into the previous row.
        this.$l.row = pb.floor(pb.mul(pb.add(this.$inputs.vertexIndex, 0.5), this.causticHeightParams.z));
        this.$l.col = pb.sub(
          this.$inputs.vertexIndex,
          pb.mul(this.row, pb.add(this.causticHeightParams.y, 1))
        );
        this.$l.gridUV = pb.mul(pb.vec2(this.col, this.row), this.causticHeightParams.w);
        // Grid point to the slice, through the warp the map's texels live under.
        this.$l.warpedNDC = pb.mix(this.causticGridBounds.xy, this.causticGridBounds.zw, this.gridUV);
        this.$l.ndc = ShaderHelper.unwarpCausticNDC(this, this.warpedNDC, this.causticHeightParams.x);
        this.$l.planePos = pb.add(
          this.causticCenter.xyz,
          pb.mul(this.causticFrameX.xyz, pb.mul(this.ndc.x, this.radius.x)),
          pb.mul(this.causticFrameY.xyz, pb.mul(this.ndc.y, this.radius.y))
        );
        // Along the light onto the rest plane: the rest point of this vertex.
        this.$l.sweep = pb.div(pb.sub(this.waterLevel, this.planePos.y), this.L.y);
        this.$l.surfaceXZ = pb.add(this.planePos, pb.mul(this.L, this.sweep));
        // Footprint test, interpolated so the edge fades over one grid cell.
        this.$outputs.inside = pb.float(
          pb.and(
            pb.all(pb.greaterThanEqual(this.surfaceXZ.xz, this.causticRegion.xy)),
            pb.all(pb.lessThanEqual(this.surfaceXZ.xz, this.causticRegion.zw))
          )
        );
        // Where the surface carried this rest point, and how high it is there.
        this.$l.surfacePos = pb.vec3();
        this.$l.surfaceNormal = pb.vec3();
        waveGenerator.calcVertexPositionAndNormal(this, this.surfaceXZ, this.surfacePos, this.surfaceNormal);
        this.$outputs.height = pb.sub(this.surfacePos.y, this.waterLevel);
        // The displaced point back into the map, as the splat projects a hit.
        this.$l.rel = pb.sub(this.surfacePos, this.causticCenter.xyz);
        this.$l.hitNDC = pb.mul(
          pb.vec2(pb.dot(this.rel, this.causticFrameX.xyz), pb.dot(this.rel, this.causticFrameY.xyz)),
          this.invRadius
        );
        this.$l.hitWarped = ShaderHelper.warpCausticNDC(this, this.hitNDC, this.causticHeightParams.x);
        // The receiver reads the map at `v = 0.5 + 0.5 * ndc.y`. On WebGPU clip
        // +1 is the first row, so the surface is drawn flipped. The splat needs
        // no flip because its map passes through the blur and resolve quads.
        this.$builtins.position =
          pb.getDevice().type === 'webgpu'
            ? pb.vec4(this.hitWarped.x, pb.neg(this.hitWarped.y), 0, 1)
            : pb.vec4(this.hitWarped, 0, 1);
      });
    },
    fragment(this: PBGlobalScope, pb: ProgramBuilder) {
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        // Outside the footprint nothing is written, so the texel reads "no surface".
        this.$if(pb.lessThan(this.$inputs.inside, 0.5), function () {
          pb.discard();
        });
        // Every channel; the colour mask keeps all but this body's.
        this.$outputs.outColor = pb.vec4(pb.add(this.$inputs.height, CAUSTIC_HEIGHT_BIAS));
      });
    }
  };
}

/**
 * Shader for the caustic map blur.
 *
 * Four bilinear taps at the texel corners average a 2x2 neighbourhood; weights
 * sum to one, preserving the "calm water reads 1.0" normalisation.
 *
 * @internal
 */
export function createCausticBlurShader(): PBRenderOptions {
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos, 0.5), pb.vec2(0.5));
      });
    },
    fragment(this: PBGlobalScope, pb: ProgramBuilder) {
      this.causticSrc = pb.tex2D().uniform(0);
      this.causticTexelSize = pb.vec4().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$l.o = pb.mul(this.causticTexelSize.xy, 0.5);
        this.$l.sum = pb.add(
          pb.textureSampleLevel(this.causticSrc, pb.add(this.$inputs.uv, pb.vec2(this.o.x, this.o.y)), 0),
          pb.textureSampleLevel(
            this.causticSrc,
            pb.add(this.$inputs.uv, pb.vec2(pb.neg(this.o.x), this.o.y)),
            0
          ),
          pb.textureSampleLevel(
            this.causticSrc,
            pb.add(this.$inputs.uv, pb.vec2(this.o.x, pb.neg(this.o.y))),
            0
          ),
          pb.textureSampleLevel(
            this.causticSrc,
            pb.add(this.$inputs.uv, pb.vec2(pb.neg(this.o.x), pb.neg(this.o.y))),
            0
          )
        );
        this.$outputs.outColor = pb.vec4(pb.mul(this.sum.x, 0.25), 0, 0, 1);
      });
    }
  };
}

/**
 * Shader for the temporal resolve.
 *
 * Reprojection is exact and matrix-free: both frames are orthographic slices
 * perpendicular to the light, so a texel maps to the world with two scaled axes
 * and into the previous frame with two dot products.
 *
 * Map NDC relates to texture coordinate by the receiver's `ndc * 0.5 + 0.5`
 * (see `ShaderHelper.calculateWaterCaustic`).
 *
 * @internal
 */
export function createCausticResolveShader(): PBRenderOptions {
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos, 0.5), pb.vec2(0.5));
      });
    },
    fragment(this: PBGlobalScope, pb: ProgramBuilder) {
      this.causticCurrent = pb.tex2D().uniform(0);
      this.causticHistory = pb.tex2D().uniform(0);
      this.causticFrameX = pb.vec4().uniform(0);
      this.causticFrameY = pb.vec4().uniform(0);
      this.causticCenter = pb.vec4().uniform(0);
      this.causticPrevFrameX = pb.vec4().uniform(0);
      this.causticPrevFrameY = pb.vec4().uniform(0);
      this.causticPrevCenter = pb.vec4().uniform(0);
      /** (blend weight, texel size, warp, previous frame's warp) */
      this.causticResolveParams = pb.vec4().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$l.texel = this.causticResolveParams.y;
        this.$l.current = pb.textureSampleLevel(this.causticCurrent, this.$inputs.uv, 0).x;
        // Neighbourhood range of the current frame; history is clamped into it
        // so a long blend can follow an animated pattern.
        this.$l.mn = this.current;
        this.$l.mx = this.current;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            this.$l.s = pb.textureSampleLevel(
              this.causticCurrent,
              pb.add(this.$inputs.uv, pb.mul(pb.vec2(dx, dy), this.texel)),
              0
            ).x;
            this.mn = pb.min(this.mn, this.s);
            this.mx = pb.max(this.mx, this.s);
          }
        }
        // This texel's world point, then its place in the previous frame; the
        // frames may differ in slice and warp strength.
        this.$l.warpedNDC = pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1));
        this.$l.ndc = ShaderHelper.unwarpCausticNDC(this, this.warpedNDC, this.causticResolveParams.z);
        this.$l.radius = pb.div(pb.vec2(1), pb.vec2(this.causticFrameX.w, this.causticFrameY.w));
        this.$l.world = pb.add(
          this.causticCenter.xyz,
          pb.mul(this.causticFrameX.xyz, pb.mul(this.ndc.x, this.radius.x)),
          pb.mul(this.causticFrameY.xyz, pb.mul(this.ndc.y, this.radius.y))
        );
        this.$l.rel = pb.sub(this.world, this.causticPrevCenter.xyz);
        this.$l.prevNDC = pb.mul(
          pb.vec2(pb.dot(this.rel, this.causticPrevFrameX.xyz), pb.dot(this.rel, this.causticPrevFrameY.xyz)),
          pb.vec2(this.causticPrevFrameX.w, this.causticPrevFrameY.w)
        );
        this.$l.prevWarped = ShaderHelper.warpCausticNDC(this, this.prevNDC, this.causticResolveParams.w);
        this.$l.prevUV = pb.add(pb.mul(this.prevWarped, 0.5), pb.vec2(0.5));
        // Ground the camera has just scrolled into has no history at all.
        this.$l.inside = pb.and(
          pb.all(pb.greaterThanEqual(this.prevUV, pb.vec2(0))),
          pb.all(pb.lessThanEqual(this.prevUV, pb.vec2(1)))
        );
        this.$l.history = pb.textureSampleLevel(this.causticHistory, this.prevUV, 0).x;
        this.$l.blend = pb.mul(this.causticResolveParams.x, pb.float(this.inside));
        this.$outputs.outColor = pb.vec4(
          pb.mix(this.current, pb.clamp(this.history, this.mn, this.mx), this.blend),
          0,
          0,
          1
        );
      });
    }
  };
}

/**
 * Renders the water caustic map.
 *
 * One photon is emitted per texel of a uniform grid laid out on the same
 * orthographic light-space slice the map covers. Each photon is refracted at the
 * water surface, intersected with the scene (or a horizontal focal plane) below
 * it, and splatted additively at the hit position. With the flat-surface
 * deflection removed, calm water maps photon `(i,j)` onto texel `(i,j)` and the
 * map converges to a uniform 1.0 - which the receiver treats as "no caustics".
 *
 * @internal
 */
export class WaterCausticsRenderer {
  /** Splat programs keyed by the wave generator's shader hash. */
  private readonly _splatPrograms: Map<string, SplatProgramInfo>;
  /** Height-map programs keyed by the wave generator's shader hash. */
  private readonly _heightPrograms: Map<string, SplatProgramInfo>;
  /** One per water slot, differing only in which channel they let through. */
  private readonly _heightStates: Nullable<RenderStateSet>[];
  private readonly _heightParams: Vector4;
  /** The surface grid the height map is rasterised with; built once. */
  private _heightLayout: Nullable<VertexLayout>;
  private _heightVertexBuffer: Nullable<GPUDataBuffer>;
  private _heightIndexBuffer: Nullable<IndexBuffer>;
  private _heightIndexCount: number;
  private _blurProgram: Nullable<GPUProgram>;
  private _blurBindGroup: Nullable<BindGroup>;
  private _resolveProgram: Nullable<GPUProgram>;
  private _resolveBindGroup: Nullable<BindGroup>;
  private _resolveStates: Nullable<RenderStateSet>;
  /** Slice parameters of the last map committed as history, per camera. */
  private readonly _prevSlices: WeakMap<
    Camera,
    { frameX: Vector4; frameY: Vector4; center: Vector4; warp: number }
  >;
  private readonly _resolveParams: Vector4;
  private _photonLayout: Nullable<VertexLayout>;
  /** Photons the buffer can serve; it grows and is never rebuilt smaller. */
  private _photonCapacity: number;
  private _photonBuffer: Nullable<GPUDataBuffer>;
  private readonly _photonParams: Vector4;
  private _photonCount: number;
  private _splatStates: Nullable<RenderStateSet>;
  private _blurStates: Nullable<RenderStateSet>;
  private readonly _uniforms: WaterCausticUniforms;
  private readonly _tmpRight: Vector3;
  private readonly _tmpUp: Vector3;
  private readonly _tmpDir: Vector3;
  private readonly _tmpCenter: Vector3;
  private readonly _splatParams: Vector4;
  private readonly _blurTexelSize: Vector4;
  /** Map-NDC rectangle the photon grid covers, and the map fraction it is. */
  private readonly _gridBounds: Vector4;
  private _gridFraction: number;
  /** Furthest the fitted slice reaches from the camera, for cascade selection. */
  private _sliceReach: number;
  /** Slice frame and extents, kept for the per-body grid fit. */
  private _sliceRight: Vector3;
  private _sliceUp: Vector3;
  private _sliceCenterR: number;
  private _sliceCenterU: number;
  private _sliceHalfR: number;
  private _sliceHalfU: number;
  private readonly _splatCenter: Vector4;
  private readonly _sceneMatrixT: Matrix4x4;
  private readonly _sceneMatrix: Matrix4x4;
  private readonly _sceneMatrixInv: Matrix4x4;
  private readonly _sceneDepthParams: Vector4;
  /** Warp strength the current slice was built with; 0 when the map is linear. */
  private _warp: number;
  constructor() {
    this._splatPrograms = new Map();
    this._heightPrograms = new Map();
    this._heightStates = [];
    this._heightParams = new Vector4();
    this._heightLayout = null;
    this._heightVertexBuffer = null;
    this._heightIndexBuffer = null;
    this._heightIndexCount = 0;
    this._blurProgram = null;
    this._blurBindGroup = null;
    this._resolveProgram = null;
    this._resolveBindGroup = null;
    this._resolveStates = null;
    this._prevSlices = new WeakMap();
    this._resolveParams = new Vector4();
    this._photonLayout = null;
    this._photonCapacity = 0;
    this._photonBuffer = null;
    this._photonParams = new Vector4();
    this._photonCount = 0;
    this._splatStates = null;
    this._blurStates = null;
    this._uniforms = {
      frameX: new Vector4(),
      frameY: new Vector4(),
      center: new Vector4(),
      lightDir: new Vector4(),
      params: new Vector4(),
      extinction: new Vector4(),
      waterCount: 0,
      waterRegions: new Float32Array(MAX_CAUSTIC_WATERS * 4),
      waterMedia: new Float32Array(MAX_CAUSTIC_WATERS * 4)
    };
    this._tmpRight = new Vector3();
    this._tmpUp = new Vector3();
    this._tmpDir = new Vector3();
    this._tmpCenter = new Vector3();
    this._splatParams = new Vector4();
    this._blurTexelSize = new Vector4();
    this._gridBounds = new Vector4(-1, -1, 1, 1);
    this._gridFraction = 1;
    this._sliceReach = 1;
    this._sliceRight = new Vector3();
    this._sliceUp = new Vector3();
    this._sliceCenterR = 0;
    this._sliceCenterU = 0;
    this._sliceHalfR = 1;
    this._sliceHalfU = 1;
    this._splatCenter = new Vector4();
    this._sceneMatrixT = new Matrix4x4();
    this._sceneMatrix = new Matrix4x4();
    this._sceneMatrixInv = new Matrix4x4();
    this._sceneDepthParams = new Vector4();
    this._warp = 0;
  }
  /** Parameters of the map produced by the last successful {@link render}. */
  get uniforms(): WaterCausticUniforms {
    return this._uniforms;
  }
  /**
   * Storage format for the caustic map. Single channel when the device can both
   * render to and filter it, which the additive accumulation and the bilinear
   * sampling need.
   */
  static getMapFormat(device: AbstractDevice): TextureFormat {
    const info = device.getDeviceCaps().textureCaps.getTextureFormatInfo('r16f');
    return info.renderable && info.filterable ? 'r16f' : 'rgba16f';
  }
  /**
   * Storage format for the displaced surface height map: one channel per water
   * slot.
   */
  static getHeightMapFormat(): TextureFormat {
    return 'rgba16f';
  }
  /**
   * Whether caustics can be produced for this water surface and light.
   *
   * @param water - Water surface the photons are refracted through.
   * @param light - Directional light the photons come from.
   * @returns True when {@link render} would produce a usable map.
   */
  static canRender(water: Water, light: PunctualLight): boolean {
    const material = water.material;
    if (!material?.causticsEnabled || !material.waveGenerator || !light.isDirectionLight()) {
      return false;
    }
    // Sun too close to the horizon: the swept photon grid degenerates.
    return -light.directionAndCutoff.y >= MIN_SUN_ELEVATION;
  }
  /**
   * Builds the caustic map for one water surface.
   *
   * @param ctx - Draw context; supplies the device and the camera the map is centred on.
   * @param water - Water surface to refract through.
   * @param light - Directional light acting as the photon source.
   * @param map - Accumulation target; also the result when nothing resolves after it.
   * @param scratch - Ping-pong target for the blur, and the temporal resolve's
   * output. Same size and format as `map`.
   * @param heights - Target for the displaced surface height map, in
   * {@link getHeightMapFormat} and the same size as `map`. Filled by this call
   * and read by the light pass alongside the map.
   * @param history - Previous frame's resolved map, or null when there is none
   * to reproject. Ignored unless the material asks for temporal accumulation.
   * @param createFramebuffer - Wraps a target texture into a framebuffer.
   * @returns The texture holding the finished map, which is `map` or `scratch`
   * depending on whether the temporal resolve ran.
   */
  render(
    ctx: DrawContext,
    waters: readonly Water[],
    light: PunctualLight,
    map: Texture2D,
    scratch: Texture2D,
    heights: Texture2D,
    history: Nullable<Texture2D>,
    createFramebuffer: (texture: Texture2D) => FrameBuffer
  ): Texture2D {
    const device = ctx.device;
    this._updateUniforms(ctx, waters, light, map.width);
    const sceneDepth = this._anySceneDepth(waters) ? this._resolveSceneDepth(ctx, light) : null;

    // The height map first; it depends on the slice alone.
    device.pushDeviceStates();
    device.setFramebuffer(createFramebuffer(heights));
    device.setViewport(null);
    device.setScissor(null);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    this._ensureHeightGrid(device);
    for (let i = 0; i < waters.length; i++) {
      this._renderHeightsOne(device, ctx, waters[i], i);
    }
    device.popDeviceStates();

    device.pushDeviceStates();
    device.setFramebuffer(createFramebuffer(map));
    // Viewport and scissor survive a framebuffer change; reset them.
    device.setViewport(null);
    device.setScissor(null);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.setRenderStates(this._getSplatStates(device));

    // One draw per water body, accumulating into the one shared-slice map.
    for (let i = 0; i < waters.length; i++) {
      this._splatOne(device, ctx, waters[i], i, map, sceneDepth);
    }
    device.popDeviceStates();
    return this._postProcess(device, waters[0].material, map, scratch, history, ctx, createFramebuffer);
  }
  /**
   * Writes one body's displaced surface height into its channel of the height
   * map.
   * @internal
   */
  private _renderHeightsOne(device: AbstractDevice, ctx: DrawContext, water: Water, index: number): void {
    const material = water.material;
    const waveGenerator = material.waveGenerator!;
    // The grid covers this body's footprint.
    this._updateGridBounds(water);
    if (!(this._gridFraction > 0)) {
      return;
    }
    const info = this._getHeightProgram(device, waveGenerator);
    // A bind group per slot; see _getSplatBindGroup.
    const bindGroup = this._getSplatBindGroup(device, info, index);
    bindGroup.setValue('causticFrameX', this._uniforms.frameX);
    bindGroup.setValue('causticFrameY', this._uniforms.frameY);
    this._splatCenter.setXYZW(
      this._uniforms.center.x,
      this._uniforms.center.y,
      this._uniforms.center.z,
      water.worldMatrix.m13
    );
    bindGroup.setValue('causticCenter', this._splatCenter);
    bindGroup.setValue('causticLightDir', this._uniforms.lightDir);
    bindGroup.setValue('causticRegion', material.region);
    bindGroup.setValue('causticGridBounds', this._gridBounds);
    this._heightParams.setXYZW(
      this._warp,
      HEIGHT_GRID_SIZE,
      1 / (HEIGHT_GRID_SIZE + 1),
      1 / HEIGHT_GRID_SIZE
    );
    bindGroup.setValue('causticHeightParams', this._heightParams);
    ShaderHelper.setStandaloneCameraTime(bindGroup, ctx);
    waveGenerator.applyWaterBindGroup(bindGroup);
    // Channel i for slot i, which is how the receiver picks it back out.
    device.setRenderStates(this._getHeightStates(device, index));
    device.setProgram(info.program);
    device.setBindGroup(0, bindGroup);
    device.setVertexLayout(this._heightLayout!);
    device.draw('triangle-list', 0, this._heightIndexCount);
  }
  /**
   * Builds the surface grid once: vertex ordinals, and the index list that
   * stitches a (HEIGHT_GRID_SIZE + 1)^2 lattice of them into triangles.
   * @internal
   */
  private _ensureHeightGrid(device: AbstractDevice): void {
    if (this._heightLayout) {
      return;
    }
    const side = HEIGHT_GRID_SIZE + 1;
    const ordinals = new Float32Array(side * side);
    for (let i = 0; i < ordinals.length; i++) {
      ordinals[i] = i;
    }
    const indices = new Uint32Array(HEIGHT_GRID_SIZE * HEIGHT_GRID_SIZE * 6);
    let n = 0;
    for (let row = 0; row < HEIGHT_GRID_SIZE; row++) {
      for (let col = 0; col < HEIGHT_GRID_SIZE; col++) {
        const a = row * side + col;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices[n++] = a;
        indices[n++] = b;
        indices[n++] = d;
        indices[n++] = a;
        indices[n++] = d;
        indices[n++] = c;
      }
    }
    const vertexBuffer = device.createVertexBuffer('position_f32', ordinals)!;
    const indexBuffer = device.createIndexBuffer(indices);
    this._heightVertexBuffer = vertexBuffer;
    this._heightIndexBuffer = indexBuffer;
    this._heightLayout = device.createVertexLayout({
      vertexBuffers: [{ buffer: vertexBuffer }],
      indexBuffer
    });
    this._heightIndexCount = indices.length;
  }
  /** @internal */
  private _splatOne(
    device: AbstractDevice,
    ctx: DrawContext,
    water: Water,
    index: number,
    map: Texture2D,
    sceneDepth: Nullable<SceneDepthBinding>
  ): void {
    const material = water.material;
    const waveGenerator = material.waveGenerator!;
    // Photons are laid out over this body's own footprint.
    this._updateGridBounds(water);
    if (!(this._gridFraction > 0)) {
      return;
    }
    const photonGrid = this._resolvePhotonGrid(material.causticsPhotonResolution, map.width);
    this._updatePhotonLayout(device, photonGrid);
    const useSceneDepth = !!sceneDepth && material.causticsSceneDepth;
    const splat = this._getSplatProgram(device, waveGenerator, useSceneDepth);
    // A bind group per slot; see _getSplatBindGroup.
    const bindGroup = this._getSplatBindGroup(device, splat, index);
    if (useSceneDepth) {
      bindGroup.setValue('causticSceneMatrix', sceneDepth!.matrix);
      bindGroup.setValue('causticSceneMatrixInv', sceneDepth!.matrixInv);
      this._sceneDepthParams.setXYZW(sceneDepth!.layer, sceneDepth!.size, 0, 0);
      bindGroup.setValue('causticSceneParams', this._sceneDepthParams);
      bindGroup.setTexture('causticSceneDepth', sceneDepth!.texture, fetchSampler('clamp_nearest_nomip'));
    }
    bindGroup.setValue('causticFrameX', this._uniforms.frameX);
    bindGroup.setValue('causticFrameY', this._uniforms.frameY);
    // The slice centre is shared, but the water level in w is this body's.
    this._splatCenter.setXYZW(
      this._uniforms.center.x,
      this._uniforms.center.y,
      this._uniforms.center.z,
      water.worldMatrix.m13
    );
    bindGroup.setValue('causticCenter', this._splatCenter);
    bindGroup.setValue('causticLightDir', this._uniforms.lightDir);
    bindGroup.setValue('causticRegion', material.region);
    bindGroup.setValue('causticGridBounds', this._gridBounds);
    // Scale the deposit by covered texels per photon so a flat surface
    // integrates to exactly 1.
    const photonWeight = (this._gridFraction * map.width * map.height) / (photonGrid * photonGrid);
    this._splatParams.setXYZW(this._warp, material.causticsDepth, WATER_ETA, photonWeight);
    bindGroup.setValue('causticSplatParams', this._splatParams);
    this._photonParams.setXYZW(photonGrid, 1 / photonGrid, 0, 0);
    bindGroup.setValue('causticPhotonParams', this._photonParams);
    ShaderHelper.setStandaloneCameraTime(bindGroup, ctx);
    waveGenerator.applyWaterBindGroup(bindGroup);
    device.setProgram(splat.program);
    device.setBindGroup(0, bindGroup);
    device.setVertexLayout(this._photonLayout);
    device.draw('point-list', 0, this._photonCount);
  }
  /**
   * Blur and temporal resolve, run once over the finished map. Settings come
   * from the largest body's material.
   * @internal
   */
  private _postProcess(
    device: AbstractDevice,
    material: Water['material'],
    map: Texture2D,
    scratch: Texture2D,
    history: Nullable<Texture2D>,
    ctx: DrawContext,
    createFramebuffer: (texture: Texture2D) => FrameBuffer
  ): Texture2D {
    // Ping-pong between the two targets. The count is rounded up to an even
    // number by the material so the last pass always lands back in `map`.
    const blurPasses = Math.max(0, Math.min(material.causticsBlurPasses, 4));
    for (let i = 0; i < blurPasses; i++) {
      const src = i % 2 === 0 ? map : scratch;
      const dst = i % 2 === 0 ? scratch : map;
      this._blur(device, src, createFramebuffer(dst));
    }

    // The blur lands back in `map`, so `scratch` takes the resolve.
    const strength = material.causticsTemporalStrength;
    if (strength <= 0) {
      // No history committed; keep the recorded slice matching the history slot.
      return map;
    }
    const camera = ctx.camera;
    const previous = this._prevSlices.get(camera);
    // Without history the current map stands on its own and becomes the history.
    const resolved = history && previous ? scratch : map;
    if (resolved === scratch) {
      this._resolve(device, map, history!, previous!, strength, createFramebuffer(scratch));
    }
    this._rememberSlice(camera);
    return resolved;
  }
  /**
   * Shadow cascade to read the scene depth from, or null when this backend or
   * this light cannot supply one.
   * @internal
   */
  private _resolveSceneDepth(
    ctx: DrawContext,
    light: PunctualLight
  ): Nullable<{
    texture: Texture2DArray;
    layer: number;
    size: number;
    matrix: Matrix4x4;
    matrixInv: Matrix4x4;
  }> {
    // WebGPU only: GLSL ES 3.0 forbids texelFetch on a shadow-sampler texture.
    if (ctx.device.type !== 'webgpu') {
      warnUnsupported(
        'Water caustics on scene depth (WaterMaterial.causticsSceneDepth)',
        'WebGPU',
        'caustics are projected onto the flat plane at causticsDepth'
      );
      return null;
    }
    const params = ctx.shadowMapInfo?.get(light);
    const shadowMap = params?.shadowMap;
    // Only cascaded native-depth maps; others fall back to the plane.
    if (!params || !shadowMap?.isTexture2DArray() || !shadowMap.isDepth()) {
      return null;
    }
    // The smallest cascade whose split distance clears the slice's reach, else
    // the last.
    const count = Math.max(1, Math.min(params.numShadowCascades, 4));
    const reach = Math.max(1, this._sliceReach);
    let layer = count - 1;
    for (let i = 0; i < count; i++) {
      if (params.cascadeDistances[i] >= reach) {
        layer = i;
        break;
      }
    }
    // shadowMatrices holds each cascade's view-projection transposed.
    this._sceneMatrixT.set(params.shadowMatrices.subarray(layer * 16, layer * 16 + 16));
    Matrix4x4.transpose(this._sceneMatrixT, this._sceneMatrix);
    Matrix4x4.invert(this._sceneMatrix, this._sceneMatrixInv);
    return {
      texture: shadowMap as Texture2DArray,
      layer,
      size: shadowMap.width,
      matrix: this._sceneMatrix,
      matrixInv: this._sceneMatrixInv
    };
  }
  /**
   * Photon grid edge length for this frame.
   *
   * Auto solves the grid for a fixed density in photons per covered map texel:
   * the grid covers `gridFraction` of the map, so the target is reached at
   * `grid = size * sqrt(target * gridFraction)`.
   *
   * @param requested - Material setting; 0 asks for the automatic size.
   * @param mapSize - Edge length of the caustic map.
   * @internal
   */
  private _resolvePhotonGrid(requested: number, mapSize: number): number {
    if (requested > 0) {
      return Math.max(8, Math.min(requested, 4096));
    }
    const grid = Math.round(mapSize * Math.sqrt(PHOTONS_PER_TEXEL * this._gridFraction));
    return Math.max(8, Math.min(grid, 4096));
  }
  /**
   * Records the slice the map just produced was built with, for the next frame's
   * reprojection.
   * @internal
   */
  private _rememberSlice(camera: Camera): void {
    let slice = this._prevSlices.get(camera);
    if (!slice) {
      slice = { frameX: new Vector4(), frameY: new Vector4(), center: new Vector4(), warp: 0 };
      this._prevSlices.set(camera, slice);
    }
    slice.frameX.set(this._uniforms.frameX);
    slice.frameY.set(this._uniforms.frameY);
    slice.center.set(this._uniforms.center);
    slice.warp = this._warp;
  }
  /** @internal */
  private _resolve(
    device: AbstractDevice,
    current: Texture2D,
    history: Texture2D,
    previous: { frameX: Vector4; frameY: Vector4; center: Vector4; warp: number },
    strength: number,
    dst: FrameBuffer
  ): void {
    const program = this._getResolveProgram(device);
    const bindGroup = this._resolveBindGroup!;
    device.pushDeviceStates();
    device.setFramebuffer(dst);
    device.setViewport(null);
    device.setScissor(null);
    device.setProgram(program);
    bindGroup.setTexture('causticCurrent', current, fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('causticHistory', history, fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('causticFrameX', this._uniforms.frameX);
    bindGroup.setValue('causticFrameY', this._uniforms.frameY);
    bindGroup.setValue('causticCenter', this._uniforms.center);
    bindGroup.setValue('causticPrevFrameX', previous.frameX);
    bindGroup.setValue('causticPrevFrameY', previous.frameY);
    bindGroup.setValue('causticPrevCenter', previous.center);
    this._resolveParams.setXYZW(strength, 1 / current.width, this._warp, previous.warp);
    bindGroup.setValue('causticResolveParams', this._resolveParams);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(this._getResolveStates(device));
    device.popDeviceStates();
  }
  /** @internal */
  private _getResolveProgram(device: AbstractDevice): GPUProgram {
    if (!this._resolveProgram) {
      this._resolveProgram = device.buildRenderProgram(createCausticResolveShader())!;
      this._resolveProgram.name = '@Water_CausticResolve';
      this._resolveBindGroup = device.createBindGroup(this._resolveProgram.bindGroupLayouts[0])!;
    }
    return this._resolveProgram;
  }
  /** @internal */
  private _getResolveStates(device: AbstractDevice): RenderStateSet {
    if (!this._resolveStates) {
      this._resolveStates = device.createRenderStateSet();
      this._resolveStates.useRasterizerState().setCullMode('none');
      this._resolveStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._resolveStates;
  }
  /** Releases the GPU objects owned by this renderer. */
  dispose(): void {
    for (const info of this._splatPrograms.values()) {
      for (const bindGroup of info.bindGroups) {
        bindGroup?.dispose();
      }
      info.program.dispose();
    }
    this._splatPrograms.clear();
    for (const info of this._heightPrograms.values()) {
      for (const bindGroup of info.bindGroups) {
        bindGroup?.dispose();
      }
      info.program.dispose();
    }
    this._heightPrograms.clear();
    this._heightStates.length = 0;
    // The layout does not own its buffers.
    this._heightLayout?.dispose();
    this._heightLayout = null;
    this._heightVertexBuffer?.dispose();
    this._heightVertexBuffer = null;
    this._heightIndexBuffer?.dispose();
    this._heightIndexBuffer = null;
    this._heightIndexCount = 0;
    this._blurBindGroup?.dispose();
    this._blurBindGroup = null;
    this._resolveProgram?.dispose();
    this._resolveProgram = null;
    this._resolveBindGroup?.dispose();
    this._resolveBindGroup = null;
    this._resolveStates = null;
    this._blurProgram?.dispose();
    this._blurProgram = null;
    this._photonLayout?.dispose();
    this._photonLayout = null;
    this._photonBuffer?.dispose();
    this._photonBuffer = null;
    this._photonCapacity = 0;
    this._photonCount = 0;
    this._splatStates = null;
    this._blurStates = null;
  }
  /** @internal */
  private _blur(device: AbstractDevice, src: Texture2D, dst: FrameBuffer): void {
    const program = this._getBlurProgram(device);
    device.pushDeviceStates();
    device.setFramebuffer(dst);
    device.setProgram(program);
    this._blurBindGroup!.setTexture('causticSrc', src, fetchSampler('clamp_linear_nomip'));
    this._blurTexelSize.setXYZW(1 / src.width, 1 / src.height, 0, 0);
    this._blurBindGroup!.setValue('causticTexelSize', this._blurTexelSize);
    device.setBindGroup(0, this._blurBindGroup!);
    drawFullscreenQuad(this._getBlurStates(device));
    device.popDeviceStates();
  }
  /**
   * Recomputes the orthographic light-space slice the map covers.
   * @internal
   */
  private _updateUniforms(
    ctx: DrawContext,
    waters: readonly Water[],
    light: PunctualLight,
    mapSize: number
  ): void {
    // Slice-wide settings come from the first (largest) body.
    const material = waters[0].material;
    const dir = this._tmpDir;
    dir.set(light.directionAndCutoff.xyz());
    dir.inplaceNormalize();
    // Two axes perpendicular to the light, seeded by a non-parallel world axis.
    const seed = Math.abs(dir.y) > 0.99 ? Vector3.axisPZ() : Vector3.axisPY();
    Vector3.cross(seed, dir, this._tmpRight);
    this._tmpRight.inplaceNormalize();
    Vector3.cross(dir, this._tmpRight, this._tmpUp);
    this._tmpUp.inplaceNormalize();
    const right = this._tmpRight;
    const up = this._tmpUp;
    const waterLevel = waters[0].worldMatrix.m13;
    const range = Math.max(1, material.causticsRange);
    const camera = ctx.camera.getWorldPosition();
    const center = this._tmpCenter.setXYZ(camera.x, waterLevel, camera.z);
    const cameraRight = Vector3.dot(center, right);
    const cameraUp = Vector3.dot(center, up);
    // The component along the light direction is arbitrary: both the projection
    // into the map and the photon sweep are invariant along it.
    const alongDir = Vector3.dot(center, dir);

    // Light-space AABB of all bodies' regions, from their four corners.
    let regionMinR = Infinity;
    let regionMaxR = -Infinity;
    let regionMinU = Infinity;
    let regionMaxU = -Infinity;
    for (const body of waters) {
      const region = body.material.region;
      // Each body's own height, since the projection is taken on its surface.
      const level = body.worldMatrix.m13;
      for (const [x, z] of [
        [region.x, region.y],
        [region.z, region.y],
        [region.x, region.w],
        [region.z, region.w]
      ]) {
        const r = x * right.x + level * right.y + z * right.z;
        const v = x * up.x + level * up.y + z * up.z;
        regionMinR = Math.min(regionMinR, r);
        regionMaxR = Math.max(regionMaxR, r);
        regionMinU = Math.min(regionMinU, v);
        regionMaxU = Math.max(regionMaxU, v);
      }
    }
    // Fit the slice to the water; `causticsRange` caps how far from the camera
    // the map reaches.
    let loR = Math.max(regionMinR, cameraRight - range);
    let hiR = Math.min(regionMaxR, cameraRight + range);
    let loU = Math.max(regionMinU, cameraUp - range);
    let hiU = Math.min(regionMaxU, cameraUp + range);
    if (hiR <= loR || hiU <= loU) {
      // No water within range; keep the slice finite so the grid bounds come
      // out empty rather than inverted.
      loR = cameraRight - range;
      hiR = cameraRight + range;
      loU = cameraUp - range;
      hiU = cameraUp + range;
    }
    let halfR = Math.max(MIN_SLICE_EXTENT, (hiR - loR) * 0.5);
    let halfU = Math.max(MIN_SLICE_EXTENT, (hiU - loU) * 0.5);
    // Cap the aspect ratio to bound directional smearing on the square map.
    halfR = Math.max(halfR, halfU / MAX_SLICE_ASPECT);
    halfU = Math.max(halfU, halfR / MAX_SLICE_ASPECT);
    // Quantise so the texel size holds still while the camera moves, which the
    // centre snapping and the temporal history rely on.
    halfR = Math.min(range, quantiseSliceExtent(halfR, range));
    halfU = Math.min(range, quantiseSliceExtent(halfU, range));
    // Warp only when the range, not the water, bounds the map.
    const rangeLimited =
      regionMinR < cameraRight - range ||
      regionMaxR > cameraRight + range ||
      regionMinU < cameraUp - range ||
      regionMaxU > cameraUp + range;
    const warp = rangeLimited ? material.causticsWarp : 0;
    // Snap the centre so the map does not crawl: whole texels when linear, a
    // coarse ladder under a warp.
    const snapR = warp > 0 ? halfR / WARPED_CENTER_SNAP_DIVISIONS : (2 * halfR) / mapSize;
    const snapU = warp > 0 ? halfU / WARPED_CENTER_SNAP_DIVISIONS : (2 * halfU) / mapSize;
    const centerR = Math.round(((loR + hiR) * 0.5) / snapR) * snapR;
    const centerU = Math.round(((loU + hiU) * 0.5) / snapU) * snapU;
    center.setXYZ(
      right.x * centerR + up.x * centerU + dir.x * alongDir,
      right.y * centerR + up.y * centerU + dir.y * alongDir,
      right.z * centerR + up.z * centerU + dir.z * alongDir
    );
    const u = this._uniforms;
    u.frameX.setXYZW(right.x, right.y, right.z, 1 / halfR);
    u.frameY.setXYZW(up.x, up.y, up.z, 1 / halfU);
    u.center.setXYZW(center.x, center.y, center.z, waterLevel);
    u.lightDir.setXYZW(dir.x, dir.y, dir.z, 1 / Math.max(-dir.y, MIN_SUN_ELEVATION));
    // Edge fade start, in units of the map half-extent. Only a border set by the
    // range is faded; a border fitted to the water coincides with the region.
    const minHalf = Math.min(halfR, halfU);
    const fadeDistance = !rangeLimited
      ? 0
      : material.causticsFadeDistance > 0
        ? material.causticsFadeDistance
        : Math.max(AUTO_FADE_MIN_DISTANCE, AUTO_FADE_FRACTION * minHalf);
    const fadeFraction = Math.max(MIN_FADE_FRACTION, Math.min(MAX_FADE_FRACTION, fadeDistance / minHalf));
    u.params.setXYZW(
      material.causticsIntensity,
      material.causticsDepth,
      material.causticsDefocus,
      1 - fadeFraction
    );
    u.extinction.setXYZW(material.causticsMinDepth, 0, 0, warp);
    this._warp = warp;
    // Retained for the per-body grid fit.
    this._sliceRight = right;
    this._sliceUp = up;
    this._sliceCenterR = centerR;
    this._sliceCenterU = centerU;
    this._sliceHalfR = halfR;
    this._sliceHalfU = halfU;
    // Slice reach from the camera, for shadow cascade selection.
    this._sliceReach = Math.hypot(halfR, halfU);

    // Per-body table the receiver searches: footprint, medium and surface height.
    u.waterCount = Math.min(waters.length, MAX_CAUSTIC_WATERS);
    for (let i = 0; i < u.waterCount; i++) {
      const body = waters[i];
      const region = body.material.region;
      u.waterRegions[i * 4 + 0] = region.x;
      u.waterRegions[i * 4 + 1] = region.y;
      u.waterRegions[i * 4 + 2] = region.z;
      u.waterRegions[i * 4 + 3] = region.w;
      const ext = body.material.extinction;
      u.waterMedia[i * 4 + 0] = ext.x;
      u.waterMedia[i * 4 + 1] = ext.y;
      u.waterMedia[i * 4 + 2] = ext.z;
      u.waterMedia[i * 4 + 3] = body.worldMatrix.m13;
    }
  }
  /**
   * Map-NDC bounds of one body's footprint, so its photon grid covers just that.
   *
   * The body's light-space bounds carry over directly since the projection is
   * invariant along the light. Clamped to the map, then warped; the warp is
   * monotone and separable, so warping the interval's ends is exact.
   * @internal
   */
  private _updateGridBounds(water: Water): void {
    const region = water.material.region;
    const level = water.worldMatrix.m13;
    const right = this._sliceRight;
    const up = this._sliceUp;
    let minR = Infinity;
    let maxR = -Infinity;
    let minU = Infinity;
    let maxU = -Infinity;
    for (const [x, z] of [
      [region.x, region.y],
      [region.z, region.y],
      [region.x, region.w],
      [region.z, region.w]
    ]) {
      const r = x * right.x + level * right.y + z * right.z;
      const v = x * up.x + level * up.y + z * up.z;
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minU = Math.min(minU, v);
      maxU = Math.max(maxU, v);
    }
    const warp = this._warp;
    // Clamped to the map plus a margin (see GRID_BORDER_MARGIN), but never past
    // the water itself.
    const m = 1 + GRID_BORDER_MARGIN;
    const lo = (v: number) => Math.max(-m, Math.min(m, v));
    const minX = warpCausticNDC(lo((minR - this._sliceCenterR) / this._sliceHalfR), warp);
    const maxX = warpCausticNDC(lo((maxR - this._sliceCenterR) / this._sliceHalfR), warp);
    const minY = warpCausticNDC(lo((minU - this._sliceCenterU) / this._sliceHalfU), warp);
    const maxY = warpCausticNDC(lo((maxU - this._sliceCenterU) / this._sliceHalfU), warp);
    this._gridBounds.setXYZW(minX, minY, maxX, maxY);
    // Share of the map the grid covers; scales the photon weight to keep calm
    // water at 1.0.
    this._gridFraction = Math.max(0, ((maxX - minX) * (maxY - minY)) / 4);
  }
  /** @internal */
  private _updatePhotonLayout(device: AbstractDevice, gridSize: number): void {
    this._photonCount = gridSize * gridSize;
    if (this._photonCapacity >= this._photonCount) {
      return;
    }
    // Grow only. The buffer holds each photon's ordinal.
    const capacity = Math.max(this._photonCount, this._photonCapacity * 2);
    const indices = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      indices[i] = i;
    }
    // WebGL2 refuses to draw without a bound vertex layout, so the ordinal is
    // materialised as an attribute rather than read from the vertex index.
    const buffer = device.createVertexBuffer('position_f32', indices)!;
    this._photonLayout?.dispose();
    this._photonBuffer?.dispose();
    this._photonBuffer = buffer;
    this._photonLayout = device.createVertexLayout({ vertexBuffers: [{ buffer }] });
    this._photonCapacity = capacity;
  }
  /** @internal */
  private _getSplatStates(device: AbstractDevice): RenderStateSet {
    if (!this._splatStates) {
      this._splatStates = device.createRenderStateSet();
      this._splatStates.useRasterizerState().setCullMode('none');
      this._splatStates.useDepthState().enableTest(false).enableWrite(false);
      // Photon accumulation: every splat adds to whatever is already there.
      this._splatStates
        .useBlendingState()
        .enable(true)
        .setBlendFunc('one', 'one')
        .setBlendEquation('add', 'add');
    }
    return this._splatStates;
  }
  /** @internal */
  private _getHeightStates(device: AbstractDevice, slot: number): RenderStateSet {
    let states = this._heightStates[slot];
    if (!states) {
      states = device.createRenderStateSet();
      states.useRasterizerState().setCullMode('none');
      states.useDepthState().enableTest(false).enableWrite(false);
      // Plain overwrite into this slot's channel only.
      states.useColorState().setColorMask(slot === 0, slot === 1, slot === 2, slot === 3);
      this._heightStates[slot] = states;
    }
    return states;
  }
  /** @internal */
  private _getHeightProgram(device: AbstractDevice, waveGenerator: WaveGenerator): SplatProgramInfo {
    const key = waveGenerator.getHash();
    let info = this._heightPrograms.get(key);
    if (info) {
      return info;
    }
    const program = device.buildRenderProgram(createCausticHeightShader(waveGenerator))!;
    program.name = '@Water_CausticHeight';
    info = { program, bindGroups: [] };
    this._heightPrograms.set(key, info);
    return info;
  }
  /** @internal */
  private _getBlurStates(device: AbstractDevice): RenderStateSet {
    if (!this._blurStates) {
      this._blurStates = device.createRenderStateSet();
      this._blurStates.useRasterizerState().setCullMode('none');
      this._blurStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._blurStates;
  }
  /** @internal */
  private _getSplatProgram(
    device: AbstractDevice,
    waveGenerator: WaveGenerator,
    sceneDepth: boolean
  ): SplatProgramInfo {
    const key = `${waveGenerator.getHash()}:${sceneDepth ? 1 : 0}`;
    let info = this._splatPrograms.get(key);
    if (info) {
      return info;
    }
    const program = device.buildRenderProgram(createCausticSplatShader(waveGenerator, sceneDepth))!;
    program.name = `@Water_CausticSplat${sceneDepth ? '_SceneDepth' : ''}`;
    info = { program, bindGroups: [] };
    this._splatPrograms.set(key, info);
    return info;
  }
  /**
   * The bind group for one water slot of a splat program.
   * @internal
   */
  private _getSplatBindGroup(device: AbstractDevice, info: SplatProgramInfo, slot: number): BindGroup {
    let bindGroup = info.bindGroups[slot];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(info.program.bindGroupLayouts[0])!;
      info.bindGroups[slot] = bindGroup;
    }
    return bindGroup;
  }
  /**
   * Whether any body asks for the scene-depth intersection, which decides
   * whether the shadow cascade needs resolving at all.
   * @internal
   */
  private _anySceneDepth(waters: readonly Water[]): boolean {
    return waters.some((w) => w.material.causticsSceneDepth);
  }
  /** @internal */
  private _getBlurProgram(device: AbstractDevice): GPUProgram {
    if (!this._blurProgram) {
      this._blurProgram = device.buildRenderProgram(createCausticBlurShader())!;
      this._blurProgram.name = '@Water_CausticBlur';
      this._blurBindGroup = device.createBindGroup(this._blurProgram.bindGroupLayouts[0])!;
    }
    return this._blurProgram;
  }
}
