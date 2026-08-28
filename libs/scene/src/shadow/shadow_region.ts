import type { Nullable } from '@zephyr3d/base';
import { AABB, Disposable, DWeakRef } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';

type StaticShadowCasterEntry = {
  ref: DWeakRef<SceneNode>;
  aabb: AABB;
};

type DynamicShadowCasterEntry = {
  ref: DWeakRef<SceneNode>;
  callback: (node: SceneNode) => void;
};

/**
 * Maintains the world-space region used by directional light shadow maps.
 *
 * @public
 */
export class ShadowRegion extends Disposable {
  /** @internal */
  private _manualRegion: Nullable<AABB>;
  /** @internal */
  private readonly _staticRegion: AABB;
  /** @internal */
  private readonly _dynamicRegion: AABB;
  /** @internal */
  private readonly _region: AABB;
  /** @internal */
  private readonly _staticCasters: StaticShadowCasterEntry[];
  /** @internal */
  private readonly _dynamicCasters: DynamicShadowCasterEntry[];

  /**
   * Creates a shadow region.
   *
   * @param region - Optional manual world-space AABB used to initialize the region.
   */
  constructor(region?: Nullable<AABB>) {
    super();
    this._manualRegion = region ? new AABB(region) : null;
    this._staticRegion = new AABB().beginExtend();
    this._dynamicRegion = new AABB().beginExtend();
    this._region = new AABB().beginExtend();
    this._staticCasters = [];
    this._dynamicCasters = [];
    this.updateRegion();
  }

  /**
   * Final world-space shadow region.
   *
   * @returns The union of the manual, static caster, and dynamic caster regions, or `null` if no valid region exists.
   */
  get region(): Nullable<AABB> {
    return this._region.isValid() ? this._region : null;
  }

  /**
   * Region contributed by manually assigned AABB.
   *
   * @returns The manually assigned region, or `null` if no manual region is set.
   */
  get manualRegion(): Nullable<AABB> {
    return this._manualRegion;
  }

  /**
   * Region contributed by static shadow casters.
   *
   * @returns The combined static caster region, or `null` if no valid static caster region exists.
   */
  get staticRegion(): Nullable<AABB> {
    return this._staticRegion.isValid() ? this._staticRegion : null;
  }

  /**
   * Region contributed by dynamic shadow casters.
   *
   * @returns The combined dynamic caster region, or `null` if no valid dynamic caster region exists.
   */
  get dynamicRegion(): Nullable<AABB> {
    return this._dynamicRegion.isValid() ? this._dynamicRegion : null;
  }

  /**
   * Assigns a manual world-space AABB to the region.
   *
   * @param region - The manual world-space AABB to use, or `null` to clear the manual region.
   */
  setRegion(region: Nullable<AABB>) {
    this._manualRegion = region ? new AABB(region) : null;
    this.updateRegion();
  }

  /**
   * Adds a static shadow caster using a snapshot of its current world-space AABB.
   *
   * @param caster - The mesh or clipmap terrain node to include as a static caster.
   * @returns `this` for chaining.
   */
  addStaticCaster(caster: SceneNode): this {
    if (!this.isShadowCaster(caster) || this.hasCaster(caster)) {
      return this;
    }
    const aabb = this.getCasterAABB(caster);
    if (!aabb) {
      return this;
    }
    this._staticCasters.push({
      ref: new DWeakRef(caster),
      aabb
    });
    this.extendRegion(this._staticRegion, aabb);
    this.updateRegion();
    return this;
  }

  /**
   * Adds a dynamic shadow caster and tracks its bounding volume changes.
   *
   * @param caster - The mesh or clipmap terrain node to include as a dynamic caster.
   * @returns `this` for chaining.
   */
  addDynamicCaster(caster: SceneNode): this {
    if (!this.isShadowCaster(caster) || this.hasCaster(caster)) {
      return this;
    }
    const callback = () => {
      this.rebuildDynamicRegion();
    };
    caster.on('bvchanged', callback);
    this._dynamicCasters.push({
      ref: new DWeakRef(caster),
      callback
    });
    const aabb = this.getCasterAABB(caster);
    if (aabb) {
      this.extendRegion(this._dynamicRegion, aabb);
      this.updateRegion();
    }
    return this;
  }

  /**
   * Removes a previously added shadow caster.
   *
   * @param caster - The caster node to remove from the static or dynamic caster list.
   * @returns `this` for chaining.
   */
  removeCaster(caster: SceneNode): this {
    let removed = false;
    let changed = false;
    for (let i = this._staticCasters.length - 1; i >= 0; i--) {
      const entry = this._staticCasters[i];
      const node = entry.ref.get();
      if (!node || node === caster) {
        entry.ref.dispose();
        this._staticCasters.splice(i, 1);
        changed = true;
        removed ||= node === caster;
      }
    }
    for (let i = this._dynamicCasters.length - 1; i >= 0; i--) {
      const entry = this._dynamicCasters[i];
      const node = entry.ref.get();
      if (!node || node === caster) {
        (node ?? caster).off('bvchanged', entry.callback);
        entry.ref.dispose();
        this._dynamicCasters.splice(i, 1);
        changed = true;
        removed ||= node === caster;
      }
    }
    if (changed) {
      this.rebuildStaticRegion();
      this.rebuildDynamicRegion();
    }
    return this;
  }

  /**
   * Removes all shadow casters while keeping the manual region.
   */
  clearCasters() {
    for (const entry of this._dynamicCasters) {
      entry.ref.get()?.off('bvchanged', entry.callback);
      entry.ref.dispose();
    }
    for (const entry of this._staticCasters) {
      entry.ref.dispose();
    }
    this._staticCasters.length = 0;
    this._dynamicCasters.length = 0;
    this._staticRegion.beginExtend();
    this._dynamicRegion.beginExtend();
    this.updateRegion();
  }

  /**
   * Clears the manual region and all shadow casters.
   *
   * @returns `this` for chaining.
   */
  clear(): this {
    this._manualRegion = null;
    this.clearCasters();
    return this;
  }

  /** {@inheritDoc Disposable.onDispose} */
  protected onDispose(): void {
    this.clear();
  }

  /** @internal */
  private hasCaster(caster: SceneNode): boolean {
    return (
      this._staticCasters.some((entry) => entry.ref.get() === caster) ||
      this._dynamicCasters.some((entry) => entry.ref.get() === caster)
    );
  }

  /** @internal */
  private isShadowCaster(caster: SceneNode): boolean {
    return !caster.disposed && (caster.isMesh() || caster.isClipmapTerrain() || caster.isHair());
  }

  /** @internal */
  private getCasterAABB(caster: SceneNode): Nullable<AABB> {
    const bbox = caster.getWorldBoundingVolume()?.toAABB();
    return bbox?.isValid() ? new AABB(bbox) : null;
  }

  /** @internal */
  private rebuildStaticRegion() {
    this._staticRegion.beginExtend();
    for (let i = this._staticCasters.length - 1; i >= 0; i--) {
      const entry = this._staticCasters[i];
      if (!entry.ref.get()) {
        entry.ref.dispose();
        this._staticCasters.splice(i, 1);
      } else {
        this.extendRegion(this._staticRegion, entry.aabb);
      }
    }
    this.updateRegion();
  }

  /** @internal */
  private rebuildDynamicRegion() {
    this._dynamicRegion.beginExtend();
    for (let i = this._dynamicCasters.length - 1; i >= 0; i--) {
      const entry = this._dynamicCasters[i];
      const caster = entry.ref.get();
      if (!caster || !this.isShadowCaster(caster)) {
        caster?.off('bvchanged', entry.callback);
        entry.ref.dispose();
        this._dynamicCasters.splice(i, 1);
        continue;
      }
      const aabb = this.getCasterAABB(caster);
      if (aabb) {
        this.extendRegion(this._dynamicRegion, aabb);
      }
    }
    this.updateRegion();
  }

  /** @internal */
  private updateRegion() {
    this._region.beginExtend();
    if (this._manualRegion?.isValid()) {
      this.extendRegion(this._region, this._manualRegion);
    }
    if (this._staticRegion.isValid()) {
      this.extendRegion(this._region, this._staticRegion);
    }
    if (this._dynamicRegion.isValid()) {
      this.extendRegion(this._region, this._dynamicRegion);
    }
  }

  /** @internal */
  private extendRegion(region: AABB, aabb: AABB) {
    region.extend(aabb.minPoint);
    region.extend(aabb.maxPoint);
  }
}
