import type { Texture3D } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { VolumeBoxAllocator } from './box_allocator';
import type { VolumeBox } from './box_allocator';

/** Allocation granularity of the atlas in voxels, per axis. */
export const SDF_ATLAS_BLOCK = 8;

/**
 * A region of the atlas holding one mesh field.
 * @public
 */
export interface MeshSDFAtlasSlot {
  /** Voxel offset of the region in the atlas. */
  offset: [number, number, number];
  /** Voxels of the field, at most the region size. */
  resolution: [number, number, number];
}

interface Entry {
  key: object;
  slot: MeshSDFAtlasSlot;
  box: VolumeBox;
  voxels: Uint16Array<ArrayBuffer>;
  uploaded: boolean;
}

/**
 * A 3D `r16f` texture shared by the resident mesh distance fields, each in a block-aligned region
 * from a guillotine allocator. When an allocation no longer fits, everything is repacked on trial
 * and committed only if all fit; uploads are deferred to {@link MeshSDFAtlas.flush} under a byte
 * budget. Works on WebGL2 and WebGPU.
 *
 * @public
 */
export class MeshSDFAtlas {
  readonly size: [number, number, number];
  private _texture: Nullable<Texture3D>;
  private _allocator: VolumeBoxAllocator;
  private readonly _entries: Map<object, Entry>;
  private _usedVoxels: number;
  private _version: number;
  constructor(size: [number, number, number] = [256, 256, 256]) {
    this.size = size.map((v) =>
      Math.max(SDF_ATLAS_BLOCK, Math.ceil(v / SDF_ATLAS_BLOCK) * SDF_ATLAS_BLOCK)
    ) as [number, number, number];
    this._texture = null;
    this._allocator = new VolumeBoxAllocator(this.size);
    this._entries = new Map();
    this._usedVoxels = 0;
    this._version = 0;
  }
  /** The atlas texture, created on first use. */
  get texture() {
    if (!this._texture) {
      const [w, h, d] = this.size;
      this._texture = getDevice().createTexture3D('r16f', w, h, d, { mipmapping: false })!;
      this._texture.name = '@MeshSDFAtlas';
      // Earlier uploads had no texture; redo them
      for (const entry of this._entries.values()) {
        entry.uploaded = false;
      }
    }
    return this._texture;
  }
  /** Fields resident in the atlas. */
  get count() {
    return this._entries.size;
  }
  /** Share of the atlas allocated to fields, 0 to 1. */
  get occupancy() {
    return this._usedVoxels / (this.size[0] * this.size[1] * this.size[2]);
  }
  /** Bumped whenever a slot moves or is removed, so users of slot offsets can refresh them. */
  get version() {
    return this._version;
  }
  /** Fields waiting to be uploaded. */
  get pendingUploads() {
    let n = 0;
    for (const entry of this._entries.values()) {
      n += entry.uploaded ? 0 : 1;
    }
    return n;
  }
  /** The slot of a resident field, or null. */
  getSlot(key: object) {
    return this._entries.get(key)?.slot ?? null;
  }
  /** True when the field is resident and its voxels are on the GPU. */
  isReady(key: object) {
    return !!this._entries.get(key)?.uploaded;
  }
  /**
   * Allocates a region for a field and queues its upload.
   * @param key - Identity of the field, used to look it up and free it.
   * @param resolution - Voxels per axis.
   * @param voxels - Half floats, x fastest; kept by reference.
   * @returns The slot, or null when the atlas is full.
   */
  add(
    key: object,
    resolution: [number, number, number],
    voxels: Uint16Array<ArrayBuffer>
  ): Nullable<MeshSDFAtlasSlot> {
    const existing = this._entries.get(key);
    if (existing) {
      return existing.slot;
    }
    const need = this.blockAligned(resolution);
    if (need[0] > this.size[0] || need[1] > this.size[1] || need[2] > this.size[2]) {
      return null;
    }
    const box = this._allocator.allocate(need) ?? this.repack(need);
    if (!box) {
      return null;
    }
    const entry: Entry = {
      key,
      slot: { offset: [box.x, box.y, box.z], resolution: [...resolution] },
      box,
      voxels,
      uploaded: false
    };
    this._entries.set(key, entry);
    this._usedVoxels += box.w * box.h * box.d;
    return entry.slot;
  }
  /**
   * True when a field of this resolution would fit alongside only the fields of `keep`, packed
   * from scratch. Changes nothing; tells a caller whether evicting is worth it.
   */
  fits(resolution: [number, number, number], keep: Iterable<object>) {
    const sizes: [number, number, number][] = [this.blockAligned(resolution)];
    for (const key of keep) {
      const box = this._entries.get(key)?.box;
      if (box) {
        sizes.push([box.w, box.h, box.d]);
      }
    }
    sizes.sort((a, b) => b[0] * b[1] * b[2] - a[0] * a[1] * a[2]);
    const allocator = new VolumeBoxAllocator(this.size);
    return sizes.every((size) => !!allocator.allocate(size));
  }
  /** Frees the region of a field. */
  remove(key: object) {
    const entry = this._entries.get(key);
    if (entry) {
      this._entries.delete(key);
      this._allocator.free(entry.box);
      this._usedVoxels -= entry.box.w * entry.box.h * entry.box.d;
      this._version++;
    }
  }
  /**
   * Uploads queued fields, nearest-first in the order they were added, until
   * the byte budget is spent. At least one field is uploaded per call.
   * @returns Keys of the fields that became ready.
   */
  flush(byteBudget = 4 * 1024 * 1024) {
    const ready: object[] = [];
    let spent = 0;
    for (const entry of this._entries.values()) {
      if (entry.uploaded) {
        continue;
      }
      const bytes = entry.voxels.byteLength;
      if (ready.length > 0 && spent + bytes > byteBudget) {
        break;
      }
      const [x, y, z] = entry.slot.offset;
      const [w, h, d] = entry.slot.resolution;
      this.texture.update(entry.voxels, x, y, z, w, h, d);
      entry.uploaded = true;
      spent += bytes;
      ready.push(entry.key);
    }
    return ready;
  }
  dispose() {
    this._texture?.dispose();
    this._texture = null;
    this._entries.clear();
    this._allocator.reset();
    this._usedVoxels = 0;
    this._version++;
  }
  /** @internal */
  private blockAligned(resolution: [number, number, number]) {
    return resolution.map((v) => Math.ceil(v / SDF_ATLAS_BLOCK) * SDF_ATLAS_BLOCK) as [
      number,
      number,
      number
    ];
  }
  /**
   * Repacks the resident fields plus a new region from scratch, largest first, on a trial
   * allocator; commits only when everything fits, re-uploading only fields that moved.
   * @returns The box of the new region, or null with the atlas unchanged.
   * @internal
   */
  private repack(need: [number, number, number]): Nullable<VolumeBox> {
    const items: { entry: Nullable<Entry>; size: [number, number, number] }[] = [
      { entry: null, size: need },
      ...[...this._entries.values()].map((entry) => ({
        entry,
        size: [entry.box.w, entry.box.h, entry.box.d] as [number, number, number]
      }))
    ].sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]);
    const allocator = new VolumeBoxAllocator(this.size);
    const boxes: VolumeBox[] = [];
    for (const item of items) {
      const box = allocator.allocate(item.size);
      if (!box) {
        return null;
      }
      boxes.push(box);
    }
    this._allocator = allocator;
    this._version++;
    let result: Nullable<VolumeBox> = null;
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].entry;
      const box = boxes[i];
      if (!entry) {
        result = box;
        continue;
      }
      if (entry.box.x !== box.x || entry.box.y !== box.y || entry.box.z !== box.z) {
        entry.slot.offset = [box.x, box.y, box.z];
        entry.uploaded = false;
      }
      entry.box = box;
    }
    return result;
  }
}
