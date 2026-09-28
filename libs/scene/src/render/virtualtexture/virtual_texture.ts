import type { Nullable } from '@zephyr3d/base';
import { Disposable } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';

/**
 * Sparse virtual texture core, WebGPU only. Design and sources: plans/sparse-virtual-texture.md.
 *
 * The page management follows UE 5.8 Virtual Shadow Maps
 * (Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapPhysicalPageManagement.usf):
 * four physical page lists whose order is the LRU order, a page table rebuilt every update, and
 * unmapped pages pointing at their nearest resident ancestor (PropagateMappedMips). The load
 * priority and budget follow UE runtime virtual texturing (UniqueRequestList.h SortRequests).
 */

/**
 * One level of the virtual space: an independent grid of pages
 * @public
 */
export interface VirtualTextureLevel {
  pagesX: number;
  pagesY: number;
}

/**
 * Levels of a mip chained virtual texture, from the finest level down to a single page
 * @param virtualSize - Virtual texture size in texels, a power of two
 * @param pageSize - Page size in texels, a power of two not larger than virtualSize
 * @public
 */
export function virtualMipChain(virtualSize: number, pageSize: number): VirtualTextureLevel[] {
  if (!isPowerOf2(virtualSize) || !isPowerOf2(pageSize) || pageSize > virtualSize) {
    throw new Error('virtualMipChain(): sizes must be powers of two with pageSize <= virtualSize');
  }
  const levels: VirtualTextureLevel[] = [];
  for (let pages = virtualSize / pageSize; pages >= 1; pages >>= 1) {
    levels.push({ pagesX: pages, pagesY: pages });
  }
  return levels;
}

/**
 * A plane of the physical pool, stored in an atlas texture
 * @public
 */
export interface VirtualTexturePlane {
  name: string;
  /** Must be usable as a write-only storage texture */
  format: TextureFormat;
}

/**
 * Options of a {@link VirtualTexture}
 * @public
 */
export interface VirtualTextureOptions {
  /** Levels of the virtual space, finest first, see {@link virtualMipChain} */
  levels: VirtualTextureLevel[];
  /** Page content size in texels, default 128 */
  pageSize?: number;
  /** Border texels on each side of a page, default 4 */
  border?: number;
  /** Physical atlas size in texels, default 4096 */
  atlasSize?: number;
  planes: VirtualTexturePlane[];
  /** Maximum page loads considered per update, default 16384 */
  loadCapacity?: number;
  /** Maximum pages filled per update (new allocations plus refills), default 16 */
  allocBudget?: number;
  /** Frames an unrequested page keeps its mapping, UE MaxPageAgeSinceLastRequest, default 1000 */
  maxPageAge?: number;
  /**
   * Frames a page requested lately stays in use even if not requested this update, so it is not
   * handed to a new request. UE r.VT.PageFreeThreshold (default 15): marking does not have to
   * hit every visible page every frame, sparse or rotating marking would otherwise thrash.
   */
  freeThreshold?: number;
  /**
   * Raise the requested mip level while the pool is oversubscribed, so demand settles at what
   * the pool can hold instead of pages being evicted and requested again forever. UE pool option
   * bEnableResidencyMipMapBias (off by default there too), see {@link VirtualTexture.mipBias}.
   */
  residencyMipBias?: boolean;
  /**
   * Pool residency above which the mip bias rises, UE r.VT.Residency.UpperBound, default 0.95
   */
  residencyUpperBound?: number;
  /**
   * Pool residency below which the mip bias falls, UE r.VT.Residency.LowerBound. UE ships both
   * bounds at 0.95; a lower value leaves a dead band where the bias holds still, so it does not
   * keep chasing the residency it just changed (pages leave the in-use set only after
   * freeThreshold frames). Default 0.8.
   */
  residencyLowerBound?: number;
}

/**
 * Consistency of the page management, see {@link VirtualTexture.validate}. Every count must be 0.
 * @public
 */
export interface VirtualTextureValidation {
  /** Physical pages missing from the LRU order */
  lostPages: number;
  /** Physical pages listed more than once in the LRU order */
  duplicatePages: number;
  /** Resident page table entries whose physical page belongs to another page */
  wrongOwner: number;
  /** Physical pages mapped by more than one resident entry */
  sharedPages: number;
  /** Pages of the pinned levels not resident */
  pinnedMissing: number;
  /** Page table entries with no mapping at all, not even an ancestor */
  unmapped: number;
}

/**
 * Counters read back from the GPU for debugging, a few frames late
 * @public
 */
export interface VirtualTextureStats {
  /** Pages already resident and requested again */
  requested: number;
  /** New pages mapped */
  allocated: number;
  /** Pages whose mapping was taken over by a new one */
  evicted: number;
  /** Resident pages refilled after an invalidation */
  refilled: number;
  /** Pages dropped by age */
  expired: number;
  /** Requests of unmapped pages */
  loads: number;
  /** Loads beyond loadCapacity */
  dropped: number;
  /** Physical pages still available after allocation */
  available: number;
  /** Size of the next LRU list, must equal the physical page count */
  lruSize: number;
  /** Residency mip bias in effect, see {@link VirtualTextureOptions.residencyMipBias} */
  mipBias: number;
}

const INDEX_NONE = 0xffffffff;
const MAX_LEVELS = 16;
const MAX_RECTS = 8;
const LIST_LRU = 0;
const LIST_AVAILABLE = 1;
const LIST_EMPTY = 2;
const LIST_REQUESTED = 3;
// Page table encoding, UE ShadowEncodePageTable (VirtualShadowMapPageAccessCommon.ush)
const PT_PHYS_MASK = 0xffff;
const PT_LOD_SHIFT = 20;
const PT_LOD_MASK = 0x3f;
const PT_THIS_LOD = 0x40000000;
const PT_ANY_LOD = 0x80000000;
/** Resident at this level; JS bitwise results are signed, hence the unsigned shift */
const PT_MAPPED = (PT_ANY_LOD | PT_THIS_LOD) >>> 0;
// Physical page metadata flags
const META_ALLOCATED = 1;
const META_DIRTY = 2;
const META_PINNED = 4;
// Counter slots
const C_LOAD = 0;
const C_FILL = 1;
const C_CUT = 2;
const C_REMAIN = 3;
const C_TIE = 4;
const C_HIST = 8;
const C_STAT_REQUESTED = 40;
const C_STAT_ALLOCATED = 41;
const C_STAT_EVICTED = 42;
const C_STAT_REFILLED = 43;
const C_STAT_DROPPED = 44;
const C_STAT_EXPIRED = 45;
const NUM_COUNTERS = 64;
// Residency mip bias, UE VirtualTexturePhysicalSpace.cpp UpdateResidencyTracking defaults:
// r.VT.Residency.AdjustmentRate, MaxMipMapBias, LockedUpperBound. The bounds are options.
const RESIDENCY_ADJUSTMENT_RATE = 0.2;
const RESIDENCY_MAX_MIP_BIAS = 4;
const RESIDENCY_LOCKED_UPPER_BOUND = 0.65;
const HIST_PINNED_BUCKET = 31;
const GROUP = 64;
const PACK_GROUP = 256;
const FILL_GROUP = 8;

function isPowerOf2(n: number) {
  return n > 0 && (n & (n - 1)) === 0;
}

type Resources = Record<string, GPUDataBuffer | Texture2D>;

/**
 * GPU driven sparse virtual texture.
 *
 * Per frame: shaders mark pages with {@link VirtualTexture.request}, then {@link VirtualTexture.update}
 * maps pages, {@link VirtualTexture.fill} lets the owner write the new pages, and shaders read
 * through {@link VirtualTexture.resolve}. All of it runs on the GPU in the same frame.
 *
 * @public
 */
export class VirtualTexture extends Disposable {
  private readonly _device: AbstractDevice;
  private readonly _levels: VirtualTextureLevel[];
  private readonly _levelOffsets: number[];
  private readonly _totalPages: number;
  private readonly _pageSize: number;
  private readonly _border: number;
  private readonly _slotSize: number;
  private readonly _atlasSize: number;
  private readonly _slotsPerRow: number;
  private readonly _physicalPages: number;
  private readonly _loadCapacity: number;
  private readonly _allocBudget: number;
  private readonly _maxPageAge: number;
  private readonly _freeThreshold: number;
  private readonly _pinnedFromLevel: number;
  private readonly _mipChain: boolean;
  private readonly _planes: VirtualTexturePlane[];
  private readonly _planeTextures: Texture2D[];
  private readonly _params: GPUDataBuffer;
  private readonly _paramData: Uint32Array<ArrayBuffer>;
  private readonly _rects: GPUDataBuffer;
  private readonly _rectData: Float32Array<ArrayBuffer>;
  private readonly _pendingRects: number[][];
  private readonly _pageTable: GPUDataBuffer;
  private readonly _pageRequest: GPUDataBuffer;
  private readonly _meta: GPUDataBuffer;
  private readonly _lists: [GPUDataBuffer, GPUDataBuffer];
  private readonly _listCounts: GPUDataBuffer;
  private readonly _loadList: GPUDataBuffer;
  private readonly _fillList: GPUDataBuffer;
  private readonly _counters: GPUDataBuffer;
  private readonly _dispatchArgs: GPUDataBuffer;
  /** Persistent across updates: (mip bias, upper bound or -1 when disabled, lower bound, locked page residency) */
  private readonly _state: GPUDataBuffer;
  private readonly _programs: Map<string, GPUProgram>;
  private readonly _bindGroups: Map<string, BindGroup>;
  private _parity: number;
  private _stats: Nullable<VirtualTextureStats>;
  private _statsPending: boolean;
  private _updateCount: number;
  private _debugTexture: Nullable<Texture2D>;
  constructor(device: AbstractDevice, options: VirtualTextureOptions) {
    super();
    if (device.type !== 'webgpu' || !device.getDeviceCaps().miscCaps.supportDispatchIndirect) {
      throw new Error('VirtualTexture requires WebGPU');
    }
    this._device = device;
    this._levels = options.levels.map((l) => ({ pagesX: l.pagesX, pagesY: l.pagesY }));
    if (this._levels.length === 0 || this._levels.length > MAX_LEVELS) {
      throw new Error(`VirtualTexture: 1 to ${MAX_LEVELS} levels are supported`);
    }
    this._levelOffsets = [];
    let total = 0;
    for (const l of this._levels) {
      this._levelOffsets.push(total);
      total += l.pagesX * l.pagesY;
    }
    this._totalPages = total;
    this._mipChain = this._levels.every(
      (l, i) =>
        l.pagesX === Math.max(1, this._levels[0].pagesX >> i) &&
        l.pagesY === Math.max(1, this._levels[0].pagesY >> i)
    );
    this._pageSize = options.pageSize ?? 128;
    this._border = options.border ?? 4;
    this._slotSize = this._pageSize + 2 * this._border;
    this._atlasSize = options.atlasSize ?? 4096;
    this._slotsPerRow = Math.floor(this._atlasSize / this._slotSize);
    this._physicalPages = this._slotsPerRow * this._slotsPerRow;
    if (this._physicalPages < 1 || this._physicalPages > PT_PHYS_MASK) {
      throw new Error('VirtualTexture: invalid physical page count');
    }
    this._loadCapacity = options.loadCapacity ?? 16384;
    this._allocBudget = Math.max(1, Math.min(options.allocBudget ?? 16, this._physicalPages));
    this._maxPageAge = options.maxPageAge ?? 1000;
    this._freeThreshold = Math.max(0, options.freeThreshold ?? 15);
    // Coarsest levels always resident (UE RVT locked pages) so every lookup finds a page: as many
    // as fit in an eighth of the pool, at least the coarsest one
    let pinnedFrom = this._levels.length - 1;
    let pinnedPages = this.levelPages(pinnedFrom);
    while (pinnedFrom > 0 && pinnedPages + this.levelPages(pinnedFrom - 1) <= this._physicalPages / 8) {
      pinnedFrom--;
      pinnedPages += this.levelPages(pinnedFrom);
    }
    if (pinnedPages > this._physicalPages) {
      throw new Error('VirtualTexture: physical pool too small for the coarsest level');
    }
    this._pinnedFromLevel = pinnedFrom;
    this._planes = options.planes.slice();
    this._planeTextures = this._planes.map((plane) => {
      const tex = device.createTexture2D(plane.format, this._atlasSize, this._atlasSize, {
        writable: true,
        mipmapping: false
      })!;
      tex.name = `VirtualTexture.${plane.name}`;
      return tex;
    });
    const storage = (bytes: number) =>
      device.createBuffer(Math.max(16, bytes), { usage: 'uniform', storage: true })!;
    this._params = device.createBuffer((4 + MAX_LEVELS) * 16, { usage: 'uniform' })!;
    this._paramData = new Uint32Array((4 + MAX_LEVELS) * 4);
    this._rects = device.createBuffer(MAX_RECTS * 16, { usage: 'uniform' })!;
    this._rectData = new Float32Array(MAX_RECTS * 4);
    this._pendingRects = [];
    this._pageTable = storage(total * 4);
    this._pageRequest = storage(total * 4);
    this._meta = storage(this._physicalPages * 16);
    this._lists = [storage(this._physicalPages * 16), storage(this._physicalPages * 16)];
    this._listCounts = storage(16);
    this._loadList = storage(this._loadCapacity * 12);
    this._fillList = storage(this._allocBudget * 8);
    this._counters = storage(NUM_COUNTERS * 4);
    this._dispatchArgs = device.createBuffer(6 * 4, { usage: 'indirect', storage: true })!;
    this._state = storage(16);
    const upper = options.residencyUpperBound ?? 0.95;
    const lower = Math.min(upper, options.residencyLowerBound ?? 0.8);
    // x: mip bias, y: upper bound (negative when disabled), z: lower bound, w: locked residency
    this._state.bufferSubData(
      0,
      new Float32Array([0, options.residencyMipBias ? upper : -1, lower, pinnedPages / this._physicalPages])
    );
    // The first update reads the previous REQUESTED list as its LRU order: every page, in order
    const initialLists = new Uint32Array(this._physicalPages * 4);
    for (let i = 0; i < this._physicalPages; i++) {
      initialLists[LIST_REQUESTED * this._physicalPages + i] = i;
    }
    // update() flips the parity before running, so the first one writes _lists[1] and reads its
    // previous lists from _lists[0]
    this._parity = 0;
    this._lists[this._parity].bufferSubData(0, initialLists);
    this._programs = new Map();
    this._bindGroups = new Map();
    this._stats = null;
    this._statsPending = false;
    this._updateCount = 0;
    this._debugTexture = null;
    this.writeParams(0);
  }
  /** Levels of the virtual space */
  get levels(): readonly VirtualTextureLevel[] {
    return this._levels;
  }
  get pageSize() {
    return this._pageSize;
  }
  get border() {
    return this._border;
  }
  get atlasSize() {
    return this._atlasSize;
  }
  get physicalPageCount() {
    return this._physicalPages;
  }
  /** First level kept resident at all times */
  get pinnedFromLevel() {
    return this._pinnedFromLevel;
  }
  get allocBudget() {
    return this._allocBudget;
  }
  /**
   * Last counters read back from the GPU, null until the first read back completes. The
   * residency mip bias there is the value the shaders add in {@link VirtualTexture.computeLevel}.
   */
  get stats() {
    return this._stats;
  }
  getPlaneTexture(name: string) {
    const index = this._planes.findIndex((p) => p.name === name);
    return index >= 0 ? this._planeTextures[index] : null;
  }
  /** Marks every resident page for refilling */
  invalidate() {
    this.invalidateRegion(0, 0, 1, 1);
  }
  /**
   * Marks the resident pages overlapping a region, in normalized virtual coordinates, for
   * refilling. They keep their mapping and old content until refilled (UE VSM *_UNCACHED pages).
   */
  invalidateRegion(u0: number, v0: number, u1: number, v1: number) {
    this._pendingRects.push([u0, v0, u1, v1]);
  }
  /**
   * Maps the pages requested since the last update. Runs compute passes, so it must be called
   * outside of render passes. `stamp` must increase with every frame (not every camera).
   */
  update(stamp: number) {
    const device = this._device;
    this._parity ^= 1;
    this.writeParams(stamp);
    const N = this._physicalPages;
    const groups = (n: number) => Math.max(1, Math.ceil(n / GROUP));
    this.dispatch('clear', groups(Math.max(this._totalPages, NUM_COUNTERS)));
    while (this._pendingRects.length > 0) {
      const rects = this._pendingRects.splice(0, MAX_RECTS);
      this._rectData.fill(0);
      rects.forEach((r, i) => this._rectData.set(r, i * 4));
      this._rects.bufferSubData(0, this._rectData);
      this._paramData[13] = rects.length;
      this._params.bufferSubData(0, this._paramData);
      this.dispatch('invalidate', groups(N));
    }
    this.dispatch(`updatePhysical${this._parity}`, groups(N));
    this.dispatch(`pack${this._parity}`, 1);
    this.dispatch(`appendEmpty${this._parity}`, groups(N));
    this.dispatch(`appendEmptyCount${this._parity}`, 1);
    this.dispatch('gather', groups(this._totalPages));
    this.dispatch('select', 1);
    const allocate = this.getProgram(`allocate${this._parity}`);
    device.setProgram(allocate);
    device.setBindGroup(0, this.getBindGroup(`allocate${this._parity}`));
    device.computeIndirect(this._dispatchArgs, 0);
    this.dispatch('finalize', 1);
    this.dispatch(`appendAvailable${this._parity}`, groups(N));
    this.dispatch(`appendAvailableCount${this._parity}`, 1);
    if (this._mipChain) {
      const l0 = this._levels[0];
      this.dispatch('propagate', Math.ceil(l0.pagesX / FILL_GROUP), Math.ceil(l0.pagesY / FILL_GROUP));
    }
    this._updateCount++;
    if (!this._statsPending && this._updateCount % 30 === 1) {
      this.readStats();
    }
  }
  /**
   * Builds a compute program filling the pages mapped by the last update. Each workgroup fills
   * one page, border included, calling `fillTexel` once per texel.
   *
   * @param label - Program label
   * @param setup - Declares the owner's own bindings (group 0)
   * @param fillTexel - Returns one value per plane for a texel. `texel` is the texel centre in
   *   the level's texel space; border texels lie outside the page and must be computed the same
   *   way, which is what keeps filtering continuous across pages.
   */
  createFillProgram(
    label: string,
    setup: Nullable<(scope: PBGlobalScope) => void>,
    fillTexel: (scope: PBInsideFunctionScope, level: PBShaderExp, texel: PBShaderExp) => PBShaderExp[]
  ) {
    const that = this;
    const S = this._slotSize;
    const iterations = Math.ceil(S / FILL_GROUP);
    return this._device.buildComputeProgram({
      label,
      workgroupSize: [FILL_GROUP, FILL_GROUP, 1],
      compute(pb) {
        that.declareParams(pb, this);
        this.zVT_fillList = pb.uint[0]().storageBufferReadonly(0);
        that._planes.forEach((plane, i) => {
          this[`zVT_plane${i}`] = (pb.texStorage2D as any)[plane.format]().storage(0);
        });
        setup?.(this);
        that.defineLevelOf(pb);
        pb.main(function () {
          this.$l.entry = this.$builtins.workGroupId.x;
          this.$l.pageId = this.zVT_fillList.at(pb.mul(this.entry, 2));
          this.$if(pb.equal(this.pageId, INDEX_NONE), function () {
            this.$return();
          });
          this.$l.phys = this.zVT_fillList.at(pb.add(pb.mul(this.entry, 2), 1));
          this.$l.level = this.zVT_levelOf(this.pageId);
          this.$l.info = this.zVT_params.at(pb.add(this.level, 4));
          this.$l.local = pb.sub(this.pageId, this.info.x);
          this.$l.page = pb.uvec2(
            pb.sub(this.local, pb.mul(pb.div(this.local, this.info.y), this.info.y)),
            pb.div(this.local, this.info.y)
          );
          this.$l.origin = pb.mul(
            pb.uvec2(
              pb.sub(this.phys, pb.mul(pb.div(this.phys, that._slotsPerRow), that._slotsPerRow)),
              pb.div(this.phys, that._slotsPerRow)
            ),
            S
          );
          this.$for(pb.uint('iy'), 0, iterations, function () {
            this.$l.ty = pb.add(pb.mul(this.iy, FILL_GROUP), this.$builtins.localInvocationId.y);
            this.$for(pb.uint('ix'), 0, iterations, function () {
              this.$l.tx = pb.add(pb.mul(this.ix, FILL_GROUP), this.$builtins.localInvocationId.x);
              this.$if(pb.and(pb.lessThan(this.tx, S), pb.lessThan(this.ty, S)), function () {
                this.$l.texel = pb.add(
                  pb.sub(
                    pb.mul(pb.vec2(pb.float(this.page.x), pb.float(this.page.y)), that._pageSize),
                    pb.vec2(that._border)
                  ),
                  pb.add(pb.vec2(pb.float(this.tx), pb.float(this.ty)), pb.vec2(0.5))
                );
                const values = fillTexel(this, this.level, this.texel);
                values.forEach((v, i) => {
                  pb.textureStore(this[`zVT_plane${i}`], pb.add(this.origin, pb.uvec2(this.tx, this.ty)), v);
                });
              });
            });
          });
        });
      }
    })!;
  }
  /**
   * Fills the pages mapped by the last update. `bindGroup` comes from the fill program's layout
   * with the owner's own bindings set; the core ones are set here.
   */
  fill(program: GPUProgram, bindGroup: BindGroup) {
    bindGroup.setBuffer('zVT_params', this._params);
    bindGroup.setBuffer('zVT_fillList', this._fillList);
    this._planeTextures.forEach((tex, i) => bindGroup.setTexture(`zVT_plane${i}`, tex));
    this._device.setProgram(program);
    this._device.setBindGroup(0, bindGroup);
    this._device.computeIndirect(this._dispatchArgs, 12);
  }
  /**
   * Declares the bindings used by {@link VirtualTexture.request}, {@link VirtualTexture.resolve}
   * and {@link VirtualTexture.computeLevel} in a render program.
   */
  declareBindings(scope: PBGlobalScope, group: number, requests = scope.$builder.shaderKind !== 'vertex') {
    const pb = scope.$builder;
    this.declareParams(pb, scope, group);
    scope.zVT_pageTable = pb.uint[0]().storageBufferReadonly(group);
    scope.zVT_state = pb.vec4[0]().storageBufferReadonly(group);
    if (requests) {
      scope.zVT_pageRequest = pb.atomic_uint[0]().storageBuffer(group);
    }
  }
  applyBindings(bindGroup: BindGroup, withRequests = true) {
    bindGroup.setBuffer('zVT_params', this._params);
    bindGroup.setBuffer('zVT_pageTable', this._pageTable);
    bindGroup.setBuffer('zVT_state', this._state);
    if (withRequests) {
      bindGroup.setBuffer('zVT_pageRequest', this._pageRequest);
    }
  }
  /** Mip level from the screen derivatives of a virtual uv, fragment shaders only */
  computeLevel(scope: PBInsideFunctionScope, uv: PBShaderExp) {
    const pb = scope.$builder;
    return this.levelFromFootprint(scope, pb.dpdx(uv), pb.dpdy(uv));
  }
  /**
   * Mip level from the change of the virtual uv across one pixel in x and in y, for marking in
   * compute shaders where there are no screen derivatives (e.g. from reconstructed neighbours).
   * Includes the residency mip bias, like {@link VirtualTexture.computeLevel}.
   */
  levelFromFootprint(scope: PBInsideFunctionScope, duvdx: PBShaderExp, duvdy: PBShaderExp) {
    const pb = scope.$builder;
    const size = [this._levels[0].pagesX * this._pageSize, this._levels[0].pagesY * this._pageSize];
    pb.func('zVT_levelFromFootprint', [pb.vec2('duvdx'), pb.vec2('duvdy')], function () {
      this.$l.dx = pb.mul(this.duvdx, pb.vec2(size[0], size[1]));
      this.$l.dy = pb.mul(this.duvdy, pb.vec2(size[0], size[1]));
      this.$l.d = pb.max(pb.dot(this.dx, this.dx), pb.dot(this.dy, this.dy));
      // UE TextureComputeVirtualMipLevel: the residency bias joins before the level is floored
      this.$return(
        pb.clamp(
          pb.add(pb.mul(pb.log2(pb.max(this.d, 1e-8)), 0.5), this.zVT_state.at(0).x),
          0,
          pb.float(pb.sub(this.zVT_params.at(1).x, 1))
        )
      );
    });
    return pb.getGlobalScope().zVT_levelFromFootprint(duvdx, duvdy) as PBShaderExp;
  }
  /**
   * Requests the page covering `uv` at `level`. With `prefetch`, also requests the ancestor at
   * most two levels finer than what is resident now (UE VirtualTextureSystem.cpp prefetch), so
   * the texture refines gradually.
   */
  request(scope: PBInsideFunctionScope, level: PBShaderExp, uv: PBShaderExp, prefetch = true) {
    const pb = scope.$builder;
    this.definePageId(pb);
    pb.func(`zVT_request${prefetch ? 'P' : ''}`, [pb.uint('level'), pb.vec2('uv')], function () {
      this.$l.id = this.zVT_pageId(this.level, this.uv);
      pb.atomicAdd(this.zVT_pageRequest.at(this.id), 1);
      if (prefetch) {
        this.$l.e = this.zVT_pageTable.at(this.id);
        this.$if(
          pb.and(
            pb.equal(pb.compAnd(this.e, PT_THIS_LOD), 0),
            pb.notEqual(pb.compAnd(this.e, PT_ANY_LOD), 0)
          ),
          function () {
            this.$l.hit = pb.add(this.level, pb.compAnd(pb.sar(this.e, PT_LOD_SHIFT), PT_LOD_MASK));
            this.$l.pre = pb.sub(this.hit, pb.min(this.hit, 2));
            this.$if(pb.greaterThan(this.pre, this.level), function () {
              pb.atomicAdd(this.zVT_pageRequest.at(this.zVT_pageId(this.pre, this.uv)), 1);
            });
          }
        );
      }
    });
    pb.getGlobalScope()[`zVT_request${prefetch ? 'P' : ''}`](pb.uint(level), uv);
  }
  /**
   * Physical location of `uv` at `level`: (atlas u, atlas v, level actually hit, 1 if any page
   * is mapped else 0). One page table read; unmapped pages already point at their nearest
   * resident ancestor.
   */
  resolve(scope: PBInsideFunctionScope, level: PBShaderExp, uv: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    this.definePageId(pb);
    pb.func('zVT_resolve', [pb.uint('level'), pb.vec2('uv')], function () {
      this.$l.e = this.zVT_pageTable.at(this.zVT_pageId(this.level, this.uv));
      this.$l.hit = pb.add(this.level, pb.compAnd(pb.sar(this.e, PT_LOD_SHIFT), PT_LOD_MASK));
      this.$l.phys = pb.compAnd(this.e, PT_PHYS_MASK);
      this.$l.info = this.zVT_params.at(pb.add(pb.min(this.hit, pb.sub(this.zVT_params.at(1).x, 1)), 4));
      this.$l.inPage = pb.fract(pb.mul(this.uv, pb.vec2(pb.float(this.info.y), pb.float(this.info.z))));
      this.$l.origin = pb.mul(
        pb.vec2(
          pb.float(pb.sub(this.phys, pb.mul(pb.div(this.phys, that._slotsPerRow), that._slotsPerRow))),
          pb.float(pb.div(this.phys, that._slotsPerRow))
        ),
        that._slotSize
      );
      this.$return(
        pb.vec4(
          pb.div(
            pb.add(pb.add(this.origin, pb.vec2(that._border)), pb.mul(this.inPage, that._pageSize)),
            that._atlasSize
          ),
          pb.float(this.hit),
          pb.float(pb.notEqual(pb.compAnd(this.e, PT_ANY_LOD), 0))
        )
      );
    });
    return pb.getGlobalScope().zVT_resolve(pb.uint(level), uv) as PBShaderExp;
  }
  /**
   * An rgba8 view of the page table for one level, magnified to the finest level's page grid:
   * bright green = resident and requested this update, dim green = resident, cyan = pinned,
   * blue = pointing at an ancestor (darker the further up), black = nothing mapped.
   */
  renderDebugTexture(level: number) {
    const l0 = this._levels[0];
    if (!this._debugTexture) {
      this._debugTexture = this._device.createTexture2D('rgba8unorm', l0.pagesX, l0.pagesY, {
        writable: true,
        mipmapping: false,
        samplerOptions: { magFilter: 'nearest', minFilter: 'nearest', mipFilter: 'none' }
      })!;
      this._debugTexture.name = 'VirtualTexture.debug';
    }
    const bindGroup = this.getBindGroup('debug');
    bindGroup.setValue('zVT_debugLevel', Math.min(Math.max(0, level | 0), this._levels.length - 1));
    bindGroup.setTexture('zVT_debug', this._debugTexture);
    this._device.setProgram(this.getProgram('debug'));
    this._device.setBindGroup(0, bindGroup);
    this._device.compute(Math.ceil(l0.pagesX / FILL_GROUP), Math.ceil(l0.pagesY / FILL_GROUP), 1);
    return this._debugTexture;
  }
  /**
   * Reads the page table, the physical page metadata and lists back and checks the invariants
   * of the page management. Debugging aid: the read back costs a GPU sync and a few hundred KB.
   * Must be called after an update and before the next one.
   */
  async validate(): Promise<VirtualTextureValidation> {
    const N = this._physicalPages;
    const table = new Uint8Array(this._totalPages * 4);
    const meta = new Uint8Array(N * 16);
    const lists = new Uint8Array(N * 16);
    const counts = new Uint8Array(16);
    await Promise.all([
      this._pageTable.getBufferSubData(table),
      this._meta.getBufferSubData(meta),
      this._lists[this._parity].getBufferSubData(lists),
      this._listCounts.getBufferSubData(counts)
    ]);
    const pt = new Uint32Array(table.buffer);
    const m = new Uint32Array(meta.buffer);
    const l = new Uint32Array(lists.buffer);
    const requestedCount = new Int32Array(counts.buffer)[LIST_REQUESTED];
    const result: VirtualTextureValidation = {
      lostPages: 0,
      duplicatePages: 0,
      wrongOwner: 0,
      sharedPages: 0,
      pinnedMissing: 0,
      unmapped: 0
    };
    const seen = new Uint8Array(N);
    for (let i = 0; i < Math.min(requestedCount, N); i++) {
      const p = l[LIST_REQUESTED * N + i];
      if (p >= N || seen[p]) {
        result.duplicatePages++;
      } else {
        seen[p] = 1;
      }
    }
    result.lostPages = seen.reduce((n, v) => n + (v ? 0 : 1), 0);
    const users = new Uint32Array(N);
    for (let id = 0; id < this._totalPages; id++) {
      const e = pt[id];
      if (e & PT_THIS_LOD) {
        const p = e & PT_PHYS_MASK;
        if (p >= N || m[p * 4] !== id || !(m[p * 4 + 3] & META_ALLOCATED)) {
          result.wrongOwner++;
        } else if (++users[p] === 2) {
          result.sharedPages++;
        }
      } else if (!(e & PT_ANY_LOD)) {
        result.unmapped++;
      }
    }
    for (let level = this._pinnedFromLevel; level < this._levels.length; level++) {
      for (let i = 0; i < this.levelPages(level); i++) {
        if (!(pt[this._levelOffsets[level] + i] & PT_THIS_LOD)) {
          result.pinnedMissing++;
        }
      }
    }
    if (!this._mipChain) {
      // Without ancestors to fall back on, unmapped entries are expected
      result.unmapped = 0;
    }
    return result;
  }
  private levelPages(level: number) {
    return this._levels[level].pagesX * this._levels[level].pagesY;
  }
  private writeParams(stamp: number) {
    const d = this._paramData;
    d.set([this._totalPages, this._physicalPages, stamp, this._maxPageAge], 0);
    d.set([this._levels.length, this._allocBudget, this._loadCapacity, this._pinnedFromLevel], 4);
    d.set([this._slotsPerRow, this._slotSize, this._border, this._pageSize], 8);
    d.set([this._atlasSize, 0, this._mipChain ? 1 : 0, this._freeThreshold], 12);
    this._levels.forEach((l, i) => d.set([this._levelOffsets[i], l.pagesX, l.pagesY, 0], 16 + i * 4));
    this._params.bufferSubData(0, d);
  }
  private readStats() {
    this._statsPending = true;
    const counters = new Uint8Array(NUM_COUNTERS * 4);
    const lists = new Uint8Array(16);
    const state = new Uint8Array(16);
    Promise.all([
      this._counters.getBufferSubData(counters),
      this._listCounts.getBufferSubData(lists),
      this._state.getBufferSubData(state)
    ])
      .then(() => {
        const c = new Uint32Array(counters.buffer);
        const l = new Int32Array(lists.buffer);
        this._stats = {
          requested: c[C_STAT_REQUESTED],
          allocated: c[C_STAT_ALLOCATED],
          evicted: c[C_STAT_EVICTED],
          refilled: c[C_STAT_REFILLED],
          expired: c[C_STAT_EXPIRED],
          loads: Math.min(c[C_LOAD], this._loadCapacity),
          dropped: c[C_STAT_DROPPED],
          available: Math.max(0, l[LIST_AVAILABLE]),
          lruSize: l[LIST_REQUESTED],
          mipBias: new Float32Array(state.buffer)[0]
        };
      })
      .catch(() => {})
      .finally(() => {
        this._statsPending = false;
      });
  }
  private dispatch(name: string, x: number, y = 1) {
    this._device.setProgram(this.getProgram(name));
    this._device.setBindGroup(0, this.getBindGroup(name));
    this._device.compute(x, y, 1);
  }
  private getProgram(name: string) {
    let program = this._programs.get(name);
    if (!program) {
      program = this.buildProgram(name);
      this._programs.set(name, program);
    }
    return program;
  }
  private getBindGroup(name: string) {
    let bindGroup = this._bindGroups.get(name);
    if (!bindGroup) {
      const program = this.getProgram(name);
      bindGroup = this._device.createBindGroup(program.bindGroupLayouts[0]);
      const parity = Number(name[name.length - 1]);
      const resources: Resources = {
        zVT_params: this._params,
        zVT_rects: this._rects,
        zVT_pageTable: this._pageTable,
        zVT_pageRequest: this._pageRequest,
        zVT_meta: this._meta,
        zVT_listCounts: this._listCounts,
        zVT_loadList: this._loadList,
        zVT_fillList: this._fillList,
        zVT_counters: this._counters,
        zVT_dispatchArgs: this._dispatchArgs,
        zVT_state: this._state
      };
      if (parity === 0 || parity === 1) {
        resources.zVT_lists = this._lists[parity];
        resources.zVT_prevLists = this._lists[parity ^ 1];
      }
      // Layout entries carry the builder's block names (zUBC_*); the variable names map to them
      // through nameMap, which setBuffer resolves
      const layout = program.bindGroupLayouts[0];
      for (const [resName, res] of Object.entries(resources)) {
        if (layout.nameMap?.[resName] || layout.entries.some((e) => e.name === resName)) {
          bindGroup.setBuffer(resName, res as GPUDataBuffer);
        }
      }
      this._bindGroups.set(name, bindGroup);
    }
    return bindGroup;
  }
  // ---------------------------------------------------------------- shader building blocks
  private declareParams(pb: ProgramBuilder, scope: PBGlobalScope, group = 0) {
    // [0] (totalPages, physicalPages, stamp, maxPageAge)
    // [1] (numLevels, allocBudget, loadCapacity, pinnedFromLevel)
    // [2] (slotsPerRow, slotSize, border, pageSize)
    // [3] (atlasSize, numRects, mipChain, freeThreshold)
    // [4 + l] (first page id, pagesX, pagesY, 0) of level l
    scope.zVT_params = pb.uvec4[4 + MAX_LEVELS]().uniformBuffer(group);
  }
  private defineLevelOf(pb: ProgramBuilder) {
    pb.func('zVT_levelOf', [pb.uint('id')], function () {
      this.$l.level = pb.uint(0);
      this.$for(pb.uint('l'), 1, MAX_LEVELS, function () {
        this.$if(
          pb.or(
            pb.greaterThanEqual(this.l, this.zVT_params.at(1).x),
            pb.lessThan(this.id, this.zVT_params.at(pb.add(this.l, 4)).x)
          ),
          function () {
            this.$break();
          }
        );
        this.level = this.l;
      });
      this.$return(this.level);
    });
  }
  private definePageId(pb: ProgramBuilder) {
    pb.func('zVT_pageId', [pb.uint('level'), pb.vec2('uv')], function () {
      this.$l.info = this.zVT_params.at(pb.add(pb.min(this.level, pb.sub(this.zVT_params.at(1).x, 1)), 4));
      this.$l.pages = pb.vec2(pb.float(this.info.y), pb.float(this.info.z));
      this.$l.pc = pb.uvec2(
        pb.clamp(pb.floor(pb.mul(this.uv, this.pages)), pb.vec2(0), pb.sub(this.pages, pb.vec2(1)))
      );
      this.$return(pb.add(this.info.x, pb.add(pb.mul(this.pc.y, this.info.y), this.pc.x)));
    });
  }
  /** Appends to a physical page list, UE PushPhysicalPageList */
  private definePush(pb: ProgramBuilder) {
    pb.func('zVT_push', [pb.uint('list'), pb.uint('page')], function () {
      this.$l.offset = pb.atomicAdd(this.zVT_listCounts.at(this.list), 1);
      this.$if(pb.lessThan(this.offset, pb.int(this.zVT_params.at(0).y)), function () {
        this.zVT_lists.setAt(
          pb.add(pb.mul(this.list, this.zVT_params.at(0).y), pb.uint(this.offset)),
          this.page
        );
      });
    });
  }
  private buildProgram(name: string): GPUProgram {
    const that = this;
    const base = name.replace(/[01]$/, '');
    const common = (pb: ProgramBuilder, scope: PBGlobalScope) => {
      that.declareParams(pb, scope);
    };
    const lists = (pb: ProgramBuilder, scope: PBGlobalScope) => {
      scope.zVT_lists = pb.uint[0]().storageBuffer(0);
      scope.zVT_listCounts = pb.atomic_int[0]().storageBuffer(0);
    };
    const program = (
      workgroupSize: [number, number, number],
      body: (pb: ProgramBuilder, scope: PBGlobalScope) => void
    ) =>
      this._device.buildComputeProgram({
        label: `VirtualTexture.${name}`,
        workgroupSize,
        compute(pb) {
          common(pb, this);
          body(pb, this);
        }
      })!;
    const loadCount = (pb: ProgramBuilder, scope: PBInsideFunctionScope) =>
      pb.atomicAdd(scope.zVT_listCounts.at(LIST_AVAILABLE), 0);
    switch (base) {
      // UE ClearPageTable + InitPageRectBounds: the page table is rebuilt every update
      case 'clear':
        return program([GROUP, 1, 1], (pb, scope) => {
          scope.zVT_pageTable = pb.uint[0]().storageBuffer(0);
          scope.zVT_counters = pb.atomic_uint[0]().storageBuffer(0);
          scope.zVT_listCounts = pb.atomic_int[0]().storageBuffer(0);
          pb.main(function () {
            this.$l.i = this.$builtins.globalInvocationId.x;
            this.$if(pb.lessThan(this.i, this.zVT_params.at(0).x), function () {
              this.zVT_pageTable.setAt(this.i, pb.uint(0));
            });
            this.$if(pb.lessThan(this.i, NUM_COUNTERS), function () {
              pb.atomicExchange(this.zVT_counters.at(this.i), 0);
            });
            this.$if(pb.lessThan(this.i, 4), function () {
              pb.atomicExchange(this.zVT_listCounts.at(this.i), 0);
            });
          });
        });
      // Marks the resident pages inside the queued regions dirty
      case 'invalidate':
        return program([GROUP, 1, 1], (pb, scope) => {
          scope.zVT_rects = pb.vec4[MAX_RECTS]().uniformBuffer(0);
          scope.zVT_meta = pb.uint[0]().storageBuffer(0);
          that.defineLevelOf(pb);
          pb.main(function () {
            this.$l.p = this.$builtins.globalInvocationId.x;
            this.$if(pb.lessThan(this.p, this.zVT_params.at(0).y), function () {
              this.$l.flags = this.zVT_meta.at(pb.add(pb.mul(this.p, 4), 3));
              this.$if(pb.notEqual(pb.compAnd(this.flags, META_ALLOCATED), 0), function () {
                this.$l.owner = this.zVT_meta.at(pb.mul(this.p, 4));
                this.$l.info = this.zVT_params.at(pb.add(this.zVT_levelOf(this.owner), 4));
                this.$l.local = pb.sub(this.owner, this.info.x);
                this.$l.page = pb.vec2(
                  pb.float(pb.sub(this.local, pb.mul(pb.div(this.local, this.info.y), this.info.y))),
                  pb.float(pb.div(this.local, this.info.y))
                );
                this.$l.lo = pb.div(this.page, pb.vec2(pb.float(this.info.y), pb.float(this.info.z)));
                this.$l.hi = pb.div(
                  pb.add(this.page, pb.vec2(1)),
                  pb.vec2(pb.float(this.info.y), pb.float(this.info.z))
                );
                this.$for(pb.uint('r'), 0, this.zVT_params.at(3).y, function () {
                  this.$l.rect = this.zVT_rects.at(this.r);
                  this.$if(
                    pb.and(
                      pb.all(pb.lessThan(this.lo, this.rect.zw)),
                      pb.all(pb.greaterThan(this.hi, this.rect.xy))
                    ),
                    function () {
                      this.flags = pb.compOr(this.flags, META_DIRTY);
                    }
                  );
                });
                this.zVT_meta.setAt(pb.add(pb.mul(this.p, 4), 3), this.flags);
              });
            });
          });
        });
      // UE UpdatePhysicalPages: walk last update's REQUESTED list (the LRU order), keep the
      // requested and young pages mapped, move requested ones to REQUESTED, free the rest
      case 'updatePhysical':
        return program([GROUP, 1, 1], (pb, scope) => {
          lists(pb, scope);
          scope.zVT_prevLists = pb.uint[0]().storageBufferReadonly(0);
          scope.zVT_pageTable = pb.uint[0]().storageBuffer(0);
          scope.zVT_pageRequest = pb.atomic_uint[0]().storageBuffer(0);
          scope.zVT_meta = pb.uint[0]().storageBuffer(0);
          scope.zVT_fillList = pb.uint[0]().storageBuffer(0);
          scope.zVT_counters = pb.atomic_uint[0]().storageBuffer(0);
          that.definePush(pb);
          pb.main(function () {
            this.$l.i = this.$builtins.globalInvocationId.x;
            this.$l.N = this.zVT_params.at(0).y;
            this.$if(pb.lessThan(this.i, this.N), function () {
              this.$l.p = this.zVT_prevLists.at(pb.add(pb.mul(this.N, LIST_REQUESTED), this.i));
              this.$l.m = pb.mul(this.p, 4);
              this.$l.flags = this.zVT_meta.at(pb.add(this.m, 3));
              this.$l.next = pb.uint(0);
              this.$l.removed = false;
              this.$if(pb.notEqual(pb.compAnd(this.flags, META_ALLOCATED), 0), function () {
                this.$l.owner = this.zVT_meta.at(this.m);
                this.$l.requestedNow = pb.greaterThan(
                  pb.atomicAdd(this.zVT_pageRequest.at(this.owner), 0),
                  0
                );
                this.$l.age = pb.sub(this.zVT_params.at(0).z, this.zVT_meta.at(pb.add(this.m, 2)));
                // In use: requested now, pinned, or requested within the free threshold
                this.$l.requested = pb.or(
                  pb.or(this.requestedNow, pb.notEqual(pb.compAnd(this.flags, META_PINNED), 0)),
                  pb.lessThanEqual(this.age, this.zVT_params.at(3).w)
                );
                this.$if(
                  pb.or(this.requested, pb.lessThanEqual(this.age, this.zVT_params.at(0).w)),
                  function () {
                    this.next = this.flags;
                    this.zVT_pageTable.setAt(this.owner, pb.compOr(pb.uint(PT_MAPPED), this.p));
                    this.$if(this.requested, function () {
                      this.zVT_push(LIST_REQUESTED, this.p);
                      this.removed = true;
                      this.$if(this.requestedNow, function () {
                        this.zVT_meta.setAt(pb.add(this.m, 2), this.zVT_params.at(0).z);
                        pb.atomicAdd(this.zVT_counters.at(C_STAT_REQUESTED), 1);
                      });
                      // Refill in place, ahead of new allocations (UE VSM uncached pages)
                      this.$if(pb.notEqual(pb.compAnd(this.flags, META_DIRTY), 0), function () {
                        this.$l.slot = pb.atomicAdd(this.zVT_counters.at(C_FILL), 1);
                        this.$if(pb.lessThan(this.slot, this.zVT_params.at(1).y), function () {
                          this.zVT_fillList.setAt(pb.mul(this.slot, 2), this.owner);
                          this.zVT_fillList.setAt(pb.add(pb.mul(this.slot, 2), 1), this.p);
                          this.next = pb.compAnd(this.next, pb.uint(~META_DIRTY >>> 0));
                          pb.atomicAdd(this.zVT_counters.at(C_STAT_REFILLED), 1);
                        });
                      });
                    });
                  }
                ).$else(function () {
                  pb.atomicAdd(this.zVT_counters.at(C_STAT_EXPIRED), 1);
                });
              });
              this.$if(pb.equal(this.next, 0), function () {
                this.zVT_push(LIST_EMPTY, this.p);
                this.removed = true;
              });
              this.zVT_meta.setAt(pb.add(this.m, 3), this.next);
              this.zVT_lists.setAt(
                pb.add(pb.mul(this.N, LIST_LRU), this.i),
                pb.select(this.p, pb.uint(INDEX_NONE), this.removed)
              );
            });
          });
        });
      // UE PackAvailablePages: order preserving compaction of the LRU list into AVAILABLE,
      // one workgroup, prefix sums per chunk
      case 'pack':
        return program([PACK_GROUP, 1, 1], (pb, scope) => {
          lists(pb, scope);
          scope.zVT_scan = pb.uint[PACK_GROUP]().workgroup();
          pb.main(function () {
            this.$l.lid = this.$builtins.localInvocationId.x;
            this.$l.N = this.zVT_params.at(0).y;
            this.$l.total = pb.uint(0);
            this.$l.chunks = pb.div(pb.add(this.N, PACK_GROUP - 1), PACK_GROUP);
            this.$for(pb.uint('c'), 0, this.chunks, function () {
              this.$l.idx = pb.add(pb.mul(this.c, PACK_GROUP), this.lid);
              this.$l.v = pb.uint(INDEX_NONE);
              this.$if(pb.lessThan(this.idx, this.N), function () {
                this.v = this.zVT_lists.at(pb.add(pb.mul(this.N, LIST_LRU), this.idx));
              });
              this.$l.valid = pb.select(pb.uint(0), pb.uint(1), pb.notEqual(this.v, INDEX_NONE));
              this.zVT_scan.setAt(this.lid, this.valid);
              pb.workgroupBarrier();
              for (let offset = 1; offset < PACK_GROUP; offset *= 2) {
                this.$l[`t${offset}`] = pb.uint(0);
                this.$if(pb.greaterThanEqual(this.lid, offset), function () {
                  this[`t${offset}`] = this.zVT_scan.at(pb.sub(this.lid, offset));
                });
                pb.workgroupBarrier();
                this.zVT_scan.setAt(this.lid, pb.add(this.zVT_scan.at(this.lid), this[`t${offset}`]));
                pb.workgroupBarrier();
              }
              this.$if(pb.notEqual(this.valid, 0), function () {
                this.zVT_lists.setAt(
                  pb.add(
                    pb.mul(this.N, LIST_AVAILABLE),
                    pb.add(this.total, pb.sub(this.zVT_scan.at(this.lid), 1))
                  ),
                  this.v
                );
              });
              this.total = pb.add(this.total, this.zVT_scan.at(PACK_GROUP - 1));
              pb.workgroupBarrier();
            });
            this.$if(pb.equal(this.lid, 0), function () {
              pb.atomicExchange(this.zVT_listCounts.at(LIST_AVAILABLE), pb.int(this.total));
            });
          });
        });
      // UE AppendPhysicalPageLists, copy pass then count pass
      case 'appendEmpty':
      case 'appendAvailable':
      case 'appendEmptyCount':
      case 'appendAvailableCount': {
        const input = base.startsWith('appendEmpty') ? LIST_EMPTY : LIST_AVAILABLE;
        const output = base.startsWith('appendEmpty') ? LIST_AVAILABLE : LIST_REQUESTED;
        const counts = base.endsWith('Count');
        return program([counts ? 1 : GROUP, 1, 1], (pb, scope) => {
          lists(pb, scope);
          pb.main(function () {
            this.$l.N = pb.int(this.zVT_params.at(0).y);
            this.$l.inCount = pb.max(pb.atomicAdd(this.zVT_listCounts.at(input), 0), 0);
            this.$l.outCount = pb.max(pb.atomicAdd(this.zVT_listCounts.at(output), 0), 0);
            this.$l.copy = pb.max(0, pb.min(this.inCount, pb.sub(this.N, this.outCount)));
            if (counts) {
              pb.atomicExchange(this.zVT_listCounts.at(output), pb.add(this.outCount, this.copy));
              pb.atomicExchange(this.zVT_listCounts.at(input), 0);
            } else {
              this.$l.i = pb.int(this.$builtins.globalInvocationId.x);
              this.$if(pb.lessThan(this.i, this.copy), function () {
                this.zVT_lists.setAt(
                  pb.uint(pb.add(pb.mul(this.N, output), pb.add(this.outCount, this.i))),
                  this.zVT_lists.at(pb.uint(pb.add(pb.mul(this.N, input), this.i)))
                );
              });
            }
          });
        });
      }
      // Requests of unmapped pages become loads with the UE RVT priority count * (1 + level);
      // pinned levels are always requested, at the top priority. Clears the requests.
      case 'gather':
        return program([GROUP, 1, 1], (pb, scope) => {
          scope.zVT_pageTable = pb.uint[0]().storageBufferReadonly(0);
          scope.zVT_pageRequest = pb.atomic_uint[0]().storageBuffer(0);
          scope.zVT_loadList = pb.uint[0]().storageBuffer(0);
          scope.zVT_counters = pb.atomic_uint[0]().storageBuffer(0);
          that.defineLevelOf(pb);
          pb.main(function () {
            this.$l.i = this.$builtins.globalInvocationId.x;
            this.$if(pb.lessThan(this.i, this.zVT_params.at(0).x), function () {
              this.$l.count = pb.atomicExchange(this.zVT_pageRequest.at(this.i), 0);
              this.$l.level = this.zVT_levelOf(this.i);
              this.$l.pinned = pb.greaterThanEqual(this.level, this.zVT_params.at(1).w);
              this.$if(this.pinned, function () {
                this.count = pb.max(this.count, 1);
              });
              this.$if(
                pb.and(
                  pb.greaterThan(this.count, 0),
                  pb.equal(pb.compAnd(this.zVT_pageTable.at(this.i), PT_THIS_LOD), 0)
                ),
                function () {
                  this.$l.priority = pb.mul(this.count, pb.add(this.level, 1));
                  this.$l.bucket = pb.select(
                    pb.min(pb.uint(pb.floor(pb.log2(pb.float(this.priority)))), 30),
                    pb.uint(HIST_PINNED_BUCKET),
                    this.pinned
                  );
                  this.$l.slot = pb.atomicAdd(this.zVT_counters.at(C_LOAD), 1);
                  this.$if(pb.lessThan(this.slot, this.zVT_params.at(1).z), function () {
                    this.zVT_loadList.setAt(pb.mul(this.slot, 3), this.i);
                    this.zVT_loadList.setAt(pb.add(pb.mul(this.slot, 3), 1), this.bucket);
                    this.zVT_loadList.setAt(pb.add(pb.mul(this.slot, 3), 2), this.level);
                    pb.atomicAdd(this.zVT_counters.at(pb.add(this.bucket, C_HIST)), 1);
                  }).$else(function () {
                    pb.atomicAdd(this.zVT_counters.at(C_STAT_DROPPED), 1);
                  });
                }
              );
            });
          });
        });
      // The budget cut. UE sorts the loads by priority on the CPU and keeps the first
      // MaxUploadsPerFrame; here buckets above the cut are taken whole and the cut bucket in
      // atomic order (see the design notes)
      case 'select':
        return program([1, 1, 1], (pb, scope) => {
          scope.zVT_counters = pb.atomic_uint[0]().storageBuffer(0);
          scope.zVT_listCounts = pb.atomic_int[0]().storageBuffer(0);
          scope.zVT_dispatchArgs = pb.uint[0]().storageBuffer(0);
          pb.main(function () {
            this.$l.available = pb.uint(pb.max(loadCount(pb, this), 0));
            this.$l.budget = this.zVT_params.at(1).y;
            this.$l.refills = pb.min(pb.atomicAdd(this.zVT_counters.at(C_FILL), 0), this.budget);
            this.$l.quota = pb.min(pb.sub(this.budget, this.refills), this.available);
            this.$l.taken = pb.uint(0);
            this.$l.cut = pb.uint(INDEX_NONE);
            this.$for(pb.int('k'), 0, 32, function () {
              this.$l.b = pb.uint(pb.sub(31, this.k));
              this.$l.h = pb.atomicAdd(this.zVT_counters.at(pb.add(this.b, C_HIST)), 0);
              this.$if(pb.lessThanEqual(pb.add(this.taken, this.h), this.quota), function () {
                this.taken = pb.add(this.taken, this.h);
              }).$else(function () {
                this.cut = this.b;
                this.$break();
              });
            });
            pb.atomicExchange(this.zVT_counters.at(C_CUT), this.cut);
            pb.atomicExchange(this.zVT_counters.at(C_REMAIN), pb.sub(this.quota, this.taken));
            this.$l.loads = pb.min(pb.atomicAdd(this.zVT_counters.at(C_LOAD), 0), this.zVT_params.at(1).z);
            this.zVT_dispatchArgs.setAt(0, pb.div(pb.add(this.loads, GROUP - 1), GROUP));
            this.zVT_dispatchArgs.setAt(1, pb.uint(1));
            this.zVT_dispatchArgs.setAt(2, pb.uint(1));
          });
        });
      // UE AllocateNewPageMappings: pop from the end of AVAILABLE, unmap the page's previous
      // owner, map the new one
      case 'allocate':
        return program([GROUP, 1, 1], (pb, scope) => {
          lists(pb, scope);
          scope.zVT_pageTable = pb.uint[0]().storageBuffer(0);
          scope.zVT_meta = pb.uint[0]().storageBuffer(0);
          scope.zVT_loadList = pb.uint[0]().storageBufferReadonly(0);
          scope.zVT_fillList = pb.uint[0]().storageBuffer(0);
          scope.zVT_counters = pb.atomic_uint[0]().storageBuffer(0);
          that.definePush(pb);
          pb.main(function () {
            this.$l.k = this.$builtins.globalInvocationId.x;
            this.$l.loads = pb.min(pb.atomicAdd(this.zVT_counters.at(C_LOAD), 0), this.zVT_params.at(1).z);
            this.$if(pb.lessThan(this.k, this.loads), function () {
              this.$l.id = this.zVT_loadList.at(pb.mul(this.k, 3));
              this.$l.bucket = this.zVT_loadList.at(pb.add(pb.mul(this.k, 3), 1));
              this.$l.level = this.zVT_loadList.at(pb.add(pb.mul(this.k, 3), 2));
              this.$l.cut = pb.atomicAdd(this.zVT_counters.at(C_CUT), 0);
              this.$l.take = pb.or(pb.equal(this.cut, INDEX_NONE), pb.greaterThan(this.bucket, this.cut));
              this.$if(pb.equal(this.bucket, this.cut), function () {
                this.take = pb.lessThan(
                  pb.atomicAdd(this.zVT_counters.at(C_TIE), 1),
                  pb.atomicAdd(this.zVT_counters.at(C_REMAIN), 0)
                );
              });
              this.$l.slot = pb.uint(INDEX_NONE);
              this.$if(this.take, function () {
                // A fill slot first: a page mapped without one would show another page's texels
                this.slot = pb.atomicAdd(this.zVT_counters.at(C_FILL), 1);
                this.take = pb.lessThan(this.slot, this.zVT_params.at(1).y);
              });
              this.$if(this.take, function () {
                this.$l.top = pb.atomicSub(this.zVT_listCounts.at(LIST_AVAILABLE), 1);
                // Out of pages: the slot stays reserved but empty, the fill pass skips it
                this.$if(pb.lessThanEqual(this.top, 0), function () {
                  this.zVT_fillList.setAt(pb.mul(this.slot, 2), pb.uint(INDEX_NONE));
                });
                this.$if(pb.greaterThan(this.top, 0), function () {
                  this.$l.N = this.zVT_params.at(0).y;
                  this.$l.p = this.zVT_lists.at(
                    pb.add(pb.mul(this.N, LIST_AVAILABLE), pb.uint(pb.sub(this.top, 1)))
                  );
                  this.$l.m = pb.mul(this.p, 4);
                  this.$if(
                    pb.notEqual(pb.compAnd(this.zVT_meta.at(pb.add(this.m, 3)), META_ALLOCATED), 0),
                    function () {
                      this.zVT_pageTable.setAt(this.zVT_meta.at(this.m), pb.uint(0));
                      pb.atomicAdd(this.zVT_counters.at(C_STAT_EVICTED), 1);
                    }
                  );
                  this.zVT_pageTable.setAt(this.id, pb.compOr(pb.uint(PT_MAPPED), this.p));
                  this.zVT_meta.setAt(this.m, this.id);
                  this.zVT_meta.setAt(pb.add(this.m, 1), this.level);
                  this.zVT_meta.setAt(pb.add(this.m, 2), this.zVT_params.at(0).z);
                  this.zVT_meta.setAt(
                    pb.add(this.m, 3),
                    pb.select(
                      pb.uint(META_ALLOCATED),
                      pb.uint(META_ALLOCATED | META_PINNED),
                      pb.greaterThanEqual(this.level, this.zVT_params.at(1).w)
                    )
                  );
                  this.zVT_push(LIST_REQUESTED, this.p);
                  this.zVT_fillList.setAt(pb.mul(this.slot, 2), this.id);
                  this.zVT_fillList.setAt(pb.add(pb.mul(this.slot, 2), 1), this.p);
                  pb.atomicAdd(this.zVT_counters.at(C_STAT_ALLOCATED), 1);
                });
              });
            });
          });
        });
      case 'finalize':
        return program([1, 1, 1], (pb, scope) => {
          scope.zVT_counters = pb.atomic_uint[0]().storageBuffer(0);
          scope.zVT_dispatchArgs = pb.uint[0]().storageBuffer(0);
          scope.zVT_listCounts = pb.atomic_int[0]().storageBuffer(0);
          scope.zVT_state = pb.vec4[0]().storageBuffer(0);
          pb.main(function () {
            // UE UpdateResidencyTracking: pages used within the free threshold (here: the
            // REQUESTED list, which also holds the pinned and the newly mapped pages) over the pool
            this.$l.state = this.zVT_state.at(0);
            this.$l.residency = pb.div(
              pb.float(pb.max(pb.atomicAdd(this.zVT_listCounts.at(LIST_REQUESTED), 0), 0)),
              pb.float(this.zVT_params.at(0).y)
            );
            this.$l.bias = this.state.x;
            this.$if(
              pb.and(pb.greaterThan(this.bias, 0), pb.lessThan(this.residency, this.state.z)),
              function () {
                this.bias = pb.sub(
                  this.bias,
                  pb.mul(RESIDENCY_ADJUSTMENT_RATE, pb.sub(this.state.z, this.residency))
                );
              }
            ).$elseif(pb.greaterThan(this.residency, this.state.y), function () {
              this.bias = pb.add(
                this.bias,
                pb.mul(RESIDENCY_ADJUSTMENT_RATE, pb.sub(this.residency, this.state.y))
              );
            });
            this.bias = pb.clamp(this.bias, 0, RESIDENCY_MAX_MIP_BIAS);
            this.$if(
              pb.or(pb.lessThan(this.state.y, 0), pb.greaterThan(this.state.w, RESIDENCY_LOCKED_UPPER_BOUND)),
              function () {
                this.bias = pb.float(0);
              }
            );
            this.zVT_state.setAt(0, pb.vec4(this.bias, this.state.yzw));
            this.zVT_dispatchArgs.setAt(
              3,
              pb.min(pb.atomicAdd(this.zVT_counters.at(C_FILL), 0), this.zVT_params.at(1).y)
            );
            this.zVT_dispatchArgs.setAt(4, pb.uint(1));
            this.zVT_dispatchArgs.setAt(5, pb.uint(1));
          });
        });
      // UE PropagateMappedMips (local light mip branch): unmapped pages point at their nearest
      // resident ancestor, one thread per finest level page walking from the coarsest level down
      case 'propagate':
        return program([FILL_GROUP, FILL_GROUP, 1], (pb, scope) => {
          scope.zVT_pageTable = pb.uint[0]().storageBuffer(0);
          pb.main(function () {
            this.$l.xy = this.$builtins.globalInvocationId.xy;
            this.$l.info0 = this.zVT_params.at(4);
            this.$if(
              pb.and(pb.lessThan(this.xy.x, this.info0.y), pb.lessThan(this.xy.y, this.info0.z)),
              function () {
                this.$l.numLevels = this.zVT_params.at(1).x;
                this.$l.mapped = false;
                this.$l.mappedLevel = pb.uint(0);
                this.$l.mappedPhys = pb.uint(0);
                this.$for(pb.uint('k'), 0, this.numLevels, function () {
                  this.$l.l = pb.sub(pb.sub(this.numLevels, 1), this.k);
                  this.$l.info = this.zVT_params.at(pb.add(this.l, 4));
                  this.$l.v = pb.uvec2(pb.sar(this.xy.x, this.l), pb.sar(this.xy.y, this.l));
                  this.$l.id = pb.add(this.info.x, pb.add(pb.mul(this.v.y, this.info.y), this.v.x));
                  this.$l.e = this.zVT_pageTable.at(this.id);
                  this.$if(pb.notEqual(pb.compAnd(this.e, PT_THIS_LOD), 0), function () {
                    this.mapped = true;
                    this.mappedLevel = this.l;
                    this.mappedPhys = pb.compAnd(this.e, PT_PHYS_MASK);
                  }).$elseif(
                    pb.and(
                      this.mapped,
                      pb.equal(pb.uvec2(pb.sal(this.v.x, this.l), pb.sal(this.v.y, this.l)), this.xy)
                    ),
                    function () {
                      this.zVT_pageTable.setAt(
                        this.id,
                        pb.compOr(
                          pb.compOr(
                            pb.uint(PT_ANY_LOD),
                            pb.sal(pb.sub(this.mappedLevel, this.l), PT_LOD_SHIFT)
                          ),
                          this.mappedPhys
                        )
                      );
                    }
                  );
                });
              }
            );
          });
        });
      case 'debug':
        return program([FILL_GROUP, FILL_GROUP, 1], (pb, scope) => {
          scope.zVT_pageTable = pb.uint[0]().storageBufferReadonly(0);
          scope.zVT_meta = pb.uint[0]().storageBufferReadonly(0);
          scope.zVT_debugLevel = pb.uint().uniform(0);
          scope.zVT_debug = pb.texStorage2D.rgba8unorm().storage(0);
          pb.main(function () {
            this.$l.xy = this.$builtins.globalInvocationId.xy;
            this.$l.info0 = this.zVT_params.at(4);
            this.$if(
              pb.and(pb.lessThan(this.xy.x, this.info0.y), pb.lessThan(this.xy.y, this.info0.z)),
              function () {
                this.$l.l = this.zVT_debugLevel;
                this.$l.info = this.zVT_params.at(pb.add(this.l, 4));
                this.$l.v = pb.uvec2(pb.sar(this.xy.x, this.l), pb.sar(this.xy.y, this.l));
                this.$l.e = this.zVT_pageTable.at(
                  pb.add(this.info.x, pb.add(pb.mul(this.v.y, this.info.y), this.v.x))
                );
                this.$l.color = pb.vec4(0, 0, 0, 1);
                this.$if(pb.notEqual(pb.compAnd(this.e, PT_THIS_LOD), 0), function () {
                  this.$l.m = pb.mul(pb.compAnd(this.e, PT_PHYS_MASK), 4);
                  this.$l.fresh = pb.equal(this.zVT_meta.at(pb.add(this.m, 2)), this.zVT_params.at(0).z);
                  this.color = pb.vec4(0, pb.select(0.45, 1, this.fresh), 0, 1);
                  this.$if(
                    pb.notEqual(pb.compAnd(this.zVT_meta.at(pb.add(this.m, 3)), META_PINNED), 0),
                    function () {
                      this.color = pb.vec4(0, 0.8, 0.8, 1);
                    }
                  );
                }).$elseif(pb.notEqual(pb.compAnd(this.e, PT_ANY_LOD), 0), function () {
                  this.$l.lod = pb.float(pb.compAnd(pb.sar(this.e, PT_LOD_SHIFT), PT_LOD_MASK));
                  this.color = pb.vec4(0.1, 0.1, pb.max(0.25, pb.sub(1, pb.mul(this.lod, 0.12))), 1);
                });
                pb.textureStore(this.zVT_debug, this.xy, this.color);
              }
            );
          });
        });
      default:
        throw new Error(`VirtualTexture: unknown program ${name}`);
    }
  }
  protected onDispose() {
    super.onDispose();
    for (const tex of this._planeTextures) {
      tex.dispose();
    }
    for (const buffer of [
      this._params,
      this._rects,
      this._pageTable,
      this._pageRequest,
      this._meta,
      ...this._lists,
      this._listCounts,
      this._loadList,
      this._fillList,
      this._counters,
      this._dispatchArgs,
      this._state
    ]) {
      buffer.dispose();
    }
    for (const bindGroup of this._bindGroups.values()) {
      bindGroup.dispose();
    }
    this._debugTexture?.dispose();
  }
}
