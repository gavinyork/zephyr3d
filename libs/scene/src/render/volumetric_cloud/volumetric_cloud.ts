import { Vector2, Vector3 } from '@zephyr3d/base';

/**
 * How the clouds of a scatter sky are drawn.
 *
 * - `procedural`: the infinitely thin 2D cloud layer evaluated in the sky shader.
 * - `volumetric`: ray-marched volumetric clouds lit by the atmosphere (WebGPU only; other
 *   devices fall back to `procedural`).
 *
 * @public
 */
export type CloudMode = 'procedural' | 'volumetric';

/**
 * Which coverage of the cloud map shapes the clouds (Nubis 2017, slides 57-58).
 *
 * - `connected`: Perlin footprints, clouds join into formations.
 * - `isolated`: broad Worley footprints, separate cloud islands with persistent clear gaps.
 *
 * @public
 */
export type CloudFormation = 'connected' | 'isolated';

/**
 * Debug output of the volumetric cloud resources, drawn over the sky.
 * @public
 */
export type VolumetricCloudDebugView =
  | 'none'
  | 'weather'
  | 'baseNoise'
  | 'detailNoise'
  | 'profileXY'
  | 'profileXZ'
  | 'baseDensityXY'
  | 'baseDensityXZ'
  | 'densityXY'
  | 'densityXZ';

/**
 * Parameters of the volumetric cloud layer.
 *
 * Layer, tracing and lighting parameters follow UE 5.8 `UVolumetricCloudComponent` and its
 * defaults (`VolumetricCloudComponent.cpp`); the density model replaces the UE cloud material
 * with the weather map / noise model of Schneider, "The Real-time Volumetric Cloudscapes of
 * Horizon Zero Dawn" (SIGGRAPH 2015). All distances are in meters.
 *
 * Every setter bumps {@link VolumetricCloud.version}, which the renderer compares to tell when
 * the cached sky has to be rebuilt rather than updated over the next frames.
 *
 * @public
 */
export class VolumetricCloud {
  private _version: number;
  // Layer
  private _layerBottomAltitude: number;
  private _layerHeight: number;
  // Tracing
  private _tracingMaxDistance: number;
  private _viewSampleCountScale: number;
  private _shadowSampleCountScale: number;
  private _shadowTracingDistance: number;
  private _stopTracingTransmittanceThreshold: number;
  // Lighting
  private _groundAlbedo: number;
  private _skyLightCloudBottomOcclusion: number;
  private _perSampleAtmosphericLightTransmittance: boolean;
  private _phaseG: number;
  private _phaseG2: number;
  private _phaseBlend: number;
  private _msOctaves: number;
  private _msContribution: number;
  private _msOcclusion: number;
  private _msEccentricity: number;
  // Density
  private _coverage: number;
  private _density: number;
  private readonly _albedo: Vector3;
  private _weatherMapScale: number;
  private _baseNoiseScale: number;
  private _shapeStrength: number;
  private _detailNoiseScale: number;
  private _detailErosion: number;
  private _detailBottomErosion: number;
  private readonly _wind: Vector2;
  private _noiseSeed: number;
  private _formation: CloudFormation;
  private _anvilBias: number;
  // Sky cache
  private _framesPerUpdate: number;
  private _cacheResolution: number;
  constructor() {
    this._version = 0;
    this._layerBottomAltitude = 5000;
    this._layerHeight = 10000;
    this._tracingMaxDistance = 50000;
    // Twice UE's default: the sky cache spreads a full trace over many frames
    this._viewSampleCountScale = 2;
    this._shadowSampleCountScale = 1;
    this._shadowTracingDistance = 15000;
    this._stopTracingTransmittanceThreshold = 0.005;
    this._groundAlbedo = 0.4;
    this._skyLightCloudBottomOcclusion = 0.5;
    this._perSampleAtmosphericLightTransmittance = false;
    this._phaseG = 0.8;
    this._phaseG2 = -0.3;
    this._phaseBlend = 0.5;
    this._msOctaves = 2;
    this._msContribution = 0.5;
    this._msOcclusion = 0.5;
    this._msEccentricity = 0.5;
    this._coverage = 0.45;
    this._density = 0.03;
    this._albedo = new Vector3(1, 1, 1);
    // Generated weather has eight connected or four isolated footprint cells per period.
    this._weatherMapScale = 64000;
    this._baseNoiseScale = 10000;
    this._shapeStrength = 1;
    this._detailNoiseScale = 1000;
    this._detailErosion = 0.35;
    this._detailBottomErosion = 1;
    this._wind = new Vector2(10, 0);
    this._noiseSeed = 0;
    this._formation = 'isolated';
    this._anvilBias = 0;
    this._framesPerUpdate = 64;
    this._cacheResolution = 768;
  }
  /** Incremented whenever a parameter changes. */
  get version() {
    return this._version;
  }
  /** Raises the altitude of the cloud base above the ground. */
  get layerBottomAltitude() {
    return this._layerBottomAltitude;
  }
  set layerBottomAltitude(val: number) {
    this._set('_layerBottomAltitude', Math.max(0, val));
  }
  /** Makes the cloud layer thicker, so clouds can tower higher above their base. */
  get layerHeight() {
    return this._layerHeight;
  }
  set layerHeight(val: number) {
    this._set('_layerHeight', Math.max(1, val));
  }
  /** Distance past the entry into the layer beyond which clouds are no longer drawn. */
  get tracingMaxDistance() {
    return this._tracingMaxDistance;
  }
  set tracingMaxDistance(val: number) {
    this._set('_tracingMaxDistance', Math.max(1, val));
  }
  /** Raises the number of steps along each view ray: finer cloud detail, higher cost. */
  get viewSampleCountScale() {
    return this._viewSampleCountScale;
  }
  set viewSampleCountScale(val: number) {
    this._set('_viewSampleCountScale', Math.max(0.05, val));
  }
  /** Raises the number of steps towards the sun: smoother self-shadowing inside the clouds, higher cost. */
  get shadowSampleCountScale() {
    return this._shadowSampleCountScale;
  }
  set shadowSampleCountScale(val: number) {
    this._set('_shadowSampleCountScale', Math.max(0.05, val));
  }
  /** How far towards the sun the clouds look for cloud that shades them. */
  get shadowTracingDistance() {
    return this._shadowTracingDistance;
  }
  set shadowTracingDistance(val: number) {
    this._set('_shadowTracingDistance', Math.max(1, val));
  }
  /** Stops a view ray once the clouds in front have become this opaque; lower is more exact but slower. */
  get stopTracingTransmittanceThreshold() {
    return this._stopTracingTransmittanceThreshold;
  }
  set stopTracingTransmittanceThreshold(val: number) {
    this._set('_stopTracingTransmittanceThreshold', Math.min(1, Math.max(0, val)));
  }
  /** Brightens the underside of the clouds with light bounced off the ground. */
  get groundAlbedo() {
    return this._groundAlbedo;
  }
  set groundAlbedo(val: number) {
    this._set('_groundAlbedo', Math.min(1, Math.max(0, val)));
  }
  /** Darkens the sky light reaching the bottom of the clouds. */
  get skyLightCloudBottomOcclusion() {
    return this._skyLightCloudBottomOcclusion;
  }
  set skyLightCloudBottomOcclusion(val: number) {
    this._set('_skyLightCloudBottomOcclusion', Math.min(1, Math.max(0, val)));
  }
  /**
   * Reddens the sunlight inside the clouds by the atmosphere between each point and the sun,
   * instead of using the sunlight at the ground. Matters most at sunrise and sunset.
   */
  get perSampleAtmosphericLightTransmittance() {
    return this._perSampleAtmosphericLightTransmittance;
  }
  set perSampleAtmosphericLightTransmittance(val: boolean) {
    this._set('_perSampleAtmosphericLightTransmittance', !!val);
  }
  /** Concentrates the bright silver lining around the sun; higher makes it tighter and brighter. */
  get phaseG() {
    return this._phaseG;
  }
  set phaseG(val: number) {
    this._set('_phaseG', Math.min(0.999, Math.max(-0.999, val)));
  }
  /** Second lobe: negative values brighten the clouds when looking away from the sun. */
  get phaseG2() {
    return this._phaseG2;
  }
  set phaseG2(val: number) {
    this._set('_phaseG2', Math.min(0.999, Math.max(-0.999, val)));
  }
  /** Moves the look between the first lobe (0) and the second lobe (1). */
  get phaseBlend() {
    return this._phaseBlend;
  }
  set phaseBlend(val: number) {
    this._set('_phaseBlend', Math.min(1, Math.max(0, val)));
  }
  /** Number of extra light bounces approximated inside the clouds (0-2): more makes thick clouds glow brighter and softer. */
  get msOctaves() {
    return this._msOctaves;
  }
  set msOctaves(val: number) {
    this._set('_msOctaves', Math.min(2, Math.max(0, Math.round(val))));
  }
  /** Brightness of each bounced-light octave. */
  get msContribution() {
    return this._msContribution;
  }
  set msContribution(val: number) {
    this._set('_msContribution', Math.min(1, Math.max(0, val)));
  }
  /** Lower values let bounced light reach deeper into thick clouds. */
  get msOcclusion() {
    return this._msOcclusion;
  }
  set msOcclusion(val: number) {
    this._set('_msOcclusion', Math.min(1, Math.max(0, val)));
  }
  /** Lower values spread bounced light more evenly in all directions instead of around the sun. */
  get msEccentricity() {
    return this._msEccentricity;
  }
  set msEccentricity(val: number) {
    this._set('_msEccentricity', Math.min(1, Math.max(0, val)));
  }
  /** Weather coverage: higher grows cloud fields; zero removes all clouds. */
  get coverage() {
    return this._coverage;
  }
  set coverage(val: number) {
    this._set('_coverage', Math.min(1, Math.max(0, val)));
  }
  /** Makes clouds more opaque and their shadowed sides darker (extinction per meter). */
  get density() {
    return this._density;
  }
  set density(val: number) {
    this._set('_density', Math.max(0, val));
  }
  /** Tint of the light the clouds scatter; lower values make clouds greyer. */
  get albedo(): Vector3 {
    return this._albedo;
  }
  set albedo(val: Vector3) {
    if (!val.equalsTo(this._albedo)) {
      this._albedo.set(val);
      this._version++;
    }
  }
  /** Size of the area one repetition of the weather map covers; larger spreads cloud fields wider apart. */
  get weatherMapScale() {
    return this._weatherMapScale;
  }
  set weatherMapScale(val: number) {
    this._set('_weatherMapScale', Math.max(1, val));
  }
  /** Repetition period of the base noise; the generated volume's first octave has four cells per period. */
  get baseNoiseScale() {
    return this._baseNoiseScale;
  }
  set baseNoiseScale(val: number) {
    this._set('_baseNoiseScale', Math.max(1, val));
  }
  /** Strength of the large noise billows: lower values keep cloud bodies fuller and more connected. */
  get shapeStrength() {
    return this._shapeStrength;
  }
  set shapeStrength(val: number) {
    this._set('_shapeStrength', Math.min(1, Math.max(0, val)));
  }
  /** Size of the small wisps that erode cloud edges. */
  get detailNoiseScale() {
    return this._detailNoiseScale;
  }
  set detailNoiseScale(val: number) {
    this._set('_detailNoiseScale', Math.max(1, val));
  }
  /** How much the small wisps eat into cloud edges: higher gives raggeder, wispier edges. */
  get detailErosion() {
    return this._detailErosion;
  }
  set detailErosion(val: number) {
    this._set('_detailErosion', Math.min(1, Math.max(0, val)));
  }
  /** Detail erosion at the cloud base relative to the full amount: lower values keep the base flatter. */
  get detailBottomErosion() {
    return this._detailBottomErosion;
  }
  set detailBottomErosion(val: number) {
    this._set('_detailBottomErosion', Math.min(1, Math.max(0, val)));
  }
  /** Direction and speed the clouds drift with, in meters per second. */
  get wind(): Vector2 {
    return this._wind;
  }
  set wind(val: Vector2) {
    if (!val.equalsTo(this._wind)) {
      this._wind.set(val);
      this._version++;
    }
  }
  /** Isolated island-like clouds, or clouds joined into formations. */
  get formation(): CloudFormation {
    return this._formation;
  }
  set formation(val: CloudFormation) {
    if (val !== this._formation) {
      this._formation = val;
      this._version++;
    }
  }
  /** Spreads the tops of tall clouds out into anvils. */
  get anvilBias() {
    return this._anvilBias;
  }
  set anvilBias(val: number) {
    this._set('_anvilBias', Math.min(1, Math.max(0, val)));
  }
  /** Picks a different pattern for the generated noise and weather map. */
  get noiseSeed() {
    return this._noiseSeed;
  }
  set noiseSeed(val: number) {
    this._set('_noiseSeed', Math.max(0, Math.floor(val)));
  }
  /**
   * Frames over which the cached cloud sky is rebuilt once (4, 16, 64 or 256): fewer frames let
   * clouds and lighting change faster but cost more per frame.
   */
  get framesPerUpdate() {
    return this._framesPerUpdate;
  }
  set framesPerUpdate(val: number) {
    const n = [4, 16, 64, 256].reduce((a, b) => (Math.abs(b - val) < Math.abs(a - val) ? b : a));
    this._set('_framesPerUpdate', n);
  }
  /** Resolution of the cached cloud sky: higher keeps clouds sharp at narrow fields of view. */
  get cacheResolution() {
    return this._cacheResolution;
  }
  set cacheResolution(val: number) {
    // Divisible by the 16 blocks per side of the 256-frame schedule and by the 8x8 workgroup
    this._set('_cacheResolution', Math.max(128, Math.round(val / 128) * 128));
  }
  private _set(key: string, val: number | boolean) {
    const fields = this as unknown as Record<string, number | boolean>;
    if (fields[key] !== val) {
      fields[key] = val;
      this._version++;
    }
  }
}
