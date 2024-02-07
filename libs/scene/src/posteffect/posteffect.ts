import { Application } from "../app";
import type { AbstractDevice, BaseTexture, FrameBuffer, RenderStateSet, Texture2D, TextureFormat, VertexLayout } from "@zephyr3d/device";
import type { DrawContext } from "../render";
import { drawFullscreenQuad } from "../render/helper";

/**
 * Base class for any type of post effect
 * @public
 */
export abstract class AbstractPostEffect {
  protected _outputTexture: Texture2D;
  protected _quadVertexLayout: VertexLayout;
  protected _quadRenderStateSet: RenderStateSet;
  protected _enabled: boolean;
  protected _opaque: boolean;
  protected _intermediateFramebuffers: {
    [name: string]: {
      framebuffer: FrameBuffer,
      depth: 'none'|'current'|'temporal'
    }
  }
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
    this._intermediateFramebuffers = {};
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
   * Adds an intermediate frame buffer
   * @param name - Name of the frame buffer
   * @param format - Render target texture format
   * @param useDepth - Whether the scene depth buffer should be attached to the frame buffer
   */
  protected addIntermediateFramebuffer(name: string, depth: 'none'|'current'|'temporal') {
    if (this._intermediateFramebuffers[name]) {
      throw new Error(`Intermediate framebuffer already exists: ${name}`);
    }
    this._intermediateFramebuffers[name] = {
      depth,
      framebuffer: null
    };
  }
  /**
   * Gets the intermediate frame buffer by name
   * @param name - Name of the intermediate frame buffer
   * @param width - Width of the frame buffer
   * @param height - Height of the frame buffer
   * @returns The intermediate frame buffer or null if not exists
   *
   * @remarks
   * The intemediate buffer will be resized to fit the given size if needed
   */
  protected getIntermediateFramebuffer(name: string, format: TextureFormat, width: number, height: number): FrameBuffer {
    const fb = this._intermediateFramebuffers[name];
    if (!fb) {
      return null;
    }
    const device = Application.instance.device;
    const currentDepthBuffer = device.getFramebuffer().getDepthAttachment();
    if (fb.framebuffer) {
      const colorTex = fb.framebuffer.getColorAttachments()[0];
      const depthTex = fb.framebuffer.getDepthAttachment();
      if (colorTex.width !== width || colorTex.height !== height || colorTex.format !== format) {
        fb.framebuffer.dispose();
        colorTex.dispose();
        if (depthTex && depthTex !== currentDepthBuffer) {
          depthTex.dispose();
        }
        fb.framebuffer = null;
      }
    }
    if (!fb.framebuffer) {
      const colorTex = device.createTexture2D(format, width, height, {
        samplerOptions: { mipFilter: 'none' }
      });
      colorTex.name = `Intermediate-<${name}>`
      let depthTex: BaseTexture = null;
      if (fb.depth === 'current') {
        depthTex = currentDepthBuffer;
      } else if (fb.depth === 'temporal') {
        depthTex = device.createTexture2D('d24s8', width, height);
        depthTex.name = `Intermediate-<${name}>-depth`;
      }
      fb.framebuffer = device.createFrameBuffer([colorTex], depthTex);
    }
    return fb.framebuffer;
  }
  /**
   * Checks whether this post effect requires the linear depth texture
   * @returns true if the linear depth texture is required.
   */
  abstract requireLinearDepthTexture(): boolean;
  /**
   * Checks whether this post effect requires the scene depth buffer
   * @returns true if the scene depth buffer is required.
   */
  abstract requireDepthAttachment(): boolean;
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
  abstract apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean): void;
  /**
   * Disposes the post effect.
   */
  dispose() {
    this._quadVertexLayout?.dispose();
    this._quadVertexLayout = null;
    this._quadRenderStateSet = null;
    for (const k in this._intermediateFramebuffers) {
      const fb = this._intermediateFramebuffers[k];
      if (fb) {
        const colorAttachment = fb.framebuffer.getColorAttachments()[0];
        fb.framebuffer.dispose();
        colorAttachment.dispose();
      }
    }
    this._intermediateFramebuffers = {};
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
      vertexBuffers: [{ buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])) }]
    });
  }
  /** @internal */
  protected createRenderStates(device: AbstractDevice): RenderStateSet {
    const renderStates = device.createRenderStateSet();
    renderStates.useRasterizerState().setCullMode('none');
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    return renderStates;
  }
}
