import type { Vector4, TypedArray, Immutable, Nullable } from '@zephyr3d/base';
import type {
  FrameBufferOptions,
  SamplerOptions,
  Texture2D,
  VertexLayout,
  GPUDataBuffer,
  FrameBuffer,
  GPUProgram,
  BindGroupLayout,
  BindGroup,
  TextureMipmapData,
  TextureImageElement,
  TextureCreationOptions,
  BufferCreationOptions,
  VertexLayoutOptions,
  GPUProgramConstructParams,
  DeviceCaps,
  DeviceOptions,
  RenderStateSet,
  PBStructTypeInfo,
  PrimitiveType,
  TextureFormat,
  DeviceBackend,
  DeviceViewport,
  BaseTexture,
  RenderBundle
} from '@zephyr3d/device';
import { getTextureFormatBlockSize, BaseDevice } from '@zephyr3d/device';
import { WebGPUProgram } from './gpuprogram_webgpu';
import { WebGPUBindGroup } from './bindgroup_webgpu';
import { WebGPUTexture2D } from './texture2d_webgpu';
import { WebGPUTexture2DArray } from './texture2darray_webgpu';
import { WebGPUTexture3D } from './texture3d_webgpu';
import { WebGPUTextureCube } from './texturecube_webgpu';
import { WebGPUTextureVideo } from './texturevideo_webgpu';
import {
  WebGPUTextureCaps,
  WebGPUFramebufferCaps,
  WebGPUMiscCaps,
  WebGPUShaderCaps
} from './capabilities_webgpu';
import { WebGPUVertexLayout } from './vertexlayout_webgpu';
import { PipelineCache } from './pipeline_cache';
import {
  WebGPUBlendingState,
  WebGPUColorState,
  WebGPUDepthState,
  WebGPURasterizerState,
  WebGPURenderStateSet,
  WebGPUStencilState
} from './renderstates_webgpu';
import { WebGPUBuffer } from './buffer_webgpu';
import { WebGPUFrameBuffer } from './framebuffer_webgpu';
import { WebGPUIndexBuffer } from './indexbuffer_webgpu';
import { BindGroupCache } from './bindgroup_cache';
import { VertexLayoutCache } from './vertexlayout_cache';
import { SamplerCache } from './sampler_cache';
import { CommandQueueImmediate } from './commandqueue';
import { WebGPUStructuredBuffer } from './structuredbuffer_webgpu';
import { textureFormatInvMap } from './constants_webgpu';
import { WebGPUBaseTexture } from './basetexture_webgpu';

type WebGPURenderBundle = {
  dc: number;
  encoder: GPURenderBundleEncoder;
  renderBundle: Nullable<GPURenderBundle>;
};

export class WebGPUDevice extends BaseDevice {
  private _context!: GPUCanvasContext;
  private _device!: GPUDevice;
  private _adapter!: GPUAdapter;
  private _deviceCaps!: DeviceCaps;
  private _reverseWindingOrder: boolean;
  private _canRender!: boolean;
  private _backBufferFormat!: GPUTextureFormat;
  private _depthFormat!: GPUTextureFormat;
  private _defaultMSAAColorTexture: Nullable<GPUTexture>;
  private _defaultMSAAColorTextureView: Nullable<GPUTextureView>;
  private _defaultDepthTexture!: GPUTexture;
  private _defaultDepthTextureView!: GPUTextureView;
  private _pipelineCache!: PipelineCache;
  private _bindGroupCache!: BindGroupCache;
  private _vertexLayoutCache!: VertexLayoutCache;
  private readonly _samplerCache: SamplerCache;
  private _currentProgram: Nullable<WebGPUProgram>;
  private _currentVertexData: Nullable<WebGPUVertexLayout>;
  private _currentStateSet: Nullable<WebGPURenderStateSet>;
  private _currentBindGroups: WebGPUBindGroup[];
  private _currentBindGroupOffsets: Nullable<Iterable<number>>[];
  private _commandQueue!: CommandQueueImmediate;
  private _gpuObjectHashCounter: number;
  private readonly _gpuObjectHasher: WeakMap<GPUObjectBase, number>;
  private _defaultRenderPassDesc!: GPURenderPassDescriptor;
  private readonly _sampleCount: number;
  private _emptyBindGroup!: GPUBindGroup;
  private _captureRenderBundle: Nullable<WebGPURenderBundle>;
  private _adapterInfo: any;
  constructor(backend: DeviceBackend, cvs: HTMLCanvasElement, options?: DeviceOptions) {
    super(cvs, backend, options?.dpr);
    this._reverseWindingOrder = false;
    this._defaultMSAAColorTexture = null;
    this._defaultMSAAColorTextureView = null;
    this._currentProgram = null;
    this._currentVertexData = null;
    this._currentStateSet = null;
    this._currentBindGroups = [];
    this._currentBindGroupOffsets = [];
    this._sampleCount = options?.msaa ? 4 : 1;
    this._gpuObjectHasher = new WeakMap();
    this._gpuObjectHashCounter = 1;
    this._captureRenderBundle = null;
    this._samplerCache = new SamplerCache(this);
    this._adapterInfo = {};
  }
  get context() {
    return this._context;
  }
  getFrameBufferSampleCount() {
    return this.getFramebuffer()?.getSampleCount() ?? this._sampleCount;
  }
  get device() {
    return this._device;
  }
  get adapter() {
    return this._adapter;
  }
  get commandQueue() {
    return this._commandQueue;
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
  get pipelineCache() {
    return this._pipelineCache;
  }
  get backbufferFormat() {
    return this._backBufferFormat;
  }
  get backbufferDepthFormat() {
    return this._depthFormat;
  }
  get defaultDepthTexture() {
    return this._defaultDepthTexture;
  }
  get defaultDepthTextureView() {
    return this._defaultDepthTextureView;
  }
  get defaultMSAAColorTextureView() {
    return this._defaultMSAAColorTextureView;
  }
  get defaultRenderPassDesc() {
    return this._defaultRenderPassDesc;
  }
  get sampleCount() {
    return this._sampleCount;
  }
  get currentPass() {
    return this._commandQueue.currentPass;
  }
  get emptyBindGroup() {
    return this._emptyBindGroup;
  }
  getAdapterInfo() {
    return this._adapterInfo;
  }
  isContextLost() {
    return false;
  }
  getDeviceCaps(): Immutable<DeviceCaps> {
    return this._deviceCaps;
  }
  getDrawingBufferWidth() {
    return this.getFramebuffer()?.getWidth() || this.canvas.width;
  }
  getDrawingBufferHeight() {
    return this.getFramebuffer()?.getHeight() || this.canvas.height;
  }
  getBackBufferWidth() {
    return this.canvas.width;
  }
  getBackBufferHeight() {
    return this.canvas.height;
  }
  async initContext() {
    if (!navigator.gpu) {
      throw new Error('No browser support for WebGPU');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('WebGPU: requestAdapter() failed');
    }
    this._adapter = adapter;
    this._adapterInfo = this._adapter.info ?? {};
    this._device = await this._adapter.requestDevice({
      requiredFeatures: [...this._adapter.features] as GPUFeatureName[],
      requiredLimits: { ...this._adapter.limits } as any
    });
    console.info('WebGPU device features:');
    for (const feature of this._device.features) {
      console.info(` - ${feature}`);
    }
    this.device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      this._canRender = false;
    });
    this._emptyBindGroup = this.device.createBindGroup({
      layout: this.device.createBindGroupLayout({ entries: [] }),
      entries: []
    });
    const context = (this.canvas.getContext('webgpu') as unknown as GPUCanvasContext) || null;
    if (!context) {
      this._canRender = false;
      throw new Error('WebGPU: getContext() failed');
    }
    this._context = context;
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    this._deviceCaps = {
      textureCaps: new WebGPUTextureCaps(this),
      framebufferCaps: new WebGPUFramebufferCaps(this),
      miscCaps: new WebGPUMiscCaps(this),
      shaderCaps: new WebGPUShaderCaps(this)
    };
    this.configure();

    this._pipelineCache = new PipelineCache(this);
    this._bindGroupCache = new BindGroupCache(this);
    this._vertexLayoutCache = new VertexLayoutCache();
    this._commandQueue = new CommandQueueImmediate(this);
    this._canRender = true;
    this.setViewport(null);
    this.setScissor(null);

    await this.initResizer();
  }
  protected _handleResize(
    _cssWidth: number,
    _cssHeight: number,
    deviceWidth: number,
    deviceHeight: number
  ): void {
    this.canvas.width = deviceWidth;
    this.canvas.height = deviceHeight;
    this.createDefaultRenderAttachments();
    this.setViewport(null);
    this.setScissor(null);
  }
  nextFrame(callback: () => void) {
    this._commandQueue.finish().then(callback);
    return 0;
  }
  cancelNextFrame(_handle: number) {
    return;
  }
  clearFrameBuffer(
    clearColor: Nullable<Vector4>,
    clearDepth: Nullable<number>,
    clearStencil: Nullable<number>
  ) {
    this._commandQueue.clear(clearColor, clearDepth, clearStencil);
  }
  // factory
  createGPUTimer() {
    // throw new Error('not implemented');
    return null;
  }
  createRenderStateSet() {
    return new WebGPURenderStateSet(this);
  }
  createBlendingState() {
    return new WebGPUBlendingState();
  }
  createColorState() {
    return new WebGPUColorState();
  }
  createRasterizerState() {
    return new WebGPURasterizerState();
  }
  createDepthState() {
    return new WebGPUDepthState();
  }
  createStencilState() {
    return new WebGPUStencilState();
  }
  createSampler(options: SamplerOptions) {
    return this.fetchSampler(options);
  }
  createTextureFromMipmapData<T extends BaseTexture>(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ) {
    if (!data) {
      console.error(`Device.createTextureFromMipmapData() failed: invalid data`);
      return null;
    }
    if (data.isCubemap) {
      const tex = new WebGPUTextureCube(this);
      tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    } else if (data.isVolume) {
      const tex = new WebGPUTexture3D(this);
      tex.createWithMipmapData(data, this.parseTextureOptions(options));
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    } else if (data.isArray) {
      const tex = new WebGPUTexture2DArray(this);
      tex.createWithMipmapData(data, this.parseTextureOptions(options));
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    } else {
      const tex = new WebGPUTexture2D(this);
      tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    }
  }
  createTexture2D(format: TextureFormat, width: number, height: number, options?: TextureCreationOptions) {
    const tex = (options?.texture as WebGPUTexture2D) ?? new WebGPUTexture2D(this);
    if (!tex.isTexture2D()) {
      console.error('createTexture2D() failed: options.texture must be 2d texture');
      return null;
    }
    tex.createEmpty(format, width, height, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DFromImage(element: TextureImageElement, sRGB: boolean, options?: TextureCreationOptions) {
    const tex = (options?.texture as WebGPUTexture2D) ?? new WebGPUTexture2D(this);
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
  ) {
    const tex = (options?.texture as WebGPUTexture2DArray) ?? new WebGPUTexture2DArray(this);
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
  ) {
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
    let tex: Nullable<WebGPUTexture2DArray> = options?.texture as WebGPUTexture2DArray;
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
      if (!tex) {
        return null;
      }
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
  ) {
    const tex = (options?.texture as WebGPUTexture3D) ?? new WebGPUTexture3D(this);
    if (!tex.isTexture3D()) {
      console.error('createTexture3D() failed: options.texture must be 3d texture');
      return null;
    }
    tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createCubeTexture(format: TextureFormat, size: number, options?: TextureCreationOptions) {
    const tex = (options?.texture as WebGPUTextureCube) ?? new WebGPUTextureCube(this);
    if (!tex.isTextureCube()) {
      console.error('createCubeTexture() failed: options.texture must be cube texture');
      return null;
    }
    tex.createEmpty(format, size, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTextureVideo(el: HTMLVideoElement, samplerOptions?: SamplerOptions) {
    const tex = new WebGPUTextureVideo(this, el);
    tex.samplerOptions = samplerOptions ?? null;
    return tex;
  }
  copyFramebufferToTexture2D(src: FrameBuffer, index: number, dst: Texture2D, level: number) {
    if (!src?.isFramebuffer() || !dst?.isTexture2D()) {
      console.error('copyFramebufferToTexture2D(): invalid texture');
      return;
    }
    const srcTex = src.getColorAttachments()?.[index];
    if (!srcTex || !srcTex.isTexture2D()) {
      console.error('copyFramebufferToTexture2D(): Color attachment is not a 2D texture');
      return;
    }
    this.copyTexture2D(srcTex, src.getColorAttachmentMipLevel(index), dst, level);
  }
  copyTexture2D(src: Texture2D, srcLevel: number, dst: Texture2D, dstLevel: number) {
    if (!src?.isTexture2D() || !dst?.isTexture2D()) {
      console.error('CopyTexture2D(): invalid texture');
      return;
    }
    if (!Number.isInteger(srcLevel) || srcLevel < 0 || srcLevel >= src.mipLevelCount) {
      console.error('CopyTexture2D(): invalid source mipmap level');
      return;
    }
    if (!Number.isInteger(dstLevel) || dstLevel < 0 || dstLevel >= dst.mipLevelCount) {
      console.error('CopyTexture2D(): invalid destination mipmap level');
      return;
    }
    const srcWidth = Math.max(src.width >> srcLevel, 1);
    const srcHeight = Math.max(src.height >> srcLevel, 1);
    const dstWidth = Math.max(dst.width >> dstLevel, 1);
    const dstHeight = Math.max(dst.height >> dstLevel, 1);
    if (srcWidth !== dstWidth || srcHeight !== dstHeight) {
      console.error('Source texture and destination texture must have same size');
      return;
    }
    if (src.format !== dst.format) {
      console.error('CopyTexture2D(): Source texture and destination texture must have same format');
      return;
    }
    this.flush();
    const srcTex = src as WebGPUTexture2D;
    const dstTex = dst as WebGPUTexture2D;
    const commandEncoder = this._device!.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      {
        texture: srcTex.object!,
        mipLevel: srcLevel,
        origin: { x: 0, y: 0, z: 0 }
      },
      {
        texture: dstTex.object!,
        mipLevel: dstLevel,
        origin: { x: 0, y: 0, z: 0 }
      },
      {
        width: srcWidth,
        height: srcHeight,
        depthOrArrayLayers: 1
      }
    );
    this._device!.queue.submit([commandEncoder.finish()]);
  }
  createGPUProgram(params: GPUProgramConstructParams) {
    return new WebGPUProgram(this, params);
  }
  createBindGroup(layout: Immutable<BindGroupLayout>) {
    return new WebGPUBindGroup(this, layout);
  }
  createBuffer(sizeInBytes: number, options: BufferCreationOptions) {
    return new WebGPUBuffer(this, this.parseBufferOptions(options), sizeInBytes);
  }
  copyBuffer(
    sourceBuffer: GPUDataBuffer<unknown>,
    destBuffer: GPUDataBuffer<unknown>,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  ) {
    this._commandQueue.copyBuffer(
      sourceBuffer as WebGPUBuffer,
      destBuffer as WebGPUBuffer,
      srcOffset,
      dstOffset,
      bytes
    );
  }
  createIndexBuffer(
    data: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    options?: BufferCreationOptions
  ) {
    return new WebGPUIndexBuffer(this, data, this.parseBufferOptions(options, 'index'));
  }
  createStructuredBuffer(structureType: PBStructTypeInfo, options: BufferCreationOptions, data?: TypedArray) {
    return new WebGPUStructuredBuffer(this, structureType, this.parseBufferOptions(options), data);
  }
  createVertexLayout(options: VertexLayoutOptions) {
    return new WebGPUVertexLayout(this, options);
  }
  createFrameBuffer(
    colorAttachments: BaseTexture[],
    depthAttachement: BaseTexture,
    options?: FrameBufferOptions
  ) {
    return new WebGPUFrameBuffer(this, colorAttachments, depthAttachement, options);
  }
  setBindGroup(index: number, bindGroup: BindGroup, dynamicOffsets?: Nullable<Iterable<number>>) {
    this._currentBindGroups[index] = bindGroup as WebGPUBindGroup;
    this._currentBindGroupOffsets[index] = dynamicOffsets ?? bindGroup?.getDynamicOffsets() ?? null;
  }
  getBindGroup(index: number): [BindGroup, Nullable<Iterable<number>>] {
    return [this._currentBindGroups[index], this._currentBindGroupOffsets[index]];
  }
  // render related
  setViewport(vp: Nullable<Immutable<number[] | DeviceViewport>>) {
    this._commandQueue.setViewport(vp);
  }
  getViewport(): Immutable<DeviceViewport> {
    return this._commandQueue.getViewport();
  }
  setScissor(scissor: Nullable<Immutable<number[] | DeviceViewport>>) {
    this._commandQueue.setScissor(scissor);
  }
  getScissor(): Immutable<DeviceViewport> {
    return this._commandQueue.getScissor();
  }
  setProgram(program: Nullable<GPUProgram>) {
    this._currentProgram = program as WebGPUProgram;
  }
  getProgram() {
    return this._currentProgram;
  }
  setVertexLayout(vertexData: Nullable<VertexLayout>) {
    this._currentVertexData = vertexData as WebGPUVertexLayout;
  }
  getVertexLayout() {
    return this._currentVertexData;
  }
  setRenderStates(stateSet: Nullable<RenderStateSet>) {
    this._currentStateSet = stateSet as WebGPURenderStateSet;
  }
  getRenderStates() {
    return this._currentStateSet;
  }
  getFramebuffer() {
    return this._commandQueue.getFramebuffer();
  }
  reverseVertexWindingOrder(reverse: boolean): void {
    this._reverseWindingOrder = !!reverse;
  }
  isWindingOrderReversed(): boolean {
    return this._reverseWindingOrder;
  }
  /** @internal */
  isBufferUploading(buffer: WebGPUBuffer) {
    return this._commandQueue.isBufferUploading(buffer);
  }
  /** @internal */
  isTextureUploading(tex: WebGPUBaseTexture) {
    return this._commandQueue.isTextureUploading(tex);
  }
  /** @internal */
  getFramebufferInfo() {
    return this._commandQueue.getFramebufferInfo();
  }
  /** @internal */
  gpuGetObjectHash(obj: GPUObjectBase) {
    return this._gpuObjectHasher.get(obj) ?? null;
  }
  /** @internal */
  gpuCreateTexture(desc: GPUTextureDescriptor) {
    const tex = this._device!.createTexture(desc);
    if (tex) {
      this._gpuObjectHasher.set(tex, ++this._gpuObjectHashCounter);
    }
    return tex;
  }
  /** @internal */
  gpuImportExternalTexture(el: HTMLVideoElement) {
    const tex = this._device!.importExternalTexture({ source: el });
    if (tex) {
      this._gpuObjectHasher.set(tex, ++this._gpuObjectHashCounter);
    }
    return tex;
  }
  /** @internal */
  gpuCreateSampler(desc: GPUSamplerDescriptor) {
    const sampler = this._device!.createSampler(desc);
    if (sampler) {
      this._gpuObjectHasher.set(sampler, ++this._gpuObjectHashCounter);
    }
    return sampler;
  }
  /** @internal */
  gpuCreateBindGroup(desc: GPUBindGroupDescriptor) {
    const bindGroup = this._device!.createBindGroup(desc);
    if (bindGroup) {
      this._gpuObjectHasher.set(bindGroup, ++this._gpuObjectHashCounter);
    }
    return bindGroup;
  }
  /** @internal */
  gpuCreateBuffer(desc: GPUBufferDescriptor) {
    const buffer = this._device!.createBuffer(desc);
    if (buffer) {
      this._gpuObjectHasher.set(buffer, ++this._gpuObjectHashCounter);
    }
    return buffer;
  }
  /** @internal */
  gpuCreateTextureView(texture: GPUTexture, desc?: GPUTextureViewDescriptor) {
    const view = texture?.createView(desc);
    if (view) {
      this._gpuObjectHasher.set(view, ++this._gpuObjectHashCounter);
    }
    return view;
  }
  /** @internal */
  gpuCreateRenderPipeline(desc: GPURenderPipelineDescriptor) {
    const pipeline = this._device!.createRenderPipeline(desc);
    if (pipeline) {
      this._gpuObjectHasher.set(pipeline, ++this._gpuObjectHashCounter);
    }
    return pipeline;
  }
  /** @internal */
  gpuCreateComputePipeline(desc: GPUComputePipelineDescriptor) {
    const pipeline = this._device!.createComputePipeline(desc);
    if (pipeline) {
      this._gpuObjectHasher.set(pipeline, ++this._gpuObjectHashCounter);
    }
    return pipeline;
  }
  /** @internal */
  fetchVertexLayout(hash: string) {
    return this._vertexLayoutCache.fetchVertexLayout(hash);
  }
  /** @internal */
  fetchSampler(options: SamplerOptions) {
    return this._samplerCache.fetchSampler(options);
  }
  /** @internal */
  fetchBindGroupLayout(desc: Immutable<BindGroupLayout>) {
    return this._bindGroupCache.fetchBindGroupLayout(desc);
  }
  flush(): void {
    this._commandQueue.flush();
  }
  async readPixels(index: number, x: number, y: number, w: number, h: number, buffer: TypedArray) {
    const fb = this.getFramebuffer();
    const colorAttachment = fb
      ? (fb.getColorAttachments()[index]?.object as GPUTexture)
      : this.context!.getCurrentTexture();
    const texFormat = fb
      ? fb.getColorAttachments()[index]?.format
      : textureFormatInvMap[this._backBufferFormat];
    if (colorAttachment && texFormat) {
      const pixelSize = getTextureFormatBlockSize(texFormat);
      const bufferSize = w * h * pixelSize;
      const stagingBuffer = this.createBuffer(bufferSize, {
        usage: 'read'
      });
      this.readPixelsToBuffer(0, x, y, w, h, stagingBuffer);
      const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      await stagingBuffer.getBufferSubData(data);
      stagingBuffer.dispose();
    } else {
      console.error('readPixels() failed: no color attachment0 or unrecoganized color attachment format');
    }
  }
  readPixelsToBuffer(index: number, x: number, y: number, w: number, h: number, buffer: GPUDataBuffer) {
    const fb = this.getFramebuffer();
    const colorAttachment = fb
      ? (fb.getColorAttachments()[index]?.object as GPUTexture)
      : this.context!.getCurrentTexture();
    const texFormat = fb
      ? fb.getColorAttachments()[index]?.format
      : textureFormatInvMap[this._backBufferFormat];
    if (colorAttachment && texFormat) {
      this.flush();
      WebGPUBaseTexture.copyTexturePixelsToBuffer(
        this._device!,
        colorAttachment,
        texFormat,
        x,
        y,
        w,
        h,
        0,
        0,
        buffer
      );
    } else {
      console.error(
        'readPixelsToBuffer() failed: no color attachment0 or unrecoganized color attachment format'
      );
    }
  }
  looseContext() {
    // not implemented
  }
  restoreContext() {
    // not implemented
  }
  beginCapture() {
    if (this._captureRenderBundle) {
      throw new Error('Device.beginCapture() failed: device is already capturing draw commands');
    }
    const frameBuffer = this.getFramebufferInfo();
    const desc: GPURenderBundleEncoderDescriptor = {
      colorFormats: frameBuffer.colorFormats,
      depthStencilFormat: frameBuffer.depthFormat,
      sampleCount: frameBuffer.sampleCount
    };
    this._captureRenderBundle = {
      dc: 0,
      encoder: this._device!.createRenderBundleEncoder(desc),
      renderBundle: null
    };
  }
  endCapture() {
    if (!this._captureRenderBundle) {
      throw new Error('Device.endCapture() failed: device is not capturing draw commands');
    }
    this._captureRenderBundle.renderBundle = this._captureRenderBundle.encoder.finish();
    const ret = this._captureRenderBundle;
    this._captureRenderBundle = null;
    return ret;
  }
  protected _executeRenderBundle(renderBundle: RenderBundle) {
    this._commandQueue.executeRenderBundle(
      (renderBundle as WebGPURenderBundle).renderBundle as GPURenderBundle
    );
    return (renderBundle as WebGPURenderBundle).dc;
  }
  bufferUpload(buffer: WebGPUBuffer) {
    this._commandQueue.bufferUpload(buffer);
  }
  textureUpload(tex: WebGPUBaseTexture) {
    this._commandQueue.textureUpload(tex);
  }
  flushUploads() {
    this._commandQueue.flushUploads();
  }
  /** @internal */
  protected _setFramebuffer(rt: FrameBuffer) {
    this._commandQueue.setFramebuffer(rt as WebGPUFrameBuffer);
  }
  /** @internal */
  protected onBeginFrame() {
    if (this._canRender) {
      this._commandQueue.beginFrame();
      return true;
    } else {
      return false;
    }
  }
  /** @internal */
  protected onEndFrame() {
    this._commandQueue.endFrame();
  }
  /** @internal */
  protected _draw(primitiveType: PrimitiveType, first: number, count: number) {
    this._commandQueue.draw(
      this._currentProgram!,
      this._currentVertexData!,
      this._currentStateSet!,
      this._currentBindGroups,
      this._currentBindGroupOffsets,
      primitiveType,
      first,
      count,
      1
    );
    if (this._captureRenderBundle) {
      this._captureRenderBundle.dc++;
      this._commandQueue.capture(
        this._captureRenderBundle.encoder,
        this._currentProgram!,
        this._currentVertexData!,
        this._currentStateSet!,
        this._currentBindGroups,
        this._currentBindGroupOffsets,
        primitiveType,
        first,
        count,
        1
      );
    }
  }
  /** @internal */
  protected _drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number) {
    this._commandQueue.draw(
      this._currentProgram!,
      this._currentVertexData!,
      this._currentStateSet!,
      this._currentBindGroups,
      this._currentBindGroupOffsets,
      primitiveType,
      first,
      count,
      numInstances
    );
    if (this._captureRenderBundle) {
      this._captureRenderBundle.dc++;
      this._commandQueue.capture(
        this._captureRenderBundle.encoder,
        this._currentProgram!,
        this._currentVertexData!,
        this._currentStateSet!,
        this._currentBindGroups,
        this._currentBindGroupOffsets,
        primitiveType,
        first,
        count,
        numInstances
      );
    }
  }
  /** @internal */
  protected _compute(workgroupCountX: number, workgroupCountY: number, workgroupCountZ: number) {
    this._commandQueue.compute(
      this._currentProgram!,
      this._currentBindGroups,
      this._currentBindGroupOffsets,
      workgroupCountX,
      workgroupCountY,
      workgroupCountZ
    );
  }
  private configure() {
    this._backBufferFormat = navigator.gpu.getPreferredCanvasFormat();
    this._depthFormat = this._deviceCaps.framebufferCaps.supportDepth32floatStencil8
      ? 'depth32float-stencil8'
      : 'depth24plus-stencil8';
    this._context!.configure({
      device: this._device!,
      format: this._backBufferFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: 'opaque',
      colorSpace: 'srgb'
    });
    this.createDefaultRenderAttachments();
  }
  private createDefaultRenderAttachments() {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this._defaultMSAAColorTexture?.destroy();
    this._defaultMSAAColorTexture = null;
    this._defaultMSAAColorTextureView = null;
    this._defaultDepthTexture?.destroy();
    if (this._sampleCount > 1) {
      this._defaultMSAAColorTexture = this.gpuCreateTexture({
        size: {
          width,
          height,
          depthOrArrayLayers: 1
        },
        format: this._backBufferFormat,
        dimension: '2d',
        mipLevelCount: 1,
        sampleCount: this._sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
      this._defaultMSAAColorTextureView = this._defaultMSAAColorTexture.createView();
    }
    this._defaultDepthTexture = this.gpuCreateTexture({
      size: {
        width,
        height,
        depthOrArrayLayers: 1
      },
      format: this._depthFormat,
      dimension: '2d',
      mipLevelCount: 1,
      sampleCount: this._sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this._defaultDepthTextureView = this._defaultDepthTexture.createView();
    this._defaultRenderPassDesc = {
      label: `mainRenderPass:${this._sampleCount}`,
      colorAttachments: [
        {
          view: this._sampleCount > 1 ? this._defaultMSAAColorTextureView : null,
          resolveTarget: undefined,
          loadOp: 'clear',
          clearValue: [0, 0, 0, 0],
          storeOp: 'store'
        } as GPURenderPassColorAttachment
      ],
      depthStencilAttachment: {
        view: this._defaultDepthTextureView,
        depthLoadOp: 'clear',
        depthClearValue: 1,
        depthStoreOp: 'store',
        stencilLoadOp: 'clear',
        stencilClearValue: 0,
        stencilStoreOp: 'store'
      }
    };
  }
}
