import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '@zephyr3d/scene';
import { AbstractPostEffect } from '@zephyr3d/scene';

/**
 * The post water effect
 * @public
 */
export class PostGizmoRenderer extends AbstractPostEffect<'PostGizmoRenderer'> {
  static readonly className = 'PostGizmoRenderer' as const;
  static _gizmoProgram: GPUProgram = null;
  _Axis: Primitive[];
  _bindGroup: BindGroup;
  /**
   * Creates an instance of PostGizmoRenderer.
   */
  constructor() {
    super();
    this._Axis = [];
    this._bindGroup = null;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    this.passThrough(ctx, inputColorTexture, srgbOutput);
  }
  private _createAxis(ctx: DrawContext) {}
}
