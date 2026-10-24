import type { Texture3D } from '@zephyr3d/device';
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

/** Seconds a material's uniforms must have been stable before it is voxelized again. */
const REVOXELIZE_COOLDOWN = 0.5;
/** Seconds an entry nobody wants is kept before it is forgotten. */
const ENTRY_LIFETIME = 30;

interface VoxelMaterialEntry {
  key: string;
  primitive: Primitive;
  material: MeshMaterial;
  /** Voxels per axis of the material field, half the baked field's. */
  resolution: [number, number, number];
  /** Lower corner of the field box in the mesh's local space. */
  boxMin: [number, number, number];
  /** Edge of a material voxel in local units. */
  voxelSize: number;
  state: 'pending' | 'ready' | 'failed';
  /** The material's change tag when it was last voxelized. */
  materialTag: number;
  lastWanted: number;
  readyTime: number;
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
  private _voxelizations: number;
  private _lastVoxelizations: number;
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
    this._voxelizations = 0;
    this._lastVoxelizations = 0;
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
    return entry && entry.state === 'ready' ? this.atlas.getSlot(entry) : null;
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
        entry = {
          key,
          primitive,
          material,
          resolution: header.resolution.map((v) => Math.max(1, Math.ceil(v / 2))) as [number, number, number],
          boxMin: [...header.boxMin],
          voxelSize: header.voxelSize * 2,
          state: 'pending',
          materialTag: -1,
          lastWanted: 0,
          readyTime: -Infinity
        };
        this._entries.set(key, entry);
      }
      entry.lastWanted = this._time;
      // A material edit shows up in its change tag; wait for the edits to settle
      if (
        entry.state === 'ready' &&
        entry.materialTag !== material.changeTag &&
        this._time - entry.readyTime > REVOXELIZE_COOLDOWN
      ) {
        entry.state = 'pending';
      }
      const d = distanceToBox(cameraPos, inst.bounds);
      const prev = wanted.get(entry);
      wanted.set(entry, prev === undefined ? d : Math.min(prev, d));
    }
    const candidates = [...wanted.entries()]
      .filter((e) => e[0].state === 'pending')
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
      const ok = this.voxelizer.voxelize(entry.primitive, entry.material, {
        albedo: this.atlas.albedo,
        emissive: this.atlas.emissive,
        slot,
        boxMin: entry.boxMin,
        voxelSize: entry.voxelSize
      });
      entry.state = ok ? 'ready' : 'failed';
      entry.materialTag = entry.material.changeTag;
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
  dispose() {
    this._voxelizer?.dispose();
    this._voxelizer = null;
    this._lighting?.dispose();
    this._lighting = null;
    this.atlas.dispose();
    this._albedo?.dispose();
    this._emissive?.dispose();
    this._albedo = null;
    this._emissive = null;
    this._entries.clear();
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
  /** A slot for an entry, evicting unwanted meshes when the atlas is full. @internal */
  private place(entry: VoxelMaterialEntry, wanted: Map<VoxelMaterialEntry, number>) {
    let slot = this.atlas.add(entry, entry.resolution);
    if (slot) {
      return slot;
    }
    const victims = [...this._entries.values()]
      .filter((e) => !wanted.has(e) && this.atlas.getSlot(e))
      .sort((a, b) => a.lastWanted - b.lastWanted);
    for (const victim of victims) {
      this.atlas.remove(victim);
      victim.state = 'pending';
      slot = this.atlas.add(entry, entry.resolution);
      if (slot) {
        return slot;
      }
    }
    // Nothing more to evict: with room left, the atlas is fragmented; start
    // over, every resident mesh being rasterized again as it is wanted
    if (this.atlas.occupancy < 0.75) {
      this.atlas.clear();
      for (const e of this._entries.values()) {
        if (e.state === 'ready') {
          e.state = 'pending';
        }
      }
      slot = this.atlas.add(entry, entry.resolution);
      if (slot) {
        return slot;
      }
    }
    this._atlasFull++;
    return null;
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

/** Identity of what a mesh voxelizes to: its primitive with its material. */
function keyOf(mesh: Mesh): Nullable<string> {
  const primitive = mesh.primitive;
  const material = mesh.material;
  return primitive && material ? `${primitive.id}:${material.instanceId}` : null;
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
