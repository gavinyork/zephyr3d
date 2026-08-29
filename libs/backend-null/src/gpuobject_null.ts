import type {
  AbstractDevice,
  BaseTexture,
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUObject,
  GPUProgram,
  Texture2D,
  Texture2DArray,
  Texture3D,
  TextureCube,
  TextureSampler,
  TextureVideo,
  VertexLayout
} from '@zephyr3d/device';
import { genDefaultName } from '@zephyr3d/device';
import { Disposable, type Nullable } from '@zephyr3d/base';
import type { NullDevice } from './device_null';

let _uniqueId = 0;

/**
 * Base class of all gpu objects created by a null device
 * @public
 */
export abstract class NullGPUObject<T = unknown> extends Disposable implements GPUObject<T> {
  protected _device: NullDevice;
  protected _object: Nullable<T>;
  protected _uid: number;
  protected _cid: number;
  protected _name: string;
  protected _restoreHandler: Nullable<(obj: GPUObject) => void>;
  constructor(device: NullDevice) {
    super();
    this._device = device;
    this._object = null;
    this._uid = ++_uniqueId;
    this._cid = 1;
    this._name = genDefaultName(this);
    this._restoreHandler = null;
    this._device.addGPUObject(this);
  }
  get device(): AbstractDevice {
    return this._device as unknown as AbstractDevice;
  }
  get object() {
    return this._object;
  }
  get restoreHandler() {
    return this._restoreHandler;
  }
  set restoreHandler(handler: Nullable<(obj: GPUObject) => void>) {
    this._restoreHandler = handler;
  }
  get uid() {
    return this._uid;
  }
  get cid() {
    return this._cid;
  }
  get name() {
    return this._name;
  }
  set name(val: string) {
    if (val !== this._name) {
      const lastName = this._name;
      this._name = val;
      this._device.dispatchEvent('gpuobject_rename', this, lastName);
    }
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
    this._object = null;
  }
  restore() {
    this._object = this._createFakeObject();
  }
  protected onDispose() {
    super.onDispose();
    this._device.disposeObject(this, true);
  }
  /**
   * Creates the placeholder object that stands in for the native GPU handle.
   * @returns The placeholder object
   * @internal
   */
  protected _createFakeObject(): Nullable<T> {
    return {} as T;
  }
}
