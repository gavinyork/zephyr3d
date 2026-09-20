import { Vector3, type Immutable } from '@zephyr3d/base';
import type { AbstractDevice, Texture2D } from '@zephyr3d/device';

/**
 * Number of parameter columns stored per profile row in the packed table.
 *
 * @remarks
 * Mirrors the row layout UE5 uses in its `SSProfiles` texture, read back from
 * `UEDigitalHuman.rdc` (SSS::PassOne_Burley lines 143-157).
 *
 * @internal
 */
const SKIN_PROFILE_COLUMNS = 6;

/** Maximum number of live skin profiles, matching the 8-bit profile id channel. @internal */
const SKIN_PROFILE_CAPACITY = 256;

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
  /** Boundary color bleed + tint. */
  Boundary = 3,
  /** Transmission tint. */
  Transmission = 4,
  /** Dual-lobe specular parameters. */
  Specular = 5
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
  roughness0: number;
  roughness1: number;
  lobeMix: number;
}

/**
 * Preset parameters.
 *
 * @remarks
 * The skin entries follow the albedo/mean-free-path pairs Burley's diffusion
 * model is normally fit with: a high, strongly red-shifted albedo, and a mean
 * free path an order of magnitude longer in red than in blue. That ratio is what
 * produces the red bleed through thin geometry such as ear rims and nostrils.
 *
 * @internal
 */
const SKIN_PROFILE_TEMPLATES: Record<SkinProfilePreset, SkinProfileTemplate> = {
  skin: {
    surfaceAlbedo: [0.85, 0.63, 0.55],
    meanFreePath: [1.0, 0.28, 0.14],
    meanFreePathDistance: 0.012,
    worldUnitScale: 1,
    scatterScale: 1,
    boundaryColorBleed: [0.78, 0.44, 0.36],
    transmissionTint: [1.0, 0.42, 0.3],
    extinctionScale: 1,
    normalScale: 0.08,
    roughness0: 0.75,
    roughness1: 1.3,
    lobeMix: 0.15
  },
  skin_pale: {
    surfaceAlbedo: [0.88, 0.68, 0.62],
    meanFreePath: [1.0, 0.32, 0.18],
    meanFreePathDistance: 0.014,
    worldUnitScale: 1,
    scatterScale: 1.08,
    boundaryColorBleed: [0.82, 0.5, 0.44],
    transmissionTint: [1.0, 0.48, 0.38],
    extinctionScale: 0.92,
    normalScale: 0.08,
    roughness0: 0.72,
    roughness1: 1.25,
    lobeMix: 0.16
  },
  skin_tan: {
    surfaceAlbedo: [0.8, 0.56, 0.46],
    meanFreePath: [1.0, 0.26, 0.12],
    meanFreePathDistance: 0.011,
    worldUnitScale: 1,
    scatterScale: 0.95,
    boundaryColorBleed: [0.72, 0.4, 0.3],
    transmissionTint: [1.0, 0.38, 0.26],
    extinctionScale: 1.08,
    normalScale: 0.08,
    roughness0: 0.76,
    roughness1: 1.32,
    lobeMix: 0.15
  },
  skin_dark: {
    surfaceAlbedo: [0.7, 0.45, 0.36],
    meanFreePath: [1.0, 0.22, 0.1],
    meanFreePathDistance: 0.009,
    worldUnitScale: 1,
    scatterScale: 0.85,
    boundaryColorBleed: [0.6, 0.32, 0.24],
    transmissionTint: [1.0, 0.3, 0.2],
    extinctionScale: 1.2,
    normalScale: 0.08,
    roughness0: 0.78,
    roughness1: 1.35,
    lobeMix: 0.14
  },
  wax: {
    surfaceAlbedo: [0.92, 0.85, 0.72],
    meanFreePath: [1.0, 0.82, 0.62],
    meanFreePathDistance: 0.05,
    worldUnitScale: 1,
    scatterScale: 1.4,
    boundaryColorBleed: [0.9, 0.82, 0.7],
    transmissionTint: [1.0, 0.88, 0.74],
    extinctionScale: 0.7,
    normalScale: 0.05,
    roughness0: 0.85,
    roughness1: 1.4,
    lobeMix: 0.2
  },
  jade: {
    surfaceAlbedo: [0.72, 0.9, 0.82],
    meanFreePath: [0.6, 1.0, 0.85],
    meanFreePathDistance: 0.04,
    worldUnitScale: 1,
    scatterScale: 1.25,
    boundaryColorBleed: [0.66, 0.9, 0.84],
    transmissionTint: [0.68, 0.95, 0.88],
    extinctionScale: 0.85,
    normalScale: 0.05,
    roughness0: 0.5,
    roughness1: 1.1,
    lobeMix: 0.25
  },
  marble: {
    surfaceAlbedo: [0.93, 0.92, 0.9],
    meanFreePath: [1.0, 0.95, 0.9],
    meanFreePathDistance: 0.03,
    worldUnitScale: 1,
    scatterScale: 1.15,
    boundaryColorBleed: [0.92, 0.9, 0.88],
    transmissionTint: [0.96, 0.95, 0.94],
    extinctionScale: 0.8,
    normalScale: 0.04,
    roughness0: 0.45,
    roughness1: 1.05,
    lobeMix: 0.3
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
    this._roughness0 = 0.75;
    this._roughness1 = 1.3;
    this._lobeMix = 0.15;
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

  /** Mean free path of the widest channel, in world units. @public */
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

  /** Scales world units before diffusion, for scenes not authored in meters. @public */
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

  /** Roughness multiplier of the narrow specular lobe. @public */
  get roughness0() {
    return this._roughness0;
  }
  set roughness0(val: number) {
    const next = Math.max(0.01, val ?? 0.75);
    if (next !== this._roughness0) {
      this._roughness0 = next;
      this.notifyChanged();
    }
  }

  /** Roughness multiplier of the wide specular lobe. @public */
  get roughness1() {
    return this._roughness1;
  }
  set roughness1(val: number) {
    const next = Math.max(0.01, val ?? 1.3);
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
    const next = Math.min(1, Math.max(0, val ?? 0.15));
    if (next !== this._lobeMix) {
      this._lobeMix = next;
      this.notifyChanged();
    }
  }

  /**
   * Per-channel diffusion distance in world units.
   *
   * @returns Mean free path scaled to world units and by the profile scaling.
   *
   * @public
   */
  getScatterDistance(): Vector3 {
    const s = this._meanFreePathDistance * this._worldUnitScale * this._scatterScale;
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
      write(ProfileColumn.Scaling, p._worldUnitScale, p._scatterScale, p._extinctionScale, p._normalScale);
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
        p._transmissionTint.x,
        p._transmissionTint.y,
        p._transmissionTint.z,
        0
      );
      write(ProfileColumn.Specular, p._roughness0, p._roughness1, p._lobeMix, 0);
    }
  }
}
