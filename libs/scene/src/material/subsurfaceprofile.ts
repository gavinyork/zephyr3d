import { Vector3, type Immutable } from '@zephyr3d/base';

/**
 * Built-in subsurface scattering profile preset names.
 *
 * @remarks
 * The short aliases (`skin`, `wax`, and `jade`) resolve to their default
 * canonical profiles.
 *
 * @public
 */
export type SubsurfaceProfilePreset =
  | 'skin'
  | 'skin_thin'
  | 'skin_default'
  | 'skin_heavy_makeup'
  | 'wax'
  | 'wax_backlit'
  | 'wax_soft'
  | 'jade'
  | 'jade_backlit'
  | 'jade_soft';

type CanonicalSubsurfaceProfilePreset =
  | 'skin_thin'
  | 'skin_default'
  | 'skin_heavy_makeup'
  | 'wax_backlit'
  | 'wax_soft'
  | 'jade_backlit'
  | 'jade_soft';

type SubsurfaceProfilePresetTemplate = {
  meanFreePathColor: [number, number, number];
  meanFreePathDistance: number;
  falloffColor: [number, number, number];
  strength: number;
  scale: number;
  worldUnitScale: number;
  boundaryColorBleed: number;
  transmissionTintColor: [number, number, number];
  extinctionScale: number;
  normalScale: number;
  scatteringDistribution: number;
};

const SUBSURFACE_PROFILE_PRESET_ALIAS: Record<SubsurfaceProfilePreset, CanonicalSubsurfaceProfilePreset> = {
  skin: 'skin_default',
  skin_thin: 'skin_thin',
  skin_default: 'skin_default',
  skin_heavy_makeup: 'skin_heavy_makeup',
  wax: 'wax_backlit',
  wax_backlit: 'wax_backlit',
  wax_soft: 'wax_soft',
  jade: 'jade_soft',
  jade_backlit: 'jade_backlit',
  jade_soft: 'jade_soft'
};

const SUBSURFACE_PROFILE_PRESET_INDEX: Record<CanonicalSubsurfaceProfilePreset, number> = {
  skin_thin: 0,
  skin_default: 1,
  skin_heavy_makeup: 2,
  wax_backlit: 3,
  wax_soft: 4,
  jade_backlit: 5,
  jade_soft: 6
};

const SUBSURFACE_PROFILE_PRESET_TEMPLATE: Record<
  CanonicalSubsurfaceProfilePreset,
  SubsurfaceProfilePresetTemplate
> = {
  skin_thin: {
    meanFreePathColor: [1.0, 0.37, 0.11],
    meanFreePathDistance: 0.7,
    falloffColor: [1.0, 0.32, 0.2],
    strength: 0.68,
    scale: 0.82,
    worldUnitScale: 0.88,
    boundaryColorBleed: 0.13,
    transmissionTintColor: [1, 0.37, 0.28],
    extinctionScale: 1.24,
    normalScale: 1.18,
    scatteringDistribution: 0.56
  },
  skin_default: {
    meanFreePathColor: [1.0, 0.45, 0.17],
    meanFreePathDistance: 0.92,
    falloffColor: [1.0, 0.39, 0.25],
    strength: 0.82,
    scale: 0.96,
    worldUnitScale: 1,
    boundaryColorBleed: 0.22,
    transmissionTintColor: [1, 0.46, 0.34],
    extinctionScale: 1.06,
    normalScale: 1,
    scatteringDistribution: 0.6
  },
  skin_heavy_makeup: {
    meanFreePathColor: [1.0, 0.33, 0.11],
    meanFreePathDistance: 0.68,
    falloffColor: [1.0, 0.26, 0.16],
    strength: 0.56,
    scale: 0.76,
    worldUnitScale: 0.84,
    boundaryColorBleed: 0.08,
    transmissionTintColor: [0.94, 0.31, 0.22],
    extinctionScale: 1.4,
    normalScale: 1.26,
    scatteringDistribution: 0.5
  },
  wax_backlit: {
    meanFreePathColor: [1.0, 0.68, 0.36],
    meanFreePathDistance: 1.54,
    falloffColor: [1.0, 0.8, 0.66],
    strength: 1.12,
    scale: 1.42,
    worldUnitScale: 1.26,
    boundaryColorBleed: 0.42,
    transmissionTintColor: [1, 0.82, 0.7],
    extinctionScale: 0.78,
    normalScale: 0.92,
    scatteringDistribution: 0.82
  },
  wax_soft: {
    meanFreePathColor: [1.0, 0.72, 0.38],
    meanFreePathDistance: 1.2,
    falloffColor: [1.0, 0.86, 0.74],
    strength: 1.02,
    scale: 1.28,
    worldUnitScale: 1.12,
    boundaryColorBleed: 0.36,
    transmissionTintColor: [1, 0.86, 0.74],
    extinctionScale: 0.86,
    normalScale: 0.98,
    scatteringDistribution: 0.74
  },
  jade_backlit: {
    meanFreePathColor: [0.74, 1.0, 0.88],
    meanFreePathDistance: 0.92,
    falloffColor: [0.66, 0.94, 0.88],
    strength: 0.92,
    scale: 1.14,
    worldUnitScale: 1.06,
    boundaryColorBleed: 0.26,
    transmissionTintColor: [0.68, 0.92, 0.86],
    extinctionScale: 0.92,
    normalScale: 1.02,
    scatteringDistribution: 0.7
  },
  jade_soft: {
    meanFreePathColor: [0.68, 1.0, 0.84],
    meanFreePathDistance: 0.8,
    falloffColor: [0.72, 0.94, 0.86],
    strength: 0.82,
    scale: 1.02,
    worldUnitScale: 0.98,
    boundaryColorBleed: 0.22,
    transmissionTintColor: [0.74, 0.96, 0.9],
    extinctionScale: 1,
    normalScale: 1.04,
    scatteringDistribution: 0.66
  }
};

const SUBSURFACE_PROFILE_PRESET_TINT_BIAS: Record<
  CanonicalSubsurfaceProfilePreset,
  [number, number, number]
> = {
  skin_thin: [1, 0.56, 0.46],
  skin_default: [1, 0.62, 0.5],
  skin_heavy_makeup: [1, 0.5, 0.42],
  wax_backlit: [1, 0.8, 0.7],
  wax_soft: [1, 0.86, 0.78],
  jade_backlit: [0.72, 0.92, 0.96],
  jade_soft: [0.68, 0.96, 0.88]
};

const SUBSURFACE_PROFILE_PRESET_RESPONSE: Record<
  CanonicalSubsurfaceProfilePreset,
  [number, number, number, number]
> = {
  skin_thin: [0.08, 0.12, 0.06, 0.12],
  skin_default: [0.1, 0.14, 0.08, 0.16],
  skin_heavy_makeup: [0.02, 0.05, -0.02, 0.01],
  wax_backlit: [0.12, 0.2, 0.26, 0.24],
  wax_soft: [0.2, 0.3, 0.34, 0.1],
  jade_backlit: [0.08, 0.18, 0.2, 0.24],
  jade_soft: [0.16, 0.24, 0.22, 0.12]
};

/**
 * Serializable subsurface scattering profile.
 *
 * @remarks
 * The profile stores the channel-dependent scattering radius and falloff used
 * by the screen-space SSS post effect. Materials can share a profile instance
 * to emulate Unreal-style skin profile assets.
 *
 * @public
 */
export class SubsurfaceProfile {
  private static readonly _maxProfiles = 255;
  private static readonly _profiles: Array<SubsurfaceProfile | null> = new Array(
    SubsurfaceProfile._maxProfiles + 1
  ).fill(null);
  private static _version = 0;
  private static _defaultSkinProfile: SubsurfaceProfile | null = null;
  private readonly _scatterRadius: Vector3;
  private readonly _falloffColor: Vector3;
  private readonly _meanFreePathColor: Vector3;
  private readonly _transmissionTintColor: Vector3;
  private _preset: CanonicalSubsurfaceProfilePreset;
  private _meanFreePathDistance: number;
  private _strength: number;
  private _scale: number;
  private _worldUnitScale: number;
  private _boundaryColorBleed: number;
  private _extinctionScale: number;
  private _normalScale: number;
  private _scatteringDistribution: number;
  private readonly _slot: number;
  private readonly _changeListeners: Set<() => void>;

  /**
   * Creates a subsurface scattering profile initialized with the default skin preset.
   *
   * @public
   */
  constructor() {
    this._scatterRadius = new Vector3(0, 0, 0);
    this._falloffColor = new Vector3(0, 0, 0);
    this._meanFreePathColor = new Vector3(0, 0, 0);
    this._transmissionTintColor = new Vector3(0, 0, 0);
    this._preset = 'skin_default';
    this._meanFreePathDistance = 0;
    this._strength = 0;
    this._scale = 0;
    this._worldUnitScale = 1;
    this._boundaryColorBleed = 0;
    this._extinctionScale = 1;
    this._normalScale = 1;
    this._scatteringDistribution = 0.65;
    this._changeListeners = new Set();
    this._slot = SubsurfaceProfile.allocateSlot(this);
    this.applyPresetTemplate(this._preset, false);
  }

  /**
   * Gets the global profile data version.
   *
   * @remarks
   * The value is incremented whenever a profile slot is allocated or profile
   * data changes, allowing render systems to refresh cached profile textures.
   *
   * @public
   */
  static get version() {
    return this._version;
  }

  /**
   * Gets the profile assigned to a packed profile slot.
   *
   * @param slot - The 1-based profile slot index.
   * @returns The profile assigned to the slot, or `null` if the slot is invalid or unused.
   *
   * @public
   */
  static getProfileBySlot(slot: number) {
    return slot > 0 && slot < this._profiles.length ? this._profiles[slot] : null;
  }

  /**
   * Gets the shared default skin subsurface profile.
   *
   * @returns The lazily-created default skin profile.
   *
   * @public
   */
  static getDefaultSkinProfile() {
    if (!this._defaultSkinProfile) {
      this._defaultSkinProfile = new SubsurfaceProfile();
    }
    return this._defaultSkinProfile;
  }

  /**
   * Gets the preset tint bias used by the screen-space transmission model.
   *
   * @param index - The packed canonical preset index.
   * @returns The RGB tint bias for the preset, or white when the index is unknown.
   *
   * @public
   */
  static getPresetTintBiasByIndex(index: number) {
    return SUBSURFACE_PROFILE_PRESET_TINT_BIAS[this.getPresetNameByIndex(index)] ?? [1, 1, 1];
  }

  /**
   * Gets the preset transmission response used by the screen-space SSS pass.
   *
   * @param index - The packed canonical preset index.
   * @returns The four-component transmission response for the preset.
   *
   * @public
   */
  static getPresetResponseByIndex(index: number) {
    return SUBSURFACE_PROFILE_PRESET_RESPONSE[this.getPresetNameByIndex(index)] ?? [0, 0, 0, 0];
  }

  /**
   * Computes the effective tint bias from the preset and current profile settings.
   *
   * @returns The derived RGB tint bias used for transmission tinting.
   *
   * @public
   */
  getDerivedTintBias(): [number, number, number] {
    const base = SUBSURFACE_PROFILE_PRESET_TINT_BIAS[this._preset] ?? [1, 1, 1];
    const factors = this.getDerivedProfileFactors();
    const derived: [number, number, number] = [
      this.clamp01(0.78 + factors.warmBias * 0.26 - factors.coolBias * 0.16 + factors.boundaryNorm * 0.04),
      this.clamp01(
        0.3 +
          factors.meanFreePathColor[1] * 0.24 +
          factors.transmissionTintColor[1] * 0.28 +
          factors.distanceNorm * 0.08 +
          factors.scaleNorm * 0.05 +
          factors.boundaryNorm * 0.08 +
          factors.coolBias * 0.06
      ),
      this.clamp01(
        0.14 +
          factors.meanFreePathColor[2] * 0.22 +
          factors.transmissionTintColor[2] * 0.32 +
          factors.distanceNorm * 0.06 +
          factors.boundaryNorm * 0.06 +
          factors.coolBias * 0.12 -
          factors.warmBias * 0.06
      )
    ];
    const blend = this.clampRange(
      0.26 + factors.radiusNorm * 0.16 + factors.scaleNorm * 0.1 + factors.strengthNorm * 0.08,
      0.25,
      0.88
    );
    return [
      this.mixNumber(base[0], derived[0], blend),
      this.mixNumber(base[1], derived[1], blend),
      this.mixNumber(base[2], derived[2], blend)
    ];
  }

  /**
   * Computes the effective transmission response from the preset and current profile settings.
   *
   * @returns The derived transmission response packed as four scalar channels.
   *
   * @public
   */
  getDerivedTransmissionResponse(): [number, number, number, number] {
    const base = SUBSURFACE_PROFILE_PRESET_RESPONSE[this._preset] ?? [0, 0, 0, 0];
    const factors = this.getDerivedProfileFactors();
    const blend = this.clampRange(
      0.32 +
        factors.distanceNorm * 0.18 +
        factors.scaleNorm * 0.12 +
        factors.strengthNorm * 0.1 +
        factors.boundaryNorm * 0.06,
      0.28,
      0.9
    );
    const derived: [number, number, number, number] = [
      this.clampRange(
        -0.06 +
          factors.radiusNorm * 0.08 +
          factors.distanceNorm * 0.08 +
          factors.strengthNorm * 0.05 +
          factors.distributionNorm * 0.04 +
          factors.boundaryNorm * 0.05 +
          factors.extinctionSoftness * 0.03,
        -0.25,
        0.45
      ),
      this.clampRange(
        0.02 +
          factors.radiusNorm * 0.1 +
          factors.scaleNorm * 0.08 +
          factors.worldScaleNorm * 0.04 +
          factors.distributionNorm * 0.08 +
          factors.extinctionSoftness * 0.06,
        -0.25,
        0.45
      ),
      this.clampRange(
        -0.08 +
          factors.strengthNorm * 0.12 +
          factors.scaleNorm * 0.08 +
          factors.extinctionSoftness * 0.12 +
          factors.boundaryNorm * 0.06 +
          factors.warmBias * 0.05 -
          factors.coolBias * 0.04,
        -0.25,
        0.45
      ),
      this.clampRange(
        -0.02 +
          factors.radiusNorm * 0.12 +
          factors.scaleNorm * 0.08 +
          factors.strengthNorm * 0.06 +
          factors.boundaryNorm * 0.06 +
          factors.extinctionSoftness * 0.16 +
          factors.warmBias * 0.07 +
          factors.transmissionTintColor[0] * 0.04,
        -0.25,
        0.5
      )
    ];
    return [
      this.clampRange(this.mixNumber(base[0], derived[0], blend), -0.25, 0.45),
      this.clampRange(this.mixNumber(base[1], derived[1], blend), -0.25, 0.45),
      this.clampRange(this.mixNumber(base[2], derived[2], blend), -0.25, 0.45),
      this.clampRange(this.mixNumber(base[3], derived[3], blend), -0.25, 0.5)
    ];
  }

  /**
   * Gets the 1-based profile slot used when encoding this profile into SSS buffers.
   *
   * @public
   */
  get slot() {
    return this._slot;
  }

  /**
   * Gets or sets the RGB scatter radius.
   *
   * @remarks
   * Assigning a radius also updates the mean-free-path authoring controls.
   *
   * @public
   */
  get scatterRadius(): Immutable<Vector3> {
    return this._scatterRadius;
  }

  set scatterRadius(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._scatterRadius)) {
      this._scatterRadius.set(val);
      this.syncMeanFreePathFromScatterRadius();
    }
  }

  /**
   * Gets or sets the channel falloff color used by the diffusion kernel.
   *
   * @public
   */
  get falloffColor(): Immutable<Vector3> {
    return this._falloffColor;
  }

  set falloffColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._falloffColor)) {
      this._falloffColor.set(val);
      this.markDirty();
    }
  }

  /**
   * Mean free path color used to derive channel-dependent scatter radius.
   *
   * @remarks
   * This is a more UE-like authoring control that keeps the existing radius-
   * based implementation, while letting tools expose a color + distance pair.
   *
   * @public
   */
  get meanFreePathColor(): Immutable<Vector3> {
    return this._meanFreePathColor;
  }

  set meanFreePathColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._meanFreePathColor)) {
      this._meanFreePathColor.set(val);
      this.syncScatterRadiusFromMeanFreePath();
    }
  }

  /**
   * Gets or sets the mean free path distance used to derive the absolute scatter radius.
   *
   * @public
   */
  get meanFreePathDistance() {
    return this._meanFreePathDistance;
  }

  set meanFreePathDistance(val: number) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._meanFreePathDistance) {
      this._meanFreePathDistance = next;
      this.syncScatterRadiusFromMeanFreePath();
    }
  }

  /**
   * Gets or sets the active subsurface profile preset.
   *
   * @remarks
   * Assigning a preset applies its template values to the profile. Alias preset
   * names are resolved to their canonical preset.
   *
   * @public
   */
  get preset() {
    return this._preset;
  }

  set preset(val: SubsurfaceProfilePreset) {
    const next = SubsurfaceProfile.resolvePreset(val);
    if (next !== this._preset) {
      this._preset = next;
      this.applyPresetTemplate(next);
    }
  }

  /**
   * Gets the packed canonical preset index.
   *
   * @public
   */
  get presetIndex() {
    return SUBSURFACE_PROFILE_PRESET_INDEX[this._preset] ?? 0;
  }

  /**
   * Gets or sets the SSS strength multiplier.
   *
   * @public
   */
  get strength() {
    return this._strength;
  }

  set strength(val: number) {
    if (val !== this._strength) {
      this._strength = val;
      this.markDirty();
    }
  }

  /**
   * Gets or sets the screen-space scatter width scale.
   *
   * @public
   */
  get scale() {
    return this._scale;
  }

  set scale(val: number) {
    if (val !== this._scale) {
      this._scale = val;
      this.markDirty();
    }
  }

  /**
   * Gets or sets the world-unit scale used when converting profile radii.
   *
   * @public
   */
  get worldUnitScale() {
    return this._worldUnitScale;
  }

  set worldUnitScale(val: number) {
    const next = Math.max(0.05, val ?? 0.05);
    if (next !== this._worldUnitScale) {
      this._worldUnitScale = next;
      this.markDirty();
    }
  }

  /**
   * Gets or sets the amount of color bleeding preserved near SSS boundaries.
   *
   * @remarks
   * Values are clamped to the `[0, 1]` range.
   *
   * @public
   */
  get boundaryColorBleed() {
    return this._boundaryColorBleed;
  }

  set boundaryColorBleed(val: number) {
    const next = this.clamp01(val ?? 0);
    if (next !== this._boundaryColorBleed) {
      this._boundaryColorBleed = next;
      this.markDirty();
    }
  }

  /**
   * Gets or sets the RGB tint applied to transmitted subsurface light.
   *
   * @public
   */
  get transmissionTintColor(): Immutable<Vector3> {
    return this._transmissionTintColor;
  }

  set transmissionTintColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._transmissionTintColor)) {
      this._transmissionTintColor.set(val);
      this.markDirty();
    }
  }

  /**
   * Gets or sets the extinction multiplier used by transmission attenuation.
   *
   * @remarks
   * Values are clamped to zero or greater.
   *
   * @public
   */
  get extinctionScale() {
    return this._extinctionScale;
  }

  set extinctionScale(val: number) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._extinctionScale) {
      this._extinctionScale = next;
      this.markDirty();
    }
  }

  /**
   * Gets or sets the normal sensitivity scale used by SSS filtering.
   *
   * @remarks
   * Values are clamped to zero or greater.
   *
   * @public
   */
  get normalScale() {
    return this._normalScale;
  }

  set normalScale(val: number) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._normalScale) {
      this._normalScale = next;
      this.markDirty();
    }
  }

  /**
   * Gets or sets the scattering distribution blend.
   *
   * @remarks
   * Values are clamped to the `[0, 1]` range.
   *
   * @public
   */
  get scatteringDistribution() {
    return this._scatteringDistribution;
  }

  set scatteringDistribution(val: number) {
    const next = this.clamp01(val ?? 0);
    if (next !== this._scatteringDistribution) {
      this._scatteringDistribution = next;
      this.markDirty();
    }
  }

  /**
   * Adds a listener that is invoked whenever this profile changes.
   *
   * @param listener - The callback to invoke after profile data changes.
   *
   * @public
   */
  addChangeListener(listener: () => void) {
    this._changeListeners.add(listener);
  }

  /**
   * Removes a previously registered profile change listener.
   *
   * @param listener - The callback to remove.
   *
   * @public
   */
  removeChangeListener(listener: () => void) {
    this._changeListeners.delete(listener);
  }

  private static allocateSlot(profile: SubsurfaceProfile) {
    for (let i = 1; i < this._profiles.length; i++) {
      if (!this._profiles[i]) {
        this._profiles[i] = profile;
        this._version++;
        return i;
      }
    }
    throw new Error('SubsurfaceProfile limit exceeded');
  }

  private markDirty() {
    SubsurfaceProfile._version++;
    this._changeListeners.forEach((listener) => listener());
  }

  private static resolvePreset(preset: SubsurfaceProfilePreset | null | undefined) {
    return SUBSURFACE_PROFILE_PRESET_ALIAS[preset ?? 'skin_default'] ?? 'skin_default';
  }

  private static getPresetNameByIndex(index: number): CanonicalSubsurfaceProfilePreset {
    for (const [name, presetIndex] of Object.entries(SUBSURFACE_PROFILE_PRESET_INDEX) as Array<
      [CanonicalSubsurfaceProfilePreset, number]
    >) {
      if (presetIndex === index) {
        return name;
      }
    }
    return 'skin_default';
  }

  private applyPresetTemplate(preset: CanonicalSubsurfaceProfilePreset, markDirty = true) {
    const template =
      SUBSURFACE_PROFILE_PRESET_TEMPLATE[preset] ?? SUBSURFACE_PROFILE_PRESET_TEMPLATE.skin_default;
    this._meanFreePathColor.setXYZ(
      template.meanFreePathColor[0],
      template.meanFreePathColor[1],
      template.meanFreePathColor[2]
    );
    this._meanFreePathDistance = template.meanFreePathDistance;
    this._strength = template.strength;
    this._scale = template.scale;
    this._worldUnitScale = template.worldUnitScale;
    this._boundaryColorBleed = template.boundaryColorBleed;
    this._transmissionTintColor.setXYZ(
      template.transmissionTintColor[0],
      template.transmissionTintColor[1],
      template.transmissionTintColor[2]
    );
    this._extinctionScale = template.extinctionScale;
    this._normalScale = template.normalScale;
    this._scatteringDistribution = template.scatteringDistribution;
    this.syncScatterRadiusFromMeanFreePath(false);
    if (markDirty) {
      this.markDirty();
    }
  }

  private syncMeanFreePathFromScatterRadius(markDirty = true) {
    const maxRadius = Math.max(this._scatterRadius.x, this._scatterRadius.y, this._scatterRadius.z);
    if (maxRadius > 1e-5) {
      this._meanFreePathDistance = maxRadius;
      this._meanFreePathColor.setXYZ(
        this._scatterRadius.x / maxRadius,
        this._scatterRadius.y / maxRadius,
        this._scatterRadius.z / maxRadius
      );
    } else {
      this._meanFreePathDistance = 0;
      this._meanFreePathColor.setXYZ(0, 0, 0);
    }
    this.syncFalloffFromMeanFreePath(false);
    if (markDirty) {
      this.markDirty();
    }
  }

  private syncScatterRadiusFromMeanFreePath(markDirty = true) {
    const distance = Math.max(0, this._meanFreePathDistance);
    this._scatterRadius.setXYZ(
      Math.max(0, this._meanFreePathColor.x) * distance,
      Math.max(0, this._meanFreePathColor.y) * distance,
      Math.max(0, this._meanFreePathColor.z) * distance
    );
    this.syncFalloffFromMeanFreePath(false);
    if (markDirty) {
      this.markDirty();
    }
  }

  private syncFalloffFromMeanFreePath(markDirty = true) {
    const base =
      SUBSURFACE_PROFILE_PRESET_TEMPLATE[this._preset]?.falloffColor ??
      SUBSURFACE_PROFILE_PRESET_TEMPLATE.skin_default.falloffColor;
    const factors = this.getDerivedProfileFactors();
    const derivedG = this.clamp01(
      0.12 +
        factors.meanFreePathColor[1] * 0.4 +
        factors.transmissionTintColor[1] * 0.12 +
        factors.distanceNorm * 0.05 +
        factors.scaleNorm * 0.05 +
        factors.distributionNorm * 0.05 -
        (1 - factors.extinctionSoftness) * 0.04
    );
    const derivedB = this.clamp01(
      0.04 +
        factors.meanFreePathColor[2] * 0.32 +
        factors.transmissionTintColor[2] * 0.18 +
        factors.distanceNorm * 0.04 +
        factors.boundaryNorm * 0.05 +
        factors.coolBias * 0.08 -
        factors.warmBias * 0.04
    );
    const blend = this.clampRange(
      0.24 + factors.distanceNorm * 0.16 + factors.scaleNorm * 0.12 + factors.strengthNorm * 0.08,
      0.22,
      0.82
    );
    this._falloffColor.setXYZ(
      1,
      this.mixNumber(base[1], derivedG, blend),
      this.mixNumber(base[2], derivedB, blend)
    );
    if (markDirty) {
      this.markDirty();
    }
  }

  private getNormalizedTransmissionTintColor(): [number, number, number] {
    const maxChannel = Math.max(
      this._transmissionTintColor.x,
      this._transmissionTintColor.y,
      this._transmissionTintColor.z,
      1e-5
    );
    return [
      Math.max(0, this._transmissionTintColor.x) / maxChannel,
      Math.max(0, this._transmissionTintColor.y) / maxChannel,
      Math.max(0, this._transmissionTintColor.z) / maxChannel
    ];
  }

  private getDerivedProfileFactors() {
    const meanFreePathColor = this.getNormalizedMeanFreePathColor();
    const transmissionTintColor = this.getNormalizedTransmissionTintColor();
    const maxRadius = Math.max(this._scatterRadius.x, this._scatterRadius.y, this._scatterRadius.z);
    const radiusNorm = this.clampRange(maxRadius / 1.35, 0, 1.5);
    const distanceNorm = this.clampRange(this._meanFreePathDistance / 1.25, 0, 1.5);
    const scaleNorm = this.clampRange(this._scale / 1.35, 0, 1.5);
    const strengthNorm = this.clampRange(this._strength / 1.2, 0, 1.5);
    const worldScaleNorm = this.clampRange(this._worldUnitScale / 1.25, 0, 1.5);
    const boundaryNorm = this.clamp01(this._boundaryColorBleed);
    const distributionNorm = this.clamp01(this._scatteringDistribution);
    const extinctionWeight = this.clampRange(1 / Math.max(this._extinctionScale, 0.35), 0.25, 1.35);
    const extinctionSoftness = this.clamp01((extinctionWeight - 0.25) / 1.1);
    const warmBias = this.clamp01(
      0.5 +
        (meanFreePathColor[0] - Math.max(meanFreePathColor[1], meanFreePathColor[2]) * 0.72) * 0.95 +
        (transmissionTintColor[0] - Math.max(transmissionTintColor[1], transmissionTintColor[2]) * 0.78) * 0.7
    );
    const coolBias = this.clamp01(
      0.32 +
        (transmissionTintColor[2] - transmissionTintColor[0] * 0.55) * 0.55 +
        (meanFreePathColor[2] - meanFreePathColor[0] * 0.65) * 0.45
    );
    return {
      meanFreePathColor,
      transmissionTintColor,
      radiusNorm,
      distanceNorm,
      scaleNorm,
      strengthNorm,
      worldScaleNorm,
      boundaryNorm,
      distributionNorm,
      extinctionSoftness,
      warmBias,
      coolBias
    };
  }

  private getNormalizedMeanFreePathColor(): [number, number, number] {
    const maxChannel = Math.max(
      this._meanFreePathColor.x,
      this._meanFreePathColor.y,
      this._meanFreePathColor.z,
      1e-5
    );
    return [
      Math.max(0, this._meanFreePathColor.x) / maxChannel,
      Math.max(0, this._meanFreePathColor.y) / maxChannel,
      Math.max(0, this._meanFreePathColor.z) / maxChannel
    ];
  }

  private mixNumber(a: number, b: number, t: number) {
    return a * (1 - t) + b * t;
  }

  private clampRange(value: number, minValue: number, maxValue: number) {
    return Math.max(minValue, Math.min(maxValue, value));
  }

  private clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
  }
}
