import { DRef, Disposable } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import { getDevice } from '../app/api';

/** Floats in one slot: a 4x4 matrix stored as 4 rgba32f texels on one row */
const FLOATS_PER_SLOT = 16;
/** Texels in one slot */
const TEXELS_PER_SLOT = 4;
/** Atlas width in texels, a multiple of TEXELS_PER_SLOT so no slot straddles two rows */
const ATLAS_WIDTH = 1024;
/** Initial atlas height in rows */
const INITIAL_HEIGHT = 64;
/**
 * Shaders compute texel indices as floats, which stay exact below 2^24, so the atlas never holds
 * more texels than that
 */
const MAX_TEXELS = 1 << 24;

/**
 * A range of slots allocated in the skin palette atlas.
 *
 * @internal
 */
export interface SkinPaletteBlock {
  /** Index of the first slot */
  readonly base: number;
  /** Number of slots */
  readonly count: number;
}

/**
 * Shared rgba32f texture holding the skinning matrix palettes of all skinned meshes.
 *
 * @remarks
 * The atlas is addressed in slots of 4 texels (one 4x4 matrix, one row per texel), so the
 * shader fetches a matrix the same way it fetched one from a per-skeleton joint texture.
 * Blocks are allocated first-fit from a free list and keep their place until released, so the
 * slot index of a block can be stored in instance data without being rewritten every frame.
 *
 * Writes go to a CPU-side mirror and the dirty rows are uploaded once per frame by {@link flush}.
 * Growing the atlas replaces its texture; {@link changeTag} tells consumers holding the old one.
 * The old texture is only released, so a consumer still holding a reference keeps it alive until
 * it switches over.
 *
 * @internal
 */
export class SkinPaletteAtlas extends Disposable {
  private static _instance: Nullable<SkinPaletteAtlas> = null;
  private static readonly _uploadListeners: ((uploaded: boolean) => void)[] = [];
  private static readonly _replaceListeners: (() => void)[] = [];
  private readonly _texture: DRef<Texture2D>;
  private _data: Float32Array<ArrayBuffer>;
  private _height: number;
  /** Free slot ranges sorted by base, never adjacent to each other */
  private readonly _freeList: { base: number; count: number }[];
  private _dirtyRowMin: number;
  private _dirtyRowMax: number;
  private _changeTag: number;
  private constructor() {
    super();
    this._texture = new DRef();
    this._height = INITIAL_HEIGHT;
    this._data = new Float32Array(ATLAS_WIDTH * this._height * 4);
    this._freeList = [{ base: 0, count: this.slotCapacity }];
    this._dirtyRowMin = Number.MAX_SAFE_INTEGER;
    this._dirtyRowMax = -1;
    this._changeTag = 0;
  }
  /** The atlas of the current device, created on first use */
  static get instance() {
    if (!this._instance || this._instance.disposed) {
      this._instance = new SkinPaletteAtlas();
    }
    return this._instance;
  }
  /** Upload the pending writes of the atlas, if one has been created, then notify upload listeners */
  static flushPending() {
    if (this._instance && !this._instance.disposed) {
      const uploaded = this._instance.flush();
      for (const listener of this._uploadListeners) {
        listener(uploaded);
      }
    }
  }
  /**
   * Register a callback run by every {@link flushPending}, told whether rows were uploaded.
   *
   * @remarks
   * For writers of the atlas texture other than the CPU mirror, whose slots an upload of the mirror
   * rows covering them overwrites.
   */
  static addUploadListener(listener: (uploaded: boolean) => void) {
    this._uploadListeners.push(listener);
  }
  /**
   * Register a callback run each time the atlas grows and replaces its texture.
   *
   * @remarks
   * For consumers holding the texture that are not refreshed every frame, such as skinned meshes
   * sleeping while an animation bank track poses them.
   */
  static addTextureReplacedListener(listener: () => void) {
    this._replaceListeners.push(listener);
  }
  /** Atlas texture, created on first use and replaced when the atlas grows */
  get texture() {
    let texture = this._texture.get();
    if (!texture) {
      const device = getDevice();
      texture = device.createTexture2D('rgba32f', ATLAS_WIDTH, this._height, {
        // Animation bank tracks evaluate their palettes in compute passes on WebGPU
        writable: device.type === 'webgpu',
        mipmapping: false,
        samplerOptions: {
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipFilter: 'none'
        }
      })!;
      this._texture.set(texture);
      this.markDirtyRows(0, this._height - 1);
    }
    return texture;
  }
  /** Width of the atlas in texels */
  get width() {
    return ATLAS_WIDTH;
  }
  /** Height of the atlas in texels */
  get height() {
    return this._height;
  }
  /** Increased each time the atlas texture is replaced */
  get changeTag() {
    return this._changeTag;
  }
  /** Number of slots the atlas holds at its current size */
  get slotCapacity() {
    return (ATLAS_WIDTH * this._height) / TEXELS_PER_SLOT;
  }
  /**
   * Allocate a block of consecutive slots, growing the atlas when no free range is large enough.
   *
   * @param count - Number of slots
   * @returns The allocated block
   */
  allocate(count: number): SkinPaletteBlock {
    count = Math.max(1, Math.ceil(count));
    for (;;) {
      for (let i = 0; i < this._freeList.length; i++) {
        const range = this._freeList[i];
        if (range.count >= count) {
          const block = { base: range.base, count };
          range.base += count;
          range.count -= count;
          if (range.count === 0) {
            this._freeList.splice(i, 1);
          }
          return block;
        }
      }
      this.grow(count);
    }
  }
  /**
   * Return a block to the free list, merging it with adjacent free ranges.
   *
   * @param block - Block returned by {@link allocate}
   */
  free(block: SkinPaletteBlock) {
    let i = 0;
    while (i < this._freeList.length && this._freeList[i].base < block.base) {
      i++;
    }
    const prev = i > 0 ? this._freeList[i - 1] : null;
    const next = i < this._freeList.length ? this._freeList[i] : null;
    if (prev && prev.base + prev.count === block.base) {
      prev.count += block.count;
      if (next && prev.base + prev.count === next.base) {
        prev.count += next.count;
        this._freeList.splice(i, 1);
      }
    } else if (next && block.base + block.count === next.base) {
      next.base = block.base;
      next.count += block.count;
    } else {
      this._freeList.splice(i, 0, { base: block.base, count: block.count });
    }
  }
  /**
   * Write consecutive slots to the CPU-side mirror and mark their rows dirty.
   *
   * @param slot - Index of the first slot
   * @param values - Slot contents, 16 floats per slot
   * @param slotCount - Number of slots to write, defaults to all slots in `values`
   */
  writeSlots(slot: number, values: ArrayLike<number>, slotCount?: number) {
    slotCount = slotCount ?? Math.floor(values.length / FLOATS_PER_SLOT);
    const floatCount = slotCount * FLOATS_PER_SLOT;
    const offset = slot * FLOATS_PER_SLOT;
    if (values.length === floatCount) {
      this._data.set(values, offset);
    } else {
      for (let i = 0; i < floatCount; i++) {
        this._data[offset + i] = values[i];
      }
    }
    this.markDirtySlots(slot, slotCount);
  }
  /**
   * Upload the rows written since the last flush to the atlas texture.
   *
   * @returns Whether any rows were uploaded
   */
  flush() {
    if (this._dirtyRowMax < 0) {
      return false;
    }
    const texture = this.texture;
    const rowFloats = ATLAS_WIDTH * 4;
    const rowMin = this._dirtyRowMin;
    const rowCount = this._dirtyRowMax - rowMin + 1;
    texture.update(
      this._data.subarray(rowMin * rowFloats, (rowMin + rowCount) * rowFloats),
      0,
      rowMin,
      ATLAS_WIDTH,
      rowCount
    );
    this._dirtyRowMin = Number.MAX_SAFE_INTEGER;
    this._dirtyRowMax = -1;
    return true;
  }
  /** @internal */
  protected onDispose() {
    super.onDispose();
    this._texture.dispose();
    if (SkinPaletteAtlas._instance === this) {
      SkinPaletteAtlas._instance = null;
    }
  }
  /** Mark the rows covering a range of slots dirty */
  private markDirtySlots(slot: number, slotCount: number) {
    if (slotCount > 0) {
      const slotsPerRow = ATLAS_WIDTH / TEXELS_PER_SLOT;
      this.markDirtyRows(Math.floor(slot / slotsPerRow), Math.floor((slot + slotCount - 1) / slotsPerRow));
    }
  }
  private markDirtyRows(rowMin: number, rowMax: number) {
    this._dirtyRowMin = Math.min(this._dirtyRowMin, rowMin);
    this._dirtyRowMax = Math.max(this._dirtyRowMax, rowMax);
  }
  /** Double the height until a block of the given slot count fits at the end */
  private grow(count: number) {
    const maxHeight = Math.min(
      getDevice().getDeviceCaps().textureCaps.maxTextureSize,
      MAX_TEXELS / ATLAS_WIDTH
    );
    const last = this._freeList[this._freeList.length - 1];
    const tailFree = last && last.base + last.count === this.slotCapacity ? last.count : 0;
    let height = this._height;
    while (((height - this._height) * ATLAS_WIDTH) / TEXELS_PER_SLOT + tailFree < count) {
      height *= 2;
      if (height > maxHeight) {
        throw new Error(`SkinPaletteAtlas: cannot allocate ${count} slots, atlas is full`);
      }
    }
    const oldCapacity = this.slotCapacity;
    const data = new Float32Array(ATLAS_WIDTH * height * 4);
    data.set(this._data);
    this._data = data;
    this._height = height;
    this.free({ base: oldCapacity, count: this.slotCapacity - oldCapacity });
    this._texture.set(null);
    this.markDirtyRows(0, height - 1);
    this._changeTag++;
    for (const listener of SkinPaletteAtlas._replaceListeners) {
      listener();
    }
  }
}
