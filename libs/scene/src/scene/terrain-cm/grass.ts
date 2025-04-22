import { StructuredBuffer, Texture2D } from '@zephyr3d/device';
import { Application, Disposable, DRef } from '../../app';
import { nextPowerOf2 } from '@zephyr3d/base';

export const MAX_INSTANCES_PER_NODE = 16384;

export type GrassLayer = {
  texture: DRef<Texture2D>;
  bladeWidth: number;
  bladeHeight: number;
};

export type GrassInstanceInfo = {
  x: number;
  y: number;
};
// Two floats
const INSTANCE_BYTES = 2 * 4;

export class GrassInstances implements Disposable {
  private _numInstances: number;
  private _instanceBuffer: DRef<StructuredBuffer>;
  private _disposed: boolean;
  constructor() {
    this._numInstances = 0;
    this._instanceBuffer = new DRef();
    this._disposed = false;
  }
  get disposed() {
    return this._disposed;
  }
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._instanceBuffer.dispose();
    }
  }
  addInstances(instances: GrassInstanceInfo[]) {
    if (instances.length === 0) {
      return;
    }
    const device = Application.instance.device;
    if (!this._instanceBuffer.get()) {
      this._instanceBuffer.set(
        device.createVertexBuffer('position_f32x2', new Uint8Array(instances.length * INSTANCE_BYTES))
      );
    }
    let buffer = this._instanceBuffer.get();
    const currentBytes = buffer.byteLength;
    const bytesRequired = (this._numInstances + instances.length) * INSTANCE_BYTES;
    const offset = this._numInstances * INSTANCE_BYTES;
    if (currentBytes < bytesRequired) {
      const newBuffer = device.createVertexBuffer(
        'position_f32x2',
        new Uint8Array(nextPowerOf2(bytesRequired))
      );
      device.copyBuffer(buffer, newBuffer, 0, 0, offset);
      buffer = newBuffer;
      this._instanceBuffer.set(buffer);
    }
    const data = new Float32Array(2 * instances.length);
    for (let i = 0; i < instances.length; i++) {
      data[i * 2 + 0] = instances[i].x;
      data[i * 2 + 1] = instances[i].y;
    }
    buffer.bufferSubData(offset, data);
    this._numInstances += instances.length;
  }
}

export class GrassQuadtreeNode implements Disposable {
  private _grassInstances: GrassInstances;
  private _children: GrassQuadtreeNode[];
  private _disposed: boolean;
  constructor() {
    this._grassInstances = new GrassInstances();
    this._children = null;
    this._disposed = false;
  }
  get disposed() {
    return this._disposed;
  }
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._grassInstances.dispose();
      if (this._children) {
        for (const child of this._children) {
          child.dispose();
        }
      }
    }
  }
}
