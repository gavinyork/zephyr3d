import type { IndexBuffer, StructuredBuffer, Texture2D } from '@zephyr3d/device';
import { Application } from '../../app';
import type { Vector4 } from '@zephyr3d/base';
import { AABB, ClipState, nextPowerOf2, DRef, DWeakRef, Disposable } from '@zephyr3d/base';
import type { DrawContext } from '../../render';
import { Primitive } from '../../render';
import { ClipmapGrassMaterial } from './grassmaterial';
import type { ClipmapTerrain } from './terrain-cm';
import type { Camera } from '../../camera';

const MAX_INSTANCES_PER_NODE = 2048;

/**
 * Grass blade instance information
 * @public
 */
export type GrassInstanceInfo = {
  /** x position of the blade */
  x: number;
  /** y position of the blade */
  y: number;
  /** Rotation angle of the blade */
  angle: number;
};
// Two floats
const INSTANCE_BYTES = 4 * 4;

/**
 * Grass glade instance manager class
 * @internal
 */
export class GrassInstances extends Disposable {
  private readonly _instances: GrassInstanceInfo[];
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private readonly _indexBuffer: DRef<IndexBuffer>;
  private readonly _instanceBuffer: DRef<StructuredBuffer>;
  private readonly _primitive: DRef<Primitive>;
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    super();
    this._instances = [];
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._instanceBuffer = new DRef();
    this._primitive = new DRef();
  }
  get numInstances() {
    return this._instances.length;
  }
  get instanceBuffer(): StructuredBuffer {
    return this._instanceBuffer.get();
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._primitive.dispose();
    }
  }
  draw() {
    if (this._instances.length > 0) {
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
      this._primitive.get().drawInstanced(this._instances.length);
    }
  }
  updateBuffers() {
    const device = Application.instance.device;
    if (this._instances.length === 0) {
      this._instanceBuffer.set(null);
      return;
    }
    if (this._instances.length > 0 && !this._instanceBuffer.get()) {
      this._instanceBuffer.set(
        device.createVertexBuffer('tex1_f32x4', new Uint8Array(this._instances.length * INSTANCE_BYTES))
      );
    }
    let buffer = this._instanceBuffer.get();
    const currentBytes = buffer.byteLength;
    const bytesRequired = this._instances.length * INSTANCE_BYTES;
    if (currentBytes < bytesRequired) {
      buffer = device.createVertexBuffer('tex1_f32x4', new Uint8Array(nextPowerOf2(bytesRequired)));
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
    }
    const data = new Float32Array(4 * this._instances.length);
    for (let i = 0; i < this._instances.length; i++) {
      data[i * 4 + 0] = this._instances[i].x;
      data[i * 4 + 1] = this._instances[i].y;
      data[i * 4 + 2] = Math.sin(this._instances[i].angle);
      data[i * 4 + 3] = Math.cos(this._instances[i].angle);
    }
    buffer.bufferSubData(0, data);
  }
  removeInstances(minX: number, minZ: number, maxX: number, maxZ: number, num: number) {
    if (num <= 0) {
      return 0;
    }
    let removed = 0;
    for (let i = this._instances.length - 1; i >= 0; i--) {
      const instance = this._instances[i];
      if (instance.x >= minX && instance.x <= maxX && instance.y >= minZ && instance.y <= maxZ) {
        this._instances.splice(i, 1);
        removed++;
        if (removed === num) {
          break;
        }
      }
    }
    if (removed > 0) {
      this.updateBuffers();
    }
    return removed;
  }
  addInstances(instances: GrassInstanceInfo[]) {
    this._instances.push(...instances);
    this.updateBuffers();
  }
  protected onDispose(): void {
    super.onDispose();
    this._baseVertexBuffer.dispose();
    this._indexBuffer.dispose();
    this._instanceBuffer.dispose();
    this._primitive.dispose();
  }
}

/**
 * Grass layer class
 * @public
 */
export class GrassLayer extends Disposable {
  private static readonly _indexBuffer: DRef<IndexBuffer> = new DRef();
  private readonly _material: DRef<ClipmapGrassMaterial>;
  private readonly _quadtree: DRef<GrassQuadtreeNode>;
  private _bladeWidth: number;
  private _bladeHeight: number;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  /**
   * Creates an instance of GrassLayer
   * @param terrain - Clipmap terrain object
   * @param bladeWidth - Grass blade width
   * @param bladeHeight - Grass blade height
   * @param albedoMap - Albedo texture for the blade
   */
  constructor(terrain: ClipmapTerrain, bladeWidth: number, bladeHeight: number, albedoMap?: Texture2D) {
    super();
    this._material = new DRef(new ClipmapGrassMaterial(terrain));
    this._material.get().albedoTexture = albedoMap;
    if (albedoMap) {
      this._material.get().setTextureSize(albedoMap.width, albedoMap.height);
    }
    this._bladeWidth = bladeWidth;
    this._bladeHeight = bladeHeight;
    this._baseVertexBuffer = new DRef(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
    this._quadtree = new DRef(
      new GrassQuadtreeNode(this._baseVertexBuffer.get(), GrassLayer._getIndexBuffer())
    );
  }
  /** @internal */
  get quadtree() {
    return this._quadtree.get();
  }
  /** @internal */
  updateMaterial() {
    this._material.get().uniformChanged();
  }
  /**
   * Sets the albedo texture of grass blades in this layer
   * @param albedoMap - Albedo texture to set
   */
  setAlbedoMap(albedoMap: Texture2D) {
    this._material.get().albedoTexture = albedoMap;
    if (albedoMap) {
      this._material.get().setTextureSize(albedoMap.width, albedoMap.height);
    }
  }
  /**
   * Gets the albedo texture of grass blades in this layer
   * @returns - Albedo texture of grass blades in this layer
   */
  getAlbedoMap() {
    return this._material.get().albedoTexture;
  }
  /**
   * Add grass blades to this layer in a region
   * @param instances - Grass blade instances to add
   */
  addInstances(instances: GrassInstanceInfo[]) {
    this._quadtree.get().addInstances(instances);
  }
  /**
   * Remove grass blades to this layer in a region
   * @param minX - Minimum x position of the region
   * @param minZ - Minimum z position of the region
   * @param maxX - Maximum x position of the region
   * @param maxZ - Maximum z position of the region
   * @param numInstances - How many grass blades to add
   */
  removeInstances(minX: number, minZ: number, maxX: number, maxZ: number, numInstances: number) {
    this._quadtree.get().removeInstances(minX, minZ, maxX, maxZ, numInstances);
  }
  /** Grass blade width in this layer */
  get bladeWidth() {
    return this._bladeWidth;
  }
  set bladeWidth(val: number) {
    this.setBladeSize(val, this._bladeHeight);
  }
  /** Grass blade height in this layer */
  get bladeHeight() {
    return this._bladeHeight;
  }
  set bladeHeight(val: number) {
    this.setBladeSize(this._bladeWidth, val);
  }
  /**
   * Sets the size of grass blades in this layer
   * @param width - Grass blade width
   * @param height - Grass blade height
   */
  setBladeSize(width: number, height: number) {
    if (width !== this._bladeWidth || height !== this._bladeHeight) {
      this._bladeWidth = width;
      this._bladeHeight = height;
      this._baseVertexBuffer.set(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
      this._quadtree.get().setBaseVertexBuffer(this._baseVertexBuffer.get());
    }
  }
  /** @internal */
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
  /** @internal */
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
  /** @internal */
  draw(ctx: DrawContext, region: Vector4, minY: number, maxY: number) {
    this._material.get().apply(ctx);
    for (let pass = 0; pass < this._material.get().numPasses; pass++) {
      this._material.get().bind(ctx.device, pass);
      this._quadtree.get().draw(ctx.camera, region, minY, maxY, false);
    }
  }
  /** @internal */
  protected onDispose(): void {
    super.onDispose();
    this._material.dispose();
    this._quadtree.dispose();
    this._baseVertexBuffer.dispose();
  }
}
/**
 * Grass renderer for clipmap terrain
 * @public
 */
export class GrassRenderer extends Disposable {
  private readonly _terrain: DWeakRef<ClipmapTerrain>;
  private _layers: GrassLayer[];
  /**
   * Creates an instance of GrassRenderer
   * @param terrain - Clipmap terrain object
   */
  constructor(terrain: ClipmapTerrain) {
    super();
    this._terrain = new DWeakRef(terrain);
    this._layers = [];
  }
  /** @internal */
  updateMaterial() {
    for (const layer of this._layers) {
      layer.updateMaterial();
    }
  }
  /** How many grass layers */
  get numLayers() {
    return this._layers.length;
  }
  /**
   * Gets the grass layer at given index
   * @param index - Index of the grass layer
   * @returns The grass layer at the index
   */
  getLayer(index: number) {
    return this._layers[index];
  }
  /**
   * Adds a grass layer
   * @param bladeWidth - Width of grass blades in this layer
   * @param bladeHeight - Height of grass blades in this layer
   * @param albedoMap - Albedo texture of grass blades in this layer
   * @returns Index of the added grass layer
   */
  addLayer(bladeWidth: number, bladeHeight: number, albedoMap?: Texture2D): number {
    const layer = new GrassLayer(this._terrain.get(), bladeWidth, bladeHeight, albedoMap);
    this._layers.push(layer);
    return this._layers.length - 1;
  }
  /**
   * Gets the albedo texture of grass blades in the grass layer at given index
   * @param layer - Index of the grass layer to get
   * @returns Albedo texture of grass blades in the grass layer
   */
  getGrassTexture(layer: number) {
    return this._layers[layer]?.getAlbedoMap() ?? null;
  }
  /**
   * Sets the albedo texture of grass blades in the grass layer at given index
   * @param layer - Index of the grass layer to set
   * @param texture - Albedo texture to set
   */
  setGrassTexture(layer: number, texture: Texture2D) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.setAlbedoMap(texture);
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  /**
   * Gets width of the grass blades in the grass layer at given index
   * @param layer - Index of the grass layer
   * @returns Width of the grass blades in the layer
   */
  getBladeWidth(layer: number) {
    return this._layers[layer]?.bladeWidth ?? 0;
  }
  /**
   * Gets height of the grass blades in the grass layer at given index
   * @param layer - Index of the grass layer
   * @returns Height of the grass blades in the layer
   */
  getBladeHeight(layer: number) {
    return this._layers[layer]?.bladeHeight ?? 0;
  }
  /**
   * Sets size of the grass blades in the grass layer at given index
   * @param layer - Index of the grass layer
   * @param width - Width to set
   * @param height - Height to set
   */
  setBladeSize(layer: number, width: number, height: number) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.setBladeSize(width, height);
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  /**
   * Add grass instances to the grass layer at given index
   * @param layer - Index of the grass layer
   * @param instances - Grass blade instances to add
   */
  addInstances(layer: number, instances: GrassInstanceInfo[]) {
    const grassLayer = this._layers[layer];
    if (!grassLayer) {
      console.error(`Invalid grass layer: ${layer}`);
    } else {
      grassLayer.addInstances(instances);
    }
  }
  /**
   * Remove grass instances from the grass layer at given index within a region
   * @param layer - Index of the grass layer
   * @param minX - Minimum x of the region
   * @param minZ - Minimum z of the region
   * @param maxX - Maximum x of the region
   * @param maxZ - Maximum z of the region
   * @param num - How many grass blades to remove
   */
  removeInstances(layer: number, minX: number, minZ: number, maxX: number, maxZ: number, num: number) {
    const grassLayer = this._layers[layer];
    if (!grassLayer) {
      console.error(`Invalid grass layer: ${layer}`);
    } else {
      grassLayer.removeInstances(minX, minZ, maxX, maxZ, num);
    }
  }
  /** @internal */
  draw(ctx: DrawContext) {
    const bv = this._terrain.get().getWorldBoundingVolume().toAABB();
    const minY = bv.minPoint.y;
    const maxY = bv.maxPoint.y;
    for (const layer of this._layers) {
      layer.draw(ctx, this._terrain.get().worldRegion, minY - layer.bladeHeight, maxY + layer.bladeHeight);
    }
  }
  protected onDispose(): void {
    super.onDispose();
    this._terrain.dispose();
    for (const layer of this._layers) {
      layer.dispose();
    }
    this._layers = null;
  }
}

/** @internal */
export class GrassQuadtreeNode extends Disposable {
  private static readonly _cullAABB = new AABB();
  private readonly _grassInstances: DRef<GrassInstances>;
  private _children: GrassQuadtreeNode[];
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private readonly _indexBuffer: DRef<IndexBuffer>;
  private _minX: number;
  private _minZ: number;
  private _maxX: number;
  private _maxZ: number;
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    super();
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._grassInstances = new DRef(new GrassInstances(baseVertexBuffer, indexBuffer));
    this._children = null;
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
  removeInstances(minX: number, minZ: number, maxX: number, maxZ: number, numInstances: number): number {
    let n = Math.min(this._grassInstances.get().numInstances, numInstances);
    if (n <= 0) {
      return 0;
    }
    let removed = 0;
    if (this._children) {
      for (const child of this._children) {
        if (child._minX < maxX && child._minZ < maxZ && child._maxX > minX && child._maxZ > minZ) {
          removed += child.removeInstances(minX, minZ, maxX, maxZ, n);
          n -= removed;
        }
      }
    }
    if (n > 0) {
      removed += this._grassInstances.get().removeInstances(minX, minZ, maxX, maxZ, n);
    }
    return removed;
  }
  addInstances(instances: GrassInstanceInfo[]): number {
    if (instances.length === 0) {
      return 0;
    }
    let n = Math.min(instances.length, MAX_INSTANCES_PER_NODE - this._grassInstances.get().numInstances);
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
        if (n < instances.length) {
          n += child.addInstances(
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
    return n;
  }
  protected onDispose(): void {
    super.onDispose();
    this._baseVertexBuffer.dispose();
    this._indexBuffer.dispose();
    this._grassInstances.dispose();
    if (this._children) {
      for (const child of this._children) {
        child.dispose();
      }
    }
  }
}
