import type { IndexBuffer, StructuredBuffer, Texture2D } from '@zephyr3d/device';
import type { Vector4 } from '@zephyr3d/base';
import { AABB, ClipState, nextPowerOf2, DRef, DWeakRef, Disposable } from '@zephyr3d/base';
import type { DrawContext } from '../../render';
import { Primitive } from '../../render';
import { ClipmapGrassMaterial } from './grassmaterial';
import type { ClipmapTerrain } from './terrain-cm';
import { getDevice } from '../../app/api';

const INSTANCE_BYTES = 4 * 4;
/** Number of placement cells along each axis of a grass tile */
const TILE_CELLS = 64;
/** Default number of placement cells per density map texel along each axis */
const DEFAULT_CELLS_PER_TEXEL = 2;
const MAX_CELLS_PER_TEXEL = 8;

/**
 * Deterministic 2D integer hash, returns a value in [0, 1).
 * Grass placement derives everything (jitter, survival threshold, rotation)
 * from this hash so that blade positions are stable across edits and reloads.
 */
function hashCell(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Grass blade instance buffer for a single tile
 * @internal
 */
export class GrassInstances extends Disposable {
  private _numInstances: number;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private readonly _indexBuffer: DRef<IndexBuffer>;
  private readonly _instanceBuffer: DRef<StructuredBuffer>;
  private readonly _primitive: DRef<Primitive>;
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    super();
    this._numInstances = 0;
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._instanceBuffer = new DRef();
    this._primitive = new DRef();
  }
  get numInstances() {
    return this._numInstances;
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._primitive.dispose();
    }
  }
  /**
   * Sets the packed instance data (x, y, sin, cos per instance)
   */
  setData(data: Float32Array<ArrayBuffer>, count: number) {
    this._numInstances = count;
    if (count === 0) {
      return;
    }
    const device = getDevice();
    const bytesRequired = count * INSTANCE_BYTES;
    let buffer = this._instanceBuffer.get();
    if (!buffer || buffer.byteLength < bytesRequired) {
      buffer = device.createVertexBuffer('tex1_f32x4', new Uint8Array(nextPowerOf2(bytesRequired)))!;
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
    }
    buffer.bufferSubData(0, data.subarray(0, count * 4));
  }
  draw() {
    if (this._numInstances > 0) {
      if (!this._primitive.get()) {
        const primitive = new Primitive();
        primitive.setVertexBuffer(this._baseVertexBuffer.get()!);
        primitive.setVertexBuffer(this._instanceBuffer.get()!, 'instance');
        primitive.setIndexBuffer(this._indexBuffer.get());
        primitive.primitiveType = 'triangle-list';
        primitive.indexStart = 0;
        primitive.indexCount = this._indexBuffer.get()!.length;
        this._primitive.set(primitive);
      }
      this._primitive.get()!.drawInstanced(this._numInstances);
    }
  }
  protected onDispose() {
    super.onDispose();
    this._baseVertexBuffer.dispose();
    this._indexBuffer.dispose();
    this._instanceBuffer.dispose();
    this._primitive.dispose();
  }
}

/**
 * Grass layer class
 *
 * @public
 */
export class GrassLayer extends Disposable {
  private static readonly _indexBuffer: DRef<IndexBuffer> = new DRef();
  private static readonly _cullAABB = new AABB();
  private static readonly _visibleTiles: GrassInstances[] = [];
  private static readonly _instanceData = new Float32Array(TILE_CELLS * TILE_CELLS * 4);
  private readonly _material: DRef<ClipmapGrassMaterial>;
  private readonly _seed: number;
  private _bladeWidth: number;
  private _bladeHeight: number;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private _densityWidth: number;
  private _densityHeight: number;
  private _cellsPerTexel: number;
  private _densityMap: Uint8Array;
  private readonly _tiles: Map<number, GrassInstances>;
  private _tilesX: number;
  private _tilesZ: number;
  private _numBlades: number;
  /**
   * Creates an instance of GrassLayer
   * @param terrain - Clipmap terrain object
   * @param seed - Seed for deterministic blade placement, usually the layer index
   * @param bladeWidth - Grass blade width
   * @param bladeHeight - Grass blade height
   * @param albedoMap - Albedo texture for the blade
   */
  constructor(
    terrain: ClipmapTerrain,
    seed: number,
    bladeWidth: number,
    bladeHeight: number,
    albedoMap?: Texture2D
  ) {
    super();
    this._material = new DRef(new ClipmapGrassMaterial(terrain));
    this._material.get()!.albedoTexture = albedoMap ?? null;
    if (albedoMap) {
      this._material.get()!.setTextureSize(albedoMap.width, albedoMap.height);
    }
    this._seed = seed;
    this._bladeWidth = bladeWidth;
    this._bladeHeight = bladeHeight;
    this._baseVertexBuffer = new DRef(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
    this._densityWidth = Math.max(1, terrain.sizeX);
    this._densityHeight = Math.max(1, terrain.sizeZ);
    this._cellsPerTexel = DEFAULT_CELLS_PER_TEXEL;
    this._densityMap = new Uint8Array(this._densityWidth * this._densityHeight);
    this._tiles = new Map();
    this._tilesX = 0;
    this._tilesZ = 0;
    this._numBlades = 0;
    this.updateTileGrid();
  }
  /** @internal */
  updateMaterial() {
    this._material.get()!.uniformChanged();
  }
  /**
   * Sets the albedo texture of grass blades in this layer
   * @param albedoMap - Albedo texture to set
   */
  setAlbedoMap(albedoMap: Texture2D) {
    this._material.get()!.albedoTexture = albedoMap;
    if (albedoMap) {
      this._material.get()!.setTextureSize(albedoMap.width, albedoMap.height);
    }
  }
  /**
   * Gets the albedo texture of grass blades in this layer
   * @returns - Albedo texture of grass blades in this layer
   */
  getAlbedoMap() {
    return this._material.get()!.albedoTexture;
  }
  /** How many grass blades are currently generated in this layer */
  get numBlades() {
    return this._numBlades;
  }
  /**
   * Density map of this layer, one byte per texel (0 = no grass, 255 = full density).
   * Texel (x, z) covers the normalized terrain region [x/w..(x+1)/w, z/h..(z+1)/h].
   * After modifying the data, call {@link GrassLayer.updateDensityRegion} to
   * regenerate the affected blade instances.
   */
  get densityMap() {
    return this._densityMap;
  }
  /** Width of the density map in texels */
  get densityMapWidth() {
    return this._densityWidth;
  }
  /** Height of the density map in texels */
  get densityMapHeight() {
    return this._densityHeight;
  }
  /**
   * Number of placement cells per density map texel along each axis.
   * The maximum blade count per texel is the square of this value.
   */
  get cellsPerTexel() {
    return this._cellsPerTexel;
  }
  set cellsPerTexel(val: number) {
    val = Math.max(1, Math.min(MAX_CELLS_PER_TEXEL, val | 0));
    if (val !== this._cellsPerTexel) {
      this._cellsPerTexel = val;
      this.rebuild();
    }
  }
  /**
   * Replaces the density map and regenerates all blade instances
   * @param width - Density map width in texels
   * @param height - Density map height in texels
   * @param cellsPerTexel - Placement cells per texel along each axis
   * @param data - Density data, one byte per texel
   */
  setDensityData(width: number, height: number, cellsPerTexel: number, data: Uint8Array) {
    if (width < 1 || height < 1 || width * height !== data.length) {
      console.error('Invalid grass density data');
      return;
    }
    this._densityWidth = width;
    this._densityHeight = height;
    this._cellsPerTexel = Math.max(1, Math.min(MAX_CELLS_PER_TEXEL, cellsPerTexel | 0));
    this._densityMap = data;
    this.rebuild();
  }
  /**
   * Regenerates blade instances for all tiles overlapping a density map region
   * @param minTexelX - Minimum x texel of the region (inclusive)
   * @param minTexelZ - Minimum z texel of the region (inclusive)
   * @param maxTexelX - Maximum x texel of the region (exclusive)
   * @param maxTexelZ - Maximum z texel of the region (exclusive)
   */
  updateDensityRegion(minTexelX: number, minTexelZ: number, maxTexelX: number, maxTexelZ: number) {
    const k = this._cellsPerTexel;
    // expand by one texel to cover the bilinear sampling footprint
    const cx0 = Math.max(0, (minTexelX - 1) * k);
    const cz0 = Math.max(0, (minTexelZ - 1) * k);
    const cx1 = Math.min(this._densityWidth * k, (maxTexelX + 1) * k);
    const cz1 = Math.min(this._densityHeight * k, (maxTexelZ + 1) * k);
    if (cx1 <= cx0 || cz1 <= cz0) {
      return;
    }
    const tx0 = Math.floor(cx0 / TILE_CELLS);
    const tz0 = Math.floor(cz0 / TILE_CELLS);
    const tx1 = Math.min(this._tilesX, Math.ceil(cx1 / TILE_CELLS));
    const tz1 = Math.min(this._tilesZ, Math.ceil(cz1 / TILE_CELLS));
    for (let tz = tz0; tz < tz1; tz++) {
      for (let tx = tx0; tx < tx1; tx++) {
        this.generateTile(tx, tz);
      }
    }
  }
  /**
   * Regenerates blade instances for the entire layer
   */
  rebuild() {
    for (const tile of this._tiles.values()) {
      tile.dispose();
    }
    this._tiles.clear();
    this._numBlades = 0;
    this.updateTileGrid();
    for (let tz = 0; tz < this._tilesZ; tz++) {
      for (let tx = 0; tx < this._tilesX; tx++) {
        this.generateTile(tx, tz);
      }
    }
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
      for (const tile of this._tiles.values()) {
        tile.setBaseVertexBuffer(this._baseVertexBuffer.get()!);
      }
    }
  }
  /** @internal */
  private updateTileGrid() {
    this._tilesX = Math.ceil((this._densityWidth * this._cellsPerTexel) / TILE_CELLS);
    this._tilesZ = Math.ceil((this._densityHeight * this._cellsPerTexel) / TILE_CELLS);
  }
  /** @internal */
  private sampleDensity(u: number, v: number): number {
    const w = this._densityWidth;
    const h = this._densityHeight;
    const x = u * w - 0.5;
    const z = v * h - 0.5;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const x0 = Math.min(Math.max(ix, 0), w - 1);
    const x1 = Math.min(Math.max(ix + 1, 0), w - 1);
    const z0 = Math.min(Math.max(iz, 0), h - 1);
    const z1 = Math.min(Math.max(iz + 1, 0), h - 1);
    const d = this._densityMap;
    const a = d[z0 * w + x0] + (d[z0 * w + x1] - d[z0 * w + x0]) * fx;
    const b = d[z1 * w + x0] + (d[z1 * w + x1] - d[z1 * w + x0]) * fx;
    return (a + (b - a) * fz) * (1 / 255);
  }
  /** @internal */
  private regionIsEmpty(cx0: number, cz0: number, cx1: number, cz1: number): boolean {
    const k = this._cellsPerTexel;
    const x0 = Math.max(0, Math.floor(cx0 / k) - 1);
    const z0 = Math.max(0, Math.floor(cz0 / k) - 1);
    const x1 = Math.min(this._densityWidth, Math.ceil(cx1 / k) + 1);
    const z1 = Math.min(this._densityHeight, Math.ceil(cz1 / k) + 1);
    for (let z = z0; z < z1; z++) {
      const rowBase = z * this._densityWidth;
      for (let x = x0; x < x1; x++) {
        if (this._densityMap[rowBase + x] !== 0) {
          return false;
        }
      }
    }
    return true;
  }
  /** @internal */
  private generateTile(tx: number, tz: number) {
    const k = this._cellsPerTexel;
    const cw = this._densityWidth * k;
    const ch = this._densityHeight * k;
    const cx0 = tx * TILE_CELLS;
    const cz0 = tz * TILE_CELLS;
    const cx1 = Math.min(cx0 + TILE_CELLS, cw);
    const cz1 = Math.min(cz0 + TILE_CELLS, ch);
    const key = tz * this._tilesX + tx;
    let tile = this._tiles.get(key);
    // fast path: nothing to generate if there is no tile yet and no density
    if (!tile && this.regionIsEmpty(cx0, cz0, cx1, cz1)) {
      return;
    }
    const data = GrassLayer._instanceData;
    const seed = this._seed * 4;
    let count = 0;
    for (let cz = cz0; cz < cz1; cz++) {
      for (let cx = cx0; cx < cx1; cx++) {
        const u = (cx + hashCell(cx, cz, seed)) / cw;
        const v = (cz + hashCell(cx, cz, seed + 1)) / ch;
        if (this.sampleDensity(u, v) > hashCell(cx, cz, seed + 2)) {
          const angle = hashCell(cx, cz, seed + 3) * Math.PI * 2;
          data[count * 4 + 0] = u;
          data[count * 4 + 1] = v;
          data[count * 4 + 2] = Math.sin(angle);
          data[count * 4 + 3] = Math.cos(angle);
          count++;
        }
      }
    }
    this._numBlades += count - (tile?.numInstances ?? 0);
    if (count === 0) {
      if (tile) {
        tile.dispose();
        this._tiles.delete(key);
      }
    } else {
      if (!tile) {
        tile = new GrassInstances(this._baseVertexBuffer.get()!, GrassLayer._getIndexBuffer()!);
        this._tiles.set(key, tile);
      }
      tile.setData(data, count);
    }
  }
  /** @internal */
  private static _getIndexBuffer() {
    if (!this._indexBuffer.get()) {
      this._indexBuffer.set(
        getDevice().createIndexBuffer(
          new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11])
        )
      );
    }
    return this._indexBuffer.get();
  }
  /** @internal */
  private createBaseVertexBuffer(bladeWidth: number, bladeHeight: number) {
    const device = getDevice();
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
    const visible = GrassLayer._visibleTiles;
    visible.length = 0;
    const camera = ctx.camera;
    const cullAABB = GrassLayer._cullAABB;
    const cellsW = this._densityWidth * this._cellsPerTexel;
    const cellsH = this._densityHeight * this._cellsPerTexel;
    const rx = region.x;
    const rz = region.y;
    const rw = region.z - region.x;
    const rh = region.w - region.y;
    for (const [key, tile] of this._tiles) {
      const tx = key % this._tilesX;
      const tz = (key - tx) / this._tilesX;
      const u0 = (tx * TILE_CELLS) / cellsW;
      const v0 = (tz * TILE_CELLS) / cellsH;
      const u1 = Math.min(1, ((tx + 1) * TILE_CELLS) / cellsW);
      const v1 = Math.min(1, ((tz + 1) * TILE_CELLS) / cellsH);
      cullAABB.minPoint.setXYZ(rx + u0 * rw, minY, rz + v0 * rh);
      cullAABB.maxPoint.setXYZ(rx + u1 * rw, maxY, rz + v1 * rh);
      const clipState = camera.clipMask
        ? cullAABB.getClipStateWithFrustumMask(camera.frustum, camera.clipMask)
        : cullAABB.getClipStateWithFrustum(camera.frustum);
      if (clipState !== ClipState.NOT_CLIPPED) {
        visible.push(tile);
      }
    }
    if (visible.length === 0) {
      return;
    }
    this._material.get()!.apply(ctx);
    for (let pass = 0; pass < this._material.get()!.numPasses; pass++) {
      this._material.get()!.bind(ctx.device, pass);
      for (const tile of visible) {
        tile.draw();
      }
    }
    visible.length = 0;
  }
  /** @internal */
  protected onDispose() {
    super.onDispose();
    this._material.dispose();
    for (const tile of this._tiles.values()) {
      tile.dispose();
    }
    this._tiles.clear();
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
  /** How many grass blades */
  get numGrassBlades() {
    return this._layers.reduce((sum, layer) => sum + layer.numBlades, 0);
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
  addLayer(bladeWidth: number, bladeHeight: number, albedoMap?: Texture2D) {
    const layer = new GrassLayer(
      this._terrain.get()!,
      this._layers.length,
      bladeWidth,
      bladeHeight,
      albedoMap
    );
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
  /** @internal */
  draw(ctx: DrawContext) {
    const bv = this._terrain.get()!.getWorldBoundingVolume()!.toAABB();
    const minY = bv.minPoint.y;
    const maxY = bv.maxPoint.y;
    for (const layer of this._layers) {
      layer.draw(ctx, this._terrain.get()!.worldRegion, minY - layer.bladeHeight, maxY + layer.bladeHeight);
    }
  }
  protected onDispose() {
    super.onDispose();
    this._terrain.dispose();
    for (const layer of this._layers) {
      layer.dispose();
    }
  }
}
