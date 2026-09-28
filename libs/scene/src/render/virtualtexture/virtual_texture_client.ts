import type { Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../drawable';
import type { RenderQueue } from '../render_queue';
import type { VirtualTexture } from './virtual_texture';

/**
 * A user of a {@link VirtualTexture} registered with a scene
 * ({@link Scene.addVirtualTextureClient}).
 *
 * Every camera rendering the scene runs, after its depth prepass and before its light pass:
 * {@link VirtualTextureClient.markFromDepth} for every active client, then
 * {@link VirtualTexture.update} with the device frame counter as stamp, then
 * {@link VirtualTextureClient.fill}. Pages marked from this camera's depth are mapped and filled
 * before it shades (UE VSM: mark from the current frame's depth, then manage physical pages,
 * then render pages, all before the lights).
 *
 * Cameras share the client's pool. They share the stamp too, like UE's SceneFrameNumber: a page
 * requested by one camera has age 0 in the next camera's update, so it stays in use and cannot
 * be given away within the frame. Each update has its own fill budget.
 *
 * Requests marked while shading (fragment shader marking) are taken by the next update, one
 * camera or one frame later.
 *
 * WebGPU only.
 * @public
 */
export interface VirtualTextureClient {
  /** The virtual texture, owned by the client */
  readonly virtualTexture: VirtualTexture;
  /**
   * Whether the texture is used by this camera's frame. Inactive clients are skipped: no
   * marking, no update, no fill. Defaults to active.
   */
  isActive?(ctx: DrawContext, renderQueue: RenderQueue): boolean;
  /**
   * Marks the pages this camera needs from its depth prepass, with compute passes calling
   * {@link VirtualTexture.request}. Runs outside of render passes.
   * @param linearDepth - The camera's linear depth, depth / far in the red channel
   */
  markFromDepth?(ctx: DrawContext, linearDepth: Texture2D): void;
  /**
   * Fills the pages mapped by the update that just ran, usually with
   * {@link VirtualTexture.fill}. Runs outside of render passes.
   */
  fill(ctx: DrawContext): void;
}
