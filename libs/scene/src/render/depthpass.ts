import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_DEPTH } from '../values';
import type { RenderQueue } from './render_queue';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import type { Camera } from '../camera';

/**
 * Depth render pass
 *
 * Scene depth render pass
 *
 * @public
 */
export class DepthPass extends RenderPass {
  private _renderBackface: boolean;
  private _encodeDepth: boolean;
  private _transmission: boolean;
  private _motionVectorOnly: boolean;
  /**
   * Creates an instance of DepthRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_DEPTH);
    this._renderBackface = false;
    this._encodeDepth = false;
    this._transmission = false;
    this._motionVectorOnly = false;
  }
  /**
   * Draws the transparent queue for its motion vectors alone.
   *
   * @remarks
   * Blended geometry is absent from the ordinary prepass, so it contributes no
   * velocity and a temporal filter reprojects it with whatever is behind it -
   * which for hair swinging in front of a still background means reprojecting it
   * as if it were still. This mode fills that in: same pass, same shaders, but
   * the framebuffer carries the motion vector attachment only, nothing writes
   * depth, and materials that have not opted in discard.
   *
   * It cannot be exact. One velocity per pixel cannot describe several blended
   * layers, so the value that survives is whichever fragment landed last rather
   * than the nearest. For hair that is the same approximation the dithered path
   * already makes - dither keeps one arbitrary strand per pixel - which is why
   * it holds up there and why it stays opt-in rather than applying to every
   * transparent material.
   */
  get motionVectorOnly() {
    return this._motionVectorOnly;
  }
  set motionVectorOnly(val: boolean) {
    this._motionVectorOnly = !!val;
  }
  get transmission() {
    return this._transmission;
  }
  set transmission(val: boolean) {
    this._transmission = val;
  }
  get renderBackface() {
    return this._renderBackface;
  }
  set renderBackface(val) {
    this._renderBackface = !!val;
  }
  get encodeDepth() {
    return this._encodeDepth;
  }
  set encodeDepth(val) {
    this._encodeDepth = !!val;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `${Number(this._renderBackface)}:${Number(this._encodeDepth)}:${Number(
      ctx.motionVectors
    )}:${Number(this._motionVectorOnly)}`;
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderCamera: Camera, renderQueue: RenderQueue) {
    const items = renderQueue.itemList;
    if (items) {
      ctx.drawEnvLight = false;
      ctx.env = null;
      ctx.flip = this.isAutoFlip(ctx);
      ctx.renderPassHash = this.getGlobalBindGroupHash(ctx, renderCamera);
      const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
      ctx.device.setBindGroup(0, bindGroup);
      ShaderHelper.setCameraUniforms(bindGroup, ctx, renderCamera, true);
      const reverseWinding = ctx.camera.worldMatrixDet < 0;
      const list = this._motionVectorOnly
        ? items.transparent
        : this._transmission
          ? items.transmission
          : items.opaque;
      for (const lit of list.lit) {
        this.drawItemList(lit, ctx, reverseWinding);
      }
      for (const unlit of list.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
    }
  }
}
