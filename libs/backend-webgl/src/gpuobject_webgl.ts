import type {
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
  GPUObject,
  AbstractDevice
} from '@zephyr3d/device';
import { genDefaultName } from '@zephyr3d/device';
import type { WebGLDevice } from './device_webgl';
import { makeEventTarget } from '@zephyr3d/base';

let _uniqueId = 0;

export abstract class WebGLGPUObject<T>
  extends makeEventTarget(Object)<{ disposed: [] }>()
  implements GPUObject<T>
{
  protected _device: WebGLDevice;
  protected _object: T;
  protected _uid: number;
  protected _cid: number;
  protected _name: string;
  protected _disposed: boolean;
  protected _restoreHandler: (obj: GPUObject) => void;
  constructor(device: WebGLDevice) {
    super();
    this._device = device;
    this._object = null;
    this._uid = ++_uniqueId;
    this._cid = 1;
    this._name = `${genDefaultName(this)}#${this._uid}`;
    this._restoreHandler = null;
    this._disposed = false;
    this._device.addGPUObject(this);
  }
  get device(): AbstractDevice {
    this.dispatchEvent('disposed');
    return this._device;
  }
  get object(): T {
    return this._object;
  }
  get disposed(): boolean {
    return this._disposed;
  }
  get restoreHandler(): (obj: GPUObject) => void {
    return this._restoreHandler;
  }
  set restoreHandler(handler: (obj: GPUObject) => void) {
    this._restoreHandler = handler;
  }
  get uid(): number {
    return this._uid;
  }
  get cid(): number {
    return this._cid;
  }
  get name(): string {
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
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._device.disposeObject(this, true);
    }
  }
  reload(): void {
    if (this._disposed) {
      this._device.restoreObject(this);
      this._cid++;
    }
  }
  destroy(): void {
    throw new Error('Abstract function call: destroy()');
  }
  restore(): void {
    throw new Error('Abstract function call: restore()');
  }
}
