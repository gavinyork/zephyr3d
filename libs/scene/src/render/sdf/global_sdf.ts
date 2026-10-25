import type { BindGroup, GPUDataBuffer, GPUProgram, Texture2D, Texture3D } from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import type { ClipmapTerrain } from '../../scene/terrain-cm/terrain-cm';
import {
  declareGlobalSDFUniforms,
  GLOBAL_SDF_LEVELS,
  GLOBAL_SDF_PARAMS,
  GLOBAL_SDF_TEXTURE,
  GLOBAL_SDF_BRICK,
  GLOBAL_SDF_TAGS,
  declareDynamicSDFUniforms,
  MAX_DYNAMIC_SDF_INSTANCES,
  SDF_ATLAS_TEXTURE,
  SDF_DYNAMIC_INFO,
  SDF_DYNAMIC_INSTANCES,
  SDF_INSTANCE_VEC4S,
  sampleInstancesSDF,
  sampleSceneSDF
} from '../../shaders/sdf';
import type { SceneSDF, SDFInstance } from './scene_sdf';
import type { MeshSDFAtlas } from './sdf_atlas';
import { SDFWaterlineSource, WaterlineField } from './waterline';
import { buildSDFProgram, getSDFProgramErrors } from './sdf_programs';
import { sampleInstanceMaterial } from '../../shaders/gi';
import type { VoxelAtlasSlot } from '../gi/voxel_atlas';

/** Voxels along a brick edge, the unit of compositing. */
const BRICK = GLOBAL_SDF_BRICK;
/** vec4s per brick in the brick buffer. */
const BRICK_VEC4S = 3;
/** Most points per {@link GlobalSDF.queryDistances} call. */
const MAX_QUERY_POINTS = 4096;

/**
 * Writes an instance in the layout of {@link SDF_INSTANCE_VEC4S}: world to
 * local by rows, the field box with the voxel size and the world scale, and
 * the atlas slot with the half thickness of a two-sided field's solid (half a
 * field voxel, in world units; -1 for a one-sided field). The scale is the
 * smallest axis scale, so a distance scaled by it never overshoots under
 * non-uniform scale.
 */
function packSDFInstance(inst: SDFInstance, atlas: MeshSDFAtlas, out: Float32Array, offset: number) {
  const header = inst.asset!.header!;
  const slot = atlas.getSlot(inst.asset!)!;
  const inv = inst.mesh.invWorldMatrix;
  const m = inst.mesh.worldMatrix;
  const scale = Math.min(
    Math.hypot(m.m00, m.m10, m.m20),
    Math.hypot(m.m01, m.m11, m.m21),
    Math.hypot(m.m02, m.m12, m.m22)
  );
  out.set([inv.m00, inv.m01, inv.m02, inv.m03], offset);
  out.set([inv.m10, inv.m11, inv.m12, inv.m13], offset + 4);
  out.set([inv.m20, inv.m21, inv.m22, inv.m23], offset + 8);
  out.set([...header.boxMin, header.voxelSize], offset + 12);
  out.set([...header.boxMax, scale], offset + 16);
  out.set([...slot.offset, header.twoSided ? 0.5 * header.voxelSize * scale : -1], offset + 20);
}

/**
 * Settings of a {@link GlobalSDF}.
 * @public
 */
export interface GlobalSDFOptions {
  /** Clipmap levels, each twice the voxel size of the previous. Default 4. */
  levels?: number;
  /** Voxels per axis of every level, a multiple of 8. Default 128. */
  resolution?: number;
  /** Voxel size of the finest level in world units. Default 0.25. */
  baseVoxelSize?: number;
  /** Distances are kept within this many voxels of a level; farther is the next level's job. Default 4. */
  bandVoxels?: number;
  /** Bricks composited per frame. Default 512. */
  brickBudget?: number;
}

/**
 * Counters of a {@link GlobalSDF}.
 * @public
 */
export interface GlobalSDFStats {
  levels: number;
  resolution: number;
  voxelSizes: number[];
  /** World position of each level's window minimum. */
  origins: [number, number, number][];
  dirtyBricks: number;
  /** Bricks composited by the last update. */
  lastBricks: number;
  totalBricks: number;
  terrain: boolean;
  /** Waterline grids built so far, 0 while none was asked for. */
  waterlineRebuilds: number;
}

/**
 * What the field composites materials from and into, when it does: the
 * material atlases the voxelized meshes live in, the clipmaps (albedo
 * rgba8unorm, emissive rgba16float; the field's layout at half its
 * resolution) to write, the terrain's colour, and the atlas slot of an
 * instance. Provided by the voxel scene.
 * @public
 */
export interface GlobalSDFMaterials {
  readonly atlasAlbedo: Texture3D;
  readonly atlasEmissive: Texture3D;
  readonly atlasSize: [number, number, number];
  readonly albedo: Texture3D;
  readonly emissive: Texture3D;
  readonly terrainAlbedo: Vector4;
  getSlot(inst: SDFInstance): Nullable<VoxelAtlasSlot>;
}

/**
 * A clipmap of signed distance around the camera: `levels` cubes of
 * `resolution`³ voxels, centred on the camera, each with twice the voxel size
 * of the one inside it. Built on the GPU from the static instances of a
 * {@link SceneSDF} (their baked fields, sampled from its atlas) and the
 * terrain height map, and kept up to date incrementally.
 *
 * Each level is addressed toroidally: a world voxel `v` lives at texel
 * `v mod resolution`, so when the window follows the camera only the slabs that
 * entered it are composited; the rest of the level stays where it is. Work is
 * counted in 8³ bricks, marked dirty by window moves and by the scene field's
 * `dirty` boxes, and composited a budget per frame, coarsest level first.
 *
 * Distances are clamped to a band of a few voxels per level, so a brick only
 * needs the instances within that band; {@link sampleGlobalSDF} falls back to
 * coarser levels outside it.
 *
 * WebGPU only: the levels are written by a compute shader.
 *
 * @public
 */
export class GlobalSDF {
  readonly levels: number;
  readonly resolution: number;
  readonly baseVoxelSize: number;
  readonly bandVoxels: number;
  brickBudget: number;
  private readonly _sdf: SceneSDF;
  private _texture: Nullable<Texture3D>;
  private _tags: Nullable<Texture3D>;
  /** Window minimum of each level in voxels of that level; null before the first update. */
  private readonly _origins: Nullable<[number, number, number]>[];
  /** Dirty bricks of each level, keyed by world brick coordinates. */
  private readonly _dirty: Set<string>[];
  private _lastBricks: number;
  private _totalBricks: number;
  private _terrain: Nullable<ClipmapTerrain>;
  private _terrainVersion: number;
  private _program: Nullable<GPUProgram>;
  private _bindGroup: Nullable<BindGroup>;
  private _instanceBuffer: Nullable<GPUDataBuffer>;
  private _brickBuffer: Nullable<GPUDataBuffer>;
  private _indexBuffer: Nullable<GPUDataBuffer>;
  private _materialBuffer: Nullable<GPUDataBuffer>;
  private _materials: Nullable<GlobalSDFMaterials>;
  private _dummyHeightMap: Nullable<Texture2D>;
  private _queryProgram: Nullable<GPUProgram>;
  private _queryBindGroup: Nullable<BindGroup>;
  private _queryPoints: Nullable<GPUDataBuffer>;
  private _queryOutput: Nullable<Texture2D>;
  private _queryChain: Promise<unknown>;
  private readonly _levelInfo: Float32Array<ArrayBuffer>;
  private readonly _dynamicData: Float32Array<ArrayBuffer>;
  private readonly _dynamicInfo: Vector4;
  private _waterline: Nullable<WaterlineField>;
  private _contentVersion: number;
  private _staticVersion: number;
  private _prevDynamic: Float32Array;
  private readonly _params: Vector4;
  constructor(sdf: SceneSDF, options?: GlobalSDFOptions) {
    this._sdf = sdf;
    this.levels = Math.max(1, Math.min(8, Math.floor(options?.levels ?? 4)));
    this.resolution = Math.max(BRICK * 2, Math.ceil((options?.resolution ?? 128) / BRICK) * BRICK);
    this.baseVoxelSize = Math.max(1e-3, options?.baseVoxelSize ?? 0.25);
    this.bandVoxels = Math.max(1, options?.bandVoxels ?? 4);
    this.brickBudget = Math.max(1, Math.floor(options?.brickBudget ?? 512));
    this._texture = null;
    this._tags = null;
    this._origins = new Array(this.levels).fill(null);
    this._dirty = Array.from({ length: this.levels }, () => new Set<string>());
    this._lastBricks = 0;
    this._totalBricks = 0;
    this._terrain = null;
    this._terrainVersion = -1;
    this._program = null;
    this._bindGroup = null;
    this._instanceBuffer = null;
    this._brickBuffer = null;
    this._indexBuffer = null;
    this._materialBuffer = null;
    this._materials = null;
    this._dummyHeightMap = null;
    this._queryProgram = null;
    this._queryBindGroup = null;
    this._queryPoints = null;
    this._queryOutput = null;
    this._queryChain = Promise.resolve();
    this._levelInfo = new Float32Array(this.levels * 4);
    this._dynamicData = new Float32Array(MAX_DYNAMIC_SDF_INSTANCES * SDF_INSTANCE_VEC4S * 4);
    this._dynamicInfo = new Vector4();
    this._waterline = null;
    this._contentVersion = 0;
    this._staticVersion = 0;
    this._prevDynamic = new Float32Array(this._dynamicData.length + 1);
    this._params = new Vector4(this.resolution, this.levels, this.bandVoxels, 0);
  }
  /** True on a device that can build the field. */
  static isSupported() {
    return getDevice().type === 'webgpu';
  }
  /** The levels, stacked along z, r32f. */
  get texture() {
    if (!this._texture) {
      const n = this.resolution;
      this._texture = getDevice().createTexture3D('r32f', n, n, n * this.levels, {
        mipmapping: false,
        writable: true
      })!;
      this._texture.name = '@GlobalSDF';
    }
    return this._texture;
  }
  /**
   * One texel per brick, levels stacked along z: (world brick x, y, z, 1) of
   * the brick last composited there. Starts all zero, which no brick matches.
   */
  get tags() {
    if (!this._tags) {
      const nb = this.resolution / BRICK;
      this._tags = getDevice().createTexture3D('rgba32f', nb, nb, nb * this.levels, {
        mipmapping: false,
        writable: true
      })!;
      this._tags.name = '@GlobalSDFTags';
    }
    return this._tags;
  }
  /** Voxel size of a level in world units. */
  voxelSize(level: number) {
    return this.baseVoxelSize * 2 ** level;
  }
  /** (window origin in voxels, voxel size) per level, the `levels` uniform of {@link sampleGlobalSDF}. */
  get levelInfo() {
    return this._levelInfo;
  }
  /** (resolution, levels, band voxels, 0), the `params` uniform of {@link sampleGlobalSDF}. */
  get params() {
    return this._params;
  }
  /**
   * Horizontal distance to the waterline at a water level, for shoreline
   * effects; built on demand, see {@link WaterlineField.request}.
   */
  get waterline() {
    if (!this._waterline) {
      this._waterline = new WaterlineField(new SDFWaterlineSource(this));
    }
    return this._waterline;
  }
  /**
   * Goes up whenever the field may have changed: a region marked dirty, bricks
   * composited, or the dynamic instances moved. Lets derived data such as the
   * waterline skip rebuilding while nothing changed.
   */
  get contentVersion() {
    return this._contentVersion;
  }
  /**
   * As {@link GlobalSDF.contentVersion}, but only for the clipmap itself (static
   * geometry and the terrain), not the dynamic instances merged at query time.
   */
  get staticVersion() {
    return this._staticVersion;
  }
  /** Dynamic instances merged at query time this frame. */
  get dynamicCount() {
    return this._dynamicInfo.x;
  }
  /**
   * The materials composited alongside the distances, or null for distances
   * alone. Changing it rebuilds the whole field.
   */
  get materials() {
    return this._materials;
  }
  set materials(val: Nullable<GlobalSDFMaterials>) {
    if (val !== this._materials) {
      this._materials = val;
      this._program?.dispose();
      this._program = null;
      this._bindGroup?.dispose();
      this._bindGroup = null;
      this.invalidate();
    }
  }
  /**
   * Binds the field for {@link sampleSceneSDF} in a program that declared the
   * global and the dynamic uniforms.
   */
  applyBindGroup(bindGroup: BindGroup) {
    const atlas = this._sdf.atlas;
    bindGroup.setTexture(SDF_ATLAS_TEXTURE, atlas.texture, fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue(SDF_DYNAMIC_INSTANCES, this._dynamicData);
    bindGroup.setValue(SDF_DYNAMIC_INFO, this._dynamicInfo);
    // Read with textureLoad, but the unfilterable binding still has a sampler
    // slot, which a filtering sampler fails to validate against
    bindGroup.setTexture(GLOBAL_SDF_TEXTURE, this.texture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture(GLOBAL_SDF_TAGS, this.tags, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue(GLOBAL_SDF_LEVELS, this._levelInfo);
    bindGroup.setValue(GLOBAL_SDF_PARAMS, this._params);
  }
  getStats(): GlobalSDFStats {
    let dirty = 0;
    for (const set of this._dirty) {
      dirty += set.size;
    }
    return {
      levels: this.levels,
      resolution: this.resolution,
      voxelSizes: Array.from({ length: this.levels }, (_, i) => this.voxelSize(i)),
      origins: this._origins.map((o, i) =>
        o ? (o.map((v) => v * this.voxelSize(i)) as [number, number, number]) : [0, 0, 0]
      ),
      dirtyBricks: dirty,
      lastBricks: this._lastBricks,
      totalBricks: this._totalBricks,
      terrain: !!this._terrain,
      waterlineRebuilds: this._waterline?.rebuilds ?? 0
    };
  }
  /** Shader compile errors of the composite and query programs, for diagnosis. */
  getProgramErrors() {
    return getSDFProgramErrors();
  }
  /** Marks every brick within band reach of a world box for rebuilding. */
  markDirty(min: Vector3, max: Vector3) {
    this._contentVersion++;
    this._staticVersion++;
    for (let level = 0; level < this.levels; level++) {
      const origin = this._origins[level];
      if (!origin) {
        continue;
      }
      const vs = this.voxelSize(level);
      const reach = this.bandVoxels * vs;
      const b = BRICK * vs;
      const lo = [min.x - reach, min.y - reach, min.z - reach].map((v) => Math.floor(v / b));
      const hi = [max.x + reach, max.y + reach, max.z + reach].map((v) => Math.floor(v / b));
      const wlo = origin.map((v) => v / BRICK);
      const whi = wlo.map((v) => v + this.resolution / BRICK - 1);
      for (let z = Math.max(lo[2], wlo[2]); z <= Math.min(hi[2], whi[2]); z++) {
        for (let y = Math.max(lo[1], wlo[1]); y <= Math.min(hi[1], whi[1]); y++) {
          for (let x = Math.max(lo[0], wlo[0]); x <= Math.min(hi[0], whi[0]); x++) {
            this._dirty[level].add(`${x},${y},${z}`);
          }
        }
      }
    }
  }
  /** Marks everything for rebuilding. */
  invalidate() {
    for (let level = 0; level < this.levels; level++) {
      this._origins[level] = null;
      this._dirty[level].clear();
    }
  }
  /**
   * Follows the camera and composites up to {@link GlobalSDF.brickBudget} dirty
   * bricks. Called by the scene field once a frame, after its atlas uploads.
   */
  update(cameraPos: Vector3, terrain: Nullable<ClipmapTerrain>) {
    if (terrain !== this._terrain || (terrain && terrain.heightVersion !== this._terrainVersion)) {
      const old = this._terrain;
      this._terrain = terrain;
      this._terrainVersion = terrain?.heightVersion ?? -1;
      for (const t of [old, terrain]) {
        const box = t?.getWorldBoundingVolume()?.toAABB();
        if (box) {
          this.markDirty(box.minPoint, box.maxPoint);
        }
      }
    }
    for (let level = 0; level < this.levels; level++) {
      this.moveWindow(level, cameraPos);
    }
    this.composite();
    this.gatherDynamic(cameraPos);
    this._waterline?.update(cameraPos);
  }
  /** Packs the ready dynamic instances nearest the camera for query-time merging. @internal */
  private gatherDynamic(cameraPos: Vector3) {
    const reach = this.resolution * 0.5 * this.voxelSize(this.levels - 1);
    const near: { inst: SDFInstance; d: number }[] = [];
    for (const inst of this._sdf.instances) {
      if (inst.mode === 'dynamic' && this._sdf.isReady(inst)) {
        const lo = inst.bounds.minPoint;
        const hi = inst.bounds.maxPoint;
        const d = Math.hypot(
          Math.max(lo.x - cameraPos.x, 0, cameraPos.x - hi.x),
          Math.max(lo.y - cameraPos.y, 0, cameraPos.y - hi.y),
          Math.max(lo.z - cameraPos.z, 0, cameraPos.z - hi.z)
        );
        if (d <= reach) {
          near.push({ inst, d });
        }
      }
    }
    near.sort((a, b) => a.d - b.d);
    const count = Math.min(near.length, MAX_DYNAMIC_SDF_INSTANCES);
    const atlas = this._sdf.atlas;
    for (let i = 0; i < count; i++) {
      packSDFInstance(near[i].inst, atlas, this._dynamicData, i * SDF_INSTANCE_VEC4S * 4);
    }
    this._dynamicInfo.setXYZW(count, 1 / atlas.size[0], 1 / atlas.size[1], 1 / atlas.size[2]);
    // Changed when an instance moved or the set changed
    const used = count * SDF_INSTANCE_VEC4S * 4;
    let changed = this._prevDynamic[0] !== count;
    for (let i = 0; i < used && !changed; i++) {
      changed = this._prevDynamic[i + 1] !== this._dynamicData[i];
    }
    if (changed) {
      this._prevDynamic[0] = count;
      this._prevDynamic.set(this._dynamicData.subarray(0, used), 1);
      this._contentVersion++;
    }
  }
  /**
   * Signed distances at world positions, read back from the GPU; resolves a
   * frame or two later. For tools and gameplay queries, not per-frame use.
   */
  queryDistances(points: Vector3[]): Promise<Float32Array> {
    const run = async () => {
      const n = Math.min(points.length, MAX_QUERY_POINTS);
      const out = new Float32Array(points.length);
      if (n === 0 || !this._texture) {
        return out;
      }
      const device = getDevice();
      const pixels = new Float32Array(MAX_QUERY_POINTS);
      // Recorded at the start of a frame, like the water surface queries:
      // outside one the dispatch has no command stream to land in
      await device.runNextFrameAsync(async () => {
        if (!this._queryProgram) {
          this._queryProgram = this.createQueryProgram();
          this._queryBindGroup = device.createBindGroup(this._queryProgram.bindGroupLayouts[0]);
          this._queryPoints = device.createBuffer(MAX_QUERY_POINTS * 16, { usage: 'uniform', storage: true });
          this._queryOutput = device.createTexture2D('r32f', MAX_QUERY_POINTS, 1, {
            mipmapping: false,
            writable: true
          })!;
        }
        const data = new Float32Array(MAX_QUERY_POINTS * 4);
        for (let i = 0; i < n; i++) {
          data[i * 4] = points[i].x;
          data[i * 4 + 1] = points[i].y;
          data[i * 4 + 2] = points[i].z;
        }
        this._queryPoints!.bufferSubData(0, data);
        const bg = this._queryBindGroup!;
        bg.setBuffer('points', this._queryPoints!);
        bg.setTexture('result', this._queryOutput!);
        bg.setValue('count', new Vector4(n, 0, 0, 0));
        this.applyBindGroup(bg);
        device.setProgram(this._queryProgram);
        device.setBindGroup(0, bg);
        device.compute(Math.ceil(n / 64), 1, 1);
        // The copy for the readback is recorded right after the dispatch, and
        // flushed so it does not wait behind the frame's own passes
        const read = this._queryOutput!.readPixels(0, 0, MAX_QUERY_POINTS, 1, 0, 0, pixels);
        device.flush();
        await read;
      });
      out.set(pixels.subarray(0, n));
      return out;
    };
    const next = this._queryChain.then(run, run);
    this._queryChain = next.catch(() => undefined);
    return next;
  }
  dispose() {
    this._waterline?.dispose();
    this._waterline = null;
    this._texture?.dispose();
    this._texture = null;
    this._tags?.dispose();
    this._tags = null;
    this._instanceBuffer?.dispose();
    this._brickBuffer?.dispose();
    this._indexBuffer?.dispose();
    this._materialBuffer?.dispose();
    this._dummyHeightMap?.dispose();
    this._queryPoints?.dispose();
    this._queryOutput?.dispose();
    this._bindGroup?.dispose();
    this._queryBindGroup?.dispose();
    this._instanceBuffer = this._brickBuffer = this._indexBuffer = this._queryPoints = null;
    this._materialBuffer = null;
    this._dummyHeightMap = this._queryOutput = null;
    this._bindGroup = this._queryBindGroup = null;
    this.invalidate();
  }
  /** Re-centres a level on the camera, dirtying the bricks that entered. @internal */
  private moveWindow(level: number, cameraPos: Vector3) {
    const vs = this.voxelSize(level);
    const n = this.resolution;
    const nb = n / BRICK;
    // Snapped to bricks so a brick always maps to one contiguous block of texels
    const next: [number, number, number] = [cameraPos.x, cameraPos.y, cameraPos.z].map(
      (c) => (Math.floor(c / (vs * BRICK)) - nb / 2) * BRICK
    ) as [number, number, number];
    const prev = this._origins[level];
    if (prev && prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) {
      return;
    }
    this._origins[level] = next;
    this._levelInfo.set([next[0], next[1], next[2], vs], level * 4);
    const lo = next.map((v) => v / BRICK);
    const plo = prev?.map((v) => v / BRICK);
    const dirty = this._dirty[level];
    // Bricks that left the window are no longer anyone's concern
    for (const key of dirty) {
      const [x, y, z] = key.split(',').map(Number);
      if (x < lo[0] || y < lo[1] || z < lo[2] || x >= lo[0] + nb || y >= lo[1] + nb || z >= lo[2] + nb) {
        dirty.delete(key);
      }
    }
    for (let z = lo[2]; z < lo[2] + nb; z++) {
      for (let y = lo[1]; y < lo[1] + nb; y++) {
        for (let x = lo[0]; x < lo[0] + nb; x++) {
          const inPrev =
            plo &&
            x >= plo[0] &&
            y >= plo[1] &&
            z >= plo[2] &&
            x < plo[0] + nb &&
            y < plo[1] + nb &&
            z < plo[2] + nb;
          if (!inPrev) {
            dirty.add(`${x},${y},${z}`);
          }
        }
      }
    }
  }
  /** Composites a budget of dirty bricks in one dispatch. @internal */
  private composite() {
    // Coarse levels first: a coarse answer everywhere beats a fine one somewhere
    const batch: { level: number; x: number; y: number; z: number }[] = [];
    for (let level = this.levels - 1; level >= 0 && batch.length < this.brickBudget; level--) {
      const dirty = this._dirty[level];
      for (const key of dirty) {
        if (batch.length >= this.brickBudget) {
          break;
        }
        const [x, y, z] = key.split(',').map(Number);
        batch.push({ level, x, y, z });
        dirty.delete(key);
      }
    }
    this._lastBricks = batch.length;
    if (batch.length === 0) {
      return;
    }
    this._contentVersion++;
    this._staticVersion++;
    this._totalBricks += batch.length;
    // Static instances whose field is on the GPU
    const instances: SDFInstance[] = [];
    for (const inst of this._sdf.instances) {
      if (inst.mode === 'static' && this._sdf.isReady(inst)) {
        instances.push(inst);
      }
    }
    const atlas = this._sdf.atlas;
    const instData = new Float32Array(Math.max(1, instances.length) * SDF_INSTANCE_VEC4S * 4);
    instances.forEach((inst, i) => packSDFInstance(inst, atlas, instData, i * SDF_INSTANCE_VEC4S * 4));
    // Per brick: the instances whose bounds come within band reach of it
    const brickData = new Float32Array(batch.length * BRICK_VEC4S * 4);
    const indices: number[] = [];
    const terrainBox = this._terrain?.getWorldBoundingVolume()?.toAABB() ?? null;
    const region = this._terrain?.worldRegion ?? null;
    const n = this.resolution;
    batch.forEach((brick, b) => {
      const vs = this.voxelSize(brick.level);
      const reach = this.bandVoxels * vs;
      const size = BRICK * vs;
      const min = [brick.x * size - reach, brick.y * size - reach, brick.z * size - reach];
      const max = [min[0] + size + 2 * reach, min[1] + size + 2 * reach, min[2] + size + 2 * reach];
      const start = indices.length;
      instances.forEach((inst, i) => {
        const lo = inst.bounds.minPoint;
        const hi = inst.bounds.maxPoint;
        if (
          lo.x <= max[0] &&
          hi.x >= min[0] &&
          lo.y <= max[1] &&
          hi.y >= min[1] &&
          lo.z <= max[2] &&
          hi.z >= min[2]
        ) {
          indices.push(i);
        }
      });
      const terrainHit =
        !!terrainBox &&
        !!region &&
        terrainBox.minPoint.y <= max[1] &&
        terrainBox.maxPoint.y >= min[1] &&
        region.x <= max[0] &&
        region.z >= min[0] &&
        region.y <= max[2] &&
        region.w >= min[2];
      const wrap = (v: number) => (((v * BRICK) % n) + n) % n;
      const o = b * BRICK_VEC4S * 4;
      brickData.set([brick.x * BRICK, brick.y * BRICK, brick.z * BRICK, vs], o);
      brickData.set([wrap(brick.x), wrap(brick.y), wrap(brick.z) + brick.level * n, start], o + 4);
      brickData.set([indices.length - start, terrainHit ? 1 : 0, reach, 0], o + 8);
    });
    const device = getDevice();
    const program = this.getProgram();
    const bg = this._bindGroup!;
    this._instanceBuffer = this.ensureBuffer(this._instanceBuffer, instData.byteLength);
    this._instanceBuffer.bufferSubData(0, instData);
    this._brickBuffer = this.ensureBuffer(this._brickBuffer, brickData.byteLength);
    this._brickBuffer.bufferSubData(0, brickData);
    const indexData = new Uint32Array(Math.max(4, indices.length));
    indexData.set(indices);
    this._indexBuffer = this.ensureBuffer(this._indexBuffer, indexData.byteLength);
    this._indexBuffer.bufferSubData(0, indexData);
    bg.setBuffer('instances', this._instanceBuffer);
    bg.setBuffer('bricks', this._brickBuffer);
    bg.setBuffer('indices', this._indexBuffer);
    const materials = this._materials;
    if (materials) {
      // Per instance: (atlas slot offset, 1 when resident), (slot resolution, 0)
      const matData = new Float32Array(Math.max(1, instances.length) * 8);
      instances.forEach((inst, i) => {
        const slot = materials.getSlot(inst);
        if (slot) {
          matData.set([slot.offset[0], slot.offset[1], slot.offset[2], 1], i * 8);
          matData.set([slot.resolution[0], slot.resolution[1], slot.resolution[2], 0], i * 8 + 4);
        }
      });
      this._materialBuffer = this.ensureBuffer(this._materialBuffer, matData.byteLength);
      this._materialBuffer.bufferSubData(0, matData);
      bg.setBuffer('materialSlots', this._materialBuffer);
      bg.setTexture('matAlbedoAtlas', materials.atlasAlbedo, fetchSampler('clamp_linear_nomip'));
      // RGBE must not be filtered
      bg.setTexture('matEmissiveAtlas', materials.atlasEmissive, fetchSampler('clamp_nearest_nomip'));
      const s = materials.atlasSize;
      bg.setValue('matAtlasInvSize', new Vector4(1 / s[0], 1 / s[1], 1 / s[2], 0));
      bg.setValue('terrainAlbedo', materials.terrainAlbedo);
      bg.setTexture('albedoOut', materials.albedo);
      bg.setTexture('emissiveOut', materials.emissive);
    }
    bg.setTexture('atlas', atlas.texture, fetchSampler('clamp_linear_nomip'));
    bg.setValue('atlasInvSize', new Vector4(1 / atlas.size[0], 1 / atlas.size[1], 1 / atlas.size[2], 0));
    const terrain = this._terrain;
    const heightMap = terrain?.heightMap ?? null;
    bg.setTexture('heightMap', heightMap ?? this.getDummyHeightMap(), fetchSampler('clamp_linear_nomip'));
    if (terrain && heightMap && region) {
      bg.setValue('terrainRegion', new Vector4(region.x, region.y, region.z, region.w));
      bg.setValue(
        'terrainParams',
        new Vector4(
          Math.abs(terrain.scale.y),
          terrain.worldMatrix.m13,
          1 / heightMap.width,
          1 / heightMap.height
        )
      );
    } else {
      bg.setValue('terrainRegion', new Vector4(0, 0, 1, 1));
      bg.setValue('terrainParams', new Vector4(0, 0, 1, 1));
    }
    bg.setTexture('field', this.texture);
    bg.setTexture('tagsOut', this.tags);
    device.setProgram(program);
    device.setBindGroup(0, bg);
    device.compute(batch.length * 8, 1, 1);
  }
  /** @internal */
  private ensureBuffer(buffer: Nullable<GPUDataBuffer>, bytes: number) {
    if (buffer && buffer.byteLength >= bytes) {
      return buffer;
    }
    buffer?.dispose();
    // Grow by half again so a slowly growing scene does not reallocate every
    // frame, in whole vec4: a storage binding covers the whole buffer, and
    // WebGPU wants its size a multiple of 4
    return getDevice().createBuffer(Math.max(256, Math.ceil((bytes * 1.5) / 16) * 16), {
      usage: 'uniform',
      storage: true
    })!;
  }
  /** @internal */
  private getDummyHeightMap() {
    if (!this._dummyHeightMap) {
      this._dummyHeightMap = getDevice().createTexture2D('r16f', 1, 1, { mipmapping: false })!;
    }
    return this._dummyHeightMap;
  }
  /** @internal */
  private getProgram() {
    if (!this._program) {
      const device = getDevice();
      const materials = !!this._materials;
      this._program = buildSDFProgram({
        label: materials ? 'GlobalSDFCompositeMaterials' : 'GlobalSDFComposite',
        workgroupSize: [4, 4, 4],
        compute(pb) {
          this.instances = pb.vec4[0]().storageBufferReadonly(0);
          this.bricks = pb.vec4[0]().storageBufferReadonly(0);
          this.indices = pb.uint[0]().storageBufferReadonly(0);
          this.atlas = pb.tex3D().uniform(0);
          this.atlasInvSize = pb.vec4().uniform(0);
          this.heightMap = pb.tex2D().uniform(0);
          this.terrainRegion = pb.vec4().uniform(0);
          // (height scale, world y, 1 / width, 1 / height)
          this.terrainParams = pb.vec4().uniform(0);
          this.field = pb.texStorage3D.r32float().storage(0);
          this.tagsOut = pb.texStorage3D.rgba32float().storage(0);
          if (materials) {
            this.materialSlots = pb.vec4[0]().storageBufferReadonly(0);
            this.matAlbedoAtlas = pb.tex3D().uniform(0);
            this.matEmissiveAtlas = pb.tex3D().uniform(0);
            this.matAtlasInvSize = pb.vec4().uniform(0);
            this.terrainAlbedo = pb.vec4().uniform(0);
            this.albedoOut = pb.texStorage3D.rgba8unorm().storage(0);
            this.emissiveOut = pb.texStorage3D.rgba16float().storage(0);
          }
          pb.func('terrainHeight', [pb.vec2('xz')], function () {
            this.$l.uv = pb.div(
              pb.sub(this.xz, this.terrainRegion.xy),
              pb.sub(this.terrainRegion.zw, this.terrainRegion.xy)
            );
            this.$return(
              pb.add(
                pb.mul(pb.textureSampleLevel(this.heightMap, this.uv, 0).r, this.terrainParams.x),
                this.terrainParams.y
              )
            );
          });
          pb.main(function () {
            this.$l.brick = pb.div(this.$builtins.workGroupId.x, 8);
            this.$l.sub = pb.sub(this.$builtins.workGroupId.x, pb.mul(this.brick, 8));
            this.$l.local = pb.add(
              pb.mul(pb.uvec3(pb.mod(this.sub, 2), pb.mod(pb.div(this.sub, 2), 2), pb.div(this.sub, 4)), 4),
              this.$builtins.localInvocationId
            );
            this.$l.b0 = this.bricks.at(pb.mul(this.brick, BRICK_VEC4S));
            this.$l.b1 = this.bricks.at(pb.add(pb.mul(this.brick, BRICK_VEC4S), 1));
            this.$l.b2 = this.bricks.at(pb.add(pb.mul(this.brick, BRICK_VEC4S), 2));
            this.$l.vs = this.b0.w;
            this.$l.band = this.b2.z;
            this.$l.p = pb.mul(pb.add(this.b0.xyz, pb.add(pb.vec3(this.local), pb.vec3(0.5))), this.vs);
            this.$l.d = this.band;
            this.$l.start = pb.uint(this.b1.w);
            this.$l.count = pb.uint(this.b2.x);
            this.d = sampleInstancesSDF(
              this,
              this.p,
              this.count,
              this.d,
              (scope, k) => pb.mul(scope.indices.at(pb.add(scope.start, k)), SDF_INSTANCE_VEC4S),
              (scope, i) => scope.instances.at(i),
              this.atlas,
              this.atlasInvSize.xyz,
              pb.mul(this.vs, 0.5)
            );
            this.$l.terrainD = this.band;
            this.$if(pb.greaterThan(this.b2.y, 0), function () {
              this.$l.inRegion = pb.and(
                pb.all(pb.greaterThanEqual(this.p.xz, this.terrainRegion.xy)),
                pb.all(pb.lessThanEqual(this.p.xz, this.terrainRegion.zw))
              );
              this.$if(this.inRegion, function () {
                this.$l.h = this.terrainHeight(this.p.xz);
                // Central differences one height map texel apart, in world units
                this.$l.cell = pb.mul(
                  pb.sub(this.terrainRegion.zw, this.terrainRegion.xy),
                  this.terrainParams.zw
                );
                this.$l.hx = pb.sub(
                  this.terrainHeight(pb.add(this.p.xz, pb.vec2(this.cell.x, 0))),
                  this.terrainHeight(pb.sub(this.p.xz, pb.vec2(this.cell.x, 0)))
                );
                this.$l.hz = pb.sub(
                  this.terrainHeight(pb.add(this.p.xz, pb.vec2(0, this.cell.y))),
                  this.terrainHeight(pb.sub(this.p.xz, pb.vec2(0, this.cell.y)))
                );
                this.$l.grad = pb.div(pb.vec2(this.hx, this.hz), pb.mul(this.cell, 2));
                // Height above the surface over the slope: exact on a plane
                this.terrainD = pb.min(
                  this.terrainD,
                  pb.div(pb.sub(this.p.y, this.h), pb.sqrt(pb.add(1, pb.dot(this.grad, this.grad))))
                );
              });
            });
            this.d = pb.clamp(pb.min(this.d, this.terrainD), pb.neg(this.band), this.band);
            pb.textureStore(this.field, pb.add(pb.uvec3(this.b1.xyz), this.local), pb.vec4(this.d, 0, 0, 0));
            // The brick now holds this window's region; readers see the tag in the next pass
            this.$if(
              pb.and(pb.equal(this.sub, 0), pb.equal(this.$builtins.localInvocationId, pb.uvec3(0))),
              function () {
                pb.textureStore(
                  this.tagsOut,
                  pb.div(pb.uvec3(this.b1.xyz), BRICK),
                  pb.vec4(pb.div(this.b0.xyz, BRICK), 1)
                );
              }
            );
            if (materials) {
              // Material voxels are 2³ field voxels: the thread at the even
              // corner writes the one holding it, read at its centre from the
              // instance nearest the centre (the terrain where that is nearer)
              this.$if(pb.equal(pb.mod(this.local, pb.uvec3(2)), pb.uvec3(0)), function () {
                this.$l.pc = pb.add(this.p, pb.vec3(pb.mul(this.vs, 0.5)));
                this.$l.bestK = pb.int(-1);
                this.$l.instD = sampleInstancesSDF(
                  this,
                  this.pc,
                  this.count,
                  this.band,
                  (scope, k) => pb.mul(scope.indices.at(pb.add(scope.start, k)), SDF_INSTANCE_VEC4S),
                  (scope, i) => scope.instances.at(i),
                  this.atlas,
                  this.atlasInvSize.xyz,
                  pb.mul(this.vs, 0.5),
                  'bestK'
                );
                this.$l.terrainWins = pb.and(
                  pb.lessThan(this.terrainD, this.band),
                  pb.lessThan(this.terrainD, this.instD)
                );
                this.$l.useInst = pb.and(
                  pb.greaterThanEqual(this.bestK, 0),
                  pb.lessThan(this.instD, this.band),
                  pb.not(this.terrainWins)
                );
                this.$l.idx = this.$choice(
                  this.useInst,
                  this.indices.at(pb.add(this.start, pb.uint(pb.max(this.bestK, 0)))),
                  pb.uint(0)
                );
                this.$l.ibase = pb.mul(this.idx, SDF_INSTANCE_VEC4S);
                this.$l.mr0 = this.instances.at(this.ibase);
                this.$l.mr1 = this.instances.at(pb.add(this.ibase, 1));
                this.$l.mr2 = this.instances.at(pb.add(this.ibase, 2));
                this.$l.mbmin = this.instances.at(pb.add(this.ibase, 3));
                this.$l.mbmax = this.instances.at(pb.add(this.ibase, 4));
                this.$l.mslot = this.instances.at(pb.add(this.ibase, 5));
                this.$l.matSlot = this.$choice(
                  this.useInst,
                  this.materialSlots.at(pb.mul(this.idx, 2)),
                  pb.vec4(0)
                );
                this.$l.matRes = this.materialSlots.at(pb.add(pb.mul(this.idx, 2), 1));
                this.$l.pc4 = pb.vec4(this.pc, 1);
                this.$l.lp = pb.vec3(
                  pb.dot(this.mr0, this.pc4),
                  pb.dot(this.mr1, this.pc4),
                  pb.dot(this.mr2, this.pc4)
                );
                sampleInstanceMaterial(
                  this,
                  this.lp,
                  this.mbmin,
                  this.mbmax,
                  this.mslot,
                  this.matSlot,
                  this.matRes,
                  this.atlas,
                  this.atlasInvSize.xyz,
                  this.matAlbedoAtlas,
                  this.matEmissiveAtlas,
                  this.matAtlasInvSize.xyz,
                  'outAlbedo',
                  'outEmissive'
                );
                this.$if(this.terrainWins, function () {
                  this.outAlbedo = pb.vec4(this.terrainAlbedo.rgb, 1);
                  this.outEmissive = pb.vec3(0);
                });
                this.$l.ct = pb.div(pb.add(pb.uvec3(this.b1.xyz), this.local), pb.uvec3(2));
                pb.textureStore(this.albedoOut, this.ct, this.outAlbedo);
                pb.textureStore(this.emissiveOut, this.ct, pb.vec4(this.outEmissive, 0));
              });
            }
          });
        }
      })!;
      this._bindGroup = device.createBindGroup(this._program.bindGroupLayouts[0]);
    }
    return this._program;
  }
  /** @internal */
  private createQueryProgram() {
    const levels = this.levels;
    return buildSDFProgram({
      label: 'GlobalSDFQuery',
      workgroupSize: [64, 1, 1],
      compute(pb) {
        this.points = pb.vec4[0]().storageBufferReadonly(0);
        this.count = pb.vec4().uniform(0);
        this.result = pb.texStorage2D.r32float().storage(0);
        declareGlobalSDFUniforms(this, 0, levels);
        declareDynamicSDFUniforms(this, 0);
        pb.main(function () {
          this.$l.i = this.$builtins.globalInvocationId.x;
          this.$if(pb.lessThan(this.i, pb.uint(this.count.x)), function () {
            this.$l.d = sampleSceneSDF(this, this.points.at(this.i).xyz, levels);
            pb.textureStore(this.result, pb.uvec2(this.i, 0), pb.vec4(this.d, 0, 0, 0));
          });
        });
      }
    })!;
  }
}
