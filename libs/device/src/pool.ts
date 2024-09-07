import type { MaybeArray } from '@zephyr3d/base';
import type { AbstractDevice, TextureFormat } from './base_types';
import type { BaseTexture, FrameBuffer, Texture2D, Texture2DArray, TextureCube } from './gpuobject';

/**
 * ObjectPool class is responsible for managing and reusing textures and framebuffers.
 * @public
 */
export class Pool {
  /** @internal */
  private _memCost: number;
  /** @internal */
  private _memCostThreshold: number;
  /** @internal */
  private _device: AbstractDevice;
  /** @internal */
  private _freeTextures: Record<string, BaseTexture[]> = {};
  /** @internal */
  private _allocatedTextures: WeakMap<BaseTexture, { hash: string; refcount: number; dispose: boolean }> =
    new WeakMap();
  /** @internal */
  private _autoReleaseTextures: Set<BaseTexture> = new Set();
  /** @internal */
  private _freeFramebuffers: Record<string, FrameBuffer[]> = {};
  /** @internal */
  private _allocatedFramebuffers: WeakMap<FrameBuffer, string> = new WeakMap();
  /** @internal */
  private _autoReleaseFramebuffers: Set<FrameBuffer> = new Set();
  /**
   * Creates an instance of Pool class
   * @param device - Rendering device
   */
  constructor(device: AbstractDevice, memCostThreshold = 1024 * 1024 * 1024) {
    this._device = device;
    this._memCost = 0;
    this._memCostThreshold = memCostThreshold;
    this._freeTextures = {};
    this._allocatedTextures = new WeakMap();
    this._autoReleaseTextures = new Set();
    this._freeFramebuffers = {};
    this._allocatedFramebuffers = new WeakMap();
    this._autoReleaseFramebuffers = new Set();
    this._memCost = 0;
  }
  autoRelease() {
    // auto release objects
    for (const tex of this._autoReleaseTextures) {
      this.releaseTexture(tex);
    }
    this._autoReleaseTextures.clear();
    for (const fb of this._autoReleaseFramebuffers) {
      this.releaseFrameBuffer(fb);
    }
    this._autoReleaseFramebuffers.clear();
    // Free up video memory if memory usage is greater than specific value
    if (this._memCost >= this._memCostThreshold) {
      this.purge();
    }
  }
  /**
   * Fetch a temporal 2D texture from the object pool.
   * @param autoRelease - Whether the texture should be automatically released at the next frame.
   * @param format - The format of the texture.
   * @param width - The width of the texture.
   * @param height - The height of the texture.
   * @param mipmapping - Whether this texture support mipmapping
   * @returns The fetched Texture2D object.
   */
  fetchTemporalTexture2D(
    autoRelease: boolean,
    format: TextureFormat,
    width: number,
    height: number,
    mipmapping: boolean
  ): Texture2D {
    const hash = `2d:${format}:${width}:${height}:${mipmapping ? 1 : 0}`;
    let texture: BaseTexture = null;
    const list = this._freeTextures[hash];
    if (!list) {
      texture = this._device.createTexture2D(
        format,
        width,
        height,
        mipmapping ? {} : { samplerOptions: { mipFilter: 'none' } }
      );
      this._memCost += texture.memCost;
    } else {
      texture = list.pop();
      if (list.length === 0) {
        delete this._freeTextures[hash];
      }
    }
    this._allocatedTextures.set(texture, { hash, refcount: 1, dispose: false });
    if (autoRelease) {
      this._autoReleaseTextures.add(texture);
    }
    return texture as Texture2D;
  }
  /**
   * Fetch a temporal 2D array texture from the object pool.
   * @param autoRelease - Whether the texture should be automatically released at the next frame.
   * @param format - Format of the texture.
   * @param width - Width of the texture.
   * @param height - Height of the texture.
   * @param numLayers - Layer count of the texture
   * @param mipmapping - Whether this texture support mipmapping
   * @returns The fetched Texture2DArray object.
   */
  fetchTemporalTexture2DArray(
    autoRelease: boolean,
    format: TextureFormat,
    width: number,
    height: number,
    numLayers: number,
    mipmapping: boolean
  ): Texture2DArray {
    const hash = `2darray:${format}:${width}:${height}:${numLayers}:${mipmapping ? 1 : 0}`;
    let texture: BaseTexture = null;
    const list = this._freeTextures[hash];
    if (!list) {
      texture = this._device.createTexture2DArray(
        format,
        width,
        height,
        numLayers,
        mipmapping ? {} : { samplerOptions: { mipFilter: 'none' } }
      );
      this._memCost += texture.memCost;
    } else {
      texture = list.pop();
      if (list.length === 0) {
        delete this._freeTextures[hash];
      }
    }
    this._allocatedTextures.set(texture, { hash, refcount: 1, dispose: false });
    if (autoRelease) {
      this._autoReleaseTextures.add(texture);
    }
    return texture as Texture2DArray;
  }
  /**
   * Fetch a temporal Cube texture from the object pool.
   * @param autoRelease - Whether the texture should be automatically released at the next frame.
   * @param format - Format of the texture.
   * @param size - size of the texture.
   * @param mipmapping - Whether this texture support mipmapping
   * @returns The fetched TextureCube object.
   */
  fetchTemporalTextureCube(
    autoRelease: boolean,
    format: TextureFormat,
    size: number,
    mipmapping: boolean
  ): TextureCube {
    const hash = `cube:${format}:${size}:${mipmapping ? 1 : 0}`;
    let texture: BaseTexture = null;
    const list = this._freeTextures[hash];
    if (!list) {
      texture = this._device.createCubeTexture(
        format,
        size,
        mipmapping ? {} : { samplerOptions: { mipFilter: 'none' } }
      );
      this._memCost += texture.memCost;
    } else {
      texture = list.pop();
      if (list.length === 0) {
        delete this._freeTextures[hash];
      }
    }
    this._allocatedTextures.set(texture, { hash, refcount: 1, dispose: false });
    if (autoRelease) {
      this._autoReleaseTextures.add(texture);
    }
    return texture as TextureCube;
  }
  fetchTemporalFramebuffer<T extends BaseTexture<unknown>>(
    autoRelease: boolean,
    width: number,
    height: number,
    colorTexOrFormat: MaybeArray<TextureFormat | T>,
    depthTexOrFormat?: TextureFormat | T,
    mipmapping?: boolean,
    sampleCount?: number,
    ignoreDepthStencil?: boolean
  ): FrameBuffer {
    const colors = Array.isArray(colorTexOrFormat)
      ? colorTexOrFormat
      : colorTexOrFormat
      ? [colorTexOrFormat]
      : [];
    const colorAttachments = colors.map((val) => {
      return typeof val === 'string'
        ? this.fetchTemporalTexture2D(false, val, width, height, mipmapping)
        : val;
    });
    const depthAttachment =
      typeof depthTexOrFormat === 'string'
        ? this.fetchTemporalTexture2D(false, depthTexOrFormat, width, height, false)
        : depthTexOrFormat;
    const fb = this.createTemporalFramebuffer(
      autoRelease,
      colorAttachments,
      depthAttachment,
      sampleCount,
      ignoreDepthStencil
    );
    for (let i = 0; i < colors.length; i++) {
      if (typeof colors[i] === 'string') {
        this.releaseTexture(colorAttachments[i]);
      }
    }
    if (typeof depthTexOrFormat === 'string') {
      this.releaseTexture(depthAttachment);
    }
    return fb;
  }
  /**
   * Creates a temporal framebuffer from the object pool.
   * @param autoRelease - Whether the framebuffer should be automatically released at the next frame.
   * @param colorAttachments - Array of color attachments for the framebuffer.
   * @param depthAttachment - Depth attachment for the framebuffer.
   * @param sampleCount - The sample count for the framebuffer.
   * @param ignoreDepthStencil - Whether to ignore depth stencil.
   * @returns The fetched FrameBuffer object.
   */
  createTemporalFramebuffer(
    autoRelease: boolean,
    colorAttachments: BaseTexture[],
    depthAttachment?: BaseTexture,
    sampleCount?: number,
    ignoreDepthStencil?: boolean
  ) {
    colorAttachments = colorAttachments ?? [];
    let hash = `${depthAttachment?.uid ?? 0}:${sampleCount ?? 1}:${ignoreDepthStencil ? 1 : 0}`;
    for (const tex of colorAttachments) {
      hash += `:${tex.uid}`;
    }
    let fb: FrameBuffer = null;
    const list = this._freeFramebuffers[hash];
    if (!list) {
      fb = this._device.createFrameBuffer(colorAttachments, depthAttachment, {
        ignoreDepthStencil,
        sampleCount
      });
    } else {
      fb = list.pop();
      if (list.length === 0) {
        delete this._freeFramebuffers[hash];
      }
    }
    // Mark referenced textures
    const info = this._allocatedTextures.get(depthAttachment);
    if (info) {
      info.refcount++;
    }
    for (const tex of colorAttachments) {
      const info = this._allocatedTextures.get(tex);
      if (info) {
        info.refcount++;
      }
    }
    this._allocatedFramebuffers.set(fb, hash);
    if (autoRelease) {
      this._autoReleaseFramebuffers.add(fb);
    }
    return fb;
  }
  /**
   * Dispose a texture that is allocated from the object pool.
   * @param texture - The texture to dispose.
   */
  disposeTexture(texture: BaseTexture): void {
    this.safeReleaseTexture(texture, true);
  }
  /**
   * Release a texture back to the object pool.
   * @param texture - The texture to release.
   */
  releaseTexture(texture: BaseTexture): void {
    const info = this._allocatedTextures.get(texture);
    if (!info) {
      console.error(`ObjectPool.releaseTexture(): texture is not allocated from pool`);
    } else {
      this.safeReleaseTexture(texture);
    }
  }
  /**
   * Dispose a framebuffer that is allocated from the object pool.
   * @param fb - The framebuffer to dispose.
   */
  disposeFrameBuffer(fb: FrameBuffer) {
    const hash = this._allocatedFramebuffers.get(fb);
    if (!hash) {
      console.error(`ObjectPool.disposeFrameBuffer(): framebuffer is not allocated from pool`);
    } else {
      this.internalDisposeFrameBuffer(fb);
      fb.dispose();
    }
  }
  /**
   * Release a framebuffer back to the object pool.
   * @param fb - The framebuffer to release.
   */
  releaseFrameBuffer(fb: FrameBuffer) {
    const hash = this._allocatedFramebuffers.get(fb);
    if (!hash) {
      console.error(`ObjectPool.releaseFrameBuffer(): framebuffer is not allocated from pool`);
    } else {
      this.internalDisposeFrameBuffer(fb);
      const list = this._freeFramebuffers[hash];
      if (list) {
        list.push(fb);
      } else {
        this._freeFramebuffers[hash] = [fb];
      }
    }
  }
  /**
   * Purge the object pool by disposing all free framebuffers and textures.
   */
  purge() {
    for (const k in this._freeFramebuffers) {
      const list = this._freeFramebuffers[k];
      if (list) {
        for (const fb of this._freeFramebuffers[k]) {
          this.internalDisposeFrameBuffer(fb);
          fb.dispose();
        }
      }
    }
    this._freeFramebuffers = {};
    for (const k in this._freeTextures) {
      const list = this._freeTextures[k];
      for (const tex of list) {
        this._memCost -= tex.memCost;
        tex.dispose();
      }
    }
    this._freeTextures = {};
  }
  /** @internal */
  private internalDisposeFrameBuffer(fb: FrameBuffer) {
    if (fb) {
      // Release attachment textures
      const colorAttachments = fb.getColorAttachments();
      if (colorAttachments) {
        for (const tex of colorAttachments) {
          this.safeReleaseTexture(tex);
        }
      }
      const depthAttachment = fb.getDepthAttachment();
      if (depthAttachment) {
        this.safeReleaseTexture(depthAttachment);
      }
      this._allocatedFramebuffers.delete(fb);
      this._autoReleaseFramebuffers.delete(fb);
    }
  }
  /** @internal */
  private safeReleaseTexture(texture: BaseTexture, purge = false) {
    const info = this._allocatedTextures.get(texture);
    if (info) {
      info.refcount--;
      if (info.refcount === 0) {
        this._allocatedTextures.delete(texture);
        this._autoReleaseTextures.delete(texture);
        if (purge || info.dispose) {
          this._memCost -= texture.memCost;
          texture.dispose();
        } else {
          const list = this._freeTextures[info.hash];
          if (list) {
            list.push(texture);
          } else {
            this._freeTextures[info.hash] = [texture];
          }
        }
      } else if (purge) {
        info.dispose = true;
      }
    }
  }
}
