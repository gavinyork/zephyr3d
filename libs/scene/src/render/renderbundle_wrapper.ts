import type { RenderBundle } from '@zephyr3d/device';
import { Application } from '../app';
import type { Material } from '../material';
import type { Drawable } from './drawable';

export class RenderBundleWrapper {
  private _renderBundles: Record<string, RenderBundle>;
  private _disposed: boolean;
  private static _objectMap = new WeakMap<
    Drawable | Material,
    { wrapper: RenderBundleWrapper; hashes: string[] }[]
  >();
  /** @internal */
  static addObject(object: Drawable | Material, renderBundle: RenderBundleWrapper, hash: string) {
    if (object) {
      let renderBundles = this._objectMap.get(object);
      if (!renderBundles) {
        renderBundles = [];
        this._objectMap.set(object, renderBundles);
      }
      const index = renderBundles.findIndex((rb) => rb.wrapper === renderBundle);
      if (index < 0) {
        renderBundles.push({ wrapper: renderBundle, hashes: [hash] });
      } else if (!renderBundles[index].hashes.includes(hash)) {
        renderBundles[index].hashes.push(hash);
      }
    }
  }
  /** @internal */
  static objectChanged(object: Drawable | Material) {
    const renderBundles = this._objectMap.get(object);
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
  constructor() {
    this._renderBundles = {};
    this._disposed = false;
  }
  get disposed() {
    return this._disposed;
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
  dispose() {
    this._renderBundles = {};
    this._disposed = true;
  }
}
