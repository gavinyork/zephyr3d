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
  sampleGlobalSDF
} from '../../shaders/sdf';
import type { SceneSDF, SDFInstance } from './scene_sdf';

/** Voxels along a brick edge, the unit of compositing. */
const BRICK = 8;
/** vec4s per instance in the instance buffer. */
const INSTANCE_VEC4S = 6;
/** vec4s per brick in the brick buffer. */
const BRICK_VEC4S = 3;
/** Most points per {@link GlobalSDF.queryDistances} call. */
const MAX_QUERY_POINTS = 4096;

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
  private _dummyHeightMap: Nullable<Texture2D>;
  private _queryProgram: Nullable<GPUProgram>;
  private _queryBindGroup: Nullable<BindGroup>;
  private _queryPoints: Nullable<GPUDataBuffer>;
  private _queryOutput: Nullable<Texture2D>;
  private _queryChain: Promise<unknown>;
  private readonly _levelInfo: Float32Array<ArrayBuffer>;
  private readonly _params: Vector4;
  constructor(sdf: SceneSDF, options?: GlobalSDFOptions) {
    this._sdf = sdf;
    this.levels = Math.max(1, Math.min(8, Math.floor(options?.levels ?? 4)));
    this.resolution = Math.max(BRICK * 2, Math.ceil((options?.resolution ?? 128) / BRICK) * BRICK);
    this.baseVoxelSize = Math.max(1e-3, options?.baseVoxelSize ?? 0.25);
    this.bandVoxels = Math.max(1, options?.bandVoxels ?? 4);
    this.brickBudget = Math.max(1, Math.floor(options?.brickBudget ?? 512));
    this._texture = null;
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
    this._dummyHeightMap = null;
    this._queryProgram = null;
    this._queryBindGroup = null;
    this._queryPoints = null;
    this._queryOutput = null;
    this._queryChain = Promise.resolve();
    this._levelInfo = new Float32Array(this.levels * 4);
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
  /** Binds the field for {@link sampleGlobalSDF} in a program that declared it. */
  applyBindGroup(bindGroup: BindGroup) {
    // Read with textureLoad, but the unfilterable binding still has a sampler
    // slot, which a filtering sampler fails to validate against
    bindGroup.setTexture(GLOBAL_SDF_TEXTURE, this.texture, fetchSampler('clamp_nearest_nomip'));
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
      terrain: !!this._terrain
    };
  }
  /** Shader compile errors of the composite and query programs, for diagnosis. */
  getProgramErrors() {
    return {
      composite: this._program?.getCompileError() || null,
      query: this._queryProgram?.getCompileError() || null
    };
  }
  /** Marks every brick within band reach of a world box for rebuilding. */
  markDirty(min: Vector3, max: Vector3) {
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
    this._texture?.dispose();
    this._texture = null;
    this._instanceBuffer?.dispose();
    this._brickBuffer?.dispose();
    this._indexBuffer?.dispose();
    this._dummyHeightMap?.dispose();
    this._queryPoints?.dispose();
    this._queryOutput?.dispose();
    this._bindGroup?.dispose();
    this._queryBindGroup?.dispose();
    this._instanceBuffer = this._brickBuffer = this._indexBuffer = this._queryPoints = null;
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
    this._totalBricks += batch.length;
    // Static instances whose field is on the GPU
    const instances: SDFInstance[] = [];
    for (const inst of this._sdf.instances) {
      if (inst.mode === 'static' && this._sdf.isReady(inst)) {
        instances.push(inst);
      }
    }
    const atlas = this._sdf.atlas;
    const instData = new Float32Array(Math.max(1, instances.length) * INSTANCE_VEC4S * 4);
    instances.forEach((inst, i) => {
      const header = inst.asset!.header!;
      const slot = atlas.getSlot(inst.asset!)!;
      const inv = inst.mesh.invWorldMatrix;
      const m = inst.mesh.worldMatrix;
      const scale = Math.min(
        Math.hypot(m.m00, m.m10, m.m20),
        Math.hypot(m.m01, m.m11, m.m21),
        Math.hypot(m.m02, m.m12, m.m22)
      );
      const o = i * INSTANCE_VEC4S * 4;
      // World to local, by rows
      instData.set([inv.m00, inv.m01, inv.m02, inv.m03], o);
      instData.set([inv.m10, inv.m11, inv.m12, inv.m13], o + 4);
      instData.set([inv.m20, inv.m21, inv.m22, inv.m23], o + 8);
      instData.set([...header.boxMin, header.voxelSize], o + 12);
      instData.set([...header.boxMax, scale], o + 16);
      instData.set([...slot.offset, 0], o + 20);
    });
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
    // Grow by half again so a slowly growing scene does not reallocate every frame
    return getDevice().createBuffer(Math.max(256, Math.ceil(bytes * 1.5)), {
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
      this._program = device.buildComputeProgram({
        label: 'GlobalSDFComposite',
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
            this.$for(pb.uint('k'), 0, this.count, function () {
              this.$l.base = pb.mul(this.indices.at(pb.add(this.start, this.k)), INSTANCE_VEC4S);
              this.$l.r0 = this.instances.at(this.base);
              this.$l.r1 = this.instances.at(pb.add(this.base, 1));
              this.$l.r2 = this.instances.at(pb.add(this.base, 2));
              this.$l.bmin = this.instances.at(pb.add(this.base, 3));
              this.$l.bmax = this.instances.at(pb.add(this.base, 4));
              this.$l.slot = this.instances.at(pb.add(this.base, 5));
              this.$l.p4 = pb.vec4(this.p, 1);
              this.$l.lp = pb.vec3(
                pb.dot(this.r0, this.p4),
                pb.dot(this.r1, this.p4),
                pb.dot(this.r2, this.p4)
              );
              this.$l.c = pb.clamp(this.lp, this.bmin.xyz, this.bmax.xyz);
              this.$l.outside = pb.length(pb.sub(this.lp, this.c));
              // A field box farther than the current best cannot improve it
              this.$if(pb.lessThan(pb.mul(this.outside, this.bmax.w), this.d), function () {
                this.$l.res = pb.div(pb.sub(this.bmax.xyz, this.bmin.xyz), this.bmin.w);
                // Clamped to the outer sample centres, so the filter never reads a neighbour's slot
                this.$l.f = pb.clamp(
                  pb.div(pb.sub(this.c, this.bmin.xyz), this.bmin.w),
                  pb.vec3(0.5),
                  pb.sub(this.res, pb.vec3(0.5))
                );
                this.$l.uvw = pb.mul(pb.add(this.slot.xyz, this.f), this.atlasInvSize.xyz);
                this.$l.ld = pb.textureSampleLevel(this.atlas, this.uvw, 0).r;
                this.d = pb.min(this.d, pb.mul(pb.add(this.ld, this.outside), this.bmax.w));
              });
            });
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
                this.d = pb.min(
                  this.d,
                  pb.div(pb.sub(this.p.y, this.h), pb.sqrt(pb.add(1, pb.dot(this.grad, this.grad))))
                );
              });
            });
            this.d = pb.clamp(this.d, pb.neg(this.band), this.band);
            pb.textureStore(this.field, pb.add(pb.uvec3(this.b1.xyz), this.local), pb.vec4(this.d, 0, 0, 0));
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
    return getDevice().buildComputeProgram({
      label: 'GlobalSDFQuery',
      workgroupSize: [64, 1, 1],
      compute(pb) {
        this.points = pb.vec4[0]().storageBufferReadonly(0);
        this.count = pb.vec4().uniform(0);
        this.result = pb.texStorage2D.r32float().storage(0);
        declareGlobalSDFUniforms(this, 0, levels);
        pb.main(function () {
          this.$l.i = this.$builtins.globalInvocationId.x;
          this.$if(pb.lessThan(this.i, pb.uint(this.count.x)), function () {
            this.$l.d = sampleGlobalSDF(this, this.points.at(this.i).xyz, levels);
            pb.textureStore(this.result, pb.uvec2(this.i, 0), pb.vec4(this.d, 0, 0, 0));
          });
        });
      }
    })!;
  }
}
