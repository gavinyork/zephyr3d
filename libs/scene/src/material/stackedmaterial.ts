import type { Clonable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { Material } from './material';
import type { DrawContext } from '../render';

/**
 * Stacked material
 * @public
 */
export class StackedMaterial extends Material implements Clonable<StackedMaterial> {
  private _subMaterials: DRef<Material>[] = [];
  constructor() {
    super();
    this._subMaterials = [];
  }
  /**
   * Create a shallow clone of this material.
   * Subclasses should override to copy custom fields.
   */
  clone() {
    const other = new StackedMaterial();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copy common MeshMaterial properties from another material.
   * Call `super.copyFrom(other)` first when overriding in subclasses.
   *
   * @param other - Source material.
   */
  copyFrom(other: this) {
    super.copyFrom(other);
    for (const m of this._subMaterials) {
      m.dispose();
    }
    this._subMaterials = other._subMaterials.map((m) => new DRef(m.get()));
    this.optionChanged(true);
  }
  /**
   * {@inheritDoc Material.supportInstancing}
   * @override
   */
  supportInstancing() {
    return false;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting() {
    return this._subMaterials.some((m) => m.get()?.supportLighting());
  }
  /**
   * {@inheritDoc Material.isBatchable}
   * @override
   */
  isBatchable(): boolean {
    return false;
  }

  /**
   * {@inheritDoc Material.needSceneColor}
   * @override
   */
  needSceneColor(): boolean {
    return this._subMaterials.some((m) => m.get()?.needSceneColor());
  }
  /**
   * {@inheritDoc Material.needSceneDepth}
   * @override
   */
  needSceneDepth(): boolean {
    return this._subMaterials.some((m) => m.get()?.needSceneDepth());
  }
  /**
   * {@inheritDoc Material.apply}
   * @override
   */
  apply(ctx: DrawContext) {
    for (const m of this._subMaterials) {
      m.get()?.apply(ctx);
    }
    return true;
  }
}
