import type { FrameBuffer, Texture2D, TextureFormat, AbstractDevice } from '@zephyr3d/device';
import type { RGFramebufferDesc, RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';
import { getDevice } from '../../app/api';
import type { Nullable } from '@zephyr3d/base';

/**
 * Bridges the render graph's {@link RGTextureAllocator} interface to the
 * engine's device resource pool (`device.pool`).
 *
 * Transient textures are fetched from the pool on `allocate()` and
 * returned to the pool on `release()`, enabling automatic reuse
 * across frames without manual lifecycle management.
 *
 * Usage:
 * ```ts
 * const allocator = new DevicePoolAllocator();
 * const executor = new RenderGraphExecutor(allocator, width, height);
 * ```
 *
 * @public
 */
export class DevicePoolAllocator implements RGTextureAllocator<Texture2D, FrameBuffer> {
  private _device: Nullable<AbstractDevice>;
  /**
   * Creates a new instance of the DevicePoolAllocator.
   * @param device - Optional device instance to use for resource allocation. If not provided, the global device will be used.
   */
  constructor(device?: AbstractDevice) {
    this._device = device ?? null;
  }
  /**
   * Allocate a transient texture from the device pool.
   *
   * @param desc - Texture descriptor from the render graph pass.
   * @param size - Resolved pixel dimensions.
   * @returns A pooled Texture2D instance.
   */
  allocate(desc: RGTextureDesc, size: RGResolvedSize): Texture2D {
    const device = this._device ?? getDevice();
    const mipmapping = (desc.mipLevels ?? 1) > 1;
    const texture = device.pool.fetchTemporalTexture2D(
      false,
      desc.format,
      size.width,
      size.height,
      mipmapping
    );
    if (desc.mipLevels && texture.mipLevelCount < desc.mipLevels) {
      device.pool.releaseTexture(texture);
      throw new Error(
        `DevicePoolAllocator: texture "${desc.label ?? '<unnamed>'}" requested ${desc.mipLevels} ` +
          `mip levels, but only ${texture.mipLevelCount} were allocated.`
      );
    }
    return texture;
  }

  /**
   * Release a transient texture back to the device pool.
   *
   * @param texture - The texture to release.
   */
  release(texture: Texture2D): void {
    const device = this._device ?? getDevice();
    device.pool.releaseTexture(texture);
  }

  /**
   * Retain a pooled texture so it can be owned outside the graph lifetime.
   *
   * @param texture - The texture to retain.
   */
  retain(texture: Texture2D): void {
    const device = this._device ?? getDevice();
    device.pool.retainTexture(texture);
  }

  /**
   * Allocate a temporary framebuffer from the device pool.
   *
   * @param desc - Framebuffer descriptor from the render graph pass.
   * @returns A pooled FrameBuffer instance.
   */
  allocateFramebuffer(desc: RGFramebufferDesc): FrameBuffer {
    const device = this._device ?? getDevice();
    const colors = Array.isArray(desc.colorAttachments)
      ? (desc.colorAttachments as Array<Texture2D | TextureFormat>)
      : desc.colorAttachments
        ? [desc.colorAttachments as Texture2D | TextureFormat]
        : [];
    const depthAttachment = (desc.depthAttachment ?? null) as Texture2D | TextureFormat | null;
    return device.pool.fetchTemporalFramebuffer(
      false,
      desc.width ?? 0,
      desc.height ?? 0,
      colors,
      depthAttachment,
      desc.mipmapping ?? false,
      desc.sampleCount ?? 1,
      desc.ignoreDepthStencil ?? true,
      desc.attachmentMipLevel ?? 0,
      desc.attachmentCubeface ?? 0,
      desc.attachmentLayer ?? 0
    );
  }

  /**
   * Release a temporary framebuffer back to the device pool.
   *
   * @param framebuffer - The framebuffer to release.
   */
  releaseFramebuffer(framebuffer: FrameBuffer): void {
    const device = this._device ?? getDevice();
    device.pool.releaseFrameBuffer(framebuffer);
  }
}
