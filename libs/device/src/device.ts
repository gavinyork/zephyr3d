import type { Vector4, TypedArray, IEventTarget } from '@zephyr3d/base';
import type { ITimer } from './timer';
import { CPUTimer } from './timer';
import type { RenderStateSet } from './render_states';
import type {
  FrameBufferOptions,
  SamplerOptions,
  TextureSampler,
  Texture2D,
  Texture3D,
  TextureCube,
  VertexLayout,
  GPUDataBuffer,
  FrameBuffer,
  GPUProgram,
  GPUObject,
  StructuredBuffer,
  BindGroupLayout,
  BindGroup,
  IndexBuffer,
  TextureVideo,
  TextureMipmapData,
  TextureImageElement,
  Texture2DArray,
  TextureCreationOptions,
  BufferCreationOptions,
  BufferUsage,
  VertexSemantic,
  VertexAttribFormat,
  VertexLayoutOptions,
  BaseTexture,
  RenderBundle
} from './gpuobject';
import {
  GPUResourceUsageFlags,
  makeVertexBufferType,
  getVertexFormatSize,
  getVertexAttribFormat
} from './gpuobject';
import type { PBComputeOptions, PBRenderOptions, PBStructTypeInfo } from './builder';
import { ProgramBuilder } from './builder';
import { DeviceResizeEvent, DeviceGPUObjectAddedEvent, DeviceGPUObjectRemovedEvent } from './base_types';
import type {
  DataType,
  PrimitiveType,
  TextureFormat,
  GPUObjectList,
  FrameInfo,
  DeviceCaps,
  GPUProgramConstructParams,
  AbstractDevice,
  DeviceOptions,
  DeviceEventMap,
  DeviceViewport
} from './base_types';
import { DrawText } from './helpers';
import { Pool } from './pool';

/**
 * The device backend interface
 * @public
 */
export interface DeviceBackend {
  typeName(): string;
  supported(): boolean;
  createDevice(cvs: HTMLCanvasElement, options?: DeviceOptions): Promise<AbstractDevice>;
}

type DeviceState = {
  framebuffer: FrameBuffer;
  windowOrderReversed: boolean;
  viewport: DeviceViewport;
  scissor: DeviceViewport;
  renderStateSet: RenderStateSet;
  program: GPUProgram;
  vertexLayout: VertexLayout;
  bindGroups: [BindGroup, Iterable<number>][];
};

/**
 * Base class for rendering device
 * @public
 */
export abstract class BaseDevice {
  protected _canvas: HTMLCanvasElement;
  protected _canvasClientWidth: number;
  protected _canvasClientHeight: number;
  protected _gpuObjectList: GPUObjectList;
  protected _gpuMemCost: number;
  protected _disposeObjectList: GPUObject[];
  protected _beginFrameTime: number;
  protected _endFrameTime: number;
  protected _frameInfo: FrameInfo;
  protected _cpuTimer: CPUTimer;
  protected _gpuTimer: ITimer;
  protected _runningLoop: number;
  protected _fpsCounter: { time: number; frame: number };
  protected _runLoopFunc: (device: AbstractDevice) => void;
  protected _backend: DeviceBackend;
  protected _beginFrameCounter: number;
  protected _programBuilder: ProgramBuilder;
  protected _pool: Pool;
  protected _temporalFramebuffer: boolean;
  private _stateStack: DeviceState[];
  constructor(cvs: HTMLCanvasElement, backend: DeviceBackend) {
    this._backend = backend;
    this._gpuObjectList = {
      textures: [],
      samplers: [],
      buffers: [],
      programs: [],
      framebuffers: [],
      vertexArrayObjects: [],
      bindGroups: []
    };
    this._canvas = cvs;
    this._canvas.setAttribute('tabindex', '1');
    this._canvasClientWidth = cvs.clientWidth;
    this._canvasClientHeight = cvs.clientHeight;
    this._gpuMemCost = 0;
    this._disposeObjectList = [];
    this._beginFrameTime = 0;
    this._endFrameTime = 0;
    this._runLoopFunc = null;
    this._frameInfo = {
      frameCounter: 0,
      frameTimestamp: 0,
      elapsedTimeCPU: 0,
      elapsedTimeGPU: 0,
      elapsedFrame: 0,
      elapsedOverall: 0,
      FPS: 0,
      drawCalls: 0,
      computeCalls: 0,
      nextFrameCall: [],
      nextFrameCallNext: []
    };
    this._programBuilder = new ProgramBuilder(this);
    this._cpuTimer = new CPUTimer();
    this._gpuTimer = null;
    this._runningLoop = null;
    this._fpsCounter = { time: 0, frame: 0 };
    this._stateStack = [];
    this._beginFrameCounter = 0;
    this._pool = new Pool(this);
    this._temporalFramebuffer = false;
    this._registerEventHandlers();
  }
  abstract getFrameBufferSampleCount(): number;
  abstract isContextLost(): boolean;
  abstract getScale(): number;
  abstract getDrawingBufferWidth(): number;
  abstract getDrawingBufferHeight(): number;
  abstract getBackBufferWidth(): number;
  abstract getBackBufferHeight(): number;
  abstract getDeviceCaps(): DeviceCaps;
  abstract initContext(): Promise<void>;
  abstract clearFrameBuffer(clearColor: Vector4, clearDepth: number, clearStencil: number);
  abstract createGPUTimer(): ITimer;
  abstract createRenderStateSet(): RenderStateSet;
  abstract createSampler(options: SamplerOptions): TextureSampler;
  abstract createTextureFromMipmapData<T extends BaseTexture>(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): T;
  abstract createTexture2D(
    format: TextureFormat,
    width: number,
    height: number,
    options?: TextureCreationOptions
  ): Texture2D;
  abstract createTexture2DFromMipmapData(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2D;
  abstract createTexture2DFromImage(
    element: TextureImageElement,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2D;
  abstract createTexture2DArray(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture2DArray;
  abstract createTexture2DArrayFromMipmapData(
    data: TextureMipmapData,
    options?: TextureCreationOptions
  ): Texture2DArray;
  abstract createTexture2DArrayFromImages(
    elements: TextureImageElement[],
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2DArray;
  abstract createTexture3D(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture3D;
  abstract createCubeTexture(
    format: TextureFormat,
    size: number,
    options?: TextureCreationOptions
  ): TextureCube;
  abstract createCubeTextureFromMipmapData(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): TextureCube;
  abstract createTextureVideo(el: HTMLVideoElement, samplerOptions?: SamplerOptions): TextureVideo;
  abstract reverseVertexWindingOrder(reverse: boolean): void;
  abstract isWindingOrderReversed(): boolean;
  // program
  abstract createGPUProgram(params: GPUProgramConstructParams): GPUProgram;
  abstract createBindGroup(layout: BindGroupLayout): BindGroup;
  abstract createBuffer(sizeInBytes: number, options: BufferCreationOptions): GPUDataBuffer;
  abstract copyBuffer(
    sourceBuffer: GPUDataBuffer,
    destBuffer: GPUDataBuffer,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  );
  abstract createIndexBuffer(data: Uint16Array | Uint32Array, options?: BufferCreationOptions): IndexBuffer;
  abstract createStructuredBuffer(
    structureType: PBStructTypeInfo,
    options: BufferCreationOptions,
    data?: TypedArray
  ): StructuredBuffer;
  abstract createVertexLayout(options: VertexLayoutOptions): VertexLayout;
  abstract createFrameBuffer(
    colorAttachments: BaseTexture[],
    depthAttachment: BaseTexture,
    options?: FrameBufferOptions
  ): FrameBuffer;
  // render related
  abstract setViewport(vp?: number[] | DeviceViewport): void;
  abstract getViewport(): DeviceViewport;
  abstract setScissor(scissor?: number[] | DeviceViewport): void;
  abstract getScissor(): DeviceViewport;
  abstract setProgram(program: GPUProgram): void;
  abstract getProgram(): GPUProgram;
  abstract setVertexLayout(vertexData: VertexLayout): void;
  abstract getVertexLayout(): VertexLayout;
  abstract setRenderStates(renderStates: RenderStateSet): void;
  abstract getRenderStates(): RenderStateSet;
  abstract getFramebuffer(): FrameBuffer;
  abstract setBindGroup(index: number, bindGroup: BindGroup, dynamicOffsets?: Iterable<number>);
  abstract getBindGroup(index: number): [BindGroup, Iterable<number>];
  abstract flush(): void;
  // misc
  abstract readPixels(
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
    buffer: TypedArray
  ): Promise<void>;
  abstract readPixelsToBuffer(
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
    buffer: GPUDataBuffer
  ): void;
  abstract beginCapture(): void;
  abstract endCapture(): RenderBundle;
  abstract executeRenderBundle(renderBundle: RenderBundle);
  abstract looseContext(): void;
  abstract restoreContext(): void;
  protected abstract _draw(primitiveType: PrimitiveType, first: number, count: number): void;
  protected abstract _drawInstanced(
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ): void;
  protected abstract _compute(
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number
  ): void;
  get backend(): DeviceBackend {
    return this._backend;
  }
  get videoMemoryUsage(): number {
    return this._gpuMemCost;
  }
  get frameInfo(): FrameInfo {
    return this._frameInfo;
  }
  get isRendering(): boolean {
    return this._runningLoop !== null;
  }
  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }
  get type(): string {
    return this._backend.typeName();
  }
  get pool(): Pool {
    return this._pool;
  }
  get runLoopFunction(): (device: AbstractDevice) => void {
    return this._runLoopFunc;
  }
  get programBuilder(): ProgramBuilder {
    return this._programBuilder;
  }
  setFont(fontName: string) {
    DrawText.setFont(this, fontName);
  }
  drawText(text: string, x: number, y: number, color: string) {
    DrawText.drawText(this, text, color, x, y);
  }
  setFramebuffer(rt: FrameBuffer);
  setFramebuffer(
    color: (BaseTexture | { texture: BaseTexture; miplevel?: number; face?: number; layer?: number })[],
    depth?: BaseTexture,
    sampleCount?: number
  );
  setFramebuffer(
    colorOrRT:
      | (BaseTexture | { texture: BaseTexture; miplevel?: number; face?: number; layer?: number })[]
      | FrameBuffer,
    depth?: BaseTexture,
    sampleCount?: number
  ) {
    let newRT: FrameBuffer = null;
    let temporal = false;
    if (!Array.isArray(colorOrRT)) {
      newRT = colorOrRT ?? null;
    } else {
      const colorAttachments = colorOrRT.map((val) => (val as any).texture ?? val) as BaseTexture[];
      newRT = this._pool.createTemporalFramebuffer(false, colorAttachments, depth, sampleCount, true);
      for (let i = 0; i < colorOrRT.length; i++) {
        const rt = colorOrRT[i];
        newRT.setColorAttachmentMipLevel(i, (rt as any).texture ? (rt as any).miplevel ?? 0 : 0);
        newRT.setColorAttachmentLayer(i, (rt as any).texture ? (rt as any).face ?? 0 : 0);
        newRT.setColorAttachmentCubeFace(i, (rt as any).texture ? (rt as any).layer ?? 0 : 0);
      }
      temporal = true;
    }
    const currentRT = this.getFramebuffer();
    if (currentRT !== newRT) {
      if (this._temporalFramebuffer) {
        this._pool.releaseFrameBuffer(currentRT);
      }
      this._temporalFramebuffer = temporal;
      this._setFramebuffer(newRT);
    }
  }
  disposeObject(obj: GPUObject, remove = true) {
    if (obj) {
      if (remove) {
        this.removeGPUObject(obj);
      }
      if (!obj.disposed) {
        if (this.isContextLost()) {
          obj.destroy();
        } else {
          this._disposeObjectList.push(obj);
        }
      }
      obj.dispatchEvent(null, 'disposed');
    }
  }
  async restoreObject(obj: GPUObject) {
    if (obj && obj.disposed && !this.isContextLost()) {
      await obj.restore();
      if (obj.restoreHandler) {
        await obj.restoreHandler(obj);
      }
    }
  }
  enableGPUTimeRecording(enable: boolean) {
    if (enable && !this._gpuTimer) {
      this._gpuTimer = this.createGPUTimer();
    } else if (!enable) {
      this._gpuTimer?.end();
      this._gpuTimer = null;
    }
  }
  beginFrame(): boolean {
    if (this._beginFrameCounter === 0) {
      for (const obj of this._disposeObjectList) {
        obj.destroy();
      }
      this._disposeObjectList = [];
    }
    this._beginFrameCounter++;
    this._beginFrameTime = this._cpuTimer.now();
    this.updateFrameInfo();
    this._pool.autoRelease();
    return this.onBeginFrame();
  }
  endFrame(): void {
    if (this._beginFrameCounter > 0) {
      this._beginFrameCounter--;
      if (this._beginFrameCounter === 0) {
        this._endFrameTime = this._cpuTimer.now();
        this.onEndFrame();
      }
    }
  }
  getVertexAttribFormat(
    semantic: VertexSemantic,
    dataType: DataType,
    componentCount: number
  ): VertexAttribFormat {
    return getVertexAttribFormat(semantic, dataType, componentCount);
  }
  createInterleavedVertexBuffer(
    attribFormats: VertexAttribFormat[],
    data: TypedArray,
    options?: BufferCreationOptions
  ): StructuredBuffer {
    if (options && options.usage && options.usage !== 'vertex') {
      console.error(`createVertexBuffer() failed: options.usage must be 'vertex' or not set`);
      return null;
    }
    let size = 0;
    for (const format of attribFormats) {
      size += getVertexFormatSize(format);
    }
    const vertexBufferType = makeVertexBufferType((data.byteLength / size) >> 0, ...attribFormats);
    const opt = Object.assign(
      {
        usage: 'vertex',
        dynamic: false,
        managed: true,
        storage: false
      },
      options || {}
    );
    if (opt.storage) {
      opt.dynamic = false;
      opt.managed = false;
    }
    if (opt.dynamic) {
      opt.managed = false;
    }
    return this.createStructuredBuffer(vertexBufferType, opt, data);
  }
  createVertexBuffer(
    attribFormat: VertexAttribFormat,
    data: TypedArray,
    options?: BufferCreationOptions
  ): StructuredBuffer {
    if (options && options.usage && options.usage !== 'vertex') {
      console.error(`createVertexBuffer() failed: options.usage must be 'vertex' or not set`);
      return null;
    }
    const count = getVertexFormatSize(attribFormat);
    const vertexBufferType = makeVertexBufferType((data.byteLength / count) >> 0, attribFormat);
    const opt = Object.assign(
      {
        usage: 'vertex',
        dynamic: false,
        managed: true,
        storage: false
      },
      options || {}
    );
    if (opt.storage) {
      opt.dynamic = false;
      opt.managed = false;
    }
    if (opt.dynamic) {
      opt.managed = false;
    }
    return this.createStructuredBuffer(vertexBufferType, opt, data);
  }
  draw(primitiveType: PrimitiveType, first: number, count: number): void {
    this._frameInfo.drawCalls++;
    this._draw(primitiveType, first, count);
  }
  drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number): void {
    this._frameInfo.drawCalls++;
    this._drawInstanced(primitiveType, first, count, numInstances);
  }
  compute(workgroupCountX, workgroupCountY, workgroupCountZ): void {
    this._frameInfo.computeCalls++;
    this._compute(workgroupCountX, workgroupCountY, workgroupCountZ);
  }
  runNextFrame(f: () => void) {
    if (f) {
      this._frameInfo.nextFrameCall.push(f);
    }
  }
  exitLoop() {
    if (this._runningLoop) {
      cancelAnimationFrame(this._runningLoop);
      this._runningLoop = null;
    }
  }
  runLoop(func: (device: AbstractDevice) => void) {
    if (this._runningLoop !== null) {
      console.error('Device.runLoop() can not be nested');
      return;
    }
    if (!func) {
      console.error('Device.runLoop() argment error');
      return;
    }
    const that = this;
    that._runLoopFunc = func;
    (function entry() {
      that._runningLoop = requestAnimationFrame(entry);
      if (that.beginFrame()) {
        that._runLoopFunc(that as unknown as AbstractDevice);
        that.endFrame();
      }
    })();
  }
  pushDeviceStates() {
    this._stateStack.push({
      windowOrderReversed: this.isWindingOrderReversed(),
      framebuffer: this.getFramebuffer(),
      viewport: this.getViewport(),
      scissor: this.getScissor(),
      program: this.getProgram(),
      renderStateSet: this.getRenderStates(),
      vertexLayout: this.getVertexLayout(),
      bindGroups: [this.getBindGroup(0), this.getBindGroup(1), this.getBindGroup(2), this.getBindGroup(3)]
    });
  }
  popDeviceStates() {
    if (this._stateStack.length === 0) {
      console.error('Device.popDeviceStates(): stack is empty');
    } else {
      const top = this._stateStack.pop();
      this.setFramebuffer(top.framebuffer);
      this.setViewport(top.viewport);
      this.setScissor(top.scissor);
      this.setProgram(top.program);
      this.setRenderStates(top.renderStateSet);
      this.setVertexLayout(top.vertexLayout);
      this.setBindGroup(0, ...top.bindGroups[0]);
      this.setBindGroup(1, ...top.bindGroups[1]);
      this.setBindGroup(2, ...top.bindGroups[2]);
      this.setBindGroup(3, ...top.bindGroups[3]);
      this.reverseVertexWindingOrder(top.windowOrderReversed);
    }
  }
  getGPUObjects(): GPUObjectList {
    return this._gpuObjectList;
  }
  getGPUObjectById(uid: number): GPUObject {
    for (const list of [
      this._gpuObjectList.textures,
      this._gpuObjectList.samplers,
      this._gpuObjectList.buffers,
      this._gpuObjectList.framebuffers,
      this._gpuObjectList.programs,
      this._gpuObjectList.vertexArrayObjects
    ]) {
      for (const obj of list) {
        if (obj.uid === uid) {
          return obj;
        }
      }
    }
    return null;
  }
  screenToDevice(val: number): number {
    return this.getFramebuffer() ? val : Math.round(val * this.getScale());
  }
  deviceToScreen(val: number): number {
    return this.getFramebuffer() ? val : Math.round(val / this.getScale());
  }
  buildRenderProgram(options: PBRenderOptions): GPUProgram {
    return this._programBuilder.buildRenderProgram(options);
  }
  buildComputeProgram(options: PBComputeOptions): GPUProgram {
    return this._programBuilder.buildComputeProgram(options);
  }
  addGPUObject(obj: GPUObject) {
    const list = this.getGPUObjectList(obj);
    if (list && list.indexOf(obj) < 0) {
      list.push(obj);
      this.dispatchEvent(new DeviceGPUObjectAddedEvent(obj));
    }
  }
  removeGPUObject(obj: GPUObject) {
    const list = this.getGPUObjectList(obj);
    if (list) {
      const index = list.indexOf(obj);
      if (index >= 0) {
        list.splice(index, 1);
        this.dispatchEvent(new DeviceGPUObjectRemovedEvent(obj));
      }
    }
  }
  updateVideoMemoryCost(delta: number) {
    this._gpuMemCost += delta;
  }
  protected abstract onBeginFrame(): boolean;
  protected abstract onEndFrame(): void;
  protected abstract _setFramebuffer(fb: FrameBuffer);
  private _onresize() {
    if (
      this._canvasClientWidth !== this._canvas.clientWidth ||
      this._canvasClientHeight !== this._canvas.clientHeight
    ) {
      this._canvasClientWidth = this._canvas.clientWidth;
      this._canvasClientHeight = this._canvas.clientHeight;
      this.dispatchEvent(new DeviceResizeEvent(this._canvasClientWidth, this._canvasClientHeight));
    }
  }
  private _registerEventHandlers() {
    const canvas: HTMLCanvasElement = this._canvas;
    const that = this;
    if (window.ResizeObserver) {
      new window.ResizeObserver((entries) => {
        that._onresize();
      }).observe(canvas, {});
    } else {
      if (window.MutationObserver) {
        new MutationObserver(function (mutations) {
          if (mutations.length > 0) {
            that._onresize();
          }
        }).observe(canvas, { attributes: true, attributeFilter: ['style'] });
      }
      window.addEventListener('resize', () => {
        this._onresize();
      });
    }
  }
  private updateFrameInfo() {
    this._frameInfo.frameCounter++;
    this._frameInfo.drawCalls = 0;
    this._frameInfo.computeCalls = 0;
    const now = this._beginFrameTime;
    if (this._frameInfo.frameTimestamp === 0) {
      this._frameInfo.frameTimestamp = now;
      this._frameInfo.elapsedTimeCPU = 0;
      this._frameInfo.elapsedTimeGPU = 0;
      this._frameInfo.elapsedFrame = 0;
      this._frameInfo.elapsedOverall = 0;
      this._frameInfo.FPS = 0;
      this._fpsCounter.time = now;
      this._fpsCounter.frame = this._frameInfo.frameCounter;
      if (this._gpuTimer) {
        this._gpuTimer.begin();
      }
    } else {
      this._frameInfo.elapsedFrame = now - this._frameInfo.frameTimestamp;
      this._frameInfo.elapsedOverall += this._frameInfo.elapsedFrame;
      let gpuTime = 0;
      let cpuTime = 0;
      if (this._endFrameTime !== 0) {
        gpuTime = now - this._endFrameTime;
        cpuTime = this._endFrameTime - this._frameInfo.frameTimestamp;
      }
      this._frameInfo.frameTimestamp = now;
      if (now >= this._fpsCounter.time + 1000) {
        this._frameInfo.FPS =
          ((this._frameInfo.frameCounter - this._fpsCounter.frame) * 1000) / (now - this._fpsCounter.time);
        this._fpsCounter.time = now;
        this._fpsCounter.frame = this._frameInfo.frameCounter;
        this._frameInfo.elapsedTimeGPU = gpuTime;
        this._frameInfo.elapsedTimeCPU = cpuTime;
      }
    }
    const tmp = this._frameInfo.nextFrameCall;
    this._frameInfo.nextFrameCall = this._frameInfo.nextFrameCallNext;
    this._frameInfo.nextFrameCallNext = tmp;
    for (const f of this._frameInfo.nextFrameCallNext) {
      f();
    }
    this._frameInfo.nextFrameCallNext.length = 0;
  }
  private getGPUObjectList(obj: GPUObject): GPUObject[] {
    let list: GPUObject[] = null;
    if (obj.isTexture()) {
      list = this._gpuObjectList.textures;
    } else if (obj.isSampler()) {
      list = this._gpuObjectList.samplers;
    } else if (obj.isBuffer()) {
      list = this._gpuObjectList.buffers;
    } else if (obj.isFramebuffer()) {
      list = this._gpuObjectList.framebuffers;
    } else if (obj.isProgram()) {
      list = this._gpuObjectList.programs;
    } else if (obj.isVertexLayout()) {
      list = this._gpuObjectList.vertexArrayObjects;
    } else if (obj.isBindGroup()) {
      list = this._gpuObjectList.bindGroups;
    }
    return list;
  }
  protected invalidateAll() {
    for (const list of [
      this._gpuObjectList.buffers,
      this._gpuObjectList.textures,
      this._gpuObjectList.samplers,
      this._gpuObjectList.programs,
      this._gpuObjectList.framebuffers,
      this._gpuObjectList.vertexArrayObjects,
      this._gpuObjectList.bindGroups
    ]) {
      for (const obj of list) {
        this.disposeObject(obj, false);
      }
    }
    if (this.isContextLost()) {
      for (const obj of this._disposeObjectList) {
        obj.destroy();
      }
      this._disposeObjectList = [];
    }
  }
  protected async reloadAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const list of [
      this._gpuObjectList.buffers,
      this._gpuObjectList.textures,
      this._gpuObjectList.samplers,
      this._gpuObjectList.programs,
      this._gpuObjectList.framebuffers,
      this._gpuObjectList.vertexArrayObjects,
      this._gpuObjectList.bindGroups
    ]) {
      // obj.reload() may change the list, so make a copy first
      for (const obj of list.slice()) {
        promises.push(obj.reload());
      }
    }
    Promise.all(promises);
    return;
  }
  protected parseTextureOptions(options?: TextureCreationOptions): number {
    const noMipmapFlag =
      options?.samplerOptions?.mipFilter === 'none' ? GPUResourceUsageFlags.TF_NO_MIPMAP : 0;
    const writableFlag = options?.writable ? GPUResourceUsageFlags.TF_WRITABLE : 0;
    const dynamicFlag = options?.dynamic ? GPUResourceUsageFlags.DYNAMIC : 0;
    return noMipmapFlag | writableFlag | dynamicFlag;
  }
  protected parseBufferOptions(options: BufferCreationOptions, defaultUsage?: BufferUsage): number {
    const usage = options?.usage || defaultUsage;
    let usageFlag: number;
    switch (usage) {
      case 'uniform':
        usageFlag = GPUResourceUsageFlags.BF_UNIFORM;
        options.managed = false;
        options.dynamic = options.dynamic ?? true;
        break;
      case 'vertex':
        usageFlag = GPUResourceUsageFlags.BF_VERTEX;
        break;
      case 'index':
        usageFlag = GPUResourceUsageFlags.BF_INDEX;
        break;
      case 'read':
        usageFlag = GPUResourceUsageFlags.BF_READ;
        options.managed = false;
        break;
      case 'write':
        usageFlag = GPUResourceUsageFlags.BF_WRITE;
        options.managed = false;
        break;
      default:
        usageFlag = 0;
        break;
    }
    const storageFlag = options?.storage ?? false ? GPUResourceUsageFlags.BF_STORAGE : 0;
    const dynamicFlag = options?.dynamic ?? false ? GPUResourceUsageFlags.DYNAMIC : 0;
    const managedFlag = dynamicFlag === 0 && (options?.managed ?? true) ? GPUResourceUsageFlags.MANAGED : 0;
    return usageFlag | storageFlag | dynamicFlag | managedFlag;
  }
}

/**
 * Merge event target interface
 * @public
 */
export interface BaseDevice extends IEventTarget<DeviceEventMap> {}
