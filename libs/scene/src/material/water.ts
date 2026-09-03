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
import { MaterialVaryingFlags } from '../values';
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
/** Water depth at which the refraction offset reaches its authored strength. */
const REFRACT_REF_DEPTH = 4;
/** Distance out to which the refraction offset keeps its authored strength. */
const REFRACT_REF_DIST = 40;
/**
 * How far the surface normal bends the transmitted direction in the subsurface
 * term. Zero would make the glow a pure "looking at the sun through the water"
 * term with no shape to it; this is what lets the wave itself modulate it.
 */
const SSS_DISTORTION = 0.25;
/** Falloff of the subsurface lobe. Higher keeps the glow closer to the sun. */
const SSS_POWER = 4;

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
  private _displace: number;
  private _depthMulti: number;
  private _refractionStrength: number;
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
  private _causticsEnabled: boolean;
  private _causticsIntensity: number;
  private _causticsDepth: number;
  private _causticsRange: number;
  private _causticsFadeDistance: number;
  private _causticsDefocus: number;
  private _causticsResolution: number;
  private _causticsPhotonResolution: number;
  private _causticsBlurPasses: number;
  private _causticsTemporalStrength: number;
  private _subsurfaceIntensity: number;
  private _subsurfaceSteepness: number;
  private readonly _subsurfaceParams: Vector4;
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
    this._updateMediumCoefficients();
    this._clipmapInfo = new Vector4();
    this._clipmapGridInfo = new Vector4();
    this._waveGenerator = new DRef();
    this._waveVersion = -1;
    this._ssrParams = new Vector4(1000, 160, 0.5, 2);
    this._scatterRampTexture = new DRef();
    this._absorptionRampTexture = new DRef();
    this._displace = 16;
    this._depthMulti = 0.1;
    this._refractionStrength = 0;
    this._causticsEnabled = true;
    this._causticsIntensity = 1;
    this._causticsDepth = 4;
    this._causticsRange = 60;
    this._causticsFadeDistance = 0;
    this._causticsDefocus = 0.12;
    this._causticsResolution = 512;
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
      this._absorption.x + this._scattering.x,
      this._absorption.y + this._scattering.y,
      this._absorption.z + this._scattering.z
    );
    // A channel with no interaction at all transmits fully and scatters nothing;
    // the albedo of such a channel is arbitrary, so pick 0 rather than divide.
    this._scatterAlbedo.setXYZ(
      this._extinction.x > 0 ? this._scattering.x / this._extinction.x : 0,
      this._extinction.y > 0 ? this._scattering.y / this._extinction.y : 0,
      this._extinction.z > 0 ? this._scattering.z / this._extinction.z : 0
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
  get displace() {
    return this._displace;
  }
  set displace(val) {
    if (val !== this._displace) {
      this._displace = val;
      this.uniformChanged();
    }
  }
  get refractionStrength() {
    return this._refractionStrength;
  }
  set refractionStrength(val) {
    if (val !== this._refractionStrength) {
      this._refractionStrength = val;
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
      scope.displace = pb.float().uniform(2);
      scope.refractionStrength = pb.float().uniform(2);
      scope.ssrParams = pb.vec4().uniform(2);
      // (intensity, 1 / full-scatter crest height, 0, 0)
      scope.subsurfaceParams = pb.vec4().uniform(2);
      // (coverage scale, coverage falloff, 0, 0)
      scope.foamShadingParams = pb.vec4().uniform(2);
      scope.foamColor = pb.vec3().uniform(2);
      // Declared in both medium modes: the ramp only replaces the depth-driven
      // absorption and scattering, while the subsurface term needs the medium's
      // hue regardless of how those two are authored.
      scope.mediumAlbedo = pb.vec3().uniform(2);
      if (this.mediumMode === 'ramp') {
        scope.depthMulti = pb.float().uniform(2);
        scope.scatterRampTex = pb.tex2D().uniform(2);
        scope.absorptionRampTex = pb.tex2D().uniform(2);
      } else {
        scope.mediumExtinction = pb.vec3().uniform(2);
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
      // refractionStrength biases the surface towards pure refraction. Scaling
      // rather than subtracting keeps the F0 floor intact at its default of 0
      // and cannot drive the term negative.
      this.$return(pb.clamp(pb.mul(this.f, pb.sub(1, this.refractionStrength)), 0, 1));
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
        // Refraction offset. The authored strength is in pixels, and two factors
        // keep it physical:
        //  - depth, because the refracted ray only walks sideways while it is
        //    under water, so a shallow bed must barely shift;
        //  - distance, because the same world-space shift covers fewer pixels
        //    further away, and a fixed pixel offset out there makes distant
        //    water boil.
        // Both saturate at 1, so the near and deep case keeps the authored look.
        this.$l.refractScale = pb.mul(
          pb.clamp(pb.div(this.depth, REFRACT_REF_DEPTH), 0, 1),
          pb.clamp(pb.div(REFRACT_REF_DIST, pb.max(this.dist, 0.001)), 0, 1)
        );
        // Dividing by the render size componentwise keeps the offset square;
        // the old form scaled both axes by the width and sheared on any target
        // that was not 1:1.
        this.$l.refractUV = pb.add(
          this.screenUV,
          pb.div(pb.mul(this.normal.xz, this.displace, this.refractScale), ShaderHelper.getRenderSize(this))
        );
        this.$l.displacedPos = ShaderHelper.samplePositionFromDepth(
          this,
          ShaderHelper.getLinearDepthTexture(this),
          this.refractUV,
          ShaderHelper.getInvProjectionMatrix(this),
          ShaderHelper.getCameraParams(this).xy
        );
        this.$if(
          pb.or(
            pb.greaterThanEqual(this.displacedPos.w, 0.99999),
            pb.greaterThan(this.displacedPos.z, this.viewPos.z)
          ),
          function () {
            this.refractUV = this.screenUV;
          }
        ).$else(function () {
          this.depth = pb.length(pb.sub(this.displacedPos.xyz, this.viewPos));
        });
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
          // it. The water term is weighted away under foam because that light
          // came up through the water column, which the foam is covering.
          this.$l.sss = pb.mul(
            this.getScattering(this.depth),
            this.irradiance,
            pb.sub(1, this.foam),
            1 / Math.PI
          );
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
      // In pixels; the shader divides by the render size on both axes.
      bindGroup.setValue('displace', this._displace);
      bindGroup.setValue('refractionStrength', this._refractionStrength);
      bindGroup.setValue('ssrParams', this._ssrParams);
      this._subsurfaceParams.setXYZW(this._subsurfaceIntensity, this._subsurfaceSteepness, 0, 0);
      bindGroup.setValue('subsurfaceParams', this._subsurfaceParams);
      this._foamParams.setXYZW(this._foamAmount, this._foamFalloff, 0, 0);
      bindGroup.setValue('foamShadingParams', this._foamParams);
      bindGroup.setValue('foamColor', this._foamColor);
      bindGroup.setValue('mediumAlbedo', this._scatterAlbedo);
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
      } else {
        bindGroup.setValue('mediumExtinction', this._extinction);
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
