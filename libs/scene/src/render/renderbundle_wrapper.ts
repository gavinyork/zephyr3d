import type { RenderBundle } from "@zephyr3d/device";
import { Application } from "../app";

export class RenderBundleWrapper {
  private _renderBundles: Record<string, RenderBundle>;
  constructor() {
    this._renderBundles = {};
  }
  getRenderBundle(windingOrderReversed: boolean) {
    return this._renderBundles[this.calculateHash(windingOrderReversed)] ?? null;
  }
  beginRenderBundle() {
    Application.instance.device.beginCapture();
  }
  endRenderBundle(windingOrderReversed: boolean) {
    this._renderBundles[this.calculateHash(windingOrderReversed)] = Application.instance.device.endCapture();
  }
  calculateHash(windingOrderReversed: boolean) {
    return `${windingOrderReversed ? 1 : 0}-${Application.instance.device.getFramebuffer()?.getHash() ?? ''}`;
  }
}