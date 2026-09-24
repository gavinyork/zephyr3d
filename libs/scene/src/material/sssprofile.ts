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
const SSS_PROFILE_PARAM_COLUMNS = 6;

/**
 * Number of texels the baked transmission profile occupies.
 *
 * @remarks
 * `BSSS_TRANSMISSION_PROFILE_SIZE` in UE5 (`SubsurfaceProfileCommon.ush:27`).
 *
 * @internal
 */
const SSS_TRANSMISSION_LUT_SIZE = 32;

/**
 * Total columns per profile row: the scalar parameters followed by the baked
 * transmission profile, exactly as UE5 lays out an `SSProfiles` row.
 *
 * @internal
 */
const SSS_PROFILE_COLUMNS = SSS_PROFILE_PARAM_COLUMNS + SSS_TRANSMISSION_LUT_SIZE;

/** Maximum number of live skin profiles, matching the 8-bit profile id channel. @internal */
const SSS_PROFILE_CAPACITY = 256;

/**
 * Gate on {@link SSSProfile}'s constructor.
 *
 * @remarks
 * Module-private, so only {@link SSSProfile.createOwned} can pass it. See the
 * constructor for why a `private` modifier alone is not enough.
 *
 * @internal
 */
const CREATE_TOKEN = Symbol('SSSProfile.create');

/**
 * Largest optical depth the transmission profile is defined over.
 *
 * @internal
 */
export const SSS_MAX_TRANSMISSION_OPTICAL_DEPTH = 5;

/**
 * Floor the averaged optical depth is clamped to before encoding.
 *
 * @internal
 */
export const SSS_TRANSMISSION_OPTICAL_DEPTH_FLOOR = 0.15;

/**
 * Constant added to the optical depth after clamping.
 *
 * @internal
 */
export const SSS_TRANSMISSION_OPTICAL_DEPTH_BIAS = 0.25;

/**
 * Largest value the thickness pass can write, and with it the sentinel that
 * separates a real measurement from "no light wrote this".
 *
 * @remarks
 * The encoding is `1 - opticalDepth / MAX` and the optical depth never falls
 * below `FLOOR + BIAS`, so the pass tops out at 0.92 and the cleared value of 1
 * is unreachable — which makes it usable as "no data".
 *
 * The distinction matters because 1 decodes to zero optical depth, the profile's
 * *strongest* entry: read as a measurement it would light every non-transmitting
 * light's pixels at full transmission.
 *
 * @internal
 */
export const SSS_TRANSMISSION_NO_DATA_ENCODING =
  1 -
  (SSS_TRANSMISSION_OPTICAL_DEPTH_FLOOR + SSS_TRANSMISSION_OPTICAL_DEPTH_BIAS) /
    SSS_MAX_TRANSMISSION_OPTICAL_DEPTH;

/**
 * Distance, in profile millimetres, the baked transmission profile spans.
 *
 * @remarks
 * `MaxTransmissionProfileDistance * CmToMm = 5 * 10` in
 * `ComputeTransmissionProfileBurley`.
 *
 * The 5 here and the one in {@link SSS_MAX_TRANSMISSION_OPTICAL_DEPTH} are the
 * same number by construction: UE5's world unit is the centimetre, so an optical
 * depth of 1 at unit extinction *is* one centimetre, and this axis is that span
 * in the millimetres the mean free paths use. The shader indexes the table with
 * optical depth directly — self-consistent only once that is accounted for.
 *
 * The thickness pass must therefore be calibrated against this axis;
 * {@link SSS_OPTICAL_DEPTH_PER_WORLD_UNIT} is that calibration, and changing
 * this constant without it slides the whole profile along the thickness axis.
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
 * Derived rather than chosen, so the thickness pass and the baked profile cannot
 * drift apart. The BxDF indexes entry `opticalDepth / MAX * (size - 1)` and entry
 * `i` was baked for `i / size * LUT_MAX_MM` profile millimetres, so one unit of
 * optical depth is `LUT_MAX_MM * (size - 1) / size / MAX` millimetres.
 *
 * `worldUnitScale` deliberately does not appear: it divides both the table's axis
 * and the path's conversion into profile space, so it cancels. UE5 likewise keeps
 * it out of `CalculateOpticalDepth`.
 *
 * The `(size - 1) / size` is a deliberate 3% departure from UE5, whose index and
 * axis disagree by that factor. Correcting it makes a path of `t` metres index
 * exactly the entry baked for `t` millimetres.
 *
 * @internal
 */
export const SSS_OPTICAL_DEPTH_PER_WORLD_UNIT =
  (WORLD_UNITS_TO_PROFILE_MM * SSS_MAX_TRANSMISSION_OPTICAL_DEPTH) /
  (TRANSMISSION_LUT_MAX_DISTANCE_MM * ((SSS_TRANSMISSION_LUT_SIZE - 1) / SSS_TRANSMISSION_LUT_SIZE));

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
   * UE5's `SSSS_TRANSMISSION_OFFSET` column, unpacked in this order by
   * `GetTransmissionProfileParams`. The transmission tint is absent by design:
   * it is baked into the profile, and a second copy here could drift from it.
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
 * GPU (`posteffect/postsss.ts`, `scalingFactor`); the transmission profile is
 * baked on the CPU and needs its own copy.
 *
 * @internal
 */
function searchLightDiffuseScalingFactor(albedo: number): number {
  const v = albedo - 0.33;
  return 3.5 + 100 * v * v * v * v;
}

/**
 * Built-in {@link SSSProfile} presets.
 *
 * @public
 */
export type SSSProfilePreset = 'skin' | 'skin_pale' | 'skin_tan' | 'skin_dark' | 'wax' | 'jade' | 'marble';

interface SSSProfileTemplate {
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
 * The red-shifted mean free path (roughly 1 : 0.089 : 0.072) and the equally
 * red-shifted albedo are together what make the diffusion read as skin rather
 * than as a neutral blur — the first thing to check when scattering looks washed
 * out. UE5 ships only `skin`; the rest are this engine's own, pitched around the
 * same regime to stay comparable.
 *
 * `boundaryColorBleed` is white throughout, as in UE5: it tints taps belonging to
 * a *different* profile, so anything darker attenuates every profile boundary.
 *
 * @internal
 */
const SSS_PROFILE_TEMPLATES: Record<SSSProfilePreset, SSSProfileTemplate> = {
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
 * Subsurface profile for {@link SSSMaterial}, holding the parameters UE5's
 * Burley diffusion is driven by.
 *
 * @remarks
 * Profiles are packed into a shared GPU table keyed by {@link SSSProfile.id},
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
export class SSSProfile {
  private static readonly _profiles: Array<SSSProfile | null> = new Array(SSS_PROFILE_CAPACITY).fill(null);
  private static _table: Texture2D | null = null;
  /** Device {@link SSSProfile._table} belongs to, so a device swap can be spotted. */
  private static _tableDevice: AbstractDevice | null = null;
  private static _tableData: Float32Array<ArrayBuffer> | null = null;
  private static _tableDirty = true;
  private static _defaultProfile: SSSProfile | null = null;
  private readonly _id: number;
  private readonly _surfaceAlbedo: Vector3;
  private readonly _meanFreePath: Vector3;
  private readonly _boundaryColorBleed: Vector3;
  private readonly _transmissionTint: Vector3;
  private _preset: SSSProfilePreset;
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
   * Not constructible from outside. Use {@link SSSMaterial.subsurfaceProfile},
   * which owns one for the material's lifetime.
   *
   * @remarks
   * The token check is not redundant with `private`: profiles hold a row of a
   * 256-entry GPU table that only {@link SSSProfile.dispose} returns, and the
   * editor ships as prebuilt JavaScript that drives this class through
   * serialization metadata, where TypeScript's visibility rules do not apply.
   *
   * @internal
   */
  private constructor(token: typeof CREATE_TOKEN, preset: SSSProfilePreset = 'skin') {
    if (token !== CREATE_TOKEN) {
      throw new Error(
        'SSSProfile is not constructible directly; it is owned by the SSSMaterial that created it.'
      );
    }
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
    this._id = SSSProfile.allocateId(this);
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
   * Creates a profile for a material to own.
   *
   * @remarks
   * The only way to obtain one. The caller takes on releasing its table row — in
   * practice {@link SSSMaterial}, which disposes the profile with itself.
   *
   * @param preset - Preset to start from. Defaults to `'skin'`.
   * @returns The new profile.
   *
   * @internal
   */
  static createOwned(preset: SSSProfilePreset = 'skin') {
    return new SSSProfile(CREATE_TOKEN, preset);
  }

  /**
   * The shared default skin profile.
   *
   * @remarks
   * A fallback for consumers with no material to ask — the diffusion uses it for
   * pixels whose id is not in the table. Created lazily, since it holds a table
   * row for the lifetime of the process.
   *
   * @public
   */
  static getDefault() {
    if (!this._defaultProfile) {
      this._defaultProfile = new SSSProfile(CREATE_TOKEN, 'skin');
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
    return id > 0 && id < SSS_PROFILE_CAPACITY ? this._profiles[id] : null;
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
    // The table is static and outlives any one device. A texture belonging to a
    // dead device silently swallows every `update`, which strands the last values
    // uploaded before the swap on screen until the page is reloaded.
    if (this._table && (this._tableDevice !== device || this._table.disposed)) {
      this._table = null;
      this._tableData = null;
    }
    if (!this._table) {
      this._table = device.createTexture2D('rgba32f', SSS_PROFILE_COLUMNS, SSS_PROFILE_CAPACITY, {
        mipmapping: false,
        samplerOptions: { minFilter: 'nearest', magFilter: 'nearest', mipFilter: 'none' }
      });
      this._tableDevice = device;
      this._tableData = new Float32Array(SSS_PROFILE_COLUMNS * SSS_PROFILE_CAPACITY * 4);
      this._tableDirty = true;
    }
    if (this._tableDirty && this._table && this._tableData) {
      this.packTable(this._tableData);
      this._table.update(this._tableData, 0, 0, SSS_PROFILE_COLUMNS, SSS_PROFILE_CAPACITY);
      this._tableDirty = false;
    }
    return this._table;
  }

  /** Number of parameter columns in the packed table. @public */
  static get tableColumns() {
    return SSS_PROFILE_COLUMNS;
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
    return SSS_PROFILE_PARAM_COLUMNS;
  }

  /**
   * Column holding `(worldUnitScale, scatterScale, 0, 0)`.
   *
   * @remarks
   * Read by the transmission thickness pass, which needs the world unit scale to
   * size its normal shrink against the asset.
   *
   * @public
   */
  static get scalingParamColumn() {
    return ProfileColumn.Scaling as number;
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
    return SSS_TRANSMISSION_LUT_SIZE;
  }

  /** Number of rows in the packed table. @public */
  static get tableRows() {
    return SSS_PROFILE_CAPACITY;
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
  set preset(val: SSSProfilePreset) {
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
   * Scaled by {@link SSSProfile.meanFreePathDistance} to reach world units. The
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
   * deliberately absent from {@link SSSProfile.getScatterDistance}.
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
   * the transmitted light forward, concentrating a backlit ear's glow where the
   * light shines through rather than spreading it as a uniform wash.
   *
   * Only the transmission BxDF uses this; the screen-space diffusion is isotropic
   * and ignores it. Stored raw, unlike UE5's `[0, 1]` remap for an 8-bit texture.
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
   * {@link SSSMaterial.specularF0} notes.
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
   * A direct multiplier, so 1 leaves the material roughness alone and skin's
   * default 0.75 tightens the narrow lobe. The 0.5..2 range matches UE5's, whose
   * halve-on-pack encoding has no counterpart here.
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
   * Same scaling as {@link SSSProfile.roughness0}; skin's default 1.3 broadens
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
   * Deliberately *not* scaled by {@link SSSProfile.worldUnitScale}, which UE5
   * applies later in `CalculateBurleyScale`; applying it in both places would
   * make the diffusion scale with its square. The result must therefore be read
   * together with that factor to reach world units.
   *
   * @returns Mean free path scaled by the profile's distance and scatter scale.
   *
   * @public
   */
  getScatterDistance(): Vector3 {
    const s = this._meanFreePathDistance * this._scatterScale;
    return new Vector3(this._meanFreePath.x * s, this._meanFreePath.y * s, this._meanFreePath.z * s);
  }

  /**
   * Overwrites every parameter from another profile.
   *
   * @remarks
   * The only way to transfer a look, since profiles cannot be shared or cloned.
   * The table row is untouched: it identifies the profile, not its contents.
   *
   * @param other - Profile to copy the parameters from.
   *
   * @public
   */
  copyFrom(other: SSSProfile) {
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
    if (SSSProfile._profiles[this._id] === this) {
      SSSProfile._profiles[this._id] = null;
      SSSProfile.markDirty();
    }
  }

  private applyPreset(preset: SSSProfilePreset) {
    const t = SSS_PROFILE_TEMPLATES[preset] ?? SSS_PROFILE_TEMPLATES.skin;
    this._preset = preset;
    this._surfaceAlbedo.setXYZ(t.surfaceAlbedo[0], t.surfaceAlbedo[1], t.surfaceAlbedo[2]);
    this._meanFreePath.setXYZ(t.meanFreePath[0], t.meanFreePath[1], t.meanFreePath[2]);
    this._boundaryColorBleed.setXYZ(
      t.boundaryColorBleed[0],
      t.boundaryColorBleed[1],
      t.boundaryColorBleed[2]
    );
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

  private static allocateId(profile: SSSProfile) {
    for (let i = 1; i < SSS_PROFILE_CAPACITY; i++) {
      if (!this._profiles[i]) {
        this._profiles[i] = profile;
        this.markDirty();
        return i;
      }
    }
    throw new Error('SSSProfile limit exceeded');
  }

  private static markDirty() {
    this._tableDirty = true;
  }

  /**
   * Flags the packed table for a rebuild and notifies materials using this
   * profile so they can refresh their uniforms.
   */
  private notifyChanged() {
    SSSProfile.markDirty();
    this._changeListeners.forEach((listener) => listener());
  }

  private static packTable(out: Float32Array<ArrayBuffer>) {
    out.fill(0);
    const stride = SSS_PROFILE_COLUMNS * 4;
    for (let id = 1; id < SSS_PROFILE_CAPACITY; id++) {
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
      // The diffusion draws its radii from one representative channel, kept in
      // the `w` of both rows as UE5 does, and evaluates all three kernels at
      // those radii. The widest channel represents, so the sample distribution
      // covers every channel's tail.
      const d = p.getScatterDistance();
      const widest = Math.max(d.x, d.y, d.z);
      const albedoForSampling =
        widest > 0
          ? [p._surfaceAlbedo.x, p._surfaceAlbedo.y, p._surfaceAlbedo.z][[d.x, d.y, d.z].indexOf(widest)]
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
      p.writeTransmissionProfile(out, row + SSS_PROFILE_PARAM_COLUMNS * 4);
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
   * The surface albedo is absent — UE5 passes white for `A` — so this carries
   * only the *shape* of the falloff; the base colour is applied where the
   * transmission joins the diffuse.
   *
   * The alpha is `exp(-distance x extinctionScale)`, UE5's separate "SSSS shadow"
   * curve. The BxDF reads `.rgb` only, but storing it costs nothing.
   *
   * @param out - Destination, `4 x transmissionLutSize` floats from `offset`.
   * @param offset - Index of the first float to write.
   *
   * @public
   */
  writeTransmissionProfile(out: Float32Array, offset = 0) {
    // The world unit scale applies to this table's *distance axis*, not to the
    // mean free paths, which UE5 likewise leaves unscaled.
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
    for (let i = 0; i < SSS_TRANSMISSION_LUT_SIZE; i++) {
      const o = offset + i * 4;
      // UE5's `bMakeLastPixelBlack`: 50 mm leaves a red tail still visible after
      // tone mapping, so forcing the last entry black is what makes anything
      // thicker than the table stop transmitting outright.
      if (i === SSS_TRANSMISSION_LUT_SIZE - 1) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
        break;
      }
      // Note the divisor is the table size, not `size - 1`: the last entry is
      // blacked out anyway, so UE5 spends the axis on the entries that survive.
      const distanceMM = (i / SSS_TRANSMISSION_LUT_SIZE) * TRANSMISSION_LUT_MAX_DISTANCE_MM * invUnitScale;
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
