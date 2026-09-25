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
import type { WaterInteraction } from '../render/water_interaction';
import { InteractiveWaveGenerator } from '../render/water_interaction';
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
 * - `subsurface`: the backlit-crest translucency term.
 * - `subsurfaceThickness`: the crest gate that term is scaled by, bright on
 *   crests and absorbed in troughs. Independent of the lights.
 * - `depth`: refracted path length through the medium, metres / 10.
 *   no offset is mid grey.
 * - `interaction`: the {@link WaterInteraction} field on its own, mid grey at
 *   rest and reaching black and white at its amplitude clamp; dimmed outside
 *   the field's window.
 *
 * Each value is a separate shader variant; the `none` variant carries no trace
 * of the others.
 *
 * @public
 */
export type WaterDebugOutput =
  | 'none'
  | 'normal'
  | 'foam'
  | 'shoreFoam'
  | 'waterDepth'
  | 'fresnel'
  | 'reflection'
  | 'refraction'
  | 'absorption'
  | 'scattering'
  | 'sunScattering'
  | 'subsurface'
  | 'subsurfaceThickness'
  | 'depth'
  | 'interaction';

/** Label/value pairs for {@link WaterDebugOutput}, for editor enumerations. */
export const WATER_DEBUG_OUTPUTS = [
  { label: 'None', value: 'none' },
  { label: 'Normal', value: 'normal' },
  { label: 'Foam', value: 'foam' },
  { label: 'Shore foam', value: 'shoreFoam' },
  { label: 'Water depth', value: 'waterDepth' },
  { label: 'Fresnel', value: 'fresnel' },
  { label: 'Reflection', value: 'reflection' },
  { label: 'Refraction', value: 'refraction' },
  { label: 'Absorption', value: 'absorption' },
  { label: 'Scattering', value: 'scattering' },
  { label: 'Sun scattering', value: 'sunScattering' },
  { label: 'Shadow', value: 'shadow' },
  { label: 'Subsurface', value: 'subsurface' },
  { label: 'Subsurface thickness', value: 'subsurfaceThickness' },
  { label: 'Specular', value: 'specular' },
  { label: 'Depth', value: 'depth' },
  { label: 'Interaction', value: 'interaction' }
] as const;

/** Fresnel reflectance of water at normal incidence, n = 1.333. */
const WATER_F0 = 0.02;
/** Specular roughness with the waves resolved. */
const WATER_BASE_ROUGHNESS = 0.04;
/** Specular roughness once distance has flattened the wave normals. */
const WATER_DISTANT_ROUGHNESS = 0.35;
/** Wrap of the foam's diffuse lighting, `(N.L + w) / (1 + w)`. At 0 a lee slope is unlit. */
const FOAM_LIGHT_WRAP = 0.5;
/** Index of refraction of water. Must match the caustics pass. */
const WATER_IOR = 1.333;
const AIR_TO_WATER_ETA = 1 / WATER_IOR;
const WATER_TO_AIR_ETA = WATER_IOR;
/** Cap on the refracted path, as a multiple of the straight-line distance. */
const REFRACT_MAX_PATH_RATIO = 4;
/** Steps of the refracted-ray march over {@link REFRACT_MAX_PATH_RATIO}. */
const REFRACT_MARCH_STEPS = 24;
/** Depth tolerance, in meters, for a march step to count as a hit. */
const REFRACT_MARCH_THICKNESS = 0.05;
/**
 * Fraction of the far plane an infinite surface is pulled in to. Must stay
 * below 1: the cleared depth value is tested for by equality.
 */
const INFINITE_DEPTH_PULLIN = 0.99;
/** Minimum reflection y for the sky bake lookup; its lower hemisphere is black. */
const HORIZON_REFLECT_BIAS = 0.08;
/** UV width of the band the refraction offset fades over at the screen border. */
const REFRACT_EDGE_FADE = 0.06;
/** Normalized depth at or above which the scene behind the water is sky. */
const SCENE_SKY_DEPTH01 = 0.999;
/** Floor on the subsurface term's sun-alignment factor. */
const SSS_SUN_ALIGN_FLOOR = 0.15;
/** Floor on the subsurface term's grazing-view factor. */
const SSS_GRAZING_FLOOR = 0.1;
/** Softplus width of the crest gate, as a fraction of the crest height. */
const SSS_HEIGHT_SOFTNESS = 0.6;
/** Floor on the crest gate's path length. */
const SSS_CREST_PATH_FLOOR = 0.2;
/** Extinction multiplier of the crest gate over a unit path. */
const SSS_ABSORPTION_SCALE = 3;
/**
 * Mean cosine of one scattering event. Real sea water is near 0.9, at which
 * almost nothing returns to a camera looking down.
 */
export const DEFAULT_SCATTER_ANISOTROPY = 0.7;
/**
 * Floor on the refracted sun ray's descent. A grazing sun refracts to about
 * 41 degrees below the surface, so this is only reached by a sun below the
 * horizon.
 */
const MIN_SUN_SLOPE = 0.05;
/** Refraction blur per meter of path from geometry alone, in mip widths. */
const REFRACT_BLUR_GEOMETRIC = 0.02;
/** Maps the scattering coefficient (1/m) onto refraction blur mip widths per meter. */
const REFRACT_BLUR_DENSITY = 1.5;
/** Cap on the refraction blur LOD. */
export const REFRACT_BLUR_MAX_LOD = 6;
/** Share of the shoreline ramp the foam pattern may eat into. Below 1. */
const SHORE_FOAM_NOISE_BITE = 0.6;
/** World-space drift of the foam pattern, m/s. */
const SHORE_FOAM_DRIFT_X = 0.11;
const SHORE_FOAM_DRIFT_Z = -0.07;
/** Octave frequency ratio. Not 2, which would align the noise lattices. */
const SHORE_FOAM_OCTAVE_RATIO = 2.17;
/** Foam pattern octave weights, coarsest first. */
const SHORE_FOAM_OCTAVE_WEIGHTS = [0.5, 0.3, 0.2];
/** Width of the band's gradient, as a fraction of its reach. */
const SHORE_FOAM_EDGE_SOFTNESS = 0.85;
/** Hi-Z cells the proximity window spreads over its radius; sets the mip level. */
const SHORE_QUERY_TAP_SPREAD = 1.5;
/** Softness of the proximity soft-min, as a fraction of the radius. */
const SHORE_QUERY_SOFTMIN = 0.25;
/**
 * Distance, in radii, an empty neighbourhood resolves to. Distances are clamped
 * to it before the exponential so the log never sees zero.
 */
const SHORE_QUERY_MISS_REACH = 2;
/** Per-frame advance of the dither hash, for TAA to average over. */
const SHORE_QUERY_DITHER_STRIDE = 5.588238;
/** Max thickness of a Hi-Z cell's depth block, in multiples of its width. */
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
  private static readonly _interactionUpdateState: WeakMap<WaterInteraction, number> = new WeakMap();
  private readonly _region: Vector4;
  private _refractionScale: number;
  private _depthMulti: number;
  private _reflectionStrength: number;
  private readonly _scatterRampTexture: DRef<Texture2D>;
  private readonly _absorptionRampTexture: DRef<Texture2D>;
  private readonly _waveGenerator: DRef<WaveGenerator>;
  private readonly _interaction: DRef<WaterInteraction>;
  /**
   * The generator the shaders and every other consumer of the surface use: the
   * base generator wrapped with the interaction field while one is attached,
   * the base generator itself otherwise.
   */
  private _effectiveWaveGenerator: Nullable<WaveGenerator>;
  /** Wave uniform version last written, per bind group. */
  private _waveVersionByBindGroup: WeakMap<BindGroup, number>;
  private readonly _clipmapInfo: Vector4;
  private readonly _clipmapGridInfo: Vector4;
  private _skirtDistance: number;
  private readonly _ssrParams: Vector4;
  /** sigma_a, 1/m, per RGB channel. */
  private readonly _absorption: Vector3;
  /** sigma_s, 1/m, per RGB channel. */
  private readonly _scattering: Vector3;
  /** sigma_t = sigma_a + sigma_s. */
  private readonly _extinction: Vector3;
  /** sigma_s / sigma_t. */
  private readonly _scatterAlbedo: Vector3;
  private _absorptionScale: number;
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
  private _underwaterGodRayShadow: boolean;
  private _underwaterHysteresis: number;
  private _subsurfaceIntensity: number;
  private _subsurfaceCrestHeight: number;
  private readonly _subsurfaceTint: Vector3;
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
    // Fitted to the default absorption ramp at depthMulti = 0.1.
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
    this._interaction = new DRef();
    this._effectiveWaveGenerator = null;
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
    this._underwaterGodRayShadow = false;
    this._underwaterHysteresis = 0.05;
    this._subsurfaceIntensity = 0.5;
    this._subsurfaceCrestHeight = 1.5;
    this._subsurfaceTint = new Vector3(0.86, 0.98, 0.71);
    this._subsurfaceParams = new Vector4();
    this._sunScatteringIntensity = 1;
    this._scatterAnisotropy = DEFAULT_SCATTER_ANISOTROPY;
    this._sunScatterParams = new Vector4();
    this._refractionBlur = 1;
    this._cheapRefractionDepth = 1;
    this._foamAmount = 1;
    this._foamFalloff = 1.5;
    this._foamColor = new Vector3(0.92, 0.95, 0.97);
    this._foamParams = new Vector4();
    this._shoreFoamAmount = 0;
    this._shoreFoamDepth = 0.5;
    this._shoreFoamFalloff = 1.5;
    this._shoreFoamScale = 2.5;
    this._shoreFoamWashAmount = 0.5;
    this._shoreFoamWashSpeed = 0.12;
    this._shoreFoamWashScale = 0.03;
    this._shoreFoamParams = new Vector4();
    this._shoreFoamWashParams = new Vector4();
    this.cullMode = 'none';
    this.useFeature(WaterMaterial.FEATURE_MEDIUM_MODE, 'physical' as WaterMediumMode);
    this.useFeature(WaterMaterial.FEATURE_REFRACTION_MODE, 'march' as WaterRefractionMode);
    this.useFeature(WaterMaterial.FEATURE_INFINITE, false);
    this.useFeature(WaterMaterial.FEATURE_SHORE_FOAM, false);
    this.useFeature(WaterMaterial.FEATURE_DEBUG_OUTPUT, 'none' as WaterDebugOutput);
  }
  /** {@inheritDoc Material.onDispose} */
  protected onDispose() {
    super.onDispose();
    this._waveGenerator.dispose();
    this._interaction.dispose();
    this._effectiveWaveGenerator = null;
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
  /**
   * The wave generator the surface is evaluated with.
   *
   * While an {@link interaction} is attached this is a wrapper that layers the
   * interaction field over {@link baseWaveGenerator}; every consumer of the
   * surface (the shaders, the surface-point query, the caustics) goes through
   * it and sees one displaced surface. Setting it sets the base generator.
   */
  get waveGenerator() {
    return this._effectiveWaveGenerator;
  }
  set waveGenerator(waveGenerator: Nullable<WaveGenerator>) {
    if (this._waveGenerator.get() !== waveGenerator) {
      this._waveGenerator.set(waveGenerator);
      this._rebuildEffectiveWaveGenerator();
    }
  }
  /** The generator supplying the ambient surface, without any interaction field. */
  get baseWaveGenerator() {
    return this._waveGenerator.get();
  }
  /**
   * Dynamic height field layered over the surface, or null for none. See
   * {@link WaterInteraction}.
   *
   * Ignored, with the base generator used on its own, on a device that cannot
   * host the field.
   */
  get interaction() {
    return this._interaction.get();
  }
  set interaction(val: Nullable<WaterInteraction>) {
    if (this._interaction.get() !== val) {
      this._interaction.set(val);
      this._rebuildEffectiveWaveGenerator();
    }
  }
  /** @internal */
  private _rebuildEffectiveWaveGenerator() {
    const base = this._waveGenerator.get();
    const interaction = this._interaction.get();
    if (base && interaction && interaction.isOk()) {
      this._effectiveWaveGenerator = new InteractiveWaveGenerator(base, interaction);
      interaction.ensureResources();
    } else {
      this._effectiveWaveGenerator = base;
    }
    // Bind groups are pooled; a stale version must not suppress the upload.
    this._waveVersionByBindGroup = new WeakMap();
    this.optionChanged(true);
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
  /** How the medium turns a path length into transmittance and in-scattering. Defaults to `physical`. */
  get mediumMode(): WaterMediumMode {
    return this.featureUsed<WaterMediumMode>(WaterMaterial.FEATURE_MEDIUM_MODE) ?? 'physical';
  }
  set mediumMode(val: WaterMediumMode) {
    if (val !== this.mediumMode) {
      this.useFeature(WaterMaterial.FEATURE_MEDIUM_MODE, val);
    }
  }
  /** How the refracted view sample is located. Defaults to `march`. Compile-time feature. */
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
   * Whether the surface reaches the horizon rather than ending at {@link region}.
   * Off by default. The clipmap's outermost ring becomes a horizon skirt.
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
  /** sigma_t = sigma_a + sigma_s in 1/m. Shared with the caustics pass. Do not mutate. */
  get extinction() {
    return this._extinction;
  }
  /** Single-scattering albedo sigma_s / sigma_t. Do not mutate. */
  get scatterAlbedo() {
    return this._scatterAlbedo;
  }
  /**
   * Whether a camera inside this body of water sees the medium applied to the
   * whole scene. Uses the same coefficients as the surface shading.
   */
  get underwaterEnabled() {
    return this._underwaterEnabled;
  }
  set underwaterEnabled(val: boolean) {
    this._underwaterEnabled = !!val;
  }
  /** Scale on the downwelling sky radiance lighting the column from inside, 1 for physical. */
  get underwaterAmbientIntensity() {
    return this._underwaterAmbientIntensity;
  }
  set underwaterAmbientIntensity(val: number) {
    this._underwaterAmbientIntensity = Math.max(0, val);
  }
  /**
   * Whether sunlight shafts are marched through the water column. Reads the
   * caustic map, so it is off wherever that is unavailable.
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
  /** Samples per view ray for the light shafts. Dithered; below about 8 reads as noise. */
  get underwaterGodRaySteps() {
    return this._underwaterGodRaySteps;
  }
  set underwaterGodRaySteps(val: number) {
    this._underwaterGodRaySteps = Math.max(1, Math.floor(val));
  }
  /**
   * Whether geometry in the water breaks the light shafts. Off by default; one
   * shadow map lookup per march step, roughly doubling the shafts' cost.
   */
  get underwaterGodRayShadow() {
    return this._underwaterGodRayShadow;
  }
  set underwaterGodRayShadow(val: boolean) {
    this._underwaterGodRayShadow = !!val;
  }
  /**
   * Half-width in meters of the dead band the submerged test uses around the
   * rest plane, so a camera at water level does not flip state every frame.
   */
  get underwaterHysteresis() {
    return this._underwaterHysteresis;
  }
  set underwaterHysteresis(val: number) {
    this._underwaterHysteresis = Math.max(0, val);
  }
  /**
   * Whether this water projects caustics onto the geometry below it. Requires a
   * shadow-casting directional light and a non-WebGL1 device.
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
  /** Depth in meters below the surface where the caustics are in focus. */
  get causticsDepth() {
    return this._causticsDepth;
  }
  set causticsDepth(val: number) {
    this._causticsDepth = Math.max(0.01, val);
  }
  /** Furthest distance in meters from the camera the caustic map reaches. */
  get causticsRange() {
    return this._causticsRange;
  }
  set causticsRange(val: number) {
    this._causticsRange = Math.max(1, val);
  }
  /**
   * Width in meters of the fade band at the edge of the caustic map, or 0 to
   * derive it from {@link causticsRange}. Capped at 90% of the range.
   */
  get causticsFadeDistance() {
    return this._causticsFadeDistance;
  }
  set causticsFadeDistance(val: number) {
    this._causticsFadeDistance = Math.max(0, val);
  }
  /**
   * Whether photons land on the scene (via the sun's shadow cascade) instead of
   * on a plane at {@link causticsDepth}. On by default.
   */
  get causticsSceneDepth() {
    return this._causticsSceneDepth;
  }
  set causticsSceneDepth(val: boolean) {
    this._causticsSceneDepth = !!val;
  }
  /**
   * How strongly caustic map texels are concentrated near the camera, 0 for
   * uniform. Density is `1 + warp` times uniform at the centre and
   * `1 / (1 + warp)` at the border. Ignored while the map fits the water.
   */
  get causticsWarp() {
    return this._causticsWarp;
  }
  set causticsWarp(val: number) {
    this._causticsWarp = Math.max(0, Math.min(8, val));
  }
  /** Caustic contrast falloff per meter away from {@link causticsDepth}. */
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
  /** Edge length of the photon grid, or 0 to size it from the map. Cost is quadratic. */
  get causticsPhotonResolution() {
    return this._causticsPhotonResolution;
  }
  set causticsPhotonResolution(val: number) {
    const n = val | 0;
    this._causticsPhotonResolution = n <= 0 ? 0 : Math.max(16, Math.min(4096, n));
  }
  /** Number of 2x2 blur iterations on the caustic map. Rounded up to even. */
  get causticsBlurPasses() {
    return this._causticsBlurPasses;
  }
  set causticsBlurPasses(val: number) {
    const clamped = Math.max(0, Math.min(4, val | 0));
    this._causticsBlurPasses = clamped + (clamped & 1);
  }
  /** Weight of the previous frame's caustic map in the current one, 0 to disable. */
  get causticsTemporalStrength() {
    return this._causticsTemporalStrength;
  }
  set causticsTemporalStrength(val: number) {
    this._causticsTemporalStrength = Math.max(0, Math.min(0.95, val));
  }
  /**
   * Strength of the glow of a backlit wave crest, 0 to disable. Authored, not
   * scaled by the light's intensity; {@link subsurfaceTint} supplies the hue.
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
   * Height above the still-water level, in meters, over which the lit wall of
   * a crest thins by a factor of `e`. Lower for a calm sea, higher so only the
   * tallest crests glow.
   */
  get subsurfaceCrestHeight() {
    return this._subsurfaceCrestHeight;
  }
  set subsurfaceCrestHeight(val: number) {
    // The shader divides by this.
    const clamped = Math.max(0.001, val);
    if (clamped !== this._subsurfaceCrestHeight) {
      this._subsurfaceCrestHeight = clamped;
      this.uniformChanged();
    }
  }
  /** Colour of the crest glow, before the crest gate tints it with the medium's extinction. */
  get subsurfaceTint() {
    return this._subsurfaceTint;
  }
  set subsurfaceTint(val: Vector3) {
    if (!val.equalsTo(this._subsurfaceTint)) {
      this._subsurfaceTint.set(val);
      this.uniformChanged();
    }
  }
  /**
   * Strength of the sunlight scattered out of the water column towards the eye,
   * 1 for the physical value. 0 disables the term.
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
   * Fixed depth in meters the `offset` refraction mode steps along the refracted
   * ray. Ignored by `march`. Deliberately not the scene distance, which would
   * double submerged objects across their silhouette.
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
  /** Scale on the medium's refraction blur. 0 is sharp, 1 is what the medium implies. */
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
  /** Mean cosine of a single scattering event, in `[0, 0.95]`. 0 is isotropic. */
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
  /** Scale from the generator's fold measure to foam coverage, 0 to disable. */
  get foamAmount() {
    return this._foamAmount;
  }
  set foamAmount(val: number) {
    if (val !== this._foamAmount) {
      this._foamAmount = Math.max(0, val);
      this.uniformChanged();
    }
  }
  /** Power applied to foam coverage before scaling. Above 1 restricts foam to broken crests. */
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
   * Coverage of the foam where the water meets a surface, 0 to disable.
   *
   * Keyed on the distance to the nearest solid around the surface, estimated in
   * screen space from the Hi-Z pyramid: off-screen, occluded or sub-pixel
   * geometry produces no foam. Unavailable on WebGL1.
   */
  get shoreFoamAmount() {
    return this._shoreFoamAmount;
  }
  set shoreFoamAmount(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._shoreFoamAmount) {
      // Compile-time feature: only crossing zero rebuilds the shader.
      const wasEnabled = this._shoreFoamAmount > 0;
      this._shoreFoamAmount = clamped;
      if (wasEnabled !== clamped > 0) {
        this.useFeature(WaterMaterial.FEATURE_SHORE_FOAM, clamped > 0 && getDevice().type !== 'webgl');
      } else {
        this.uniformChanged();
      }
    }
  }
  /** Reach in meters of the foam band from the surface behind it. The outer edge, not the midpoint. */
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
  /** Power applied across the band before scaling. Above 1 pushes coverage towards the contact. */
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
  /** Clump frequency of the band's edge, in cycles across {@link shoreFoamDepth}. */
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
   * Run-up of the band's edge, as a fraction of {@link shoreFoamDepth}. 0 is
   * static; above 1 the band closes completely at the bottom of the cycle.
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
  /** Run-up cycles per second. */
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
  /** Spatial frequency of the run-up phase, cycles per meter. 0 moves the whole shoreline in lockstep. */
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
  /** @internal */
  private get _shoreFoamEnabled() {
    return this.featureUsed<boolean>(WaterMaterial.FEATURE_SHORE_FOAM) ?? false;
  }
  /**
   * Feature on *and* the Hi-Z pyramid bound for this pass. A pass outside the
   * main graph may have no pyramid, and a fetch against an unbound texture is a
   * build failure.
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
  /** Artistic scale on the refracted view offset. 1 is physical, 0 disables it. */
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
  /** Scale on the Fresnel reflectance, 1 for physical. Scales F0 too, so 0 kills specular. */
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
  /** Distance from the camera to the horizon skirt's outer edge. Only read while {@link infinite}. */
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
   * Always false: the submersion test would read a water fragment as submerged
   * wherever the surface up-sun of it rides a crest.
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
    scope.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz;
    scope.worldNormal = pb.vec3(0, 1, 0);
    scope.worldPos = scope.clipmapWorldPos;
    if (this.infinite) {
      const that = this;
      // position.z is 1 on the skirt ring's outer edge, 0 everywhere else.
      scope.$l.skirt = pb.step(0.5, scope.$inputs.position.z);
      scope
        .$if(pb.greaterThan(scope.skirt, 0), function () {
          // Pushed radially out from the camera, undisplaced, at the still-water level.
          this.$l.camXZ = ShaderHelper.getCameraPosition(this).xz;
          this.$l.outDir = pb.normalize(pb.sub(this.clipmapWorldPos.xz, this.camXZ));
          this.$l.outXZ = pb.add(this.camXZ, pb.mul(this.outDir, this.skirtDistance));
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
      // Vertices past the far plane are pulled in along their own view ray:
      // screen position is unchanged, only the written depth moves. Shading
      // keeps the true world position.
      scope.$l.camPos = ShaderHelper.getCameraPosition(scope).xyz;
      scope.$l.viewVec = pb.sub(scope.$outputs.worldPos, scope.camPos);
      scope.$l.viewDist = pb.max(pb.length(scope.viewVec), 1e-6);
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
        scope.cheapRefractionDepth = pb.float().uniform(2);
      }
      scope.reflectionStrength = pb.float().uniform(2);
      scope.ssrParams = pb.vec4().uniform(2);
      // Eye vs. rest plane from the CPU submersion test: 1 above, -1 below,
      // 0 unknown (compare in the shader).
      scope.eyeSide = pb.float().uniform(2);
      // (intensity, crest absorption height in m, 0, 0)
      scope.subsurfaceParams = pb.vec4().uniform(2);
      scope.subsurfaceTint = pb.vec3().uniform(2);
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
      // Mip widths per meter of path; one scalar LOD for all three channels.
      scope.refractBlurDensity = pb.float().uniform(2);
      // Bound in both medium modes: the ramp only replaces the depth-driven
      // absorption and scattering.
      scope.mediumAlbedo = pb.vec3().uniform(2);
      scope.mediumExtinction = pb.vec3().uniform(2);
      if (this.mediumMode === 'ramp') {
        scope.depthMulti = pb.float().uniform(2);
        scope.scatterRampTex = pb.tex2D().uniform(2);
        scope.absorptionRampTex = pb.tex2D().uniform(2);
      }
    }
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
        // Flat and foamless on the skirt: waves evaluated at kilometres per
        // pixel alias into speckle.
        scope.normal = pb.mix(scope.normal, pb.vec4(0, 1, 0, 0), scope.$inputs.skirt);
      }
      // Vertical wave displacement, interpolated from the vertices. Zero on the skirt.
      scope.$l.crestHeight = pb.sub(scope.$inputs.worldPos.y, scope.$inputs.clipmapPos.y);
      if (this.debugOutput === 'interaction') {
        // The field on its own, grey at rest, scaled so its amplitude clamp
        // reaches black and white; dimmed outside the window so its reach shows.
        if (this.waveGenerator instanceof InteractiveWaveGenerator) {
          const interaction = this.waveGenerator.interaction;
          scope.$l.wiDebugHeight = pb.div(
            interaction.sampleHeight(scope, scope.$inputs.clipmapPos.xz),
            scope.wiParams2.y
          );
          scope.$l.wiDebugMask = pb.mix(
            pb.float(0.55),
            pb.float(1),
            interaction.windowMask(scope, scope.$inputs.clipmapPos.xz)
          );
        } else {
          scope.$l.wiDebugHeight = pb.float(0);
          scope.$l.wiDebugMask = pb.float(1);
        }
        scope.$l.outColor = pb.vec4(
          pb.vec3(pb.mul(pb.add(0.5, pb.mul(scope.wiDebugHeight, 0.5)), scope.wiDebugMask)),
          1
        );
      } else {
        scope.$l.outColor = pb.vec4(
          this.waterShading(
            scope,
            scope.$inputs.worldPos,
            scope.normal.xyz,
            scope.normal.w,
            scope.crestHeight
          ),
          1
        );
      }
      if (
        this.drawContext.materialFlags &
        (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
      ) {
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
   * Specular roughness at a world position. Distance flattens the wave normals,
   * and the lost slope is handed to the lobe. Also written to the scene
   * roughness buffer.
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
   * Where to sample the scene behind the water, and the medium path length to it.
   *
   * Refracts the view ray by Snell's law and marches it against the scene depth.
   * Depth-convention independent: projection only reads `clip.xy / clip.w` and
   * all depth comparisons are in view space.
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
   * @param underwater - Whether the eye is below the surface
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
    straightDist: PBShaderExp,
    underwater: PBShaderExp
  ) {
    const pb = scope.$builder;
    const march = this.refractionMode === 'march';
    // Only ever used as a difference of two UVs, so TAA jitter and clip-space Y
    // orientation cancel. Inverse of ShaderHelper.samplePositionFromDepth's mapping.
    pb.func('waterRefractProjectUV', [pb.vec3('worldPos')], function () {
      this.$l.h = pb.mul(ShaderHelper.getViewProjectionMatrix(this), pb.vec4(this.worldPos, 1));
      this.$return(pb.add(pb.mul(pb.div(this.h.xy, pb.max(this.h.w, 1e-6)), 0.5), pb.vec2(0.5)));
    });
    // Sample UV for a refracted ray ending at `hitPos`, faded to the straight
    // sample at the screen border.
    pb.func(
      'waterRefractUV',
      [pb.vec2('screenUV'), pb.vec2('uvBase'), pb.vec3('hitPos'), pb.float('scale')],
      function () {
        this.$l.uv = pb.add(
          this.screenUV,
          pb.mul(pb.sub(this.waterRefractProjectUV(this.hitPos), this.uvBase), this.scale)
        );
        this.$l.edge = pb.min(
          pb.min(this.uv.x, pb.sub(1, this.uv.x)),
          pb.min(this.uv.y, pb.sub(1, this.uv.y))
        );
        this.$return(pb.mix(this.screenUV, this.uv, pb.clamp(pb.div(this.edge, REFRACT_EDGE_FADE), 0, 1)));
      }
    );
    // Declared only in `march` mode: a dead function still forces the depth
    // texture and projection matrices into the bind group.
    if (march) {
      // Returns (uv, rayViewZ - sceneViewZ) at `t` meters along the ray.
      // Positive: ray still in front of the scene. Negative: passed through it.
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
          this.$l.sceneViewZ = pb.mul(pb.neg(this.linearDepth), this.cameraFar);
          this.$return(pb.vec3(this.uv, pb.sub(this.rayViewZ, this.sceneViewZ)));
        }
      );
      // First crossing of the refracted ray with the depth buffer. A hit is a
      // step inside the thickness band or a sign change of the gap; an object
      // poking out of the water is negative from the first step and never hits.
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
                // Interpolate to the exact crossing.
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
        pb.float('straightDist'),
        pb.bool('underwater')
      ],
      function () {
        this.$l.faceNormal = this.$choice(this.underwater, pb.neg(this.normal), this.normal);
        this.$l.eta = this.$choice(this.underwater, pb.float(WATER_TO_AIR_ETA), pb.float(AIR_TO_WATER_ETA));
        this.$l.uvBase = this.waterRefractProjectUV(this.worldPos);
        this.$if(pb.greaterThanEqual(this.straightDepth01, SCENE_SKY_DEPTH01), function () {
          this.$return(pb.vec3(this.screenUV, this.straightDist));
        });
        this.$l.waterCrossDir = pb.normalize(pb.sub(this.straightWorldPos, this.worldPos));
        // refractDir = view line + (refract by wave normal - refract by flat
        // normal), so calm water samples exactly the straight hit. The flat
        // normal carries the same facing flip so the two cancel from either side.
        this.$l.refractWave = pb.refract(this.eyeVecNorm, this.faceNormal, this.eta);
        this.$l.refractFlatNormal = pb.vec3(0, pb.sign(this.faceNormal.y), 0);
        this.$l.refractFlat = pb.refract(this.eyeVecNorm, this.refractFlatNormal, this.eta);
        // Total internal reflection makes refract return zero.
        this.$l.refractDir = pb.add(this.waterCrossDir, pb.sub(this.refractWave, this.refractFlat));
        this.$if(pb.lessThan(pb.length(pb.sub(this.refractWave, this.refractFlat)), 1e-4), function () {
          this.refractDir = this.waterCrossDir;
        });
        this.$if(pb.lessThan(pb.dot(this.refractDir, this.refractDir), 1e-6), function () {
          this.refractDir = this.waterCrossDir;
        });
        this.refractDir = pb.normalize(this.refractDir);
        this.$l.refractUV = this.screenUV;
        this.$l.refractPath = this.straightDist;
        if (!march) {
          // Fixed step, not the scene distance: that jumps across silhouettes
          // and paints a second copy of the object.
          this.refractUV = this.waterRefractUV(
            this.screenUV,
            this.uvBase,
            pb.add(this.worldPos, pb.mul(this.refractDir, this.cheapRefractionDepth)),
            this.refractionScale
          );
          this.$return(pb.vec3(this.refractUV, this.refractPath));
        } else {
          this.$l.refractDirView = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.refractDir, 0)).xyz;
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
          // A finite scene point above the surface at the refracted UV is an
          // object poking through: fall back to the straight sample.
          this.$l.sceneHit = ShaderHelper.samplePositionFromDepth(
            this,
            ShaderHelper.getLinearDepthTexture(this),
            this.refractUV,
            ShaderHelper.getInvViewProjectionMatrix(this),
            ShaderHelper.getCameraParams(this).xy
          );
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
      straightDist,
      underwater
    ) as PBShaderExp;
  }
  /**
   * Sunlight scattered out of the water column towards the eye. Closed-form
   * single scattering in a homogeneous medium.
   *
   * With `t` the distance along the refracted view ray, `d` its length in the
   * water, `vy`/`sy` the descent rates of the view and sun rays, and
   * `r = vy / sy`:
   *
   * ```
   * S = integral(0..d) sigma_s * p * E * exp(-sigma_t * t * (1 + r)) dt
   *   = albedo * p * E * (1 - exp(-sigma_t * (1 + r) * d)) / (1 + r)
   * ```
   *
   * No `NoL` factor: that geometry is already in `r`. Only the entry Fresnel is
   * applied; the exit transmission is applied once by the caller. Assumes the
   * eye is above the surface.
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
        // Directions inside the water. The sun travels opposite to `lightDir`.
        this.$l.Lw = pb.refract(pb.neg(this.lightDir), this.up, AIR_TO_WATER_ETA);
        this.$l.Vw = pb.refract(this.eyeVecNorm, this.up, AIR_TO_WATER_ETA);
        this.$l.sy = pb.max(pb.neg(this.Lw.y), MIN_SUN_SLOPE);
        this.$l.vy = pb.max(pb.neg(this.Vw.y), 1e-3);
        this.$l.r = pb.div(this.vy, this.sy);
        this.$l.rr = pb.add(1, this.r);
        this.$l.cosTheta = pb.neg(pb.dot(this.Lw, this.Vw));
        this.$l.hg = waterScatterPhase(this, this.cosTheta, this.sunScatterParams.y);
        // Blend towards isotropic with optical thickness (multiple scattering).
        // Luminance-weighted: the phase is wavelength independent.
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
        this.$l.k = pb.mul(this.mediumExtinction, this.rr);
        this.$l.integral = pb.div(pb.sub(pb.vec3(1), pb.exp(pb.neg(pb.mul(this.k, this.depth)))), this.rr);
        // Entry Fresnel. Zero at NoL <= 0, where the subsurface term takes over.
        // Foam is a mass of bubbles, not a mirror, so it blends towards full
        // transmission.
        this.$l.entry = pb.sub(1, pb.add(WATER_F0, pb.mul(1 - WATER_F0, pb.pow(pb.sub(1, this.NoL), 5))));
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
    foamFactor: PBShaderExp,
    crestHeight: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const ramp = this.mediumMode === 'ramp';
    const shoreFoam = this._shoreFoamAvailable(scope);
    const debugOutput = this.debugOutput;
    // Transmittance over `depth` meters of path.
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
    // Fraction of incident irradiance scattered back over `depth` meters of path.
    pb.func('getScattering', [pb.float('depth')], function () {
      if (ramp) {
        this.$l.c = pb.textureSampleLevel(
          this.scatterRampTex,
          pb.vec2(pb.mul(this.depth, this.depthMulti), 0.5),
          0
        ).rgb;
        this.$return(pb.mul(this.c, this.c));
      } else {
        this.$return(
          pb.mul(
            this.mediumAlbedo,
            pb.sub(pb.vec3(1), pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.depth))))
          )
        );
      }
    });
    pb.func('fresnel', [pb.vec3('normal'), pb.vec3('eyeVec'), pb.bool('underwater')], function () {
      // abs, not clamp: a folded crest flips the sign inside one wave, and a
      // clamp would drop to F0 exactly at the most grazing geometry.
      this.$l.NoV = pb.clamp(pb.abs(pb.dot(this.normal, this.eyeVec)), 0, 1);
      this.$if(this.underwater, function () {
        this.$l.sinT2 = pb.mul(WATER_TO_AIR_ETA * WATER_TO_AIR_ETA, pb.sub(1, pb.mul(this.NoV, this.NoV)));
        // Total internal reflection outside the Snell window. Not scaled by
        // reflectionStrength: there is no transmitted ray to reveal.
        this.$l.f = pb.float(1);
        this.$if(pb.lessThan(this.sinT2, 1), function () {
          // Schlick takes the cosine on the less dense side. F0 is symmetric.
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
      // Three octaves of world-space value noise, drifting.
      pb.func('waterShoreFoamPattern', [pb.vec2('xz'), pb.float('time')], function () {
        // Drift in meters, before the frequency.
        this.$l.p = pb.mul(
          pb.add(this.xz, pb.mul(pb.vec2(SHORE_FOAM_DRIFT_X, SHORE_FOAM_DRIFT_Z), this.time)),
          this.shoreFoamParams.w
        );
        this.$return(
          pb.add(
            pb.mul(valueNoise(this, this.p), SHORE_FOAM_OCTAVE_WEIGHTS[0]),
            // Offset so the octave lattices do not line up.
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
      // Distance from the water surface to the nearest opaque surface in a
      // screen-space neighbourhood of `radius` meters, via the Hi-Z pyramid's
      // nearest-depth channel. Returns a distance past the band's reach when
      // the neighbourhood is empty.
      pb.func(
        'waterShoreProximity',
        [pb.vec3('viewPos'), pb.vec2('screenUV'), pb.float('radius')],
        function () {
          this.$l.renderSize = ShaderHelper.getRenderSize(this);
          this.$l.projMatrix = ShaderHelper.getProjectionMatrix(this);
          // Screen radius in pixels of a sphere of `radius` meters at this depth.
          this.$l.viewDist = pb.max(pb.neg(this.viewPos.z), 1e-4);
          this.$l.pixelRadius = pb.mul(
            pb.div(pb.mul(this.radius, this.projMatrix[0].x), this.viewDist),
            0.5,
            this.renderSize.x
          );
          // Integer level: the pyramid uses a nearest mip filter, and a
          // fractional level shows as a seam.
          this.$l.level = pb.clamp(
            pb.floor(pb.log2(pb.max(pb.div(this.pixelRadius, SHORE_QUERY_TAP_SPREAD), 1))),
            0,
            pb.sub(pb.float(ShaderHelper.getHiZDepthTextureMipLevelCount(this)), 1)
          );
          this.$l.mipSize = pb.max(pb.floor(pb.div(this.renderSize, pb.exp2(this.level))), pb.vec2(1));
          this.$l.texelStep = pb.div(pb.vec2(1), this.mipSize);
          // 4x4 window, tent-weighted to zero at the edge (the pyramid sampler
          // is nearest, so smoothing happens here). Each cell is read as a point
          // dithered inside it, so the box-distance contours come out round.
          // The dither moves the interpretation, not the fetches, so TAA can
          // average it.
          this.$l.dither = pb.mul(pb.float(ShaderHelper.getFramestamp(this)), SHORE_QUERY_DITHER_STRIDE);
          this.$l.gridCoord = pb.sub(pb.mul(this.screenUV, this.mipSize), pb.vec2(0.5));
          this.$l.gridBase = pb.floor(this.gridCoord);
          this.$l.gridFrac = pb.sub(this.gridCoord, this.gridBase);
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
              // A cell is a frustum block [near, far]. Depth is clamped to it
              // (the reduction guarantees a surface on the near face), with the
              // span clipped by SHORE_QUERY_CELL_DEPTH_SPAN.
              this.$l[`cellW${gx}${gy}`] = pb.max(
                pb.div(pb.mul(this.texelStep.x, 2, this[`z${gx}${gy}`]), this.projMatrix[0].x),
                1e-6
              );
              this.$l[`zBack${gx}${gy}`] = pb.min(
                this[`zFar${gx}${gy}`],
                pb.add(this[`z${gx}${gy}`], pb.mul(this[`cellW${gx}${gy}`], SHORE_QUERY_CELL_DEPTH_SPAN))
              );
              this.$l[`zClamp${gx}${gy}`] = pb.clamp(
                pb.neg(this.viewPos.z),
                this[`z${gx}${gy}`],
                this[`zBack${gx}${gy}`]
              );
              this.$l[`dz${gx}${gy}`] = pb.add(this.viewPos.z, this[`zClamp${gx}${gy}`]);
              // Seeded per cell, not shared across the sixteen.
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
          // Weighted soft-min: -k * log(sum w * exp(-d / k) / sum w).
          this.$return(pb.mul(pb.neg(this.softK), pb.log(pb.div(this.esum, this.wsum))));
        }
      );
      // Shoreline foam as (coverage, distance to the nearest surface).
      pb.func('waterShoreFoam', [pb.vec3('worldPos'), pb.vec3('viewPos'), pb.vec2('screenUV')], function () {
        this.$l.time = ShaderHelper.getElapsedTime(this);
        // Queried at the band's widest reach so the run-up does not move the
        // mip level under it.
        this.$l.surfaceDist = this.waterShoreProximity(
          this.viewPos,
          this.screenUV,
          this.shoreFoamWashParams.w
        );
        // Run-up phase from a world-space noise field; the query does not know
        // which way the shore runs.
        this.$l.washOffset = valueNoise(this, pb.mul(this.worldPos.xz, this.shoreFoamWashParams.z));
        this.$l.wash = pb.sin(
          pb.mul(pb.add(pb.mul(this.time, this.shoreFoamWashParams.y), this.washOffset), 2 * Math.PI)
        );
        this.$l.edge = pb.max(
          pb.mul(this.shoreFoamParams.y, pb.add(1, pb.mul(this.shoreFoamWashParams.x, this.wash))),
          0
        );
        this.$l.soft = pb.max(pb.mul(this.edge, SHORE_FOAM_EDGE_SOFTNESS), 1e-4);
        // The gradient ends at `edge`, so coverage is zero there; straddling it
        // would give half coverage over the entire open sea.
        this.$l.ramp = pb.sub(1, pb.smoothStep(pb.sub(this.edge, this.soft), this.edge, this.surfaceDist));
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
      [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('foamFactor'), pb.float('crestHeight')],
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
        // Mirror-term normal, turned towards the eye on a folded underside.
        // Flipped on the cosine, not on `frontFacing`, which is discontinuous
        // along the fold's triangle edge. `eyeVecNorm` points camera -> surface,
        // so the flip case is the positive dot.
        this.$l.shadingNormal = this.$choice(
          pb.greaterThan(pb.dot(this.normal, this.eyeVecNorm), 0),
          pb.neg(this.normal),
          this.normal
        );
        // Diffuse-term normal, from the unflipped wave normal (the eye-facing
        // flip would point it into the lower hemisphere on any steep back
        // slope), mixed towards up as normal.y falls.
        this.$l.diffuseWeight = pb.smoothStep(0, 0.5, this.normal.y);
        this.$l.diffuseNormal = pb.normalize(pb.mix(pb.vec3(0, 1, 0), this.normal, this.diffuseWeight));
        // Eye below the rest plane, not `!frontFacing`: a choppy fold (J < 0)
        // flips the winding and would read as seen from below.
        this.$l.restLevel = pb.sub(this.worldPos.y, this.crestHeight);
        this.$l.underwaterEye = pb.or(
          pb.lessThan(this.eyeSide, 0),
          pb.and(
            pb.equal(this.eyeSide, 0),
            pb.lessThan(ShaderHelper.getCameraPosition(this).y, this.restLevel)
          )
        );
        this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.worldPos));
        this.$l.viewPos = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.worldPos, 1)).xyz;
        this.incidentVec = pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.reflectVecW = pb.reflect(this.incidentVec, this.shadingNormal);
        this.$l.reflectance = pb.vec3();
        this.$l.hitInfo = pb.vec4(0);
        // Trace only rays leaving the surface: up from above, down from below.
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
        // Fallback where the trace misses. From above: the sky, with the
        // reflection y floored so grazing rays do not read the bake's black
        // lower hemisphere. From below: the medium's asymptotic colour
        // albedo * ambient, the d -> inf limit of the underwater pass.
        this.$l.reflMiss = pb.vec3();
        this.$if(this.underwaterEye, function () {
          this.$l.downwelling = ShaderHelper.sampleBakedSkyPreExposed(this, pb.vec3(0, 1, 0));
          this.reflMiss = pb.mul(this.mediumAlbedo, this.downwelling);
        }).$else(function () {
          this.refl.y = pb.max(this.refl.y, HORIZON_REFLECT_BIAS);
          this.refl = pb.normalize(this.refl);
          // Pre-exposed to match the scene colour it is blended against.
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
          this.depth,
          this.underwaterEye
        );
        this.$l.refractUV = this.refractInfo.xy;
        // Medium path is the refracted length, not the straight line.
        this.depth = this.refractInfo.z;
        // Zero from below: the column the eye is inside belongs to the
        // Underwater pass, and charging it twice smears the Snell window.
        this.$l.mediumPath = this.$choice(this.underwaterEye, pb.float(0), this.depth);
        // Blur LOD: log2 in path length (each mip doubles the width), driven by
        // scattering rather than extinction (absorption darkens without blurring).
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
        this.$l.crestFoam = pb.clamp(
          pb.mul(pb.pow(pb.clamp(this.foamFactor, 0, 1), this.foamShadingParams.y), this.foamShadingParams.x),
          0,
          1
        );
        // (coverage, distance to the nearest surface); y is for the debug view.
        this.$l.shoreFoamInfo = shoreFoam
          ? (this.waterShoreFoam(this.worldPos, this.viewPos, this.screenUV) as PBShaderExp)
          : pb.vec2(0, 0);
        this.$l.shoreFoam = this.shoreFoamInfo.x;
        // Independent coverages compose as overlapping area.
        this.$l.foam = pb.sub(1, pb.mul(pb.sub(1, this.crestFoam), pb.sub(1, this.shoreFoam)));
        // Foam suppresses the mirror rather than adding to it.
        this.fresnelTerm = pb.mul(this.fresnelTerm, pb.sub(1, this.foam));
        this.$l.finalColor = pb.mix(this.refraction, this.reflectance, this.fresnelTerm);
        // Debug accumulators. Dead in the `none` variant.
        this.$l.dbgSubsurface = pb.vec3(0);
        this.$l.dbgSunScatter = pb.vec3(0);
        // Exit transmission times the water (non-foam) share. The refraction
        // already carries it via the `mix`; every body term below must too.
        this.$l.bodyWeight = pb.mul(pb.sub(1, this.fresnelTerm), pb.sub(1, this.foam));
        // Subsurface crest gate, after Ceto: the lit wall thins with height,
        // path = max(floor, exp(-softplus(h / H))), gate = exp(-sigma_t *
        // scale * path). On the vertex displacement, not the normal tilt,
        // which is zero at the crest and carries every ripple.
        this.$l.sssT = pb.div(this.crestHeight, this.subsurfaceParams.y);
        // softplus in the overflow-safe form max(t,0) + w*log(1+exp(-|t|/w)).
        this.$l.sssRise = pb.add(
          pb.max(this.sssT, 0),
          pb.mul(
            SSS_HEIGHT_SOFTNESS,
            pb.log(pb.add(1, pb.exp(pb.div(pb.neg(pb.abs(this.sssT)), SSS_HEIGHT_SOFTNESS))))
          )
        );
        this.$l.sssPath = pb.max(pb.exp(pb.neg(this.sssRise)), SSS_CREST_PATH_FLOOR);
        this.$l.sssThickness = pb.exp(
          pb.neg(pb.mul(this.mediumExtinction, pb.mul(this.sssPath, SSS_ABSORPTION_SCALE)))
        );
        // For the debug views that rebuild the sun terms outside the loop.
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
          this.$l.lightDir = that.calculateLightDirection(
            this,
            type,
            this.worldPos,
            posRange,
            dirCutoff,
            extra
          );
          this.dbgLightDir = this.lightDir;
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.NoLdiffuse = pb.clamp(pb.dot(this.diffuseNormal, this.lightDir), 0, 1);
          // From the raw cosine, so a lee slope below zero still wraps up.
          this.$l.NoLfoam = pb.clamp(
            pb.div(pb.add(pb.dot(this.diffuseNormal, this.lightDir), FOAM_LIGHT_WRAP), 1 + FOAM_LIGHT_WRAP),
            0,
            1
          );
          this.$l.lightEnergy = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
          this.$l.specularTerm = this.lightSpecular(
            this.lightDir,
            this.eyeVecNorm,
            this.shadingNormal,
            this.lightEnergy,
            this.roughness
          );
          this.$l.lightContrib = this.specularTerm;
          // Backlit-crest subsurface, after Ceto: grazing^2 * (view ray mirrored
          // in the rest plane, against the sun)^4 * sun-above-horizon fade.
          // Both cosines are floored.
          this.$l.sssToEye = pb.neg(this.eyeVecNorm);
          this.$l.sssGrazing = pb.sub(1, pb.clamp(this.sssToEye.y, 0, 1));
          this.sssGrazing = pb.mix(SSS_GRAZING_FLOOR, 1, pb.mul(this.sssGrazing, this.sssGrazing));
          this.$l.sssMirror = pb.reflect(this.sssToEye, pb.vec3(0, 1, 0));
          this.$l.sssAlign = pb.clamp(pb.dot(pb.neg(this.sssMirror), this.lightDir), 0, 1);
          this.sssAlign = pb.mul(this.sssAlign, this.sssAlign);
          this.sssAlign = pb.mix(SSS_SUN_ALIGN_FLOOR, 1, pb.mul(this.sssAlign, this.sssAlign));
          this.$l.sssSunUp = pb.smoothStep(0, 0.1, this.lightDir.y);
          this.$l.sssFacing = pb.mul(this.sssGrazing, this.sssAlign, this.sssSunUp);
          // Not scaled by the light, so directional only (no distance falloff).
          // Leaves the body, so it carries `bodyWeight` like every body term.
          this.$l.subsurfaceTerm = pb.vec3(0);
          this.$if(pb.equal(type, LIGHT_TYPE_DIRECTIONAL), function () {
            this.subsurfaceTerm = pb.mul(
              this.subsurfaceTint,
              pb.mul(this.sssFacing, this.sssThickness, this.subsurfaceParams.x),
              this.bodyWeight
            );
            this.lightContrib = pb.add(this.lightContrib, this.subsurfaceTerm);
          });
          // Directional only (the integral assumes a parallel beam) and from
          // above only.
          this.$l.sunScatterTerm = pb.vec3(0);
          this.$if(pb.and(pb.equal(type, LIGHT_TYPE_DIRECTIONAL), pb.not(this.underwaterEye)), function () {
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
          // Foam as a matte layer.
          this.lightContrib = pb.add(
            this.lightContrib,
            pb.mul(this.lightEnergy, this.foamColor, this.foam, this.NoLfoam, 1 / Math.PI)
          );
          this.$l.shadow = pb.vec3(1);
          if (shadow) {
            // +Y, not the wave normal, which would jitter the lookup per pixel.
            this.shadow = pb.vec3(that.calculateShadow(this, this.worldPos, pb.vec3(0, 1, 0), this.NoL));
            this.lightContrib = pb.mul(this.lightContrib, this.shadow);
          }
          this.finalColor = pb.add(this.finalColor, this.lightContrib);
          this.dbgSubsurface = pb.add(this.dbgSubsurface, pb.mul(this.subsurfaceTerm, this.shadow));
          this.dbgSunScatter = pb.add(this.dbgSunScatter, pb.mul(this.sunScatterTerm, this.shadow));
        });
        if (that.needCalculateEnvLight()) {
          this.$l.irradiance = that.getEnvLightIrradiance(this, this.diffuseNormal);
          // On `mediumPath`, so zero from below. The foam term is unconditional.
          this.$l.sss = pb.mul(
            this.getScattering(this.mediumPath),
            this.irradiance,
            this.bodyWeight,
            1 / Math.PI
          );
          this.finalColor = pb.add(this.finalColor, this.sss);
          this.finalColor = pb.add(
            this.finalColor,
            pb.mul(this.irradiance, this.foamColor, this.foam, 1 / Math.PI)
          );
        }
        switch (debugOutput) {
          case 'normal':
            this.$if(pb.lessThan(this.diffuseNormal.y, 0.01), function () {
              this.$return(pb.vec3(1, 0, 0));
            }).$else(function () {
              this.$return(pb.add(pb.mul(this.diffuseNormal, 0.5), pb.vec3(0.5)));
            });
            break;
          case 'foam':
            this.$return(pb.vec3(this.foam));
            break;
          case 'shoreFoam':
            this.$return(pb.vec3(this.shoreFoam));
            break;
          case 'waterDepth':
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
            this.$return(this.sss);
            break;
          case 'sunScattering':
            this.$return(this.dbgSunScatter);
            break;
          case 'subsurface':
            this.$return(this.dbgSubsurface);
            break;
          case 'subsurfaceThickness':
            this.$return(pb.vec3(this.sssThickness));
            break;
          case 'depth':
            this.$return(pb.vec3(pb.mul(this.depth, 0.1)));
            break;
          default:
            this.$return(this.finalColor);
        }
      }
    );
    return scope.waterShading(worldPos, worldNormal, foamFactor, crestHeight);
  }
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean, pass: number) {
    super.applyUniforms(bindGroup, ctx, needUpdate, pass);
    const waveGenerator = this._effectiveWaveGenerator;
    // Per bind group: the material owns one per pass/variant hash.
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
      bindGroup.setValue('refractionScale', this._refractionScale);
      if (this.refractionMode === 'offset') {
        bindGroup.setValue('cheapRefractionDepth', this._cheapRefractionDepth);
      }
      bindGroup.setValue('reflectionStrength', this._reflectionStrength);
      bindGroup.setValue('ssrParams', this._ssrParams);
      const eyeUnder = ctx.underwater;
      bindGroup.setValue('eyeSide', eyeUnder ? (eyeUnder.material === this ? -1 : 0) : 1);
      this._subsurfaceParams.setXYZW(this._subsurfaceIntensity, this._subsurfaceCrestHeight, 0, 0);
      bindGroup.setValue('subsurfaceParams', this._subsurfaceParams);
      bindGroup.setValue('subsurfaceTint', this._subsurfaceTint);
      this._foamParams.setXYZW(this._foamAmount, this._foamFalloff, 0, 0);
      bindGroup.setValue('foamShadingParams', this._foamParams);
      bindGroup.setValue('foamColor', this._foamColor);
      if (this._shoreFoamEnabled) {
        this._shoreFoamParams.setXYZW(
          this._shoreFoamAmount,
          this._shoreFoamDepth,
          this._shoreFoamFalloff,
          // Cycles per band width -> cycles per meter.
          this._shoreFoamScale / this._shoreFoamDepth
        );
        bindGroup.setValue('shoreFoamParams', this._shoreFoamParams);
        this._shoreFoamWashParams.setXYZW(
          this._shoreFoamWashAmount,
          this._shoreFoamWashSpeed,
          this._shoreFoamWashScale,
          // Query radius: the band's widest reach over the run-up cycle.
          this._shoreFoamDepth * (1 + this._shoreFoamWashAmount)
        );
        bindGroup.setValue('shoreFoamWashParams', this._shoreFoamWashParams);
      }
      bindGroup.setValue('mediumAlbedo', this._scatterAlbedo);
      bindGroup.setValue('mediumExtinction', this._extinction);
      this._sunScatterParams.setXYZW(this._sunScatteringIntensity, this._scatterAnisotropy, 0, 0);
      bindGroup.setValue('sunScatterParams', this._sunScatterParams);
      // Luminance-weighted scalar: one blur LOD serves all three channels.
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
    return !!this._waveGenerator.get()?.needUpdate() || !!this._interaction.get();
  }
  update(frameId: number, elapsed: number) {
    // The base generator and the field are stepped separately, each guarded by
    // its own per-frame mark, so a generator shared between two bodies of water
    // is still stepped once even when each body wraps it with its own field.
    const waveGenerator = this._waveGenerator.get();
    if (waveGenerator) {
      const updateFrameId = WaterMaterial._waveUpdateState.get(waveGenerator);
      if (updateFrameId !== frameId) {
        waveGenerator.update(elapsed);
        WaterMaterial._waveUpdateState.set(waveGenerator, frameId);
      }
    }
    const interaction = this._interaction.get();
    if (interaction && this._effectiveWaveGenerator instanceof InteractiveWaveGenerator) {
      const updateFrameId = WaterMaterial._interactionUpdateState.get(interaction);
      if (updateFrameId !== frameId) {
        interaction.update(elapsed);
        WaterMaterial._interactionUpdateState.set(interaction, frameId);
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
