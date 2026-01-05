import type { AbstractDevice, CompareFunc, RenderStateSet, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { copyTexture, fetchSampler } from '../utility/misc';
import { Disposable } from '@zephyr3d/base';

/**
 * Rendering layer of post processing effects
 * @public
 *
 */
export enum PostEffectLayer {
  opaque = 0,
  transparent = 1,
  end = 2
}

/**
 * Base class for any type of post effect
 * @public
 */
export class AbstractPostEffect extends Disposable {
  private static _defaultRenderStates: { CompareFunc?: RenderStateSet } = {};
  protected _enabled: boolean;
  protected _layer: PostEffectLayer;
  /**
   * Creates an instance of a post effect
   * @param name - Name of the post effect
   */
  constructor() {
    super();
    this._enabled = true;
    this._layer = PostEffectLayer.end;
  }
  /** Whether this post effect is enabled */
  get enabled() {
    return this._enabled;
  }
  set enabled(val) {
    this._enabled = !!val;
  }
  /** Whether this post effect will be rendered at opaque phase */
  get layer() {
    return this._layer;
  }
  /**
   * Check if the post effect should be rendered upside down.
   * @param device - The device object
   * @returns true if the post effect should be rendered upside down
   */
  needFlip(device: AbstractDevice) {
    return device.type === 'webgpu' && !!device.getFramebuffer();
  }
  /**
   * Checks whether this post effect requires the linear depth texture
   * @returns true if the linear depth texture is required.
   */
  requireLinearDepthTexture(_ctx: DrawContext) {
    return false;
  }
  /**
   * Checks whether this post effect requires the scene depth buffer
   * @returns true if the scene depth buffer is required.
   */
  requireDepthAttachment(_ctx: DrawContext) {
    return false;
  }
  /**
   * Apply the post effect
   * @param camera - Camera used the render the scene
   * @param inputColorTexture - The previous scene color texture
   * @param sceneDepthTexture - The linear scene depth texture
   * @param srgbOutput - Whether the result should be gamma corrected
   *
   * @remarks
   * The frame buffer of the post effect is already set when apply() is called.
   */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    this.passThrough(ctx, inputColorTexture, srgbOutput);
  }
  /**
   *
   * @param ctx - Draw context
   * @param inputColorTexture - Input color texture
   * @param srgbOutput - Whether the result should be gamma corrected
   */
  protected passThrough(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    srgbOutput: boolean,
    renderStates?: RenderStateSet
  ) {
    copyTexture(
      inputColorTexture,
      ctx.device.getFramebuffer()!,
      fetchSampler('clamp_nearest_nomip'),
      renderStates,
      0,
      srgbOutput
    );
  }
  /**
   * Draws a fullscreen quad
   * @param renderStateSet - Render states that will be used when drawing the fullscreen quad.
   */
  protected drawFullscreenQuad(renderStateSet?: RenderStateSet) {
    drawFullscreenQuad(renderStateSet);
  }
  /** @internal */
  protected createVertexLayout(device: AbstractDevice) {
    return device.createVertexLayout({
      vertexBuffers: [
        {
          buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))!
        }
      ]
    });
  }
  protected onDispose() {
    super.onDispose();
    this.destroy();
  }
  /** @internal */
  protected createRenderStates(device: AbstractDevice) {
    const renderStates = device.createRenderStateSet();
    renderStates.useRasterizerState().setCullMode('none');
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    return renderStates;
  }
  /** @internal */
  protected destroy() {}
  /** @internal */
  static getDefaultRenderState(ctx: DrawContext, compareFunc: CompareFunc) {
    let renderState = this._defaultRenderStates[compareFunc as keyof typeof this._defaultRenderStates];
    if (!renderState) {
      renderState = ctx.device.createRenderStateSet();
      renderState.useRasterizerState().setCullMode('none');
      renderState
        .useDepthState()
        .enableTest(compareFunc !== 'always')
        .enableWrite(false)
        .setCompareFunc(compareFunc);
      this._defaultRenderStates[compareFunc as keyof typeof this._defaultRenderStates] = renderState;
    }
    return renderState;
  }
}
