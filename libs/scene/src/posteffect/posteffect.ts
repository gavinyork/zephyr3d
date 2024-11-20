import type { AbstractDevice, RenderStateSet, Texture2D, VertexLayout } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { copyTexture, fetchSampler } from '../utility/misc';

/**
 * Base class for any type of post effect
 * @public
 */
export abstract class AbstractPostEffect<ClassName extends string> {
  static readonly className: string;
  private static _renderStateZTestGreater: RenderStateSet = null;
  private static _renderStateZTestEqual: RenderStateSet = null;
  protected _outputTexture: Texture2D;
  protected _quadVertexLayout: VertexLayout;
  protected _quadRenderStateSet: RenderStateSet;
  protected _enabled: boolean;
  protected _opaque: boolean;
  /**
   * Creates an instance of a post effect
   * @param name - Name of the post effect
   */
  constructor() {
    this._outputTexture = null;
    this._quadVertexLayout = null;
    this._quadRenderStateSet = null;
    this._enabled = true;
    this._opaque = false;
  }
  /** Gets class name of this instance */
  getClassName(): ClassName {
    return (this.constructor as any).className as ClassName;
  }
  /** Whether this post effect is enabled */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(val: boolean) {
    this._enabled = !!val;
  }
  /** Whether this post effect will be rendered at opaque phase */
  get opaque(): boolean {
    return this._opaque;
  }
  /**
   * Check if the post effect should be rendered upside down.
   * @param device - The device object
   * @returns true if the post effect should be rendered upside down
   */
  needFlip(device: AbstractDevice): boolean {
    return device.type === 'webgpu' && !!device.getFramebuffer();
  }
  /**
   * Checks whether this post effect requires the linear depth texture
   * @returns true if the linear depth texture is required.
   */
  abstract requireLinearDepthTexture(ctx: DrawContext): boolean;
  /**
   * Checks whether this post effect requires the scene depth buffer
   * @returns true if the scene depth buffer is required.
   */
  abstract requireDepthAttachment(ctx: DrawContext): boolean;
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
  abstract apply(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    srgbOutput: boolean
  ): void;
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
      ctx.device.getFramebuffer(),
      fetchSampler('clamp_nearest_nomip'),
      renderStates,
      0,
      srgbOutput
    );
  }
  /**
   * Disposes the post effect.
   */
  dispose() {
    this._quadVertexLayout?.dispose();
    this._quadVertexLayout = null;
    this._quadRenderStateSet = null;
  }
  /**
   * Draws a fullscreen quad
   * @param renderStateSet - Render states that will be used when drawing the fullscreen quad.
   */
  protected drawFullscreenQuad(renderStateSet?: RenderStateSet) {
    drawFullscreenQuad(renderStateSet);
    /*
    const device = Application.instance.device;
    if (!this._quadVertexLayout) {
      this._quadVertexLayout = this.createVertexLayout(device);
    }
    if (!this._quadRenderStateSet) {
      this._quadRenderStateSet = this.createRenderStates(device);
    }
    const lastRenderState = device.getRenderStates();
    device.setVertexLayout(this._quadVertexLayout);
    device.setRenderStates(renderStateSet ?? this._quadRenderStateSet);
    device.draw('triangle-strip', 0, 4);
    device.setRenderStates(lastRenderState);
    */
  }
  /** @internal */
  protected createVertexLayout(device: AbstractDevice): VertexLayout {
    return device.createVertexLayout({
      vertexBuffers: [
        {
          buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
        }
      ]
    });
  }
  /** @internal */
  protected createRenderStates(device: AbstractDevice): RenderStateSet {
    const renderStates = device.createRenderStateSet();
    renderStates.useRasterizerState().setCullMode('none');
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    return renderStates;
  }
  /** @internal */
  protected static getZTestGreaterRenderState(ctx: DrawContext): RenderStateSet {
    if (!this._renderStateZTestGreater) {
      this._renderStateZTestGreater = ctx.device.createRenderStateSet();
      this._renderStateZTestGreater.useRasterizerState().setCullMode('none');
      this._renderStateZTestGreater.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('gt');
    }
    return this._renderStateZTestGreater;
  }
  /** @internal */
  protected static getZTestEqualRenderState(ctx: DrawContext): RenderStateSet {
    if (!this._renderStateZTestEqual) {
      this._renderStateZTestEqual = ctx.device.createRenderStateSet();
      this._renderStateZTestEqual.useRasterizerState().setCullMode('none');
      this._renderStateZTestEqual.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('eq');
    }
    return this._renderStateZTestEqual;
  }
}
