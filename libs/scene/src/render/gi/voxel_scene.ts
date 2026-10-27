import type { BindGroup, GPUDataBuffer, GPUProgram, Texture2D, Texture3D } from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { AABB } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Scene } from '../../scene/scene';
import type { Mesh } from '../../scene/mesh';
import type { SceneSDF, SDFInstance } from '../sdf/scene_sdf';
import type { GlobalSDF, GlobalSDFMaterials } from '../sdf/global_sdf';
import type { Primitive } from '../primitive';
import type { MeshMaterial } from '../../material/meshmaterial';
import { VoxelMaterialAtlas } from './voxel_atlas';
import type { VoxelAtlasSlot } from './voxel_atlas';
import { Voxelizer } from './voxelize_pass';
import { VoxelLighting } from './voxel_lighting';
import type { VoxelLightingOptions } from './voxel_lighting';
import type { Camera } from '../../camera/camera';
import { buildSDFProgram } from '../sdf/sdf_programs';
import { fetchSampler } from '../../utility/misc';
import { declareDynamicSDFUniforms, declareGlobalSDFUniforms } from '../../shaders/sdf';
import {
  declareVoxelSceneUniforms,
  loadVoxelSceneAlbedo,
  loadVoxelSceneEmissive,
  VOXEL_SCENE_ALBEDO,
  VOXEL_SCENE_ANISO0,
  VOXEL_SCENE_ANISO1,
  VOXEL_SCENE_EMISSIVE,
  VOXEL_SCENE_RADIANCE,
  voxelSceneTexel
} from '../../shaders/gi';

/** Most points per {@link VoxelScene.queryVoxels} call. */
const MAX_QUERY_POINTS = 1024;

/**
 * What the voxel scene holds at a world position, see {@link VoxelScene.queryVoxels}.
 * @public
 */
export interface VoxelSceneSample {
  /** Clipmap level of the material voxel holding the position, -1 where none does with a current brick. */
  level: number;
  /** Albedo, and in `a` 1 where a surface's material was composited into the voxel. */
  albedo: [number, number, number, number];
  emissive: [number, number, number];
  /** Outgoing radiance summed over the voxel's faces, at the cache exposure; zeros before the first lighting. */
  radiance: [number, number, number];
}

/** Seconds a material's uniforms must have been stable before it is voxelized again. */
const REVOXELIZE_COOLDOWN = 0.5;
/** Seconds an entry nobody wants is kept before it is forgotten. */
const ENTRY_LIFETIME = 30;

interface VoxelMaterialEntry {
  key: string;
  primitive: Primitive;
  /** The material drawn: the mesh's own, or a copy of its core carrying a material instance's values. */
  material: MeshMaterial;
  /** True when `material` is such a copy, owned by the entry. */
  ownsMaterial: boolean;
  /** The mesh's own material, whose edits are watched. */
  source: MeshMaterial;
  /** Voxels per axis of the material field, half the baked field's. */
  resolution: [number, number, number];
  /** Lower corner of the field box in the mesh's local space. */
  boxMin: [number, number, number];
  /** Edge of a material voxel in local units. */
  voxelSize: number;
  state: 'pending' | 'ready' | 'failed';
  /**
   * True while the atlas region holds a voxelization of this entry, current or
   * not: a material edit leaves the old one in place until it is redone, so
   * the clipmaps never lose the mesh's colour in between.
   */
  voxelized: boolean;
  /** {@link materialTagOf} the source when it was last voxelized. */
  materialTag: string;
  lastWanted: number;
  readyTime: number;
  /** {@link VoxelMaterialAtlas.version} when it last found no room, or -1. */
  failedVersion: number;
}

/**
 * Counters of a {@link VoxelScene}, for tools and debugging.
 * @public
 */
export interface VoxelSceneStats {
  /** (primitive, material) pairs known. */
  entries: number;
  ready: number;
  pending: number;
  failed: number;
  atlasResident: number;
  atlasOccupancy: number;
  /** Times a wanted mesh did not fit even after evicting. */
  atlasFull: number;
  /** Voxelizations so far. */
  voxelizations: number;
  /** Voxelizations by the last update. */
  lastVoxelizations: number;
  /** Lighting passes run so far. */
  lightingPasses: number;
}

/**
 * The material side of the scene's voxel representation: every static mesh
 * taking part in the scene SDF is rasterized once per (primitive, material)
 * into a material atlas ({@link VoxelMaterialAtlas}), and the global SDF's
 * compositing carries the albedo and emissive of the nearest mesh into two
 * clipmaps laid out like the field itself at half its resolution. The
 * clipmaps are what gives a point the global illumination's rays hit its
 * colour.
 *
 * Voxelizations are budgeted per frame, nearest mesh first, and redone when
 * a material changes. Meshes whose material cannot be voxelized (see
 * {@link MeshMaterial.supportsVoxelization}) are left out; the terrain is
 * given a flat colour.
 *
 * WebGPU only, like the global field it extends.
 *
 * @public
 */
export class VoxelScene implements GlobalSDFMaterials {
  /** Meshes voxelized per frame. */
  voxelizeBudget: number;
  /** Albedo given to the terrain, rgb. */
  readonly terrainAlbedo: Vector4;
  readonly atlas: VoxelMaterialAtlas;
  private readonly _scene: Scene;
  private _voxelizer: Nullable<Voxelizer>;
  private _lighting: Nullable<VoxelLighting>;
  private _albedo: Nullable<Texture3D>;
  private _emissive: Nullable<Texture3D>;
  private _resolution: number;
  private _levels: number;
  private readonly _entries: Map<string, VoxelMaterialEntry>;
  private _time: number;
  private _atlasFull: number;
  private _atlasFullWarned: boolean;
  private _voxelizations: number;
  private _lastVoxelizations: number;
  private _queryProgram: Nullable<GPUProgram>;
  private _queryLevels: number;
  private _queryBindGroup: Nullable<BindGroup>;
  private _queryPoints: Nullable<GPUDataBuffer>;
  private _queryOutput: Nullable<Texture2D>;
  private _queryChain: Promise<unknown>;
  constructor(scene: Scene, atlasSize = 256) {
    this._scene = scene;
    this.voxelizeBudget = 8;
    this.terrainAlbedo = new Vector4(0.3, 0.3, 0.3, 1);
    this.atlas = new VoxelMaterialAtlas([atlasSize, atlasSize, atlasSize]);
    this._voxelizer = null;
    this._lighting = null;
    this._albedo = null;
    this._emissive = null;
    this._resolution = 0;
    this._levels = 0;
    this._entries = new Map();
    this._time = 0;
    this._atlasFull = 0;
    this._atlasFullWarned = false;
    this._voxelizations = 0;
    this._lastVoxelizations = 0;
    this._queryProgram = null;
    this._queryLevels = 0;
    this._queryBindGroup = null;
    this._queryPoints = null;
    this._queryOutput = null;
    this._queryChain = Promise.resolve();
  }
  get atlasAlbedo() {
    return this.atlas.albedo;
  }
  get atlasEmissive() {
    return this.atlas.emissive;
  }
  get atlasSize() {
    return this.atlas.size;
  }
  /** Albedo clipmap: rgba8unorm, levels stacked along z, rgb the albedo and a = 1 where a surface is. */
  get albedo() {
    if (!this._albedo) {
      throw new Error('VoxelScene: no clipmap before the first update');
    }
    return this._albedo;
  }
  /** Emissive clipmap: rgba16float, levels stacked along z. */
  get emissive() {
    if (!this._emissive) {
      throw new Error('VoxelScene: no clipmap before the first update');
    }
    return this._emissive;
  }
  /** Outgoing radiance clipmap: rgba16float, laid out like the albedo; see {@link VoxelLighting}. */
  get radiance() {
    if (!this._lighting?.ready) {
      throw new Error('VoxelScene: no radiance before the first lighting update');
    }
    return this._lighting.radiance;
  }
  /** Share of the radiance each voxel face carries, (+x, +y, +z, -x); see declareVoxelSceneUniforms. */
  get radianceAniso0() {
    if (!this._lighting?.ready) {
      throw new Error('VoxelScene: no radiance before the first lighting update');
    }
    return this._lighting.aniso0;
  }
  /** Share of the radiance each voxel face carries, (-y, -z) in rg. */
  get radianceAniso1() {
    if (!this._lighting?.ready) {
      throw new Error('VoxelScene: no radiance before the first lighting update');
    }
    return this._lighting.aniso1;
  }
  /** True once the radiance clipmap exists. */
  get lit() {
    return !!this._lighting?.ready;
  }
  /** Voxels per axis of a clipmap level, half the field's. */
  get resolution() {
    return this._resolution;
  }
  get levels() {
    return this._levels;
  }
  /** True once the clipmaps exist. */
  get ready() {
    return !!this._albedo;
  }
  getSlot(inst: SDFInstance): Nullable<VoxelAtlasSlot> {
    const key = keyOf(inst.mesh);
    const entry = key ? this._entries.get(key) : null;
    return entry && entry.voxelized ? this.atlas.getSlot(entry) : null;
  }
  /**
   * How the voxel scene holds an instance's material, for tools: `unsupported`
   * when it never will (a material that cannot be voxelized, see
   * {@link MeshMaterial.supportsVoxelization}, or not a triangle list),
   * `unknown` before it was first wanted (its field not loaded yet, or not a
   * static instance), else the state of its voxelization with the atlas slot
   * it was rasterized into, null while it has none.
   */
  describeInstance(inst: SDFInstance): {
    state: 'unsupported' | 'unknown' | VoxelMaterialEntry['state'];
    voxelized: boolean;
    slot: Nullable<VoxelAtlasSlot>;
  } {
    const mesh = inst.mesh;
    const primitive = mesh.primitive;
    const material = mesh.material;
    if (
      !primitive ||
      !material ||
      primitive.primitiveType !== 'triangle-list' ||
      !material.supportsVoxelization()
    ) {
      return { state: 'unsupported', voxelized: false, slot: null };
    }
    const key = keyOf(mesh);
    const entry = key ? this._entries.get(key) : null;
    if (!entry) {
      return { state: 'unknown', voxelized: false, slot: null };
    }
    return { state: entry.state, voxelized: entry.voxelized, slot: this.atlas.getSlot(entry) };
  }
  getStats(): VoxelSceneStats {
    const stats: VoxelSceneStats = {
      entries: this._entries.size,
      ready: 0,
      pending: 0,
      failed: 0,
      atlasResident: this.atlas.count,
      atlasOccupancy: this.atlas.occupancy,
      atlasFull: this._atlasFull,
      voxelizations: this._voxelizations,
      lastVoxelizations: this._lastVoxelizations,
      lightingPasses: this._lighting?.passes ?? 0
    };
    for (const entry of this._entries.values()) {
      stats[entry.state]++;
    }
    return stats;
  }
  /**
   * Voxelizes the meshes that came into the scene field, nearest first within
   * the budget, and keeps the global field compositing materials. Called by
   * the scene once a frame, before the field's own update.
   */
  update(sdf: SceneSDF, cameraPos: Vector3, deltaSeconds: number) {
    const global = sdf.enabled ? sdf.global : null;
    if (!global) {
      return;
    }
    this._time += deltaSeconds;
    this.ensureClipmaps(global);
    if (global.materials !== this) {
      global.materials = this;
    }
    const wanted = new Map<VoxelMaterialEntry, number>();
    for (const inst of sdf.instances) {
      if (inst.mode !== 'static') {
        continue;
      }
      const header = inst.asset?.state === 'ready' ? inst.asset.header : null;
      if (!header) {
        continue;
      }
      const mesh = inst.mesh;
      const primitive = mesh.primitive;
      const material = mesh.material;
      const key = keyOf(mesh);
      if (
        !key ||
        !primitive ||
        !material ||
        primitive.primitiveType !== 'triangle-list' ||
        !material.supportsVoxelization()
      ) {
        continue;
      }
      let entry = this._entries.get(key);
      if (!entry) {
        const resolved = resolveMaterial(material);
        entry = {
          key,
          primitive,
          material: resolved.material,
          ownsMaterial: resolved.owned,
          source: material,
          resolution: header.resolution.map((v) => Math.max(1, Math.ceil(v / 2))) as [number, number, number],
          boxMin: [...header.boxMin],
          voxelSize: header.voxelSize * 2,
          state: 'pending',
          voxelized: false,
          materialTag: '',
          lastWanted: 0,
          readyTime: -Infinity,
          failedVersion: -1
        };
        this._entries.set(key, entry);
      }
      entry.lastWanted = this._time;
      // A material edit shows up in its change tag; wait for the edits to settle
      if (
        entry.state === 'ready' &&
        entry.materialTag !== materialTagOf(material) &&
        this._time - entry.readyTime > REVOXELIZE_COOLDOWN
      ) {
        entry.state = 'pending';
      }
      const d = distanceToBox(cameraPos, inst.bounds);
      const prev = wanted.get(entry);
      wanted.set(entry, prev === undefined ? d : Math.min(prev, d));
    }
    const candidates = [...wanted.entries()]
      .filter((e) => e[0].state === 'pending' && e[0].failedVersion !== this.atlas.version)
      .sort((a, b) => a[1] - b[1])
      .map((e) => e[0]);
    let done = 0;
    for (const entry of candidates) {
      if (done >= this.voxelizeBudget) {
        break;
      }
      const slot = this.atlas.getSlot(entry) ?? this.place(entry, wanted);
      if (!slot) {
        continue;
      }
      if (entry.ownsMaterial) {
        // A copy carries the values of its making; take them again
        entry.material.dispose();
        const resolved = resolveMaterial(entry.source);
        entry.material = resolved.material;
        entry.ownsMaterial = resolved.owned;
      }
      const ok = this.voxelizer.voxelize(entry.primitive, entry.material, {
        albedo: this.atlas.albedo,
        emissive: this.atlas.emissive,
        slot,
        boxMin: entry.boxMin,
        voxelSize: entry.voxelSize
      });
      entry.state = ok ? 'ready' : 'failed';
      entry.voxelized = ok;
      entry.materialTag = materialTagOf(entry.source);
      entry.readyTime = this._time;
      done++;
      this._voxelizations++;
      this.dirtyInstances(sdf, global, entry.key);
    }
    this._lastVoxelizations = done;
    // Entries nobody has wanted for a while are forgotten
    for (const entry of this._entries.values()) {
      if (!wanted.has(entry) && this._time - entry.lastWanted > ENTRY_LIFETIME) {
        this.atlas.remove(entry);
        this._entries.delete(entry.key);
        if (entry.ownsMaterial) {
          entry.material.dispose();
        }
      }
    }
  }
  /**
   * Lights the next slab of the voxels. Called by the scene once a frame
   * after the field's update, which composites the materials it reads.
   */
  updateLighting(sdf: SceneSDF, camera: Camera, options: VoxelLightingOptions) {
    const global = sdf.enabled ? sdf.global : null;
    if (!global || !this._albedo || !this._emissive) {
      return;
    }
    if (!this._lighting) {
      this._lighting = new VoxelLighting(this._scene);
    }
    this._lighting.update(global, this._albedo, this._emissive, this._resolution, camera, options);
  }
  /** Stops the global field compositing materials, when it still composites this. */
  detach(sdf: SceneSDF) {
    const global = sdf.enabled ? sdf.global : null;
    if (global && global.materials === this) {
      global.materials = null;
    }
  }
  /**
   * What the clipmaps hold at world positions, read back from the GPU as a
   * ray of the global illumination reads them where it hits; resolves a frame
   * or two later. For tools, not per-frame use. At most 1024 points.
   */
  queryVoxels(global: GlobalSDF, points: Vector3[]): Promise<VoxelSceneSample[]> {
    const run = async () => {
      const n = Math.min(points.length, MAX_QUERY_POINTS);
      if (n === 0 || !this._albedo || !this._emissive) {
        return [];
      }
      const device = getDevice();
      const pixels = new Float32Array(MAX_QUERY_POINTS * 4 * 3);
      // Recorded at the start of a frame, as the field's distance queries are
      await device.runNextFrameAsync(async () => {
        if (!this._queryProgram || this._queryLevels !== global.levels) {
          this._queryProgram?.dispose();
          this._queryBindGroup?.dispose();
          this._queryProgram = this.createQueryProgram(global.levels);
          this._queryLevels = global.levels;
          this._queryBindGroup = device.createBindGroup(this._queryProgram.bindGroupLayouts[0]);
        }
        if (!this._queryPoints) {
          this._queryPoints = device.createBuffer(MAX_QUERY_POINTS * 16, { usage: 'uniform', storage: true });
          this._queryOutput = device.createTexture2D('rgba32f', MAX_QUERY_POINTS, 3, {
            mipmapping: false,
            writable: true
          })!;
        }
        const data = new Float32Array(MAX_QUERY_POINTS * 4);
        for (let i = 0; i < n; i++) {
          data.set([points[i].x, points[i].y, points[i].z, 0], i * 4);
        }
        this._queryPoints.bufferSubData(0, data);
        const bg = this._queryBindGroup!;
        global.applyBindGroup(bg);
        const lit = this.lit;
        const nearest = fetchSampler('clamp_nearest_nomip');
        bg.setTexture(VOXEL_SCENE_ALBEDO, this._albedo!, nearest);
        bg.setTexture(VOXEL_SCENE_EMISSIVE, this._emissive!, nearest);
        // Before the first lighting any volume of the layout stands in, the radiance read as zero
        bg.setTexture(VOXEL_SCENE_RADIANCE, lit ? this.radiance : this._emissive!, nearest);
        bg.setTexture(VOXEL_SCENE_ANISO0, lit ? this.radianceAniso0 : this._albedo!, nearest);
        bg.setTexture(VOXEL_SCENE_ANISO1, lit ? this.radianceAniso1 : this._albedo!, nearest);
        bg.setBuffer('points', this._queryPoints);
        bg.setTexture('result', this._queryOutput!);
        bg.setValue('count', new Vector4(n, lit ? 1 : 0, 0, 0));
        device.setProgram(this._queryProgram);
        device.setBindGroup(0, bg);
        device.compute(Math.ceil(n / 64), 1, 1);
        const read = this._queryOutput!.readPixels(0, 0, MAX_QUERY_POINTS, 3, 0, 0, pixels);
        device.flush();
        await read;
      });
      const row = MAX_QUERY_POINTS * 4;
      return Array.from({ length: n }, (_, i): VoxelSceneSample => {
        const a = pixels.subarray(i * 4, i * 4 + 4);
        const e = pixels.subarray(row + i * 4, row + i * 4 + 4);
        const r = pixels.subarray(2 * row + i * 4, 2 * row + i * 4 + 4);
        return {
          level: Math.round(e[3]),
          albedo: [a[0], a[1], a[2], a[3]],
          emissive: [e[0], e[1], e[2]],
          radiance: [r[0], r[1], r[2]]
        };
      });
    };
    const next = this._queryChain.then(run, run);
    this._queryChain = next.catch(() => undefined);
    return next;
  }
  dispose() {
    this._queryProgram?.dispose();
    this._queryBindGroup?.dispose();
    this._queryPoints?.dispose();
    this._queryOutput?.dispose();
    this._queryProgram = null;
    this._queryBindGroup = null;
    this._queryPoints = null;
    this._queryOutput = null;
    this._voxelizer?.dispose();
    this._voxelizer = null;
    this._lighting?.dispose();
    this._lighting = null;
    this.atlas.dispose();
    this._albedo?.dispose();
    this._emissive?.dispose();
    this._albedo = null;
    this._emissive = null;
    for (const entry of this._entries.values()) {
      if (entry.ownsMaterial) {
        entry.material.dispose();
      }
    }
    this._entries.clear();
  }
  /** @internal */
  private createQueryProgram(levels: number) {
    return buildSDFProgram({
      label: 'VoxelSceneQuery',
      workgroupSize: [64, 1, 1],
      compute(pb) {
        this.points = pb.vec4[0]().storageBufferReadonly(0);
        // (point count, 1 once lit)
        this.count = pb.vec4().uniform(0);
        this.result = pb.texStorage2D.rgba32float().storage(0);
        declareGlobalSDFUniforms(this, 0, levels);
        declareDynamicSDFUniforms(this, 0);
        declareVoxelSceneUniforms(this, 0);
        pb.main(function () {
          this.$l.i = this.$builtins.globalInvocationId.x;
          this.$if(pb.lessThan(this.i, pb.uint(this.count.x)), function () {
            this.$l.texel = voxelSceneTexel(this, this.points.at(this.i).xyz, levels);
            this.$l.radiance = pb.vec3(0);
            this.$if(
              pb.and(pb.greaterThanEqual(this.texel.w, 0), pb.greaterThan(this.count.y, 0)),
              function () {
                this.radiance = pb.textureLoad(this[VOXEL_SCENE_RADIANCE], this.texel.xyz, 0).rgb;
              }
            );
            pb.textureStore(this.result, pb.uvec2(this.i, 0), loadVoxelSceneAlbedo(this, this.texel));
            pb.textureStore(
              this.result,
              pb.uvec2(this.i, 1),
              pb.vec4(loadVoxelSceneEmissive(this, this.texel), pb.float(this.texel.w))
            );
            pb.textureStore(this.result, pb.uvec2(this.i, 2), pb.vec4(this.radiance, 0));
          });
        });
      }
    })!;
  }
  /** @internal */
  private get voxelizer() {
    if (!this._voxelizer) {
      this._voxelizer = new Voxelizer(this._scene);
    }
    return this._voxelizer;
  }
  /** @internal */
  private ensureClipmaps(global: GlobalSDF) {
    const resolution = global.resolution / 2;
    if (this._albedo && this._resolution === resolution && this._levels === global.levels) {
      return;
    }
    this._albedo?.dispose();
    this._emissive?.dispose();
    const device = getDevice();
    this._resolution = resolution;
    this._levels = global.levels;
    this._albedo = device.createTexture3D('rgba8unorm', resolution, resolution, resolution * global.levels, {
      mipmapping: false,
      writable: true
    })!;
    this._albedo.name = '@VoxelSceneAlbedo';
    this._emissive = device.createTexture3D('rgba16f', resolution, resolution, resolution * global.levels, {
      mipmapping: false,
      writable: true
    })!;
    this._emissive.name = '@VoxelSceneEmissive';
    // The field must write the new textures everywhere
    if (global.materials === this) {
      global.materials = null;
      global.materials = this;
    }
  }
  /**
   * A slot for an entry, evicting unwanted meshes, then wanted ones farther
   * from the camera, when the atlas is full. Meshes as near as this one or
   * nearer are never given up for it: when they leave it no room, it waits
   * for the atlas to change, so meshes that do not all fit do not push each
   * other out frame after frame. @internal
   */
  private place(entry: VoxelMaterialEntry, wanted: Map<VoxelMaterialEntry, number>) {
    let slot = this.atlas.add(entry, entry.resolution);
    if (slot) {
      return slot;
    }
    const resident = [...this._entries.values()].filter((e) => e !== entry && this.atlas.getSlot(e));
    const dist = wanted.get(entry)!;
    const kept = resident.filter((e) => wanted.has(e) && wanted.get(e)! <= dist);
    if (!this.atlas.fits([entry.resolution, ...kept.map((e) => e.resolution)])) {
      this.fail(entry);
      return null;
    }
    const victims = [
      ...resident.filter((e) => !wanted.has(e)).sort((a, b) => a.lastWanted - b.lastWanted),
      ...resident.filter((e) => wanted.get(e)! > dist).sort((a, b) => wanted.get(b)! - wanted.get(a)!)
    ];
    for (const victim of victims) {
      this.atlas.remove(victim);
      victim.state = 'pending';
      victim.voxelized = false;
      slot = this.atlas.add(entry, entry.resolution);
      if (slot) {
        return slot;
      }
    }
    // The kept meshes and this one fit packed afresh, but not around the gaps
    // left by the ones freed: repack them, rasterizing again only those moved
    const moved = this.atlas.repack([entry, ...kept].map((e) => ({ key: e, resolution: e.resolution })));
    if (moved) {
      for (const e of this._entries.values()) {
        if (e !== entry && e.voxelized && (moved.has(e) || !this.atlas.getSlot(e))) {
          e.voxelized = false;
          e.state = 'pending';
        }
      }
      return this.atlas.getSlot(entry);
    }
    this.fail(entry);
    return null;
  }
  /** Records an entry that found no room, not to be tried until the atlas changes. @internal */
  private fail(entry: VoxelMaterialEntry) {
    entry.failedVersion = this.atlas.version;
    this._atlasFull++;
    if (!this._atlasFullWarned) {
      this._atlasFullWarned = true;
      const s = this.atlas.size;
      console.warn(
        `VoxelScene: the materials of the meshes in the scene field do not fit the ${s.join('×')} material atlas; the farthest are left out and read black where global illumination rays hit them. Raise SceneGI.atlasSize.`
      );
    }
  }
  /** Rebuilds the field around every instance drawing a (primitive, material). @internal */
  private dirtyInstances(sdf: SceneSDF, global: GlobalSDF, key: string) {
    for (const inst of sdf.instances) {
      if (inst.mode === 'static' && keyOf(inst.mesh) === key && boxValid(inst.bounds)) {
        global.markDirty(inst.bounds.minPoint, inst.bounds.maxPoint);
      }
    }
  }
}

/**
 * Identity of what a mesh voxelizes to: its primitive with its material. A
 * material instance (see {@link MeshMaterial.createInstance}) counts as its
 * core unless it overrides instance uniforms, when their values join the key,
 * so instances sharing a look share one voxelization and instances tinted
 * apart get their own.
 */
function keyOf(mesh: Mesh): Nullable<string> {
  const primitive = mesh.primitive;
  const material = mesh.material;
  if (!primitive || !material) {
    return null;
  }
  const core = material.coreMaterial;
  return `${primitive.id}:${core.instanceId}${instanceSuffix(material)}`;
}

/**
 * What a voxelization depends on in a material: the core's appearance tag,
 * which every uniform or option edit that can change its look advances (and
 * the object color GPU picking sets each frame it picks does not), and its
 * change tag, which a texture that finishes loading advances. An
 * instance's own overrides are part of the entry key instead.
 */
function materialTagOf(material: MeshMaterial) {
  const core = material.coreMaterial;
  return `${core.appearanceTag}:${core.changeTag}`;
}

/** The instance uniform values a material instance overrides its core with, as a key suffix, else empty. */
function instanceSuffix(material: MeshMaterial) {
  if (!material.$isInstance) {
    return '';
  }
  const core = material.coreMaterial;
  const parts: string[] = [];
  for (const { prop } of core.getInstancedUniforms()) {
    const a = (material as unknown as Record<string, unknown>)[prop];
    const b = (core as unknown as Record<string, unknown>)[prop];
    if (!sameValue(a, b)) {
      parts.push(`${prop}=${String(a)}`);
    }
  }
  return parts.length ? `:${parts.join(',')}` : '';
}

function sameValue(a: unknown, b: unknown) {
  if (typeof a === 'number' || typeof b === 'number') {
    return a === b;
  }
  const va = a as ArrayLike<number> | undefined;
  const vb = b as ArrayLike<number> | undefined;
  if (!va || !vb || va.length !== vb.length) {
    return a === b;
  }
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) {
      return false;
    }
  }
  return true;
}

/**
 * The material to draw for a mesh's material: the core for a plain material
 * or an instance that overrides nothing, else a copy of the core carrying the
 * instance's values, which the plain (non-instanced) draw of the voxelize pass
 * reads where the instanced draw would read the instance buffer.
 */
function resolveMaterial(material: MeshMaterial): { material: MeshMaterial; owned: boolean } {
  if (!material.$isInstance || !instanceSuffix(material)) {
    return { material: material.coreMaterial, owned: false };
  }
  const core = material.coreMaterial;
  const copy = (core as unknown as { clone?: () => MeshMaterial }).clone?.();
  if (!copy) {
    return { material: core, owned: false };
  }
  for (const { prop } of core.getInstancedUniforms()) {
    (copy as unknown as Record<string, unknown>)[prop] = (material as unknown as Record<string, unknown>)[
      prop
    ];
  }
  return { material: copy, owned: true };
}

function boxValid(box: AABB) {
  return box.minPoint.x <= box.maxPoint.x;
}

function distanceToBox(p: Vector3, box: AABB) {
  const dx = Math.max(box.minPoint.x - p.x, 0, p.x - box.maxPoint.x);
  const dy = Math.max(box.minPoint.y - p.y, 0, p.y - box.maxPoint.y);
  const dz = Math.max(box.minPoint.z - p.z, 0, p.z - box.maxPoint.z);
  return Math.hypot(dx, dy, dz);
}
