import type { Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { AbstractPostEffect } from './posteffect';

export class TAA extends AbstractPostEffect<'TAA'> {
  static readonly className = 'TAA' as const;
  private _poolKey: Symbol;
  constructor() {
    super();
    this._poolKey = Symbol('TAA');
  }
  apply(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    srgbOutput: boolean
  ): void {
    if (!ctx.device.poolExists(this._poolKey)) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
    }
  }
  requireLinearDepthTexture(ctx: DrawContext): boolean {
    return true;
  }
  requireDepthAttachment(ctx: DrawContext): boolean {
    return false;
  }
}
