import {
  AbstractDevice,
  DeviceGPUObjectRenameEvent,
  genDefaultName,
  BindGroup,
  VertexLayout,
  TextureSampler,
  BaseTexture,
  Texture2D,
  Texture2DArray,
  Texture3D,
  TextureCube,
  TextureVideo,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  GPUObject
} from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import { makeEventTarget } from '@zephyr3d/base';

let _uniqueId = 0;

export abstract class WebGPUObject<T> extends makeEventTarget(Object)<{ disposed: null }>() implements GPUObject<T> {
  protected _device: WebGPUDevice;
  protected _object: T;
  protected _uid: number;
  protected _cid: number;
  protected _name: string;
  protected _queueState: number;
  protected _restoreHandler: (tex: GPUObject) => Promise<void>;
  constructor(device: WebGPUDevice) {
    super();
    this._device = device;
    this._object = null;
    this._uid = ++_uniqueId;
    this._cid = 1;
    this._name = `${genDefaultName(this)}#${this._uid}`;
    this._queueState = 0;
    this._restoreHandler = null;
    this._device.addGPUObject(this);
  }
  get device(): AbstractDevice {
    return this._device;
  }
  get object(): T {
    return this._object;
  }
  get uid(): number {
    return this._uid;
  }
  get cid(): number {
    return this._cid;
  }
  get disposed(): boolean {
    return !this._object;
  }
  get restoreHandler(): (obj: GPUObject) => Promise<void> {
    return this._restoreHandler;
  }
  set restoreHandler(handler: (obj: GPUObject) => Promise<void>) {
    this._restoreHandler = handler;
  }
  get name(): string {
    return this._name;
  }
  set name(val: string) {
    if (val !== this._name) {
      const evt = new DeviceGPUObjectRenameEvent(this, this._name);
      this._name = val;
      this._device.dispatchEvent(evt);
    }
  }
  get queueState(): number {
    return this._queueState;
  }
  set queueState(val: number) {
    this._queueState = val;
  }
  isVertexLayout(): this is VertexLayout {
    return false;
  }
  isFramebuffer(): this is FrameBuffer {
    return false;
  }
  isSampler(): this is TextureSampler {
    return false;
  }
  isTexture(): this is BaseTexture {
    return false;
  }
  isTexture2D(): this is Texture2D {
    return false;
  }
  isTexture2DArray(): this is Texture2DArray {
    return false;
  }
  isTexture3D(): this is Texture3D {
    return false;
  }
  isTextureCube(): this is TextureCube {
    return false;
  }
  isTextureVideo(): this is TextureVideo {
    return false;
  }
  isProgram(): this is GPUProgram {
    return false;
  }
  isBuffer(): this is GPUDataBuffer {
    return false;
  }
  isBindGroup(): this is BindGroup {
    return false;
  }
  dispose() {
    if (!this.disposed) {
      this._device.disposeObject(this, true);
    }
  }
  async reload(): Promise<void> {
    if (this.disposed) {
      const p = this._device.restoreObject(this);
      this._cid++;
      return p;
    }
  }
  destroy(): void {
    throw new Error('Abstract function call: dispose()');
  }
  async restore(): Promise<void> {
    throw new Error('Abstract function call: restore()');
  }
}
