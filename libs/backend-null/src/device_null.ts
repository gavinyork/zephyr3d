import type { Immutable, Nullable, TypedArray } from '@zephyr3d/base';
import { REVERSE_Z } from '@zephyr3d/base';
import type {
  BaseTexture,
  BindGroup,
  BindGroupLayout,
  BufferCreationOptions,
  DeviceBackend,
  DeviceCaps,
  DeviceViewport,
  FrameBuffer,
  FrameBufferClearColors,
  FrameBufferOptions,
  GPUDataBuffer,
  GPUProgram,
  GPUProgramConstructParams,
  ITimer,
  PBStructTypeInfo,
  PrimitiveType,
  RenderBundle,
  RenderStateSet,
  SamplerOptions,
  Texture2D,
  TextureCreationOptions,
  TextureFormat,
  TextureImageElement,
  TextureMipmapData,
  VertexLayout,
  VertexLayoutOptions
} from '@zephyr3d/device';
import { BaseDevice } from '@zephyr3d/device';
import { createNullDeviceCaps } from './capabilities_null';
import { NullBaseTexture } from './basetexture_null';
import { NullBindGroup } from './bindgroup_null';
import { NullFrameBuffer } from './framebuffer_null';
import { NullGPUBuffer, NullIndexBuffer } from './buffer_null';
import { NullGPUProgram } from './gpuprogram_null';
import { NullSamplerCache } from './sampler_null';
import { NullStructuredBuffer } from './structuredbuffer_null';
import { NullTexture2D } from './texture2d_null';
import { NullTexture2DArray } from './texture2darray_null';
import { NullTexture3D } from './texture3d_null';
import { NullTextureCube } from './texturecube_null';
import { NullTextureVideo } from './texturevideo_null';
import { NullVertexLayout } from './vertexlayout_null';
import {
  NullBlendingState,
  NullColorState,
  NullDepthState,
  NullRasterizerState,
  NullRenderStateSet,
  NullStencilState
} from './renderstate_null';
import type { NullCommand, NullDeviceOptions, NullDeviceType } from './types';

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

type NullRenderBundleEntry = {
  program: Nullable<GPUProgram>;
  bindGroups: BindGroup[];
  bindGroupOffsets: Nullable<Iterable<number>>[];
  vertexLayout: Nullable<VertexLayout>;
  renderStateSet: Nullable<RenderStateSet>;
  primitiveType: PrimitiveType;
  first: number;
  count: number;
  numInstances: number;
};

/**
 * A rendering device without a GPU.
 *
 * @remarks
 * Every device object is a plain JavaScript object whose state is fully
 * observable, so device-facing logic can be unit tested without mocking the
 * device interface. Draw and clear calls are recorded instead of executed, see
 * {@link NullDevice.commands}.
 *
 * The device reports the type given at creation time (default 'webgl2'), which
 * selects the shader language emitted by the program builder and the device
 * specific code paths taken by the engine.
 *
 * @public
 */
export class NullDevice extends BaseDevice {
  /** @internal */
  private readonly _type: NullDeviceType;
  /** @internal */
  private readonly _deviceCaps: DeviceCaps;
  /** @internal */
  private readonly _clipSpaceZeroToOne: boolean;
  /** @internal */
  private readonly _strict: boolean;
  /** @internal */
  private readonly _msaaSampleCount: number;
  /** @internal */
  private readonly _samplerCache: NullSamplerCache;
  /** @internal */
  private readonly _commands: NullCommand[];
  /** @internal */
  private readonly _recordCommands: boolean;
  /** @internal */
  private readonly _maxCommandLogSize: number;
  /** @internal */
  private _contextLost: boolean;
  /** @internal */
  private _reverseWindingOrder: boolean;
  /** @internal */
  private _currentFramebuffer: Nullable<FrameBuffer>;
  /** @internal */
  private _currentProgram: Nullable<GPUProgram>;
  /** @internal */
  private _currentVertexLayout: Nullable<VertexLayout>;
  /** @internal */
  private _currentStateSet: Nullable<RenderStateSet>;
  /** @internal */
  private _currentBindGroups: BindGroup[];
  /** @internal */
  private _currentBindGroupOffsets: Nullable<Iterable<number>>[];
  /** @internal */
  private _currentViewport: DeviceViewport;
  /** @internal */
  private _currentScissor: DeviceViewport;
  /** @internal */
  private _captureRenderBundle: Nullable<NullRenderBundleEntry[]>;
  /** @internal */
  private _nextFrameHandle: number;
  /** @internal */
  private readonly _nextFrameCallbacks: Map<number, ReturnType<typeof setTimeout>>;
  constructor(backend: DeviceBackend, cvs: HTMLCanvasElement, options?: NullDeviceOptions) {
    super(cvs, backend, options?.dpr ?? 1);
    this._type = options?.type ?? 'webgl2';
    this._deviceCaps = createNullDeviceCaps(this._type, options?.caps);
    this._clipSpaceZeroToOne =
      options?.clipSpaceZeroToOne ??
      (this._type === 'webgpu' || (REVERSE_Z && this._deviceCaps.miscCaps.supportClipControl));
    this._strict = !!options?.strict;
    this._msaaSampleCount = options?.msaa && this._type !== 'webgl' ? 4 : 1;
    this._samplerCache = new NullSamplerCache(this);
    this._commands = [];
    this._recordCommands = options?.recordCommands ?? true;
    this._maxCommandLogSize = options?.maxCommandLogSize ?? 4096;
    this._contextLost = false;
    this._reverseWindingOrder = false;
    this._currentFramebuffer = null;
    this._currentProgram = null;
    this._currentVertexLayout = null;
    this._currentStateSet = null;
    this._currentBindGroups = [];
    this._currentBindGroupOffsets = [];
    this._currentViewport = this.createDefaultViewport();
    this._currentScissor = this.createDefaultViewport();
    this._captureRenderBundle = null;
    this._nextFrameHandle = 0;
    this._nextFrameCallbacks = new Map();
    // A null device never presents, so there is no vertical blank to wait for.
    // Running unsynchronized also keeps runLoop() off requestAnimationFrame,
    // which does not exist in a headless host.
    this._vSync = false;
  }
  /** The device type reported to the engine and to the program builder */
  get type() {
    return this._type;
  }
  /** Commands recorded by this device, oldest first */
  get commands(): Immutable<NullCommand[]> {
    return this._commands;
  }
  /** Whether validation problems are reported by throwing */
  get strict() {
    return this._strict;
  }
  /** Discards all recorded commands */
  clearCommands() {
    this._commands.length = 0;
  }
  /**
   * Gets the recorded commands of a given type.
   * @param type - The command type to filter by
   * @returns The matching commands, oldest first
   */
  getCommands<T extends NullCommand['type']>(type: T) {
    return this._commands.filter((cmd): cmd is Extract<NullCommand, { type: T }> => cmd.type === type);
  }
  /**
   * Counts the recorded commands of a given type.
   * @param type - The command type to count
   * @returns The number of matching commands
   */
  getCommandCount(type: NullCommand['type']) {
    let count = 0;
    for (const cmd of this._commands) {
      if (cmd.type === type) {
        count++;
      }
    }
    return count;
  }
  /** @internal */
  record(command: NullCommand) {
    if (!this._recordCommands) {
      return;
    }
    this._commands.push(command);
    if (this._commands.length > this._maxCommandLogSize) {
      this._commands.splice(0, this._commands.length - this._maxCommandLogSize);
    }
  }
  /** @internal */
  recordGenerateMipmaps(texture: BaseTexture) {
    this.record({
      type: 'generateMipmaps',
      frame: this._frameInfo.frameCounter,
      texture
    });
  }
  /** @internal */
  recordReadPixels(index: number, x: number, y: number, width: number, height: number) {
    this.record({
      type: 'readPixels',
      frame: this._frameInfo.frameCounter,
      framebuffer: this._currentFramebuffer,
      index,
      x,
      y,
      width,
      height
    });
  }
  // ─── Device information ────────────────────────────────────────────
  getAdapterInfo() {
    return {
      vendor: 'zephyr3d',
      renderer: `null(${this._type})`,
      version: '1.0'
    };
  }
  getDeviceCaps(): Immutable<DeviceCaps> {
    return this._deviceCaps;
  }
  get clipSpaceZeroToOne(): boolean {
    return this._clipSpaceZeroToOne;
  }
  getFrameBufferSampleCount() {
    return this.getFramebuffer()?.getSampleCount() ?? this._msaaSampleCount;
  }
  isContextLost() {
    return this._contextLost;
  }
  getDrawingBufferWidth() {
    return this._currentFramebuffer?.getWidth() || this.getBackBufferWidth();
  }
  getDrawingBufferHeight() {
    return this._currentFramebuffer?.getHeight() || this.getBackBufferHeight();
  }
  getBackBufferWidth() {
    return this._canvas.width;
  }
  getBackBufferHeight() {
    return this._canvas.height;
  }
  async initContext() {
    // No context to create; make sure the viewport matches the back buffer.
    this.setViewport(null);
    this.setScissor(null);
  }
  // ─── Object creation ──────────────────────────────────────────────
  createGPUTimer(): Nullable<ITimer> {
    return null;
  }
  createRenderStateSet() {
    return new NullRenderStateSet();
  }
  createBlendingState() {
    return new NullBlendingState();
  }
  createColorState() {
    return new NullColorState();
  }
  createRasterizerState() {
    return new NullRasterizerState();
  }
  createDepthState() {
    return new NullDepthState();
  }
  createStencilState() {
    return new NullStencilState();
  }
  createSampler(options: SamplerOptions) {
    return this._samplerCache.fetchSampler(options);
  }
  createTextureFromMipmapData<T extends BaseTexture>(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Nullable<T> {
    if (!data) {
      console.error(`Device.createTextureFromMipmapData() failed: invalid data`);
      return null;
    }
    const flags = this.parseTextureOptions(options);
    if (data.isCubemap) {
      const tex = new NullTextureCube(this);
      tex.createWithMipmapData(data, sRGB, flags);
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    } else if (data.isVolume) {
      const tex = new NullTexture3D(this);
      tex.createWithMipmapData(data, flags);
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    } else if (data.isArray) {
      const tex = new NullTexture2DArray(this);
      tex.createWithMipmapData(data, flags);
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    } else {
      const tex = new NullTexture2D(this);
      tex.createWithMipmapData(data, sRGB, flags);
      tex.samplerOptions = options?.samplerOptions ?? null;
      return tex as unknown as T;
    }
  }
  createTexture2D(format: TextureFormat, width: number, height: number, options?: TextureCreationOptions) {
    const tex = (options?.texture as NullTexture2D) ?? new NullTexture2D(this);
    if (!tex.isTexture2D()) {
      console.error('createTexture2D() failed: options.texture must be 2d texture');
      return null;
    }
    tex.createEmpty(format, width, height, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTexture2DFromImage(element: TextureImageElement, sRGB: boolean, options?: TextureCreationOptions) {
    const tex = (options?.texture as NullTexture2D) ?? new NullTexture2D(this);
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
    const tex = (options?.texture as NullTexture2DArray) ?? new NullTexture2DArray(this);
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
    let tex = options?.texture as Nullable<NullTexture2DArray>;
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
        console.error('createTexture2DArrayFromImages() failed');
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
    if (!this._deviceCaps.textureCaps.support3DTexture) {
      console.error('device does not support 3d texture');
      return null;
    }
    const tex = (options?.texture as NullTexture3D) ?? new NullTexture3D(this);
    if (!tex.isTexture3D()) {
      console.error('createTexture3D() failed: options.texture must be 3d texture');
      return null;
    }
    tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createCubeTexture(format: TextureFormat, size: number, options?: TextureCreationOptions) {
    const tex = (options?.texture as NullTextureCube) ?? new NullTextureCube(this);
    if (!tex.isTextureCube()) {
      console.error('createCubeTexture() failed: options.texture must be cube texture');
      return null;
    }
    tex.createEmpty(format, size, this.parseTextureOptions(options));
    tex.samplerOptions = options?.samplerOptions ?? null;
    return tex;
  }
  createTextureVideo(el: HTMLVideoElement, samplerOptions?: SamplerOptions) {
    const tex = new NullTextureVideo(this, el);
    tex.samplerOptions = samplerOptions ?? null;
    return tex;
  }
  createGPUProgram(params: GPUProgramConstructParams) {
    return new NullGPUProgram(this, params);
  }
  createBindGroup(layout: Immutable<BindGroupLayout>) {
    return new NullBindGroup(this, layout);
  }
  createBuffer(sizeInBytes: number, options: BufferCreationOptions) {
    return new NullGPUBuffer(this, this.parseBufferOptions(options), sizeInBytes);
  }
  createIndexBuffer(
    data: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    options?: BufferCreationOptions
  ) {
    return new NullIndexBuffer(this, data, this.parseBufferOptions(options, 'index'));
  }
  createStructuredBuffer(
    structureType: PBStructTypeInfo,
    options?: BufferCreationOptions,
    data?: TypedArray
  ) {
    return new NullStructuredBuffer(this, structureType, this.parseBufferOptions(options), data);
  }
  createVertexLayout(options: VertexLayoutOptions) {
    return new NullVertexLayout(this, options);
  }
  createFrameBuffer(
    colorAttachments: BaseTexture[],
    depthAttachment: Nullable<BaseTexture>,
    options?: Nullable<FrameBufferOptions>
  ) {
    return new NullFrameBuffer(this, colorAttachments, depthAttachment, options);
  }
  // ─── Copying ──────────────────────────────────────────────────────
  copyBuffer(
    sourceBuffer: GPUDataBuffer,
    destBuffer: GPUDataBuffer,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  ) {
    if (!(sourceBuffer instanceof NullGPUBuffer) || !(destBuffer instanceof NullGPUBuffer)) {
      this.reportError('copyBuffer() failed: buffers must be created by this device');
      return;
    }
    if (srcOffset + bytes > sourceBuffer.byteLength || dstOffset + bytes > destBuffer.byteLength) {
      this.reportError('copyBuffer() failed: copy range out of bounds');
      return;
    }
    destBuffer.memory.set(sourceBuffer.memory.subarray(srcOffset, srcOffset + bytes), dstOffset);
  }
  copyTexture2D(src: Texture2D, srcLevel: number, dst: Texture2D, dstLevel: number) {
    if (!src?.isTexture2D() || !dst?.isTexture2D()) {
      this.reportError('copyTexture2D(): invalid texture');
      return;
    }
    if (!Number.isInteger(srcLevel) || srcLevel < 0 || srcLevel >= src.mipLevelCount) {
      this.reportError('copyTexture2D(): invalid source mipmap level');
      return;
    }
    if (!Number.isInteger(dstLevel) || dstLevel < 0 || dstLevel >= dst.mipLevelCount) {
      this.reportError('copyTexture2D(): invalid destination mipmap level');
      return;
    }
    this.record({
      type: 'copyTexture',
      frame: this._frameInfo.frameCounter,
      src,
      srcLevel,
      dst,
      dstLevel
    });
    this.copyTextureLevel(src, 0, srcLevel, dst, 0, dstLevel);
  }
  copyFramebufferToTexture2D(src: FrameBuffer, index: number, dst: Texture2D, level: number) {
    if (!src?.isFramebuffer() || !dst?.isTexture2D()) {
      this.reportError('copyFramebufferToTexture2D(): invalid framebuffer or texture');
      return;
    }
    if (!Number.isInteger(level) || level < 0 || level >= dst.mipLevelCount) {
      this.reportError('copyFramebufferToTexture2D(): invalid mipmap level');
      return;
    }
    const tex = src.getColorAttachments()[index];
    if (!tex || !tex.isTexture2D()) {
      this.reportError('copyFramebufferToTexture2D(): Color attachment is not a 2D texture');
      return;
    }
    if (tex.format !== dst.format) {
      this.reportError(
        'copyFramebufferToTexture2D(): Color attachment must have same format with destination texture'
      );
      return;
    }
    const srcLevel = src.getColorAttachmentMipLevel(index);
    if (
      Math.max(tex.width >> srcLevel, 1) !== Math.max(dst.width >> level, 1) ||
      Math.max(tex.height >> srcLevel, 1) !== Math.max(dst.height >> level, 1)
    ) {
      this.reportError('Source texture and destination texture must have same size');
      return;
    }
    this.record({
      type: 'copyFramebufferToTexture',
      frame: this._frameInfo.frameCounter,
      src,
      index,
      dst,
      level
    });
    this.copyTextureLevel(tex, src.getColorAttachmentLayer(index), srcLevel, dst, 0, level);
  }
  // ─── Device state ─────────────────────────────────────────────────
  setViewport(vp: Nullable<Immutable<number[] | DeviceViewport>>) {
    this._currentViewport = this.resolveRect(vp);
  }
  getViewport(): Immutable<DeviceViewport> {
    return this._currentViewport;
  }
  setScissor(scissor: Nullable<Immutable<number[] | DeviceViewport>>) {
    this._currentScissor = this.resolveRect(scissor);
  }
  getScissor(): Immutable<DeviceViewport> {
    return this._currentScissor;
  }
  setProgram(program: Nullable<GPUProgram>) {
    this._currentProgram = program;
  }
  getProgram() {
    return this._currentProgram;
  }
  setVertexLayout(vertexData: Nullable<VertexLayout>) {
    this._currentVertexLayout = vertexData;
  }
  getVertexLayout() {
    return this._currentVertexLayout;
  }
  setRenderStates(renderStates: Nullable<RenderStateSet>) {
    this._currentStateSet = renderStates;
  }
  getRenderStates() {
    return this._currentStateSet;
  }
  getFramebuffer() {
    return this._currentFramebuffer;
  }
  setBindGroup(index: number, bindGroup: BindGroup, dynamicOffsets?: Nullable<Iterable<number>>) {
    this._currentBindGroups[index] = bindGroup;
    this._currentBindGroupOffsets[index] = dynamicOffsets ?? null;
  }
  getBindGroup(index: number): [BindGroup, Nullable<Iterable<number>>] {
    return [this._currentBindGroups[index], this._currentBindGroupOffsets[index]];
  }
  reverseVertexWindingOrder(reverse: boolean) {
    this._reverseWindingOrder = !!reverse;
  }
  isWindingOrderReversed() {
    return this._reverseWindingOrder;
  }
  setFont() {
    // A null device draws no text, so there is no font to select. Overridden
    // because the default implementation needs a 2d canvas for glyph rasterization.
  }
  setTextRenderStates() {
    // See setFont()
  }
  drawText() {
    // See setFont()
  }
  // ─── Frame and command submission ─────────────────────────────────
  clearFrameBuffer(
    clearColor: FrameBufferClearColors,
    clearDepth: Nullable<number>,
    clearStencil: Nullable<number>
  ) {
    const targetCount = this._currentFramebuffer?.getColorAttachments().length ?? 1;
    if (Array.isArray(clearColor) && clearColor.length > targetCount) {
      this.reportError(
        `clearFrameBuffer(): clear color count (${clearColor.length}) exceeds framebuffer color attachment count (${targetCount})`
      );
    }
    this.record({
      type: 'clear',
      frame: this._frameInfo.frameCounter,
      framebuffer: this._currentFramebuffer,
      color: clearColor,
      depth: clearDepth,
      stencil: clearStencil
    });
    (this._currentFramebuffer as Nullable<NullFrameBuffer>)?.invalidateMipmaps();
  }
  flush() {
    this.record({ type: 'flush', frame: this._frameInfo.frameCounter });
  }
  nextFrame(callback: () => void) {
    const handle = ++this._nextFrameHandle;
    const timer = setTimeout(() => {
      this._nextFrameCallbacks.delete(handle);
      callback();
    }, 0);
    this._nextFrameCallbacks.set(handle, timer);
    return handle;
  }
  cancelNextFrame(handle: number) {
    const timer = this._nextFrameCallbacks.get(handle);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._nextFrameCallbacks.delete(handle);
    }
  }
  exitLoop() {
    // BaseDevice.exitLoop() cancels through cancelAnimationFrame() unless the
    // loop handle is 0; a null device always schedules through nextFrame().
    if (this._runningLoop !== null) {
      this.cancelNextFrame(this._runningLoop);
      this._runningLoop = null;
    }
  }
  async readPixels(index: number, x: number, y: number, w: number, h: number, buffer: TypedArray) {
    const fb = this._currentFramebuffer;
    const texture = fb ? fb.getColorAttachments()[index] : null;
    this.recordReadPixels(index, x, y, w, h);
    if (texture instanceof NullBaseTexture) {
      texture.readRegion(
        x,
        y,
        w,
        h,
        fb!.getColorAttachmentLayer(index),
        fb!.getColorAttachmentMipLevel(index),
        buffer
      );
    } else {
      // The back buffer has no backing storage on a null device.
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0);
    }
  }
  readPixelsToBuffer(index: number, x: number, y: number, w: number, h: number, buffer: GPUDataBuffer) {
    const dest = new Uint8Array(buffer.byteLength);
    void this.readPixels(index, x, y, w, h, dest);
    buffer.bufferSubData(0, dest);
  }
  beginCapture() {
    if (this._captureRenderBundle) {
      throw new Error('Device.beginCapture() failed: device is already capturing draw commands');
    }
    this._captureRenderBundle = [];
  }
  endCapture(): RenderBundle {
    if (!this._captureRenderBundle) {
      throw new Error('Device.endCapture() failed: device is not capturing draw commands');
    }
    const result = this._captureRenderBundle;
    this._captureRenderBundle = null;
    return result;
  }
  looseContext() {
    if (!this._contextLost) {
      this._contextLost = true;
      this.invalidateAll();
      this.dispatchEvent('devicelost');
    }
  }
  restoreContext() {
    if (this._contextLost) {
      this._contextLost = false;
      this.reloadAll();
      this.dispatchEvent('devicerestored');
    }
  }
  /** @internal */
  protected onBeginFrame() {
    this.record({ type: 'beginFrame', frame: this._frameInfo.frameCounter });
    return !this._contextLost;
  }
  /** @internal */
  protected onEndFrame() {
    this.record({ type: 'endFrame', frame: this._frameInfo.frameCounter });
  }
  /** @internal */
  protected _setFramebuffer(rt: Nullable<FrameBuffer>) {
    if (rt !== this._currentFramebuffer) {
      this._currentFramebuffer?.unbind();
      this._currentFramebuffer = null;
      if (rt) {
        if (rt.bind()) {
          this._currentFramebuffer = rt;
        }
      }
      this.record({
        type: 'setFramebuffer',
        frame: this._frameInfo.frameCounter,
        framebuffer: this._currentFramebuffer
      });
      this.setViewport(null);
      this.setScissor(null);
    }
  }
  /** @internal */
  protected _handleResize(_cssWidth: number, _cssHeight: number, deviceWidth: number, deviceHeight: number) {
    this._canvas.width = deviceWidth;
    this._canvas.height = deviceHeight;
    this.setViewport(this._currentViewport);
    this.setScissor(this._currentScissor);
  }
  /** @internal */
  protected _draw(primitiveType: PrimitiveType, first: number, count: number) {
    this.submitDraw(primitiveType, first, count, 0);
  }
  /** @internal */
  protected _drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number) {
    this.submitDraw(primitiveType, first, count, numInstances);
  }
  /** @internal */
  protected _drawIndirect(
    primitiveType: PrimitiveType,
    indirectBuffer: GPUDataBuffer,
    indirectOffset: number
  ) {
    this.submitIndirectDraw(primitiveType, indirectBuffer, indirectOffset, false);
  }
  /** @internal */
  protected _drawIndexedIndirect(
    primitiveType: PrimitiveType,
    indirectBuffer: GPUDataBuffer,
    indirectOffset: number
  ) {
    this.submitIndirectDraw(primitiveType, indirectBuffer, indirectOffset, true);
  }
  /** @internal */
  protected _compute(workgroupCountX: number, workgroupCountY: number, workgroupCountZ: number) {
    if (this._type !== 'webgpu') {
      throw new Error(`${this._type} device does not support compute shader`);
    }
    this._currentProgram?.use();
    this.record({
      type: 'compute',
      frame: this._frameInfo.frameCounter,
      program: this._currentProgram,
      workgroupCount: [workgroupCountX, workgroupCountY, workgroupCountZ]
    });
  }
  /** @internal */
  protected _executeRenderBundle(renderBundle: RenderBundle): number {
    const entries = renderBundle as NullRenderBundleEntry[];
    for (const drawcall of entries) {
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
    return entries.length;
  }
  /** @internal */
  private submitDraw(primitiveType: PrimitiveType, first: number, count: number, numInstances: number) {
    if (this._currentProgram) {
      this._currentProgram.use();
      for (let i = 0; i < this._currentProgram.bindGroupLayouts.length; i++) {
        if (!this._currentBindGroups[i]) {
          this.reportError(
            `Missing bind group (${i}) when drawing with program '${this._currentProgram.name}'`
          );
          return;
        }
      }
    }
    this._currentStateSet?.apply();
    this.record({
      type: 'draw',
      frame: this._frameInfo.frameCounter,
      framebuffer: this._currentFramebuffer,
      program: this._currentProgram,
      primitiveType,
      first,
      count,
      numInstances
    });
    (this._currentFramebuffer as Nullable<NullFrameBuffer>)?.invalidateMipmaps();
    if (this._captureRenderBundle) {
      this._captureRenderBundle.push({
        program: this._currentProgram,
        bindGroups: [...this._currentBindGroups],
        bindGroupOffsets: this._currentBindGroupOffsets.map((val) => (val ? [...val] : null)),
        vertexLayout: this._currentVertexLayout,
        renderStateSet: this._currentStateSet?.clone() ?? null,
        primitiveType,
        first,
        count,
        numInstances
      });
    }
  }
  /** @internal */
  private submitIndirectDraw(
    primitiveType: PrimitiveType,
    indirectBuffer: GPUDataBuffer,
    indirectOffset: number,
    indexed: boolean
  ) {
    if (!this._deviceCaps.miscCaps.supportDrawIndirect) {
      throw new Error(`${this._type} device does not support indirect draw`);
    }
    if (!indirectBuffer) {
      this.reportError('drawIndirect() failed: indirect buffer is null');
      return;
    }
    this._currentProgram?.use();
    this._currentStateSet?.apply();
    this.record({
      type: 'drawIndirect',
      frame: this._frameInfo.frameCounter,
      framebuffer: this._currentFramebuffer,
      program: this._currentProgram,
      primitiveType,
      indexed,
      indirectOffset
    });
    (this._currentFramebuffer as Nullable<NullFrameBuffer>)?.invalidateMipmaps();
  }
  /** @internal */
  private copyTextureLevel(
    src: BaseTexture,
    srcLayer: number,
    srcLevel: number,
    dst: BaseTexture,
    dstLayer: number,
    dstLevel: number
  ) {
    if (!(src instanceof NullBaseTexture) || !(dst instanceof NullBaseTexture)) {
      return;
    }
    const data = src.getLevelData(srcLayer, srcLevel);
    dst.setLevelData(dstLayer, dstLevel, data ? new Uint8Array(data) : new Uint8Array(0));
  }
  /** @internal */
  private resolveRect(rect: Nullable<Immutable<number[] | DeviceViewport>>): DeviceViewport {
    if (rect === null || rect === undefined || (!Array.isArray(rect) && (rect as DeviceViewport).default)) {
      return this.createDefaultViewport();
    }
    if (Array.isArray(rect)) {
      return {
        x: rect[0],
        y: rect[1],
        width: rect[2],
        height: rect[3],
        default: false
      };
    }
    return Object.assign({}, rect as DeviceViewport, { default: false });
  }
  /** @internal */
  private createDefaultViewport(): DeviceViewport {
    return {
      x: 0,
      y: 0,
      width: this.deviceXToScreen(this.getDrawingBufferWidth()),
      height: this.deviceYToScreen(this.getDrawingBufferHeight()),
      default: true
    };
  }
  /** @internal */
  reportFramebufferError(message: string) {
    this.reportError(message);
  }
  /** @internal */
  private reportError(message: string) {
    if (this._strict) {
      throw new Error(message);
    }
    console.error(message);
  }
}

/** @internal */
export const DEFAULT_CANVAS_WIDTH = DEFAULT_WIDTH;
/** @internal */
export const DEFAULT_CANVAS_HEIGHT = DEFAULT_HEIGHT;
