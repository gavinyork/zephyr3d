import type { IndexBuffer, StructuredBuffer, Texture2D } from '@zephyr3d/device';
import type { Disposable } from '../../app';
import { DWeakRef } from '../../app';
import { Application, DRef } from '../../app';
import type { Vector4 } from '@zephyr3d/base';
import { AABB, ClipState, nextPowerOf2 } from '@zephyr3d/base';
import type { DrawContext } from '../../render';
import { Primitive } from '../../render';
import { ClipmapGrassMaterial } from './grassmaterial';
import type { ClipmapTerrain } from './terrain-cm';
import type { Camera } from '../../camera';

export const MAX_INSTANCES_PER_NODE = 2048;

export type GrassInstanceInfo = {
  x: number;
  y: number;
  angle: number;
};
// Two floats
const INSTANCE_BYTES = 4 * 4;

export class GrassInstances implements Disposable {
  private _baseVertexBuffer: DRef<StructuredBuffer>;
  private _indexBuffer: DRef<IndexBuffer>;
  private _numInstances: number;
  private _instanceBuffer: DRef<StructuredBuffer>;
  private _primitive: DRef<Primitive>;
  private _disposed: boolean;
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    this._numInstances = 0;
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._instanceBuffer = new DRef();
    this._primitive = new DRef();
    this._disposed = false;
  }
  get numInstances() {
    return this._numInstances;
  }
  get instanceBuffer(): StructuredBuffer {
    return this._instanceBuffer.get();
  }
  get disposed() {
    return this._disposed;
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._primitive.dispose();
    }
  }
  draw() {
    if (!this._primitive.get()) {
      const primitive = new Primitive();
      primitive.setVertexBuffer(this._baseVertexBuffer.get());
      primitive.setVertexBuffer(this._instanceBuffer.get(), 'instance');
      primitive.setIndexBuffer(this._indexBuffer.get());
      primitive.primitiveType = 'triangle-list';
      primitive.indexStart = 0;
      primitive.indexCount = this._indexBuffer.get().length;
      this._primitive.set(primitive);
    }
    this._primitive.get().drawInstanced(this._numInstances);
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
        device.createVertexBuffer('tex1_f32x4', new Uint8Array(instances.length * INSTANCE_BYTES))
      );
    }
    let buffer = this._instanceBuffer.get();
    const currentBytes = buffer.byteLength;
    const bytesRequired = (this._numInstances + instances.length) * INSTANCE_BYTES;
    const offset = this._numInstances * INSTANCE_BYTES;
    if (currentBytes < bytesRequired) {
      const newBuffer = device.createVertexBuffer('tex1_f32x4', new Uint8Array(nextPowerOf2(bytesRequired)));
      device.copyBuffer(buffer, newBuffer, 0, 0, offset);
      buffer = newBuffer;
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
    }
    const data = new Float32Array(4 * instances.length);
    for (let i = 0; i < instances.length; i++) {
      data[i * 4 + 0] = instances[i].x;
      data[i * 4 + 1] = instances[i].y;
      data[i * 4 + 2] = Math.sin(instances[i].angle);
      data[i * 4 + 3] = Math.cos(instances[i].angle);
    }
    buffer.bufferSubData(offset, data);
    this._numInstances += instances.length;
  }
}

export class GrassLayer implements Disposable {
  private static _indexBuffer: DRef<IndexBuffer> = new DRef();
  private _material: DRef<ClipmapGrassMaterial>;
  private _quadtree: DRef<GrassQuadtreeNode>;
  private _bladeWidth: number;
  private _bladeHeight: number;
  private _baseVertexBuffer: DRef<StructuredBuffer>;
  private _disposed: boolean;
  constructor(terrain: ClipmapTerrain, bladeWidth: number, bladeHeight: number, albedoMap?: Texture2D) {
    this._material = new DRef(new ClipmapGrassMaterial(terrain));
    this._material.get().albedoTexture = albedoMap;
    if (albedoMap) {
      this._material.get().setTextureSize(albedoMap.width, albedoMap.height);
    }
    this._bladeWidth = bladeWidth;
    this._bladeHeight = bladeHeight;
    this._baseVertexBuffer = new DRef(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
    this._disposed = false;
    this._quadtree = new DRef(
      new GrassQuadtreeNode(this._baseVertexBuffer.get(), GrassLayer._getIndexBuffer())
    );
  }
  get quadtree() {
    return this._quadtree.get();
  }
  updateMaterial() {
    this._material.get().uniformChanged();
  }
  setAlbedoMap(albedoMap: Texture2D) {
    this._material.get().albedoTexture = albedoMap;
    if (albedoMap) {
      this._material.get().setTextureSize(albedoMap.width, albedoMap.height);
    }
  }
  getAlbedoMap() {
    return this._material.get().albedoTexture;
  }
  addInstances(instances: GrassInstanceInfo[]) {
    this._quadtree.get().addInstances(instances);
  }
  get bladeWidth() {
    return this._bladeWidth;
  }
  get bladeHeight() {
    return this._bladeHeight;
  }
  set bladeWidth(val: number) {
    this.setBladeSize(val, this._bladeHeight);
  }
  set bladeHeight(val: number) {
    this.setBladeSize(this._bladeWidth, val);
  }
  setBladeSize(width: number, height: number) {
    if (width !== this._bladeWidth || height !== this._bladeHeight) {
      this._bladeWidth = width;
      this._bladeHeight = height;
      this._baseVertexBuffer.set(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
      this._quadtree.get().setBaseVertexBuffer(this._baseVertexBuffer.get());
    }
  }
  private static _getIndexBuffer() {
    if (!this._indexBuffer.get()) {
      this._indexBuffer.set(
        Application.instance.device.createIndexBuffer(
          new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11])
        )
      );
    }
    return this._indexBuffer.get();
  }
  private createBaseVertexBuffer(bladeWidth: number, bladeHeight: number) {
    const device = Application.instance.device;
    const r = bladeWidth * 0.5;
    const t = bladeHeight;
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
    return device.createInterleavedVertexBuffer(['position_f32x3', 'tex0_f32x2'], vertices);
  }
  draw(ctx: DrawContext, region: Vector4, minY: number, maxY: number) {
    this._material.get().apply(ctx);
    for (let pass = 0; pass < this._material.get().numPasses; pass++) {
      this._material.get().bind(ctx.device, pass);
      this._quadtree.get().draw(ctx.camera, region, minY, maxY, false);
    }
  }
  get disposed() {
    return this._disposed;
  }
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._material.dispose();
      this._quadtree.dispose();
      this._baseVertexBuffer.dispose();
    }
  }
}
export class GrassRenderer implements Disposable {
  private _terrain: DWeakRef<ClipmapTerrain>;
  private _layers: GrassLayer[];
  private _disposed: boolean;
  constructor(terrain: ClipmapTerrain) {
    this._terrain = new DWeakRef(terrain);
    this._layers = [];
    this._disposed = false;
  }
  updateMaterial() {
    for (const layer of this._layers) {
      layer.updateMaterial();
    }
  }
  get numLayers() {
    return this._layers.length;
  }
  getLayer(index: number) {
    return this._layers[index];
  }
  addLayer(bladeWidth: number, bladeHeight: number, albedoMap?: Texture2D): number {
    const layer = new GrassLayer(this._terrain.get(), bladeWidth, bladeHeight, albedoMap);
    this._layers.push(layer);
    return this._layers.length - 1;
  }
  getGrassTexture(layer: number) {
    return this._layers[layer]?.getAlbedoMap() ?? null;
  }
  setGrassTexture(layer: number, texture: Texture2D) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.setAlbedoMap(texture);
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  getBladeWidth(layer: number) {
    return this._layers[layer]?.bladeWidth ?? 0;
  }
  getBladeHeight(layer: number) {
    return this._layers[layer]?.bladeHeight ?? 0;
  }
  setBladeSize(layer: number, width: number, height: number) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.setBladeSize(width, height);
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  addInstances(layer: number, instances: GrassInstanceInfo[]) {
    const grassLayer = this._layers[layer];
    if (!grassLayer) {
      console.error(`Invalid grass layer: ${layer}`);
    } else {
      grassLayer.addInstances(instances);
    }
  }
  get disposed() {
    return this._disposed;
  }
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._terrain.dispose();
      for (const layer of this._layers) {
        layer.dispose();
      }
      this._layers = null;
    }
  }
  draw(ctx: DrawContext) {
    const bv = this._terrain.get().getWorldBoundingVolume().toAABB();
    const minY = bv.minPoint.y;
    const maxY = bv.maxPoint.y;
    for (const layer of this._layers) {
      layer.draw(ctx, this._terrain.get().worldRegion, minY - layer.bladeHeight, maxY + layer.bladeHeight);
    }
  }
}
export class GrassQuadtreeNode implements Disposable {
  private static _cullAABB = new AABB();
  private _grassInstances: DRef<GrassInstances>;
  private _children: GrassQuadtreeNode[];
  private _baseVertexBuffer: DRef<StructuredBuffer>;
  private _indexBuffer: DRef<IndexBuffer>;
  private _disposed: boolean;
  private _minX: number;
  private _minZ: number;
  private _maxX: number;
  private _maxZ: number;
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._grassInstances = new DRef(new GrassInstances(baseVertexBuffer, indexBuffer));
    this._children = null;
    this._disposed = false;
    this._minX = 0;
    this._minZ = 0;
    this._maxX = 1;
    this._maxZ = 1;
  }
  get grassInstances() {
    return this._grassInstances.get();
  }
  get children() {
    return this._children;
  }
  draw(camera: Camera, region: Vector4, minY: number, maxY: number, skipClipTest: boolean) {
    if (!skipClipTest) {
      const cullAABB = GrassQuadtreeNode._cullAABB;
      const x = region.x;
      const z = region.y;
      const dx = region.z - x;
      const dz = region.w - z;
      cullAABB.minPoint.setXYZ(x + this._minX * dx, minY, z + this._minZ * dz);
      cullAABB.maxPoint.setXYZ(x + this._maxX * dx, maxY, z + this._maxZ * dz);
      const clipState = camera.clipMask
        ? cullAABB.getClipStateWithFrustumMask(camera.frustum, camera.clipMask)
        : cullAABB.getClipStateWithFrustum(camera.frustum);
      if (clipState === ClipState.NOT_CLIPPED) {
        return;
      }
      skipClipTest = clipState === ClipState.A_INSIDE_B;
    }
    if (this._grassInstances.get().numInstances > 0) {
      this._grassInstances.get().draw();
    }
    if (this._children) {
      for (const child of this._children) {
        child.draw(camera, region, minY, maxY, skipClipTest);
      }
    }
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._grassInstances.get().setBaseVertexBuffer(baseVertexBuffer);
      if (this._children) {
        for (const child of this._children) {
          child.setBaseVertexBuffer(baseVertexBuffer);
        }
      }
    }
  }
  addInstances(instances: GrassInstanceInfo[]) {
    const n = Math.min(instances.length, MAX_INSTANCES_PER_NODE - this._grassInstances.get().numInstances);
    this._grassInstances.get().addInstances(instances.slice(0, n));
    if (n < instances.length) {
      if (!this._children) {
        this._children = [
          new GrassQuadtreeNode(this._baseVertexBuffer.get(), this._indexBuffer.get()),
          new GrassQuadtreeNode(this._baseVertexBuffer.get(), this._indexBuffer.get()),
          new GrassQuadtreeNode(this._baseVertexBuffer.get(), this._indexBuffer.get()),
          new GrassQuadtreeNode(this._baseVertexBuffer.get(), this._indexBuffer.get())
        ];
        this._children[0]._minX = this._minX;
        this._children[0]._minZ = this._minZ;
        this._children[0]._maxX = (this._minX + this._maxX) * 0.5;
        this._children[0]._maxZ = (this._minZ + this._maxZ) * 0.5;
        this._children[1]._minX = this._children[0]._maxX;
        this._children[1]._minZ = this._minZ;
        this._children[1]._maxX = this._maxX;
        this._children[1]._maxZ = this._children[0]._maxZ;
        this._children[2]._minX = this._minX;
        this._children[2]._minZ = this._children[0]._maxZ;
        this._children[2]._maxX = this._children[0]._maxX;
        this._children[2]._maxZ = this._maxZ;
        this._children[3]._minX = this._children[0]._maxX;
        this._children[3]._minZ = this._children[0]._maxZ;
        this._children[3]._maxX = this._maxX;
        this._children[3]._maxZ = this._maxZ;
      }
      for (const child of this._children) {
        child.addInstances(
          instances
            .slice(n)
            .filter(
              (val) =>
                val.x >= child._minX && val.y >= child._minZ && val.x < child._maxX && val.y < child._maxZ
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
