import { Vector3, type Immutable } from '@zephyr3d/base';
import type { AbstractDevice, Texture2D } from '@zephyr3d/device';

/**
 * Number of scalar parameter columns stored per profile row.
 *
 * @remarks
 * Mirrors the row layout UE5 uses in its `SSProfiles` texture, read back from
 * `UEDigitalHuman.rdc` (SSS::PassOne_Burley lines 143-157).
 *
 * @internal
 */
const SKIN_PROFILE_PARAM_COLUMNS = 6;

/**
 * Number of texels the baked transmission profile occupies.
 *
 * @remarks
 * `BSSS_TRANSMISSION_PROFILE_SIZE` in UE5 (`SubsurfaceProfileCommon.ush:27`).
 *
 * @internal
 */
const SKIN_TRANSMISSION_LUT_SIZE = 32;

/**
 * Total columns per profile row: the scalar parameters followed by the baked
 * transmission profile, exactly as UE5 lays out an `SSProfiles` row.
 *
 * @internal
 */
const SKIN_PROFILE_COLUMNS = SKIN_PROFILE_PARAM_COLUMNS + SKIN_TRANSMISSION_LUT_SIZE;

/** Maximum number of live skin profiles, matching the 8-bit profile id channel. @internal */
const SKIN_PROFILE_CAPACITY = 256;

/**
 * Largest optical depth the transmission profile is defined over.
 *
 * @remarks
 * `SSSS_MAX_TRANSMISSION_PROFILE_DISTANCE` in UE5. It appears in two places that
 * have to agree, which is why it lives here rather than next to either of them:
 * the thickness pass encodes its optical depth as `1 - opticalDepth / MAX`, and
 * the transmission BxDF decodes that and divides by `MAX` again to index the
 * baked profile below.
 *
 * @internal
 */
export const SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH = 5;

/**
 * Floor the averaged optical depth is clamped to before encoding.
 *
 * @remarks
 * UE5's `clamp(..., 0.15, 5)` in `CalculateOpticalDepth`.
 *
 * @internal
 */
export const SKIN_TRANSMISSION_OPTICAL_DEPTH_FLOOR = 0.15;

/**
 * Constant added to the optical depth after clamping.
 *
 * @remarks
 * UE5's trailing `+ 0.25` in `CalculateOpticalDepth`.
 *
 * @internal
 */
export const SKIN_TRANSMISSION_OPTICAL_DEPTH_BIAS = 0.25;

/**
 * Largest value the thickness pass can write, and with it the sentinel that
 * separates a real measurement from "no light wrote this".
 *
 * @remarks
 * The encoding is `1 - opticalDepth / MAX` and the optical depth can never fall
 * below `FLOOR + BIAS`, so the pass tops out here — 0.92 at the defaults. The
 * cleared value of 1 is therefore unreachable and doubles as "no data": a light
 * that does not transmit, a channel no light occupies, or the dummy texture
 * bound when the pass did not run.
 *
 * That distinction matters more than it looks. An encoding of 1 decodes to zero
 * optical depth, which indexes the *first* entry of the transmission profile —
 * its strongest. Reading the sentinel as a measurement would light every
 * non-transmitting light's pixels at full transmission, which is the opposite of
 * the intent.
 *
 * @internal
 */
export const SKIN_TRANSMISSION_NO_DATA_ENCODING =
  1 -
  (SKIN_TRANSMISSION_OPTICAL_DEPTH_FLOOR + SKIN_TRANSMISSION_OPTICAL_DEPTH_BIAS) /
    SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH;

/**
 * Distance, in profile millimetres, the baked transmission profile spans.
 *
 * @remarks
 * `MaxTransmissionProfileDistance * CmToMm = 5 * 10` in
 * `ComputeTransmissionProfileBurley`.
 *
 * The 5 here and the 5 in {@link SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH} are the
 * same number wearing two hats, and that is not a coincidence but the whole
 * calibration: UE5's world unit is the centimetre, so an optical depth of 1 (at
 * unit extinction) *is* one centimetre of material, and the table's axis is that
 * same span written in the millimetres the mean free paths use. The shader then
 * indexes the table with the optical depth directly, which reads as a unit error
 * — UE5 says so itself, at `ShadingModels.ush:658` and again at
 * `SubstrateEvaluation.ush:954` — but is self-consistent once the centimetre is
 * accounted for.
 *
 * What that means here is that the optical depth the thickness pass produces has
 * to be calibrated against this axis rather than against any unit of its own.
 * {@link SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT} is that calibration; changing this
 * constant without it silently slides the whole profile along the thickness
 * axis.
 *
 * @internal
 */
const TRANSMISSION_LUT_MAX_DISTANCE_MM = 50;

/**
 * Radius the baked transmission profile is offset by, in profile millimetres.
 *
 * @remarks
 * `ProfileRadiusOffset` in `BurleyNormalizedSSS.cpp:22`, 0.06 cm, times the same
 * `CmToMm`. It keeps the zero-thickness entry off the singular `r = 0` end of
 * the diffusion profile.
 *
 * @internal
 */
const TRANSMISSION_LUT_RADIUS_OFFSET_MM = 0.6;

/**
 * Profile-space millimetres per world unit, before the profile's own world unit
 * scale is applied.
 *
 * @remarks
 * This engine is metric throughout, so a world unit is a metre and the profile
 * distances are millimetres. UE5 instead carries a `BURLEY_CM_2_MM = 10` because
 * its world unit is the centimetre; that factor has no analogue here and must
 * not be transcribed (see the diffusion pass, which likewise omits it).
 *
 * @internal
 */
const WORLD_UNITS_TO_PROFILE_MM = 1000;

/**
 * Optical depth accumulated per world unit of light path, before the profile's
 * `extinctionScale`.
 *
 * @remarks
 * This is what ties the thickness pass to the baked profile, and it is derived
 * rather than chosen so that the two cannot drift.
 *
 * Reading the chain backwards: the BxDF indexes entry
 * `opticalDepth / MAX * (size - 1)`, and entry `i` was baked for
 * `i / size * LUT_MAX_MM` profile millimetres. Composing them, one unit of
 * optical depth is `LUT_MAX_MM * (size - 1) / size / MAX` profile millimetres —
 * 9.69 mm at the current constants, which is UE5's centimetre less the 31/32
 * the index and the axis disagree by. Converting from world units then gives the
 * factor below, and `worldUnitScale` correctly does *not* appear: it divides
 * both the table's axis and the path's conversion into profile space, so it
 * cancels. UE5 likewise keeps `UnitScale` on the LUT axis only, never in
 * `CalculateOpticalDepth`.
 *
 * Getting this wrong does not look like a scale error, it looks like the feature
 * is missing. An earlier round had the pass produce optical depth in
 * *millimetres*, ten times this, which drove every path longer than 5 mm onto
 * the profile's deliberately blacked-out last entry; a head then measured as
 * uniformly opaque and transmitted nothing anywhere, while the thickness debug
 * view — which shows optical depth, not the profile — looked plausibly saturated.
 *
 * One deliberate 3% departure from UE5. Its index uses `size - 1` while its axis
 * uses `size`, so its optical depth of 1 means a centimetre but lands on the
 * entry baked for 9.69 mm; the `(size - 1) / size` above cancels that, and a
 * path of `t` metres here indexes exactly the entry baked for `t` millimetres.
 * Reproducing the slip would cost a visible nothing and hide a real invariant.
 *
 * @internal
 */
export const SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT =
  (WORLD_UNITS_TO_PROFILE_MM * SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH) /
  (TRANSMISSION_LUT_MAX_DISTANCE_MM *
    ((SKIN_TRANSMISSION_LUT_SIZE - 1) / SKIN_TRANSMISSION_LUT_SIZE));

/**
 * Column indices within a packed profile row.
 *
 * @internal
 */
const enum ProfileColumn {
  /** World unit scale + overall scatter scaling. */
  Scaling = 0,
  /** Per-channel scattering albedo (the `A` in Burley's shaping term). */
  SurfaceAlbedo = 1,
  /** Per-channel diffuse mean free path, in world units. */
  MeanFreePath = 2,
  /** Boundary color bleed. */
  Boundary = 3,
  /**
   * Transmission parameters: `(extinctionScale, normalScale,
   * scatteringDistribution, 1 / ior)`.
   *
   * @remarks
   * Field-for-field UE5's `SSSS_TRANSMISSION_OFFSET` column, which
   * `GetTransmissionProfileParams` unpacks in exactly this order
   * (`TransmissionCommon.ush:34-41`). The transmission *tint* is deliberately
   * absent: UE5 bakes it into the profile below rather than storing it, and
   * keeping a second copy here would let the two drift apart.
   */
  Transmission = 4,
  /** Dual-lobe specular parameters. */
  Specular = 5
}

/**
 * `GetSearchLightDiffuseScalingFactor`, the default variant.
 *
 * @remarks
 * `s = 3.5 + 100 (A - 0.33)^4`. The same curve the diffusion evaluates on the
 * GPU (`posteffect/skinsss.ts`, `scalingFactor`); the transmission profile is
 * baked on the CPU and needs its own copy.
 *
 * @internal
 */
function searchLightDiffuseScalingFactor(albedo: number): number {
  const v = albedo - 0.33;
  return 3.5 + 100 * v * v * v * v;
}

/**
 * Built-in {@link SkinProfile} presets.
 *
 * @public
 */
export type SkinProfilePreset = 'skin' | 'skin_pale' | 'skin_tan' | 'skin_dark' | 'wax' | 'jade' | 'marble';

interface SkinProfileTemplate {
  surfaceAlbedo: [number, number, number];
  meanFreePath: [number, number, number];
  meanFreePathDistance: number;
  worldUnitScale: number;
  scatterScale: number;
  boundaryColorBleed: [number, number, number];
  transmissionTint: [number, number, number];
  extinctionScale: number;
  normalScale: number;
  scatteringDistribution: number;
  ior: number;
  roughness0: number;
  roughness1: number;
  lobeMix: number;
}

/**
 * Preset parameters.
 *
 * @remarks
 * `skin` reproduces UE5's `FSubsurfaceProfileStruct` defaults exactly, converted
 * into this engine's metre-based scene units:
 *
 * | UE5 parameter        | UE5 default                     | here                        |
 * | -------------------- | ------------------------------- | --------------------------- |
 * | SurfaceAlbedo        | (0.91058, 0.338275, 0.2718)     | `surfaceAlbedo`, unchanged  |
 * | MeanFreePathColor    | (1, 0.1983/2.229, 0.1607/2.229) | `meanFreePath`, unchanged   |
 * | MeanFreePathDistance | 1.2 × 2.229 = 2.6748 cm         | `meanFreePathDistance` in m |
 * | WorldUnitScale       | 0.1 cm                          | folded into the distance    |
 * | BoundaryColorBleed   | white                           | white                       |
 *
 * The green and blue mean free paths are an order of magnitude shorter than red
 * — roughly 1 : 0.089 : 0.072 — and the albedo is just as strongly red-shifted.
 * Those two ratios together are what make the diffusion read as skin rather than
 * as a neutral blur, so they are the first thing to check when the scattering
 * looks washed out.
 *
 * UE5 only ships the one profile; the remaining presets are this engine's own
 * and are pitched around the same regime so that they stay comparable.
 *
 * `boundaryColorBleed` is white throughout, as in UE5: it tints taps that belong
 * to a *different* profile, so it is a seam treatment rather than a material
 * colour, and anything darker quietly attenuates every profile boundary.
 *
 * @internal
 */
const SKIN_PROFILE_TEMPLATES: Record<SkinProfilePreset, SkinProfileTemplate> = {
  skin: {
    surfaceAlbedo: [0.91058, 0.338275, 0.2718],
    meanFreePath: [1.0, 0.0889636, 0.0720951],
    meanFreePathDistance: 0.026748,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [1.0, 0.42, 0.3],
    extinctionScale: 1,
    normalScale: 0.08,
    scatteringDistribution: 0.93,
    ior: 1.55,
    roughness0: 0.75,
    roughness1: 1.3,
    lobeMix: 0.85
  },
  skin_pale: {
    surfaceAlbedo: [0.93, 0.4, 0.33],
    meanFreePath: [1.0, 0.1, 0.083],
    meanFreePathDistance: 0.0294,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [1.0, 0.48, 0.38],
    extinctionScale: 1,
    normalScale: 0.08,
    scatteringDistribution: 0.93,
    ior: 1.55,
    roughness0: 0.72,
    roughness1: 1.25,
    lobeMix: 0.85
  },
  skin_tan: {
    surfaceAlbedo: [0.88, 0.3, 0.235],
    meanFreePath: [1.0, 0.082, 0.066],
    meanFreePathDistance: 0.0254,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [1.0, 0.38, 0.26],
    extinctionScale: 1,
    normalScale: 0.08,
    scatteringDistribution: 0.93,
    ior: 1.55,
    roughness0: 0.76,
    roughness1: 1.32,
    lobeMix: 0.85
  },
  skin_dark: {
    surfaceAlbedo: [0.8, 0.24, 0.185],
    meanFreePath: [1.0, 0.072, 0.057],
    meanFreePathDistance: 0.0227,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [1.0, 0.3, 0.2],
    extinctionScale: 1,
    normalScale: 0.08,
    scatteringDistribution: 0.93,
    ior: 1.55,
    roughness0: 0.78,
    roughness1: 1.35,
    lobeMix: 0.85
  },
  wax: {
    surfaceAlbedo: [0.95, 0.9, 0.8],
    meanFreePath: [1.0, 0.85, 0.68],
    meanFreePathDistance: 0.05,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [1.0, 0.88, 0.74],
    extinctionScale: 1,
    normalScale: 0.05,
    scatteringDistribution: 0.85,
    ior: 1.45,
    roughness0: 0.85,
    roughness1: 1.4,
    lobeMix: 0.8
  },
  jade: {
    surfaceAlbedo: [0.75, 0.93, 0.86],
    meanFreePath: [0.6, 1.0, 0.85],
    meanFreePathDistance: 0.045,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [0.68, 0.95, 0.88],
    extinctionScale: 1,
    normalScale: 0.05,
    scatteringDistribution: 0.7,
    ior: 1.6,
    roughness0: 0.6,
    roughness1: 1.1,
    lobeMix: 0.75
  },
  marble: {
    surfaceAlbedo: [0.95, 0.94, 0.92],
    meanFreePath: [1.0, 0.96, 0.92],
    meanFreePathDistance: 0.035,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [1, 1, 1],
    transmissionTint: [0.96, 0.95, 0.94],
    extinctionScale: 1,
    normalScale: 0.04,
    scatteringDistribution: 0.6,
    ior: 1.55,
    roughness0: 0.55,
    roughness1: 1.05,
    lobeMix: 0.7
  }
};

/**
 * Subsurface profile for {@link SkinMaterial}, holding the parameters UE5's
 * Burley diffusion is driven by.
 *
 * @remarks
 * Profiles are packed into a shared GPU table keyed by {@link SkinProfile.id},
 * and materials write that id per pixel. This lets several profiles — face, ears,
 * lips — diffuse independently in a single screen-space pass, which is how UE5
 * drives its subsurface scattering.
 *
 * This is a separate type from the older `SubsurfaceProfile`, which continues to
 * serve `PBRMetallicRoughnessMaterial` and the generic SSS post effect. The two
 * are independent and may be used side by side.
 *
 * @public
 */
export class SkinProfile {
  private static readonly _profiles: Array<SkinProfile | null> = new Array(SKIN_PROFILE_CAPACITY).fill(null);
  private static _table: Texture2D | null = null;
  private static _tableData: Float32Array<ArrayBuffer> | null = null;
  private static _tableDirty = true;
  private static _defaultProfile: SkinProfile | null = null;
  private readonly _id: number;
  private readonly _surfaceAlbedo: Vector3;
  private readonly _meanFreePath: Vector3;
  private readonly _boundaryColorBleed: Vector3;
  private readonly _transmissionTint: Vector3;
  private _preset: SkinProfilePreset;
  private _meanFreePathDistance: number;
  private _worldUnitScale: number;
  private _scatterScale: number;
  private _extinctionScale: number;
  private _normalScale: number;
  private _scatteringDistribution: number;
  private _ior: number;
  private _roughness0: number;
  private _roughness1: number;
  private _lobeMix: number;
  private _disposed: boolean;
  private readonly _changeListeners: Set<() => void>;

  /**
   * Creates a profile initialized from a preset.
   *
   * @param preset - Preset to start from. Defaults to `'skin'`.
   *
   * @public
   */
  constructor(preset: SkinProfilePreset = 'skin') {
    this._surfaceAlbedo = new Vector3();
    this._meanFreePath = new Vector3();
    this._boundaryColorBleed = new Vector3();
    this._transmissionTint = new Vector3();
    this._preset = preset;
    this._meanFreePathDistance = 0;
    this._worldUnitScale = 1;
    this._scatterScale = 1;
    this._extinctionScale = 1;
    this._normalScale = 0.08;
    this._scatteringDistribution = 0.93;
    this._ior = 1.55;
    this._roughness0 = 0.75;
    this._roughness1 = 1.3;
    this._lobeMix = 0.85;
    this._disposed = false;
    this._changeListeners = new Set();
    this._id = SkinProfile.allocateId(this);
    this.applyPreset(preset);
  }

  /**
   * Registers a callback invoked whenever this profile's parameters change.
   *
   * @param listener - The callback to add.
   *
   * @public
   */
  addChangeListener(listener: () => void) {
    this._changeListeners.add(listener);
  }

  /**
   * Removes a previously registered change listener.
   *
   * @param listener - The callback to remove.
   *
   * @public
   */
  removeChangeListener(listener: () => void) {
    this._changeListeners.delete(listener);
  }

  /**
   * The shared default skin profile.
   *
   * @public
   */
  static getDefault() {
    if (!this._defaultProfile) {
      this._defaultProfile = new SkinProfile('skin');
    }
    return this._defaultProfile;
  }

  /**
   * Looks up a profile by its packed id.
   *
   * @param id - The profile id, as written to the per-pixel profile channel.
   * @returns The profile, or `null` when the id is unused.
   *
   * @public
   */
  static getById(id: number) {
    return id > 0 && id < SKIN_PROFILE_CAPACITY ? this._profiles[id] : null;
  }

  /**
   * The packed parameter table, rebuilt when any profile has changed.
   *
   * @remarks
   * Rows are indexed by profile id, columns by parameter group. The skin
   * diffusion passes sample this to recover per-pixel scattering parameters.
   *
   * @param device - Device used to create and upload the table.
   * @returns The table texture, or `null` when it could not be created.
   *
   * @public
   */
  static getTable(device: AbstractDevice): Texture2D | null {
    if (!this._table) {
      this._table = device.createTexture2D('rgba32f', SKIN_PROFILE_COLUMNS, SKIN_PROFILE_CAPACITY, {
        mipmapping: false,
        samplerOptions: { minFilter: 'nearest', magFilter: 'nearest', mipFilter: 'none' }
      });
      this._tableData = new Float32Array(SKIN_PROFILE_COLUMNS * SKIN_PROFILE_CAPACITY * 4);
      this._tableDirty = true;
    }
    if (this._tableDirty && this._table && this._tableData) {
      this.packTable(this._tableData);
      this._table.update(this._tableData, 0, 0, SKIN_PROFILE_COLUMNS, SKIN_PROFILE_CAPACITY);
      this._tableDirty = false;
    }
    return this._table;
  }

  /** Number of parameter columns in the packed table. @public */
  static get tableColumns() {
    return SKIN_PROFILE_COLUMNS;
  }

  /**
   * Column the baked transmission profile starts at.
   *
   * @remarks
   * UE5's `BSSS_TRANSMISSION_PROFILE_OFFSET`. Entry `i` lives at column
   * `transmissionLutOffset + i`.
   *
   * @public
   */
  static get transmissionLutOffset() {
    return SKIN_PROFILE_PARAM_COLUMNS;
  }

  /**
   * Column holding `(extinctionScale, normalScale, scatteringDistribution,
   * 1 / ior)`.
   *
   * @remarks
   * UE5's `SSSS_TRANSMISSION_OFFSET`, unpacked by
   * `GetTransmissionProfileParams`.
   *
   * @public
   */
  static get transmissionParamColumn() {
    return ProfileColumn.Transmission as number;
  }

  /** Number of entries in the baked transmission profile. @public */
  static get transmissionLutSize() {
    return SKIN_TRANSMISSION_LUT_SIZE;
  }

  /** Number of rows in the packed table. @public */
  static get tableRows() {
    return SKIN_PROFILE_CAPACITY;
  }

  /**
   * The id this profile occupies in the packed table.
   *
   * @remarks
   * Ids start at 1; 0 means "not skin" in the per-pixel profile channel. The
   * material encodes this as `id / 255`.
   *
   * @public
   */
  get id() {
    return this._id;
  }

  /** Normalized id as written to an 8-bit per-pixel channel. @public */
  get encodedId() {
    return this._id / 255;
  }

  /** The preset this profile was last initialized from. @public */
  get preset() {
    return this._preset;
  }
  set preset(val: SkinProfilePreset) {
    if (val !== this._preset) {
      this.applyPreset(val);
    }
  }

  /**
   * Per-channel scattering albedo.
   *
   * @remarks
   * Drives Burley's shaping term `s = (albedo - 0.33)^4 * 100 + 3.5`, so values
   * near 0.33 give the widest diffusion and values at either extreme tighten it.
   *
   * @public
   */
  get surfaceAlbedo(): Immutable<Vector3> {
    return this._surfaceAlbedo;
  }
  set surfaceAlbedo(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._surfaceAlbedo)) {
      this._surfaceAlbedo.set(val);
      this.notifyChanged();
    }
  }

  /**
   * Per-channel diffuse mean free path, as a ratio.
   *
   * @remarks
   * Scaled by {@link SkinProfile.meanFreePathDistance} to reach world units. The
   * red channel is normally much longer than blue, which is what makes thin
   * geometry such as an ear rim glow red.
   *
   * @public
   */
  get meanFreePath(): Immutable<Vector3> {
    return this._meanFreePath;
  }
  set meanFreePath(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._meanFreePath)) {
      this._meanFreePath.set(val);
      this.notifyChanged();
    }
  }

  /** Mean free path of the widest channel, in profile space. @public */
  get meanFreePathDistance() {
    return this._meanFreePathDistance;
  }
  set meanFreePathDistance(val: number) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._meanFreePathDistance) {
      this._meanFreePathDistance = next;
      this.notifyChanged();
    }
  }

  /**
   * Profile-space to world-unit conversion, for scenes not authored in metres.
   *
   * @remarks
   * Applied once, when the diffusion converts a scatter radius into a screen
   * offset — the same place UE5 applies it, in `CalculateBurleyScale`. It is
   * deliberately absent from {@link SkinProfile.getScatterDistance}.
   *
   * @public
   */
  get worldUnitScale() {
    return this._worldUnitScale;
  }
  set worldUnitScale(val: number) {
    const next = Math.max(0.01, val ?? 1);
    if (next !== this._worldUnitScale) {
      this._worldUnitScale = next;
      this.notifyChanged();
    }
  }

  /** Overall multiplier on the diffusion width. @public */
  get scatterScale() {
    return this._scatterScale;
  }
  set scatterScale(val: number) {
    const next = Math.max(0, val ?? 1);
    if (next !== this._scatterScale) {
      this._scatterScale = next;
      this.notifyChanged();
    }
  }

  /**
   * Per-channel tint applied where two different profiles meet.
   *
   * @remarks
   * Taps that belong to another profile are attenuated by this instead of being
   * rejected outright, so a face/lip boundary softens rather than forming a seam.
   *
   * @public
   */
  get boundaryColorBleed(): Immutable<Vector3> {
    return this._boundaryColorBleed;
  }
  set boundaryColorBleed(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._boundaryColorBleed)) {
      this._boundaryColorBleed.set(val);
      this.notifyChanged();
    }
  }

  /** Tint applied to light transmitted through thin geometry. @public */
  get transmissionTint(): Immutable<Vector3> {
    return this._transmissionTint;
  }
  set transmissionTint(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._transmissionTint)) {
      this._transmissionTint.set(val);
      this.notifyChanged();
    }
  }

  /** Extinction multiplier for transmission attenuation. @public */
  get extinctionScale() {
    return this._extinctionScale;
  }
  set extinctionScale(val: number) {
    const next = Math.max(0, val ?? 1);
    if (next !== this._extinctionScale) {
      this._extinctionScale = next;
      this.notifyChanged();
    }
  }

  /** How much surface normal detail survives the diffusion. @public */
  get normalScale() {
    return this._normalScale;
  }
  set normalScale(val: number) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._normalScale) {
      this._normalScale = next;
      this.notifyChanged();
    }
  }

  /**
   * Henyey-Greenstein asymmetry of the transmitted light, in `[-1, 1]`.
   *
   * @remarks
   * UE5's `ScatteringDistribution`, default 0.93 for skin. Positive values throw
   * the transmitted light forward, away from the light, which is what makes a
   * backlit ear read as a glow concentrated where the light shines through
   * rather than as a uniform wash.
   *
   * Only the transmission BxDF uses this; the screen-space diffusion is
   * isotropic and ignores it. UE5 stores the value remapped to `[0, 1]`
   * (`EncodeScatteringDistribution`) because its profile texture is 8-bit per
   * channel; the table here is `rgba32f` and stores it raw.
   *
   * @public
   */
  get scatteringDistribution() {
    return this._scatteringDistribution;
  }
  set scatteringDistribution(val: number) {
    const next = Math.min(1, Math.max(-1, val ?? 0));
    if (next !== this._scatteringDistribution) {
      this._scatteringDistribution = next;
      this.notifyChanged();
    }
  }

  /**
   * Index of refraction used to bend the view ray before the phase function.
   *
   * @remarks
   * UE5's `IOR`, default 1.55 for skin, stored in the table as `1 / ior` since
   * that is the form `refract` takes. This drives transmission only — the
   * specular Fresnel stays on the dielectric `F0 = 0.08 * Specular` mapping, as
   * {@link SkinMaterial.specularF0} notes.
   *
   * @public
   */
  get ior() {
    return this._ior;
  }
  set ior(val: number) {
    const next = Math.min(3, Math.max(1, val ?? 1.55));
    if (next !== this._ior) {
      this._ior = next;
      this.notifyChanged();
    }
  }

  /**
   * Multiplier on the material roughness for the narrow specular lobe.
   *
   * @remarks
   * Used directly as a multiplier, so 1 leaves the material roughness alone and
   * skin's default 0.75 tightens the narrow lobe. The range 0.5..2 matches the
   * one UE5 exposes; UE5 stores the value halved and doubles it again on read,
   * which is purely its texture encoding and has no place here.
   *
   * @public
   */
  get roughness0() {
    return this._roughness0;
  }
  set roughness0(val: number) {
    const next = Math.min(2, Math.max(0.5, val ?? 0.75));
    if (next !== this._roughness0) {
      this._roughness0 = next;
      this.notifyChanged();
    }
  }

  /**
   * Multiplier on the material roughness for the wide specular lobe.
   *
   * @remarks
   * Same scaling as {@link SkinProfile.roughness0}; skin's default 1.3 broadens
   * the second lobe, giving it a soft sheen alongside the tighter highlight.
   *
   * @public
   */
  get roughness1() {
    return this._roughness1;
  }
  set roughness1(val: number) {
    const next = Math.min(2, Math.max(0.5, val ?? 1.3));
    if (next !== this._roughness1) {
      this._roughness1 = next;
      this.notifyChanged();
    }
  }

  /** Blend between the narrow and wide specular lobes. @public */
  get lobeMix() {
    return this._lobeMix;
  }
  set lobeMix(val: number) {
    const next = Math.min(0.9, Math.max(0.1, val ?? 0.85));
    if (next !== this._lobeMix) {
      this._lobeMix = next;
      this.notifyChanged();
    }
  }

  /**
   * Per-channel diffusion distance, in profile space.
   *
   * @remarks
   * This is deliberately *not* scaled by {@link SkinProfile.worldUnitScale}.
   * UE5 keeps the two apart the same way: the packed diffuse mean free path is
   * `MeanFreePathColor × MeanFreePathDistance` alone, and `WorldUnitScale` only
   * enters later, in `CalculateBurleyScale`, as the profile-space-to-world
   * conversion. Folding it in here as well made the diffusion scale with the
   * square of the world unit scale.
   *
   * The distance therefore has to be read together with the world unit scale to
   * reach world units; {@link SkinProfile.worldUnitScale} is the factor.
   *
   * @returns Mean free path scaled by the profile's distance and scatter scale.
   *
   * @public
   */
  getScatterDistance(): Vector3 {
    const s = this._meanFreePathDistance * this._scatterScale;
    return new Vector3(this._meanFreePath.x * s, this._meanFreePath.y * s, this._meanFreePath.z * s);
  }

  clone() {
    const other = new SkinProfile(this._preset);
    other.copyFrom(this);
    return other;
  }

  copyFrom(other: SkinProfile) {
    this._preset = other._preset;
    this._surfaceAlbedo.set(other._surfaceAlbedo);
    this._meanFreePath.set(other._meanFreePath);
    this._boundaryColorBleed.set(other._boundaryColorBleed);
    this._transmissionTint.set(other._transmissionTint);
    this._meanFreePathDistance = other._meanFreePathDistance;
    this._worldUnitScale = other._worldUnitScale;
    this._scatterScale = other._scatterScale;
    this._extinctionScale = other._extinctionScale;
    this._normalScale = other._normalScale;
    this._scatteringDistribution = other._scatteringDistribution;
    this._ior = other._ior;
    this._roughness0 = other._roughness0;
    this._roughness1 = other._roughness1;
    this._lobeMix = other._lobeMix;
    this.notifyChanged();
  }

  /**
   * Releases this profile's table slot.
   *
   * @public
   */
  dispose() {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (SkinProfile._profiles[this._id] === this) {
      SkinProfile._profiles[this._id] = null;
      SkinProfile.markDirty();
    }
  }

  private applyPreset(preset: SkinProfilePreset) {
    const t = SKIN_PROFILE_TEMPLATES[preset] ?? SKIN_PROFILE_TEMPLATES.skin;
    this._preset = preset;
    this._surfaceAlbedo.setXYZ(t.surfaceAlbedo[0], t.surfaceAlbedo[1], t.surfaceAlbedo[2]);
    this._meanFreePath.setXYZ(t.meanFreePath[0], t.meanFreePath[1], t.meanFreePath[2]);
    this._boundaryColorBleed.setXYZ(t.boundaryColorBleed[0], t.boundaryColorBleed[1], t.boundaryColorBleed[2]);
    this._transmissionTint.setXYZ(t.transmissionTint[0], t.transmissionTint[1], t.transmissionTint[2]);
    this._meanFreePathDistance = t.meanFreePathDistance;
    this._worldUnitScale = t.worldUnitScale;
    this._scatterScale = t.scatterScale;
    this._extinctionScale = t.extinctionScale;
    this._normalScale = t.normalScale;
    this._scatteringDistribution = t.scatteringDistribution;
    this._ior = t.ior;
    this._roughness0 = t.roughness0;
    this._roughness1 = t.roughness1;
    this._lobeMix = t.lobeMix;
    this.notifyChanged();
  }

  private static allocateId(profile: SkinProfile) {
    for (let i = 1; i < SKIN_PROFILE_CAPACITY; i++) {
      if (!this._profiles[i]) {
        this._profiles[i] = profile;
        this.markDirty();
        return i;
      }
    }
    throw new Error('SkinProfile limit exceeded');
  }

  private static markDirty() {
    this._tableDirty = true;
  }

  /**
   * Flags the packed table for a rebuild and notifies materials using this
   * profile so they can refresh their uniforms.
   */
  private notifyChanged() {
    SkinProfile.markDirty();
    this._changeListeners.forEach((listener) => listener());
  }

  private static packTable(out: Float32Array<ArrayBuffer>) {
    out.fill(0);
    const stride = SKIN_PROFILE_COLUMNS * 4;
    for (let id = 1; id < SKIN_PROFILE_CAPACITY; id++) {
      const p = this._profiles[id];
      if (!p) {
        continue;
      }
      const row = id * stride;
      const write = (column: ProfileColumn, x: number, y: number, z: number, w: number) => {
        const o = row + column * 4;
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = z;
        out[o + 3] = w;
      };
      // The diffusion draws its sample radii from a single representative
      // channel, which UE5 keeps in the `w` of both rows
      // (GetComponentForScalingFactorEstimation / GetDiffuseMeanFreePathForSampling);
      // `xyz` is then used to evaluate the three channel kernels at those radii.
      // The widest channel is the representative one, so that the sample
      // distribution covers every channel's tail.
      const d = p.getScatterDistance();
      const widest = Math.max(d.x, d.y, d.z);
      const albedoForSampling =
        widest > 0
          ? [p._surfaceAlbedo.x, p._surfaceAlbedo.y, p._surfaceAlbedo.z][
              [d.x, d.y, d.z].indexOf(widest)
            ]
          : p._surfaceAlbedo.x;
      write(ProfileColumn.Scaling, p._worldUnitScale, p._scatterScale, 0, 0);
      write(
        ProfileColumn.SurfaceAlbedo,
        p._surfaceAlbedo.x,
        p._surfaceAlbedo.y,
        p._surfaceAlbedo.z,
        albedoForSampling
      );
      write(ProfileColumn.MeanFreePath, d.x, d.y, d.z, widest);
      write(
        ProfileColumn.Boundary,
        p._boundaryColorBleed.x,
        p._boundaryColorBleed.y,
        p._boundaryColorBleed.z,
        0
      );
      write(
        ProfileColumn.Transmission,
        p._extinctionScale,
        p._normalScale,
        p._scatteringDistribution,
        1 / Math.max(p._ior, 1e-4)
      );
      write(ProfileColumn.Specular, p._roughness0, p._roughness1, p._lobeMix, 0);
      // The LUT columns are consecutive within the row, so the baked profile
      // drops straight in after the scalar parameters.
      p.writeTransmissionProfile(out, row + SKIN_PROFILE_PARAM_COLUMNS * 4);
    }
  }

  /**
   * Bakes this profile's transmission table.
   *
   * @remarks
   * `ComputeTransmissionProfileBurley` (`BurleyNormalizedSSS.cpp:171`),
   * transcribed. Each entry is the Burley diffusion profile integrated from that
   * radius out to infinity,
   *
   * ```
   * T(r) = 0.25 A (exp(-s r / L) + 3 exp(-s r / 3L))
   * ```
   *
   * evaluated per channel at its own `s` and `L`, times the transmission tint.
   * UE5 passes white for `A`, so the surface albedo is deliberately absent: the
   * profile carries only the *shape* of the falloff, and the base colour is
   * applied later, where the transmission joins the diffuse
   * (`SkinMaterial.fragmentShader`).
   *
   * The alpha is `exp(-distance x extinctionScale)`, which UE5 keeps as a
   * separate "SSSS shadow" curve; the BxDF reads `.rgb` only, but it is stored
   * for fidelity and costs nothing.
   *
   * @param out - Destination, `4 x transmissionLutSize` floats from `offset`.
   * @param offset - Index of the first float to write.
   *
   * @public
   */
  writeTransmissionProfile(out: Float32Array, offset = 0) {
    // The profile's distances live in profile space and the world unit scale is
    // the conversion out of it, exactly as it is for the diffusion radii. It
    // therefore applies to the *distance axis* of this table and not to the mean
    // free paths, which UE5 likewise leaves unscaled (its
    // `DiffuseMeanFreePathInMm` comes straight off the profile struct while only
    // `DistanceInMm` carries `InvUnitScale`).
    const invUnitScale = 1 / Math.max(this._worldUnitScale, 1e-4);
    const d = this.getScatterDistance();
    const l = [
      d.x * WORLD_UNITS_TO_PROFILE_MM,
      d.y * WORLD_UNITS_TO_PROFILE_MM,
      d.z * WORLD_UNITS_TO_PROFILE_MM
    ];
    const s = [
      searchLightDiffuseScalingFactor(this._surfaceAlbedo.x),
      searchLightDiffuseScalingFactor(this._surfaceAlbedo.y),
      searchLightDiffuseScalingFactor(this._surfaceAlbedo.z)
    ];
    const tint = [this._transmissionTint.x, this._transmissionTint.y, this._transmissionTint.z];
    const offsetMM = TRANSMISSION_LUT_RADIUS_OFFSET_MM * invUnitScale;
    for (let i = 0; i < SKIN_TRANSMISSION_LUT_SIZE; i++) {
      const o = offset + i * 4;
      // 50 mm is not quite enough to cool the red channel to nothing, and the
      // residual tail is still visible after tone mapping, so UE5 forces the
      // last entry black (`bMakeLastPixelBlack`). That is what guarantees
      // anything thicker than the table stops transmitting outright.
      if (i === SKIN_TRANSMISSION_LUT_SIZE - 1) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
        break;
      }
      // Note the divisor is the table size, not `size - 1`: the last entry is
      // blacked out anyway, so UE5 spends the axis on the entries that survive.
      const distanceMM =
        (i / SKIN_TRANSMISSION_LUT_SIZE) * TRANSMISSION_LUT_MAX_DISTANCE_MM * invUnitScale;
      const r = distanceMM + offsetMM;
      for (let c = 0; c < 3; c++) {
        out[o + c] =
          l[c] > 0
            ? 0.25 * (Math.exp((-s[c] * r) / l[c]) + 3 * Math.exp((-s[c] * r) / (3 * l[c]))) * tint[c]
            : 0;
      }
      out[o + 3] = Math.exp(-distanceMM * this._extinctionScale);
    }
  }
}
