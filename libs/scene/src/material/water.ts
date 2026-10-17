import type {
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
import { ShoreWaveGenerator } from '../render/shore_wave_generator';
import type { ShoreWaveSettings } from '../render/shore_wave_generator';
import { FoamFieldWaveGenerator, WaterFoamField, WaveFoamSource } from '../render/water_foam';
import type { FoamFieldSource } from '../render/water_foam';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_RECT, MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import type { Nullable } from '@zephyr3d/base';
import { DRef, Vector3, Vector4 } from '@zephyr3d/base';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import { fetchSampler } from '../utility/misc';
import { mixinLight } from './mixins/lit';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';
import { waterScatterPhase } from '../shaders/water_medium';
import { evaluateLTCRectLightTerms } from '../shaders/ltc_rect';
import { getLTCAmpLUT, getLTCMatLUT } from '../utility/textures/ltclut';
import { foamTexelSize, getDefaultFoamTexture, sampleFoamTexture } from '../utility/textures/foam';

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
 * - `foam`: foam coverage after the amount/falloff ramp, as grey.
 * - `waterDepth`: height of the surface above the scene point behind it, in
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
 * - `shadow`: the lights' shadow factor on the surface, as grey; white with
 *   no shadowed light.
 * - `specular`: the lights' mirror highlights, shadowed, with nothing else.
 * - `depth`: refracted path length through the medium, metres / 10.
 *   no offset is mid grey.
 * - `interaction`: the {@link WaterInteraction} field on its own, mid grey at
 *   rest and reaching black and white at its amplitude clamp; dimmed outside
 *   the field's window.
 * - `foamField`: the foam field on its own, its density as grey, black with no
 *   foam; mid grey off the field, where foam does not linger.
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
  | 'waterDepth'
  | 'fresnel'
  | 'reflection'
  | 'refraction'
  | 'absorption'
  | 'scattering'
  | 'sunScattering'
  | 'subsurface'
  | 'subsurfaceThickness'
  | 'shadow'
  | 'specular'
  | 'depth'
  | 'interaction'
  | 'foamField';

/** Label/value pairs for {@link WaterDebugOutput}, for editor enumerations. */
export const WATER_DEBUG_OUTPUTS = [
  { label: 'None', value: 'none' },
  { label: 'Normal', value: 'normal' },
  { label: 'Foam', value: 'foam' },
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
  { label: 'Interaction', value: 'interaction' },
  { label: 'Foam field', value: 'foamField' }
] as const;

/** Fresnel reflectance of water at normal incidence, n = 1.333. */
const WATER_F0 = 0.02;
/** Specular roughness with the waves resolved. */
const WATER_BASE_ROUGHNESS = 0.04;
/** Specular roughness once distance has flattened the wave normals. */
const WATER_DISTANT_ROUGHNESS = 0.35;
/**
 * Roughness over which the sky reflection hands over from the sharp baked sky
 * to the environment's GGX-prefiltered radiance map at that roughness: the
 * slopes distance flattens out of the normals blur the mirror as they widen
 * the sun's highlight, as Crest picks its reflection mip by roughness.
 */
const SKY_PREFILTER_START = 0.06;
const SKY_PREFILTER_FULL = 0.15;
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
/** Least crest height the gate is worked out over, in metres. See {@link WaterMaterial.subsurfaceCrestHeight}. */
const SSS_CREST_HEIGHT_MIN = 0.05;
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
/**
 * The foam's look follows Crest's OceanFoam.hlsl (Wave Harmonic, MIT): a
 * white foam layer cut from the foam texture by the foam density with a
 * feathered black point, lit through a normal taken from the slope of that
 * cut over a step of a quarter texel per metre of view depth, with a narrow
 * glint; and beneath it bubbles, the same texture blurred three mips and
 * shifted by parallax as if under the surface, tinted and lit by the sky.
 * The texture drifts at FOAM_DRIFT metres per second along x and z, Crest's
 * time / 10.
 */
const FOAM_DRIFT = 0.1;
const FOAM_BUBBLE_MIP_SCALE = 8;
const FOAM_SPECULAR_POWER = 293;
const FOAM_SPECULAR_BOOST = 0.15;
/** Darkest the foam texture shades the wall foam, which it does not cut. */
const WALL_FOAM_TEXTURE_FLOOR = 0.6;

export class WaterMaterial extends applyMaterialMixins(MeshMaterial, mixinLight) {
  private static readonly FEATURE_REFRACTION_MODE = this.defineFeature();
  private static readonly FEATURE_INFINITE = this.defineFeature();
  private static readonly FEATURE_DEBUG_OUTPUT = this.defineFeature();
  private static readonly _waveUpdateState: WeakMap<WaveGenerator, number> = new WeakMap();
  private static readonly _interactionUpdateState: WeakMap<WaterInteraction, number> = new WeakMap();
  private readonly _region: Vector4;
  private _refractionScale: number;
  private _reflectionStrength: number;
  private readonly _waveGenerator: DRef<WaveGenerator>;
  private readonly _interaction: DRef<WaterInteraction>;
  /**
   * The generator the shaders and every other consumer of the surface use: the
   * base generator wrapped with the interaction field while one is attached,
   * the base generator itself otherwise.
   */
  private _effectiveWaveGenerator: Nullable<WaveGenerator>;
  /** Settings of the shore waves, shared by reference with their generator. */
  private readonly _shoreWaves: ShoreWaveSettings = {
    height: 0,
    wavelength: 8,
    period: 6,
    zone: 20,
    sharpness: 0.7,
    lean: 0.5,
    irregularity: 0.6,
    waveFoamStrength: 1,
    waveFoamCoverage: 0.55,
    shorelineFoamMaxDepth: 0.65,
    shorelineFoamStrength: 2,
    wallFoamStrength: 1,
    wallFoamMinSpeed: 0.2,
    wallFoamMaxSpeed: 1.5,
    wallFoamDrift: 0.3
  };
  /** The shore wave layer of the effective generator, while the waves are on. */
  private _shoreWaveGenerator: Nullable<ShoreWaveGenerator> = null;
  /** Foam with memory, carried by the water; kept across rebuilds of the generators. */
  private readonly _foamField = new WaterFoamField();
  /** The foam field layered over the base generator, innermost in the effective generator. */
  private _foamFieldGenerator: Nullable<FoamFieldWaveGenerator> = null;
  /**
   * The interaction layer of the effective generator while a field is attached,
   * wherever it sits in the chain (the shore waves wrap it when they are on).
   */
  private _interactiveWaveGenerator: Nullable<InteractiveWaveGenerator> = null;
  /** What feeds the foam field: the shore waves while they are on, else the open water. */
  private _foamSource: Nullable<FoamFieldSource> = null;
  /** Frame the foam field was last stepped in. */
  private _foamFrameId = -1;
  /** Frame of the last update. */
  private _frameId = 0;
  private _edgeFadeWidth = 0.05;
  /**
   * Thickness in metres over which a thin sheet of water fades in from the
   * ground under it, so swash running up the sand shows the sand through it.
   * 0 disables it.
   */
  get edgeFadeWidth() {
    return this._edgeFadeWidth;
  }
  set edgeFadeWidth(val: number) {
    val = Math.max(0, val);
    if (val !== this._edgeFadeWidth) {
      this._edgeFadeWidth = val;
      this.uniformChanged();
    }
  }
  /** Seconds of water clock at the last update, for the shore waves. */
  private _waveClock = 0;
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
  private _causticsMinDepth: number;
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
  private _foamFeather: number;
  private _foamNormalStrength: number;
  private readonly _foamBubbleColor: Vector3;
  private _foamBubbleCoverage: number;
  private _foamBubbleDepth: number;
  private readonly _foamLookParams: Vector4;
  private readonly _foamTexture: DRef<Texture2D>;
  private _foamTextureSize = 4;
  constructor() {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
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
    this._refractionScale = 1;
    this._reflectionStrength = 1;
    this._causticsEnabled = true;
    this._causticsIntensity = 1;
    this._causticsDepth = 4;
    this._causticsRange = 60;
    this._causticsFadeDistance = 0;
    this._causticsWarp = 1.5;
    this._causticsMinDepth = 0.15;
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
    // Crest's defaults
    this._foamFeather = 0.4;
    this._foamNormalStrength = 3.5;
    this._foamBubbleColor = new Vector3(0.64, 0.83, 0.82);
    this._foamBubbleCoverage = 1.68;
    this._foamBubbleDepth = 0.14;
    this._foamLookParams = new Vector4();
    this._foamTexture = new DRef();
    this.cullMode = 'none';
    this.useFeature(WaterMaterial.FEATURE_REFRACTION_MODE, 'march' as WaterRefractionMode);
    this.useFeature(WaterMaterial.FEATURE_INFINITE, false);
    this.useFeature(WaterMaterial.FEATURE_DEBUG_OUTPUT, 'none' as WaterDebugOutput);
  }
  /** {@inheritDoc Material.onDispose} */
  protected onDispose() {
    super.onDispose();
    this._waveGenerator.dispose();
    this._interaction.dispose();
    this._shoreWaveGenerator?.dispose();
    this._shoreWaveGenerator = null;
    this._foamFieldGenerator?.dispose();
    this._foamFieldGenerator = null;
    this._foamSource = null;
    this._interactiveWaveGenerator = null;
    this._foamField.dispose();
    this._effectiveWaveGenerator = null;
    this._foamTexture.dispose();
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
    this._shoreWaveGenerator?.dispose();
    this._shoreWaveGenerator = null;
    this._foamFieldGenerator?.dispose();
    this._foamFieldGenerator = null;
    this._foamSource = null;
    // A field left behind must not hold on to the generators disposed here
    this._interactiveWaveGenerator?.interaction.setAmbientSurface(null);
    this._interactiveWaveGenerator = null;
    let effective: Nullable<WaveGenerator> = null;
    if (base) {
      // Innermost the foam field, whose foam the shore waves and the
      // interaction field compose theirs over
      const that = this;
      this._foamFieldGenerator = new FoamFieldWaveGenerator(base, this._foamField, {
        getFoamTexture: () => that.foamTexture,
        getFoamTextureSize: () => that._foamTextureSize
      });
      effective = this._foamFieldGenerator;
      this._foamSource = new WaveFoamSource(base, this._foamField);
    }
    if (effective && this._shoreWaves.height > 0) {
      this._shoreWaveGenerator = new ShoreWaveGenerator(effective, this._shoreWaves, this._foamSource!);
      this._foamFieldGenerator!.flowSource = this._shoreWaveGenerator;
      this._foamSource = this._shoreWaveGenerator;
      effective = this._shoreWaveGenerator;
    }
    // Outermost the interaction field: its ripples ride the shore waves rather
    // than being faded with the open water's chop near the shore, and a query
    // of the surface without the disturbers finds it on top to rebuild
    if (effective && interaction && interaction.isOk()) {
      // The field reads the surface beneath it under each disturber, so a hull
      // riding the waves is measured against the water it floats on
      interaction.setAmbientSurface(effective);
      effective = new InteractiveWaveGenerator(effective, interaction);
      this._interactiveWaveGenerator = effective as InteractiveWaveGenerator;
      interaction.ensureResources();
    }
    this._effectiveWaveGenerator = effective;
    // Bind groups are pooled; a stale version must not suppress the upload.
    this._waveVersionByBindGroup = new WeakMap();
    this.optionChanged(true);
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
   * shadow-casting directional light.
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
  /**
   * Water depth in metres below which no caustics show, faded in over half
   * of it either side; 0 shows them right up to the water's edge.
   */
  get causticsMinDepth() {
    return this._causticsMinDepth;
  }
  set causticsMinDepth(val: number) {
    this._causticsMinDepth = Math.max(0, val);
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
    // The gate softens over SSS_HEIGHT_SOFTNESS of this; much below a few
    // centimetres that is a hard step at the still-water level, crests in
    // blotches cut along it
    const clamped = Math.max(SSS_CREST_HEIGHT_MIN, val);
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
   * How gradually the white foam fades out at its edges, from a crisp cut
   * (near 0) to a soft blend into the bubbles beneath (1).
   */
  get foamFeather() {
    return this._foamFeather;
  }
  set foamFeather(val: number) {
    const clamped = Math.min(Math.max(val, 0.001), 1);
    if (clamped !== this._foamFeather) {
      this._foamFeather = clamped;
      this.uniformChanged();
    }
  }
  /** How much the white foam is lit as a lumpy relief rather than a flat sheet, 0 for flat. */
  get foamNormalStrength() {
    return this._foamNormalStrength;
  }
  set foamNormalStrength(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._foamNormalStrength) {
      this._foamNormalStrength = clamped;
      this.uniformChanged();
    }
  }
  /** Tint of the bubbles under the white foam, lit by the sky. */
  get foamBubbleColor() {
    return this._foamBubbleColor;
  }
  set foamBubbleColor(val: Vector3) {
    if (!val.equalsTo(this._foamBubbleColor)) {
      this._foamBubbleColor.set(val);
      this.uniformChanged();
    }
  }
  /** How far the bubbles spread around the white foam and how strongly they show, 0 for none. */
  get foamBubbleCoverage() {
    return this._foamBubbleCoverage;
  }
  set foamBubbleCoverage(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._foamBubbleCoverage) {
      this._foamBubbleCoverage = clamped;
      this.uniformChanged();
    }
  }
  /**
   * Texture the foam is cut from, its value in the red channel: the foam
   * density uncovers it from its brightest parts down, so bright clumps show
   * first and dark holes last. Null for the built-in bubble pattern (see
   * getDefaultFoamTexture), which reads as a texture of one's own would.
   * Tiles every {@link foamTextureSize} metres.
   */
  get foamTexture(): Nullable<Texture2D> {
    return this._foamTexture.get() ?? null;
  }
  set foamTexture(tex: Nullable<Texture2D>) {
    if (tex !== this.foamTexture) {
      this._foamTexture.set(tex);
      this.uniformChanged();
    }
  }
  /** Metres of water one repeat of the {@link foamTexture} covers. */
  get foamTextureSize() {
    return this._foamTextureSize;
  }
  set foamTextureSize(val: number) {
    const clamped = Math.max(0.01, val);
    if (clamped !== this._foamTextureSize) {
      this._foamTextureSize = clamped;
      this.uniformChanged();
    }
  }
  /** How deep under the surface the bubbles seem to float, in metres; they shift against the foam as the view moves. */
  get foamBubbleDepth() {
    return this._foamBubbleDepth;
  }
  set foamBubbleDepth(val: number) {
    const clamped = Math.max(0, val);
    if (clamped !== this._foamBubbleDepth) {
      this._foamBubbleDepth = clamped;
      this.uniformChanged();
    }
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
  protected _createHash() {
    return `${super._createHash()}:${this.waveGenerator?.getHash() ?? ''}`;
  }
  setClipmapInfo(rotation: number, scale: number, offsetX: number, offsetY: number) {
    this._clipmapInfo.setXYZW(rotation, scale, offsetX, offsetY);
    this.uniformChanged();
  }
  /**
   * @param tileResolution - Cells along a clipmap tile, for the spacing of the
   *   mesh vertices the wave generator band-limits to; 0 for no limit.
   */
  setClipmapGridInfo(gridScale: number, gridOffsetX: number, gridOffsetY: number, tileResolution = 0) {
    if (
      this._clipmapGridInfo.x !== gridScale ||
      this._clipmapGridInfo.y !== gridOffsetX ||
      this._clipmapGridInfo.z !== gridOffsetY ||
      this._clipmapGridInfo.w !== tileResolution
    ) {
      this._clipmapGridInfo.setXYZW(gridScale, gridOffsetX, gridOffsetY, tileResolution);
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
    // Spacing of the mesh vertices here: level L of the clipmap spans
    // Chebyshev distances from T 2^L to 2T 2^L cells around the camera with
    // cells 2^L across, so distance / T bounds it from above. Taken from the
    // distance rather than the level so that two levels meeting at a seam
    // agree on it and displace their shared vertices alike.
    scope.$l.camOffset = pb.abs(pb.sub(scope.clipmapWorldPos.xz, ShaderHelper.getCameraPosition(scope).xz));
    scope.$l.vertexSpacing = pb.mul(
      pb.max(
        scope.clipmapGridInfo.x,
        pb.div(pb.max(scope.camOffset.x, scope.camOffset.y), pb.max(scope.clipmapGridInfo.w, 1))
      ),
      pb.step(0.5, scope.clipmapGridInfo.w)
    );
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
            this.worldNormal,
            this.vertexSpacing
          );
        });
      scope.$outputs.skirt = scope.skirt;
    } else {
      this.waveGenerator?.calcVertexPositionAndNormal(
        scope,
        scope.clipmapWorldPos,
        scope.worldPos,
        scope.worldNormal,
        scope.vertexSpacing
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
    const gen = this.waveGenerator;
    if (gen?.calcPrevVertexPosition && ShaderHelper.getPrevUnjitteredViewProjectionMatrix(scope)) {
      scope.$l.prevWorldPos = pb.vec3();
      gen.calcPrevVertexPosition(scope, scope.clipmapWorldPos, scope.prevWorldPos, scope.vertexSpacing);
      if (this.infinite) {
        // The skirt does not move
        scope.prevWorldPos = pb.mix(scope.prevWorldPos, scope.$outputs.worldPos, scope.skirt);
      }
      ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.prevWorldPos);
    } else {
      ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
    }
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
      // (white foam feather, foam normal strength, bubble coverage, bubble depth in m)
      scope.foamLookParams = pb.vec4().uniform(2);
      scope.foamBubbleColor = pb.vec3().uniform(2);
      scope.foamTex = pb.tex2D().uniform(2);
      // uv of the foam texture per metre
      scope.foamUVScale = pb.float().uniform(2);
      // Thickness in metres a sheet of water fades in over, 0 for none
      scope.edgeFadeWidth = pb.float().uniform(2);
      // (intensity, anisotropy, 0, 0)
      scope.sunScatterParams = pb.vec4().uniform(2);
      // Mip widths per meter of path; one scalar LOD for all three channels.
      scope.refractBlurDensity = pb.float().uniform(2);
      scope.mediumAlbedo = pb.vec3().uniform(2);
      scope.mediumExtinction = pb.vec3().uniform(2);
      // Rect light specular (evaluateLTCRectLightTerms).
      scope.zLTCMatLut = pb.tex2D().uniform(2);
      scope.zLTCAmpLut = pb.tex2D().uniform(2);
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
      // Screen derivatives of the undisplaced position, taken here in uniform
      // control flow; the foam textures are sampled with them under branches.
      scope.$l.restXZGrad = pb.vec4(
        pb.dpdx(scope.$inputs.clipmapPos.xz),
        pb.dpdy(scope.$inputs.clipmapPos.xz)
      );
      // The foam texture here, drifting; a generator carrying foam of its own
      // blends in where its foam is
      scope.$l.foamSample = sampleFoamTexture(
        scope,
        scope.foamTex,
        pb.mul(
          pb.add(
            scope.$inputs.clipmapPos.xz,
            pb.vec2(pb.mul(ShaderHelper.getElapsedTime(scope), FOAM_DRIFT))
          ),
          scope.foamUVScale
        ),
        scope.restXZGrad,
        scope.foamUVScale
      );
      scope.$l.normal = this.waveGenerator
        ? this.waveGenerator.calcFragmentNormalAndFoam(
            scope,
            scope.$inputs.clipmapPos.xz,
            scope.$inputs.worldNormal,
            scope.foamSample
          )
        : pb.vec4(scope.$inputs.worldNormal, 0);
      if (this.infinite) {
        // Flat and foamless on the skirt: waves evaluated at kilometres per
        // pixel alias into speckle.
        scope.normal = pb.mix(scope.normal, pb.vec4(0, 1, 0, 0), scope.$inputs.skirt);
      }
      // Vertical wave displacement, interpolated from the vertices. Zero on the skirt.
      scope.$l.crestHeight = pb.sub(scope.$inputs.worldPos.y, scope.$inputs.clipmapPos.y);
      const surfaceCoverage = this.waveGenerator?.calcSurfaceCoverage;
      scope.$l.surfaceCoverage = surfaceCoverage
        ? surfaceCoverage.call(this.waveGenerator, scope, scope.$inputs.clipmapPos.xz)
        : pb.float(1);
      const sheetThickness = this.waveGenerator?.calcSheetThickness;
      scope.$l.sheetThickness = sheetThickness
        ? sheetThickness.call(this.waveGenerator, scope, scope.$inputs.clipmapPos.xz)
        : pb.float(-1);
      // Wholly past the water's edge: nothing to draw, rather than the scene
      // colour behind, which the final image does not quite match
      if (surfaceCoverage) {
        scope.$if(pb.lessThanEqual(scope.surfaceCoverage, 1e-3), function () {
          pb.discard();
        });
      }
      if (this.debugOutput === 'interaction') {
        // The field on its own, grey at rest, scaled so its amplitude clamp
        // reaches black and white; dimmed outside the window so its reach shows.
        if (this._interactiveWaveGenerator) {
          const interaction = this._interactiveWaveGenerator.interaction;
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
      } else if (this.debugOutput === 'foamField') {
        // The field's density; mid grey off the field, where coverage is 0
        if (this._foamFieldGenerator) {
          scope.$l.ffDebug = this._foamField.sample(scope, scope.$inputs.clipmapPos.xz);
        } else {
          scope.$l.ffDebug = pb.vec3(0);
        }
        scope.$l.outColor = pb.vec4(
          pb.vec3(pb.mix(pb.float(0.5), pb.max(scope.ffDebug.x, scope.ffDebug.z), scope.ffDebug.y)),
          1
        );
      } else {
        // The foam field's wall foam layer, see FOAM_WALL
        scope.$l.wallFoam = this._foamFieldGenerator
          ? pb.mul(
              this._foamField.sample(scope, scope.$inputs.clipmapPos.xz).z,
              this.infinite ? pb.sub(1, scope.$inputs.skirt) : pb.float(1)
            )
          : pb.float(0);
        scope.$l.outColor = pb.vec4(
          this.waterShading(
            scope,
            scope.$inputs.worldPos,
            scope.normal.xyz,
            scope.normal.w,
            scope.crestHeight,
            scope.$inputs.clipmapPos.xz,
            scope.restXZGrad,
            scope.foamSample,
            scope.surfaceCoverage,
            scope.sheetThickness,
            scope.wallFoam
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
    crestHeight: PBShaderExp,
    restXZ: PBShaderExp,
    restXZGrad: PBShaderExp,
    foamSample: PBShaderExp,
    coverage: PBShaderExp,
    sheetThickness: PBShaderExp,
    wallFoam: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const debugOutput = this.debugOutput;
    // The environment's prefiltered radiance, for the distant sky reflection
    const envLight = this.needCalculateEnvLight() ? (this.drawContext.env?.light.envLight ?? null) : null;
    // Transmittance over `depth` meters of path.
    pb.func('getAbsorption', [pb.float('depth')], function () {
      this.$return(pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.depth))));
    });
    // Fraction of incident irradiance scattered back over `depth` meters of path.
    pb.func('getScattering', [pb.float('depth')], function () {
      this.$return(
        pb.mul(
          this.mediumAlbedo,
          pb.sub(pb.vec3(1), pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.depth))))
        )
      );
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
    // White foam revealed from a foam texture sample (value, slopes along x
    // and z) by a density, Crest's feathered black point; as (white foam, its
    // slope along x, along z).
    pb.func('waterWhiteFoam', [pb.float('density'), pb.vec3('tex'), pb.float('feather')], function () {
      this.$l.t = pb.clamp(
        pb.div(pb.sub(this.tex.x, pb.sub(1, pb.clamp(this.density, 0, 1))), this.feather),
        0,
        1
      );
      this.$return(
        pb.vec3(
          pb.mul(this.t, this.t, pb.sub(3, pb.mul(this.t, 2))),
          pb.mul(this.tex.yz, pb.div(pb.mul(6, this.t, pb.sub(1, this.t)), this.feather))
        )
      );
    });
    pb.func(
      'waterShading',
      [
        pb.vec3('worldPos'),
        pb.vec3('worldNormal'),
        pb.float('foamFactor'),
        pb.float('crestHeight'),
        pb.vec2('restXZ'),
        pb.vec4('restXZGrad'),
        pb.vec3('foamSample'),
        pb.float('coverage'),
        pb.float('sheetThickness'),
        pb.float('wallFoam')
      ],
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
          if (envLight?.hasRadiance()) {
            // Blurred as the distant normals are: the prefiltered radiance at
            // the surface's roughness, in the same pre-exposed space
            this.$l.skyBlur = pb.smoothStep(SKY_PREFILTER_START, SKY_PREFILTER_FULL, this.roughness);
            this.$if(pb.greaterThan(this.skyBlur, 0), function () {
              this.reflMiss = pb.mix(
                this.reflMiss,
                pb.mul(
                  envLight.getRadiance(this, this.refl, this.roughness)!.rgb,
                  ShaderHelper.getEnvLightStrength(this)
                ),
                this.skyBlur
              );
            });
          }
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
        // Foam density from the wave generator: crests, wakes, breaking shore waves
        this.$l.crestDensity = pb.clamp(
          pb.mul(pb.pow(pb.clamp(this.foamFactor, 0, 1), this.foamShadingParams.y), this.foamShadingParams.x),
          0,
          1
        );
        this.$l.crestWhite = this.waterWhiteFoam(this.crestDensity, this.foamSample, this.foamLookParams.x);
        // Wall foam, shown whole where it is rather than cut from the texture,
        // by its strength: the texture only shades it, so a fringe of foam
        // around a rock keeps its pattern without breaking into patches
        this.$l.wallWhite = pb.mul(
          pb.clamp(this.wallFoam, 0, 1),
          this.foamShadingParams.z,
          pb.mix(WALL_FOAM_TEXTURE_FLOOR, 1, pb.clamp(this.foamSample.x, 0, 1))
        );
        this.$l.foam = pb.sub(1, pb.mul(pb.sub(1, this.crestWhite.x), pb.sub(1, this.wallWhite)));
        this.$l.foamGrad = this.crestWhite.yz;
        this.$l.bubbleDensity = this.crestDensity;
        // Normal of the white foam's relief: Crest differences the cut over a
        // quarter texel per metre of view depth, which keeps the relief at a
        // distance; the slope times that step here
        this.$l.foamStep = pb.mul(this.dist, 0.25, foamTexelSize(this, this.foamTex, this.foamUVScale));
        this.$l.foamNormal = pb.normalize(
          pb.add(
            this.diffuseNormal,
            pb.mul(
              pb.vec3(pb.neg(this.foamGrad.x), 0, pb.neg(this.foamGrad.y)),
              this.foamLookParams.y,
              this.foamStep
            )
          )
        );
        // The white foam covers the water, its mirror and what is seen through
        // it alike, as Crest lays it over the finished water colour
        // (lerp(col, whiteFoam, a)): both only on the share without foam.
        // `bodyWeight`, the exit transmission on that share, weighs the
        // refraction and every body term below.
        this.$l.waterShare = pb.sub(1, this.foam);
        this.$l.bodyWeight = pb.mul(pb.sub(1, this.fresnelTerm), this.waterShare);
        this.fresnelTerm = pb.mul(this.fresnelTerm, this.waterShare);
        this.$l.finalColor = pb.add(
          pb.mul(this.refraction, this.bodyWeight),
          pb.mul(this.reflectance, this.fresnelTerm)
        );
        // Debug accumulators. Dead in the `none` variant.
        this.$l.dbgSubsurface = pb.vec3(0);
        this.$l.dbgSunScatter = pb.vec3(0);
        this.$l.dbgShadow = pb.vec3(1);
        this.$l.dbgSpecular = pb.vec3(0);
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
            pb.div(pb.add(pb.dot(this.foamNormal, this.lightDir), FOAM_LIGHT_WRAP), 1 + FOAM_LIGHT_WRAP),
            0,
            1
          );
          this.$l.lightEnergy = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
          this.$l.specularTerm = pb.vec3(0);
          // A rect light's mirror image is the rect itself: integrate the GGX
          // lobe over it with LTC, as the PBR materials do. One direction would
          // shrink it to a point highlight on a surface this smooth.
          this.$if(pb.equal(type, LIGHT_TYPE_RECT), function () {
            this.$l.rectTerms = evaluateLTCRectLightTerms(
              this,
              this.worldPos,
              this.shadingNormal,
              pb.neg(this.eyeVecNorm),
              this.roughness,
              posRange,
              dirCutoff.xyz,
              extra.xyz
            );
            this.specularTerm = pb.mul(
              colorIntensity.rgb,
              colorIntensity.a,
              this.rectTerms.x,
              pb.add(pb.mul(this.rectTerms.y, WATER_F0), pb.mul(this.rectTerms.z, 1 - WATER_F0))
            );
          }).$else(function () {
            this.specularTerm = this.lightSpecular(
              this.lightDir,
              this.eyeVecNorm,
              this.shadingNormal,
              this.lightEnergy,
              this.roughness
            );
          });
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
          // Scaled by the light as Crest scales its subsurface term by the
          // light colour, so a crest glows the colour of the sun behind it and
          // dims as it sets; by 1 / pi, as the foam's and every diffuse term
          // here are. Directional only, from the sun behind the crest.
          // Leaves the body, so it carries `bodyWeight` like every body term.
          this.$l.subsurfaceTerm = pb.vec3(0);
          this.$if(pb.equal(type, LIGHT_TYPE_DIRECTIONAL), function () {
            this.subsurfaceTerm = pb.mul(
              this.subsurfaceTint,
              this.lightEnergy,
              pb.mul(this.sssFacing, this.sssThickness, this.subsurfaceParams.x, 1 / Math.PI),
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
          // Foam as a matte layer, with Crest's narrow glint off its relief.
          this.$l.foamGlint = pb.mul(
            pb.pow(
              pb.max(pb.dot(pb.reflect(this.eyeVecNorm, this.foamNormal), this.lightDir), 0),
              FOAM_SPECULAR_POWER
            ),
            FOAM_SPECULAR_BOOST
          );
          this.lightContrib = pb.add(
            this.lightContrib,
            pb.mul(
              this.lightEnergy,
              this.foam,
              pb.add(pb.mul(this.foamColor, this.NoLfoam, 1 / Math.PI), pb.vec3(this.foamGlint))
            )
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
          this.dbgShadow = pb.min(this.dbgShadow, this.shadow);
          this.dbgSpecular = pb.add(this.dbgSpecular, pb.mul(this.specularTerm, this.shadow));
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
          // Bubbles under the white foam, part of the water body as in Crest,
          // so under the white foam and the mirror: the foam texture blurred and
          // shifted by parallax, as seen at a depth under the surface
          this.$if(pb.greaterThan(this.bubbleDensity, 0), function () {
            this.$l.toEye = pb.neg(this.eyeVecNorm);
            this.$l.bubbleShift = pb.div(
              pb.mul(this.toEye.xz, pb.neg(this.foamLookParams.w)),
              pb.max(pb.dot(this.diffuseNormal, this.toEye), 0.1)
            );
            this.$l.bubbleTex = sampleFoamTexture(
              this,
              this.foamTex,
              pb.mul(
                pb.add(
                  this.restXZ,
                  this.bubbleShift,
                  pb.vec2(pb.mul(ShaderHelper.getElapsedTime(this), FOAM_DRIFT))
                ),
                this.foamUVScale
              ),
              this.restXZGrad,
              this.foamUVScale,
              FOAM_BUBBLE_MIP_SCALE,
              false
            ).x;
            this.finalColor = pb.add(
              this.finalColor,
              pb.mul(
                this.irradiance,
                this.foamBubbleColor,
                this.bubbleTex,
                pb.clamp(pb.mul(this.bubbleDensity, this.foamLookParams.z), 0, 1),
                this.bodyWeight,
                1 / Math.PI
              )
            );
          });
        }
        // A sheet of water a few centimetres thick, as the swash leaves running
        // up the sand, shows the sand through it rather than a surface over it;
        // and where the moving mesh grazes the beach it leaves no stray patches.
        // Where the wave generator runs the mesh on past the water's edge, the
        // scene behind shows instead.
        this.$if(pb.not(this.underwaterEye), function () {
          // From the wave generator's own ground where it has one: the depth
          // buffer reconstruction moves with the camera jitter by about as much
          // as the sheet is thick, and the fade flickered with it
          this.$l.edgeThickness = this.$choice(
            pb.greaterThanEqual(this.sheetThickness, 0),
            this.sheetThickness,
            pb.sub(this.worldPos.y, this.wPos.y)
          );
          this.$l.edgeFade = pb.mul(
            this.$choice(
              pb.greaterThan(this.edgeFadeWidth, 0),
              pb.smoothStep(0, pb.max(this.edgeFadeWidth, 1e-4), this.edgeThickness),
              pb.float(1)
            ),
            this.coverage
          );
          this.$if(pb.lessThan(this.edgeFade, 1), function () {
            this.$l.behind = pb.textureSampleLevel(
              ShaderHelper.getSceneColorTexture(this),
              this.screenUV,
              0
            ).rgb;
            this.finalColor = pb.mix(this.behind, this.finalColor, this.edgeFade);
          });
        });
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
          case 'waterDepth':
            this.$return(pb.vec3(pb.mul(pb.max(pb.sub(this.worldPos.y, this.wPos.y), 0), 0.1)));
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
          case 'shadow':
            this.$return(this.dbgShadow);
            break;
          case 'specular':
            this.$return(this.dbgSpecular);
            break;
          case 'depth':
            this.$return(pb.vec3(pb.mul(this.depth, 0.1)));
            break;
          default:
            this.$return(this.finalColor);
        }
      }
    );
    return scope.waterShading(
      worldPos,
      worldNormal,
      foamFactor,
      crestHeight,
      restXZ,
      restXZGrad,
      foamSample,
      coverage,
      sheetThickness,
      wallFoam
    );
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
      this._foamParams.setXYZW(
        this._foamAmount,
        this._foamFalloff,
        this._shoreWaves.height > 0 ? this._shoreWaves.wallFoamStrength! : 0,
        0
      );
      bindGroup.setValue('foamShadingParams', this._foamParams);
      bindGroup.setValue('foamColor', this._foamColor);
      this._foamLookParams.setXYZW(
        this._foamFeather,
        this._foamNormalStrength,
        this._foamBubbleCoverage,
        this._foamBubbleDepth
      );
      bindGroup.setValue('foamLookParams', this._foamLookParams);
      bindGroup.setValue('foamBubbleColor', this._foamBubbleColor);
      bindGroup.setTexture(
        'foamTex',
        this.foamTexture ?? getDefaultFoamTexture(),
        fetchSampler('repeat_linear')
      );
      bindGroup.setValue('foamUVScale', 1 / this._foamTextureSize);
      bindGroup.setValue('edgeFadeWidth', this._edgeFadeWidth);
      bindGroup.setValue('mediumAlbedo', this._scatterAlbedo);
      bindGroup.setValue('mediumExtinction', this._extinction);
      bindGroup.setTexture('zLTCMatLut', getLTCMatLUT());
      bindGroup.setTexture('zLTCAmpLut', getLTCAmpLUT());
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
    }
    if (this.waveGenerator) {
      this.waveGenerator.applyWaterBindGroup(bindGroup);
    }
  }
  needUpdate() {
    return (
      !!this._waveGenerator.get()?.needUpdate() || !!this._interaction.get() || !!this._shoreWaveGenerator
    );
  }
  /**
   * Crest to trough height in metres of the waves rolling in to the shore and
   * running up the beach, 0 for none. See {@link ShoreWaveGenerator}. Needs
   * the scene signed distance field (WebGPU); without it the waves are off.
   */
  get shoreWaveHeight() {
    return this._shoreWaves.height;
  }
  set shoreWaveHeight(val: number) {
    val = Math.max(0, val);
    const wasOn = this._shoreWaves.height > 0;
    this._shoreWaves.height = val;
    if (wasOn !== val > 0) {
      this._rebuildEffectiveWaveGenerator();
    }
  }
  /** Distance in metres between shore wave crests at the outer edge of their zone; they bunch up towards the shore. */
  get shoreWaveLength() {
    return this._shoreWaves.wavelength;
  }
  set shoreWaveLength(val: number) {
    this._shoreWaves.wavelength = Math.max(0.5, val);
  }
  /** Seconds between successive shore waves. */
  get shoreWavePeriod() {
    return this._shoreWaves.period;
  }
  set shoreWavePeriod(val: number) {
    this._shoreWaves.period = Math.max(0.5, val);
  }
  /** How far out from the waterline the shore waves rise, in metres. */
  get shoreWaveZone() {
    return this._shoreWaves.zone;
  }
  set shoreWaveZone(val: number) {
    this._shoreWaves.zone = Math.max(1, val);
  }
  /** How sharp the shore wave crests become at the shore, 0 for a sine and towards 1 for a cusp. */
  get shoreWaveSharpness() {
    return this._shoreWaves.sharpness;
  }
  set shoreWaveSharpness(val: number) {
    this._shoreWaves.sharpness = Math.min(Math.max(val, 0), 0.95);
  }
  /** How far the shore wave crests lean towards the shore there, 0 for upright, 1 for a steep front face. */
  get shoreWaveLean() {
    return this._shoreWaves.lean;
  }
  set shoreWaveLean(val: number) {
    this._shoreWaves.lean = Math.min(Math.max(val, 0), 1);
  }
  /** How irregular the shore waves are, 0..1: 0 for parallel crests a fixed wavelength apart, higher for each wave with a period and a bend of its own. */
  get shoreWaveIrregularity() {
    return this._shoreWaves.irregularity!;
  }
  set shoreWaveIrregularity(val: number) {
    this._shoreWaves.irregularity = Math.min(Math.max(val, 0), 1);
  }
  /** How fast the foam fades, per second (Crest's Foam Fade Rate): lower leaves longer trails behind breaking waves. */
  get foamFadeRate() {
    return this._foamField.fadeRate;
  }
  set foamFadeRate(val: number) {
    this._foamField.fadeRate = val;
  }
  /** How much foam the open water's breaking crests leave behind to drift and fade; 0 keeps foam only while a crest breaks. */
  get foamTrailStrength() {
    return this._foamField.baseStrength;
  }
  set foamTrailStrength(val: number) {
    this._foamField.baseStrength = val;
  }
  /** Share of the wind speed the foam drifts at, about 0.03 in nature. */
  get foamDrift() {
    return this._foamField.drift;
  }
  set foamDrift(val: number) {
    this._foamField.drift = val;
  }
  /** Side in metres of the finest square of water around the view whose foam lingers, in the most detail; coarser squares reach eight times as far, beyond which foam shows only while crests break. */
  get foamFieldSize() {
    return this._foamField.size;
  }
  set foamFieldSize(val: number) {
    this._foamField.size = val;
  }
  /** How much foam the breaking shore waves make (Crest's Wave Foam Strength). */
  get shoreWaveFoamStrength() {
    return this._shoreWaves.waveFoamStrength!;
  }
  set shoreWaveFoamStrength(val: number) {
    this._shoreWaves.waveFoamStrength = Math.max(0, val);
  }
  /** How much of the shore waves makes foam, 0..1, higher for more (Crest's Wave Foam Coverage). */
  get shoreWaveFoamCoverage() {
    return this._shoreWaves.waveFoamCoverage!;
  }
  set shoreWaveFoamCoverage(val: number) {
    this._shoreWaves.waveFoamCoverage = Math.min(Math.max(val, 0), 1);
  }
  /** Water shallower than this many metres makes foam (Crest's Shoreline Foam Max Depth). */
  get shoreWaveShallowFoamDepth() {
    return this._shoreWaves.shorelineFoamMaxDepth!;
  }
  set shoreWaveShallowFoamDepth(val: number) {
    this._shoreWaves.shorelineFoamMaxDepth = Math.max(0.01, val);
  }
  /** How much foam shallow water makes (Crest's Shoreline Foam Strength). */
  get shoreWaveShallowFoamStrength() {
    return this._shoreWaves.shorelineFoamStrength!;
  }
  set shoreWaveShallowFoamStrength(val: number) {
    this._shoreWaves.shorelineFoamStrength = Math.max(0, val);
  }
  /** How opaque the foam is that the water makes against walls, rocks and piers standing in it, 0..1; it always rings them whole. */
  get wallFoamStrength() {
    return this._shoreWaves.wallFoamStrength!;
  }
  set wallFoamStrength(val: number) {
    this._shoreWaves.wallFoamStrength = Math.min(Math.max(val, 0), 1);
    this.uniformChanged();
  }
  /** Speed in metres per second the water has to hit a wall at before it makes any foam there. */
  get wallFoamMinSpeed() {
    return this._shoreWaves.wallFoamMinSpeed!;
  }
  set wallFoamMinSpeed(val: number) {
    this._shoreWaves.wallFoamMinSpeed = Math.max(0, val);
  }
  /** Speed in metres per second at which water hitting a wall makes the most foam. */
  get wallFoamMaxSpeed() {
    return this._shoreWaves.wallFoamMaxSpeed!;
  }
  set wallFoamMaxSpeed(val: number) {
    this._shoreWaves.wallFoamMaxSpeed = Math.max(0.01, val);
  }
  /** Speed in metres per second the foam drifts out from walls, rocks and piers at: higher for a wider ring of foam around them. */
  get wallFoamDrift() {
    return this._shoreWaves.wallFoamDrift!;
  }
  set wallFoamDrift(val: number) {
    this._shoreWaves.wallFoamDrift = Math.max(0, val);
  }
  /**
   * Hands the shore waves this frame's waterline field, or null when there is
   * none, which turns them off. Called by the water every frame.
   * @internal
   */
  setShoreWaveFrame(waterline: Nullable<Texture2D>, region: Vector4, level: number) {
    this._shoreWaveGenerator?.setFrame(waterline, region, level, this._waveClock);
  }
  /**
   * Steps the foam field around the water the view looks at, once a frame
   * however many views there are. Called by the water after
   * {@link setShoreWaveFrame}, which its sources read.
   * @param focusX - World x the field is centred on.
   * @param focusZ - World z the field is centred on.
   * @internal
   */
  updateFoamField(focusX: number, focusZ: number) {
    if (!this._foamSource || this._foamFrameId === this._frameId) {
      return;
    }
    this._foamFrameId = this._frameId;
    this._foamField.stepAround(
      focusX,
      focusZ,
      this._waveClock,
      this._waveGenerator.get()?.wind ?? null,
      this._foamSource
    );
  }
  update(frameId: number, elapsed: number) {
    this._frameId = frameId;
    this._waveClock = elapsed;
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
    if (interaction && this._interactiveWaveGenerator) {
      const updateFrameId = WaterMaterial._interactionUpdateState.get(interaction);
      if (updateFrameId !== frameId) {
        interaction.update(elapsed);
        WaterMaterial._interactionUpdateState.set(interaction, frameId);
      }
    }
  }
}
