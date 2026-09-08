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
import { getDevice } from '../app/api';

/**
 * How the water medium converts a path length into transmittance and in-scattering.
 *
 * - `physical`: Beer-Lambert with authored absorption/scattering coefficients in 1/m.
 *   The same coefficients drive the caustic transmittance, so surface shading and
 *   underwater caustics agree by construction.
 * - `ramp`: the legacy artist-authored ramp textures indexed by `depth * depthMulti`.
 *   Kept as an override for scenes tuned against it; caustics still use the physical
 *   coefficients, so the two can disagree in this mode.
 *
 * @public
 */
export type WaterMediumMode = 'physical' | 'ramp';

/** Fresnel reflectance of water at normal incidence, for n = 1.333. */
const WATER_F0 = 0.02;
/** Specular roughness of water close enough that the waves are resolved. */
const WATER_BASE_ROUGHNESS = 0.04;
/**
 * Specular roughness once the distance fade has flattened the waves away.
 *
 * The fade suppresses wave slope that used to break the sun's highlight into
 * glitter. Left at the sharp near-field roughness the remaining mirror aliases
 * badly; widening the lobe by the same amount the slope was cut turns it back
 * into a stable band.
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
 * to what is behind the water.
 *
 * A guard rather than physics: the refracted ray only reaches a given depth if
 * it travels away from the camera, and a nearly tangent one - a steep wave face
 * seen from the side - approaches that limit and would produce an enormous step.
 * Above water Snell bounds the true ratio near 1.5, so this leaves headroom.
 */
const REFRACT_MAX_PATH_RATIO = 4;
/**
 * Number of steps the refracted-ray march takes over {@link REFRACT_MAX_PATH_RATIO}.
 *
 * Each step reads the depth buffer at the projected ray position and compares it
 * against the ray's own depth, so the number of steps is what sets how finely a
 * scene discontinuity - a submerged box's far edge against the bed - is caught.
 * The two-probe solve this replaced jumped straight to a guessed path length and
 * could land either side of such an edge, so adjacent water pixels snapped
 * between the box and what is behind it, which reads as a tear across the box.
 * Fixed count keeps the shader uniform (an unbounded bisection would diverge
 * between backends): 24 steps resolve a crest-to-bed exchange to well under a
 * water pixel at typical camera distances.
 */
const REFRACT_MARCH_STEPS = 24;
/** Depth tolerance, in meters, for the march to treat a step as a hit. */
const REFRACT_MARCH_THICKNESS = 0.05;
/**
 * Width in UV of the band the refraction offset fades out over at the screen
 * border.
 *
 * Off-screen there is no scene colour to refract, and a clamped sample smears
 * the border pixel across the water; sliding back to the unrefracted sample over
 * a band keeps that continuous instead of banding at the edge.
 */
const REFRACT_EDGE_FADE = 0.06;
/**
 * How far the surface normal bends the transmitted direction in the subsurface
 * term. Zero would make the glow a pure "looking at the sun through the water"
 * term with no shape to it; this is what lets the wave itself modulate it.
 */
const SSS_DISTORTION = 0.25;
/** Falloff of the subsurface lobe. Higher keeps the glow closer to the sun. */
const SSS_POWER = 4;
/**
 * Mean cosine of one scattering event in the water body.
 *
 * Real sea water is strongly forward-scattering - measurements put it near 0.9 -
 * but at that value almost nothing comes back towards a camera looking down at
 * the water, which is the common case. The default gives up some of that peak
 * for a term that reads from above; the multiple-scattering blend in
 * {@link WaterMaterial.waterSunScattering} restores the isotropy a turbid
 * medium genuinely has, so the two together stay closer to the truth than a
 * single lobe of either width.
 */
export const DEFAULT_SCATTER_ANISOTROPY = 0.7;
/**
 * Share of the scattering that is molecular rather than particulate.
 *
 * Sets how much light comes back towards a camera looking down at the water: the
 * particulate lobe is forward-peaked and returns almost nothing into the
 * backward hemisphere, so this fraction is what the term is made of in the
 * commonest camera setup there is. Measured sea water puts molecular scattering
 * at a few percent of the total, but the number that matters here is its share
 * of the *backscatter*, where it dominates - at the default anisotropy it
 * supplies about nine tenths of what returns at 180 degrees.
 *
 * Not exposed: it trades one lobe against the other, which is what
 * {@link WaterMaterial.scatterAnisotropy} already does in a way an author can
 * reason about.
 */
const MOLECULAR_SCATTER_FRACTION = 0.12;
/**
 * Floor on how fast the refracted sun ray descends, used by the in-scattering
 * integral.
 *
 * The integral divides the view path by how fast the sun's path to the same
 * point deepens, and a sun on the horizon lights the column along an unbounded
 * path - which single scattering cannot represent at all. Clamping caps the term
 * instead of letting it diverge.
 *
 * Well below the elevation the caustics pass gives up at, deliberately: this
 * only has to keep the arithmetic finite, and Snell already refracts a grazing
 * sun to about 41 degrees below the surface, so the clamp is unreachable for any
 * sun actually above the horizon.
 */
const MIN_SUN_SLOPE = 0.05;

export class WaterMaterial extends applyMaterialMixins(MeshMaterial, mixinLight) {
  private static readonly FEATURE_MEDIUM_MODE = this.defineFeature();
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
  private _waveVersion: number;
  private readonly _clipmapInfo: Vector4;
  private readonly _clipmapGridInfo: Vector4;
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
  private _subsurfaceIntensity: number;
  private _subsurfaceSteepness: number;
  private readonly _subsurfaceParams: Vector4;
  private _sunScatteringIntensity: number;
  private _scatterAnisotropy: number;
  private readonly _sunScatterParams: Vector4;
  private _foamAmount: number;
  private _foamFalloff: number;
  private readonly _foamColor: Vector3;
  private readonly _foamParams: Vector4;
  constructor() {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    // Defaults are fitted to the legacy absorption ramp at depthMulti = 0.1, so
    // switching the medium to physical does not change the out-of-box look much.
    this._absorption = new Vector3(1.0, 0.25, 0.15);
    this._scattering = new Vector3(0.05, 0.12, 0.18);
    this._extinction = new Vector3();
    this._scatterAlbedo = new Vector3();
    this._absorptionScale = 1;
    this._scatteringScale = 1;
    this._updateMediumCoefficients();
    this._clipmapInfo = new Vector4();
    this._clipmapGridInfo = new Vector4();
    this._waveGenerator = new DRef();
    this._waveVersion = -1;
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
    // Sized so a fully lit crest contributes about as much as the ambient
    // scattering term already does, rather than to a picked-by-eye number. That
    // term is albedo * irradiance / PI, and this one is albedo * sunEnergy *
    // intensity at thickness 1, so an intensity near 1 puts the two on the same
    // footing for a sun and sky of comparable strength.
    this._subsurfaceIntensity = 1.5;
    // Chosen against the backlit scene: at 4 the wave flanks carry the glow
    // and the troughs stay dark, while 20 turns the whole sea into a lamp.
    this._subsurfaceSteepness = 4;
    this._subsurfaceParams = new Vector4();
    // Physical by default: the integral is derived, not fitted, so 1 is the
    // value the medium coefficients already imply.
    this._sunScatteringIntensity = 1;
    this._scatterAnisotropy = DEFAULT_SCATTER_ANISOTROPY;
    this._sunScatterParams = new Vector4();
    // Coverage from the generator is a folded-surface measure, not an area
    // fraction; these map it onto one. The falloff above 1 keeps light folding
    // - the shoulder of a wave about to break - from reading as foam.
    this._foamAmount = 1;
    this._foamFalloff = 1.5;
    // Slightly off-white and slightly blue: sea foam is water and air, and a
    // pure white one reads as snow.
    this._foamColor = new Vector3(0.92, 0.95, 0.97);
    this._foamParams = new Vector4();
    this.cullMode = 'none';
    this.useFeature(WaterMaterial.FEATURE_MEDIUM_MODE, 'physical' as WaterMediumMode);
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
      this._waveVersion = -1;
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
   * Photons are splatted onto a horizontal plane at this depth. Receivers away
   * from it are progressively defocused rather than displaced, so set this near
   * the depth of the sea bed that should show the sharpest pattern.
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
   * within this distance, so water smaller than it spends the whole map on the
   * water instead of on empty margin. Raise it to light more of the scene, at
   * the cost of resolution wherever the water is large enough to fill it.
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
   * The map covers a bounded area and the pattern has to reach the neutral 1.0
   * outside it. Fading over a fixed fraction of the map ties that band to the
   * range, which collapses it to almost nothing once the range is small - and a
   * narrow band is exactly where the boundary starts reading as a hard line
   * across the sea bed. Auto keeps the fraction but puts a floor under it in
   * meters.
   *
   * Capped at 90% of the range, so a core of the map always survives.
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
   * The plane is a single depth for the whole map, so a receiver that is not at
   * that depth reads a pattern displaced sideways by the difference times the
   * tangent of the refracted angle - invisible under a high sun, badly wrong
   * under a low one, and wrong everywhere on a sea bed with relief. Resolving
   * the real depth reuses the sun's shadow cascade, so it costs no extra
   * geometry pass, and falls back to the plane wherever that cascade has
   * nothing to say.
   *
   * {@link causticsDepth} still sets where the iteration starts and what the
   * defocus is measured against, so it stays worth setting to the depth most of
   * the receiving geometry sits at.
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
   * The map covers a fixed footprint, so a {@link causticsRange} large enough to
   * light the scene is already too coarse to resolve a caustic cell anywhere in
   * it. This spends the far edge of the map, which the defocus and the edge fade
   * are attenuating anyway, on the part near the camera: texel density is
   * `1 + causticsWarp` times uniform at the centre and `1 / (1 + causticsWarp)`
   * times it at the border.
   *
   * Ignored while the map already fits the water within range, which is the case
   * a bounded pool inside {@link causticsRange} always lands in. There the fit
   * has spent the whole map on water the camera can see, and concentrating it
   * further would only blur the far side of the pool.
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
   * A fixed grid is the wrong shape of knob, because the density that actually
   * governs quality is photons per map texel, and the grid only covers the part
   * of the map the water casts into. The same 512 grid measured 7.5 photons per
   * texel over a small pool and 0.84 over open water - within 2% of a converged
   * map in the first case and 9% off it in the second. Auto solves for the
   * density instead, which spends the budget where the error is.
   *
   * Set a value to pin the grid explicitly; the cost is the square of it.
   */
  get causticsPhotonResolution() {
    return this._causticsPhotonResolution;
  }
  set causticsPhotonResolution(val: number) {
    const n = val | 0;
    this._causticsPhotonResolution = n <= 0 ? 0 : Math.max(16, Math.min(4096, n));
  }
  /**
   * Number of 2x2 blur iterations applied to the accumulated map.
   *
   * Rounded up to an even count: the blur ping-pongs between the map and a
   * scratch target, and only an even number of passes ends back in the map.
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
   * The photon grid is a regular lattice, so as the waves move the photons slide
   * across texel boundaries and the map scintillates: a still frame looks fine
   * and a moving one crawls. Reprojecting the last map and blending it in
   * averages that away, in effect multiplying the photon count without paying
   * for the photons.
   *
   * The pattern itself is animated, so the blend cannot simply be long. The
   * resolve clamps the reprojected value to the range its own 3x3 neighbourhood
   * covers, which lets still regions accumulate over many frames while regions
   * the waves have moved on from fall back to the current frame. Raising this
   * past the default buys diminishing stability and starts to smear the
   * animation in the regions the clamp does not catch.
   */
  get causticsTemporalStrength() {
    return this._causticsTemporalStrength;
  }
  set causticsTemporalStrength(val: number) {
    this._causticsTemporalStrength = Math.max(0, Math.min(0.95, val));
  }
  /**
   * Strength of the sunlight scattered forward through a wave crest.
   *
   * This is the term that makes a backlit crest glow. It is authored rather than
   * derived because the geometric thickness of a crest is far too small to
   * scatter a visible amount on its own; the medium's albedo still supplies the
   * colour, so raising this brightens the glow without shifting its hue. Set to
   * 0 to disable.
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
   * these terms, with even a wind-driven flank only a few hundredths off
   * vertical.
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
   * This is what gives the water body a direction-dependent colour: it is
   * evaluated per light, so a shadow falling on the water darkens the water
   * itself rather than only its specular, and a low sun tints the column the
   * way it tints everything else. Without it the body is lit by the environment
   * irradiance alone, which has no direction and cannot produce either.
   *
   * Unlike {@link subsurfaceIntensity} this is not an authored magnitude. The
   * integral below it is closed-form single scattering through the same medium
   * the absorption uses, so 1 is the physical answer and anything else is a
   * deliberate exaggeration.
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
   * Mean cosine of a single scattering event, in `[0, 0.95]`.
   *
   * 0 scatters equally in all directions; higher values push light forward, so
   * the water brightens when looking towards the sun through it and darkens
   * when looking away. Sea water measures near 0.9, but the term this feeds
   * blends towards isotropic as the column gets optically thick - which is what
   * multiple scattering does - so the visible anisotropy is always less than
   * this number alone suggests.
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
   * How much of a folded texel reads as foam.
   *
   * The wave generator reports where the surface has folded over on itself,
   * which is a measure of the fold rather than of area; this scales it into a
   * coverage fraction. 0 disables foam.
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
   * Falloff applied to foam coverage before it is scaled.
   *
   * Above 1 this pushes light folding towards no foam at all, so only a crest
   * that has genuinely broken shows any - which is what keeps a windy sea from
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
  /** @internal */
  private _updateMediumCoefficients() {
    this._extinction.setXYZ(
      this._absorption.x * this._absorptionScale + this._scattering.x * this._scatteringScale,
      this._absorption.y * this._absorptionScale + this._scattering.y * this._scatteringScale,
      this._absorption.z * this._absorptionScale + this._scattering.z * this._scatteringScale
    );
    // A channel with no interaction at all transmits fully and scatters nothing;
    // the albedo of such a channel is arbitrary, so pick 0 rather than divide.
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
   * The offset itself is derived: the view ray is refracted at the surface by
   * Snell's law, walked to whatever is behind the water, and the hit point is
   * projected back to the screen. That already accounts for the incidence angle,
   * the depth of the receiver and the perspective foreshortening, so this exists
   * only to dial the result back for a stylised look - not to make it correct.
   *
   * Values above 1 exaggerate; the surface stays continuous, but the sample can
   * wander far enough from the true hit point that the medium tint stops
   * matching what is visible through it.
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
   * beneath it. Water reflects almost everything at a grazing angle, which is
   * physically right but can bury a sea bed the shot is about; this is the knob
   * that trades that reflection away. The F0 floor is scaled with it, so 0 gives
   * a surface with no specular response at all.
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
  supportInstancing() {
    return false;
  }
  supportLighting() {
    return true;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.$inputs.clipmapInfo = pb.vec4().attrib('texCoord0');
    scope.clipmapGridInfo = pb.vec4().uniform(2);

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
    this.waveGenerator?.calcVertexPositionAndNormal(
      scope,
      scope.clipmapWorldPos,
      scope.worldPos,
      scope.worldNormal
    );
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    scope.$outputs.worldNormal = scope.worldNormal;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.region = pb.vec4().uniform(2);
    if (this.needFragmentColor()) {
      scope.refractionScale = pb.float().uniform(2);
      scope.reflectionStrength = pb.float().uniform(2);
      scope.ssrParams = pb.vec4().uniform(2);
      // (intensity, 1 / full-scatter crest height, 0, 0)
      scope.subsurfaceParams = pb.vec4().uniform(2);
      // (coverage scale, coverage falloff, 0, 0)
      scope.foamShadingParams = pb.vec4().uniform(2);
      scope.foamColor = pb.vec3().uniform(2);
      // (intensity, anisotropy, 0, 0)
      scope.sunScatterParams = pb.vec4().uniform(2);
      // Declared in both medium modes: the ramp only replaces the depth-driven
      // absorption and scattering, while the subsurface and sun-scattering
      // terms need the medium's hue and thickness regardless of how those two
      // are authored.
      scope.mediumAlbedo = pb.vec3().uniform(2);
      scope.mediumExtinction = pb.vec3().uniform(2);
      if (this.mediumMode === 'ramp') {
        scope.depthMulti = pb.float().uniform(2);
        scope.scatterRampTex = pb.tex2D().uniform(2);
        scope.absorptionRampTex = pb.tex2D().uniform(2);
      }
    }
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.worldPos.xz, scope.region.xy)),
      pb.any(pb.greaterThan(scope.$inputs.worldPos.xz, scope.region.zw))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      scope.$l.normal = this.waveGenerator
        ? this.waveGenerator.calcFragmentNormalAndFoam(
            scope,
            scope.$inputs.clipmapPos.xz,
            scope.$inputs.worldNormal
          )
        : pb.vec4(scope.$inputs.worldNormal, 0);
      scope.$l.outColor = pb.vec4(
        this.waterShading(scope, scope.$inputs.worldPos, scope.normal.xyz, scope.normal.w),
        1
      );
      if (
        this.drawContext.materialFlags &
        (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
      ) {
        // The real roughness, not a constant 1. Anything reading this buffer to
        // reflect the water - SSR on another surface - would otherwise treat a
        // near-mirror sea as fully diffuse.
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
   * specular lobe instead of dropping it - a distant mirror aliases into
   * crawling speckle. Shared with the scene roughness buffer so a surface
   * reflecting the water sees the same value the water shades itself with.
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
   * and the perspective foreshortening all fall out of that, where the previous
   * form pushed the screen UV along the world normal and approximated each of
   * them with a separate factor - which also rotated the whole pattern with the
   * camera, because a world direction was being used as a screen offset.
   *
   * Independent of the engine's depth convention. The projection only ever reads
   * `clip.xy / clip.w`, and reverse-Z rewrites nothing but the z row of the
   * projection matrix; every depth comparison happens in view space, which the
   * convention does not touch. The one convention-dependent step, decoding the
   * depth texture, lives behind {@link ShaderHelper.sampleLinearDepth}.
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
    // Screen UV of a world position, through the same matrix the surface itself
    // was rasterised with.
    //
    // Only ever used as a difference of two such UVs, which is what makes the
    // offset independent of the conventions baked into that matrix: the TAA
    // jitter and the clip-space Y orientation cancel between the two ends. The
    // 0.5/0.5 mapping is the inverse of the one
    // ShaderHelper.samplePositionFromDepth unprojects with, so the forward and
    // backward directions agree.
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
        // would smear one border pixel along the whole edge of the water. Fading
        // the offset out over a band gets back to a legal sample continuously.
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
    // negative that it has passed through it. Nothing is decided here about a hit
    // - the march applies the thickness-band test, which is what lets a surface
    // sticking out of the water fall through instead of being sampled.
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
        // View-space z of whatever that pixel shows. Normalized linear depth means
        // the same thing under either depth convention - only the mapping from
        // device depth to it flips - and the comparison below is in view space,
        // which reverse-Z does not touch.
        this.$l.sceneViewZ = pb.mul(pb.neg(this.linearDepth), this.cameraFar);
        // Ray depth minus scene depth. The march decides a hit by whether this
        // gap has fallen inside a band around zero - the ray is neither still in
        // front of the surface nor already out the other side. Sky sits at the far
        // plane, so over empty water the gap stays large and positive and the
        // march simply runs on.
        this.$return(pb.vec3(this.uv, pb.sub(this.rayViewZ, this.sceneViewZ)));
      }
    );
    // March the refracted ray and take the first crossing with the depth buffer.
    //
    // Advances `t` along the refracted ray in fixed steps and, at each step,
    // reads the scene depth where the ray projects and compares it against the
    // ray's own depth. A hit is a step that lands inside a thickness band around
    // the surface - the ray is neither clearly in front of the scene nor already
    // out the far side. That two-sided test is what lets something poking out of
    // the water fall through: its depth is *nearest* the camera, so the gap is
    // negative from the first step and never enters the band, instead of being
    // read as a crossing the way a one-sided clamp did. Stopping at the *first*
    // hit keeps a submerged object solid - a later one belongs to whatever is
    // behind it, and reading that is exactly how the lower half of a box used to
    // vanish. Fixed count keeps the shader uniform (an unbounded bisection would
    // diverge between backends).
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
            // Still in front of the scene, or already past it. Either way keep the
            // step and note the gap so the band can be interpolated precisely.
            this.tPrev = this.t;
            this.gapPrev = this.gap;
          });
        });
        // No hit on any step - the ray left the water onto the sky, or the capped
        // path never reached the scene - leaves the straight-through sample at the
        // straight-line path, which is what a ray over empty water should show.
        this.$return(pb.vec3(this.hitUV, this.hitPath));
      }
    );
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
        // with cullMode 'none', so either can reach here, and the wave normal
        // always points up. Facing it back towards the eye is what lets one
        // refract call serve both, and the ratio has to be picked to match -
        // without the flip, a wave face steeper than the view ray bends the wrong
        // way, which is the grazing-angle case that reads as the surface tearing.
        this.$l.underwater = pb.greaterThan(pb.dot(this.eyeVecNorm, this.normal), 0);
        this.$l.faceNormal = this.$choice(this.underwater, pb.neg(this.normal), this.normal);
        this.$l.eta = this.$choice(this.underwater, pb.float(WATER_TO_AIR_ETA), pb.float(AIR_TO_WATER_ETA));
        // The unrefracted hit. This is the view line through the surface to
        // whatever is behind it, and it carries the dominant displacement in the
        // refracted direction below - it is what keeps the sample tracking the
        // object rather than wandering across a silhouette.
        this.$l.uvBase = this.waterRefractProjectUV(this.worldPos);
        // If what is behind the water is the sky (depth at the far plane), there
        // is no surface to refract - the ray would march for the whole capped
        // path and land on nothing. Unrefracted sky is the correct sample, so
        // short-circuit before reconstructing a far-plane point and marching.
        this.$if(pb.greaterThanEqual(this.straightDepth01, 0.999), function () {
          this.$return(pb.vec3(this.screenUV, this.straightDist));
        });
        this.$l.waterCrossDir = pb.normalize(pb.sub(this.straightWorldPos, this.worldPos));
        // Refract the view ray twice - once through the wave normal, once through
        // a flat surface of the same facing - and use only the difference.
        // Subtracting the flat refraction discards the bulk bending a purely-
        // refracted ray would add, which is what made the sample overshoot across
        // object edges; adding the view-line direction re-anchors it to what is
        // actually behind the water. The result is the view line plus a wave-
        // normal perturbation, so on calm water the sample stays put and only the
        // wave tilt moves it. The flat normal carries the same facing flip as the
        // wave one so the two cancel exactly on calm water from either side.
        this.$l.refractWave = pb.refract(this.eyeVecNorm, this.faceNormal, this.eta);
        this.$l.refractFlatNormal = pb.vec3(0, pb.sign(this.faceNormal.y), 0);
        this.$l.refractFlat = pb.refract(this.eyeVecNorm, this.refractFlatNormal, this.eta);
        // Total internal reflection - only reachable from under the surface -
        // leaves refract returning zero. The perturbation then vanishes and the
        // ray degenerates to the view line, which is the fallback it had before.
        this.$l.refractDir = pb.add(this.waterCrossDir, pb.sub(this.refractWave, this.refractFlat));
        this.$if(pb.lessThan(pb.length(pb.sub(this.refractWave, this.refractFlat)), 1e-4), function () {
          this.refractDir = this.waterCrossDir;
        });
        // A degenerate view line (a pitch-black edge or a self-difference) would
        // push the direction below and give a wrong sample; clamp it to stay on
        // the line if the difference vanished.
        this.$if(pb.lessThan(pb.dot(this.refractDir, this.refractDir), 1e-6), function () {
          this.refractDir = this.waterCrossDir;
        });
        this.refractDir = pb.normalize(this.refractDir);
        this.$l.refractDirView = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.refractDir, 0)).xyz;
        // Away from the camera the ray must travel, so a tangent one is clamped
        // rather than allowed to shoot off, and the straight-line distance bounds
        // the refracted path to a sane multiple of itself.
        this.$l.refractStepZ = pb.min(this.refractDirView.z, -1e-4);
        this.$l.maxPath = pb.mul(this.straightDist, REFRACT_MAX_PATH_RATIO);
        this.$l.refractUV = this.screenUV;
        this.$l.refractPath = this.straightDist;
        // March the refracted ray until it meets the scene, then sample there.
        // Walking the ray in fixed steps and keeping the first depth crossing is
        // what stops the sample from jumping across a scene discontinuity (a box
        // edge against the bed), which the two-probe solve did: it guessed at a
        // path length, read the depth where the guess landed, and re-solved from
        // that - so a guess a few pixels off the object's silhouette snapped to
        // whatever was behind it, tearing the refraction across the object.
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
        // even though the march kept going: the hit point can read the object's
        // own depth where it pokes through, which is exactly the "object above
        // the waterline looks bent" artifact. Reconstruct the scene point at the
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
   * `sigma_t` cancels out of everything but the exponent, which is what leaves
   * the result finite for an unbounded column: looking straight down at deep
   * water under an overhead sun gives `albedo * p * E / 2`, the textbook value.
   *
   * `E` is the sun's irradiance perpendicular to its own beam, which is what
   * the light loop already carries - there is no `NoL` here, because the
   * geometry the cosine would describe is already in `r`. Both directions are
   * refracted through a flat surface first: Snell steepens the sun's descent,
   * and using the above-water slope would overstate how much water the light
   * crossed.
   *
   * Only the entry Fresnel is applied here. The exit transmission is common to
   * every term leaving the medium and is applied once by the caller.
   *
   * Assumes the eye is above the surface; the caller gates on that. Seen from
   * below, the column between eye and surface is not the one `depth` measures,
   * and the geometry has to be rederived.
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
    depth: PBShaderExp
  ) {
    const pb = scope.$builder;
    // Phase function of the water body: a molecular lobe and a particulate one.
    //
    // Two lobes rather than one because they answer different questions and the
    // common camera setup only ever asks the first. Looking down at water under
    // a high sun, the light has to turn almost completely around to reach the
    // eye, and a forward-scattering particulate lobe returns essentially nothing
    // there - HG(0.7) gives 0.009/sr against an isotropic 0.080. Yet water
    // plainly looks blue from above, and it does so because of molecular
    // scattering, which is near-symmetric and hands back as much as it sends on.
    // With the particulate lobe alone this whole term is invisible from above
    // and only appears at grazing angles, which is not what it is modelling.
    //
    // Rayleigh carries the wavelength dependence - the 1/lambda^4 that makes
    // clean water blue - but the medium's own albedo already carries a colour
    // the author chose, so the split here is achromatic and only the shape
    // differs. Weighted the way measured sea water divides: molecular scattering
    // is a small share of the total but dominates the backward hemisphere.
    //
    // Both lobes are normalized to integrate to 1 over the sphere; the 1/4pi is
    // part of that, and dropping it would make the term 4pi too bright.
    pb.func('waterScatterPhase', [pb.float('cosTheta'), pb.float('g')], function () {
      // Henyey-Greenstein: the particulate lobe, forward-peaked at g > 0.
      this.$l.g2 = pb.mul(this.g, this.g);
      this.$l.denom = pb.add(1, this.g2, pb.mul(-2, this.g, this.cosTheta));
      this.$l.mie = pb.div(pb.sub(1, this.g2), pb.mul(4 * Math.PI, pb.pow(pb.max(this.denom, 1e-4), 1.5)));
      // Rayleigh: symmetric about 90 degrees, so it returns light towards the
      // eye as readily as it passes it on. 3/(16 pi) * (1 + cos^2).
      this.$l.rayleigh = pb.mul(3 / (16 * Math.PI), pb.add(1, pb.mul(this.cosTheta, this.cosTheta)));
      this.$return(
        pb.add(
          pb.mul(this.rayleigh, MOLECULAR_SCATTER_FRACTION),
          pb.mul(this.mie, 1 - MOLECULAR_SCATTER_FRACTION)
        )
      );
    });
    pb.func(
      'waterSunScattering',
      [
        pb.vec3('lightEnergy'),
        pb.vec3('lightDir'),
        pb.vec3('eyeVecNorm'),
        pb.float('NoL'),
        pb.float('depth')
      ],
      function () {
        this.$l.up = pb.vec3(0, 1, 0);
        // Both directions as they travel inside the water. The sun's incident
        // direction is where it travels to, the opposite of `lightDir`.
        this.$l.Lw = pb.refract(pb.neg(this.lightDir), this.up, AIR_TO_WATER_ETA);
        this.$l.Vw = pb.refract(this.eyeVecNorm, this.up, AIR_TO_WATER_ETA);
        // How fast each descends. The sun is floored rather than allowed to
        // reach zero: a sun on the horizon lights the column over an unbounded
        // path, which single scattering cannot represent, so cap it instead.
        this.$l.sy = pb.max(pb.neg(this.Lw.y), MIN_SUN_SLOPE);
        this.$l.vy = pb.max(pb.neg(this.Vw.y), 1e-3);
        this.$l.r = pb.div(this.vy, this.sy);
        this.$l.rr = pb.add(1, this.r);
        // Angle between the sun's travel and the direction the light has to
        // leave in to reach the eye, which is back along the view ray.
        this.$l.cosTheta = pb.neg(pb.dot(this.Lw, this.Vw));
        this.$l.hg = this.waterScatterPhase(this.cosTheta, this.sunScatterParams.y);
        // Multiple scattering washes the lobe out. An optically thin column
        // keeps the single-event anisotropy; a thick one has scattered the light
        // enough times that the direction it entered by no longer matters, and
        // an isotropic phase is the right end state. Weighted on luminance and
        // shared across channels, because the phase itself does not depend on
        // wavelength - only how far the light got does.
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
    return scope.waterSunScattering(lightEnergy, lightDir, eyeVecNorm, NoL, depth) as PBShaderExp;
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
    pb.func('fresnel', [pb.vec3('normal'), pb.vec3('eyeVec')], function () {
      // Schlick, including the F0 term the previous form dropped. Without it the
      // reflectance fell to zero at normal incidence, so water viewed from
      // directly above reflected no sky at all and read as flat paint.
      this.$l.NoV = pb.clamp(pb.dot(this.normal, this.eyeVec), 0, 1);
      this.$l.f = pb.add(WATER_F0, pb.mul(1 - WATER_F0, pb.pow(pb.sub(1, this.NoV), 5)));
      // reflectionStrength trades the reflection away for what is beneath the
      // surface. Scaling keeps the term in [0,1] for any authored value.
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
        // Which face of the surface the camera is on. The wave normal always
        // points up and the surface is drawn with cullMode 'none', so a ray
        // agreeing with the normal is one travelling up from inside the water.
        // Terms whose geometry is derived for an eye above the surface are
        // gated on this.
        this.$l.underwaterEye = pb.greaterThan(pb.dot(this.eyeVecNorm, this.normal), 0);
        this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.worldPos));
        this.$l.viewPos = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.worldPos, 1)).xyz;
        this.incidentVec = pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.reflectVecW = pb.reflect(this.incidentVec, this.normal);
        this.$l.reflectance = pb.vec3();
        this.$l.hitInfo = pb.vec4(0);
        this.$if(pb.greaterThan(this.reflectVecW.y, 0), function () {
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
        });
        this.$l.refl = pb.reflect(
          pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this))),
          this.normal
        );
        // A steep wave face can reflect downwards, where the sky bake holds
        // nothing useful. Mirroring the ray back up stays continuous through
        // the horizon; the old clamp collapsed every direction below y = 0.1
        // onto one ring and wiped out the grazing-angle detail that is the most
        // visible part of a water reflection.
        this.refl.y = pb.abs(this.refl.y);
        this.reflectance = pb.mix(
          // Blended against the pre-exposed scene color, so the exposure-independent sky bake has
          // to be lifted into the same space.
          ShaderHelper.sampleBakedSkyPreExposed(this, this.refl),
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
        // line to the bed. A refracted ray is bent towards the normal, so it
        // reaches the same depth over a shorter distance than the view ray
        // suggests, and at a grazing view the two differ by a lot.
        this.depth = this.refractInfo.z;
        this.$l.refraction = pb.textureSampleLevel(
          ShaderHelper.getSceneColorTexture(this),
          this.refractUV,
          0
        ).rgb;
        this.refraction = pb.mul(this.refraction, this.getAbsorption(this.depth));
        this.$l.fresnelTerm = this.fresnel(this.normal, pb.neg(this.eyeVecNorm));
        // Foam coverage. The generator reports where the surface has folded over
        // on itself; the ramp turns that into how much of the texel is actually
        // covered, so the two ends of a breaking crest can be tuned apart.
        this.$l.foam = pb.clamp(
          pb.mul(pb.pow(pb.clamp(this.foamFactor, 0, 1), this.foamShadingParams.y), this.foamShadingParams.x),
          0,
          1
        );
        // Foam suppresses the specular lobe rather than adding to it: it is a
        // dense scattering layer sitting on the water, and where it is thick the
        // mirror underneath stops being visible at all.
        this.fresnelTerm = pb.mul(this.fresnelTerm, pb.sub(1, this.foam));
        this.$l.finalColor = pb.mix(this.refraction, this.reflectance, this.fresnelTerm);
        // What anything leaving the water body keeps on its way out, and the
        // share of the surface that is water rather than foam. The refraction
        // above already carries the first factor - `mix` weights it by
        // `1 - fresnelTerm` - and every scattering term below has to carry it
        // too, or the body stays fully visible through a surface that has turned
        // into a mirror at a grazing angle.
        this.$l.bodyWeight = pb.mul(pb.sub(1, this.fresnelTerm), pb.sub(1, this.foam));
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
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.lightEnergy = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
          this.$l.lightContrib = this.lightSpecular(
            this.lightDir,
            this.eyeVecNorm,
            this.normal,
            this.lightEnergy,
            this.roughness
          );
          // Sunlight that entered the far side of a wave and scattered back out
          // towards the eye. This is what makes a backlit crest glow, and it has
          // to come from the light loop: the ambient scattering term below is
          // built from the environment irradiance, which has no direction and so
          // cannot produce it at all.
          //
          // Standard translucency approximation - the transmitted direction is
          // the light continuing through the surface, bent by the normal, and
          // the term peaks when the eye looks back along it.
          this.$l.sssDir = pb.normalize(pb.add(pb.neg(this.lightDir), pb.mul(this.normal, SSS_DISTORTION)));
          this.$l.sssFacing = pb.pow(pb.clamp(pb.dot(pb.neg(this.eyeVecNorm), this.sssDir), 0, 1), SSS_POWER);
          // Crests glow and troughs do not: height above the undisplaced surface
          // stands in for how much lit water the ray passed through. The medium's
          // own albedo carries the hue, so this agrees with the colour the depth
          // terms produce; the magnitude is authored, because a real crest is far
          // too thin to scatter a visible amount on its own.
          this.$l.sssThickness = pb.clamp(pb.mul(pb.sub(1, this.normal.y), this.subsurfaceParams.y), 0, 1);
          this.lightContrib = pb.add(
            this.lightContrib,
            pb.mul(
              this.lightEnergy,
              this.mediumAlbedo,
              pb.mul(this.sssFacing, this.sssThickness, this.subsurfaceParams.x)
            )
          );
          // Sunlight scattered back out of the water column. This is what gives
          // the body a direction-dependent colour at all: the ambient term
          // below is built from the environment irradiance, which has no
          // direction, so without this a shadow on the water leaves the water
          // itself unchanged and a low sun does not tint it.
          //
          // Directional only. The integral assumes the light arrives as a
          // parallel beam of fixed slope, which is what lets the sun's path to
          // a scattering event be written in closed form; a point light's
          // distance falls off along the column and needs a different solution.
          // Seen from below the surface the geometry differs too, and this
          // keeps the term off that case rather than getting it wrong - the
          // refraction and the ambient scattering still carry the water colour
          // there.
          this.$if(pb.and(pb.equal(type, LIGHT_TYPE_DIRECTIONAL), pb.not(this.underwaterEye)), function () {
            // Weighted by what the surface transmits on the way out and by how
            // much of it is still water rather than foam, like every other
            // term that comes from inside the body.
            this.lightContrib = pb.add(
              this.lightContrib,
              pb.mul(
                that.waterSunScattering(
                  this,
                  this.lightEnergy,
                  this.lightDir,
                  this.eyeVecNorm,
                  this.NoL,
                  this.depth
                ),
                this.bodyWeight
              )
            );
          });
          // Foam is a rough dielectric layer, so it takes the light the way any
          // matte surface does. Previously it replaced the water colour with a
          // flat white before the lights ran at all, which left a breaking crest
          // reading the same at noon, at sunset and in shadow.
          this.lightContrib = pb.add(
            this.lightContrib,
            pb.mul(this.lightEnergy, this.foamColor, this.foam, this.NoL, 1 / Math.PI)
          );
          if (shadow) {
            // Water is a horizontal clipmap, so +Y is the geometric normal. The
            // wave normal would jitter the shadow lookup per-pixel.
            this.$l.shadow = pb.vec3(that.calculateShadow(this, this.worldPos, pb.vec3(0, 1, 0), this.NoL));
            this.lightContrib = pb.mul(this.lightContrib, this.shadow);
          }
          this.finalColor = pb.add(this.finalColor, this.lightContrib);
        });
        if (that.needCalculateEnvLight()) {
          this.$l.irradiance = that.getEnvLightIrradiance(this, this.normal);
          // Scattering from the water body itself, and from the foam sitting on
          // it. The water term is weighted by `bodyWeight`, which is what the
          // surface transmits on the way out times the share of it that is still
          // water: this light came up through the column, so a surface that has
          // turned into a mirror hides it and foam covers it.
          this.$l.sss = pb.mul(this.getScattering(this.depth), this.irradiance, this.bodyWeight, 1 / Math.PI);
          this.finalColor = pb.add(this.finalColor, this.sss);
          this.finalColor = pb.add(
            this.finalColor,
            pb.mul(this.irradiance, this.foamColor, this.foam, 1 / Math.PI)
          );
        }
        this.$return(this.finalColor);
      }
    );
    return scope.waterShading(worldPos, worldNormal, foamFactor);
  }
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean, pass: number) {
    super.applyUniforms(bindGroup, ctx, needUpdate, pass);
    const waveGenerator = this._waveGenerator.get();
    if (waveGenerator && this._waveVersion !== waveGenerator.version) {
      waveGenerator.applyWaterBindGroup(bindGroup);
      this._waveVersion = waveGenerator.version;
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapGridInfo', this._clipmapGridInfo);
    bindGroup.setValue('region', this._region);
    if (this.needFragmentColor(ctx)) {
      // Dimensionless: the offset is derived in world space and projected, so
      // there is nothing here for the render size to scale.
      bindGroup.setValue('refractionScale', this._refractionScale);
      bindGroup.setValue('reflectionStrength', this._reflectionStrength);
      bindGroup.setValue('ssrParams', this._ssrParams);
      this._subsurfaceParams.setXYZW(this._subsurfaceIntensity, this._subsurfaceSteepness, 0, 0);
      bindGroup.setValue('subsurfaceParams', this._subsurfaceParams);
      this._foamParams.setXYZW(this._foamAmount, this._foamFalloff, 0, 0);
      bindGroup.setValue('foamShadingParams', this._foamParams);
      bindGroup.setValue('foamColor', this._foamColor);
      bindGroup.setValue('mediumAlbedo', this._scatterAlbedo);
      // Needed in both medium modes: the sun-scattering integral is always
      // physical, even where the ramp overrides the depth-driven absorption.
      bindGroup.setValue('mediumExtinction', this._extinction);
      this._sunScatterParams.setXYZW(this._sunScatteringIntensity, this._scatterAnisotropy, 0, 0);
      bindGroup.setValue('sunScatterParams', this._sunScatterParams);
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
