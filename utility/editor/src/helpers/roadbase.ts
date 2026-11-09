/**
 * The ground a RoadSpline was fitted into, kept with the road (RoadSpline.terrainBase): tiles of the
 * height map, the splat map pages and the grass density maps as they were before, so fitting again
 * can start from them. See roadterrain.ts.
 */
import type { Nullable } from '@zephyr3d/base';
/** 'RDBS' little endian */
const BASE_MAGIC = 0x53424452;
const BASE_VERSION = 1;
const TILE = 32;

type Store = Float32Array | Uint8Array;

/** Tiles of a w x h map with c channels per texel, as they were before the road */
export class TileStore<T extends Store> {
  readonly tiles: Map<number, T>;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly channels: number,
    private readonly make: (n: number) => T
  ) {
    this.tiles = new Map();
  }
  get tilesX() {
    return Math.ceil(this.width / TILE);
  }
  get tileLength() {
    return TILE * TILE * this.channels;
  }
  tileOf(x: number, z: number) {
    return Math.floor(z / TILE) * this.tilesX + Math.floor(x / TILE);
  }
  /** Keeps the tiles of `ids` not kept yet, copied from `data` */
  record(data: T, ids: Iterable<number>) {
    for (const id of ids) {
      if (!this.tiles.has(id)) {
        const tile = this.make(this.tileLength);
        this.copy(data, tile, id, false);
        this.tiles.set(id, tile);
      }
    }
  }
  /** Writes the kept tiles into `data` */
  restore(data: T) {
    for (const [id, tile] of this.tiles) {
      this.copy(data, tile, id, true);
    }
  }
  private copy(data: T, tile: T, id: number, toData: boolean) {
    const tx = id % this.tilesX;
    const tz = Math.floor(id / this.tilesX);
    const c = this.channels;
    for (let j = 0; j < TILE; j++) {
      const z = tz * TILE + j;
      if (z >= this.height) {
        break;
      }
      for (let i = 0; i < TILE; i++) {
        const x = tx * TILE + i;
        if (x >= this.width) {
          break;
        }
        const d = (z * this.width + x) * c;
        const t = (j * TILE + i) * c;
        for (let k = 0; k < c; k++) {
          if (toData) {
            data[d + k] = tile[t + k];
          } else {
            tile[t + k] = data[d + k];
          }
        }
      }
    }
  }
}

/** Sizes of the terrain maps a base was recorded for */
export interface MapSizes {
  heightW: number;
  heightH: number;
  splatW: number;
  splatH: number;
  splatPages: number;
  grass: { w: number; h: number }[];
}

export class TerrainBase {
  readonly heights: TileStore<Float32Array>;
  /** One store per splat page, 4 channels */
  readonly splat: TileStore<Uint8Array>[];
  readonly grass: TileStore<Uint8Array>[];
  constructor(readonly sizes: MapSizes) {
    this.heights = new TileStore(sizes.heightW, sizes.heightH, 1, (n) => new Float32Array(n));
    this.splat = [];
    for (let p = 0; p < sizes.splatPages; p++) {
      this.splat.push(new TileStore(sizes.splatW, sizes.splatH, 4, (n) => new Uint8Array(n)));
    }
    this.grass = sizes.grass.map((g) => new TileStore(g.w, g.h, 1, (n) => new Uint8Array(n)));
  }
  get empty() {
    return (
      this.heights.tiles.size === 0 &&
      this.splat.every((s) => s.tiles.size === 0) &&
      this.grass.every((g) => g.tiles.size === 0)
    );
  }
  get hasSplat() {
    return this.splat.some((s) => s.tiles.size > 0);
  }
  get numTiles() {
    return (
      this.heights.tiles.size +
      this.splat.reduce((n, s) => n + s.tiles.size, 0) +
      this.grass.reduce((n, g) => n + g.tiles.size, 0)
    );
  }
  encode(): Nullable<ArrayBuffer> {
    if (this.empty) {
      return null;
    }
    const s = this.sizes;
    const stores: TileStore<Store>[] = [this.heights, ...this.splat, ...this.grass];
    let bytes = 4 * (8 + 2 * s.grass.length);
    for (const store of stores) {
      bytes += 4 + store.tiles.size * (4 + store.tileLength * (store === this.heights ? 4 : 1));
    }
    const buffer = new ArrayBuffer(bytes);
    const view = new DataView(buffer);
    let o = 0;
    const u32 = (v: number) => {
      view.setUint32(o, v, true);
      o += 4;
    };
    u32(BASE_MAGIC);
    u32(BASE_VERSION);
    u32(s.heightW);
    u32(s.heightH);
    u32(s.splatW);
    u32(s.splatH);
    u32(s.splatPages);
    u32(s.grass.length);
    for (const g of s.grass) {
      u32(g.w);
      u32(g.h);
    }
    for (const store of stores) {
      u32(store.tiles.size);
      for (const [id, tile] of store.tiles) {
        u32(id);
        // Every section and tile is a multiple of 4 bytes long, so offsets stay aligned
        const target =
          tile instanceof Float32Array
            ? new Float32Array(buffer, o, tile.length)
            : new Uint8Array(buffer, o, tile.length);
        target.set(tile);
        o += tile.byteLength;
      }
    }
    return buffer;
  }
  /**
   * Reads a base, or makes an empty one when there is none
   * @throws when it was recorded for maps of other sizes
   */
  static decode(data: Nullable<ArrayBuffer>, sizes: MapSizes): TerrainBase {
    const base = new TerrainBase(sizes);
    if (!data || data.byteLength === 0) {
      return base;
    }
    const view = new DataView(data);
    let o = 0;
    const u32 = () => {
      const v = view.getUint32(o, true);
      o += 4;
      return v;
    };
    if (u32() !== BASE_MAGIC || u32() !== BASE_VERSION) {
      throw new Error('The terrain base kept with the road is not readable; commit it to drop it');
    }
    const recorded: MapSizes = {
      heightW: u32(),
      heightH: u32(),
      splatW: u32(),
      splatH: u32(),
      splatPages: u32(),
      grass: []
    };
    const numGrass = u32();
    for (let i = 0; i < numGrass; i++) {
      recorded.grass.push({ w: u32(), h: u32() });
    }
    const same =
      recorded.heightW === sizes.heightW &&
      recorded.heightH === sizes.heightH &&
      recorded.splatW === sizes.splatW &&
      recorded.splatH === sizes.splatH &&
      recorded.splatPages === sizes.splatPages &&
      recorded.grass.length === sizes.grass.length &&
      recorded.grass.every((g, i) => g.w === sizes.grass[i].w && g.h === sizes.grass[i].h);
    if (!same) {
      throw new Error(
        'The terrain maps changed size since the road was fitted; restore or commit the terrain base before fitting again'
      );
    }
    const stores: TileStore<Store>[] = [base.heights, ...base.splat, ...base.grass];
    for (const store of stores) {
      const count = u32();
      for (let i = 0; i < count; i++) {
        const id = u32();
        const tile =
          store === base.heights
            ? new Float32Array(data.slice(o, o + store.tileLength * 4))
            : new Uint8Array(data.slice(o, o + store.tileLength));
        o += tile.byteLength;
        store.tiles.set(id, tile);
      }
    }
    return base;
  }
}

/** Number of kept tiles and size of a kept ground, without checking it against a terrain */
export function summarizeTerrainBase(data: Nullable<ArrayBuffer>) {
  if (!data || data.byteLength < 32) {
    return null;
  }
  const view = new DataView(data);
  if (view.getUint32(0, true) !== BASE_MAGIC || view.getUint32(4, true) !== BASE_VERSION) {
    return { tiles: 0, bytes: data.byteLength, readable: false };
  }
  const pages = view.getUint32(24, true);
  const numGrass = view.getUint32(28, true);
  let o = 32 + numGrass * 8;
  let tiles = 0;
  const lengths = [
    TILE * TILE * 4,
    ...Array(pages).fill(TILE * TILE * 4),
    ...Array(numGrass).fill(TILE * TILE)
  ];
  for (const len of lengths) {
    const count = view.getUint32(o, true);
    tiles += count;
    o += 4 + count * (4 + len);
  }
  return { tiles, bytes: data.byteLength, readable: true };
}
