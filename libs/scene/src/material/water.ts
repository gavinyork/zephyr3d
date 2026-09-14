import type {
  AbstractDevice,
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import type { DrawContext, WaveGenerator } from '../render';
import { LIGHT_TYPE_DIRECTIONAL, MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import type { Nullable } from '@zephyr3d/base';
import { DRef, DWeakRef, Interpolator, Vector3, Vector4 } from '@zephyr3d/base';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import { fetchSampler } from '../utility/misc';
import { mixinLight } from './mixins/lit';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';
import { interleavedGradientNoise, valueNoise } from '../shaders/noise';
import { waterScatterPhase } from '../shaders/water_medium';
import { getDevice } from '../app/api';

/**
 * How the water medium converts a path length into transmittance and in-scattering.
 *
 * - `physical`: Beer-Lambert with authored absorption/scattering coefficients in 1/m.
 * - `ramp`: artist-authored ramp textures indexed by `depth * depthMulti`. Caustics
 *   still use the physical coefficients, so the two can disagree in this mode.
 *
 * @public
 */
export type WaterMediumMode = 'physical' | 'ramp';

/**
 * How the refracted view sample is located.
 *
 * - `march`: walk the refracted ray against the scene depth buffer and sample at
 *   the first crossing, at the cost of {@link REFRACT_MARCH_STEPS} depth fetches
 *   per water pixel.
 * - `offset`: displace the screen UV by the refraction of the wave normal alone,
 *   with no search. Much cheaper, but the sample does not land where the ray
 *   actually goes and the medium tint uses the straight-line distance.
 *
 * The two agree on calm water viewed from above and diverge with wave steepness
 * and view angle.
 *
 * @public
 */
export type WaterRefractionMode = 'march' | 'offset';

/**
 * Debug view of the water shading, replacing the final colour with one of its
 * intermediate terms.
 *
 * - `none`: normal shading.
 * - `normal`: wave normal, remapped to [0,1].
 * - `diffuseNormal`: the normal the diffuse terms use, remapped to [0,1].
 * - `viewFacing`: dot(wave normal, towards the eye), as grey.
 * - `frontFacing`: white where the rasterised triangle faces the eye, black on
 *   the underside of a folded crest.
 * - `foam`: foam coverage after the amount/falloff ramp, as grey. Both sources.
 * - `shoreFoam`: the shoreline contribution on its own, as grey.
 * - `waterDepth`: distance from the surface to the nearest solid around it, in
 *   metres / 10, as grey.
 * - `fresnel`: reflection weight after foam suppression, as grey.
 * - `reflection`: what the surface reflects (SSR blended over the sky).
 * - `refraction`: the scene sample behind the water, before the medium tint.
 * - `absorption`: medium transmittance over the refracted path.
 * - `scattering`: ambient in-scattering from the water body.
 * - `sunScattering`: directional in-scattering from the lights.
 * - `sunPhase`: the scattering phase function of it, as grey.
 * - `sunIntegral`: the depth integral of it, as grey (1 is optically thick).
 * - `sunNoL`: the diffuse incidence the sun's terms are weighted by, as grey.
 * - `shadow`: the shadow factor the directional lights are attenuated by.
 * - `subsurface`: the backlit-crest translucency term.
 * - `specular`: the specular lobe from the lights.
 * - `depth`: refracted path length through the medium, metres / 10.
 * - `refractUV`: the refracted sample's offset from the pixel, remapped so
 *   no offset is mid grey.
 * - `nan`: red where the final colour or the normal is NaN/inf, black elsewhere.
 *
 * Each value is a separate shader variant; the `none` variant carries no trace
 * of the others.
 *
 * @public
 */
export type WaterDebugOutput =
  | 'none'
  | 'normal'
  | 'diffuseNormal'
  | 'viewFacing'
  | 'frontFacing'
  | 'foam'
  | 'shoreFoam'
  | 'waterDepth'
  | 'fresnel'
  | 'reflection'
  | 'refraction'
  | 'absorption'
  | 'scattering'
  | 'sunScattering'
  | 'sunPhase'
  | 'sunIntegral'
  | 'sunNoL'
  | 'shadow'
  | 'subsurface'
  | 'specular'
  | 'depth'
  | 'refractUV'
  | 'nan';

/** Label/value pairs for {@link WaterDebugOutput}, for editor enumerations. */
export const WATER_DEBUG_OUTPUTS = [
  { label: 'None', value: 'none' },
  { label: 'Normal', value: 'normal' },
  { label: 'Diffuse normal', value: 'diffuseNormal' },
  { label: 'View facing', value: 'viewFacing' },
  { label: 'Front facing', value: 'frontFacing' },
  { label: 'Foam', value: 'foam' },
  { label: 'Shore foam', value: 'shoreFoam' },
  { label: 'Water depth', value: 'waterDepth' },
  { label: 'Fresnel', value: 'fresnel' },
  { label: 'Reflection', value: 'reflection' },
  { label: 'Refraction', value: 'refraction' },
  { label: 'Absorption', value: 'absorption' },
  { label: 'Scattering', value: 'scattering' },
  { label: 'Sun scattering', value: 'sunScattering' },
  { label: 'Sun phase', value: 'sunPhase' },
  { label: 'Sun integral', value: 'sunIntegral' },
  { label: 'Sun NoL', value: 'sunNoL' },
  { label: 'Shadow', value: 'shadow' },
  { label: 'Subsurface', value: 'subsurface' },
  { label: 'Specular', value: 'specular' },
  { label: 'Depth', value: 'depth' },
  { label: 'Refract UV', value: 'refractUV' },
  { label: 'NaN', value: 'nan' }
] as const;

/** Fresnel reflectance of water at normal incidence, for n = 1.333. */
const WATER_F0 = 0.02;
/** Specular roughness of water close enough that the waves are resolved. */
const WATER_BASE_ROUGHNESS = 0.04;
/**
 * Specular roughness once the distance fade has flattened the waves away.
 * Widened by the same amount the slope was cut, so the remaining mirror does
 * not alias.
 */
const WATER_DISTANT_ROUGHNESS = 0.35;
/** Index of refraction of water. Matches the caustics pass. */
const WATER_IOR = 1.333;
/** Ratio for a ray entering the water from air, as `refract` wants it. */
const AIR_TO_WATER_ETA = 1 / WATER_IOR;
/** Ratio for a ray leaving the water into air. */
const WATER_TO_AIR_ETA = WATER_IOR;
/**
 * Cap on the refracted path length, as a multiple of the straight-line distance
 * to what is behind the water. A guard against nearly tangent rays; Snell bounds
 * the true ratio near 1.5 above water, so this leaves headroom.
 */
const REFRACT_MAX_PATH_RATIO = 4;
/**
 * Number of steps the refracted-ray march takes over {@link REFRACT_MAX_PATH_RATIO}.
 *
 * Sets how finely a scene discontinuity is caught. Fixed count keeps the shader
 * uniform across backends; 24 steps resolve a crest-to-bed exchange to well
 * under a water pixel at typical camera distances.
 */
const REFRACT_MARCH_STEPS = 24;
/** Depth tolerance, in meters, for the march to treat a step as a hit. */
const REFRACT_MARCH_THICKNESS = 0.05;
/**
 * Fraction of the far plane an infinite water surface is pulled in to.
 *
 * Short of 1 so the result is never the vertex the hardware clips, and never
 * lands on the cleared depth value that `ShaderHelper.isFarthestDepth` tests for
 * by equality.
 */
const INFINITE_DEPTH_PULLIN = 0.99;
/**
 * Minimum reflection-direction y a water surface samples the sky bake with.
 *
 * The bake's lower hemisphere is near-black, so grazing reflections would read
 * the dark terminator. Re-normalised after the floor, so only the few pixels
 * near the horizon change.
 */
const HORIZON_REFLECT_BIAS = 0.08;
/**
 * Width in UV of the band the refraction offset fades out over at the screen
 * border. Off-screen there is no scene colour to refract, and a clamped sample
 * smears the border pixel across the water.
 */
const REFRACT_EDGE_FADE = 0.06;
/**
 * Normalized linear depth at or above which what is behind the water is taken to
 * be the sky, and the refraction can skip its march.
 */
const SCENE_SKY_DEPTH01 = 0.999;
/**
 * How far the surface normal bends the transmitted direction in the subsurface
 * term. This is what lets the wave itself modulate the glow.
 */
const SSS_DISTORTION = 0.25;
/** Falloff of the subsurface lobe. Higher keeps the glow closer to the sun. */
const SSS_POWER = 4;
/**
 * Mean cosine of one scattering event in the water body.
 *
 * Real sea water measures near 0.9, but at that value almost nothing comes back
 * towards a camera looking down at the water. The default gives up some of that
 * peak for a term that reads from above; the multiple-scattering blend in
 * {@link WaterMaterial.waterSunScattering} restores the isotropy.
 */
export const DEFAULT_SCATTER_ANISOTROPY = 0.7;
/**
 * Floor on how fast the refracted sun ray descends, used by the in-scattering
 * integral, so a sun on the horizon cannot make the term diverge. Snell refracts
 * even a grazing sun to about 41 degrees below the surface, so it is unreachable
 * for any sun actually above the horizon.
 */
const MIN_SUN_SLOPE = 0.05;
/**
 * Blur per meter of path that even a non-scattering medium produces, in mip
 * widths. The wave normal varies across a texel's footprint, so the background
 * is slightly defocused by the geometry alone.
 */
const REFRACT_BLUR_GEOMETRIC = 0.02;
/**
 * How strongly the scattering coefficient drives the refraction blur, mapping
 * 1/m onto mip widths per meter. Sized so sigma_s near 0.4 reaches the top of
 * the mip chain over a few meters while clear water stays sharp.
 */
const REFRACT_BLUR_DENSITY = 1.5;
/**
 * Cap on the refraction blur LOD.
 *
 * Past this the sample stops being "what is behind the water" and becomes the
 * average of the frame. Six levels is a 64x footprint, already far wider than
 * any real forward-scattering kernel.
 */
export const REFRACT_BLUR_MAX_LOD = 6;
/**
 * Share of the shoreline ramp the foam pattern is allowed to eat into.
 *
 * The pattern raises the threshold the ramp has to clear, which breaks its outer
 * edge into clumps. Below 1 so the foam at the contact line survives it.
 */
const SHORE_FOAM_NOISE_BITE = 0.6;
/** World-space drift of the foam pattern, m/s. Off-axis so it has no grain. */
const SHORE_FOAM_DRIFT_X = 0.11;
/** @see SHORE_FOAM_DRIFT_X */
const SHORE_FOAM_DRIFT_Z = -0.07;
/** Frequency ratio between octaves. Not 2, which would align the lattices. */
const SHORE_FOAM_OCTAVE_RATIO = 2.17;
/**
 * Weight of each foam pattern octave, coarsest first. Three octaves span about
 * five times in feature size, so one authored clump size serves both a wide
 * shoreline and a narrow collar.
 */
const SHORE_FOAM_OCTAVE_WEIGHTS = [0.5, 0.3, 0.2];
/**
 * Width of the band's gradient, as a fraction of the distance it reaches,
 * running inward from the reach. 1 fades across the whole band, 0 makes it a
 * hard-edged slab. The pattern can only break up what is still in the gradient.
 */
const SHORE_FOAM_EDGE_SOFTNESS = 0.85;
/**
 * Hi-Z cells the proximity query's window spreads over its radius, which sets
 * the pyramid level. Higher locates surfaces more precisely but stops covering
 * the whole footprint, and geometry in the uncovered corners is missed.
 */
const SHORE_QUERY_TAP_SPREAD = 1.5;
/**
 * Softness of the proximity query's minimum, as a fraction of its radius. A hard
 * minimum leaves the band in cell-shaped squares; the trade is that the band
 * sits a little tighter than the authored reach.
 */
const SHORE_QUERY_SOFTMIN = 0.25;
/**
 * Distance, in radii, that an empty neighbourhood resolves to. Distances are
 * clamped to it before the exponential, so nothing can underflow every term and
 * leave the logarithm with nothing to take.
 */
const SHORE_QUERY_MISS_REACH = 2;
/** Advance of the dither's hash input per frame, for TAA to average over. */
const SHORE_QUERY_DITHER_STRIDE = 5.588238;
/**
 * How thick a cell's frustum block may be, in multiples of its own width. A cell
 * spanning an object's edge would otherwise stretch down the view ray and grow
 * foam on water far behind the object.
 */
const SHORE_QUERY_CELL_DEPTH_SPAN = 2;

export class WaterMaterial extends applyMaterialMixins(MeshMaterial, mixinLight) {
  private static readonly FEATURE_MEDIUM_MODE = this.defineFeature();
  private static readonly FEATURE_REFRACTION_MODE = this.defineFeature();
  private static readonly FEATURE_INFINITE = this.defineFeature();
  private static readonly FEATURE_SHORE_FOAM = this.defineFeature();
  private static readonly FEATURE_DEBUG_OUTPUT = this.defineFeature();
  private static readonly _absorptionGrad = new Interpolator(
    'linear',
    'vec3',
    new Float32Array([0, 0.082, 0.318, 0.665, 1]),
    new Float32Array([1, 1, 1, 0.22, 0.87, 0.87, 0, 0.47, 0.49, 0, 0.275, 0.44, 0, 0, 0])
  );
  private static readonly _scatterGrad = new Interpolator(
    'linear',
    'vec3',
    new Float32Array([0, 0.15, 0.42, 1]),
    new Float32Array([0, 0, 0, 0.08, 0.41, 0.34, 0.13, 0.4, 0.45, 0.21, 0.5, 0.6])
  );
  private static readonly _defaultScatterRampTexture: DWeakRef<Texture2D> = new DWeakRef();
  private static readonly _defaultAbsorptionRampTexture: DWeakRef<Texture2D> = new DWeakRef();
  private static readonly _waveUpdateState: WeakMap<WaveGenerator, number> = new WeakMap();
  private readonly _region: Vector4;
  private _refractionScale: number;
  private _depthMulti: number;
  private _reflectionStrength: number;
  private readonly _scatterRampTexture: DRef<Texture2D>;
  private readonly _absorptionRampTexture: DRef<Texture2D>;
  private readonly _waveGenerator: DRef<WaveGenerator>;
  /**
   * Per-bind-group wave uniform sync, keyed by the bind group object.
   *
   * The material owns one bind group per pass/render-variant hash, so a water
   * surface drawn for two different cameras touches two distinct bind groups
   * and each must upload once per wave generator version.
   */
  private _waveVersionByBindGroup: WeakMap<BindGroup, number>;
  private readonly _clipmapInfo: Vector4;
  private readonly _clipmapGridInfo: Vector4;
  private _skirtDistance: number;
  private readonly _ssrParams: Vector4;
  /** Absorption coefficient sigma_a, per meter, per RGB channel. */
  private readonly _absorption: Vector3;
  /** Scattering coefficient sigma_s, per meter, per RGB channel. */
  private readonly _scattering: Vector3;
  /** sigma_a + sigma_s, recomputed whenever either coefficient changes. */
  private readonly _extinction: Vector3;
  /** sigma_s / sigma_t, the single-scattering albedo. */
  private readonly _scatterAlbedo: Vector3;
  /** Scale for the absorption coefficient. */
  private _absorptionScale: number;
  /** Scale for the scattering coefficient. */
  private _scatteringScale: number;
  private _causticsEnabled: boolean;
  private _causticsIntensity: number;
  private _causticsDepth: number;
  private _causticsRange: number;
  private _causticsFadeDistance: number;
  private _causticsWarp: number;
  private _causticsSceneDepth: boolean;
  private _causticsDefocus: number;
  private _causticsResolution: number;
  private _causticsPhotonResolution: number;
  private _causticsBlurPasses: number;
  private _causticsTemporalStrength: number;
  private _underwaterEnabled: boolean;
  private _underwaterAmbientIntensity: number;
  private _underwaterGodRays: boolean;
  private _underwaterGodRayIntensity: number;
  private _underwaterGodRaySteps: number;
  private _underwaterHysteresis: number;
  private _subsurfaceIntensity: number;
  private _subsurfaceSteepness: number;
  private readonly _subsurfaceParams: Vector4;
  private _sunScatteringIntensity: number;
  private _scatterAnisotropy: number;
  private readonly _sunScatterParams: Vector4;
  private _refractionBlur: number;
  private _cheapRefractionDepth: number;
  private _foamAmount: number;
  private _foamFalloff: number;
  private readonly _foamColor: Vector3;
  private readonly _foamParams: Vector4;
  private _shoreFoamAmount: number;
  private _shoreFoamDepth: number;
  private _shoreFoamFalloff: number;
  private _shoreFoamScale: number;
  private _shoreFoamWashAmount: number;
  private _shoreFoamWashSpeed: number;
  private _shoreFoamWashScale: number;
  private readonly _shoreFoamParams: Vector4;
  private readonly _shoreFoamWashParams: Vector4;
  constructor() {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    // Fitted to the legacy absorption ramp at depthMulti = 0.1, so switching the
    // medium to physical does not change the out-of-box look much.
    this._absorption = new Vector3(1.0, 0.25, 0.15);
    this._scattering = new Vector3(0.05, 0.12, 0.18);
    this._extinction = new Vector3();
    this._scatterAlbedo = new Vector3();
    this._absorptionScale = 1;
    this._scatteringScale = 1;
    this._updateMediumCoefficients();
    this._clipmapInfo = new Vector4();
    this._clipmapGridInfo = new Vector4();
    this._skirtDistance = 0;
    this._waveGenerator = new DRef();
    this._waveVersionByBindGroup = new WeakMap();
    this._ssrParams = new Vector4(1000, 160, 0.5, 2);
    this._scatterRampTexture = new DRef();
    this._absorptionRampTexture = new DRef();
    this._refractionScale = 1;
    this._depthMulti = 0.1;
    this._reflectionStrength = 1;
    this._causticsEnabled = true;
    this._causticsIntensity = 1;
    this._causticsDepth = 4;
    this._causticsRange = 60;
    this._causticsFadeDistance = 0;
    this._causticsWarp = 1.5;
    this._causticsSceneDepth = true;
    this._causticsDefocus = 0.12;
    this._causticsResolution = 1024;
    this._causticsPhotonResolution = 0;
    this._causticsBlurPasses = 2;
    this._causticsTemporalStrength = 0.85;
    this._underwaterEnabled = true;
    this._underwaterAmbientIntensity = 1;
    this._underwaterGodRays = true;
    this._underwaterGodRayIntensity = 1;
    this._underwaterGodRaySteps = 24;
    // A few centimetres. Wide enough that floating-point noise on the camera
    // height cannot flip the state, narrow enough that the transition still
    // happens where the eye expects it.
    this._underwaterHysteresis = 0.05;
    // Sized so a fully lit crest contributes about as much as the ambient
    // scattering term already does.
    this._subsurfaceIntensity = 1.5;
    // At 4 the wave flanks carry the glow and the troughs stay dark; 20 turns
    // the whole sea into a lamp.
    this._subsurfaceSteepness = 4;
    this._subsurfaceParams = new Vector4();
    // The integral is derived, not fitted, so 1 is what the medium coefficients
    // already imply.
    this._sunScatteringIntensity = 1;
    this._scatterAnisotropy = DEFAULT_SCATTER_ANISOTROPY;
    this._sunScatterParams = new Vector4();
    this._refractionBlur = 1;
    // A shallow-pool depth: the offset stays plausible on thin water and cannot
    // reach across a large object's silhouette.
    this._cheapRefractionDepth = 1;
    // Coverage from the generator is a folded-surface measure, not an area
    // fraction; these map it onto one. The falloff above 1 keeps light folding
    // from reading as foam.
    this._foamAmount = 1;
    this._foamFalloff = 1.5;
    // Slightly off-white and slightly blue: sea foam is water and air, and a
    // pure white one reads as snow.
    this._foamColor = new Vector3(0.92, 0.95, 0.97);
    this._foamParams = new Vector4();
    // Off by default. The shoreline estimate is a property of whatever happens
    // to be behind the surface, so it would grow a white rim around every
    // submerged object in a scene authored without it.
    this._shoreFoamAmount = 0;
    // A waterline band of a foot or two: a wave over a gently shelving bed moves
    // it visibly, but it stays a band and not a white lagoon.
    this._shoreFoamDepth = 0.5;
    // Above 1, so coverage falls off towards the outer edge rather than filling
    // the whole band.
    this._shoreFoamFalloff = 1.5;
    // A couple of clumps across the band's width, whatever that width is.
    this._shoreFoamScale = 2.5;
    // Half the band's depth, so the waterline visibly advances and retreats
    // without the band ever closing completely.
    this._shoreFoamWashAmount = 0.5;
    // One wash every eight seconds or so - the band is what a set of waves does,
    // not what one wave does.
    this._shoreFoamWashSpeed = 0.12;
    // Wash phase decorrelates over ~30 m, so a long shoreline breaks in sections
    // instead of pulsing as one.
    this._shoreFoamWashScale = 0.03;
    this._shoreFoamParams = new Vector4();
    this._shoreFoamWashParams = new Vector4();
    this.cullMode = 'none';
    this.useFeature(WaterMaterial.FEATURE_MEDIUM_MODE, 'physical' as WaterMediumMode);
    this.useFeature(WaterMaterial.FEATURE_REFRACTION_MODE, 'march' as WaterRefractionMode);
    this.useFeature(WaterMaterial.FEATURE_INFINITE, false);
    this.useFeature(WaterMaterial.FEATURE_SHORE_FOAM, false);
    this.useFeature(WaterMaterial.FEATURE_DEBUG_OUTPUT, 'none' as WaterDebugOutput);
    //this.TAADisabled = true;
  }
  /** {@inheritDoc Material.onDispose} */
  protected onDispose() {
    super.onDispose();
    this._waveGenerator.dispose();
    this._scatterRampTexture.dispose();
    this._absorptionRampTexture.dispose();
  }
  /** @internal */
  get region() {
    return this._region;
  }
  /** @internal */
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.uniformChanged();
    }
  }
  get waveGenerator() {
    return this._waveGenerator.get();
  }
  set waveGenerator(waveGenerator: Nullable<WaveGenerator>) {
    if (this._waveGenerator.get() !== waveGenerator) {
      this._waveGenerator.set(waveGenerator);
      // Bind groups are pooled and reused across frames, so an old entry must
      // not suppress the upload for a new generator.
      this._waveVersionByBindGroup = new WeakMap();
      this.optionChanged(true);
    }
  }
  get scatterRampTexture() {
    const tex = this._getScatterRampTexture(getDevice());
    return tex === WaterMaterial._defaultScatterRampTexture.get() ? null : tex;
  }
  set scatterRampTexture(tex) {
    if (tex !== this.scatterRampTexture) {
      this._scatterRampTexture.set(tex);
      this.uniformChanged();
    }
  }
  get absorptionRampTexture() {
    const tex = this._getAbsorptionRampTexture(getDevice());
    return tex === WaterMaterial._defaultAbsorptionRampTexture.get() ? null : tex;
  }
  set absorptionRampTexture(tex) {
    if (tex !== this.absorptionRampTexture) {
      this._absorptionRampTexture.set(tex);
      this.uniformChanged();
    }
  }
  /**
   * How the medium turns a path length into transmittance and in-scattering.
   *
   * Defaults to `physical`. `ramp` restores the legacy ramp-texture lookup for
   * scenes that were tuned against it.
   */
  get mediumMode(): WaterMediumMode {
    return this.featureUsed<WaterMediumMode>(WaterMaterial.FEATURE_MEDIUM_MODE) ?? 'physical';
  }
  set mediumMode(val: WaterMediumMode) {
    if (val !== this.mediumMode) {
      this.useFeature(WaterMaterial.FEATURE_MEDIUM_MODE, val);
    }
  }
  /**
   * How the refracted view sample is located. Defaults to `march`.
   *
   * Set `offset` on hardware that cannot afford the depth-buffer search - the
   * water still refracts, it just refracts to the wrong place. A compile-time
   * feature, so the cheap variant carries no trace of the march.
   */
  get refractionMode(): WaterRefractionMode {
    return this.featureUsed<WaterRefractionMode>(WaterMaterial.FEATURE_REFRACTION_MODE) ?? 'march';
  }
  set refractionMode(val: WaterRefractionMode) {
    if (val !== this.refractionMode) {
      this.useFeature(WaterMaterial.FEATURE_REFRACTION_MODE, val);
    }
  }
  /**
   * Which intermediate shading term to display instead of the final colour.
   * Defaults to `none`. See {@link WaterDebugOutput}.
   */
  get debugOutput(): WaterDebugOutput {
    return this.featureUsed<WaterDebugOutput>(WaterMaterial.FEATURE_DEBUG_OUTPUT) ?? 'none';
  }
  set debugOutput(val: WaterDebugOutput) {
    if (val !== this.debugOutput) {
      this.useFeature(WaterMaterial.FEATURE_DEBUG_OUTPUT, val);
    }
  }
  /**
   * Whether the surface reads as unbounded, reaching the horizon rather than
   * ending at {@link region}. Off by default.
   *
   * The region test is not emitted at all, so the surface has no edge, and the
   * clipmap's outermost ring becomes a horizon skirt that survives clipping past
   * the camera's far plane. Use it for an ocean, not for a pond or a pool.
   */
  get infinite(): boolean {
    return this.featureUsed<boolean>(WaterMaterial.FEATURE_INFINITE) ?? false;
  }
  set infinite(val: boolean) {
    if (!!val !== this.infinite) {
      this.useFeature(WaterMaterial.FEATURE_INFINITE, !!val);
    }
  }
  /** Absorption coefficient sigma_a in 1/m, per RGB channel. */
  get absorption() {
    return this._absorption;
  }
  set absorption(val: Vector3) {
    if (!val.equalsTo(this._absorption)) {
      this._absorption.set(val);
      this._updateMediumCoefficients();
      this.uniformChanged();
    }
  }
  /** Scale for the absorption coefficient. */
  get absorptionScale() {
    return this._absorptionScale;
  }
  set absorptionScale(val: number) {
    if (val !== this._absorptionScale) {
      this._absorptionScale = val;
      this._updateMediumCoefficients();
      this.uniformChanged();
    }
  }
  /** Scattering coefficient sigma_s in 1/m, per RGB channel. */
  get scattering() {
    return this._scattering;
  }
  set scattering(val: Vector3) {
    if (!val.equalsTo(this._scattering)) {
      this._scattering.set(val);
      this._updateMediumCoefficients();
      this.uniformChanged();
    }
  }
  /** Scale for the scattering coefficient. */
  get scatteringScale() {
    return this._scatteringScale;
  }
  set scatteringScale(val: number) {
    if (val !== this._scatteringScale) {
      this._scatteringScale = val;
      this._updateMediumCoefficients();
      this.uniformChanged();
    }
  }
  /**
   * Extinction coefficient sigma_t = sigma_a + sigma_s in 1/m.
   *
   * Read by the caustics pass so the light attenuated along the refracted path
   * uses the same medium as the surface shading. Do not mutate the result.
   */
  get extinction() {
    return this._extinction;
  }
  /** Single-scattering albedo sigma_s / sigma_t. Do not mutate the result. */
  get scatterAlbedo() {
    return this._scatterAlbedo;
  }
  /**
   * Whether a camera inside this body of water sees the water from the inside:
   * the medium applied to the whole scene, the sky replaced by water, and the
   * surface read from below.
   *
   * The medium coefficients are the ones the surface already uses
   * ({@link WaterMaterial.absorption}, {@link WaterMaterial.scattering} and
   * their scales), so the volume and the surface never disagree.
   */
  get underwaterEnabled() {
    return this._underwaterEnabled;
  }
  set underwaterEnabled(val: boolean) {
    this._underwaterEnabled = !!val;
  }
  /**
   * Scale on the downwelling sky radiance that lights the water column from
   * inside, 1 for the value the sky implies.
   *
   * This is what the water fades to in the distance, so it is also what decides
   * how bright the underwater "fog" reads.
   */
  get underwaterAmbientIntensity() {
    return this._underwaterAmbientIntensity;
  }
  set underwaterAmbientIntensity(val: number) {
    this._underwaterAmbientIntensity = Math.max(0, val);
  }
  /**
   * Whether shafts of sunlight are marched through the water column.
   *
   * Reads the caustic map as the surface's transmittance, so the shafts carry
   * the same focusing pattern that lands on the sea bed. Switches itself off
   * wherever the caustic map is unavailable - WebGL1, no shadow-casting
   * directional light, or a sun too close to the horizon.
   */
  get underwaterGodRays() {
    return this._underwaterGodRays;
  }
  set underwaterGodRays(val: boolean) {
    this._underwaterGodRays = !!val;
  }
  /** Strength of the light shafts, 1 for the value the medium implies. */
  get underwaterGodRayIntensity() {
    return this._underwaterGodRayIntensity;
  }
  set underwaterGodRayIntensity(val: number) {
    this._underwaterGodRayIntensity = Math.max(0, val);
  }
  /**
   * Samples taken along each view ray for the light shafts.
   *
   * The march is dithered, so a low count reads as noise rather than as banding;
   * below about 8 the noise stops resolving into shafts at all.
   */
  get underwaterGodRaySteps() {
    return this._underwaterGodRaySteps;
  }
  set underwaterGodRaySteps(val: number) {
    this._underwaterGodRaySteps = Math.max(1, Math.floor(val));
  }
  /**
   * Half-width in meters of the dead band around the surface the submerged test
   * uses, so a camera sitting exactly at water level does not flip state every
   * frame. The test is against the rest plane, not the displaced surface.
   */
  get underwaterHysteresis() {
    return this._underwaterHysteresis;
  }
  set underwaterHysteresis(val: number) {
    this._underwaterHysteresis = Math.max(0, val);
  }
  /**
   * Whether this water projects caustics onto the geometry below it.
   *
   * Requires a shadow-casting directional light and a non-WebGL1 device; the
   * caustics pass disables itself when either is missing.
   */
  get causticsEnabled() {
    return this._causticsEnabled;
  }
  set causticsEnabled(val: boolean) {
    this._causticsEnabled = !!val;
  }
  /** Strength of the caustic contrast. 0 leaves the light unmodulated. */
  get causticsIntensity() {
    return this._causticsIntensity;
  }
  set causticsIntensity(val: number) {
    this._causticsIntensity = val;
  }
  /**
   * Depth in meters below the surface where the caustics are in focus.
   *
   * Receivers away from this depth are progressively defocused rather than
   * displaced, so set it near the depth of the sea bed that should show the
   * sharpest pattern.
   */
  get causticsDepth() {
    return this._causticsDepth;
  }
  set causticsDepth(val: number) {
    this._causticsDepth = Math.max(0.01, val);
  }
  /**
   * Furthest distance in meters from the camera the caustic map reaches.
   *
   * A cap rather than a fixed extent: the map is fitted to the part of the water
   * within this distance. Raise it to light more of the scene, at the cost of
   * resolution wherever the water is large enough to fill it.
   */
  get causticsRange() {
    return this._causticsRange;
  }
  set causticsRange(val: number) {
    this._causticsRange = Math.max(1, val);
  }
  /**
   * Width in meters of the band the pattern fades out over at the edge of the
   * map, or 0 to derive it from {@link causticsRange}.
   *
   * Too narrow a band makes the map boundary read as a hard line across the sea
   * bed. Auto scales with the range but puts a floor under it in meters. Capped
   * at 90% of the range, so a core of the map always survives.
   */
  get causticsFadeDistance() {
    return this._causticsFadeDistance;
  }
  set causticsFadeDistance(val: number) {
    this._causticsFadeDistance = Math.max(0, val);
  }
  /**
   * Whether photons land on the scene instead of on a plane at
   * {@link causticsDepth}.
   *
   * On by default. The plane displaces the pattern sideways on any receiver not
   * at that depth, which is badly wrong under a low sun and on a sea bed with
   * relief. Resolving the real depth reuses the sun's shadow cascade, so it
   * costs no extra geometry pass, and falls back to the plane wherever that
   * cascade has nothing to say.
   *
   * {@link causticsDepth} still sets where the iteration starts and what the
   * defocus is measured against.
   */
  get causticsSceneDepth() {
    return this._causticsSceneDepth;
  }
  set causticsSceneDepth(val: boolean) {
    this._causticsSceneDepth = !!val;
  }
  /**
   * How strongly caustic map texels are concentrated near the camera, 0 to
   * spread them evenly.
   *
   * Texel density is `1 + causticsWarp` times uniform at the centre and
   * `1 / (1 + causticsWarp)` times it at the border. Raise it when a
   * {@link causticsRange} large enough to light the scene is too coarse to
   * resolve a caustic cell.
   *
   * Ignored while the map already fits the water within range, which is the case
   * a bounded pool inside {@link causticsRange} always lands in.
   */
  get causticsWarp() {
    return this._causticsWarp;
  }
  set causticsWarp(val: number) {
    this._causticsWarp = Math.max(0, Math.min(8, val));
  }
  /** How fast the caustic contrast falls off per meter away from {@link causticsDepth}. */
  get causticsDefocus() {
    return this._causticsDefocus;
  }
  set causticsDefocus(val: number) {
    this._causticsDefocus = Math.max(0, val);
  }
  /** Edge length of the square caustic map. */
  get causticsResolution() {
    return this._causticsResolution;
  }
  set causticsResolution(val: number) {
    this._causticsResolution = Math.max(16, Math.min(2048, val | 0));
  }
  /**
   * Edge length of the photon grid, or 0 to size it from the map.
   *
   * Auto solves for photons per map texel, which is the density that governs
   * quality; a fixed grid over-spends on a small pool and under-spends on open
   * water. Set a value to pin the grid explicitly; the cost is the square of it.
   */
  get causticsPhotonResolution() {
    return this._causticsPhotonResolution;
  }
  set causticsPhotonResolution(val: number) {
    const n = val | 0;
    this._causticsPhotonResolution = n <= 0 ? 0 : Math.max(16, Math.min(4096, n));
  }
  /**
   * Number of 2x2 blur iterations applied to the accumulated map. Rounded up to
   * an even count.
   */
  get causticsBlurPasses() {
    return this._causticsBlurPasses;
  }
  set causticsBlurPasses(val: number) {
    const clamped = Math.max(0, Math.min(4, val | 0));
    this._causticsBlurPasses = clamped + (clamped & 1);
  }
  /**
   * Weight the previous frame's caustic map keeps in the current one, 0 to
   * disable.
   *
   * Averages away the scintillation a moving photon lattice produces, in effect
   * multiplying the photon count for free. The resolve clamps the reprojected
   * value to its own 3x3 neighbourhood, so still regions accumulate while moving
   * ones fall back to the current frame. Raising this past the default buys
   * diminishing stability and starts to smear the animation.
   */
  get causticsTemporalStrength() {
    return this._causticsTemporalStrength;
  }
  set causticsTemporalStrength(val: number) {
    this._causticsTemporalStrength = Math.max(0, Math.min(0.95, val));
  }
  /**
   * Strength of the sunlight scattered forward through a wave crest, 0 to
   * disable.
   *
   * This is the term that makes a backlit crest glow. Authored rather than
   * derived; the medium's albedo supplies the colour, so raising this brightens
   * the glow without shifting its hue.
   */
  get subsurfaceIntensity() {
    return this._subsurfaceIntensity;
  }
  set subsurfaceIntensity(val: number) {
    if (val !== this._subsurfaceIntensity) {
      this._subsurfaceIntensity = Math.max(0, val);
      this.uniformChanged();
    }
  }
  /**
   * How sharply surface tilt gates the subsurface glow.
   *
   * The glow is scaled by `(1 - normal.y) * subsurfaceSteepness`, clamped to 1,
   * so this is the reciprocal of the tilt at which it saturates. Unitless, and
   * larger than it looks like it should be: an ocean surface is nearly flat in
   * these terms.
   */
  get subsurfaceSteepness() {
    return this._subsurfaceSteepness;
  }
  set subsurfaceSteepness(val: number) {
    if (val !== this._subsurfaceSteepness) {
      this._subsurfaceSteepness = Math.max(0, val);
      this.uniformChanged();
    }
  }
  /**
   * Strength of the sunlight scattered out of the water column towards the eye,
   * 1 for the value the medium coefficients imply. 0 disables the term.
   *
   * This is what gives the water body a direction-dependent colour: a shadow
   * falling on the water darkens the water itself, and a low sun tints the
   * column. Unlike {@link subsurfaceIntensity} this is not an authored
   * magnitude - 1 is the physical answer and anything else is a deliberate
   * exaggeration.
   */
  get sunScatteringIntensity() {
    return this._sunScatteringIntensity;
  }
  set sunScatteringIntensity(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._sunScatteringIntensity) {
      this._sunScatteringIntensity = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Depth in meters the cheap refraction mode assumes the water is, in
   * {@link refractionMode} `offset`. Ignored by `march`.
   *
   * Sets how strong the distortion looks: raise it for water that should read as
   * deep, lower it for a shallow film. A constant rather than the measured scene
   * distance, which would double every submerged object across its silhouette;
   * the price is that shallow and deep water distort equally.
   */
  get cheapRefractionDepth() {
    return this._cheapRefractionDepth;
  }
  set cheapRefractionDepth(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._cheapRefractionDepth) {
      this._cheapRefractionDepth = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Scale on how much the medium blurs what is seen through it. 0 keeps the
   * background perfectly sharp at any depth, 1 is what the medium implies.
   *
   * The width is derived from the scattering coefficient and the path length, so
   * this is a stylisation knob rather than the magnitude itself. Costs nothing -
   * it selects a mip of a chain that is generated regardless.
   */
  get refractionBlur() {
    return this._refractionBlur;
  }
  set refractionBlur(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._refractionBlur) {
      this._refractionBlur = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Mean cosine of a single scattering event, in `[0, 0.95]`.
   *
   * 0 scatters equally in all directions; higher values push light forward, so
   * the water brightens when looking towards the sun through it and darkens
   * when looking away. The term blends towards isotropic as the column gets
   * optically thick, so the visible anisotropy is always less than this number
   * alone suggests.
   */
  get scatterAnisotropy() {
    return this._scatterAnisotropy;
  }
  set scatterAnisotropy(val: number) {
    const clamped = Math.max(0, Math.min(0.95, val));
    if (clamped !== this._scatterAnisotropy) {
      this._scatterAnisotropy = clamped;
      this.uniformChanged();
    }
  }
  /**
   * How much of a folded texel reads as foam, 0 to disable. Scales the wave
   * generator's fold measure into a coverage fraction.
   */
  get foamAmount() {
    return this._foamAmount;
  }
  set foamAmount(val: number) {
    if (val !== this._foamAmount) {
      this._foamAmount = Math.max(0, val);
      this.uniformChanged();
    }
  }
  /**
   * Falloff applied to foam coverage before it is scaled. Above 1 only a crest
   * that has genuinely broken shows any foam, which keeps a windy sea from
   * turning uniformly white.
   */
  get foamFalloff() {
    return this._foamFalloff;
  }
  set foamFalloff(val: number) {
    if (val !== this._foamFalloff) {
      this._foamFalloff = Math.max(0.01, val);
      this.uniformChanged();
    }
  }
  /** Diffuse albedo of the foam. */
  get foamColor() {
    return this._foamColor;
  }
  set foamColor(val: Vector3) {
    if (!val.equalsTo(this._foamColor)) {
      this._foamColor.set(val);
      this.uniformChanged();
    }
  }
  /**
   * Coverage of the foam that collects where the water meets a surface, 0 to disable.
   *
   * A second foam source independent of the crest foam, keyed on how far the
   * surface is from the nearest solid around it - the depth of water over a bed,
   * the horizontal distance to a hull or a piling. One band covers both the
   * shoreline and the contact line around anything standing in the water.
   *
   * Estimated in screen space, with the limits that implies: geometry that is
   * off screen, hidden behind something else, or thinner than a few pixels
   * produces no foam. Requires the Hi-Z pyramid, so it is unavailable on WebGL1.
   *
   * Drawn with {@link foamColor} and folded into the same coverage the crest foam
   * feeds, so it suppresses the specular lobe and the water body underneath it
   * exactly as that one does.
   */
  get shoreFoamAmount() {
    return this._shoreFoamAmount;
  }
  set shoreFoamAmount(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._shoreFoamAmount) {
      // A compile-time feature, so crossing zero rebuilds the shader while
      // changing the value either side of it does not. Forced off on WebGL1,
      // which has no Hi-Z pyramid for the query to read.
      const wasEnabled = this._shoreFoamAmount > 0;
      this._shoreFoamAmount = clamped;
      if (wasEnabled !== clamped > 0) {
        this.useFeature(WaterMaterial.FEATURE_SHORE_FOAM, clamped > 0 && getDevice().type !== 'webgl');
      } else {
        this.uniformChanged();
      }
    }
  }
  /**
   * How far, in meters, the foam band reaches from the surface behind it.
   *
   * Over a bed this is a depth of water; against anything vertical it is a
   * horizontal distance, and the same value serves both. Coverage is solid
   * against the contact itself and fades to nothing by this distance, so it is
   * the outer edge of the band rather than its midpoint. What it means on screen
   * depends on the geometry: on a steep drop-off the band is a thin line however
   * large this is, and on a flat shelf a small value already covers a wide
   * stretch.
   */
  get shoreFoamDepth() {
    return this._shoreFoamDepth;
  }
  set shoreFoamDepth(val: number) {
    const clamped = Math.max(0.001, val);
    if (clamped !== this._shoreFoamDepth) {
      this._shoreFoamDepth = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Falloff applied across the band before it is scaled. Above 1 the coverage is
   * pushed towards the near end, keeping the outer edge thin and broken instead
   * of washing evenly over the whole range.
   */
  get shoreFoamFalloff() {
    return this._shoreFoamFalloff;
  }
  set shoreFoamFalloff(val: number) {
    const clamped = Math.max(0.01, val);
    if (clamped !== this._shoreFoamFalloff) {
      this._shoreFoamFalloff = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Size of the clumps the band's edge breaks into, as cycles across the band.
   *
   * Relative to {@link shoreFoamDepth} rather than an absolute frequency, so one
   * setting serves both a shoreline metres across and a collar around a piling,
   * and widening the band widens its clumps with it.
   *
   * Evaluated in world space, so the pattern stays put as the camera moves.
   */
  get shoreFoamScale() {
    return this._shoreFoamScale;
  }
  set shoreFoamScale(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._shoreFoamScale) {
      this._shoreFoamScale = clamped;
      this.uniformChanged();
    }
  }
  /**
   * How far the band's edge runs back and forth, as a fraction of
   * {@link shoreFoamDepth}.
   *
   * This is what makes the band read as surf rather than as a painted rim. 0
   * leaves a static band. Above 1 the band closes completely at the bottom of
   * the cycle, which looks like the foam blinking out rather than retreating.
   */
  get shoreFoamWashAmount() {
    return this._shoreFoamWashAmount;
  }
  set shoreFoamWashAmount(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._shoreFoamWashAmount) {
      this._shoreFoamWashAmount = clamped;
      this.uniformChanged();
    }
  }
  /** Run-up cycles per second. Swell rather than wind waves, so well under 1. */
  get shoreFoamWashSpeed() {
    return this._shoreFoamWashSpeed;
  }
  set shoreFoamWashSpeed(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._shoreFoamWashSpeed) {
      this._shoreFoamWashSpeed = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Spatial frequency of the run-up phase, in cycles per meter.
   *
   * Decorrelates the wash along the shore: at 0 the entire waterline advances
   * and retreats in lockstep, which reads as the water level itself rising and
   * falling; a cycle every few tens of meters breaks a long shoreline into
   * sections that run up out of step with one another.
   */
  get shoreFoamWashScale() {
    return this._shoreFoamWashScale;
  }
  set shoreFoamWashScale(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._shoreFoamWashScale) {
      this._shoreFoamWashScale = clamped;
      this.uniformChanged();
    }
  }
  /** Whether the shoreline foam contributes at all. @internal */
  private get _shoreFoamEnabled() {
    return this.featureUsed<boolean>(WaterMaterial.FEATURE_SHORE_FOAM) ?? false;
  }
  /**
   * Whether this shader build can run the band: the feature is on *and* the
   * pyramid it queries is bound for this pass.
   *
   * A pass outside the main graph can shade water with no Hi-Z pass having run
   * for it, and compiling a fetch against an unbound texture is a build failure.
   * @internal
   */
  private _shoreFoamAvailable(scope: PBInsideFunctionScope | PBFunctionScope) {
    return this._shoreFoamEnabled && !!ShaderHelper.getHiZDepthTexture(scope as PBInsideFunctionScope);
  }
  /** @internal */
  private _updateMediumCoefficients() {
    this._extinction.setXYZ(
      this._absorption.x * this._absorptionScale + this._scattering.x * this._scatteringScale,
      this._absorption.y * this._absorptionScale + this._scattering.y * this._scatteringScale,
      this._absorption.z * this._absorptionScale + this._scattering.z * this._scatteringScale
    );
    // A channel with no interaction at all transmits fully and scatters nothing;
    // its albedo is arbitrary, so pick 0 rather than divide.
    this._scatterAlbedo.setXYZ(
      this._extinction.x > 0 ? (this._scattering.x * this._scatteringScale) / this._extinction.x : 0,
      this._extinction.y > 0 ? (this._scattering.y * this._scatteringScale) / this._extinction.y : 0,
      this._extinction.z > 0 ? (this._scattering.z * this._scatteringScale) / this._extinction.z : 0
    );
  }
  get depthMulti() {
    return this._depthMulti;
  }
  set depthMulti(val) {
    if (val !== this._depthMulti) {
      this._depthMulti = val;
      this.uniformChanged();
    }
  }
  /**
   * Artistic scale on the refracted view offset. 1 is physical, 0 disables it.
   *
   * The offset is already derived from Snell's law and accounts for the
   * incidence angle, the receiver depth and the perspective foreshortening, so
   * this exists only to dial the result back for a stylised look. Values above 1
   * exaggerate; the surface stays continuous, but the sample can wander far
   * enough that the medium tint stops matching what is visible through it.
   */
  get refractionScale() {
    return this._refractionScale;
  }
  set refractionScale(val) {
    const clamped = Math.max(0, val);
    if (clamped !== this._refractionScale) {
      this._refractionScale = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Scale on the Fresnel reflectance, 1 for the physical value.
   *
   * Below 1 the surface reflects less than it should and shows more of what is
   * beneath it - useful when a physically correct grazing reflection buries a
   * sea bed the shot is about. The F0 floor is scaled with it, so 0 gives a
   * surface with no specular response at all.
   */
  get reflectionStrength() {
    return this._reflectionStrength;
  }
  set reflectionStrength(val) {
    const clamped = Math.max(0, Math.min(1, val));
    if (clamped !== this._reflectionStrength) {
      this._reflectionStrength = clamped;
      this.uniformChanged();
    }
  }
  needSceneColor() {
    return true;
  }
  needSceneDepth() {
    return true;
  }
  /**
   * The shoreline foam reads the Hi-Z pyramid's nearest-depth channel. WebGL1
   * has no pyramid at all.
   */
  needHiZNearest() {
    return this._shoreFoamEnabled && getDevice().type !== 'webgl';
  }
  protected _createHash() {
    return `${super._createHash()}:${this.waveGenerator?.getHash() ?? ''}`;
  }
  setClipmapInfo(rotation: number, scale: number, offsetX: number, offsetY: number) {
    this._clipmapInfo.setXYZW(rotation, scale, offsetX, offsetY);
    this.uniformChanged();
  }
  setClipmapGridInfo(gridScale: number, gridOffsetX: number, gridOffsetY: number) {
    if (
      this._clipmapGridInfo.x !== gridScale ||
      this._clipmapGridInfo.y !== gridOffsetX ||
      this._clipmapGridInfo.z !== gridOffsetY
    ) {
      this._clipmapGridInfo.setXYZW(gridScale, gridOffsetX, gridOffsetY, 0);
      this.uniformChanged();
    }
  }
  /**
   * How far from the camera the horizon skirt's outer edge is placed, in world
   * units. Only read while {@link infinite} is on.
   */
  setSkirtDistance(distance: number) {
    if (this._skirtDistance !== distance) {
      this._skirtDistance = distance;
      this.uniformChanged();
    }
  }
  supportInstancing() {
    return false;
  }
  supportLighting() {
    return true;
  }
  /**
   * {@inheritDoc IMixinLight.receivesWaterCaustics}
   *
   * Always false. Caustics belong on whatever the water is above: the submersion
   * test compares a fragment's height against the surface height sampled on its
   * sun ray, so unless the sun is overhead every water fragment has some other
   * part of the same surface up-sun of it and reads as submerged wherever that
   * part rides a crest.
   */
  receivesWaterCaustics(): boolean {
    return false;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.$inputs.clipmapInfo = pb.vec4().attrib('texCoord0');
    scope.clipmapGridInfo = pb.vec4().uniform(2);
    if (this.infinite) {
      scope.skirtDistance = pb.float().uniform(2);
    }

    scope.$l.s = pb.sin(scope.$inputs.clipmapInfo.x);
    scope.$l.c = pb.cos(scope.$inputs.clipmapInfo.x);
    scope.$l.scale2 = pb.mul(scope.$inputs.clipmapInfo.y, scope.clipmapGridInfo.x);
    scope.$l.clipmapMatrix = pb.mat4(
      pb.mul(scope.c, scope.scale2),
      pb.mul(scope.s, scope.scale2),
      0,
      0,
      pb.neg(pb.mul(scope.s, scope.scale2)),
      pb.mul(scope.c, scope.scale2),
      0,
      0,
      0,
      0,
      1,
      0,
      pb.sub(pb.mul(scope.$inputs.clipmapInfo.z, scope.clipmapGridInfo.x), scope.clipmapGridInfo.y),
      pb.sub(pb.mul(scope.$inputs.clipmapInfo.w, scope.clipmapGridInfo.x), scope.clipmapGridInfo.z),
      0,
      1
    );

    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    //scope.$l.level = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(0, 0, 0, 1)).y;
    scope.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz; // pb.vec3(scope.clipmapPos.x, scope.level, scope.clipmapPos.y);
    scope.worldNormal = pb.vec3(0, 1, 0);
    scope.worldPos = scope.clipmapWorldPos;
    if (this.infinite) {
      const that = this;
      // The clipmap meshes all leave position.z at 0; the skirt ring sets it to
      // 1 on its outer edge. Its inner edge is welded to the outermost tiles and
      // is displaced with them, so the join stays closed.
      scope.$l.skirt = pb.step(0.5, scope.$inputs.position.z);
      scope
        .$if(pb.greaterThan(scope.skirt, 0), function () {
          // Radially outwards from the camera rather than from the clipmap
          // origin: the ring has to read as a horizon from where it is being
          // looked at, and the clipmap is snapped to a grid the camera wanders
          // within.
          this.$l.camXZ = ShaderHelper.getCameraPosition(this).xz;
          this.$l.outDir = pb.normalize(pb.sub(this.clipmapWorldPos.xz, this.camXZ));
          this.$l.outXZ = pb.add(this.camXZ, pb.mul(this.outDir, this.skirtDistance));
          // Flat, at the still-water level. A displaced vertex out here would be
          // several kilometres from its neighbours, so any wave it sampled would
          // read as a jagged silhouette rather than a swell.
          this.worldPos = pb.vec3(this.outXZ.x, this.clipmapWorldPos.y, this.outXZ.y);
        })
        .$else(function () {
          that.waveGenerator?.calcVertexPositionAndNormal(
            this,
            this.clipmapWorldPos,
            this.worldPos,
            this.worldNormal
          );
        });
      scope.$outputs.skirt = scope.skirt;
    } else {
      this.waveGenerator?.calcVertexPositionAndNormal(
        scope,
        scope.clipmapWorldPos,
        scope.worldPos,
        scope.worldNormal
      );
    }
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    scope.$outputs.worldNormal = scope.worldNormal;
    if (this.infinite) {
      // Pulled in along the view ray rather than depth-clamped.
      //
      // The surface has to reach past the far plane, but the depth buffer cannot
      // encode anything past it. A perspective projection is invariant under
      // scaling about the eye, so moving a vertex along its own view ray leaves
      // its screen position untouched while bringing its depth back inside the
      // frustum - every vertex stays unclipped, so there is no seam to tear.
      //
      // Shading keeps the true world position, so only the written depth is
      // affected, and only past the far plane.
      scope.$l.camPos = ShaderHelper.getCameraPosition(scope).xyz;
      scope.$l.viewVec = pb.sub(scope.$outputs.worldPos, scope.camPos);
      scope.$l.viewDist = pb.max(pb.length(scope.viewVec), 1e-6);
      // Just inside the far plane, so the vertex is never the one the hardware
      // decides to clip and never lands on the cleared depth value.
      scope.$l.maxDist = pb.mul(ShaderHelper.getCameraParams(scope).y, INFINITE_DEPTH_PULLIN);
      scope.$l.pullIn = pb.min(pb.div(scope.maxDist, scope.viewDist), 1);
      scope.$l.projPos = pb.add(scope.camPos, pb.mul(scope.viewVec, scope.pullIn));
      ShaderHelper.setClipSpacePosition(
        scope,
        pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.projPos, 1))
      );
    } else {
      ShaderHelper.setClipSpacePosition(
        scope,
        pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
      );
    }
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    if (!this.infinite) {
      scope.region = pb.vec4().uniform(2);
    }
    if (this.needFragmentColor()) {
      scope.refractionScale = pb.float().uniform(2);
      if (this.refractionMode === 'offset') {
        // Only the cheap path has a fixed depth scale to step along; the march
        // derives its own from the scene.
        scope.cheapRefractionDepth = pb.float().uniform(2);
      }
      scope.reflectionStrength = pb.float().uniform(2);
      scope.ssrParams = pb.vec4().uniform(2);
      // (intensity, 1 / full-scatter crest height, 0, 0)
      scope.subsurfaceParams = pb.vec4().uniform(2);
      // (coverage scale, coverage falloff, 0, 0)
      scope.foamShadingParams = pb.vec4().uniform(2);
      scope.foamColor = pb.vec3().uniform(2);
      if (this._shoreFoamAvailable(scope)) {
        // (coverage scale, band depth in m, coverage falloff, pattern cycles/m)
        scope.shoreFoamParams = pb.vec4().uniform(2);
        // (run-up amount, run-up cycles/s, run-up cycles/m, query radius in m)
        scope.shoreFoamWashParams = pb.vec4().uniform(2);
      }
      // (intensity, anisotropy, 0, 0)
      scope.sunScatterParams = pb.vec4().uniform(2);
      // Mip widths per meter of path the medium's scattering contributes to the
      // refraction blur. Resolved on the CPU from the per-channel scattering
      // coefficient, since the blur is one LOD for all three.
      scope.refractBlurDensity = pb.float().uniform(2);
      // Declared in both medium modes: the ramp only replaces the depth-driven
      // absorption and scattering, while the subsurface and sun-scattering terms
      // need the medium's hue and thickness regardless.
      scope.mediumAlbedo = pb.vec3().uniform(2);
      scope.mediumExtinction = pb.vec3().uniform(2);
      if (this.mediumMode === 'ramp') {
        scope.depthMulti = pb.float().uniform(2);
        scope.scatterRampTex = pb.tex2D().uniform(2);
        scope.absorptionRampTex = pb.tex2D().uniform(2);
      }
    }
    // An unbounded surface has no edge to clip against.
    if (!this.infinite) {
      scope.$l.discardable = pb.or(
        pb.any(pb.lessThan(scope.$inputs.worldPos.xz, scope.region.xy)),
        pb.any(pb.greaterThan(scope.$inputs.worldPos.xz, scope.region.zw))
      );
      scope.$if(scope.discardable, function () {
        pb.discard();
      });
    }
    if (this.needFragmentColor()) {
      scope.$l.normal = this.waveGenerator
        ? this.waveGenerator.calcFragmentNormalAndFoam(
            scope,
            scope.$inputs.clipmapPos.xz,
            scope.$inputs.worldNormal
          )
        : pb.vec4(scope.$inputs.worldNormal, 0);
      if (this.infinite) {
        // Flat and foamless across the horizon band. The skirt's world position
        // was never displaced, so evaluating waves from it would paint detail
        // the geometry does not have - and at kilometres per pixel that detail
        // is under-sampled into crawling speckle. The screen-space fog pass is
        // what should be visible here.
        scope.normal = pb.mix(scope.normal, pb.vec4(0, 1, 0, 0), scope.$inputs.skirt);
      }
      scope.$l.outColor = pb.vec4(
        this.waterShading(scope, scope.$inputs.worldPos, scope.normal.xyz, scope.normal.w),
        1
      );
      if (
        this.drawContext.materialFlags &
        (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
      ) {
        // The real roughness, not a constant 1, so SSR on another surface does
        // not treat a near-mirror sea as fully diffuse.
        scope.$l.outRoughness = pb.vec4(pb.vec3(this.waterRoughness(scope, scope.$inputs.worldPos)), 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          scope.outColor,
          scope.outRoughness,
          scope.outColor
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.outColor);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  /**
   * Specular roughness of the surface at a world position.
   *
   * Distance fades the wave normals flat, and this hands that lost slope to the
   * specular lobe instead of dropping it. Shared with the scene roughness buffer
   * so a surface reflecting the water sees the same value.
   */
  waterRoughness(scope: PBInsideFunctionScope, worldPos: PBShaderExp) {
    const pb = scope.$builder;
    pb.func('waterRoughness', [pb.vec3('worldPos')], function () {
      this.$l.dist = pb.length(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
      this.$l.normalScale = pb.clamp(pb.div(100, this.dist), 0, 1);
      this.$return(pb.mix(WATER_DISTANT_ROUGHNESS, WATER_BASE_ROUGHNESS, this.normalScale));
    });
    return scope.waterRoughness(worldPos) as PBShaderExp;
  }
  /**
   * Where to sample the scene behind the water, and how far the light travelled
   * through the medium to get there.
   *
   * Refracts the view ray by Snell's law, then marches that ray against the scene
   * depth: at each step it projects the current point back to the screen, reads
   * the depth there, and stops at the first point where the ray has passed into
   * the geometry that pixel shows. The incidence angle, the depth of the receiver
   * and the perspective foreshortening all fall out of that.
   *
   * Independent of the engine's depth convention: the projection only ever reads
   * `clip.xy / clip.w`, every depth comparison happens in view space, and
   * decoding the depth texture lives behind {@link ShaderHelper.sampleLinearDepth}.
   *
   * @param scope - Current shader scope
   * @param worldPos - Surface point being shaded
   * @param normal - Wave normal at that point, pointing up out of the water
   * @param eyeVecNorm - Normalized direction from the camera to the surface
   * @param screenUV - Screen UV of the surface point
   * @param surfaceViewZ - View-space z of the surface point
   * @param straightDepth01 - Normalized linear depth of the scene behind it
   * @param straightWorldPos - Unrefracted scene world position behind the surface
   * @param straightDist - Straight-line distance from the surface to that scene
   * @returns `vec3(uv, pathLength)` - where to sample, and the medium path in meters
   */
  waterRefraction(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    eyeVecNorm: PBShaderExp,
    screenUV: PBShaderExp,
    surfaceViewZ: PBShaderExp,
    straightDepth01: PBShaderExp,
    straightWorldPos: PBShaderExp,
    straightDist: PBShaderExp
  ) {
    const pb = scope.$builder;
    const march = this.refractionMode === 'march';
    // Screen UV of a world position, through the same matrix the surface itself
    // was rasterised with.
    //
    // Only ever used as a difference of two such UVs, which is what makes the
    // offset independent of the conventions baked into that matrix: the TAA
    // jitter and the clip-space Y orientation cancel between the two ends. The
    // 0.5/0.5 mapping is the inverse of ShaderHelper.samplePositionFromDepth's.
    pb.func('waterRefractProjectUV', [pb.vec3('worldPos')], function () {
      this.$l.h = pb.mul(ShaderHelper.getViewProjectionMatrix(this), pb.vec4(this.worldPos, 1));
      this.$return(pb.add(pb.mul(pb.div(this.h.xy, pb.max(this.h.w, 1e-6)), 0.5), pb.vec2(0.5)));
    });
    // Where to sample the scene colour for a refracted ray that ended at
    // `hitPos`, faded back to the straight-through sample at the screen border.
    pb.func(
      'waterRefractUV',
      [pb.vec2('screenUV'), pb.vec2('uvBase'), pb.vec3('hitPos'), pb.float('scale')],
      function () {
        this.$l.uv = pb.add(
          this.screenUV,
          pb.mul(pb.sub(this.waterRefractProjectUV(this.hitPos), this.uvBase), this.scale)
        );
        // Off screen there is no scene colour to refract, and a clamped sample
        // would smear one border pixel along the whole edge of the water.
        this.$l.edge = pb.min(
          pb.min(this.uv.x, pb.sub(1, this.uv.x)),
          pb.min(this.uv.y, pb.sub(1, this.uv.y))
        );
        this.$return(pb.mix(this.screenUV, this.uv, pb.clamp(pb.div(this.edge, REFRACT_EDGE_FADE), 0, 1)));
      }
    );
    // One step of the refracted-ray march.
    //
    // Projects the point `t` meters along the refracted ray to the screen, reads
    // the depth there, and reports the signed gap between the ray and that pixel
    // along the view axis: positive means the ray is still in front of the scene,
    // negative that it has passed through it. The hit test itself belongs to the
    // march.
    //
    // Declared only in `march` mode: a dead function still forces the depth
    // texture and the projection matrices into the bind group.
    if (march) {
      pb.func(
        'waterRefractStep',
        [
          pb.vec3('worldPos'),
          pb.vec3('refractDir'),
          pb.vec2('screenUV'),
          pb.vec2('uvBase'),
          pb.float('rayViewZ'),
          pb.float('cameraFar'),
          pb.float('t')
        ],
        function () {
          this.$l.uv = this.waterRefractUV(
            this.screenUV,
            this.uvBase,
            pb.add(this.worldPos, pb.mul(this.refractDir, this.t)),
            this.refractionScale
          );
          this.$l.linearDepth = ShaderHelper.sampleLinearDepth(
            this,
            ShaderHelper.getLinearDepthTexture(this),
            this.uv,
            0
          );
          // View-space z of whatever that pixel shows. The comparison below is in
          // view space, which the depth convention does not touch.
          this.$l.sceneViewZ = pb.mul(pb.neg(this.linearDepth), this.cameraFar);
          // Ray depth minus scene depth. Sky sits at the far plane, so over empty
          // water the gap stays large and positive and the march simply runs on.
          this.$return(pb.vec3(this.uv, pb.sub(this.rayViewZ, this.sceneViewZ)));
        }
      );
      // March the refracted ray and take the first crossing with the depth buffer.
      //
      // A hit is a step that lands inside a thickness band around the surface -
      // the ray is neither clearly in front of the scene nor already out the far
      // side. That two-sided test is what lets something poking out of the water
      // fall through: its depth is *nearest* the camera, so the gap is negative
      // from the first step and never enters the band. Stopping at the *first*
      // hit keeps a submerged object solid; a later one belongs to whatever is
      // behind it.
      pb.func(
        'waterRefractMarch',
        [
          pb.vec3('worldPos'),
          pb.vec3('refractDir'),
          pb.vec2('screenUV'),
          pb.vec2('uvBase'),
          pb.float('surfaceViewZ'),
          pb.float('refractStepZ'),
          pb.float('cameraFar'),
          pb.float('maxPath'),
          pb.float('basePath')
        ],
        function () {
          this.$l.step = pb.div(pb.sub(this.maxPath, 0.05), pb.float(REFRACT_MARCH_STEPS));
          this.$l.tPrev = pb.float(0.05);
          this.$l.gapPrev = pb.float(1);
          this.$l.hitUV = this.screenUV;
          this.$l.hitPath = this.basePath;
          this.$for(pb.float('i'), 0, REFRACT_MARCH_STEPS, function () {
            this.$l.t = pb.add(this.tPrev, this.step);
            this.$l.rayViewZ = pb.add(this.surfaceViewZ, pb.mul(this.refractStepZ, this.t));
            this.$l.s = this.waterRefractStep(
              this.worldPos,
              this.refractDir,
              this.screenUV,
              this.uvBase,
              this.rayViewZ,
              this.cameraFar,
              this.t
            );
            this.$l.gap = this.s.z;
            this.$if(
              pb.or(
                pb.lessThan(pb.abs(this.gap), REFRACT_MARCH_THICKNESS),
                pb.lessThan(pb.mul(this.gapPrev, this.gap), 0)
              ),
              function () {
                // Within the band, or the gap flipped sign this step: the ray is at
                // the surface. Interpolate down to the exact crossing so the sample
                // sits on the object instead of a step behind it.
                this.$l.k = pb.div(this.gapPrev, pb.sub(this.gapPrev, this.gap));
                this.hitUV = this.s.xy;
                this.hitPath = pb.mix(this.tPrev, this.t, this.k);
                this.$break();
              }
            ).$else(function () {
              this.tPrev = this.t;
              this.gapPrev = this.gap;
            });
          });
          // No hit on any step leaves the straight-through sample at the
          // straight-line path, which is what a ray over empty water should show.
          this.$return(pb.vec3(this.hitUV, this.hitPath));
        }
      );
    }
    pb.func(
      'waterRefraction',
      [
        pb.vec3('worldPos'),
        pb.vec3('normal'),
        pb.vec3('eyeVecNorm'),
        pb.vec2('screenUV'),
        pb.float('surfaceViewZ'),
        pb.float('straightDepth01'),
        pb.vec3('straightWorldPos'),
        pb.float('straightDist')
      ],
      function () {
        // Both faces are handled: looking down at the water the ray enters the
        // medium, looking up from inside it the ray leaves. The surface is drawn
        // with cullMode 'none' and the wave normal always points up, so the
        // normal is faced back towards the eye and the ratio picked to match.
        // Taken from `frontFacing`, since a flipped wave normal cannot tell an
        // underside from an eye below the surface.
        this.$l.underwater = pb.not(this.$builtins.frontFacing);
        this.$l.faceNormal = this.$choice(this.underwater, pb.neg(this.normal), this.normal);
        this.$l.eta = this.$choice(this.underwater, pb.float(WATER_TO_AIR_ETA), pb.float(AIR_TO_WATER_ETA));
        // The unrefracted hit: the view line through the surface to whatever is
        // behind it, which is what keeps the sample tracking the object rather
        // than wandering across a silhouette.
        this.$l.uvBase = this.waterRefractProjectUV(this.worldPos);
        // Sky behind the water (depth at the far plane) has no surface to refract
        // towards, so the unrefracted sample is the correct one.
        this.$if(pb.greaterThanEqual(this.straightDepth01, SCENE_SKY_DEPTH01), function () {
          this.$return(pb.vec3(this.screenUV, this.straightDist));
        });
        this.$l.waterCrossDir = pb.normalize(pb.sub(this.straightWorldPos, this.worldPos));
        // Refract the view ray twice - once through the wave normal, once through
        // a flat surface of the same facing - and use only the difference, added
        // to the view line. The result is the view line plus a wave-normal
        // perturbation, so on calm water the sample stays put and only the wave
        // tilt moves it. The flat normal carries the same facing flip as the wave
        // one so the two cancel exactly on calm water from either side.
        this.$l.refractWave = pb.refract(this.eyeVecNorm, this.faceNormal, this.eta);
        this.$l.refractFlatNormal = pb.vec3(0, pb.sign(this.faceNormal.y), 0);
        this.$l.refractFlat = pb.refract(this.eyeVecNorm, this.refractFlatNormal, this.eta);
        // Total internal reflection - only reachable from under the surface -
        // leaves refract returning zero, so degenerate to the view line.
        this.$l.refractDir = pb.add(this.waterCrossDir, pb.sub(this.refractWave, this.refractFlat));
        this.$if(pb.lessThan(pb.length(pb.sub(this.refractWave, this.refractFlat)), 1e-4), function () {
          this.refractDir = this.waterCrossDir;
        });
        // A degenerate view line would push the direction below; clamp it to stay
        // on the line if the difference vanished.
        this.$if(pb.lessThan(pb.dot(this.refractDir, this.refractDir), 1e-6), function () {
          this.refractDir = this.waterCrossDir;
        });
        this.refractDir = pb.normalize(this.refractDir);
        this.$l.refractUV = this.screenUV;
        this.$l.refractPath = this.straightDist;
        if (!march) {
          // Cheap mode: step a fixed distance along the refracted direction and
          // sample where that projects, with no search. `refractDir` is the view
          // line plus a wave-normal perturbation, so with no waves this lands on
          // the point behind the surface.
          //
          // The step length is a *fixed* depth scale, deliberately not the
          // distance to what is behind the water: that distance jumps across an
          // object's silhouette, and the larger offset outside the outline lands
          // back on the object and paints a second copy of it. The price is that
          // shallow and deep water refract by the same amount.
          //
          // The edge fade inside waterRefractUV still applies, so the sample
          // cannot walk off screen.
          this.refractUV = this.waterRefractUV(
            this.screenUV,
            this.uvBase,
            pb.add(this.worldPos, pb.mul(this.refractDir, this.cheapRefractionDepth)),
            this.refractionScale
          );
          this.$return(pb.vec3(this.refractUV, this.refractPath));
        } else {
          this.$l.refractDirView = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.refractDir, 0)).xyz;
          // Away from the camera the ray must travel, so a tangent one is clamped
          // rather than allowed to shoot off, and the straight-line distance bounds
          // the refracted path to a sane multiple of itself.
          this.$l.refractStepZ = pb.min(this.refractDirView.z, -1e-4);
          this.$l.maxPath = pb.mul(this.straightDist, REFRACT_MAX_PATH_RATIO);
          this.$l.marchResult = this.waterRefractMarch(
            this.worldPos,
            this.refractDir,
            this.screenUV,
            this.uvBase,
            this.surfaceViewZ,
            this.refractStepZ,
            ShaderHelper.getCameraParams(this).y,
            this.maxPath,
            this.straightDist
          );
          this.refractUV = this.marchResult.xy;
          this.refractPath = pb.clamp(this.marchResult.z, 0, this.maxPath);
          // Something sticking out of the water may occlude the refracted sample
          // even though the march kept going. Reconstruct the scene point at the
          // refracted UV and, if it sits above the surface, drop back to the
          // straight-through sample rather than refracting the object.
          this.$l.sceneHit = ShaderHelper.samplePositionFromDepth(
            this,
            ShaderHelper.getLinearDepthTexture(this),
            this.refractUV,
            ShaderHelper.getInvViewProjectionMatrix(this),
            ShaderHelper.getCameraParams(this).xy
          );
          // Only a *finite* scene point above the surface is an object poking
          // through - the sky's reconstructed point also sits high, but there is
          // nothing to reject then.
          this.$if(
            pb.and(pb.lessThan(this.sceneHit.w, 0.999), pb.greaterThan(this.sceneHit.y, this.worldPos.y)),
            function () {
              this.refractUV = this.screenUV;
              this.refractPath = this.straightDist;
            }
          );
          this.$return(pb.vec3(this.refractUV, this.refractPath));
        }
      }
    );
    return scope.waterRefraction(
      worldPos,
      normal,
      eyeVecNorm,
      screenUV,
      surfaceViewZ,
      straightDepth01,
      straightWorldPos,
      straightDist
    ) as PBShaderExp;
  }
  /**
   * Sunlight scattered out of the water column towards the eye.
   *
   * Closed-form single scattering, not a ray march. The medium is homogeneous
   * and the two paths through it are straight lines of fixed slope, so the
   * integral along the view ray has an elementary solution and costs one `exp`.
   *
   * Take `t` as distance along the refracted view ray from the surface, `d` as
   * its total length in the water, and `vy`/`sy` as how fast the view and sun
   * rays descend. A scattering event at `t` sits `t * vy` below the surface, so
   * the sun reached it over `t * vy / sy` and the scattered light returns over
   * `t`. Writing `r = vy / sy`:
   *
   * ```
   * S = integral(0..d) sigma_s * p * E * exp(-sigma_t * t * (1 + r)) dt
   *   = albedo * p * E * (1 - exp(-sigma_t * (1 + r) * d)) / (1 + r)
   * ```
   *
   * `sigma_t` cancels out of everything but the exponent, which leaves the
   * result finite for an unbounded column: looking straight down at deep water
   * under an overhead sun gives `albedo * p * E / 2`, the textbook value.
   *
   * `E` is the sun's irradiance perpendicular to its own beam; there is no `NoL`
   * here, because the geometry the cosine would describe is already in `r`. Both
   * directions are refracted through a flat surface first.
   *
   * Only the entry Fresnel is applied here. The exit transmission is common to
   * every term leaving the medium and is applied once by the caller.
   *
   * Assumes the eye is above the surface; the caller gates on that.
   *
   * @param scope - Current shader scope.
   * @param lightEnergy - Sun irradiance perpendicular to the beam, after shadowing.
   * @param lightDir - Unit vector from the surface towards the light.
   * @param eyeVecNorm - Unit vector from the camera towards the surface.
   * @param NoL - Cosine of the sun's incidence on the wave normal.
   * @param depth - Refracted path length through the medium, in meters.
   * @returns Radiance scattered towards the eye, before the exit Fresnel.
   */
  waterSunScattering(
    scope: PBInsideFunctionScope,
    lightEnergy: PBShaderExp,
    lightDir: PBShaderExp,
    eyeVecNorm: PBShaderExp,
    NoL: PBShaderExp,
    depth: PBShaderExp,
    foam: PBShaderExp
  ) {
    const pb = scope.$builder;
    pb.func(
      'waterSunScattering',
      [
        pb.vec3('lightEnergy'),
        pb.vec3('lightDir'),
        pb.vec3('eyeVecNorm'),
        pb.float('NoL'),
        pb.float('depth'),
        pb.float('foam')
      ],
      function () {
        this.$l.up = pb.vec3(0, 1, 0);
        // Both directions as they travel inside the water. The sun's incident
        // direction is where it travels to, the opposite of `lightDir`.
        this.$l.Lw = pb.refract(pb.neg(this.lightDir), this.up, AIR_TO_WATER_ETA);
        this.$l.Vw = pb.refract(this.eyeVecNorm, this.up, AIR_TO_WATER_ETA);
        // How fast each descends. The sun is floored rather than allowed to
        // reach zero: a sun on the horizon lights the column over an unbounded
        // path, which single scattering cannot represent.
        this.$l.sy = pb.max(pb.neg(this.Lw.y), MIN_SUN_SLOPE);
        this.$l.vy = pb.max(pb.neg(this.Vw.y), 1e-3);
        this.$l.r = pb.div(this.vy, this.sy);
        this.$l.rr = pb.add(1, this.r);
        // Angle between the sun's travel and the direction the light has to
        // leave in to reach the eye, which is back along the view ray.
        this.$l.cosTheta = pb.neg(pb.dot(this.Lw, this.Vw));
        this.$l.hg = waterScatterPhase(this, this.cosTheta, this.sunScatterParams.y);
        // Multiple scattering washes the lobe out: an optically thick column has
        // scattered the light enough times that the direction it entered by no
        // longer matters. Weighted on luminance and shared across channels,
        // because the phase does not depend on wavelength - only how far the
        // light got does.
        this.$l.lumWeights = pb.vec3(0.2126, 0.7152, 0.0722);
        this.$l.extLum = pb.dot(this.mediumExtinction, this.lumWeights);
        this.$l.albedoLum = pb.dot(this.mediumAlbedo, this.lumWeights);
        this.$l.thickness = pb.mul(
          this.albedoLum,
          pb.sub(1, pb.exp(pb.neg(pb.mul(this.extLum, this.depth))))
        );
        this.$l.phase = pb.mix(
          this.hg,
          1 / (4 * Math.PI),
          pb.smoothStep(0, 0.5, pb.clamp(this.thickness, 0, 1))
        );
        // The integral itself. Per channel, since sigma_t is.
        this.$l.k = pb.mul(this.mediumExtinction, this.rr);
        this.$l.integral = pb.div(pb.sub(pb.vec3(1), pb.exp(pb.neg(pb.mul(this.k, this.depth)))), this.rr);
        // Entry Fresnel: what the surface let through on the way in. This is
        // also what keeps the term off a backlit crest - at NoL <= 0 no light
        // enters the top face at all, and the subsurface term owns that case.
        this.$l.entry = pb.sub(1, pb.add(WATER_F0, pb.mul(1 - WATER_F0, pb.pow(pb.sub(1, this.NoL), 5))));
        // The flat-interface Fresnel goes to zero at grazing incidence, which is
        // right for smooth water and wrong for a fold - a mass of bubbles, not a
        // mirror. Blended towards full transmission by the foam coverage, so a
        // breaking crest lights its own column. Weighted, not replaced: a thin
        // scattering layer still attenuates.
        this.$l.entry = pb.mix(this.entry, pb.float(1), this.foam);
        this.$return(
          pb.mul(
            this.mediumAlbedo,
            this.lightEnergy,
            this.integral,
            pb.mul(this.phase, this.entry, this.sunScatterParams.x)
          )
        );
      }
    );
    return scope.waterSunScattering(lightEnergy, lightDir, eyeVecNorm, NoL, depth, foam) as PBShaderExp;
  }
  waterShading(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    foamFactor: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const ramp = this.mediumMode === 'ramp';
    const shoreFoam = this._shoreFoamAvailable(scope);
    const debugOutput = this.debugOutput;
    // Transmittance of the medium over `depth` meters of path.
    pb.func('getAbsorption', [pb.float('depth')], function () {
      if (ramp) {
        this.$l.c = pb.textureSampleLevel(
          this.absorptionRampTex,
          pb.vec2(pb.mul(this.depth, this.depthMulti), 0.5),
          0
        ).rgb;
        this.$return(pb.mul(this.c, this.c));
      } else {
        this.$return(pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.depth))));
      }
    });
    // Radiance scattered back out of the medium over `depth` meters of path,
    // as a fraction of the incident irradiance.
    pb.func('getScattering', [pb.float('depth')], function () {
      if (ramp) {
        this.$l.c = pb.textureSampleLevel(
          this.scatterRampTex,
          pb.vec2(pb.mul(this.depth, this.depthMulti), 0.5),
          0
        ).rgb;
        this.$return(pb.mul(this.c, this.c));
      } else {
        // Single-scattering: the albedo weighs how much of the extinguished
        // energy comes back rather than being absorbed.
        this.$return(
          pb.mul(
            this.mediumAlbedo,
            pb.sub(pb.vec3(1), pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.depth))))
          )
        );
      }
    });
    pb.func('fresnel', [pb.vec3('normal'), pb.vec3('eyeVec'), pb.bool('underwater')], function () {
      // The magnitude of the cosine: it changes sign when the view direction
      // crosses the normal, which a folded crest makes happen inside a single
      // wave. Clamping at zero instead drops the reflectance to F0 exactly where
      // the geometry is at its most grazing, giving a black band across the
      // crest.
      this.$l.NoV = pb.clamp(pb.abs(pb.dot(this.normal, this.eyeVec)), 0, 1);
      // Looking up at the underside, the interface behaves quite differently.
      // Past the critical angle - about 48.6 degrees off vertical for n = 1.333 -
      // Snell's law has no solution and nothing gets out at all: the surface is
      // a perfect mirror there, and the circle of sky inside that angle is the
      // Snell window.
      this.$if(this.underwater, function () {
        this.$l.sinT2 = pb.mul(WATER_TO_AIR_ETA * WATER_TO_AIR_ETA, pb.sub(1, pb.mul(this.NoV, this.NoV)));
        // Total internal reflection, and deliberately not scaled by
        // reflectionStrength. That knob exists to trade an above-water
        // reflection away for a view of the sea bed beneath it; from below there
        // is no transmitted ray to reveal, and dialling the mirror down there
        // just bleeds the straight-through sample - the world above the water -
        // across the whole surface outside the window, where physically nothing
        // is visible at all.
        this.$l.f = pb.float(1);
        this.$if(pb.lessThan(this.sinT2, 1), function () {
          // Schlick is written against the angle on the less dense side of the
          // interface, so the transmitted cosine is what goes in rather than the
          // incident one. F0 itself is unchanged: ((n1-n2)/(n1+n2))^2 is
          // symmetric in the two media.
          this.$l.cosT = pb.sqrt(pb.max(pb.sub(1, this.sinT2), 0));
          this.f = pb.clamp(
            pb.mul(
              pb.add(WATER_F0, pb.mul(1 - WATER_F0, pb.pow(pb.sub(1, this.cosT), 5))),
              this.reflectionStrength
            ),
            0,
            1
          );
        });
        this.$return(this.f);
      });
      this.$l.f = pb.add(WATER_F0, pb.mul(1 - WATER_F0, pb.pow(pb.sub(1, this.NoV), 5)));
      // Scaling keeps the term in [0,1] for any authored reflectionStrength.
      this.$return(pb.clamp(pb.mul(this.f, this.reflectionStrength), 0, 1));
    });
    pb.func(
      'lightSpecular',
      [
        pb.vec3('lightDir'),
        pb.vec3('eyeVecNorm'),
        pb.vec3('normal'),
        pb.vec3('lightColor'),
        pb.float('roughness')
      ],
      function () {
        this.$l.f0 = pb.vec3(WATER_F0);
        this.$l.f90 = pb.vec3(1);
        this.$l.L = this.lightDir;
        this.$l.V = pb.neg(this.eyeVecNorm);
        this.$l.halfVec = pb.normalize(pb.add(this.L, this.V));
        this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.L), 0, 1);
        this.$l.specular = pb.vec3(0);
        this.$if(pb.greaterThan(this.NoL, 0), function () {
          this.$l.VoH = pb.clamp(pb.dot(this.V, this.halfVec), 0, 1);
          this.$l.NoV = pb.clamp(pb.dot(this.normal, this.V), 0, 1);
          this.$l.F = fresnelSchlick(this, this.VoH, this.f0, this.f90);
          this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
          this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
          this.$l.VIS = visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
          this.specular = pb.mul(this.D, this.VIS, this.F, this.lightColor);
        });
        this.$return(this.specular);
      }
    );
    if (shoreFoam) {
      // Three octaves of value noise over the world XZ plane, drifting slowly.
      // World space rather than screen or surface space, so the pattern does not
      // slide over the band as the camera moves.
      pb.func('waterShoreFoamPattern', [pb.vec2('xz'), pb.float('time')], function () {
        // Drift applied in meters before the frequency, so changing the clump
        // size does not change how fast they travel.
        this.$l.p = pb.mul(
          pb.add(this.xz, pb.mul(pb.vec2(SHORE_FOAM_DRIFT_X, SHORE_FOAM_DRIFT_Z), this.time)),
          this.shoreFoamParams.w
        );
        this.$return(
          pb.add(
            pb.mul(valueNoise(this, this.p), SHORE_FOAM_OCTAVE_WEIGHTS[0]),
            // Offset as well as scaled: octaves sharing a lattice line their
            // features up at the cell corners.
            pb.mul(
              valueNoise(this, pb.add(pb.mul(this.p, SHORE_FOAM_OCTAVE_RATIO), pb.vec2(13.7, 7.3))),
              SHORE_FOAM_OCTAVE_WEIGHTS[1]
            ),
            pb.mul(
              valueNoise(
                this,
                pb.add(pb.mul(this.p, SHORE_FOAM_OCTAVE_RATIO * SHORE_FOAM_OCTAVE_RATIO), pb.vec2(5.1, 29.3))
              ),
              SHORE_FOAM_OCTAVE_WEIGHTS[2]
            )
          )
        );
      });
      // Distance from the water surface to the nearest opaque surface anywhere
      // around it, through the Hi-Z pyramid's nearest-depth channel.
      //
      // A *neighbourhood* query rather than a lookup along the view ray. Beside
      // a piling the ray hits its side just under the waterline, so a pixel far
      // from the piling reads as touching it while the closer pixels to its left
      // and right see past it entirely - the geometry those pixels need is not
      // on their ray at all.
      //
      // The pyramid is what makes the neighbourhood affordable: one cell at the
      // right level summarises the whole footprint, so the sample count does not
      // grow with the radius, and the nearest-depth reduction means a cell the
      // query covers cannot hide geometry from it.
      //
      // Reports a distance past the band's reach when the neighbourhood is
      // empty, so the caller's ramp reads it as "outside the band" without a
      // separate miss flag.
      pb.func(
        'waterShoreProximity',
        [pb.vec3('viewPos'), pb.vec2('screenUV'), pb.float('radius')],
        function () {
          this.$l.renderSize = ShaderHelper.getRenderSize(this);
          this.$l.projMatrix = ShaderHelper.getProjectionMatrix(this);
          // Screen radius, in pixels, of a sphere of `radius` metres at this
          // depth. proj[0].x is the horizontal projection scale, and the NDC
          // half-extent maps onto half the render width.
          this.$l.viewDist = pb.max(pb.neg(this.viewPos.z), 1e-4);
          this.$l.pixelRadius = pb.mul(
            pb.div(pb.mul(this.radius, this.projMatrix[0].x), this.viewDist),
            0.5,
            this.renderSize.x
          );
          // Level whose texel spans the query footprint divided by the tap
          // spread, so the 3x3 grid covers roughly the whole sphere. Floored to
          // an integer: the pyramid is sampled with a nearest mip filter, and a
          // fractional level would show up as a seam across the band.
          this.$l.level = pb.clamp(
            pb.floor(pb.log2(pb.max(pb.div(this.pixelRadius, SHORE_QUERY_TAP_SPREAD), 1))),
            0,
            pb.sub(pb.float(ShaderHelper.getHiZDepthTextureMipLevelCount(this)), 1)
          );
          this.$l.mipSize = pb.max(pb.floor(pb.div(this.renderSize, pb.exp2(this.level))), pb.vec2(1));
          this.$l.texelStep = pb.div(pb.vec2(1), this.mipSize);
          // Every cell in a 4x4 window contributes, weighted by a tent reaching
          // zero at the window's edge, and each is read as a point dithered
          // somewhere inside it.
          //
          // The tent makes the window's own stepping invisible: the column of
          // cells leaving and the one arriving both have zero weight there. The
          // pyramid is bound with a nearest sampler - SSR's traversal needs exact
          // cell values - so this smoothing has to happen here.
          //
          // The dither keeps the contours round. A cell is a box, and the
          // distance to a box has square contours; at these levels a cell is most
          // of the radius across, so what is left is a grid of squares. Picking a
          // point inside the cell is what the cell's own statement licenses.
          //
          // Hashed from the pixel *and* the frame counter, and applied to the
          // interpretation of the samples rather than to which samples are
          // taken: the fetches stay identical frame to frame while the guess
          // moves, which is what lets TAA average the residual grain away.
          this.$l.dither = pb.mul(pb.float(ShaderHelper.getFramestamp(this)), SHORE_QUERY_DITHER_STRIDE);
          this.$l.gridCoord = pb.sub(pb.mul(this.screenUV, this.mipSize), pb.vec2(0.5));
          this.$l.gridBase = pb.floor(this.gridCoord);
          this.$l.gridFrac = pb.sub(this.gridCoord, this.gridBase);
          // Softness of the minimum below, and the distance a neighbourhood with
          // nothing in it resolves to. Both scale with the radius, so the query
          // behaves the same whatever the band is set to.
          this.$l.softK = pb.mul(this.radius, SHORE_QUERY_SOFTMIN);
          this.$l.dMax = pb.mul(this.radius, SHORE_QUERY_MISS_REACH);
          this.$l.esum = pb.float(0);
          this.$l.wsum = pb.float(0);
          for (let gy = 0; gy < 4; gy++) {
            for (let gx = 0; gx < 4; gx++) {
              this.$l[`uv${gx}${gy}`] = pb.mul(
                pb.add(this.gridBase, pb.vec2(gx - 1 + 0.5, gy - 1 + 0.5)),
                this.texelStep
              );
              this.$l[`hiz${gx}${gy}`] = pb.textureSampleLevel(
                ShaderHelper.getHiZDepthTexture(this),
                this[`uv${gx}${gy}`],
                this.level
              );
              this.$l[`z${gx}${gy}`] = ShaderHelper.nonLinearDepthToLinear(this, this[`hiz${gx}${gy}`].g);
              this.$l[`zFar${gx}${gy}`] = ShaderHelper.nonLinearDepthToLinear(this, this[`hiz${gx}${gy}`].r);
              // A cell says "some surface lies inside this screen rectangle, at
              // a depth between near and far" - a frustum block. Collapsing that
              // to the point on the centre ray at the near depth puts a cell
              // straddling a silhouette beside the object in empty space, nearer
              // to the water than the object itself.
              //
              // Laterally the point is dithered across the cell instead, which
              // invents nothing: any spot in the cell is somewhere the surface
              // could be. In depth it is clamped, because the reduction
              // guarantees a surface on the near face, and the span is clipped by
              // SHORE_QUERY_CELL_DEPTH_SPAN.
              this.$l[`cellW${gx}${gy}`] = pb.max(
                pb.div(pb.mul(this.texelStep.x, 2, this[`z${gx}${gy}`]), this.projMatrix[0].x),
                1e-6
              );
              this.$l[`zBack${gx}${gy}`] = pb.min(
                this[`zFar${gx}${gy}`],
                pb.add(this[`z${gx}${gy}`], pb.mul(this[`cellW${gx}${gy}`], SHORE_QUERY_CELL_DEPTH_SPAN))
              );
              // How far outside the block's depth range the water pixel sits.
              // Zero while it is between the two faces.
              this.$l[`zClamp${gx}${gy}`] = pb.clamp(
                pb.neg(this.viewPos.z),
                this[`z${gx}${gy}`],
                this[`zBack${gx}${gy}`]
              );
              this.$l[`dz${gx}${gy}`] = pb.add(this.viewPos.z, this[`zClamp${gx}${gy}`]);
              // Seeded per cell as well as per pixel: one offset shared by all
              // sixteen would move the whole set together.
              this.$l[`jit${gx}${gy}`] = pb.sub(
                pb.vec2(
                  interleavedGradientNoise(
                    this,
                    pb.add(
                      this.$builtins.fragCoord.xy,
                      pb.vec2(pb.add(this.dither, gx * 7.13 + 0.5), pb.add(this.dither, gy * 3.71 + 0.5))
                    )
                  ),
                  interleavedGradientNoise(
                    this,
                    pb.add(
                      this.$builtins.fragCoord.xy,
                      pb.vec2(pb.add(this.dither, gy * 3.71 + 37), pb.add(this.dither, gx * 7.13 + 17))
                    )
                  )
                ),
                pb.vec2(0.5)
              );
              this.$l[`guessNDC${gx}${gy}`] = pb.sub(
                pb.mul(pb.add(this[`uv${gx}${gy}`], pb.mul(this[`jit${gx}${gy}`], this.texelStep)), 2),
                pb.vec2(1)
              );
              this.$l[`guess${gx}${gy}`] = pb.div(
                pb.mul(this[`guessNDC${gx}${gy}`], this[`zClamp${gx}${gy}`]),
                pb.vec2(this.projMatrix[0].x, this.projMatrix[1].y)
              );
              this.$l[`dxy${gx}${gy}`] = pb.sub(this.viewPos.xy, this[`guess${gx}${gy}`]);
              this.$l[`d${gx}${gy}`] = pb.length(pb.vec3(this[`dxy${gx}${gy}`], this[`dz${gx}${gy}`]));
              // Tent weight, from the cell's offset to the pixel in cell units.
              // Zero at two cells out, which is the edge of the 4x4 window, so a
              // cell entering or leaving the window does so from nothing.
              this.$l[`w${gx}${gy}`] = pb.mul(
                pb.max(pb.sub(1, pb.abs(pb.div(pb.sub(pb.float(gx - 1), this.gridFrac.x), 2))), 0),
                pb.max(pb.sub(1, pb.abs(pb.div(pb.sub(pb.float(gy - 1), this.gridFrac.y), 2))), 0)
              );
              this.wsum = pb.add(this.wsum, this[`w${gx}${gy}`]);
              this.esum = pb.add(
                this.esum,
                pb.mul(
                  this[`w${gx}${gy}`],
                  pb.exp(pb.neg(pb.div(pb.min(this[`d${gx}${gy}`], this.dMax), this.softK)))
                )
              );
            }
          }
          // Weighted soft minimum, not a hard one. A hard `min` lets one cell
          // decide the answer outright, so the band comes out in squares that
          // step on cell boundaries. Averaging lets a cell losing its claim cost
          // only its share and lets the dither average down. It still reads as a
          // distance: below a few times `softK` it tracks the true minimum
          // closely.
          this.$return(pb.mul(pb.neg(this.softK), pb.log(pb.div(this.esum, this.wsum))));
        }
      );
      // Coverage of the foam that collects where the water meets a surface, and
      // how far that surface is, as (coverage, distance).
      pb.func('waterShoreFoam', [pb.vec3('worldPos'), pb.vec3('viewPos'), pb.vec2('screenUV')], function () {
        this.$l.time = ShaderHelper.getElapsedTime(this);
        // Queried at the band's widest reach rather than its current one, so the
        // run-up below moves the edge without moving the mip level under it -
        // which would step the whole band's resolution once a cycle.
        this.$l.surfaceDist = this.waterShoreProximity(
          this.viewPos,
          this.screenUV,
          this.shoreFoamWashParams.w
        );
        // Where the band currently reaches out to, modulated over time by the
        // run-up. The phase offset comes from a noise field over the world plane
        // rather than from a direction: the query does not know where the shore
        // runs, and a guessed axis reads as a diagonal swell crossing the beach.
        this.$l.washOffset = valueNoise(this, pb.mul(this.worldPos.xz, this.shoreFoamWashParams.z));
        this.$l.wash = pb.sin(
          pb.mul(pb.add(pb.mul(this.time, this.shoreFoamWashParams.y), this.washOffset), 2 * Math.PI)
        );
        this.$l.edge = pb.max(
          pb.mul(this.shoreFoamParams.y, pb.add(1, pb.mul(this.shoreFoamWashParams.x, this.wash))),
          0
        );
        this.$l.soft = pb.max(pb.mul(this.edge, SHORE_FOAM_EDGE_SOFTNESS), 1e-4);
        // The gradient runs *up to* the reach, not across it: `edge` is where the
        // band ends, so coverage must be zero there. Straddling `edge` would put
        // a total miss at the middle of the ramp, which is half coverage over the
        // entire open sea.
        this.$l.ramp = pb.sub(1, pb.smoothStep(pb.sub(this.edge, this.soft), this.edge, this.surfaceDist));
        // Open water, which is almost every water pixel in almost every frame,
        // is done here and does not pay for the pattern.
        this.$if(pb.lessThanEqual(this.ramp, 0), function () {
          this.$return(pb.vec2(0, this.surfaceDist));
        });
        this.$l.pattern = this.waterShoreFoamPattern(this.worldPos.xz, this.time);
        this.$l.coverage = pb.clamp(
          pb.div(pb.sub(this.ramp, pb.mul(this.pattern, SHORE_FOAM_NOISE_BITE)), 1 - SHORE_FOAM_NOISE_BITE),
          0,
          1
        );
        this.$return(
          pb.vec2(
            pb.clamp(pb.mul(pb.pow(this.coverage, this.shoreFoamParams.z), this.shoreFoamParams.x), 0, 1),
            this.surfaceDist
          )
        );
      });
    }
    pb.func(
      'waterShading',
      [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('foamFactor')],
      function () {
        this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), ShaderHelper.getRenderSize(this));
        this.$l.dist = pb.length(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.$l.normalScale = pb.clamp(pb.div(100, this.dist), 0, 1);
        this.$l.normal = pb.normalize(
          pb.mul(this.worldNormal, pb.vec3(this.normalScale, 1, this.normalScale))
        );
        this.$l.roughness = that.waterRoughness(this, this.worldPos);
        this.$l.wPos = ShaderHelper.samplePositionFromDepth(
          this,
          ShaderHelper.getLinearDepthTexture(this),
          this.screenUV,
          ShaderHelper.getInvViewProjectionMatrix(this),
          ShaderHelper.getCameraParams(this).xy
        );
        this.$l.eyeVec = pb.sub(this.worldPos.xyz, ShaderHelper.getCameraPosition(this));
        this.$l.eyeVecNorm = pb.normalize(this.eyeVec);
        // The normal the mirror-like terms use - Fresnel, the reflection vector,
        // the specular lobe - turned towards the eye where the surface has
        // folded far enough to show its underside.
        //
        // Flipped on the sign of the cosine against the view direction, not on
        // `frontFacing`: the rasteriser's answer changes discontinuously along
        // the triangle edge where the fold happens, so the flipped normal jumps
        // by 2*N there and every term built on it steps with it. The cosine
        // crosses zero continuously.
        //
        // `eyeVecNorm` runs from the camera to the surface, so a face turned
        // towards the eye has a *negative* dot against it and the flip is the
        // positive case.
        this.$l.shadingNormal = this.$choice(
          pb.greaterThan(pb.dot(this.normal, this.eyeVecNorm), 0),
          pb.neg(this.normal),
          this.normal
        );
        // The normal the diffuse terms use, which is not the wave normal.
        //
        // Where a choppy displacement folds the surface the cross-product normal
        // is genuinely close to horizontal. That is the right normal for the
        // mirror - the specular lobe and the refraction go by the face's true
        // orientation - and the wrong one for anything lit diffusely: the sun is
        // nearly perpendicular to a folded wall, so a diffuse term built on it
        // loses the sun completely.
        //
        // Built on the eye-facing normal and then mixed towards up, so the two
        // corrections compose. The weight rises with |normal.y|: at |y| = 1 the
        // wave normal is kept exactly, and as the face tips over the up vector
        // takes it back. A smoothstep rather than |normal.y| itself, which would
        // stay dominated by the wall normal exactly where it is least wanted.
        this.$l.diffuseWeight = pb.smoothStep(0, 0.5, pb.abs(this.normal.y));
        this.$l.diffuseNormal = pb.normalize(
          pb.mix(pb.vec3(0, 1, 0), this.shadingNormal, this.diffuseWeight)
        );
        // Which face of the surface the camera is on. Taken from the rasteriser,
        // not from the wave normal: the choppy displacement folds the sheet, so
        // the pixels showing its underside also carry an upward normal, and a
        // test built on the normal would put every term on the wrong side of the
        // interface there.
        this.$l.frontFace = this.$builtins.frontFacing;
        this.$l.backFace = pb.not(this.frontFace);
        this.$l.underwaterEye = this.backFace;
        this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.worldPos));
        this.$l.viewPos = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.worldPos, 1)).xyz;
        this.incidentVec = pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.reflectVecW = pb.reflect(this.incidentVec, this.shadingNormal);
        this.$l.reflectance = pb.vec3();
        this.$l.hitInfo = pb.vec4(0);
        // Which way a reflection has to go to have anything to hit. From above
        // that is upwards, off the surface into the sky; from below it is
        // downwards, back into the water. Testing for "up" regardless meant a
        // submerged pixel never traced at all and fell through to the sky bake,
        // which is the one thing that cannot be behind a surface seen from
        // underneath.
        this.$if(
          this.$choice(
            this.underwaterEye,
            pb.lessThan(this.reflectVecW.y, 0),
            pb.greaterThan(this.reflectVecW.y, 0)
          ),
          function () {
            this.reflectVec = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.reflectVecW, 0)).xyz;
            this.hitInfo = ShaderHelper.getHiZDepthTexture(this)
              ? screenSpaceRayTracing_HiZ(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  ShaderHelper.getViewMatrix(this),
                  ShaderHelper.getProjectionMatrix(this),
                  ShaderHelper.getInvProjectionMatrix(this),
                  ShaderHelper.getCameraParams(this).xy,
                  pb.int(ShaderHelper.getHiZDepthTextureMipLevelCount(this)),
                  this.ssrParams.y,
                  this.ssrParams.x,
                  this.ssrParams.z,
                  pb.vec4(ShaderHelper.getRenderSize(this), ShaderHelper.getHiZDepthTextureSize(this)),
                  ShaderHelper.getHiZDepthTexture(this)
                )
              : screenSpaceRayTracing_Linear2D(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  ShaderHelper.getViewMatrix(this),
                  ShaderHelper.getProjectionMatrix(this),
                  ShaderHelper.getInvProjectionMatrix(this),
                  ShaderHelper.getCameraParams(this).xy,
                  this.ssrParams.x,
                  this.ssrParams.y,
                  this.ssrParams.z,
                  this.ssrParams.w,
                  pb.vec4(ShaderHelper.getRenderSize(this), ShaderHelper.getLinearDepthTextureSize(this)),
                  ShaderHelper.getLinearDepthTexture(this)
                );
          }
        );
        this.$l.refl = pb.reflect(
          pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this))),
          this.shadingNormal
        );
        // What the mirror shows where the screen-space trace found nothing.
        //
        // From above that is the sky. Rays reflecting downwards, and grazing
        // ones, land on the bake's lower hemisphere, which the atmosphere
        // renders nearly black, so the far ocean reads as a dark band. Flooring
        // the y and re-normalising pins those directions just above the horizon,
        // which is roughly what a grazing reflection does see; a reflection
        // already pointing into the sky is untouched. A floor rather than a soft
        // lift, so only the degenerate directions are nudged.
        //
        // From below there is no sky in that direction at all - the ray is
        // heading back down into the water - and what it eventually reaches is
        // the water itself. That is the medium's asymptotic colour, the same
        // limit the underwater pass converges to as the path length grows:
        // albedo * (1 - exp(-sigma_t * d)) * ambient with the exponential gone.
        // Sampling the sky bake there instead put a bright sky outside the Snell
        // window, which is exactly where nothing above the surface is visible.
        this.$l.reflMiss = pb.vec3();
        this.$if(this.underwaterEye, function () {
          this.$l.downwelling = ShaderHelper.sampleBakedSkyPreExposed(this, pb.vec3(0, 1, 0));
          this.reflMiss = pb.mul(this.mediumAlbedo, this.downwelling);
        }).$else(function () {
          this.refl.y = pb.max(this.refl.y, HORIZON_REFLECT_BIAS);
          this.refl = pb.normalize(this.refl);
          // Blended against the pre-exposed scene color, so the exposure-independent sky bake has
          // to be lifted into the same space.
          this.reflMiss = ShaderHelper.sampleBakedSkyPreExposed(this, this.refl);
        });
        this.reflectance = pb.mix(
          this.reflMiss,
          pb.textureSampleLevel(ShaderHelper.getSceneColorTexture(this), this.hitInfo.xy, 0).rgb,
          this.hitInfo.w
        );
        this.$l.refractInfo = that.waterRefraction(
          this,
          this.worldPos,
          this.normal,
          this.eyeVecNorm,
          this.screenUV,
          this.viewPos.z,
          this.wPos.w,
          this.wPos.xyz,
          this.depth
        );
        this.$l.refractUV = this.refractInfo.xy;
        // The medium is walked along the refracted path, not along the straight
        // line to the bed. A refracted ray reaches the same depth over a shorter
        // distance, and at a grazing view the two differ by a lot.
        this.depth = this.refractInfo.z;
        // How blurred what is behind the water reads. Scattering in the column
        // deflects the transmitted ray at every event, so the image arriving at
        // the surface is a convolution whose width grows with the optical depth;
        // sampling a coarser mip is the cheap stand-in for that.
        //
        // Log in the path length because each mip is a doubling of the filter
        // width, and driven by the *scattering* coefficient rather than the
        // extinction: absorption removes light without redirecting it, so it
        // darkens the background without blurring it.
        //
        // Zero from below. The ray leaving the underside travels through air to
        // whatever it reaches, so there is no medium along it to blur or absorb
        // with - what the eye already looked through to get here is the volume
        // the Underwater pass owns, and charging the same column twice turned
        // the world seen through the Snell window into a dark smear.
        this.$l.mediumPath = this.$choice(this.underwaterEye, pb.float(0), this.depth);
        this.$l.refractBlur = pb.log2(
          pb.add(1, pb.mul(this.mediumPath, pb.add(REFRACT_BLUR_GEOMETRIC, this.refractBlurDensity)))
        );
        this.$l.refraction = pb.textureSampleLevel(
          ShaderHelper.getSceneColorTexture(this),
          this.refractUV,
          pb.clamp(this.refractBlur, 0, REFRACT_BLUR_MAX_LOD)
        ).rgb;
        this.$l.refractionRaw = this.refraction;
        this.$l.absorption = this.getAbsorption(this.mediumPath);
        this.refraction = pb.mul(this.refraction, this.absorption);
        this.$l.fresnelTerm = this.fresnel(this.shadingNormal, pb.neg(this.eyeVecNorm), this.underwaterEye);
        // Foam coverage. The generator reports where the surface has folded over
        // on itself; the ramp turns that into how much of the texel is covered.
        this.$l.crestFoam = pb.clamp(
          pb.mul(pb.pow(pb.clamp(this.foamFactor, 0, 1), this.foamShadingParams.y), this.foamShadingParams.x),
          0,
          1
        );
        // (coverage, distance to the nearest surface around the pixel). The
        // distance is carried out for the debug view; the shading only wants x.
        this.$l.shoreFoamInfo = shoreFoam
          ? (this.waterShoreFoam(this.worldPos, this.viewPos, this.screenUV) as PBShaderExp)
          : pb.vec2(0, 0);
        this.$l.shoreFoam = this.shoreFoamInfo.x;
        // Two independent coverages of the same texel, so they compose as
        // overlapping area: `max` would ignore the smaller source entirely and
        // adding would run past 1.
        this.$l.foam = pb.sub(1, pb.mul(pb.sub(1, this.crestFoam), pb.sub(1, this.shoreFoam)));
        // Foam suppresses the specular lobe rather than adding to it: where it is
        // thick the mirror underneath stops being visible at all.
        this.fresnelTerm = pb.mul(this.fresnelTerm, pb.sub(1, this.foam));
        this.$l.finalColor = pb.mix(this.refraction, this.reflectance, this.fresnelTerm);
        // Per-term accumulators for the debug views. Dead in the `none` variant.
        this.$l.dbgSpecular = pb.vec3(0);
        this.$l.dbgNoL = pb.float(0);
        this.$l.dbgShadow = pb.vec3(1);
        this.$l.dbgSubsurface = pb.vec3(0);
        this.$l.dbgSunScatter = pb.vec3(0);
        this.$l.dbgScatter = pb.vec3(0);
        // What anything leaving the water body keeps on its way out, and the
        // share of the surface that is water rather than foam. The refraction
        // above already carries the first factor via the `mix`; every scattering
        // term below has to carry it too.
        this.$l.bodyWeight = pb.mul(pb.sub(1, this.fresnelTerm), pb.sub(1, this.foam));
        // The sun-scattering debug views below rebuild that term's factors, and
        // the light direction is only known inside this loop. Initialised so the
        // views are well defined even with no directional light in the scene.
        this.dbgLightDir = pb.vec3(0, 1, 0);
        that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
          this.$l.lightAtten = that.calculateLightAttenuation(
            this,
            type,
            this.worldPos,
            posRange,
            dirCutoff,
            extra
          );
          this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
          // Left behind for the sun-scattering debug views, which rebuild that
          // term's factors outside this loop.
          this.dbgLightDir = this.lightDir;
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          // Diffuse incidence, off the diffuse normal. Used by the foam and the
          // sun in-scattering below; NoL keeps the wave face for the mirror.
          this.$l.NoLdiffuse = pb.clamp(pb.dot(this.diffuseNormal, this.lightDir), 0, 1);
          this.dbgNoL = this.NoLdiffuse;
          this.$l.lightEnergy = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
          this.$l.specularTerm = this.lightSpecular(
            this.lightDir,
            this.eyeVecNorm,
            this.shadingNormal,
            this.lightEnergy,
            this.roughness
          );
          this.$l.lightContrib = this.specularTerm;
          // Sunlight that entered the far side of a wave and scattered back out
          // towards the eye - what makes a backlit crest glow. It has to come
          // from the light loop: the ambient scattering term below is built from
          // the environment irradiance, which has no direction.
          //
          // Standard translucency approximation - the transmitted direction is
          // the light continuing through the surface, bent by the normal, and
          // the term peaks when the eye looks back along it.
          this.$l.sssDir = pb.normalize(
            pb.add(pb.neg(this.lightDir), pb.mul(this.diffuseNormal, SSS_DISTORTION))
          );
          this.$l.sssFacing = pb.pow(pb.clamp(pb.dot(pb.neg(this.eyeVecNorm), this.sssDir), 0, 1), SSS_POWER);
          // Crests glow and troughs do not: height above the undisplaced surface
          // stands in for how much lit water the ray passed through. The medium's
          // albedo carries the hue; the magnitude is authored.
          this.$l.sssThickness = pb.clamp(
            pb.mul(pb.sub(1, this.diffuseNormal.y), this.subsurfaceParams.y),
            0,
            1
          );
          this.$l.subsurfaceTerm = pb.mul(
            this.lightEnergy,
            this.mediumAlbedo,
            pb.mul(this.sssFacing, this.sssThickness, this.subsurfaceParams.x)
          );
          this.lightContrib = pb.add(this.lightContrib, this.subsurfaceTerm);
          // Sunlight scattered back out of the water column, which is what gives
          // the body a direction-dependent colour at all.
          //
          // Directional only, and only with the eye above the surface. The
          // integral assumes a parallel beam of fixed slope; a point light's
          // falloff along the column and the underwater geometry both need a
          // different solution. The refraction and the ambient scattering still
          // carry the water colour in those cases.
          this.$l.sunScatterTerm = pb.vec3(0);
          this.$if(pb.and(pb.equal(type, LIGHT_TYPE_DIRECTIONAL), pb.not(this.underwaterEye)), function () {
            // Weighted by what the surface transmits on the way out and by how
            // much of it is still water rather than foam, like every other
            // term that comes from inside the body.
            this.sunScatterTerm = pb.mul(
              that.waterSunScattering(
                this,
                this.lightEnergy,
                this.lightDir,
                this.eyeVecNorm,
                this.NoLdiffuse,
                this.depth,
                this.foam
              ),
              this.bodyWeight
            );
            this.lightContrib = pb.add(this.lightContrib, this.sunScatterTerm);
          });
          // Foam is a rough dielectric layer, so it takes the light the way any
          // matte surface does.
          this.lightContrib = pb.add(
            this.lightContrib,
            pb.mul(this.lightEnergy, this.foamColor, this.foam, this.NoLdiffuse, 1 / Math.PI)
          );
          this.$l.shadow = pb.vec3(1);
          if (shadow) {
            // Water is a horizontal clipmap, so +Y is the geometric normal. The
            // wave normal would jitter the shadow lookup per-pixel.
            this.shadow = pb.vec3(that.calculateShadow(this, this.worldPos, pb.vec3(0, 1, 0), this.NoL));
            this.dbgShadow = this.shadow;
            this.lightContrib = pb.mul(this.lightContrib, this.shadow);
          }
          this.finalColor = pb.add(this.finalColor, this.lightContrib);
          this.dbgSpecular = pb.add(this.dbgSpecular, pb.mul(this.specularTerm, this.shadow));
          this.dbgSubsurface = pb.add(this.dbgSubsurface, pb.mul(this.subsurfaceTerm, this.shadow));
          this.dbgSunScatter = pb.add(this.dbgSunScatter, pb.mul(this.sunScatterTerm, this.shadow));
        });
        if (that.needCalculateEnvLight()) {
          this.$l.irradiance = that.getEnvLightIrradiance(this, this.diffuseNormal);
          // Scattering from the water body itself, and from the foam sitting on
          // it. `bodyWeight` is what the surface transmits on the way out times
          // the share of it that is still water.
          //
          // On the same path length the absorption uses, so this vanishes from
          // below: the column the eye is already inside belongs to the
          // Underwater pass, and adding the surface's own estimate of it on top
          // paints the water colour twice. The foam term below is unconditional
          // - a crest that has broken is white from underneath too.
          this.$l.sss = pb.mul(
            this.getScattering(this.mediumPath),
            this.irradiance,
            this.bodyWeight,
            1 / Math.PI
          );
          this.finalColor = pb.add(this.finalColor, this.sss);
          this.dbgScatter = this.sss;
          this.finalColor = pb.add(
            this.finalColor,
            pb.mul(this.irradiance, this.foamColor, this.foam, 1 / Math.PI)
          );
        }
        switch (debugOutput) {
          case 'normal':
            this.$return(pb.add(pb.mul(this.normal, 0.5), pb.vec3(0.5)));
            break;
          case 'diffuseNormal':
            this.$return(pb.add(pb.mul(this.diffuseNormal, 0.5), pb.vec3(0.5)));
            break;
          case 'frontFacing':
            this.$return(this.$choice(this.$builtins.frontFacing, pb.vec3(1), pb.vec3(0)));
            break;
          case 'viewFacing': {
            // Raw, not clamped: a negative value means the wave normal faces
            // away from the eye at that pixel.
            this.$l.viewFacing = pb.dot(this.normal, pb.neg(this.eyeVecNorm));
            this.$return(pb.vec3(this.viewFacing));
            break;
          }
          case 'foam':
            this.$return(pb.vec3(this.foam));
            break;
          case 'shoreFoam':
            this.$return(pb.vec3(this.shoreFoam));
            break;
          case 'waterDepth':
            // Distance from the surface to whatever is behind it, metres / 10.
            // With the band switched off there is no such estimate, so the plain
            // height difference stands in.
            this.$return(
              pb.vec3(
                pb.mul(
                  shoreFoam ? this.shoreFoamInfo.y : pb.max(pb.sub(this.worldPos.y, this.wPos.y), 0),
                  0.1
                )
              )
            );
            break;
          case 'fresnel':
            this.$return(pb.vec3(this.fresnelTerm));
            break;
          case 'reflection':
            this.$return(this.reflectance);
            break;
          case 'refraction':
            this.$return(this.refractionRaw);
            break;
          case 'absorption':
            this.$return(this.absorption);
            break;
          case 'scattering':
            this.$return(this.dbgScatter);
            break;
          case 'sunScattering':
            this.$return(this.dbgSunScatter);
            break;
          case 'sunNoL':
            this.$return(pb.vec3(pb.clamp(this.dbgNoL, 0, 1)));
            break;
          case 'shadow':
            this.$return(this.dbgShadow);
            break;
          case 'sunPhase': {
            // Recomputed from the same inputs rather than read back out of
            // waterSunScattering: the value belongs to that function's scope, and
            // the variant that wants it is the one that never calls it. Keep the
            // two expressions in step.
            this.$l.dbgLw = pb.refract(pb.neg(this.dbgLightDir), pb.vec3(0, 1, 0), 1 / 1.333);
            this.$l.dbgVw = pb.refract(this.eyeVecNorm, pb.vec3(0, 1, 0), 1 / 1.333);
            this.$l.dbgCosTheta = pb.neg(pb.dot(this.dbgLw, this.dbgVw));
            this.$l.dbgHg = waterScatterPhase(this, this.dbgCosTheta, this.sunScatterParams.y);
            this.$l.dbgLumWeights = pb.vec3(0.2126, 0.7152, 0.0722);
            this.$l.dbgThickness = pb.mul(
              pb.dot(this.mediumAlbedo, this.dbgLumWeights),
              pb.sub(1, pb.exp(pb.neg(pb.mul(pb.dot(this.mediumExtinction, this.dbgLumWeights), this.depth))))
            );
            this.$return(
              pb.vec3(
                pb.clamp(
                  pb.mix(
                    this.dbgHg,
                    1 / (4 * Math.PI),
                    pb.smoothStep(0, 0.5, pb.clamp(this.dbgThickness, 0, 1))
                  ),
                  0,
                  1
                )
              )
            );
            break;
          }
          case 'sunIntegral': {
            this.$l.dbgVy = pb.max(pb.neg(pb.refract(this.eyeVecNorm, pb.vec3(0, 1, 0), 1 / 1.333).y), 1e-3);
            this.$l.dbgSy = pb.max(
              pb.neg(pb.refract(pb.neg(this.dbgLightDir), pb.vec3(0, 1, 0), 1 / 1.333).y),
              0.05
            );
            this.$l.dbgRr = pb.add(1, pb.div(this.dbgVy, this.dbgSy));
            this.$l.dbgIntegral = pb.div(
              pb.sub(
                pb.vec3(1),
                pb.exp(pb.neg(pb.mul(pb.mul(this.mediumExtinction, this.dbgRr), this.depth)))
              ),
              this.dbgRr
            );
            this.$return(pb.vec3(pb.clamp(pb.length(this.dbgIntegral), 0, 1)));
            break;
          }
          case 'subsurface':
            this.$return(this.dbgSubsurface);
            break;
          case 'specular':
            this.$return(this.dbgSpecular);
            break;
          case 'depth':
            this.$return(pb.vec3(pb.mul(this.depth, 0.1)));
            break;
          case 'refractUV':
            this.$return(
              pb.vec3(pb.add(pb.mul(pb.sub(this.refractUV, this.screenUV), 4), pb.vec2(0.5)), 0.5)
            );
            break;
          case 'nan': {
            // NaN is the only value that fails x == x. The normal is checked
            // separately from the colour so a NaN that a clamp downstream
            // swallowed still shows.
            this.$l.sum = pb.add(pb.dot(this.finalColor, pb.vec3(1)), pb.dot(this.normal, pb.vec3(1)));
            this.$l.bad = pb.or(pb.notEqual(this.sum, this.sum), pb.greaterThan(pb.abs(this.sum), 1e30));
            this.$return(this.$choice(this.bad, pb.vec3(1, 0, 0), pb.vec3(0)));
            break;
          }
          default:
            this.$return(this.finalColor);
        }
      }
    );
    return scope.waterShading(worldPos, worldNormal, foamFactor);
  }
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean, pass: number) {
    super.applyUniforms(bindGroup, ctx, needUpdate, pass);
    const waveGenerator = this._waveGenerator.get();
    // Synced per bind group, not per material: the material owns one bind group
    // per pass/render-variant hash, so drawing for a second camera reuses a
    // different group whose wave uniforms were never written. WeakMap so a
    // released group is garbage collected with its entry.
    const lastWritten = this._waveVersionByBindGroup.get(bindGroup) ?? -1;
    if (waveGenerator && lastWritten !== waveGenerator.version) {
      waveGenerator.applyWaterBindGroup(bindGroup);
      this._waveVersionByBindGroup.set(bindGroup, waveGenerator.version);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapGridInfo', this._clipmapGridInfo);
    if (this.infinite) {
      bindGroup.setValue('skirtDistance', this._skirtDistance);
    } else {
      bindGroup.setValue('region', this._region);
    }
    if (this.needFragmentColor(ctx)) {
      // Dimensionless: the offset is derived in world space and projected, so
      // there is nothing here for the render size to scale.
      bindGroup.setValue('refractionScale', this._refractionScale);
      if (this.refractionMode === 'offset') {
        bindGroup.setValue('cheapRefractionDepth', this._cheapRefractionDepth);
      }
      bindGroup.setValue('reflectionStrength', this._reflectionStrength);
      bindGroup.setValue('ssrParams', this._ssrParams);
      this._subsurfaceParams.setXYZW(this._subsurfaceIntensity, this._subsurfaceSteepness, 0, 0);
      bindGroup.setValue('subsurfaceParams', this._subsurfaceParams);
      this._foamParams.setXYZW(this._foamAmount, this._foamFalloff, 0, 0);
      bindGroup.setValue('foamShadingParams', this._foamParams);
      bindGroup.setValue('foamColor', this._foamColor);
      if (this._shoreFoamEnabled) {
        this._shoreFoamParams.setXYZW(
          this._shoreFoamAmount,
          this._shoreFoamDepth,
          this._shoreFoamFalloff,
          // Cycles per metre, resolved from cycles per band width.
          this._shoreFoamScale / this._shoreFoamDepth
        );
        bindGroup.setValue('shoreFoamParams', this._shoreFoamParams);
        this._shoreFoamWashParams.setXYZW(
          this._shoreFoamWashAmount,
          this._shoreFoamWashSpeed,
          this._shoreFoamWashScale,
          // Query radius: the band's widest reach over the run-up cycle. Fixed
          // over the cycle because it sets the pyramid level the query samples,
          // and a level moving with the wash would step the band's resolution.
          this._shoreFoamDepth * (1 + this._shoreFoamWashAmount)
        );
        bindGroup.setValue('shoreFoamWashParams', this._shoreFoamWashParams);
      }
      bindGroup.setValue('mediumAlbedo', this._scatterAlbedo);
      // Needed in both medium modes: the sun-scattering integral is always
      // physical, even where the ramp overrides the depth-driven absorption.
      bindGroup.setValue('mediumExtinction', this._extinction);
      this._sunScatterParams.setXYZW(this._sunScatteringIntensity, this._scatterAnisotropy, 0, 0);
      bindGroup.setValue('sunScatterParams', this._sunScatterParams);
      // One LOD serves all three channels, so the per-channel scattering has to
      // collapse to a scalar. Luminance-weighted rather than a plain mean: the
      // blur is a perceptual effect and green carries most of what is seen.
      bindGroup.setValue(
        'refractBlurDensity',
        (0.2126 * this._scattering.x + 0.7152 * this._scattering.y + 0.0722 * this._scattering.z) *
          this._scatteringScale *
          REFRACT_BLUR_DENSITY *
          this._refractionBlur
      );
      if (this.mediumMode === 'ramp') {
        bindGroup.setValue('depthMulti', this._depthMulti);
        bindGroup.setTexture(
          'scatterRampTex',
          this._getScatterRampTexture(ctx.device),
          fetchSampler('clamp_linear_nomip')
        );
        bindGroup.setTexture(
          'absorptionRampTex',
          this._getAbsorptionRampTexture(ctx.device),
          fetchSampler('clamp_linear_nomip')
        );
      }
    }
    if (this.waveGenerator) {
      this.waveGenerator.applyWaterBindGroup(bindGroup);
    }
  }
  needUpdate() {
    return !!this._waveGenerator.get()?.needUpdate();
  }
  update(frameId: number, elapsed: number) {
    const waveGenerator = this._waveGenerator.get();
    if (waveGenerator) {
      const updateFrameId = WaterMaterial._waveUpdateState.get(waveGenerator);
      if (updateFrameId !== frameId) {
        waveGenerator.update(elapsed);
        WaterMaterial._waveUpdateState.set(waveGenerator, frameId);
      }
    }
  }
  private _getRampTexture(device: AbstractDevice, grad: Interpolator) {
    const width = 128;
    const height = 1;
    const texture = device.createTexture2D('rgba8unorm', width, height, {
      mipmapping: false
    })!;
    const numTexels = width * height;
    const data = new Uint8Array(numTexels * 4);
    const tmpcolor = new Vector3();
    for (let i = 0; i < numTexels; i++) {
      grad.interpolate((i % width) / width, tmpcolor);
      data[i * 4 + 0] = (tmpcolor.x * 255) >> 0;
      data[i * 4 + 1] = (tmpcolor.y * 255) >> 0;
      data[i * 4 + 2] = (tmpcolor.z * 255) >> 0;
      data[i * 4 + 3] = 255;
    }
    texture.update(data, 0, 0, width, height);
    return texture;
  }
  private _getScatterRampTexture(device: AbstractDevice) {
    if (!this._scatterRampTexture.get()) {
      if (!WaterMaterial._defaultScatterRampTexture.get()) {
        WaterMaterial._defaultScatterRampTexture.set(
          this._getRampTexture(device, WaterMaterial._scatterGrad)
        );
      }
      this._scatterRampTexture.set(WaterMaterial._defaultScatterRampTexture.get());
    }
    return this._scatterRampTexture.get()!;
  }
  private _getAbsorptionRampTexture(device: AbstractDevice) {
    if (!this._absorptionRampTexture.get()) {
      if (!WaterMaterial._defaultAbsorptionRampTexture.get()) {
        WaterMaterial._defaultAbsorptionRampTexture.set(
          this._getRampTexture(device, WaterMaterial._absorptionGrad)
        );
      }
      this._absorptionRampTexture.set(WaterMaterial._defaultAbsorptionRampTexture.get());
    }
    return this._absorptionRampTexture.get()!;
  }
}
