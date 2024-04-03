import type { RenderBundle } from "@zephyr3d/device";
import { Application } from "../app";

export class RenderBundleWrapper {
  private _renderBundles: Record<string, RenderBundle>;
  constructor() {
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
}