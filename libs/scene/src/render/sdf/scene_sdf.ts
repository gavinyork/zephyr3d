import type { Nullable } from '@zephyr3d/base';
import { AABB, Disposable, makeObservable, Vector3 } from '@zephyr3d/base';
import type { Mesh } from '../../scene/mesh';
import type { Scene } from '../../scene/scene';
import type { SceneNode } from '../../scene/scene_node';
import { getEngine } from '../../app/api';
import { getMeshSDFPath, readZsdf, writeZsdf } from '../../asset/zsdf_binary';
import type { ZsdfHeader } from '../../asset/zsdf_binary';
import { MeshSDFAtlas, SDF_ATLAS_BLOCK } from './sdf_atlas';
import { GlobalSDF } from './global_sdf';
import type { ClipmapTerrain } from '../../scene/terrain-cm/terrain-cm';
import type { Primitive } from '../primitive';
import { readPrimitiveTriangles } from '../primitive_readback';
import type { MeshSDFBakeOptions, MeshSDFData } from '../../utility/sdf/bake';
import { bakeMeshSDF } from '../../utility/sdf/bake';

/** A field given at run time rather than read from a baked file, see {@link SceneSDF.setField}. */
interface RuntimeField {
  header: ZsdfHeader;
  voxels: Uint16Array<ArrayBuffer>;
}

/** Fields given at run time, by the key their primitive takes part under; shared by every scene. */
const runtimeFields = new Map<string, RuntimeField>();
/** The key of each primitive given a field at run time. */
const runtimeKeys = new WeakMap<Primitive, string>();
let runtimeKeyCounter = 0;

/**
 * A baked mesh field as loaded, shared by every instance of the mesh.
 * @public
 */
export class MeshSDFAsset {
  /**
   * Asset path of the mesh; for a field given at run time (see
   * {@link SceneSDF.setField}), a key of its own starting with `runtime:`.
   */
  readonly meshPath: string;
  /** `loading`, then `ready` with data, `missing` when nothing is baked, `failed` on a bad file. */
  state: 'loading' | 'ready' | 'missing' | 'failed';
  header: Nullable<ZsdfHeader>;
  voxels: Nullable<Uint16Array<ArrayBuffer>>;
  /** Instances using it. */
  refs: number;
  /** Seconds of scene time it was last wanted, for eviction. */
  lastWanted: number;
  /** True once its file read has started. */
  requested: boolean;
  /**
   * {@link MeshSDFAtlas.version} when it last did not fit, or -1; it is not
   * tried again until the atlas changes.
   */
  failedVersion: number;
  constructor(meshPath: string) {
    this.meshPath = meshPath;
    this.requested = false;
    this.failedVersion = -1;
    this.state = 'loading';
    this.header = null;
    this.voxels = null;
    this.refs = 0;
    this.lastWanted = 0;
  }
  /** Bytes of voxel data. */
  get byteSize() {
    return this.voxels?.byteLength ?? 0;
  }
}

/**
 * A mesh taking part in the scene field.
 * @public
 */
export interface SDFInstance {
  readonly mesh: Mesh;
  /** Resolved {@link Mesh.sdfMode}, never `none` or `auto` here. */
  mode: 'static' | 'dynamic';
  /** Shared field data; null for a mesh without a primitive asset. */
  asset: Nullable<MeshSDFAsset>;
  /** World bounds at the last update. */
  readonly bounds: AABB;
}

/**
 * Counters of a {@link SceneSDF}, for tools and debugging.
 * @public
 */
export interface SceneSDFStats {
  instances: number;
  staticInstances: number;
  dynamicInstances: number;
  /** Instances whose field is in the atlas and uploaded. */
  readyInstances: number;
  assets: number;
  assetsLoading: number;
  assetsMissing: number;
  assetsFailed: number;
  assetsResident: number;
  atlasSize: [number, number, number];
  atlasOccupancy: number;
  pendingUploads: number;
  /** Times a wanted field did not fit even after evicting. */
  atlasFull: number;
  /** Calls of {@link SceneSDF.update} since enabled. */
  updates: number;
  /** Field files being read now. */
  loadsInFlight: number;
  /** Camera position of the last update. */
  camera: [number, number, number];
}

type SceneSDFEvents = {
  /**
   * The field changed inside a world box: an instance became ready, went away,
   * or a static one moved. A global field rebuilds the region.
   */
  dirty: [min: Vector3, max: Vector3];
};

/**
 * The signed distance field data of a scene: which meshes take part, their
 * baked fields streamed in on demand into a shared {@link MeshSDFAtlas}.
 *
 * Off by default. While enabled it tracks every mesh with an effective
 * {@link Mesh.sdfMode} other than `none`, keeps the fields of those within
 * {@link SceneSDF.streamRadius} of the camera loaded, nearest first, evicting the
 * least recently wanted ones when the atlas fills, and reports every change of
 * the field as a dirty world box for a global field to rebuild.
 *
 * Fields are read from {@link getMeshSDFPath} of the mesh's primitive asset; a
 * mesh with no baked field is left out until one is baked. A primitive built in
 * code, with no asset, takes part once it is given a field at run time with
 * {@link SceneSDF.setField} or {@link SceneSDF.bakeField}.
 *
 * @public
 */
export class SceneSDF extends makeObservable(Disposable)<SceneSDFEvents>() {
  /** Distance from the camera within which fields are kept loaded, in world units. */
  streamRadius: number;
  /** Field files read at once. */
  maxConcurrentLoads: number;
  private _atlasSize: [number, number, number];
  private _atlasFullWarned: boolean;
  /** Bytes uploaded to the atlas per frame. */
  uploadBudget: number;
  private readonly _scene: Scene;
  private _enabled: boolean;
  private _atlas: Nullable<MeshSDFAtlas>;
  private _global: Nullable<GlobalSDF>;
  private _globalFailed: boolean;
  private _terrain: Nullable<ClipmapTerrain>;
  /** Nodes attached since the last update, tracked then. */
  private readonly _pendingAttach: Set<SceneNode>;
  /** Meshes listened to, whether or not they take part. */
  private readonly _tracked: Set<Mesh>;
  private readonly _instances: Map<Mesh, SDFInstance>;
  private readonly _assets: Map<string, MeshSDFAsset>;
  private _loading: number;
  private _time: number;
  private _atlasFull: number;
  private _updates: number;
  private readonly _camera: Vector3;
  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._enabled = false;
    this._atlas = null;
    this._global = null;
    this._globalFailed = false;
    this._terrain = null;
    this._pendingAttach = new Set();
    this._tracked = new Set();
    this._instances = new Map();
    this._assets = new Map();
    this._loading = 0;
    this._time = 0;
    this._atlasFull = 0;
    this._atlasFullWarned = false;
    this._atlasSize = [512, 256, 256];
    this._updates = 0;
    this._camera = new Vector3();
    this.streamRadius = 256;
    this.maxConcurrentLoads = 4;
    this.uploadBudget = 4 * 1024 * 1024;
  }
  get enabled() {
    return this._enabled;
  }
  set enabled(val: boolean) {
    val = !!val;
    if (val === this._enabled) {
      return;
    }
    this._enabled = val;
    const root = this._scene.rootNode;
    if (val) {
      root.on('nodeattached', this.onNodeAttached, this);
      root.on('noderemoved', this.onNodeRemoved, this);
      root.on('visiblechanged', this.onVisibleChanged, this);
      this.collect(root);
    } else {
      root.off('nodeattached', this.onNodeAttached, this);
      root.off('noderemoved', this.onNodeRemoved, this);
      root.off('visiblechanged', this.onVisibleChanged, this);
      this._pendingAttach.clear();
      for (const mesh of [...this._tracked]) {
        this.untrack(mesh);
      }
      this._assets.clear();
      this._atlas?.dispose();
      this._atlas = null;
      this._global?.dispose();
      this._global = null;
      this._globalFailed = false;
      this._terrain = null;
    }
  }
  /**
   * Voxels per axis of the atlas the resident fields share, half floats;
   * 512×256×256 (64 MB) by default. Fields that do not fit once the ones
   * nearer the camera are placed are left out of the scene field, and a
   * warning says so. Changing it empties the atlas; the fields come back
   * over the following frames.
   */
  get atlasSize(): [number, number, number] {
    return [...this._atlasSize];
  }
  set atlasSize(val: [number, number, number]) {
    const size = val.map((v) => Math.max(SDF_ATLAS_BLOCK, Math.floor(v))) as [number, number, number];
    if (size.some((v, i) => v !== this._atlasSize[i])) {
      this._atlasSize = size;
      if (this._atlas) {
        for (const asset of this._assets.values()) {
          if (this._atlas.getSlot(asset)) {
            this.dirtyAsset(asset);
          }
        }
        this._atlas.dispose();
        this._atlas = null;
      }
      this._atlasFull = 0;
      this._atlasFullWarned = false;
    }
  }
  /** The atlas of resident fields, created when first needed. */
  get atlas() {
    if (!this._atlas) {
      this._atlas = new MeshSDFAtlas(this._atlasSize);
    }
    return this._atlas;
  }
  /**
   * The clipmap field built from the static instances and the terrain, or null
   * where it cannot be built (WebGL2) or while disabled.
   */
  get global() {
    if (this._globalFailed) {
      return null;
    }
    if (!this._global && this._enabled && GlobalSDF.isSupported()) {
      this._global = new GlobalSDF(this);
    }
    return this._global;
  }
  /** Instances taking part, static and dynamic. */
  get instances(): IterableIterator<SDFInstance> {
    return this._instances.values();
  }
  /** True when the instance's field is in the atlas and on the GPU. */
  isReady(instance: SDFInstance) {
    return !!instance.asset && instance.asset.state === 'ready' && !!this._atlas?.isReady(instance.asset);
  }
  getStats(): SceneSDFStats {
    const stats: SceneSDFStats = {
      instances: this._instances.size,
      staticInstances: 0,
      dynamicInstances: 0,
      readyInstances: 0,
      assets: this._assets.size,
      assetsLoading: 0,
      assetsMissing: 0,
      assetsFailed: 0,
      assetsResident: this._atlas?.count ?? 0,
      atlasSize: this._atlas ? [...this._atlas.size] : [0, 0, 0],
      atlasOccupancy: this._atlas?.occupancy ?? 0,
      pendingUploads: this._atlas?.pendingUploads ?? 0,
      atlasFull: this._atlasFull,
      updates: this._updates,
      loadsInFlight: this._loading,
      camera: [this._camera.x, this._camera.y, this._camera.z]
    };
    for (const inst of this._instances.values()) {
      stats[inst.mode === 'static' ? 'staticInstances' : 'dynamicInstances']++;
      stats.readyInstances += this.isReady(inst) ? 1 : 0;
    }
    for (const asset of this._assets.values()) {
      stats.assetsLoading += asset.state === 'loading' ? 1 : 0;
      stats.assetsMissing += asset.state === 'missing' ? 1 : 0;
      stats.assetsFailed += asset.state === 'failed' ? 1 : 0;
    }
    return stats;
  }
  /**
   * Gives a primitive with no baked field asset (one built in code, such as a
   * shape) a field at run time, for the meshes drawing it to take part in the
   * scene field as a baked one would. Replaces a field given before. Shared by
   * every scene: a mesh of another scene drawing the same primitive takes it up
   * too. The field is in the primitive's local space, as {@link bakeMeshSDF}
   * makes it.
   */
  setField(primitive: Primitive, sdf: MeshSDFData) {
    let key = runtimeKeys.get(primitive);
    if (!key) {
      key = `runtime:${++runtimeKeyCounter}`;
      runtimeKeys.set(primitive, key);
    }
    const { header, voxels } = readZsdf(writeZsdf(sdf));
    runtimeFields.set(key, { header, voxels });
    this.invalidate(key);
    for (const mesh of this._tracked) {
      if (mesh.primitive === primitive) {
        this.retrack(mesh);
      }
    }
  }
  /**
   * Bakes the field of a primitive on the CPU from its triangles, read back from
   * the GPU, and gives it to the primitive with {@link SceneSDF.setField}. For a
   * primitive built in code; one loaded from an asset is baked in the editor
   * instead. Takes a moment for a large mesh, as the editor's bake does.
   */
  async bakeField(primitive: Primitive, options?: MeshSDFBakeOptions) {
    const { positions, indices } = await readPrimitiveTriangles(primitive, 0);
    this.setField(primitive, bakeMeshSDF(positions, indices, options));
  }
  /**
   * Drops the loaded field of a mesh so it is read again, e.g. after it was
   * rebaked. Without a path, every field that was missing or failed is retried.
   */
  invalidate(meshPath?: string) {
    for (const asset of this._assets.values()) {
      if (meshPath ? asset.meshPath === meshPath : asset.state === 'missing' || asset.state === 'failed') {
        if (this._atlas?.getSlot(asset)) {
          this._atlas.remove(asset);
          this.dirtyAsset(asset);
        }
        asset.state = 'loading';
        asset.requested = false;
        asset.header = null;
        asset.voxels = null;
      }
    }
  }
  /**
   * Streams fields for a camera position: starts loads for the nearest wanted
   * fields, places loaded ones in the atlas (evicting unwanted ones when it is
   * full) and uploads within the byte budget. Called by the scene once a frame.
   */
  update(cameraPos: Vector3, deltaSeconds: number) {
    if (!this._enabled) {
      return;
    }
    this._time += deltaSeconds;
    for (const node of this._pendingAttach) {
      if (node.attached && !node.disposed) {
        this.collect(node);
      }
    }
    this._pendingAttach.clear();
    this._updates++;
    this._camera.set(cameraPos);
    // Wanted assets, nearest instance first
    const wanted = new Map<MeshSDFAsset, number>();
    for (const inst of this._instances.values()) {
      this.refreshBounds(inst);
      const asset = inst.asset;
      if (!asset || asset.state === 'missing' || asset.state === 'failed') {
        continue;
      }
      const d = distanceToBox(cameraPos, inst.bounds);
      if (d <= this.streamRadius) {
        const prev = wanted.get(asset);
        wanted.set(asset, prev === undefined ? d : Math.min(prev, d));
      }
    }
    const order = [...wanted.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const atlas = this.atlas;
    for (const asset of order) {
      asset.lastWanted = this._time;
      if (asset.state === 'loading') {
        if (!asset.requested && this._loading < this.maxConcurrentLoads) {
          this.load(asset);
        }
        continue;
      }
      if (asset.state === 'ready' && !atlas.getSlot(asset) && asset.failedVersion !== atlas.version) {
        this.place(asset, wanted);
      }
    }
    for (const key of atlas.flush(this.uploadBudget)) {
      this.dirtyAsset(key as MeshSDFAsset);
    }
    if (this._terrain && (!this._terrain.attached || this._terrain.scene !== this._scene)) {
      this._terrain = null;
    }
    if (!this._globalFailed) {
      try {
        this.global?.update(cameraPos, this._terrain);
      } catch (err) {
        // A program that failed to build fails every frame: report it once and
        // leave the global field off rather than abort the scene update
        this._globalFailed = true;
        console.error('SceneSDF: the global field is disabled after an error', err);
      }
    }
  }
  protected onDispose() {
    super.onDispose();
    this.enabled = false;
  }
  /** @internal */
  private place(asset: MeshSDFAsset, wanted: Map<MeshSDFAsset, number>) {
    const atlas = this.atlas;
    const res = asset.header!.resolution;
    if (atlas.add(asset, res, asset.voxels!)) {
      return;
    }
    // Evict resident fields that are not wanted, least recently wanted first,
    // then wanted ones farther from the camera than this one, farthest first
    const resident = [...this._assets.values()].filter((a) => a !== asset && atlas.getSlot(a));
    const dist = wanted.get(asset)!;
    const nearer = (a: MeshSDFAsset) => wanted.has(a) && wanted.get(a)! <= dist;
    const victims = [
      ...resident.filter((a) => !wanted.has(a)).sort((a, b) => a.lastWanted - b.lastWanted),
      ...resident.filter((a) => wanted.get(a)! > dist).sort((a, b) => wanted.get(b)! - wanted.get(a)!)
    ];
    // Evicting is pointless, and makes the evicted fields and this one push each
    // other out frame after frame, when even the nearer fields alone leave no room
    const fits = atlas.fits(res, resident.filter(nearer));
    for (const victim of fits ? victims : []) {
      atlas.remove(victim);
      this.dirtyAsset(victim);
      if (atlas.add(asset, res, asset.voxels!)) {
        return;
      }
    }
    asset.failedVersion = atlas.version;
    this._atlasFull++;
    if (!this._atlasFullWarned) {
      this._atlasFullWarned = true;
      let demand = 0;
      for (const a of wanted.keys()) {
        if (a.header) {
          demand += a.header.resolution.reduce(
            (n, v) => n * Math.ceil(v / SDF_ATLAS_BLOCK) * SDF_ATLAS_BLOCK,
            1
          );
        }
      }
      const capacity = atlas.size[0] * atlas.size[1] * atlas.size[2];
      console.warn(
        `SceneSDF: the field of ${asset.meshPath} (${res.join('×')} voxels) does not fit the ${this._atlasSize.join('×')} atlas, which is ${Math.round(atlas.occupancy * 100)}% full; the loaded fields within SceneSDF.streamRadius (${this.streamRadius}) need ${(demand / capacity).toFixed(1)}× the atlas. It and any other field that does not fit are left out of the scene field. Raise SceneSDF.atlasSize, lower SceneSDF.streamRadius or bake meshes at a lower resolution scale.`
      );
    }
  }
  /** @internal */
  private load(asset: MeshSDFAsset) {
    asset.requested = true;
    const given = runtimeFields.get(asset.meshPath);
    if (given) {
      asset.header = given.header;
      asset.voxels = given.voxels;
      asset.state = 'ready';
      return;
    }
    this._loading++;
    const vfs = getEngine().VFS;
    const path = getMeshSDFPath(asset.meshPath);
    (async () => {
      if (!(await vfs.exists(path))) {
        return 'missing' as const;
      }
      const { header, voxels } = readZsdf((await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer);
      asset.header = header;
      asset.voxels = voxels;
      return 'ready' as const;
    })().then(
      (state) => {
        this._loading--;
        asset.state = state;
      },
      (err) => {
        this._loading--;
        asset.state = 'failed';
        console.warn(`SceneSDF: cannot read the field of ${asset.meshPath}: ${err}`);
      }
    );
  }
  /** @internal */
  private collect(root: SceneNode) {
    root.iterate((node) => {
      if (node.isMesh()) {
        this.track(node);
      } else if (node.isClipmapTerrain() && !this._terrain) {
        this._terrain = node;
      }
      return false;
    });
  }
  /** @internal */
  private onNodeAttached(node: SceneNode) {
    // Bubbles to the root once per attach; the subtree comes with it. Deferred
    // to the next update: a node constructed with a parent attaches from the
    // base class constructor, before the derived class has set itself up.
    this._pendingAttach.add(node);
  }
  /** @internal */
  private onNodeRemoved(node: SceneNode) {
    this._pendingAttach.delete(node);
    node.iterate((child) => {
      if (child.isMesh()) {
        this.untrack(child);
      }
      return false;
    });
  }
  /** @internal */
  private track(mesh: Mesh) {
    if (!this._tracked.has(mesh)) {
      this._tracked.add(mesh);
      mesh.on('sdfmode_changed', this.onMeshChanged, this);
      mesh.on('primitive_changed', this.onPrimitiveChanged, this);
    }
    this.retrack(mesh);
  }
  /** @internal */
  private onVisibleChanged(node: SceneNode) {
    // Bubbles to the root from the node whose show state changed
    node.iterate((child) => {
      if (child.isMesh() && this._tracked.has(child)) {
        this.retrack(child);
      }
      return false;
    });
  }
  /** Places a tracked mesh again after its mode, primitive, parentage or visibility changed. @internal */
  private retrack(mesh: Mesh) {
    const mode = mesh.attached && !mesh.hidden ? mesh.effectiveSDFMode : 'none';
    const primitive = mesh.primitive;
    const path = primitive ? getEngine().resourceManager.getAssetId(primitive) : null;
    // A field given at run time wins over a baked one, which a primitive built
    // in code does not have
    const runtimeKey = primitive ? runtimeKeys.get(primitive) : undefined;
    const meshPath =
      runtimeKey && runtimeFields.has(runtimeKey)
        ? runtimeKey
        : path && path.toLowerCase().endsWith('.zmsh')
          ? path
          : null;
    const prev = this._instances.get(mesh);
    if (prev && prev.mode === mode && prev.asset?.meshPath === (meshPath ?? undefined)) {
      return;
    }
    if (prev) {
      this.dropInstance(prev);
    }
    if (mode === 'none') {
      if (prev) {
        this._instances.delete(mesh);
      }
      return;
    }
    const inst: SDFInstance = {
      mesh,
      mode,
      asset: meshPath ? this.acquire(meshPath) : null,
      bounds: emptyBox()
    };
    this.refreshBounds(inst);
    this._instances.set(mesh, inst);
    if (this.isReady(inst)) {
      this.emitBounds(inst.bounds);
    }
  }
  /** @internal */
  private untrack(mesh: Mesh) {
    if (!this._tracked.delete(mesh)) {
      return;
    }
    mesh.off('sdfmode_changed', this.onMeshChanged, this);
    mesh.off('primitive_changed', this.onPrimitiveChanged, this);
    const inst = this._instances.get(mesh);
    if (inst) {
      this.dropInstance(inst);
      this._instances.delete(mesh);
    }
  }
  /** @internal */
  private dropInstance(inst: SDFInstance) {
    if (this.isReady(inst)) {
      this.emitBounds(inst.bounds);
    }
    const asset = inst.asset;
    if (asset && --asset.refs <= 0) {
      this._atlas?.remove(asset);
      this._assets.delete(asset.meshPath);
    }
  }
  /** @internal */
  private acquire(meshPath: string) {
    let asset = this._assets.get(meshPath);
    if (!asset) {
      asset = new MeshSDFAsset(meshPath);
      this._assets.set(meshPath, asset);
    }
    asset.refs++;
    return asset;
  }
  /** @internal */
  private onMeshChanged(mesh: Mesh) {
    this.retrack(mesh);
  }
  /** @internal */
  private onPrimitiveChanged() {
    // The event carries the primitive, not the mesh: recheck all; primitives change rarely
    for (const mesh of this._tracked) {
      this.retrack(mesh);
    }
  }
  /** World bounds of the instance; a static one that moved dirties both boxes. @internal */
  private refreshBounds(inst: SDFInstance) {
    const bv = inst.mesh.getWorldBoundingVolume();
    if (!bv) {
      return;
    }
    const box = bv.toAABB();
    const b = inst.bounds;
    // equalsTo's tolerance scales with the values, so it would call the
    // infinite empty box equal to anything: test emptiness first
    const wasValid = b.minPoint.x <= b.maxPoint.x;
    if (wasValid && b.minPoint.equalsTo(box.minPoint) && b.maxPoint.equalsTo(box.maxPoint)) {
      return;
    }
    if (inst.mode === 'static' && this.isReady(inst)) {
      if (wasValid) {
        this.emitBounds(b);
      }
      this.emitBounds(box);
    }
    b.minPoint.set(box.minPoint);
    b.maxPoint.set(box.maxPoint);
  }
  /** @internal */
  private dirtyAsset(asset: MeshSDFAsset) {
    for (const inst of this._instances.values()) {
      if (inst.asset === asset) {
        this.emitBounds(inst.bounds);
      }
    }
  }
  /** @internal */
  private emitBounds(box: AABB) {
    if (box.minPoint.x <= box.maxPoint.x) {
      this._global?.markDirty(box.minPoint, box.maxPoint);
      this.dispatchEvent('dirty', box.minPoint, box.maxPoint);
    }
  }
}

function emptyBox() {
  return new AABB(new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity));
}

function distanceToBox(p: Vector3, box: AABB) {
  const dx = Math.max(box.minPoint.x - p.x, 0, p.x - box.maxPoint.x);
  const dy = Math.max(box.minPoint.y - p.y, 0, p.y - box.maxPoint.y);
  const dz = Math.max(box.minPoint.z - p.z, 0, p.z - box.maxPoint.z);
  return Math.hypot(dx, dy, dz);
}
