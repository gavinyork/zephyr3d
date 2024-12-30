import type { MaybeArray, TypedArray } from '@zephyr3d/base';
import type { AbstractDevice, GPUProgramConstructParams, TextureFormat } from './base_types';
import type {
  BaseTexture,
  BindGroup,
  BindGroupLayout,
  BufferCreationOptions,
  FrameBuffer,
  FrameBufferOptions,
  GPUDataBuffer,
  GPUObject,
  GPUProgram,
  IndexBuffer,
  SamplerOptions,
  StructuredBuffer,
  Texture2D,
  Texture2DArray,
  Texture3D,
  TextureCreationOptions,
  TextureCube,
  TextureImageElement,
  TextureMipmapData,
  TextureVideo,
  VertexAttribFormat,
  VertexLayout,
  VertexLayoutOptions
} from './gpuobject';
import type { PBStructTypeInfo } from './builder';

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
  private _id: string | symbol;
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
  private _allocatedFramebuffers: WeakMap<FrameBuffer, { hash: string; refcount: number }> = new WeakMap();
  /** @internal */
  private _autoReleaseFramebuffers: Set<FrameBuffer> = new Set();
  /** @internal */
  private _allocatedObjects: Set<GPUObject>;
  /**
   * Creates an instance of Pool class
   * @param device - Rendering device
   */
  constructor(device: AbstractDevice, id: string | symbol, memCostThreshold = 1024 * 1024 * 1024) {
    this._device = device;
    this._id = id;
    this._memCost = 0;
    this._memCostThreshold = memCostThreshold;
    this._freeTextures = {};
    this._allocatedTextures = new WeakMap();
    this._autoReleaseTextures = new Set();
    this._freeFramebuffers = {};
    this._allocatedFramebuffers = new WeakMap();
    this._autoReleaseFramebuffers = new Set();
    this._allocatedObjects = new Set();
    this._memCost = 0;
  }
  /**
   * Id for this pool
   */
  get id() {
    return this._id;
  }
  /**
   * Dispose objects created by createXXXX methods.
   */
  disposeNonCachedObjects() {
    for (const obj of this._allocatedObjects) {
      obj.dispose();
    }
    this._allocatedObjects.clear();
  }
  /**
   * Dispose object created by createXXXX methods.
   * @param object - Object to be disposed
   */
  disposeNonCachedObject(obj: GPUObject) {
    if (this._allocatedObjects.has(obj)) {
      obj.dispose();
      this._allocatedObjects.delete(obj);
    }
  }
  /**
   * Creates a texture from given mipmap data and stores it in this pool
   * @param data - Mipmap data
   * @param options - Texture creation options
   * @returns The created texture
   */
  createTextureFromMipmapData<T extends BaseTexture>(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): T {
    const tex = this._device.createTextureFromMipmapData<T>(data, sRGB, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a 2D texture and stores it in this pool
   * @param format - The texture format
   * @param width - Pixel width of the texture
   * @param height - Pixel height of the texture
   * @param options - The creation options
   * @returns The created 2D texture
   */
  createTexture2D(
    format: TextureFormat,
    width: number,
    height: number,
    options?: TextureCreationOptions
  ): Texture2D {
    const tex = this._device.createTexture2D(format, width, height, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a 2d texture from a image element and stores it in this pool.
   * @param element - The image element
   * @param options - The creation options
   * @returns The created 2D texture.
   */
  createTexture2DFromImage(
    element: TextureImageElement,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2D {
    const tex = this._device.createTexture2DFromImage(element, sRGB, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a 2D array texture and stores it in this pool.
   * @param format - The texture format
   * @param width - Pixel width of the texture
   * @param height - Pixel height of the texture
   * @param depth - Array length of the texture
   * @param options - The creation options
   * @returns The created 2D array texture.
   */
  createTexture2DArray(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture2DArray {
    const tex = this._device.createTexture2DArray(format, width, height, depth, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a 2D array texture from a seris of image elements and stores it in this pool.
   * @remarks image elements must have the same size.
   * @param elements - image elements
   * @param options - The creation options
   * @returns The created 2D array texture.
   */
  createTexture2DArrayFromImages(
    elements: TextureImageElement[],
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2DArray {
    const tex = this._device.createTexture2DArrayFromImages(elements, sRGB, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a 3D texture and stores it in this pool.
   * @param format - The texture format
   * @param width - Pixel width of the texture
   * @param height - Pixel height of the texture
   * @param depth - Pixel depth of the texture
   * @param options - The creation options
   * @returns The created 3D texture.
   */
  createTexture3D(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture3D {
    const tex = this._device.createTexture3D(format, width, height, depth, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a cube texture and stores it in this pool.
   * @param format - The texture format
   * @param size - Pixel width of the texture
   * @param options - The creation options
   * @returns The created cube texture.
   */
  createCubeTexture(format: TextureFormat, size: number, options?: TextureCreationOptions): TextureCube {
    const tex = this._device.createCubeTexture(format, size, options);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a video texture from a video element and stores it in this pool.
   * @param el - The video element
   * @returns The created video texture.
   */
  createTextureVideo(el: HTMLVideoElement, samplerOptions?: SamplerOptions): TextureVideo {
    const tex = this._device.createTextureVideo(el, samplerOptions);
    if (tex) {
      this._allocatedObjects.add(tex);
    }
    return tex;
  }
  /**
   * Creates a gpu program and stores it in this pool.
   * @param params - The creation options
   * @returns The created program.
   */
  createGPUProgram(params: GPUProgramConstructParams): GPUProgram {
    const program = this._device.createGPUProgram(params);
    if (program) {
      this._allocatedObjects.add(program);
    }
    return program;
  }
  /**
   * Creates a bind group and stores it in this pool.
   * @param layout - Layout of the bind group
   * @returns The created bind group.
   */
  createBindGroup(layout: BindGroupLayout): BindGroup {
    const bindGroup = this._device.createBindGroup(layout);
    if (bindGroup) {
      this._allocatedObjects.add(bindGroup);
    }
    return bindGroup;
  }
  /**
   * Creates a gpu buffer and stores it in this pool.
   * @param sizeInBytes - Size of the buffer in bytes
   * @param options - The creation options
   * @returns The created buffer.
   */
  createBuffer(sizeInBytes: number, options: BufferCreationOptions): GPUDataBuffer {
    const buffer = this._device.createBuffer(sizeInBytes, options);
    if (buffer) {
      this._allocatedObjects.add(buffer);
    }
    return buffer;
  }
  /**
   * Creates an index buffer and stores it in this pool.
   * @param data - Data of the index buffer
   * @param options - The creation options
   * @returns The created index buffer.
   */
  createIndexBuffer(data: Uint16Array | Uint32Array, options?: BufferCreationOptions): IndexBuffer {
    const buffer = this._device.createIndexBuffer(data, options);
    if (buffer) {
      this._allocatedObjects.add(buffer);
    }
    return buffer;
  }
  /**
   * Creates a structured buffer and stores it in this pool.
   * @param structureType - The structure type
   * @param options - The creation options
   * @param data - Data to be filled with
   * @returns The created structured buffer.
   */
  createStructuredBuffer(
    structureType: PBStructTypeInfo,
    options: BufferCreationOptions,
    data?: TypedArray
  ): StructuredBuffer {
    const buffer = this._device.createStructuredBuffer(structureType, options, data);
    if (buffer) {
      this._allocatedObjects.add(buffer);
    }
    return buffer;
  }
  /**
   * Creates a vertex layout object and stores it in this pool.
   * @param options - The creation options
   * @returns The created vertex layout object.
   */
  createVertexLayout(options: VertexLayoutOptions): VertexLayout {
    const layout = this._device.createVertexLayout(options);
    if (layout) {
      this._allocatedObjects.add(layout);
    }
    return layout;
  }
  /**
   * Creates a non-interleaved vertex buffer and stores it in this pool.
   *
   * @param attribFormat - The vertex attribute format
   * @param data - Data to be filled with
   * @param options - The creation options
   * @returns The created vertex buffer
   */
  createVertexBuffer(
    attribFormat: VertexAttribFormat,
    data: TypedArray,
    options?: BufferCreationOptions
  ): StructuredBuffer {
    const buffer = this._device.createVertexBuffer(attribFormat, data, options);
    if (buffer) {
      this._allocatedObjects.add(buffer);
    }
    return buffer;
  }
  /**
   * Creates an interleaved vertex buffer and stores it in this pool.
   * @param attribFormats - The vertex attribute formats for each vertex stream in the vertex buffer
   * @param data - Data to be filled with
   * @param options - The creation options
   * @returns The created vertex buffer.
   */
  createInterleavedVertexBuffer(
    attribFormats: VertexAttribFormat[],
    data: TypedArray,
    options?: BufferCreationOptions
  ): StructuredBuffer {
    const buffer = this._device.createInterleavedVertexBuffer(attribFormats, data, options);
    if (buffer) {
      this._allocatedObjects.add(buffer);
    }
    return buffer;
  }
  /**
   * Creates a frame buffer and stores it in this pool.
   * @param options - The creation options
   * @returns The created framebuffer.
   */
  createFrameBuffer(
    colorAttachments: BaseTexture[],
    depthAttachment: BaseTexture,
    options?: FrameBufferOptions
  ): FrameBuffer {
    const fb = this._device.createFrameBuffer(colorAttachments, depthAttachment, options);
    if (fb) {
      this._allocatedObjects.add(fb);
    }
    return fb;
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
    mipmapping = false
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
        this._freeTextures[hash] = undefined;
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
    mipmapping = false
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
        this._freeTextures[hash] = undefined;
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
    mipmapping = false
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
        this._freeTextures[hash] = undefined;
      }
    }
    this._allocatedTextures.set(texture, { hash, refcount: 1, dispose: false });
    if (autoRelease) {
      this._autoReleaseTextures.add(texture);
    }
    return texture as TextureCube;
  }
  /**
   * Creates a temporal framebuffer from the object pool.
   * @param autoRelease - Whether the framebuffer should be automatically released at the next frame.
   * @param width - Width of the framebuffer
   * @param height - Height of the framebuffer
   * @param colorAttachments - Array of color attachments or texture format of the framebuffer.
   * @param depthAttachment - Depth attachment or texture format of the framebuffer.
   * @param mipmapping - Whether mipmapping should be enabled when creating color attachment textures, default is false.
   * @param sampleCount - The sample count for the framebuffer, default is 1.
   * @param ignoreDepthStencil - Whether to ignore depth stencil when resolving msaa framebuffer, default is true.
   * @param attachmentMipLevel - The mipmap level to which the color attachment will render, default is 0
   * @param attachmentCubeface - The cubemap face to which the color attachment will render, default is 0
   * @param attachmentLayer - The texture layer to which the color attachment will render, default is 0
   * @returns The fetched FrameBuffer object.
   */
  fetchTemporalFramebuffer<T extends BaseTexture<unknown>>(
    autoRelease: boolean,
    width: number,
    height: number,
    colorTexOrFormat: MaybeArray<TextureFormat | T>,
    depthTexOrFormat: TextureFormat | T = null,
    mipmapping = false,
    sampleCount = 1,
    ignoreDepthStencil = true,
    attachmentMipLevel = 0,
    attachmentCubeface = 0,
    attachmentLayer = 0
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
      ignoreDepthStencil,
      attachmentMipLevel,
      attachmentCubeface,
      attachmentLayer
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
   * @param sampleCount - The sample count for the framebuffer, default is 1.
   * @param ignoreDepthStencil - Whether to ignore depth stencil when resolving msaa framebuffer, default is true.
   * @param attachmentMipLevel - The mipmap level to which the color attachment will render, default is 0.
   * @param attachmentCubeface - The cubemap face to which the color attachment will render, default is 0.
   * @param attachmentLayer - The texture layer to which the color attachment will render, default is 0.
   * @returns The fetched FrameBuffer object.
   */
  createTemporalFramebuffer(
    autoRelease: boolean,
    colorAttachments: BaseTexture[],
    depthAttachment: BaseTexture = null,
    sampleCount = 1,
    ignoreDepthStencil = true,
    attachmentMipLevel = 0,
    attachmentCubeface = 0,
    attachmentLayer = 0
  ) {
    colorAttachments = colorAttachments ?? [];
    let hash = `${depthAttachment?.uid ?? 0}:${sampleCount ?? 1}:${ignoreDepthStencil ? 1 : 0}`;
    if (colorAttachments.length > 0) {
      hash += `:${attachmentMipLevel}:${attachmentCubeface}:${attachmentLayer}`;
      for (const tex of colorAttachments) {
        hash += `:${tex.uid}`;
      }
    }
    let fb: FrameBuffer = null;
    const list = this._freeFramebuffers[hash];
    if (!list) {
      fb = this._device.createFrameBuffer(colorAttachments, depthAttachment, {
        ignoreDepthStencil,
        sampleCount
      });
      for (let i = 0; i < fb.getColorAttachments().length; i++) {
        fb.setColorAttachmentMipLevel(i, attachmentMipLevel);
        fb.setColorAttachmentCubeFace(i, attachmentCubeface);
        fb.setColorAttachmentLayer(i, attachmentLayer);
      }
    } else {
      fb = list.pop();
      if (list.length === 0) {
        this._freeFramebuffers[hash] = undefined;
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
    this._allocatedFramebuffers.set(fb, { hash, refcount: 1 });
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
   * Increment reference counter for given texture
   * @param texture - The texture to retain
   */
  retainTexture(texture: BaseTexture): void {
    const info = this._allocatedTextures.get(texture);
    if (!info) {
      console.error(`ObjectPool.retainTexture(): texture is not allocated from pool`);
    } else {
      info.refcount++;
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
    const info = this._allocatedFramebuffers.get(fb);
    if (!info) {
      console.error(`ObjectPool.releaseFrameBuffer(): framebuffer is not allocated from pool`);
    } else {
      info.refcount--;
      if (info.refcount <= 0) {
        this.internalDisposeFrameBuffer(fb);
        const list = this._freeFramebuffers[info.hash];
        if (list) {
          list.push(fb);
        } else {
          this._freeFramebuffers[info.hash] = [fb];
        }
      }
    }
  }
  /**
   * Increment reference counter for given framebuffer
   * @param fb - The framebuffer to retain
   */
  retainFrameBuffer(fb: FrameBuffer) {
    const info = this._allocatedFramebuffers.get(fb);
    if (!info) {
      console.error(`ObjectPool.retainFrameBuffer(): framebuffer is not allocated from pool`);
    } else {
      info.refcount++;
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
      if (info.refcount <= 0) {
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
