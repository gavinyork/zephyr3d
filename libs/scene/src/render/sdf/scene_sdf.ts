import type { Nullable } from '@zephyr3d/base';
import { AABB, Disposable, makeObservable, Vector3 } from '@zephyr3d/base';
import type { Mesh } from '../../scene/mesh';
import type { Scene } from '../../scene/scene';
import type { SceneNode } from '../../scene/scene_node';
import { getEngine } from '../../app/api';
import { getMeshSDFPath, readZsdf } from '../../asset/zsdf_binary';
import type { ZsdfHeader } from '../../asset/zsdf_binary';
import { MeshSDFAtlas } from './sdf_atlas';

/**
 * A baked mesh field as loaded, shared by every instance of the mesh.
 * @public
 */
export class MeshSDFAsset {
  /** Asset path of the mesh. */
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
  constructor(meshPath: string) {
    this.meshPath = meshPath;
    this.requested = false;
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
 * mesh with no baked field is left out until one is baked.
 *
 * @public
 */
export class SceneSDF extends makeObservable(Disposable)<SceneSDFEvents>() {
  /** Distance from the camera within which fields are kept loaded, in world units. */
  streamRadius: number;
  /** Field files read at once. */
  maxConcurrentLoads: number;
  /** Bytes uploaded to the atlas per frame. */
  uploadBudget: number;
  private readonly _scene: Scene;
  private _enabled: boolean;
  private _atlas: Nullable<MeshSDFAtlas>;
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
    this._tracked = new Set();
    this._instances = new Map();
    this._assets = new Map();
    this._loading = 0;
    this._time = 0;
    this._atlasFull = 0;
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
      this.collect(root);
    } else {
      root.off('nodeattached', this.onNodeAttached, this);
      root.off('noderemoved', this.onNodeRemoved, this);
      for (const mesh of [...this._tracked]) {
        this.untrack(mesh);
      }
      this._assets.clear();
      this._atlas?.dispose();
      this._atlas = null;
    }
  }
  /** The atlas of resident fields, created when first needed. */
  get atlas() {
    if (!this._atlas) {
      this._atlas = new MeshSDFAtlas();
    }
    return this._atlas;
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
      if (asset.state === 'ready' && !atlas.getSlot(asset)) {
        this.place(asset, wanted);
      }
    }
    for (const key of atlas.flush(this.uploadBudget)) {
      this.dirtyAsset(key as MeshSDFAsset);
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
    // Evict resident fields that are not wanted, least recently wanted first
    const victims = [...this._assets.values()]
      .filter((a) => !wanted.has(a) && atlas.getSlot(a))
      .sort((a, b) => a.lastWanted - b.lastWanted);
    for (const victim of victims) {
      atlas.remove(victim);
      this.dirtyAsset(victim);
      if (atlas.add(asset, res, asset.voxels!)) {
        return;
      }
    }
    this._atlasFull++;
  }
  /** @internal */
  private load(asset: MeshSDFAsset) {
    asset.requested = true;
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
      }
      return false;
    });
  }
  /** @internal */
  private onNodeAttached(node: SceneNode) {
    // Bubbles to the root once per attach; the subtree comes with it
    this.collect(node);
  }
  /** @internal */
  private onNodeRemoved(node: SceneNode) {
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
  /** Places a tracked mesh again after its mode, primitive or parentage changed. @internal */
  private retrack(mesh: Mesh) {
    const mode = mesh.attached ? mesh.effectiveSDFMode : 'none';
    const primitive = mesh.primitive;
    const path = primitive ? getEngine().resourceManager.getAssetId(primitive) : null;
    const meshPath = path && path.toLowerCase().endsWith('.zmsh') ? path : null;
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
