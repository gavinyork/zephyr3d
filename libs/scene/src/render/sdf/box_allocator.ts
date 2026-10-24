import type { Nullable } from '@zephyr3d/base';

/** An axis-aligned region of a volume, in voxels. @internal */
export interface VolumeBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

/**
 * Guillotine allocation of boxes within a volume: best fit by leftover volume
 * over a list of free boxes, the remainder split along x, then y within it,
 * then z within that. A freed box goes back on the list unmerged, so the space
 * fragments; {@link VolumeBoxAllocator.reset} starts over for a repack.
 * @internal
 */
export class VolumeBoxAllocator {
  readonly size: [number, number, number];
  private _free: VolumeBox[];
  constructor(size: [number, number, number]) {
    this.size = [...size];
    this._free = [this.fullBox()];
  }
  /** Empties the volume. */
  reset() {
    this._free = [this.fullBox()];
  }
  /** A box of the given size, or null when none fits. */
  allocate([w, h, d]: [number, number, number]): Nullable<VolumeBox> {
    let best = -1;
    let bestWaste = Infinity;
    for (let i = 0; i < this._free.length; i++) {
      const f = this._free[i];
      if (f.w >= w && f.h >= h && f.d >= d) {
        const waste = f.w * f.h * f.d - w * h * d;
        if (waste < bestWaste) {
          bestWaste = waste;
          best = i;
        }
      }
    }
    if (best < 0) {
      return null;
    }
    const f = this._free[best];
    this._free.splice(best, 1);
    const rx = f.w - w;
    const ry = f.h - h;
    const rz = f.d - d;
    if (rx > 0) {
      this._free.push({ x: f.x + w, y: f.y, z: f.z, w: rx, h: f.h, d: f.d });
    }
    if (ry > 0) {
      this._free.push({ x: f.x, y: f.y + h, z: f.z, w, h: ry, d: f.d });
    }
    if (rz > 0) {
      this._free.push({ x: f.x, y: f.y, z: f.z + d, w, h, d: rz });
    }
    return { x: f.x, y: f.y, z: f.z, w, h, d };
  }
  /** Returns a box to the free list. */
  free(box: VolumeBox) {
    this._free.push(box);
  }
  /** @internal */
  private fullBox(): VolumeBox {
    return { x: 0, y: 0, z: 0, w: this.size[0], h: this.size[1], d: this.size[2] };
  }
}
