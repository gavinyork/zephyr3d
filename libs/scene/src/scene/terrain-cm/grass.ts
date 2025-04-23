import { AbstractDevice, IndexBuffer, StructuredBuffer, Texture2D } from '@zephyr3d/device';
import { Application, Disposable, DRef } from '../../app';
import { nextPowerOf2 } from '@zephyr3d/base';
import { Primitive } from '../../render';

export const MAX_INSTANCES_PER_NODE = 16384;

export type GrassLayer = {
  texture: DRef<Texture2D>;
  bladeWidth: number;
  bladeHeight: number;
};

export type GrassInstanceInfo = {
  x: number;
  y: number;
  angle: number;
};
// Two floats
const INSTANCE_BYTES = 3 * 4;

export class GrassInstances implements Disposable {
  private static _baseVertexBuffer: DRef<StructuredBuffer> = new DRef();
  private static _indexBuffer: DRef<IndexBuffer> = new DRef();
  private _numInstances: number;
  private _instanceBuffer: DRef<StructuredBuffer>;
  private _primitive: DRef<Primitive>;
  private _disposed: boolean;
  constructor() {
    this._numInstances = 0;
    this._instanceBuffer = new DRef();
    this._primitive = new DRef();
    this._disposed = false;
  }
  get numInstances() {
    return this._numInstances;
  }
  private static _getIndexBuffer(device: AbstractDevice) {
    if (!this._indexBuffer.get()) {
      this._indexBuffer.set(
        device.createIndexBuffer(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]))
      );
    }
    return this._indexBuffer.get();
  }
  private static _getBaseVertexBuffer(device: AbstractDevice) {
    if (!this._baseVertexBuffer.get()) {
      const r = 0.5;
      const t = 1;
      const c = r * Math.cos(Math.PI / 3);
      const s = r * Math.sin(Math.PI / 3);
      const vertices = new Float32Array([
        r,
        0,
        0,
        0,
        1,
        r,
        t,
        0,
        0,
        0,
        -r,
        t,
        0,
        1,
        0,
        -r,
        0,
        0,
        1,
        1,

        c,
        0,
        s,
        0,
        1,
        -c,
        0,
        -s,
        1,
        1,
        -c,
        t,
        -s,
        1,
        0,
        c,
        t,
        s,
        0,
        0,

        -c,
        0,
        s,
        0,
        1,
        c,
        0,
        -s,
        1,
        1,
        c,
        t,
        -s,
        1,
        0,
        -c,
        t,
        s,
        0,
        0
      ]);
      const baseVertexBuffer = device.createInterleavedVertexBuffer(
        ['position_f32x3', 'tex0_f32x2'],
        vertices
      );
      this._baseVertexBuffer.set(baseVertexBuffer);
    }
    return this._baseVertexBuffer.get();
  }
  get disposed() {
    return this._disposed;
  }
  draw(device: AbstractDevice) {
    if (!this._primitive.get()) {
      const primitive = new Primitive();
      primitive.setVertexBuffer(GrassInstances._getBaseVertexBuffer(device));
      primitive.setVertexBuffer(this._instanceBuffer.get(), 'instance');
      primitive.setIndexBuffer(GrassInstances._getIndexBuffer(device));
      primitive.primitiveType = 'triangle-list';
      primitive.indexStart = 0;
      primitive.indexCount = GrassInstances._getIndexBuffer(device).length;
      this._primitive.set(primitive);
    }
    this._primitive.get().draw();
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
      const newBuffer = device.createVertexBuffer('tex1_f32x3', new Uint8Array(nextPowerOf2(bytesRequired)));
      device.copyBuffer(buffer, newBuffer, 0, 0, offset);
      buffer = newBuffer;
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
    }
    const data = new Float32Array(3 * instances.length);
    for (let i = 0; i < instances.length; i++) {
      data[i * 3 + 0] = instances[i].x;
      data[i * 3 + 1] = instances[i].y;
      data[i * 3 + 2] = instances[i].angle;
    }
    buffer.bufferSubData(offset, data);
    this._numInstances += instances.length;
  }
}

export class GrassQuadtreeNode implements Disposable {
  private _grassInstances: GrassInstances;
  private _children: GrassQuadtreeNode[];
  private _disposed: boolean;
  private _minX: number;
  private _minY: number;
  private _maxX: number;
  private _maxY: number;
  constructor() {
    this._grassInstances = new GrassInstances();
    this._children = null;
    this._disposed = false;
    this._minX = 0;
    this._minY = 0;
    this._maxX = 1;
    this._maxY = 1;
  }
  addInstances(instances: GrassInstanceInfo[]) {
    const n = Math.min(instances.length, MAX_INSTANCES_PER_NODE - this._grassInstances.numInstances);
    this._grassInstances.addInstances(instances.slice(0, n));
    if (n < instances.length) {
      if (!this._children) {
        this._children = [
          new GrassQuadtreeNode(),
          new GrassQuadtreeNode(),
          new GrassQuadtreeNode(),
          new GrassQuadtreeNode()
        ];
        this._children[0]._minX = this._minX;
        this._children[0]._minY = this._minY;
        this._children[0]._maxX = (this._minX + this._maxX) * 0.5;
        this._children[0]._maxY = (this._minY + this._maxY) * 0.5;
        this._children[1]._minX = this._children[0]._maxX;
        this._children[1]._minY = this._minY;
        this._children[1]._maxX = this._maxX;
        this._children[1]._maxY = this._children[0]._maxY;
        this._children[2]._minX = this._minX;
        this._children[2]._minY = this._children[0]._maxY;
        this._children[2]._maxX = this._children[0]._maxX;
        this._children[2]._maxY = this._maxY;
        this._children[3]._minX = this._children[0]._maxX;
        this._children[3]._minY = this._children[0]._maxY;
        this._children[3]._maxX = this._maxX;
        this._children[3]._maxY = this._maxY;
      }
      for (const child of this._children) {
        child.addInstances(
          instances.filter(
            (val) =>
              val.x >= child._minX && val.y >= child._minY && val.x < child._maxX && val.y < child._maxY
          )
        );
      }
    }
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
