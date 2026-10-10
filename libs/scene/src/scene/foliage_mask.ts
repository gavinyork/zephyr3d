/** Cells along each side of a {@link FoliageDensityMask} tile */
export const FOLIAGE_MASK_TILE_SIZE = 64;

/** Key of a tile from its integer tile coordinates */
function tileKey(tx: number, tz: number) {
  return `${tx},${tz}`;
}

/**
 * Where a {@link FoliageLayer} grows, and how densely: a value from 0 to 1 per square cell of the
 * plane of the foliage system, painted with the foliage brush.
 *
 * @remarks
 * Cells are stored in square tiles of {@link FOLIAGE_MASK_TILE_SIZE} cells, and only tiles
 * holding a non-zero value exist, so the mask covers an unbounded plane at the cost of what was
 * painted. Values are kept in steps of 1/255.
 *
 * Cell `(i, j)` covers `[i, i + 1) × [j, j + 1)` cell sizes; its value is at its centre, and
 * {@link FoliageDensityMask.sample} interpolates between centres.
 * @public
 */
export class FoliageDensityMask {
  private _cellSize: number;
  private readonly _tiles: Map<string, Uint8Array>;
  /**
   * Creates an empty mask
   * @param cellSize - Edge of a cell, in meters
   */
  constructor(cellSize = 1) {
    this._cellSize = Math.max(1e-3, cellSize);
    this._tiles = new Map();
  }
  /** Edge of a cell, in meters. Changing it keeps the cell values, so what was painted scales. */
  get cellSize() {
    return this._cellSize;
  }
  set cellSize(val: number) {
    this._cellSize = Math.max(1e-3, val);
  }
  /** Number of tiles holding painted cells */
  get numTiles() {
    return this._tiles.size;
  }
  /** Whether nothing is painted */
  get empty() {
    return this._tiles.size === 0;
  }
  /** Clears every cell */
  clear() {
    this._tiles.clear();
  }
  /**
   * Value of a cell, 0 to 1
   * @param i - Cell column
   * @param j - Cell row
   */
  getCell(i: number, j: number) {
    const n = FOLIAGE_MASK_TILE_SIZE;
    const tx = Math.floor(i / n);
    const tz = Math.floor(j / n);
    const tile = this._tiles.get(tileKey(tx, tz));
    return tile ? tile[(j - tz * n) * n + (i - tx * n)] / 255 : 0;
  }
  /**
   * Sets the value of a cell
   * @param i - Cell column
   * @param j - Cell row
   * @param value - New value, clamped to 0..1
   */
  setCell(i: number, j: number, value: number) {
    const n = FOLIAGE_MASK_TILE_SIZE;
    const tx = Math.floor(i / n);
    const tz = Math.floor(j / n);
    const key = tileKey(tx, tz);
    const v = Math.round(Math.min(1, Math.max(0, value)) * 255);
    let tile = this._tiles.get(key);
    if (!tile) {
      if (v === 0) {
        return;
      }
      tile = new Uint8Array(n * n);
      this._tiles.set(key, tile);
    }
    tile[(j - tz * n) * n + (i - tx * n)] = v;
    if (v === 0 && tile.every((c) => c === 0)) {
      this._tiles.delete(key);
    }
  }
  /**
   * The density at a point, interpolated between the centres of the cells around it
   * @param x - Position x, local to the foliage system
   * @param z - Position z, local to the foliage system
   */
  sample(x: number, z: number) {
    const fx = x / this._cellSize - 0.5;
    const fz = z / this._cellSize - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = this.getCell(i, j);
    const b = this.getCell(i + 1, j);
    const c = this.getCell(i, j + 1);
    const d = this.getCell(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  /**
   * Changes the cells within a circle, weighted by a falloff from the centre
   *
   * @remarks
   * Each cell whose centre lies within the circle becomes
   * `clamp(old + amount × weight)`, where weight is 1 at the centre and falls smoothly to 0 at
   * the edge over the outer `falloff` fraction of the radius. A negative amount erases.
   *
   * @param x - Circle centre x, local to the foliage system
   * @param z - Circle centre z, local to the foliage system
   * @param radius - Circle radius
   * @param amount - Change at full weight, -1 to 1
   * @param falloff - Fraction of the radius over which the weight falls to 0, 0 to 1
   * @returns The changed region `[minX, minZ, maxX, maxZ]`, local, or null when nothing changed
   */
  paintCircle(
    x: number,
    z: number,
    radius: number,
    amount: number,
    falloff = 0.5
  ): [number, number, number, number] | null {
    if (!(radius > 0) || amount === 0) {
      return null;
    }
    const cs = this._cellSize;
    const i0 = Math.floor((x - radius) / cs);
    const i1 = Math.floor((x + radius) / cs);
    const j0 = Math.floor((z - radius) / cs);
    const j1 = Math.floor((z + radius) / cs);
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = foliageBrushWeight(Math.hypot((i + 0.5) * cs - x, (j + 0.5) * cs - z) / radius, falloff);
        if (w <= 0) {
          continue;
        }
        const old = this.getCell(i, j);
        const next = Math.min(1, Math.max(0, old + amount * w));
        if (Math.round(next * 255) !== Math.round(old * 255)) {
          this.setCell(i, j, next);
          changed = true;
        }
      }
    }
    return changed ? this.cellRegion(i0, j0, i1, j1) : null;
  }
  /**
   * Moves the cells within a circle towards a density, by the brush weight: a cell at full
   * weight becomes `value`, one at the soft edge moves part of the way
   * @param x - Circle centre x, local to the foliage system
   * @param z - Circle centre z, local to the foliage system
   * @param radius - Circle radius
   * @param value - Target density, 0 to 1
   * @param falloff - Fraction of the radius over which the weight falls to 0, 0 to 1
   * @returns The changed region `[minX, minZ, maxX, maxZ]`, local, or null when nothing changed
   */
  blendCircle(
    x: number,
    z: number,
    radius: number,
    value: number,
    falloff = 0.5
  ): [number, number, number, number] | null {
    if (!(radius > 0)) {
      return null;
    }
    const target = Math.min(1, Math.max(0, value));
    const cs = this._cellSize;
    const i0 = Math.floor((x - radius) / cs);
    const i1 = Math.floor((x + radius) / cs);
    const j0 = Math.floor((z - radius) / cs);
    const j1 = Math.floor((z + radius) / cs);
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = foliageBrushWeight(Math.hypot((i + 0.5) * cs - x, (j + 0.5) * cs - z) / radius, falloff);
        if (w <= 0) {
          continue;
        }
        const old = this.getCell(i, j);
        const next = old + (target - old) * w;
        if (Math.round(next * 255) !== Math.round(old * 255)) {
          this.setCell(i, j, next);
          changed = true;
        }
      }
    }
    return changed ? this.cellRegion(i0, j0, i1, j1) : null;
  }
  /**
   * Sets every cell whose centre lies within a circle
   * @param x - Circle centre x, local to the foliage system
   * @param z - Circle centre z, local to the foliage system
   * @param radius - Circle radius
   * @param value - New value, 0 to 1
   * @returns The changed region `[minX, minZ, maxX, maxZ]`, local, or null when nothing changed
   */
  fillCircle(x: number, z: number, radius: number, value: number): [number, number, number, number] | null {
    if (!(radius > 0)) {
      return null;
    }
    const cs = this._cellSize;
    const i0 = Math.floor((x - radius) / cs);
    const i1 = Math.floor((x + radius) / cs);
    const j0 = Math.floor((z - radius) / cs);
    const j1 = Math.floor((z + radius) / cs);
    const r2 = radius * radius;
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cs - x;
        const dz = (j + 0.5) * cs - z;
        if (dx * dx + dz * dz > r2) {
          continue;
        }
        if (Math.round(this.getCell(i, j) * 255) !== Math.round(Math.min(1, Math.max(0, value)) * 255)) {
          this.setCell(i, j, value);
          changed = true;
        }
      }
    }
    return changed ? this.cellRegion(i0, j0, i1, j1) : null;
  }
  /**
   * Region of the plane the painted tiles cover, `[minX, minZ, maxX, maxZ]` local to the
   * foliage system, or null when nothing is painted
   */
  getBounds(): [number, number, number, number] | null {
    if (this._tiles.size === 0) {
      return null;
    }
    let tx0 = Infinity;
    let tz0 = Infinity;
    let tx1 = -Infinity;
    let tz1 = -Infinity;
    for (const key of this._tiles.keys()) {
      const [tx, tz] = key.split(',').map(Number);
      tx0 = Math.min(tx0, tx);
      tz0 = Math.min(tz0, tz);
      tx1 = Math.max(tx1, tx);
      tz1 = Math.max(tz1, tz);
    }
    const n = FOLIAGE_MASK_TILE_SIZE;
    return this.cellRegion(tx0 * n, tz0 * n, tx1 * n + n - 1, tz1 * n + n - 1);
  }
  /**
   * Regions of the plane the painted tiles cover, one `[minX, minZ, maxX, maxZ]` per tile
   */
  getTileRegions(): [number, number, number, number][] {
    const n = FOLIAGE_MASK_TILE_SIZE;
    const out: [number, number, number, number][] = [];
    for (const key of this._tiles.keys()) {
      const [tx, tz] = key.split(',').map(Number);
      out.push(this.cellRegion(tx * n, tz * n, tx * n + n - 1, tz * n + n - 1));
    }
    return out;
  }
  /**
   * The tiles touching a region, for undo: tile coordinates and a copy of the cells, null for
   * a tile that does not exist
   * @param region - `[minX, minZ, maxX, maxZ]`, local to the foliage system
   */
  copyTiles(region: readonly [number, number, number, number]) {
    const out: { tx: number; tz: number; cells: Uint8Array | null }[] = [];
    for (const [tx, tz] of this.tilesInRegion(region)) {
      const tile = this._tiles.get(tileKey(tx, tz));
      out.push({ tx, tz, cells: tile ? tile.slice() : null });
    }
    return out;
  }
  /**
   * Puts back tiles copied with {@link FoliageDensityMask.copyTiles}
   * @param tiles - The copies
   */
  restoreTiles(tiles: readonly { tx: number; tz: number; cells: Uint8Array | null }[]) {
    for (const { tx, tz, cells } of tiles) {
      if (cells && cells.some((c) => c !== 0)) {
        this._tiles.set(tileKey(tx, tz), cells.slice());
      } else {
        this._tiles.delete(tileKey(tx, tz));
      }
    }
  }
  /** Tile coordinates of the tiles touching a region */
  tilesInRegion(region: readonly [number, number, number, number]): [number, number][] {
    const span = this._cellSize * FOLIAGE_MASK_TILE_SIZE;
    const tx0 = Math.floor(region[0] / span);
    const tz0 = Math.floor(region[1] / span);
    const tx1 = Math.floor(region[2] / span);
    const tz1 = Math.floor(region[3] / span);
    const out: [number, number][] = [];
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        out.push([tx, tz]);
      }
    }
    return out;
  }
  /** Byte size of {@link FoliageDensityMask.write} */
  get byteSize() {
    const n = FOLIAGE_MASK_TILE_SIZE;
    return 4 + this._tiles.size * (8 + n * n);
  }
  /**
   * Writes the tiles: their count, then per tile its coordinates as two int32 and its cells
   * @param view - Destination
   * @param offset - Byte offset to write at
   * @returns Byte offset after the data
   */
  write(view: DataView, offset: number) {
    const n = FOLIAGE_MASK_TILE_SIZE;
    view.setUint32(offset, this._tiles.size, true);
    offset += 4;
    // In a fixed order, so the same mask always writes the same bytes
    const keys = [...this._tiles.keys()].sort();
    for (const key of keys) {
      const [tx, tz] = key.split(',').map(Number);
      view.setInt32(offset, tx, true);
      view.setInt32(offset + 4, tz, true);
      offset += 8;
      new Uint8Array(view.buffer, view.byteOffset + offset, n * n).set(this._tiles.get(key)!);
      offset += n * n;
    }
    return offset;
  }
  /**
   * Replaces the tiles with ones written by {@link FoliageDensityMask.write}
   * @param view - Source
   * @param offset - Byte offset to read at
   * @returns Byte offset after the data
   */
  read(view: DataView, offset: number) {
    const n = FOLIAGE_MASK_TILE_SIZE;
    this._tiles.clear();
    const count = view.getUint32(offset, true);
    offset += 4;
    for (let k = 0; k < count; k++) {
      const tx = view.getInt32(offset, true);
      const tz = view.getInt32(offset + 4, true);
      offset += 8;
      const cells = new Uint8Array(view.buffer, view.byteOffset + offset, n * n).slice();
      offset += n * n;
      if (cells.some((c) => c !== 0)) {
        this._tiles.set(tileKey(tx, tz), cells);
      }
    }
    return offset;
  }
  /** Region covered by an inclusive range of cells */
  private cellRegion(i0: number, j0: number, i1: number, j1: number): [number, number, number, number] {
    const cs = this._cellSize;
    return [i0 * cs, j0 * cs, (i1 + 1) * cs, (j1 + 1) * cs];
  }
}

/**
 * Weight of the foliage brush at a distance from its centre: 1 up to `1 - falloff` of the radius,
 * then falling smoothly to 0 at the edge
 * @param t - Distance from the centre over the radius
 * @param falloff - Fraction of the radius over which the weight falls, 0 to 1
 * @public
 */
export function foliageBrushWeight(t: number, falloff: number) {
  if (t >= 1) {
    return 0;
  }
  const f = Math.min(1, Math.max(0, falloff));
  if (f <= 0 || t <= 1 - f) {
    return 1;
  }
  const s = (1 - t) / f;
  return s * s * (3 - 2 * s);
}
