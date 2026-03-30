import type { RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';

/**
 * Manages cross-frame history resources with automatic ping-pong buffering.
 *
 * History resources are textures that persist across frames for temporal effects
 * like TAA, motion blur, or temporal upscaling. The manager maintains two copies
 * of each resource and automatically swaps them at frame boundaries.
 *
 * Usage:
 * ```ts
 * const historyMgr = new HistoryResourceManager(allocator);
 *
 * // Register a history resource (typically once at initialization)
 * historyMgr.register('taaHistory', {
 *   format: TextureFormat.RGBA16F,
 *   width: 1920,
 *   height: 1080
 * }, { width: 1920, height: 1080 });
 *
 * // In your render pass:
 * const prevFrame = historyMgr.getPrevious('taaHistory');  // Read from previous frame
 * const currentFrame = historyMgr.getCurrent('taaHistory'); // Write to current frame
 *
 * // At frame end:
 * historyMgr.swap();  // Swap current and previous
 * ```
 *
 * @typeParam TTexture - The concrete texture type (e.g. `Texture2D`).
 * @public
 */
export class HistoryResourceManager<TTexture = unknown> {
  private _resources: Map<string, TTexture[]> = new Map();
  private _allocator: RGTextureAllocator<TTexture>;
  private _frameIndex = 0;

  /**
   * Create a new history resource manager.
   *
   * @param allocator - Texture allocator for creating history textures.
   */
  constructor(allocator: RGTextureAllocator<TTexture>) {
    this._allocator = allocator;
  }

  /**
   * Register a new history resource with ping-pong buffering.
   *
   * Allocates two textures matching the given descriptor. If a resource
   * with the same name already exists, this is a no-op.
   *
   * @param name - Unique identifier for this history resource.
   * @param desc - Texture descriptor (format, size, etc.).
   * @param size - Resolved pixel dimensions.
   */
  register(name: string, desc: RGTextureDesc, size: RGResolvedSize): void {
    if (!this._resources.has(name)) {
      const tex0 = this._allocator.allocate(desc, size);
      const tex1 = this._allocator.allocate(desc, size);
      this._resources.set(name, [tex0, tex1]);
    }
  }

  /**
   * Register a new history resource with an existing texture (zero-copy).
   *
   * This is more efficient than register() + updateCurrent() for first-frame setup,
   * as it avoids allocating dummy textures that are immediately replaced.
   *
   * @param name - Unique identifier for this history resource.
   * @param desc - Texture descriptor (format, size, etc.).
   * @param size - Resolved pixel dimensions.
   * @param initialTexture - The initial texture to use as current frame.
   */
  registerWithTexture(name: string, desc: RGTextureDesc, size: RGResolvedSize, initialTexture: TTexture): void {
    if (!this._resources.has(name)) {
      // Allocate only one texture for the "previous" slot
      const prevTexture = this._allocator.allocate(desc, size);
      // Use the provided texture as "current"
      this._resources.set(name, [initialTexture, prevTexture]);
    }
  }

  /**
   * Get the current frame's texture for a history resource.
   *
   * This is typically used as the write target in render passes.
   *
   * @param name - Name of the history resource.
   * @returns The current frame's texture.
   * @throws If the resource has not been registered.
   */
  getCurrent(name: string): TTexture {
    const textures = this._resources.get(name);
    if (!textures) {
      throw new Error(`History resource '${name}' not found. Did you forget to call register()?`);
    }
    return textures[this._frameIndex % 2];
  }

  /**
   * Get the previous frame's texture for a history resource.
   *
   * This is typically used as a read input in temporal effects like TAA.
   *
   * @param name - Name of the history resource.
   * @returns The previous frame's texture.
   * @throws If the resource has not been registered.
   */
  getPrevious(name: string): TTexture {
    const textures = this._resources.get(name);
    if (!textures) {
      throw new Error(`History resource '${name}' not found. Did you forget to call register()?`);
    }
    return textures[(this._frameIndex + 1) % 2];
  }

  /**
   * Check if a history resource exists.
   *
   * @param name - Name of the history resource.
   * @returns True if the resource has been registered.
   */
  has(name: string): boolean {
    return this._resources.has(name);
  }

  /**
   * Unregister a history resource and release its textures.
   *
   * @param name - Name of the history resource to remove.
   * @returns True if the resource was found and removed.
   */
  unregister(name: string): boolean {
    const textures = this._resources.get(name);
    if (textures) {
      textures.forEach((tex) => this._allocator.release(tex));
      this._resources.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Swap current and previous textures for all history resources.
   *
   * Call this at the end of each frame to advance the ping-pong buffers.
   * After swapping, what was "current" becomes "previous" for the next frame.
   */
  swap(): void {
    this._frameIndex++;
  }

  /**
   * Release all history resources and clear the manager.
   *
   * Call this when disposing the render context or when history is no longer needed.
   */
  dispose(): void {
    for (const textures of this._resources.values()) {
      textures.forEach((tex) => this._allocator.release(tex));
    }
    this._resources.clear();
    this._frameIndex = 0;
  }

  /**
   * Update the current frame's texture with an external texture (for zero-copy workflows).
   *
   * This is useful when you want to use the output of a render pass directly as history,
   * without copying. The manager will release the old texture and use the new one.
   *
   * @param name - Name of the history resource.
   * @param texture - The new texture to use as current frame.
   */
  updateCurrent(name: string, texture: TTexture): void {
    const textures = this._resources.get(name);
    if (!textures) {
      throw new Error(`History resource '${name}' not found. Did you forget to call register()?`);
    }

    // Release the old current texture
    const oldTexture = textures[this._frameIndex % 2];
    this._allocator.release(oldTexture);

    // Replace with new texture
    textures[this._frameIndex % 2] = texture;
  }

  /**
   * Get the number of registered history resources.
   */
  get size(): number {
    return this._resources.size;
  }
}
