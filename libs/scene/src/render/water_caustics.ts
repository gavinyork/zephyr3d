import type { Nullable } from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBRenderOptions,
  ProgramBuilder,
  RenderStateSet,
  Texture2D,
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
import { ShaderHelper } from '../material/shader/helper';

/** Index of refraction of water relative to air. */
const WATER_IOR = 1.333;
/** Air-to-water eta used when refracting the sun ray at the surface. */
const WATER_ETA = 1 / WATER_IOR;
/**
 * Minimum |sin(sun elevation)| for caustics to be generated.
 *
 * The photon grid is swept along the light direction onto the water plane, which
 * degenerates as the sun approaches the horizon. Real caustics vanish there too
 * (the surface turns into a mirror), so the pass simply switches off.
 */
const MIN_SUN_ELEVATION = 0.15;
/**
 * Photons per covered map texel the automatic grid size solves for.
 *
 * Measured against a converged (16x denser) map: at 7.5 the map lands within 2%
 * of it, at 0.84 it is 9% off, and the error halves for each doubling of the
 * grid. Four buys most of that - about 4% - for a quarter of the photons a
 * fully converged map would need.
 */
const PHOTONS_PER_TEXEL = 4;
/**
 * Automatic edge fade width, as a fraction of the map half-extent.
 *
 * Matches the band the receiver used when the fade was hard-coded as a share of
 * the map, so a scene that never touches the setting keeps the look it had at
 * the ranges where that band was already wide enough.
 */
const AUTO_FADE_FRACTION = 0.2;
/** Floor in meters under the automatic fade width. */
const AUTO_FADE_MIN_DISTANCE = 3;
/** Bounds on the share of the map half-extent the fade may consume. */
const MIN_FADE_FRACTION = 0.001;
const MAX_FADE_FRACTION = 0.9;
/**
 * Largest ratio between the fitted slice's two half-extents.
 *
 * The map is square, so an anisotropic slice gives its axes different world
 * texel sizes and resolves the pattern at different frequencies along each.
 */
const MAX_SLICE_ASPECT = 2;
/**
 * Steps per octave the fitted half-extents are quantised to.
 *
 * Four costs at most 2^(1/4) - 19% of linear resolution - against a perfect fit,
 * and keeps a level change small enough to pass as a slight change in sharpness
 * rather than a pop.
 */
const SLICE_QUANTISE_STEPS = 4;
/** Smallest half-extent in meters a fitted slice may shrink to. */
const MIN_SLICE_EXTENT = 0.5;

/**
 * Rounds a fitted half-extent up onto a discrete ladder below `range`.
 *
 * The ladder is geometric and anchored at `range`, so a slice that is a whole
 * fraction of the range - the common case of water that fills it - lands exactly
 * on a level and never wastes anything.
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
  /** (sigma_t.xyz, 0) */
  extinction: Vector4;
  /** Water region in world XZ: (minX, minZ, maxX, maxZ) */
  region: Vector4;
}

/** @internal */
type SplatProgramInfo = {
  program: GPUProgram;
  bindGroup: BindGroup;
};

/**
 * Shader for the photon splat pass.
 *
 * Everything happens in the vertex stage: one vertex is one photon, and the
 * position it emits is where that photon lands. The fragment stage only deposits
 * the weight, which additive blending accumulates.
 *
 * Returned as a descriptor rather than a built program so it can be compiled
 * against a bare {@link ProgramBuilder} in tests, without a device.
 *
 * @param waveGenerator - Supplies the surface displacement and normal.
 * @internal
 */
export function createCausticSplatShader(waveGenerator: WaveGenerator): PBRenderOptions {
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
    // FBM and Gerstner animate from camera.elapsedTime, which this pass has to
    // supply itself - it is not one of the engine's camera passes.
    ShaderHelper.declareStandaloneCameraTime(scope, 0);
    waveGenerator.setupUniforms(scope, 0);
  };
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      // Photon grid coordinate in [0, 1], one vertex per photon.
      this.$inputs.photonUV = pb.vec2().attrib('position');
      this.$outputs.photonWeight = pb.float();
      setupUniforms(this);
      pb.main(function () {
        // Per-axis: the slice is fitted to the water, so its two half-extents
        // are independent and the map is only square in texels.
        this.$l.invRadius = pb.vec2(this.causticFrameX.w, this.causticFrameY.w);
        this.$l.radius = pb.div(pb.vec2(1), this.invRadius);
        this.$l.focalDepth = this.causticSplatParams.y;
        this.$l.eta = this.causticSplatParams.z;
        this.$l.L = this.causticLightDir.xyz;
        this.$l.waterLevel = this.causticCenter.w;
        // Grid position on the orthographic slice through the map centre.
        //
        // The grid spans only the part of the slice the water can actually cast
        // through, not the whole map. Spread over the whole map, a pool covering
        // a tenth of it would have nine out of ten photons killed by the region
        // test below, and the tenth that survived would leave most of the lit
        // area with no photon at all - which reads as a caustic value of zero,
        // and a caustic value of zero puts the sun out.
        this.$l.ndc = pb.mix(this.causticGridBounds.xy, this.causticGridBounds.zw, this.$inputs.photonUV);
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
        // Displaced surface point and the detail normal that bends the ray. Both
        // wave generators sample with an explicit LOD, which is what makes this
        // legal in a vertex shader.
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
        // Intersect the horizontal focal plane below the surface. The ray always
        // travels downwards here, but clamp anyway so a grazing ray cannot
        // produce an enormous or negative step.
        this.$l.targetY = pb.sub(this.waterLevel, this.focalDepth);
        this.$l.hitT = pb.div(pb.sub(this.targetY, this.surfacePos.y), pb.min(this.dir.y, -1e-4));
        this.$l.hitPos = pb.add(this.surfacePos, pb.mul(this.dir, pb.max(this.hitT, 0)));
        // Project the hit back into the map. frameX/frameY are perpendicular to
        // L and to each other, so this is just two dot products.
        this.$l.rel = pb.sub(this.hitPos, this.causticCenter.xyz);
        this.$l.hitNDC = pb.mul(
          pb.vec2(pb.dot(this.rel, this.causticFrameX.xyz), pb.dot(this.rel, this.causticFrameY.xyz)),
          this.invRadius
        );
        this.$outputs.photonWeight = this.causticSplatParams.w;
        // No per-backend y flip. A fragment written at clip y lands on the same
        // texture row on both backends, so the map the receiver samples with
        // `ndc * 0.5 + 0.5` is the one this writes at clip `ndc`. Flipping here
        // for WebGPU mirrors the map against the footprint the receiver's region
        // test admits, which leaves a crescent that the gate calls lit and the
        // map calls empty - and an empty caustic puts the sun out entirely.
        this.$builtins.position = pb.vec4(this.hitNDC, 0, 1);
        if (pb.getDevice().type !== 'webgpu') {
          // GLSL leaves gl_PointSize undefined unless it is written, and an
          // undefined size rasterises nothing at all - the map comes back empty.
          // WebGPU has no equivalent; its points are always one pixel.
          this.$builtins.pointSize = 1;
        }
        this.$if(this.outside, function () {
          // Park the photon outside the clip volume so it is discarded. Keep
          // w at 1: a zero w would divide to NaN instead of clipping.
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
 * Shader for the caustic map blur.
 *
 * Four bilinear taps at the texel corners average a 2x2 neighbourhood. The
 * weights sum to one, so the "calm water reads 1.0" normalisation established by
 * the accumulation pass survives any number of iterations.
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
 * Reprojection is exact and matrix-free. Both frames parameterise the map as an
 * orthographic slice perpendicular to the light, so a texel maps to a world
 * point with two scaled axes, and that point maps into the previous frame with
 * two dot products. Photons travel along the light and the slice is normal to
 * it, so any point on a texel's ray reconstructs the same texel and the plane
 * the point is taken on does not matter.
 *
 * The relation between map NDC and texture coordinate is the receiver's
 * (`ndc * 0.5 + 0.5`, see `ShaderHelper.calculateWaterCaustic`), which is what
 * makes this independent of the clip-space y flip the splat has to apply.
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
      /** (blend weight, texel size, 0, 0) */
      this.causticResolveParams = pb.vec4().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$l.texel = this.causticResolveParams.y;
        this.$l.current = pb.textureSampleLevel(this.causticCurrent, this.$inputs.uv, 0).x;
        // Range the current frame supports around this texel. The reprojected
        // value is clamped into it, which is what lets a long blend coexist with
        // an animated pattern: where the waves have moved on, the neighbourhood
        // no longer covers the old value and the clamp pulls it back to
        // something the current frame actually produced.
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
        // This texel's world point on the slice, then where the previous frame
        // put that same point.
        this.$l.ndc = pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1));
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
        this.$l.prevUV = pb.add(pb.mul(this.prevNDC, 0.5), pb.vec2(0.5));
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
 * water surface, intersected with a horizontal focal plane below it, and splatted
 * additively at the hit position. Because the grid and the map share a
 * parameterisation, and the mean deflection of a flat surface is removed from the
 * refracted direction, calm water maps photon `(i,j)` onto texel `(i,j)` and the
 * map converges to a uniform 1.0 - which the receiver treats as "no caustics".
 *
 * @internal
 */
export class WaterCausticsRenderer {
  /** Splat programs keyed by the wave generator's shader hash. */
  private readonly _splatPrograms: Map<string, SplatProgramInfo>;
  private _blurProgram: Nullable<GPUProgram>;
  private _blurBindGroup: Nullable<BindGroup>;
  private _resolveProgram: Nullable<GPUProgram>;
  private _resolveBindGroup: Nullable<BindGroup>;
  private _resolveStates: Nullable<RenderStateSet>;
  /**
   * Slice parameters the last map committed as history was built with, per
   * camera.
   *
   * Per camera because the history textures are (the manager hangs off the
   * camera), and this has to describe the exact map the resolve is about to
   * reproject. One shared entry would make a second viewport reproject through
   * the first one's slice.
   */
  private readonly _prevSlices: WeakMap<Camera, { frameX: Vector4; frameY: Vector4; center: Vector4 }>;
  private readonly _resolveParams: Vector4;
  private _photonLayout: Nullable<VertexLayout>;
  private _photonGridSize: number;
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
  constructor() {
    this._splatPrograms = new Map();
    this._blurProgram = null;
    this._blurBindGroup = null;
    this._resolveProgram = null;
    this._resolveBindGroup = null;
    this._resolveStates = null;
    this._prevSlices = new WeakMap();
    this._resolveParams = new Vector4();
    this._photonLayout = null;
    this._photonGridSize = 0;
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
      region: new Vector4()
    };
    this._tmpRight = new Vector3();
    this._tmpUp = new Vector3();
    this._tmpDir = new Vector3();
    this._tmpCenter = new Vector3();
    this._splatParams = new Vector4();
    this._blurTexelSize = new Vector4();
    this._gridBounds = new Vector4(-1, -1, 1, 1);
    this._gridFraction = 1;
  }
  /** Parameters of the map produced by the last successful {@link render}. */
  get uniforms(): WaterCausticUniforms {
    return this._uniforms;
  }
  /**
   * Storage format for the caustic map.
   *
   * Single channel when the device can both render to and filter it; the map is
   * accumulated with additive blending and sampled bilinearly, so it needs both.
   */
  static getMapFormat(device: AbstractDevice): TextureFormat {
    const info = device.getDeviceCaps().textureCaps.getTextureFormatInfo('r16f');
    return info.renderable && info.filterable ? 'r16f' : 'rgba16f';
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
   * @param history - Previous frame's resolved map, or null when there is none
   * to reproject. Ignored unless the material asks for temporal accumulation.
   * @param createFramebuffer - Wraps a target texture into a framebuffer.
   * @returns The texture holding the finished map, which is `map` or `scratch`
   * depending on whether the temporal resolve ran.
   */
  render(
    ctx: DrawContext,
    water: Water,
    light: PunctualLight,
    map: Texture2D,
    scratch: Texture2D,
    history: Nullable<Texture2D>,
    createFramebuffer: (texture: Texture2D) => FrameBuffer
  ): Texture2D {
    const device = ctx.device;
    const material = water.material;
    const waveGenerator = material.waveGenerator!;
    this._updateUniforms(ctx, water, light, map.width);
    const photonGrid = this._resolvePhotonGrid(material.causticsPhotonResolution, map.width);
    this._updatePhotonLayout(device, photonGrid);
    const splat = this._getSplatProgram(device, waveGenerator);
    const bindGroup = splat.bindGroup;
    bindGroup.setValue('causticFrameX', this._uniforms.frameX);
    bindGroup.setValue('causticFrameY', this._uniforms.frameY);
    bindGroup.setValue('causticCenter', this._uniforms.center);
    bindGroup.setValue('causticLightDir', this._uniforms.lightDir);
    bindGroup.setValue('causticRegion', this._uniforms.region);
    bindGroup.setValue('causticGridBounds', this._gridBounds);
    // A photon grid denser than the map deposits more than one photon per texel;
    // scale the deposit so a flat surface still integrates to exactly 1. The
    // grid fraction is part of that: concentrating the same photons onto a
    // smaller part of the map raises the density there by exactly its inverse.
    const photonWeight = (this._gridFraction * map.width * map.height) / (photonGrid * photonGrid);
    this._splatParams.setXYZW(this._uniforms.frameX.w, material.causticsDepth, WATER_ETA, photonWeight);
    bindGroup.setValue('causticSplatParams', this._splatParams);
    ShaderHelper.setStandaloneCameraTime(bindGroup, ctx);
    waveGenerator.applyWaterBindGroup(bindGroup);

    device.pushDeviceStates();
    const mapFramebuffer = createFramebuffer(map);
    device.setFramebuffer(mapFramebuffer);
    // The viewport and scissor survive a framebuffer change, and this pass runs
    // straight after the shadow maps, whose targets are a different size. Without
    // this reset the photons rasterise against the shadow map's viewport and
    // almost all of them land outside the caustic map.
    device.setViewport(null);
    device.setScissor(null);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.setProgram(splat.program);
    device.setBindGroup(0, bindGroup);
    device.setRenderStates(this._getSplatStates(device));
    device.setVertexLayout(this._photonLayout);
    // An empty intersection means the water casts nowhere into this map. Every
    // receiver it could light projects outside the map too, where the sampler's
    // edge fade already returns neutral, so the cleared map is the right answer.
    if (this._gridFraction > 0) {
      device.draw('point-list', 0, this._photonCount);
    }
    device.popDeviceStates();

    // Ping-pong between the two targets. The count is rounded up to an even
    // number by the material so the last pass always lands back in `map`.
    const blurPasses = Math.max(0, Math.min(material.causticsBlurPasses, 4));
    for (let i = 0; i < blurPasses; i++) {
      const src = i % 2 === 0 ? map : scratch;
      const dst = i % 2 === 0 ? scratch : map;
      this._blur(device, src, createFramebuffer(dst));
    }

    // The blur always lands back in `map`, so `scratch` is free to take the
    // resolve. Doing it the other way round would make the resolve read and
    // write one texture.
    const strength = material.causticsTemporalStrength;
    if (strength <= 0) {
      // Nothing is committed as history this frame, so the recorded slice has to
      // be left alone: it must keep describing whichever map the history slot
      // still holds, or re-enabling accumulation would reproject that map
      // through the wrong frame.
      return map;
    }
    const camera = ctx.camera;
    const previous = this._prevSlices.get(camera);
    // No history on the first frame, after a resize, or after the pass was off
    // for a while. The current map stands on its own and becomes the history.
    const resolved = history && previous ? scratch : map;
    if (resolved === scratch) {
      this._resolve(device, map, history!, previous!, strength, createFramebuffer(scratch));
    }
    this._rememberSlice(camera);
    return resolved;
  }
  /**
   * Photon grid edge length for this frame.
   *
   * Auto solves the grid for a fixed density in photons per covered map texel:
   * the grid covers `gridFraction` of the map, so `grid^2` photons over
   * `gridFraction * size^2` texels reach the target at
   * `grid = size * sqrt(target * gridFraction)`. Fixing the grid instead leaves
   * the density swinging with the water's footprint, which is what governs how
   * far the map lands from converged.
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
      slice = { frameX: new Vector4(), frameY: new Vector4(), center: new Vector4() };
      this._prevSlices.set(camera, slice);
    }
    slice.frameX.set(this._uniforms.frameX);
    slice.frameY.set(this._uniforms.frameY);
    slice.center.set(this._uniforms.center);
  }
  /** @internal */
  private _resolve(
    device: AbstractDevice,
    current: Texture2D,
    history: Texture2D,
    previous: { frameX: Vector4; frameY: Vector4; center: Vector4 },
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
    this._resolveParams.setXYZW(strength, 1 / current.width, 0, 0);
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
      info.bindGroup.dispose();
      info.program.dispose();
    }
    this._splatPrograms.clear();
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
    this._photonGridSize = 0;
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
  private _updateUniforms(ctx: DrawContext, water: Water, light: PunctualLight, mapSize: number): void {
    const material = water.material;
    const dir = this._tmpDir;
    dir.set(light.directionAndCutoff.xyz());
    dir.inplaceNormalize();
    // Two axes perpendicular to the light direction. Any pair will do; picking a
    // world axis that is not parallel to the light keeps the cross products stable.
    const seed = Math.abs(dir.y) > 0.99 ? Vector3.axisPZ() : Vector3.axisPY();
    Vector3.cross(seed, dir, this._tmpRight);
    this._tmpRight.inplaceNormalize();
    Vector3.cross(dir, this._tmpRight, this._tmpUp);
    this._tmpUp.inplaceNormalize();
    const right = this._tmpRight;
    const up = this._tmpUp;
    const waterLevel = water.worldMatrix.m13;
    const range = Math.max(1, material.causticsRange);
    const camera = ctx.camera.getWorldPosition();
    const center = this._tmpCenter.setXYZ(camera.x, waterLevel, camera.z);
    const cameraRight = Vector3.dot(center, right);
    const cameraUp = Vector3.dot(center, up);
    // The component along the light direction is arbitrary: both the projection
    // into the map and the photon sweep are invariant along it.
    const alongDir = Vector3.dot(center, dir);

    // Water region in light space. A world-axis-aligned rectangle projects to a
    // parallelogram here, so its bounds come from the four corners; the map is a
    // box in these coordinates, which is why the fit is done against the AABB
    // rather than the parallelogram itself.
    const region = material.region;
    let regionMinR = Infinity;
    let regionMaxR = -Infinity;
    let regionMinU = Infinity;
    let regionMaxU = -Infinity;
    for (const [x, z] of [
      [region.x, region.y],
      [region.z, region.y],
      [region.x, region.w],
      [region.z, region.w]
    ]) {
      const r = x * right.x + waterLevel * right.y + z * right.z;
      const v = x * up.x + waterLevel * up.y + z * up.z;
      regionMinR = Math.min(regionMinR, r);
      regionMaxR = Math.max(regionMaxR, r);
      regionMinU = Math.min(regionMinU, v);
      regionMaxU = Math.max(regionMaxU, v);
    }
    // Fit the slice to what the water can actually cast into, instead of always
    // spending the map on a camera-centred square of `range`. A pool far smaller
    // than the range used to leave most of the map permanently zero, and every
    // wasted texel is resolution the caustics never get back.
    //
    // `causticsRange` becomes a cap on how far from the camera the map reaches
    // rather than its literal half-extent.
    let loR = Math.max(regionMinR, cameraRight - range);
    let hiR = Math.min(regionMaxR, cameraRight + range);
    let loU = Math.max(regionMinU, cameraUp - range);
    let hiU = Math.min(regionMaxU, cameraUp + range);
    if (hiR <= loR || hiU <= loU) {
      // The water casts nowhere within range. Nothing will be drawn, but the
      // slice still has to be finite: the receiver projects through it whatever
      // the map holds, and the grid bounds below have to come out empty rather
      // than inverted.
      loR = cameraRight - range;
      hiR = cameraRight + range;
      loU = cameraUp - range;
      hiU = cameraUp + range;
    }
    let halfR = Math.max(MIN_SLICE_EXTENT, (hiR - loR) * 0.5);
    let halfU = Math.max(MIN_SLICE_EXTENT, (hiU - loU) * 0.5);
    // The map is square, so an anisotropic slice gives its two axes different
    // world texel sizes - the pattern then resolves at different frequencies
    // along each, which reads as directional smearing. Capping the ratio keeps
    // most of the fit while bounding that, and bounds the same asymmetry in the
    // edge fade, whose band is a share of each axis.
    halfR = Math.max(halfR, halfU / MAX_SLICE_ASPECT);
    halfU = Math.max(halfU, halfR / MAX_SLICE_ASPECT);
    // Quantise so the extent holds still while the camera moves. Texel snapping
    // below only stops the map crawling if the texel size itself is stable; a
    // continuously shrinking slice rescales the map every frame, which resamples
    // the temporal history every frame and blurs away what it accumulated. The
    // ladder is fine enough that a level change is a small change in sharpness,
    // and the two common cases - a pool wholly inside the range, a sea wholly
    // covering it - sit on a fixed level and never change at all.
    halfR = Math.min(range, quantiseSliceExtent(halfR, range));
    halfU = Math.min(range, quantiseSliceExtent(halfU, range));
    // Snap each in-plane component to whole texels of its own axis so the map
    // does not crawl as the camera moves.
    const texelR = (2 * halfR) / mapSize;
    const texelU = (2 * halfU) / mapSize;
    const centerR = Math.round(((loR + hiR) * 0.5) / texelR) * texelR;
    const centerU = Math.round(((loU + hiU) * 0.5) / texelU) * texelU;
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
    // Edge fade, expressed to the receiver as the distance from the map centre
    // the fade begins at, in units of the map half-extent. Resolving it here
    // keeps the shader free of the extents and lets the auto width put a floor
    // in meters under a band the map fraction alone would collapse.
    //
    // Only a border the range put there needs fading. Where the fit stopped at
    // the water instead, the border already coincides with the region the
    // receiver gates on, so a band there is at best a no-op - it lies outside
    // the region, which reads neutral anyway - and at worst eats caustics from
    // the last few meters of a pool the map now fits exactly.
    const minHalf = Math.min(halfR, halfU);
    const rangeLimited =
      regionMinR < cameraRight - range ||
      regionMaxR > cameraRight + range ||
      regionMinU < cameraUp - range ||
      regionMaxU > cameraUp + range;
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
    const extinction = material.extinction;
    u.extinction.setXYZW(extinction.x, extinction.y, extinction.z, 0);
    u.region.set(material.region);

    // Map-NDC bounds of the water region, so the photon grid can be laid out
    // over just that. Projecting into the slice is invariant along the light and
    // the slice is normal to it, so a point on the water plane and the photon it
    // launches share a map position: the region's light-space bounds carry over
    // directly. Clamped to the map, because photons outside it are rasterised
    // away and the fraction has to describe what is left or the normalisation
    // drifts.
    const minX = Math.max(-1, Math.min(1, (regionMinR - centerR) / halfR));
    const maxX = Math.max(-1, Math.min(1, (regionMaxR - centerR) / halfR));
    const minY = Math.max(-1, Math.min(1, (regionMinU - centerU) / halfU));
    const maxY = Math.max(-1, Math.min(1, (regionMaxU - centerU) / halfU));
    this._gridBounds.setXYZW(minX, minY, maxX, maxY);
    // Share of the map the grid covers, which is what keeps calm water at 1.0:
    // the same photon count spread over a smaller area has to deposit
    // proportionally less each.
    this._gridFraction = Math.max(0, ((maxX - minX) * (maxY - minY)) / 4);
  }
  /** @internal */
  private _updatePhotonLayout(device: AbstractDevice, gridSize: number): void {
    if (this._photonLayout && this._photonGridSize === gridSize) {
      return;
    }
    this._photonLayout?.dispose();
    // One vertex per photon carrying its grid coordinate. WebGL2 refuses to draw
    // without a bound vertex layout, so the grid is materialised rather than
    // derived from the vertex index.
    const coords = new Float32Array(gridSize * gridSize * 2);
    const inv = 1 / gridSize;
    for (let j = 0; j < gridSize; j++) {
      for (let i = 0; i < gridSize; i++) {
        const k = (j * gridSize + i) * 2;
        coords[k] = (i + 0.5) * inv;
        coords[k + 1] = (j + 0.5) * inv;
      }
    }
    this._photonLayout = device.createVertexLayout({
      vertexBuffers: [{ buffer: device.createVertexBuffer('position_f32x2', coords)! }]
    });
    this._photonGridSize = gridSize;
    this._photonCount = gridSize * gridSize;
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
  private _getBlurStates(device: AbstractDevice): RenderStateSet {
    if (!this._blurStates) {
      this._blurStates = device.createRenderStateSet();
      this._blurStates.useRasterizerState().setCullMode('none');
      this._blurStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._blurStates;
  }
  /** @internal */
  private _getSplatProgram(device: AbstractDevice, waveGenerator: WaveGenerator): SplatProgramInfo {
    const key = waveGenerator.getHash();
    let info = this._splatPrograms.get(key);
    if (info) {
      return info;
    }
    const program = device.buildRenderProgram(createCausticSplatShader(waveGenerator))!;
    program.name = '@Water_CausticSplat';
    info = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0])! };
    this._splatPrograms.set(key, info);
    return info;
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
