import type { RenderBundle } from '@zephyr3d/device';
import { Application } from '../app';

export class RenderBundleWrapper {
  private _renderBundles: Record<string, RenderBundle>;
  private _disposed: boolean;
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
