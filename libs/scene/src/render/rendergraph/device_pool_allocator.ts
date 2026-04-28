import type { Texture2D } from '@zephyr3d/device';
import type { RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';
import { getDevice } from '../../app/api';

/**
 * Bridges the render graph's {@link RGTextureAllocator} interface to the
 * engine's device resource pool (`device.pool`).
 *
 * Transient textures are fetched from the pool on {@link allocate} and
 * returned to the pool on {@link release}, enabling automatic reuse
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
export class DevicePoolAllocator implements RGTextureAllocator<Texture2D> {
  /**
   * Allocate a transient texture from the device pool.
   *
   * @param desc - Texture descriptor from the render graph pass.
   * @param size - Resolved pixel dimensions.
   * @returns A pooled Texture2D instance.
   */
  allocate(desc: RGTextureDesc, size: RGResolvedSize): Texture2D {
    const device = getDevice();
    const mipmapping = (desc.mipLevels ?? 1) > 1;
    return device.pool.fetchTemporalTexture2D(false, desc.format, size.width, size.height, mipmapping);
  }

  /**
   * Release a transient texture back to the device pool.
   *
   * @param texture - The texture to release.
   */
  release(texture: Texture2D): void {
    const device = getDevice();
    device.pool.releaseTexture(texture);
  }
}
