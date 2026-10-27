import type { Texture3D } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { VolumeBoxAllocator } from '../sdf/box_allocator';
import type { VolumeBox } from '../sdf/box_allocator';

/** Allocation granularity of the atlas in voxels, per axis. */
export const VOXEL_ATLAS_BLOCK = 4;

/**
 * A region of the material atlas holding one voxelized mesh.
 * @public
 */
export interface VoxelAtlasSlot {
  /** Voxel offset of the region in the atlas. */
  offset: [number, number, number];
  /** Voxels of the field, at most the region size. */
  resolution: [number, number, number];
}

interface Entry {
  slot: VoxelAtlasSlot;
  box: VolumeBox;
}

/**
 * The material atlases of the voxel scene: two 3D textures of the same layout,
 * one holding albedo (rgba8unorm, a = 1 where a surface was rasterized) and
 * one emissive (rgba8unorm as RGBE), each voxelized mesh in its own
 * block-aligned region of both. Written on the GPU by the voxelize pass, so
 * nothing is kept on the CPU: a region that is evicted is rasterized again
 * when wanted, and a fragmented atlas is cleared and refilled rather than
 * repacked.
 *
 * WebGPU only: the textures are storage textures.
 *
 * @public
 */
export class VoxelMaterialAtlas {
  readonly size: [number, number, number];
  private _albedo: Nullable<Texture3D>;
  private _emissive: Nullable<Texture3D>;
  private _allocator: VolumeBoxAllocator;
  private readonly _entries: Map<object, Entry>;
  private _usedVoxels: number;
  private _version: number;
  constructor(size: [number, number, number] = [256, 256, 256]) {
    this.size = size.map((v) =>
      Math.max(VOXEL_ATLAS_BLOCK, Math.ceil(v / VOXEL_ATLAS_BLOCK) * VOXEL_ATLAS_BLOCK)
    ) as [number, number, number];
    this._albedo = null;
    this._emissive = null;
    this._allocator = new VolumeBoxAllocator(this.size);
    this._entries = new Map();
    this._usedVoxels = 0;
    this._version = 0;
  }
  /** The albedo atlas, created on first use. */
  get albedo() {
    if (!this._albedo) {
      this._albedo = this.createTexture('@VoxelAlbedoAtlas');
    }
    return this._albedo;
  }
  /** The emissive atlas (RGBE), created on first use. */
  get emissive() {
    if (!this._emissive) {
      this._emissive = this.createTexture('@VoxelEmissiveAtlas');
    }
    return this._emissive;
  }
  /** Meshes resident in the atlas. */
  get count() {
    return this._entries.size;
  }
  /** Share of the atlas allocated, 0 to 1. */
  get occupancy() {
    return this._usedVoxels / (this.size[0] * this.size[1] * this.size[2]);
  }
  /** Bumped whenever a slot is removed, so users of slot offsets can refresh them. */
  get version() {
    return this._version;
  }
  /** The slot of a resident mesh, or null. */
  getSlot(key: object) {
    return this._entries.get(key)?.slot ?? null;
  }
  /**
   * Allocates a region for a mesh.
   * @param key - Identity of the mesh, used to look it up and free it.
   * @param resolution - Voxels per axis.
   * @returns The slot, or null when nothing fits.
   */
  add(key: object, resolution: [number, number, number]): Nullable<VoxelAtlasSlot> {
    const existing = this._entries.get(key);
    if (existing) {
      return existing.slot;
    }
    const need = this.blockAligned(resolution);
    if (need[0] > this.size[0] || need[1] > this.size[1] || need[2] > this.size[2]) {
      return null;
    }
    const box = this._allocator.allocate(need);
    if (!box) {
      return null;
    }
    const entry: Entry = {
      slot: { offset: [box.x, box.y, box.z], resolution: [...resolution] },
      box
    };
    this._entries.set(key, entry);
    this._usedVoxels += box.w * box.h * box.d;
    return entry.slot;
  }
  /**
   * True when meshes of the given resolutions would fit an empty atlas, packed
   * in {@link VoxelMaterialAtlas.packOrder}. Changes nothing.
   */
  fits(resolutions: [number, number, number][]) {
    const allocator = new VolumeBoxAllocator(this.size);
    return VoxelMaterialAtlas.packOrder(resolutions).every((r) => !!allocator.allocate(this.blockAligned(r)));
  }
  /**
   * The order an atlas cleared for a set of meshes adds them in, largest
   * first, for which {@link VoxelMaterialAtlas.fits} answers.
   */
  static packOrder<T extends [number, number, number] | { resolution: [number, number, number] }>(
    items: T[]
  ) {
    const volume = (item: T) => {
      const r = Array.isArray(item) ? item : item.resolution;
      return r[0] * r[1] * r[2];
    };
    return [...items].sort((a, b) => volume(b) - volume(a));
  }
  /**
   * Packs the given meshes from an empty atlas in
   * {@link VoxelMaterialAtlas.packOrder}, freeing every other region. Fails,
   * changing nothing, when they do not all fit (see {@link VoxelMaterialAtlas.fits}).
   * @returns The keys whose region moved, whose content is lost, or null.
   */
  repack(items: { key: object; resolution: [number, number, number] }[]): Nullable<Set<object>> {
    const allocator = new VolumeBoxAllocator(this.size);
    const placed: { key: object; resolution: [number, number, number]; box: VolumeBox }[] = [];
    for (const item of VoxelMaterialAtlas.packOrder(items)) {
      const box = allocator.allocate(this.blockAligned(item.resolution));
      if (!box) {
        return null;
      }
      placed.push({ ...item, box });
    }
    const moved = new Set<object>();
    const entries = new Map<object, Entry>();
    this._usedVoxels = 0;
    for (const { key, resolution, box } of placed) {
      const old = this._entries.get(key)?.box;
      if (!old || old.x !== box.x || old.y !== box.y || old.z !== box.z) {
        moved.add(key);
      }
      entries.set(key, { slot: { offset: [box.x, box.y, box.z], resolution: [...resolution] }, box });
      this._usedVoxels += box.w * box.h * box.d;
    }
    this._entries.clear();
    for (const [key, entry] of entries) {
      this._entries.set(key, entry);
    }
    this._allocator = allocator;
    this._version++;
    return moved;
  }
  /** Frees the region of a mesh. */
  remove(key: object) {
    const entry = this._entries.get(key);
    if (entry) {
      this._entries.delete(key);
      this._allocator.free(entry.box);
      this._usedVoxels -= entry.box.w * entry.box.h * entry.box.d;
      this._version++;
    }
  }
  /** Frees every region; the textures keep their content until written again. */
  clear() {
    this._entries.clear();
    this._allocator.reset();
    this._usedVoxels = 0;
    this._version++;
  }
  dispose() {
    this._albedo?.dispose();
    this._emissive?.dispose();
    this._albedo = null;
    this._emissive = null;
    this.clear();
  }
  /** @internal */
  private blockAligned(resolution: [number, number, number]) {
    return resolution.map((v) => Math.ceil(v / VOXEL_ATLAS_BLOCK) * VOXEL_ATLAS_BLOCK) as [
      number,
      number,
      number
    ];
  }
  /** @internal */
  private createTexture(name: string) {
    const [w, h, d] = this.size;
    const tex = getDevice().createTexture3D('rgba8unorm', w, h, d, { mipmapping: false, writable: true })!;
    tex.name = name;
    return tex;
  }
}
