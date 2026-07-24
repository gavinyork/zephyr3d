import type { FrameBuffer, Texture2D, Texture2DArray, TextureFormat, AbstractDevice } from '@zephyr3d/device';
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
  allocate(desc: RGTextureDesc, size: RGResolvedSize, preferred?: Texture2D): Texture2D {
    const device = this._device ?? getDevice();
    const requestedMips = desc.mipLevels ?? 1;
    // The device pool only exposes a boolean `mipmapping` flag (full chain or
    // none), so a request for a specific mip count can only be satisfied when it
    // does not exceed the physical maximum for this size. Reject over-requests up
    // front with the offending dimensions rather than after a wasted allocation.
    if (requestedMips > 1) {
      const maxMips = Math.max(1, Math.floor(Math.log2(Math.max(1, size.width, size.height))) + 1);
      if (requestedMips > maxMips) {
        throw new Error(
          `DevicePoolAllocator: texture "${desc.label ?? '<unnamed>'}" requested ${requestedMips} ` +
            `mip levels, but a ${size.width}x${size.height} texture supports at most ${maxMips}.`
        );
      }
    }
    const mipmapping = requestedMips > 1;
    const arrayLayers = desc.arrayLayers;
    // A defined arrayLayers (even 1) requests a 2D array texture — a single-layer
    // array is a distinct texture type from a plain 2D texture, and the two are
    // not interchangeable when bound to a tex2DArray sampler. Array textures are
    // fetched as Texture2DArray. The render graph's TTexture channel is nominally
    // Texture2D (see forward_plus_builder's executor annotation); TS types are
    // erased at runtime, every pool op below accepts BaseTexture, so the cast is
    // safe. Passes resolve the real type via getTexture<Texture2DArray>().
    // Individual layers are targeted through RGFramebufferDesc.attachmentLayer.
    const texture =
      arrayLayers !== undefined
        ? (device.pool.fetchTemporalTexture2DArray(
            false,
            desc.format,
            size.width,
            size.height,
            arrayLayers,
            mipmapping,
            preferred as unknown as Texture2DArray
          ) as unknown as Texture2D)
        : device.pool.fetchTemporalTexture2D(
            false,
            desc.format,
            size.width,
            size.height,
            mipmapping,
            preferred
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
