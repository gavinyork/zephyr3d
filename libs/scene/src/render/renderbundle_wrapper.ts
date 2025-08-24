import type { RenderBundle } from '@zephyr3d/device';
import { Application } from '../app';
import type { Material } from '../material';
import type { Drawable } from './drawable';
import type { Primitive } from './primitive';
import { Disposable } from '@zephyr3d/base';

export class RenderBundleWrapper extends Disposable {
  private _renderBundles: Record<string, RenderBundle>;
  private static readonly _drawableContainer: WeakMap<
    Drawable,
    { wrapper: RenderBundleWrapper; hashes: string[] }[]
  > = new WeakMap();
  private static readonly _materialContainer: WeakMap<Material, Set<Drawable>> = new WeakMap();
  private static readonly _primitiveContainer: WeakMap<Primitive, Set<Drawable>> = new WeakMap();
  /** @internal */
  static addDrawable(
    drawable: Drawable,
    material: Material,
    primitive: Primitive,
    wrapper: RenderBundleWrapper,
    hash: string
  ) {
    let renderBundles = this._drawableContainer.get(drawable);
    if (!renderBundles) {
      renderBundles = [];
      this._drawableContainer.set(drawable, renderBundles);
    }
    const index = renderBundles.findIndex((rb) => rb.wrapper === wrapper);
    if (index < 0) {
      renderBundles.push({ wrapper: wrapper, hashes: [hash] });
    } else {
      if (!renderBundles[index].hashes.includes(hash)) {
        renderBundles[index].hashes.push(hash);
      }
    }
    if (material) {
      let ownDrawables = this._materialContainer.get(material);
      if (!ownDrawables) {
        ownDrawables = new Set();
        this._materialContainer.set(material, ownDrawables);
      }
      ownDrawables.add(drawable);
    }
    if (primitive) {
      let ownDrawables = this._primitiveContainer.get(primitive);
      if (!ownDrawables) {
        ownDrawables = new Set();
        this._primitiveContainer.set(primitive, ownDrawables);
      }
      ownDrawables.add(drawable);
    }
  }
  /** @internal */
  static drawableChanged(drawable: Drawable) {
    const renderBundles = this._drawableContainer.get(drawable);
    if (renderBundles) {
      for (let i = renderBundles.length - 1; i >= 0; i--) {
        const renderBundle = renderBundles[i].wrapper;
        if (renderBundle.disposed) {
          renderBundles.splice(i, 1);
        } else {
          for (const hash of renderBundles[i].hashes) {
            renderBundles[i].wrapper.invalidate(hash);
          }
        }
      }
    }
  }
  /** @internal */
  static primitiveChanged(primitive: Primitive) {
    const ownDrawables = this._primitiveContainer.get(primitive);
    if (ownDrawables) {
      for (const drawable of ownDrawables) {
        this.drawableChanged(drawable);
      }
    }
  }
  /** @internal */
  static primitiveAttached(primitive: Primitive, drawable: Drawable) {
    if (this._drawableContainer.has(drawable)) {
      const ownDrawables = this._primitiveContainer.get(primitive);
      if (!ownDrawables) {
        this._primitiveContainer.set(primitive, new Set([drawable]));
      } else {
        ownDrawables.add(drawable);
      }
      this.drawableChanged(drawable);
    }
  }
  /** @internal */
  static primitiveDetached(primitive: Primitive, drawable: Drawable) {
    const ownDrawables = this._primitiveContainer.get(primitive);
    if (ownDrawables && ownDrawables.has(drawable)) {
      ownDrawables.delete(drawable);
      this.drawableChanged(drawable);
    }
  }
  /** @internal */
  static materialChanged(material: Material) {
    const ownDrawables = this._materialContainer.get(material);
    if (ownDrawables) {
      for (const drawable of ownDrawables) {
        this.drawableChanged(drawable);
      }
    }
  }
  /** @internal */
  static materialUniformsChanged(material: Material) {
    const ownDrawables = this._materialContainer.get(material);
    if (ownDrawables) {
      for (const drawable of ownDrawables) {
        if (drawable.isBatchable()) {
          drawable.applyMaterialUniformsAll();
        }
      }
    }
  }
  /** @internal */
  static materialAttached(material: Material, drawable: Drawable) {
    if (this._drawableContainer.has(drawable)) {
      const ownDrawables = this._materialContainer.get(material);
      if (!ownDrawables) {
        this._materialContainer.set(material, new Set([drawable]));
      } else {
        ownDrawables.add(drawable);
      }
      this.drawableChanged(drawable);
    }
  }
  /** @internal */
  static materialDetached(material: Material, drawable: Drawable) {
    const ownDrawables = this._materialContainer.get(material);
    if (ownDrawables && ownDrawables.has(drawable)) {
      ownDrawables.delete(drawable);
      this.drawableChanged(drawable);
    }
  }
  constructor() {
    super();
    this._renderBundles = {};
  }
  getRenderBundle(hash: string) {
    return this._renderBundles[hash] ?? null;
  }
  beginRenderBundle() {
    Application.instance.device.beginCapture();
  }
  endRenderBundle(hash: string) {
    this._renderBundles[hash] = Application.instance.device.endCapture();
  }
  invalidate(hash: string) {
    this._renderBundles[hash] = undefined;
  }
  protected onDispose() {
    super.onDispose();
    this._renderBundles = {};
  }
}
