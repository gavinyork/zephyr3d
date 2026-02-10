import type {
  AbstractDevice,
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
import { genDefaultName } from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { Nullable } from '@zephyr3d/base';
import { Disposable } from '@zephyr3d/base';

let _uniqueId = 0;

export abstract class WebGPUObject<T> extends Disposable implements GPUObject<T> {
  protected _device: WebGPUDevice;
  protected _object: Nullable<T>;
  protected _uid: number;
  protected _cid: number;
  protected _name: string;
  protected _queueState: number;
  protected _restoreHandler: Nullable<(tex: GPUObject) => void>;
  constructor(device: WebGPUDevice) {
    super();
    this._device = device;
    this._object = null;
    this._uid = ++_uniqueId;
    this._cid = 1;
    this._name = genDefaultName(this);
    this._queueState = 0;
    this._restoreHandler = null;
    this._device.addGPUObject(this);
  }
  get device(): AbstractDevice {
    return this._device;
  }
  get object() {
    return this._object;
  }
  get uid() {
    return this._uid;
  }
  get cid() {
    return this._cid;
  }
  get restoreHandler() {
    return this._restoreHandler;
  }
  set restoreHandler(handler: Nullable<(obj: GPUObject) => void>) {
    this._restoreHandler = handler;
  }
  get name() {
    return this._name;
  }
  set name(val) {
    if (val !== this._name) {
      const lastName = this._name;
      this._name = val;
      this._device.dispatchEvent('gpuobject_rename', this, lastName);
    }
  }
  get queueState() {
    return this._queueState;
  }
  set queueState(val) {
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
  reload() {
    if (this.disposed) {
      this._device.restoreObject(this);
      this._cid++;
    }
  }
  destroy() {
    throw new Error('Abstract function call: dispose()');
  }
  restore() {
    throw new Error('Abstract function call: restore()');
  }
  protected onDispose() {
    super.onDispose();
    this._device.disposeObject(this, true);
  }
}
