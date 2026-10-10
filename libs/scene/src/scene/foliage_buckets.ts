/** Number of floats per foliage instance: x, z, y offset, rotation about Y, scale */
export const FOLIAGE_INSTANCE_STRIDE = 5;

/** Instances of one chunk */
type Bucket = { data: Float32Array; count: number };

/**
 * Instances of a foliage layer, kept in buckets by the chunk they stand in, so that changing a
 * small area touches only the chunks it overlaps.
 * @internal
 */
export class FoliageInstanceBuckets {
  private _chunkSize: number;
  private _buckets: Map<string, Bucket>;
  private _count: number;
  constructor(chunkSize: number) {
    this._chunkSize = chunkSize;
    this._buckets = new Map();
    this._count = 0;
  }
  /** Number of instances */
  get count() {
    return this._count;
  }
  /** Keys of the chunks holding instances */
  keys() {
    return this._buckets.keys();
  }
  /** Key of the chunk a position stands in */
  keyOf(x: number, z: number) {
    return `${Math.floor(x / this._chunkSize)},${Math.floor(z / this._chunkSize)}`;
  }
  /** Instances of a chunk; a view, valid until the bucket changes */
  get(key: string) {
    const b = this._buckets.get(key);
    return b ? b.data.subarray(0, b.count * FOLIAGE_INSTANCE_STRIDE) : null;
  }
  /**
   * Re-sorts the instances into chunks of another size
   * @param chunkSize - New chunk edge
   */
  setChunkSize(chunkSize: number) {
    if (chunkSize !== this._chunkSize) {
      const all = this.toArray();
      this._chunkSize = chunkSize;
      this.clear();
      this.add(all);
    }
  }
  /** Removes every instance; returns the keys of the chunks that held some */
  clear() {
    const keys = new Set(this._buckets.keys());
    this._buckets.clear();
    this._count = 0;
    return keys;
  }
  /**
   * Appends instances
   * @param data - {@link FOLIAGE_INSTANCE_STRIDE} floats per instance
   * @param touched - Receives the keys of the chunks that changed
   */
  add(data: ArrayLike<number>, touched?: Set<string>) {
    const n = Math.floor(data.length / FOLIAGE_INSTANCE_STRIDE);
    for (let k = 0; k < n; k++) {
      const o = k * FOLIAGE_INSTANCE_STRIDE;
      const key = this.keyOf(data[o], data[o + 1]);
      let b = this._buckets.get(key);
      if (!b) {
        b = { data: new Float32Array(16 * FOLIAGE_INSTANCE_STRIDE), count: 0 };
        this._buckets.set(key, b);
      }
      if ((b.count + 1) * FOLIAGE_INSTANCE_STRIDE > b.data.length) {
        const grown = new Float32Array(b.data.length * 2);
        grown.set(b.data);
        b.data = grown;
      }
      const d = b.count * FOLIAGE_INSTANCE_STRIDE;
      for (let c = 0; c < FOLIAGE_INSTANCE_STRIDE; c++) {
        b.data[d + c] = data[o + c];
      }
      b.count++;
      this._count++;
      touched?.add(key);
    }
  }
  /**
   * Removes the instances for which a test is true, from the chunks overlapping a region
   * @param region - `[minX, minZ, maxX, maxZ]`; only chunks overlapping it are tested
   * @param test - Called with the bucket data and the offset of an instance
   * @param touched - Receives the keys of the chunks that changed
   * @returns Number of instances removed
   */
  removeWhere(
    region: readonly [number, number, number, number],
    test: (d: Float32Array, o: number) => boolean,
    touched?: Set<string>
  ) {
    let removed = 0;
    const cs = this._chunkSize;
    const cx0 = Math.floor(region[0] / cs);
    const cz0 = Math.floor(region[1] / cs);
    const cx1 = Math.floor(region[2] / cs);
    const cz1 = Math.floor(region[3] / cs);
    const visit = (key: string) => {
      const b = this._buckets.get(key);
      if (!b) {
        return;
      }
      const d = b.data;
      let n = 0;
      for (let k = 0; k < b.count; k++) {
        const o = k * FOLIAGE_INSTANCE_STRIDE;
        if (test(d, o)) {
          continue;
        }
        if (n !== k) {
          d.copyWithin(n * FOLIAGE_INSTANCE_STRIDE, o, o + FOLIAGE_INSTANCE_STRIDE);
        }
        n++;
      }
      if (n !== b.count) {
        removed += b.count - n;
        this._count -= b.count - n;
        b.count = n;
        if (n === 0) {
          this._buckets.delete(key);
        }
        touched?.add(key);
      }
    };
    // Few chunks in the region: look them up; many: walk the existing ones instead
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) <= this._buckets.size) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          visit(`${cx},${cz}`);
        }
      }
    } else {
      for (const key of [...this._buckets.keys()]) {
        const [cx, cz] = key.split(',').map(Number);
        if (cx >= cx0 && cx <= cx1 && cz >= cz0 && cz <= cz1) {
          visit(key);
        }
      }
    }
    return removed;
  }
  /** All instances in one array */
  toArray() {
    const out = new Float32Array(this._count * FOLIAGE_INSTANCE_STRIDE);
    let o = 0;
    for (const b of this._buckets.values()) {
      out.set(b.data.subarray(0, b.count * FOLIAGE_INSTANCE_STRIDE), o);
      o += b.count * FOLIAGE_INSTANCE_STRIDE;
    }
    return out;
  }
}
