import type { Vector4, TypedArray } from '@zephyr3d/base';
import { makeEventTarget } from '@zephyr3d/base';
import type {
  WebGLContext,
  FrameBufferOptions,
  SamplerOptions,
  TextureSampler,
  Texture2D,
  Texture3D,
  TextureCube,
  TextureVideo,
  VertexLayout,
  GPUDataBuffer,
  IndexBuffer,
  FrameBuffer,
  GPUProgram,
  BindGroup,
  BindGroupLayout,
  StructuredBuffer,
  TextureMipmapData,
  TextureImageElement,
  Texture2DArray,
  TextureCreationOptions,
  BufferCreationOptions,
  VertexLayoutOptions,
  BaseTexture,
  GPUProgramConstructParams,
  RenderProgramConstructParams,
  DeviceOptions,
  DeviceViewport,
  DeviceCaps,
  PrimitiveType,
  TextureFormat,
  RenderStateSet,
  ITimer,
  PBStructTypeInfo,
  DeviceBackend,
  DeviceEventMap,
  AbstractDevice,
  RenderBundle
} from '@zephyr3d/device';
import {
  hasAlphaChannel,
  hasRedChannel,
  hasGreenChannel,
  hasBlueChannel,
  isIntegerTextureFormat,
  isSignedTextureFormat,
  isFloatTextureFormat,
  getTextureFormatBlockSize,
  isCompressedTextureFormat,
  hasDepthChannel,
  DeviceLostEvent,
  DeviceRestoreEvent,
  DeviceResizeEvent,
  BaseDevice,
  PBPrimitiveType,
  PBPrimitiveTypeInfo
} from '@zephyr3d/device';
import { isWebGL2, WebGLError } from './utils';
import { WebGLEnum } from './webgl_enum';
import { WebGLTexture2D } from './texture2d_webgl';
import { WebGLTexture2DArray } from './texture2darray_webgl';
import { WebGLTexture3D } from './texture3d_webgl';
import { WebGLTextureCube } from './texturecube_webgl';
import { WebGLTextureVideo } from './texturevideo_webgl';
import { WebGLVertexLayout } from './vertexlayout_webgl';
import { WebGLGPUBuffer } from './buffer_webgl';
import { WebGLIndexBuffer } from './indexbuffer_webgl';
import { WebGLFrameBuffer } from './framebuffer_webgl';
import { WebGLDepthState, WebGLRenderStateSet } from './renderstate_webgl';
import { GPUTimer } from './gpu_timer';
import { WebGLTextureCaps, WebGLFramebufferCaps, WebGLMiscCaps, WebGLShaderCaps } from './capabilities_webgl';
import { WebGLBindGroup } from './bindgroup_webgl';
import { WebGLGPUProgram } from './gpuprogram_webgl';
import {
  primitiveTypeMap,
  textureMagFilterToWebGL,
  textureMinFilterToWebGL,
  textureWrappingMap,
  typeMap
} from './constants_webgl';
import { SamplerCache } from './sampler_cache';
import { WebGLStructuredBuffer } from './structuredbuffer_webgl';
import type { WebGLTextureSampler } from './sampler_webgl';
import type { WebGLBaseTexture } from './basetexture_webgl';

declare global {
  interface WebGLRenderingContext {
    _currentFramebuffer: FrameBuffer;
    _currentProgram: GPUProgram;
  }
  interface WebGL2RenderingContext {
    _currentFramebuffer: FrameBuffer;
    _currentProgram: GPUProgram;
  }
}

type VAOObject = WebGLVertexArrayObject | WebGLVertexArrayObjectOES;

type WebGLRenderBundle = {
  program: WebGLGPUProgram;
  bindGroups: WebGLBindGroup[];
  bindGroupOffsets: Iterable<number>[];
  vertexLayout: WebGLVertexLayout;
  primitiveType: PrimitiveType;
  renderStateSet: RenderStateSet;
  first: number;
  count: number;
  numInstances: number;
}[];

export interface VertexArrayObjectEXT {
  createVertexArray: () => VAOObject;
  bindVertexArray: (arrayObject: VAOObject) => void;
  deleteVertexArray: (arrayObject: VAOObject) => void;
  isVertexArray: (arrayObject: VAOObject) => GLboolean;
}

export interface InstancedArraysEXT {
  drawArraysInstanced: (mode: GLenum, first: GLint, count: GLsizei, primcount: GLsizei) => void;
  drawElementsInstanced: (
    mode: GLenum,
    count: GLsizei,
    type: GLenum,
    offset: GLintptr,
    primcount: GLsizei
  ) => void;
  vertexAttribDivisor: (index: GLuint, divisor: GLuint) => void;
}

export interface DrawBuffersEXT {
  drawBuffers(buffers: number[]);
}

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const tempInt32Array = new Int32Array(4);
const tempUint32Array = new Uint32Array(4);

export class WebGLDevice extends BaseDevice {
  private _context: WebGLContext;
  private _isWebGL2: boolean;
  private _msaaSampleCount: number;
  private _loseContextExtension: WEBGL_lose_context;
  private _contextLost: boolean;
  private _isRendering: boolean;
  private _dpr: number;
  private _reverseWindingOrder: boolean;
  private _deviceCaps: DeviceCaps;
  private _vaoExt: VertexArrayObjectEXT;
  private _instancedArraysExt: InstancedArraysEXT;
  private _drawBuffersExt: DrawBuffersEXT;
  private _currentProgram: WebGLGPUProgram;
  private _currentVertexData: WebGLVertexLayout;
  private _currentStateSet: WebGLRenderStateSet;
  private _currentBindGroups: WebGLBindGroup[];
  private _currentBindGroupOffsets: Iterable<number>[];
  private _currentViewport: DeviceViewport;
  private _currentScissorRect: DeviceViewport;
  private _samplerCache: SamplerCache;
  private _textureSamplerMap: WeakMap<BaseTexture, WebGLTextureSampler>;
  private _captureRenderBundle: WebGLRenderBundle;
  private _deviceUniformBuffers: WebGLBuffer[];
  private _deviceUniformBufferOffsets: number[];
  private _bindTextures: Record<number, WebGLTexture[]>;
  private _bindSamplers: WebGLSampler[];
  constructor(backend: DeviceBackend, cvs: HTMLCanvasElement, options?: DeviceOptions) {
    super(cvs, backend);
    this._dpr = Math.max(1, Math.floor(options?.dpr ?? window.devicePixelRatio));
    this._isRendering = false;
    this._captureRenderBundle = null;
    this._msaaSampleCount = options?.msaa ? 4 : 1;
    let context: WebGLContext = null;
    context = this.canvas.getContext(backend === backend1 ? 'webgl' : 'webgl2', {
      antialias: !!options?.msaa,
      depth: true,
      stencil: true,
      premultipliedAlpha: false
    }) as WebGLContext;
    if (!context) {
      throw new Error('Invalid argument or no webgl support');
    }
    this._isWebGL2 = isWebGL2(context);
    this._contextLost = false;
    this._reverseWindingOrder = false;
    this._deviceCaps = null;
    this._context = context;
    this._currentProgram = null;
    this._currentVertexData = null;
    this._currentStateSet = null;
    this._currentBindGroups = [];
    this._currentBindGroupOffsets = [];
    this._currentViewport = null;
    this._currentScissorRect = null;
    this._deviceUniformBuffers = [];
    this._deviceUniformBufferOffsets = [];
    this._bindTextures = {
      [WebGLEnum.TEXTURE_2D]: [],
      [WebGLEnum.TEXTURE_CUBE_MAP]: [],
      [WebGLEnum.TEXTURE_3D]: [],
      [WebGLEnum.TEXTURE_2D_ARRAY]: []
    };
    this._bindSamplers = [];
    this._samplerCache = new SamplerCache(this);
    this._textureSamplerMap = new WeakMap();
    this._loseContextExtension = this._context.getExtension('WEBGL_lose_context');
    this.canvas.addEventListener(
      'webglcontextlost',
      (evt) => {
        this._contextLost = true;
        evt.preventDefault();
        this.handleContextLost();
      },
      false
    );
    this.canvas.addEventListener(
      'webglcontextrestored',
      (evt) => {
        this._contextLost = false;
        this.handleContextRestored();
      },
      false
    );
  }
  get context() {
    return this._context;
  }
  getFrameBufferSampleCount() {
    return this.getFramebuffer()?.getSampleCount() ?? this._msaaSampleCount;
  }
  get isWebGL2(): boolean {
    return this._isWebGL2;
  }
  get drawingBufferWidth() {
    return this.getDrawingBufferWidth();
  }
  get drawingBufferHeight() {
    return this.getDrawingBufferHeight();
  }
  get clientWidth() {
    return this.canvas.clientWidth;
  }
  get clientHeight() {
    return this.canvas.clientHeight;
  }
  getScale(): number {
    return this._dpr;
  }
  isContextLost(): boolean {
    return this._context.isContextLost();
  }
  getDeviceCaps(): DeviceCaps {
    return this._deviceCaps;
  }
  get vaoExt(): VertexArrayObjectEXT {
    return this._vaoExt;
  }
  get instancedArraysExt(): InstancedArraysEXT {
    return this._instancedArraysExt;
  }
  get drawBuffersExt() {
    return this._drawBuffersExt;
  }
  getDrawingBufferWidth(): number {
    return this._context._currentFramebuffer?.getWidth() || this._context.drawingBufferWidth;
  }
  getDrawingBufferHeight(): number {
    return this._context._currentFramebuffer?.getHeight() || this._context.drawingBufferHeight;
  }
  getBackBufferWidth(): number {
    return this.canvas.width;
  }
  getBackBufferHeight(): number {
    return this.canvas.height;
  }
  invalidateBindingTextures() {
    this._bindTextures = {
      [WebGLEnum.TEXTURE_2D]: [],
      [WebGLEnum.TEXTURE_CUBE_MAP]: [],
      [WebGLEnum.TEXTURE_3D]: [],
      [WebGLEnum.TEXTURE_2D_ARRAY]: []
    };
  }
  bindTexture(target: number, layer: number, texture: WebGLBaseTexture, sampler?: WebGLTextureSampler) {
    const tex = texture?.object ?? null;
    const gl = this._context;
    gl.activeTexture(WebGLEnum.TEXTURE0 + layer);
    if (this._bindTextures[target][layer] !== tex) {
      gl.bindTexture(target, tex);
      this._bindTextures[target][layer] = tex;
    }
    if (this._isWebGL2) {
      const samp = sampler?.object ?? null;
      if (samp && this._bindSamplers[layer] !== samp) {
        (gl as WebGL2RenderingContext).bindSampler(layer, samp);
        this._bindSamplers[layer] = samp;
      }
    } else if (texture && sampler && this._textureSamplerMap.get(texture) !== sampler) {
      const fallback = texture.isWebGL1Fallback;
      this._textureSamplerMap.set(texture, sampler);
      gl.texParameteri(
        target,
        WebGLEnum.TEXTURE_WRAP_S,
        textureWrappingMap[false && fallback ? 'clamp' : sampler.addressModeU]
      );
      gl.texParameteri(
        target,
        WebGLEnum.TEXTURE_WRAP_T,
        textureWrappingMap[false && fallback ? 'clamp' : sampler.addressModeV]
      );
      gl.texParameteri(target, WebGLEnum.TEXTURE_MAG_FILTER, textureMagFilterToWebGL(sampler.magFilter));
      gl.texParameteri(
        target,
        WebGLEnum.TEXTURE_MIN_FILTER,
        textureMinFilterToWebGL(sampler.minFilter, fallback ? 'none' : sampler.mipFilter)
      );
      if (this.getDeviceCaps().textureCaps.supportAnisotropicFiltering) {
        gl.texParameterf(target, WebGLEnum.TEXTURE_MAX_ANISOTROPY, sampler.maxAnisotropy);
      }
    }
  }
  bindUniformBuffer(index: number, buffer: WebGLGPUBuffer, offset: number) {
    if (
      this._deviceUniformBuffers[index] !== buffer.object ||
      this._deviceUniformBufferOffsets[index] !== offset
    ) {
      if (offset) {
        (this.context as WebGL2RenderingContext).bindBufferRange(
          WebGLEnum.UNIFORM_BUFFER,
          index,
          buffer.object,
          offset,
          buffer.byteLength - offset
        );
      } else {
        (this.context as WebGL2RenderingContext).bindBufferBase(
          WebGLEnum.UNIFORM_BUFFER,
          index,
          buffer.object
        );
      }
      this._deviceUniformBuffers[index] = buffer.object;
      this._deviceUniformBufferOffsets[index] = offset;
    }
  }
  async initContext() {
    this.initContextState();
    this.on('resize', (evt) => {
      const width = Math.max(1, Math.round(this.canvas.clientWidth * this._dpr));
      const height = Math.max(1, Math.round(this.canvas.clientHeight * this._dpr));
      if (width !== this.canvas.width || height !== this.canvas.height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.setViewport(this._currentViewport);
        this.setScissor(this._currentScissorRect);
      }
    });
    this.dispatchEvent(new DeviceResizeEvent(this.canvas.clientWidth, this.canvas.clientHeight));
  }
  clearFrameBuffer(clearColor: Vector4, clearDepth: number, clearStencil: number) {
    const gl = this._context;
    const colorFlag = clearColor ? gl.COLOR_BUFFER_BIT : 0;
    const depthFlag = typeof clearDepth === 'number' ? gl.DEPTH_BUFFER_BIT : 0;
    const stencilFlag = typeof clearStencil === 'number' ? gl.STENCIL_BUFFER_BIT : 0;
    if (colorFlag || depthFlag || stencilFlag) {
      WebGLDepthState.applyDefaults(this._context);
      if (isWebGL2(gl) && gl._currentFramebuffer) {
        if (depthFlag || stencilFlag) {
          const depthAttachment = gl._currentFramebuffer.getDepthAttachment();
          if (depthAttachment) {
            gl.clearBufferfi(WebGLEnum.DEPTH_STENCIL, 0, clearDepth || 1, clearStencil || 0);
          }
        }
        if (colorFlag) {
          const attachments = gl._currentFramebuffer.getColorAttachments();
          for (let i = 0; i < attachments.length; i++) {
            if (isIntegerTextureFormat(attachments[i].format)) {
              if (isSignedTextureFormat(attachments[i].format)) {
                tempInt32Array[0] = clearColor[0];
                tempInt32Array[1] = clearColor[1];
                tempInt32Array[2] = clearColor[2];
                tempInt32Array[3] = clearColor[3];
                gl.clearBufferiv(WebGLEnum.COLOR, i, tempInt32Array);
              } else {
                tempUint32Array[0] = clearColor[0];
                tempUint32Array[1] = clearColor[1];
                tempUint32Array[2] = clearColor[2];
                tempUint32Array[3] = clearColor[3];
                gl.clearBufferuiv(WebGLEnum.COLOR, i, tempUint32Array);
              }
            } else {
              gl.clearBufferfv(WebGLEnum.COLOR, i, clearColor);
            }
          }
        }
      } else {
        gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
        gl.clearDepth(clearDepth);
        gl.clearStencil(clearStencil);
        gl.clear(colorFlag | depthFlag | stencilFlag);
      }
      (gl._currentFramebuffer as WebGLFrameBuffer)?.tagDraw();
    }
  }
  // factory
  createGPUTimer(): ITimer {
    return new GPUTimer(this);
  }
  createRenderStateSet(): RenderStateSet {
    return new WebGLRenderStateSet(this._context);
  }
  createSampler(options: SamplerOptions): TextureSampler {
    return this._samplerCache.fetchSampler(options);
  }
  createTextureFromMipmapData<T extends BaseTexture>(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): T {
    if (!data) {
      console.error(`Device.createTextureFromMipmapData() failed: invalid data`);
      return null;
    }
    if (data.isCubemap) {
      const tex = new WebGLTextureCube(this);
      tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
      return tex as unknown as T;
    } else if (data.isVolume) {
      const tex = new WebGLTexture3D(this);
      tex.createWithMipmapData(data, this.parseTextureOptions(options));
      return tex as unknown as T;
    } else if (data.isArray) {
      const tex = new WebGLTexture2DArray(this);
      tex.createWithMipmapData(data, this.parseTextureOptions(options));
      return tex as unknown as T;
    } else {
      const tex = new WebGLTexture2D(this);
      tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
      return tex as unknown as T;
    }
  }
  createTexture2D(
    format: TextureFormat,
    width: number,
    height: number,
    options?: TextureCreationOptions
  ): Texture2D {
    const tex = (options?.texture as WebGLTexture2D) ?? new WebGLTexture2D(this);
    if (!tex.isTexture2D()) {
      console.error('createTexture2D() failed: options.texture must be 2d texture');
      return null;
    }
    tex.createEmpty(format, width, height, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DFromMipmapData(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2D {
    const tex = (options?.texture as WebGLTexture2D) ?? new WebGLTexture2D(this);
    if (!tex.isTexture2D()) {
      console.error('createTexture2DFromMipmapData() failed: options.texture must be 2d texture');
      return null;
    }
    tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DFromImage(
    element: TextureImageElement,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2D {
    const tex = (options?.texture as WebGLTexture2D) ?? new WebGLTexture2D(this);
    if (!tex.isTexture2D()) {
      console.error('createTexture2DFromImage() failed: options.texture must be 2d texture');
      return null;
    }
    tex.loadFromElement(element, sRGB, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DArray(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture2DArray {
    const tex = (options?.texture as WebGLTexture2DArray) ?? new WebGLTexture2DArray(this);
    if (!tex.isTexture2DArray()) {
      console.error('createTexture2DArray() failed: options.texture must be 2d array texture');
      return null;
    }
    tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DArrayFromImages(
    elements: TextureImageElement[],
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2DArray {
    if (!elements || elements.length === 0) {
      console.error('createTexture2DArrayFromImages() failed: Invalid image elements');
      return null;
    }
    let width = 0;
    let height = 0;
    for (const element of elements) {
      if (width === 0 || height === 0) {
        width = element.width;
        height = element.height;
      } else if (width !== element.width || height !== element.height) {
        console.error('createTexture2DArrayFromImages() failed: Image elements must have the same size');
        return null;
      }
    }
    if (options?.texture && !options.texture.isTexture2DArray()) {
      console.error('createTexture2DArrayFromImages() failed: options.texture must be 2d array texture');
      return null;
    }
    let tex: Texture2DArray = options?.texture as Texture2DArray;
    if (tex) {
      if (tex.depth !== elements.length) {
        console.error(
          'createTexture2DArrayFromImages() failed: Layer count of options.texture not match the given image elements'
        );
        return null;
      }
      if (tex.width !== width || tex.height !== height) {
        console.error(
          'createTexture2DArrayFromImages() failed: Size of options.texture not match the given image elements'
        );
        return null;
      }
    } else {
      tex = this.createTexture2DArray(
        sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm',
        width,
        height,
        elements.length,
        options
      );
      for (let i = 0; i < elements.length; i++) {
        tex.updateFromElement(elements[i], 0, 0, i, 0, 0, width, height);
      }
    }
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture3D(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture3D {
    if (!this.isWebGL2) {
      console.error('device does not support 3d texture');
      return null;
    }
    const tex = (options?.texture as WebGLTexture3D) ?? new WebGLTexture3D(this);
    if (!tex.isTexture3D()) {
      console.error('createTexture3D() failed: options.texture must be 3d texture');
      return null;
    }
    tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createCubeTexture(format: TextureFormat, size: number, options?: TextureCreationOptions): TextureCube {
    const tex = (options?.texture as WebGLTextureCube) ?? new WebGLTextureCube(this);
    if (!tex.isTextureCube()) {
      console.error('createCubeTexture() failed: options.texture must be cube texture');
      return null;
    }
    tex.createEmpty(format, size, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createCubeTextureFromMipmapData(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): TextureCube {
    const tex = (options?.texture as WebGLTextureCube) ?? new WebGLTextureCube(this);
    if (!tex.isTextureCube()) {
      console.error('createCubeTextureFromMipmapData() failed: options.texture must be cube texture');
      return null;
    }
    tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DArrayFromMipmapData(
    data: TextureMipmapData,
    options?: TextureCreationOptions
  ): Texture2DArray {
    const tex = (options?.texture as WebGLTextureCube) ?? new WebGLTexture2DArray(this);
    if (!tex.isTexture2DArray()) {
      console.error('createTexture2DArrayFromMipmapData() failed: options.texture must be 2d array texture');
      return null;
    }
    tex.createWithMipmapData(data, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTextureVideo(el: HTMLVideoElement, samplerOptions?: SamplerOptions): TextureVideo {
    const tex = new WebGLTextureVideo(this, el);
    tex.samplerOptions = samplerOptions ?? null;
    return tex;
  }
  createGPUProgram(params: GPUProgramConstructParams): GPUProgram {
    if (params.type === 'compute') {
      throw new Error('device does not support compute shader');
    }
    const renderProgramParams = params.params as RenderProgramConstructParams;
    return new WebGLGPUProgram(
      this,
      renderProgramParams.vs,
      renderProgramParams.fs,
      renderProgramParams.bindGroupLayouts,
      renderProgramParams.vertexAttributes
    );
  }
  createBindGroup(layout: BindGroupLayout): BindGroup {
    return new WebGLBindGroup(this, layout);
  }
  createBuffer(sizeInBytes: number, options: BufferCreationOptions): GPUDataBuffer {
    return new WebGLGPUBuffer(this, this.parseBufferOptions(options), sizeInBytes);
  }
  copyBuffer(
    sourceBuffer: GPUDataBuffer<unknown>,
    destBuffer: GPUDataBuffer<unknown>,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  ) {
    if (!this.isWebGL2) {
      console.error(`copyBuffer() is not supported for current device`);
      return;
    }
    const gl = this._context as WebGL2RenderingContext;
    gl.bindBuffer(gl.COPY_READ_BUFFER, sourceBuffer.object);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, destBuffer.object);
    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, srcOffset, dstOffset, bytes);
  }
  createIndexBuffer(data: Uint16Array | Uint32Array, options?: BufferCreationOptions): IndexBuffer {
    return new WebGLIndexBuffer(this, data, this.parseBufferOptions(options, 'index'));
  }
  createStructuredBuffer(
    structureType: PBStructTypeInfo,
    options?: BufferCreationOptions,
    data?: TypedArray
  ): StructuredBuffer {
    return new WebGLStructuredBuffer(this, structureType, this.parseBufferOptions(options), data);
  }
  createVertexLayout(options: VertexLayoutOptions): VertexLayout {
    return new WebGLVertexLayout(this, options);
  }
  createFrameBuffer(
    colorAttachments: BaseTexture[],
    depthAttachement: BaseTexture,
    options?: FrameBufferOptions
  ): FrameBuffer {
    return new WebGLFrameBuffer(this, colorAttachments, depthAttachement, options);
  }
  setBindGroup(index: number, bindGroup: BindGroup, bindGroupOffsets?: Iterable<number>) {
    if (bindGroupOffsets && !isWebGL2(this._context)) {
      throw new Error(`setBindGroup(): no dynamic offset buffer support for WebGL1 device`);
    }
    this._currentBindGroups[index] = bindGroup as WebGLBindGroup;
    this._currentBindGroupOffsets[index] = bindGroupOffsets || null;
  }
  getBindGroup(index: number): [BindGroup, Iterable<number>] {
    return [this._currentBindGroups[index], this._currentBindGroupOffsets[index]];
  }
  // render related
  setViewport(vp?: number[] | DeviceViewport) {
    if (vp === null || vp === undefined || (!Array.isArray(vp) && vp.default)) {
      this._currentViewport = {
        x: 0,
        y: 0,
        width: this.deviceToScreen(this.drawingBufferWidth),
        height: this.deviceToScreen(this.drawingBufferHeight),
        default: true
      };
    } else {
      if (Array.isArray(vp)) {
        this._currentViewport = {
          x: vp[0],
          y: vp[1],
          width: vp[2],
          height: vp[3],
          default: false
        };
      } else {
        this._currentViewport = Object.assign({ default: false }, vp);
      }
    }
    this._context.viewport(
      this.screenToDevice(this._currentViewport.x),
      this.screenToDevice(this._currentViewport.y),
      this.screenToDevice(this._currentViewport.width),
      this.screenToDevice(this._currentViewport.height)
    );
  }
  getViewport(): DeviceViewport {
    return Object.assign({}, this._currentViewport);
  }
  setScissor(scissor?: number[] | DeviceViewport) {
    if (scissor === null || scissor === undefined || (!Array.isArray(scissor) && scissor.default)) {
      this._currentScissorRect = {
        x: 0,
        y: 0,
        width: this.deviceToScreen(this.drawingBufferWidth),
        height: this.deviceToScreen(this.drawingBufferHeight),
        default: true
      };
    } else {
      if (Array.isArray(scissor)) {
        this._currentScissorRect = {
          x: scissor[0],
          y: scissor[1],
          width: scissor[2],
          height: scissor[3],
          default: false
        };
      } else {
        this._currentScissorRect = Object.assign({ default: false }, scissor);
      }
    }
    this._context.scissor(
      this.screenToDevice(this._currentScissorRect.x),
      this.screenToDevice(this._currentScissorRect.y),
      this.screenToDevice(this._currentScissorRect.width),
      this.screenToDevice(this._currentScissorRect.height)
    );
  }
  getScissor(): DeviceViewport {
    return Object.assign({}, this._currentScissorRect);
  }
  setProgram(program: GPUProgram) {
    this._currentProgram = program as WebGLGPUProgram;
  }
  getProgram(): GPUProgram {
    return this._currentProgram;
  }
  setVertexLayout(vertexData: VertexLayout) {
    this._currentVertexData = vertexData as WebGLVertexLayout;
  }
  getVertexLayout(): VertexLayout {
    return this._currentVertexData;
  }
  setRenderStates(stateSet: RenderStateSet) {
    this._currentStateSet = stateSet as WebGLRenderStateSet;
  }
  getRenderStates(): RenderStateSet {
    return this._currentStateSet;
  }
  getFramebuffer(): FrameBuffer {
    return this._context._currentFramebuffer ?? null;
  }
  reverseVertexWindingOrder(reverse: boolean): void {
    if (this._reverseWindingOrder !== !!reverse) {
      this._reverseWindingOrder = !!reverse;
      this._context.frontFace(reverse ? this._context.CW : this._context.CCW);
    }
  }
  isWindingOrderReversed(): boolean {
    return !!this._reverseWindingOrder;
  }
  flush(): void {
    this.context.flush();
  }
  async readPixels(
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
    buffer: TypedArray
  ): Promise<void> {
    const fb = this.getFramebuffer();
    const colorAttachment = fb ? fb.getColorAttachments()[index] : null;
    const format = colorAttachment ? colorAttachment.format : 'rgba8unorm';
    let glFormat: number = WebGLEnum.NONE;
    let glType: number = WebGLEnum.NONE;
    const pixelSize = getTextureFormatBlockSize(format);
    glFormat = this.context.getParameter(WebGLEnum.IMPLEMENTATION_COLOR_READ_FORMAT);
    glType = this.context.getParameter(WebGLEnum.IMPLEMENTATION_COLOR_READ_TYPE);
    if (
      (glFormat !== WebGLEnum.RGBA || (glType !== WebGLEnum.UNSIGNED_BYTE && glType !== WebGLEnum.FLOAT)) &&
      !isWebGL2(this.context)
    ) {
      throw new Error(`readPixels() failed: invalid format: ${format}`);
    }
    const byteSize = w * h * pixelSize;
    if (buffer.byteLength < byteSize) {
      throw new Error(`readPixels() failed: destination buffer must have at least ${byteSize} bytes`);
    }
    if (isWebGL2(this.context)) {
      const stagingBuffer = this.createBuffer(byteSize, {
        usage: 'read',
        managed: false
      });
      this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, stagingBuffer.object);
      this.context.readBuffer(fb ? WebGLEnum.COLOR_ATTACHMENT0 + index : WebGLEnum.COLOR_ATTACHMENT0);
      this.flush();
      this.context.readPixels(x, y, w, h, glFormat, glType, 0);
      this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, null);
      const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      await stagingBuffer.getBufferSubData(data);
      stagingBuffer.dispose();
    } else {
      this.context.readPixels(x, y, w, h, glFormat, glType, buffer);
    }
  }
  readPixelsToBuffer(index: number, x: number, y: number, w: number, h: number, buffer: GPUDataBuffer): void {
    const fb = this.getFramebuffer();
    const colorAttachment = fb ? fb.getColorAttachments()[index] : null;
    const format = colorAttachment ? colorAttachment.format : 'rgba8unorm';
    let glFormat: number = WebGLEnum.NONE;
    let glType: number = WebGLEnum.NONE;
    if (!isWebGL2(this.context)) {
      throw new Error('readPixels() failed: readPixels() requires webgl2 device');
    }
    if (isCompressedTextureFormat(format) || hasDepthChannel(format)) {
      throw new Error(`readPixels() failed: invalid format: ${format}`);
    }
    const r = hasRedChannel(format);
    const g = hasGreenChannel(format);
    const b = hasBlueChannel(format);
    const a = hasAlphaChannel(format);
    const numChannels = (r ? 1 : 0) + (g ? 1 : 0) + (b ? 1 : 0) + (a ? 1 : 0);
    const size = getTextureFormatBlockSize(format) / numChannels;
    const integer = isIntegerTextureFormat(format);
    const float = isFloatTextureFormat(format);
    const signed = isSignedTextureFormat(format);
    if (r && g && b && a) {
      glFormat = integer ? WebGLEnum.RGBA_INTEGER : WebGLEnum.RGBA;
    } else if (r && g) {
      glFormat = integer ? WebGLEnum.RG_INTEGER : WebGLEnum.RG;
    } else if (r) {
      glFormat = integer ? WebGLEnum.RED_INTEGER : WebGLEnum.RED;
    }
    if (size === 1) {
      glType = signed ? WebGLEnum.BYTE : WebGLEnum.UNSIGNED_BYTE;
    } else if (size === 2) {
      glType = float ? WebGLEnum.HALF_FLOAT : signed ? WebGLEnum.SHORT : WebGLEnum.UNSIGNED_SHORT;
    } else if (size === 4) {
      glType = float ? WebGLEnum.FLOAT : signed ? WebGLEnum.INT : WebGLEnum.UNSIGNED_INT;
    }
    this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, buffer.object);
    this.context.readBuffer(fb ? WebGLEnum.COLOR_ATTACHMENT0 + index : WebGLEnum.COLOR_ATTACHMENT0);
    this.flush();
    this.context.readPixels(x, y, w, h, glFormat, glType, 0);
    this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, null);
  }
  looseContext(): void {
    if (!this.context.isContextLost()) {
      this._loseContextExtension?.loseContext();
    }
  }
  restoreContext(): void {
    if (this.context.isContextLost()) {
      this.clearErrors();
      this._loseContextExtension?.restoreContext();
      const err = this.getError();
      if (err) {
        console.log(err);
      }
    }
  }
  beginCapture(): void {
    if (this._captureRenderBundle) {
      throw new Error('Device.beginCapture() failed: device is already capturing draw commands');
    }
    this._captureRenderBundle = [];
  }
  endCapture(): unknown {
    if (!this._captureRenderBundle) {
      throw new Error('Device.endCapture() failed: device is not capturing draw commands');
    }
    const result = this._captureRenderBundle;
    this._captureRenderBundle = null;
    return result;
  }
  executeRenderBundle(renderBundle: RenderBundle) {
    for (const drawcall of renderBundle as WebGLRenderBundle) {
      this.setProgram(drawcall.program);
      this.setVertexLayout(drawcall.vertexLayout);
      this.setRenderStates(drawcall.renderStateSet);
      for (let i = 0; i < 4; i++) {
        this.setBindGroup(i, drawcall.bindGroups[i], drawcall.bindGroupOffsets[i]);
      }
      if (drawcall.numInstances === 0) {
        this.draw(drawcall.primitiveType, drawcall.first, drawcall.count);
      } else {
        this.drawInstanced(drawcall.primitiveType, drawcall.first, drawcall.count, drawcall.numInstances);
      }
    }
  }
  /** @internal */
  protected _setFramebuffer(rt: FrameBuffer): void {
    if (rt !== this._context._currentFramebuffer) {
      this._context._currentFramebuffer?.unbind();
      rt?.bind();
    }
  }
  /** @internal */
  protected onBeginFrame(): boolean {
    if (this._contextLost) {
      if (!this._context.isContextLost()) {
        this._contextLost = false;
        this.handleContextRestored();
      }
    }
    return !this._contextLost;
  }
  nextFrame(callback: () => void): number {
    return requestAnimationFrame(callback);
  }
  cancelNextFrame(handle: number) {
    cancelAnimationFrame(handle);
  }
  /** @internal */
  protected onEndFrame(): void {}
  /** @internal */
  protected _draw(primitiveType: PrimitiveType, first: number, count: number): void {
    if (this._currentVertexData) {
      this._currentVertexData.bind();
      if (this._currentProgram) {
        if (!this._currentProgram.use()) {
          return;
        }
        for (let i = 0; i < this._currentProgram.bindGroupLayouts.length; i++) {
          const bindGroup = this._currentBindGroups[i];
          if (bindGroup) {
            const offsets = this._currentBindGroupOffsets[i];
            bindGroup.apply(this._currentProgram, offsets);
          } else {
            console.error(
              `Missing bind group (${i}) when drawing with program '${this._currentProgram.name}'`
            );
            return;
          }
        }
      }
      if (this._currentStateSet) {
        this._currentStateSet.apply();
      } else {
        WebGLRenderStateSet.applyDefaults(this._context);
      }
      const indexBuffer = this._currentVertexData.indexBuffer;
      if (indexBuffer) {
        this.context.drawElements(
          primitiveTypeMap[primitiveType],
          count,
          typeMap[indexBuffer.indexType.primitiveType],
          first * (indexBuffer.indexType === typeU16 ? 2 : 4)
        );
      } else {
        this.context.drawArrays(primitiveTypeMap[primitiveType], first, count);
      }
      (this._context._currentFramebuffer as WebGLFrameBuffer)?.tagDraw();
    }
    if (this._captureRenderBundle) {
      const rs = this._currentStateSet?.clone() ?? this.createRenderStateSet();
      if (this._reverseWindingOrder) {
        const rasterState = rs.rasterizerState;
        if (!rasterState) {
          rs.useRasterizerState().setCullMode('front');
        } else if (rasterState.cullMode === 'back') {
          rasterState.cullMode = 'front';
        } else if (rasterState.cullMode === 'front') {
          rasterState.cullMode = 'back';
        }
      }
      this._captureRenderBundle.push({
        bindGroups: [...this._currentBindGroups],
        bindGroupOffsets: this._currentBindGroupOffsets.map((val) => (val ? [...val] : null)),
        program: this._currentProgram,
        vertexLayout: this._currentVertexData,
        primitiveType: primitiveType,
        renderStateSet: rs,
        count,
        first,
        numInstances: 0
      });
    }
  }
  /** @internal */
  protected _drawInstanced(
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ): void {
    if (this.instancedArraysExt && this._currentVertexData) {
      this._currentVertexData.bind();
      if (this._currentProgram) {
        if (!this._currentProgram.use()) {
          return;
        }
        for (let i = 0; i < this._currentBindGroups.length; i++) {
          const bindGroup = this._currentBindGroups[i];
          if (bindGroup) {
            const offsets = this._currentBindGroupOffsets[i];
            bindGroup.apply(this._currentProgram, offsets);
          }
        }
      }
      this._currentStateSet?.apply();
      const indexBuffer = this._currentVertexData.indexBuffer;
      if (indexBuffer) {
        this.instancedArraysExt.drawElementsInstanced(
          primitiveTypeMap[primitiveType],
          count,
          typeMap[indexBuffer.indexType.primitiveType],
          first * (indexBuffer.indexType === typeU16 ? 2 : 4),
          numInstances
        );
      } else {
        this.instancedArraysExt.drawArraysInstanced(
          primitiveTypeMap[primitiveType],
          first,
          count,
          numInstances
        );
      }
      (this._context._currentFramebuffer as WebGLFrameBuffer)?.tagDraw();
    }
    if (this._captureRenderBundle) {
      this._captureRenderBundle.push({
        bindGroups: [...this._currentBindGroups],
        bindGroupOffsets: this._currentBindGroupOffsets.map((val) => (val ? [...val] : null)),
        program: this._currentProgram,
        vertexLayout: this._currentVertexData,
        primitiveType: primitiveType,
        renderStateSet: this._currentStateSet?.clone() ?? null,
        count,
        first,
        numInstances
      });
    }
  }
  /** @internal */
  protected _compute(): void {
    throw new Error('WebGL device does not support compute shader');
  }
  /** @internal */
  private createInstancedArraysEXT(): InstancedArraysEXT {
    const gl = this._context;
    if (isWebGL2(gl)) {
      return {
        vertexAttribDivisor: gl.vertexAttribDivisor.bind(gl),
        drawArraysInstanced: gl.drawArraysInstanced.bind(gl),
        drawElementsInstanced: gl.drawElementsInstanced.bind(gl)
      };
    } else {
      const extInstancedArray: ANGLE_instanced_arrays = gl.getExtension('ANGLE_instanced_arrays');
      return extInstancedArray
        ? {
            vertexAttribDivisor: extInstancedArray.vertexAttribDivisorANGLE.bind(extInstancedArray),
            drawArraysInstanced: extInstancedArray.drawArraysInstancedANGLE.bind(extInstancedArray),
            drawElementsInstanced: extInstancedArray.drawElementsInstancedANGLE.bind(extInstancedArray)
          }
        : null;
    }
  }
  /** @internal */
  private createDrawBuffersEXT(): DrawBuffersEXT {
    const gl = this._context;
    if (isWebGL2(gl)) {
      return {
        drawBuffers: gl.drawBuffers.bind(gl)
      };
    } else {
      const extDrawBuffers: WEBGL_draw_buffers = gl.getExtension('WEBGL_draw_buffers');
      return extDrawBuffers
        ? {
            drawBuffers: extDrawBuffers.drawBuffersWEBGL.bind(extDrawBuffers)
          }
        : null;
    }
  }
  /** @internal */
  private createVertexArrayObjectEXT(): VertexArrayObjectEXT {
    const gl = this._context;
    if (isWebGL2(gl)) {
      return {
        createVertexArray: gl.createVertexArray.bind(gl),
        bindVertexArray: gl.bindVertexArray.bind(gl),
        deleteVertexArray: gl.deleteVertexArray.bind(gl),
        isVertexArray: gl.isVertexArray.bind(gl)
      };
    } else {
      const extVAO: OES_vertex_array_object = gl.getExtension('OES_vertex_array_object');
      return extVAO
        ? {
            createVertexArray: extVAO.createVertexArrayOES.bind(extVAO),
            bindVertexArray: extVAO.bindVertexArrayOES.bind(extVAO),
            deleteVertexArray: extVAO.deleteVertexArrayOES.bind(extVAO),
            isVertexArray: extVAO.isVertexArrayOES.bind(extVAO)
          }
        : null;
    }
  }
  /** @internal */
  private handleContextLost() {
    this._isRendering = this.isRendering;
    this.exitLoop();
    console.log('handle context lost');
    this.invalidateAll();
    this.dispatchEvent(new DeviceLostEvent());
  }
  /** @internal */
  private handleContextRestored() {
    console.log('handle context restored');
    this.initContextState();
    this._textureSamplerMap = new WeakMap();
    this._currentProgram = null;
    this._currentVertexData = null;
    this._currentStateSet = null;
    this._currentBindGroups = [];
    this._currentBindGroupOffsets = [];
    this._currentViewport = null;
    this._currentScissorRect = null;
    this._samplerCache = new SamplerCache(this);
    if (this._isRendering) {
      this._isRendering = false;
      this.reloadAll().then(() => {
        this.dispatchEvent(new DeviceRestoreEvent());
        this.runLoop(this.runLoopFunction);
      });
    }
  }
  /** @internal */
  private initContextState() {
    this._deviceCaps = {
      miscCaps: new WebGLMiscCaps(this._context),
      framebufferCaps: new WebGLFramebufferCaps(this._context),
      shaderCaps: new WebGLShaderCaps(this._context),
      textureCaps: new WebGLTextureCaps(this._context)
    };
    this._vaoExt = this.createVertexArrayObjectEXT();
    this._instancedArraysExt = this.createInstancedArraysEXT();
    this._drawBuffersExt = this.createDrawBuffersEXT();
    this._context.pixelStorei(WebGLEnum.UNPACK_COLORSPACE_CONVERSION_WEBGL, WebGLEnum.NONE);
    this._context.pixelStorei(WebGLEnum.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.setViewport(null);
    this.setScissor(null);
    this._context.enable(WebGLEnum.SCISSOR_TEST);
    this.enableGPUTimeRecording(true);
    this._context._currentFramebuffer = undefined;
    this._context._currentProgram = undefined;
    this._deviceUniformBuffers = [];
    this._deviceUniformBufferOffsets = [];
    this._bindTextures = {
      [WebGLEnum.TEXTURE_2D]: [],
      [WebGLEnum.TEXTURE_CUBE_MAP]: [],
      [WebGLEnum.TEXTURE_3D]: [],
      [WebGLEnum.TEXTURE_2D_ARRAY]: []
    };
    this._bindSamplers = [];
  }
  /** @internal */
  clearErrors() {
    while (this._context.getError());
  }
  /** @internal */
  getCurrentSamplerForTexture(tex: BaseTexture) {
    return this._textureSamplerMap.get(tex);
  }
  /** @internal */
  setCurrentSamplerForTexture(tex: BaseTexture, sampler: WebGLTextureSampler) {
    this._textureSamplerMap.set(tex, sampler);
  }
  getError(throwError?: boolean): Error {
    const errcode = this._context.getError();
    const err = errcode === WebGLEnum.NO_ERROR ? null : new WebGLError(errcode);
    if (err && throwError) {
      throw err;
    }
    return err;
  }
}

let webGL1Supported = null;
let webGL2Supported = null;
const factory = makeEventTarget(WebGLDevice)<DeviceEventMap>();

async function createWebGLDevice(
  backend: DeviceBackend,
  cvs: HTMLCanvasElement,
  options?: DeviceOptions
): Promise<AbstractDevice> {
  try {
    const device = new factory(backend, cvs, options);
    await device.initContext();
    device.setViewport();
    device.setScissor();
    return device;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** @internal */
export const backend1: DeviceBackend = {
  typeName() {
    return 'webgl';
  },
  supported() {
    if (webGL1Supported === null) {
      const cvs = document.createElement('canvas');
      const gl = cvs.getContext('webgl');
      webGL1Supported = !!gl;
      cvs.width = 0;
      cvs.height = 0;
    }
    return webGL1Supported;
  },
  async createDevice(cvs, options?) {
    return createWebGLDevice(this, cvs, options);
  }
};

/** @internal */
export const backend2: DeviceBackend = {
  typeName() {
    return 'webgl2';
  },
  supported() {
    if (webGL2Supported === null) {
      const cvs = document.createElement('canvas');
      const gl = cvs.getContext('webgl2');
      webGL2Supported = !!gl;
      cvs.width = 0;
      cvs.height = 0;
    }
    return webGL2Supported;
  },
  async createDevice(cvs, options?) {
    return createWebGLDevice(this, cvs, options);
  }
};
