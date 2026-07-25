import type { FrameBuffer, Texture2D, Texture2DArray, TextureFormat, AbstractDevice } from '@zephyr3d/device';
import type { RGFramebufferDesc, RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';
import { getDevice } from '../../app/api';
import type { Nullable } from '@zephyr3d/base';

/** Render graph allocator backed by the device resource pool. @public */
export class DevicePoolAllocator implements RGTextureAllocator<Texture2D, FrameBuffer> {
  private _device: Nullable<AbstractDevice>;
  /** Create an allocator using the given device or the global device. */
  constructor(device?: AbstractDevice) {
    this._device = device ?? null;
  }
  /** Allocate a transient texture from the device pool. */
  allocate(desc: RGTextureDesc, size: RGResolvedSize, preferred?: Texture2D): Texture2D {
    const device = this._device ?? getDevice();
    const requestedMips = desc.mipLevels ?? 1;
    // The pool allocates either one mip or a full chain.
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
    // Any defined arrayLayers value requests Texture2DArray, including 1.
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

  /** Release a transient texture to the pool. */
  release(texture: Texture2D): void {
    const device = this._device ?? getDevice();
    device.pool.releaseTexture(texture);
  }

  /** Retain a pooled texture beyond graph execution. */
  retain(texture: Texture2D): void {
    const device = this._device ?? getDevice();
    device.pool.retainTexture(texture);
  }

  /** Allocate a temporary framebuffer from the pool. */
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

  /** Release a temporary framebuffer to the pool. */
  releaseFramebuffer(framebuffer: FrameBuffer): void {
    const device = this._device ?? getDevice();
    device.pool.releaseFrameBuffer(framebuffer);
  }
}
