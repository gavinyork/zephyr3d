import type { Nullable } from '@zephyr3d/base';
import { AABB, DRef, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { Scene } from './scene';
import { SceneNode } from './scene_node';
import { GraphNode } from './graph_node';
import { BatchGroup } from './batchgroup';
import { Mesh } from './mesh';
import type { ClipmapTerrain } from './terrain-cm';
import type { Primitive } from '../render';
import type { MeshMaterial } from '../material';
import type { Camera } from '../camera';
import { getEngine } from '../app/api';
import { Collider, NodePhysics, RigidBody } from '../physics';
import type { ColliderShape } from '../physics';

/** Number of floats per foliage instance: x, z, y offset, rotation about Y, scale */
export const FOLIAGE_INSTANCE_STRIDE = 5;

/**
 * Settings of a {@link FoliageLayer}
 * @public
 */
export interface FoliageLayerSettings {
  /** Whether the instances cast shadows. Default true. */
  castShadow?: boolean;
  /** Distance from the camera beyond which the instances are not drawn. Default 300. */
  cullDistance?: number;
  /** How much the instances lean with the ground: 0 stays upright, 1 follows the normal. Default 0. */
  alignToNormal?: number;
  /** What the instances collide with in the physics simulation; null for nothing. Default null. */
  collision?: Nullable<FoliageCollision>;
}

/**
 * Shape of the colliders of a {@link FoliageLayer}: a basic shape, or `'asset'` for the
 * colliders on the nodes of the scattered asset itself.
 * @public
 */
export type FoliageCollisionShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'asset';

/**
 * Colliders of the instances of a {@link FoliageLayer}, which make them static obstacles.
 *
 * @remarks
 * Sizes and the offset are in the asset's own units and scale with each instance. Sizes left
 * out are fitted to the bounds of the asset's meshes: give a trunk radius for a tree, whose
 * bounds are its canopy. A capsule or cylinder stands on the bottom of the bounds, centred on
 * the asset's origin; a box or sphere is centred on the bounds.
 *
 * With `'asset'`, the box, sphere, capsule and cylinder colliders found on the asset's nodes
 * are used as they are; mesh and convex colliders are skipped.
 * @public
 */
export interface FoliageCollision {
  shape: FoliageCollisionShape;
  /** Radius of a sphere, capsule or cylinder */
  radius?: number;
  /** Total height of a capsule or cylinder */
  height?: number;
  /** Full size of a box */
  size?: [number, number, number];
  /** Centre of the shape */
  offset?: [number, number, number];
  /** Default 0.5 */
  friction?: number;
  /** Default 0 */
  restitution?: number;
  /** Collision layer, 0 to 15. Default 0. */
  layer?: number;
}

/** A collider of every instance: its shape, and its transform relative to the instance */
type FoliageColliderTemplate = {
  matrix: Matrix4x4;
  shape: ColliderShape;
  size: Vector3;
  radius: number;
  height: number;
  offset: Vector3;
  friction: number;
  restitution: number;
  layer: number;
};

const PRIMITIVE_COLLIDER_SHAPES: readonly ColliderShape[] = ['box', 'sphere', 'capsule', 'cylinder'];

/** A mesh of the layer asset, with its transform relative to the asset root */
type FoliagePart = {
  primitive: DRef<Primitive>;
  material: DRef<MeshMaterial>;
  matrix: Matrix4x4;
};

/**
 * One kind of object scattered by a {@link FoliageSystem}: an asset and where its copies stand.
 * @public
 */
export class FoliageLayer {
  /** @internal */
  _asset: string;
  /** @internal */
  _instances: Float32Array;
  /** @internal */
  _count: number;
  /** @internal */
  _castShadow: boolean;
  /** @internal */
  _cullDistance: number;
  /** @internal */
  _alignToNormal: number;
  /** @internal */
  _collision: Nullable<FoliageCollision>;
  /** @internal */
  _parts: Nullable<FoliagePart[]>;
  /** Bounds of the asset's meshes, relative to its root @internal */
  _bounds: Nullable<AABB>;
  /** Colliders found on the asset's nodes @internal */
  _assetColliders: FoliageColliderTemplate[];
  /** @internal */
  _loading: Nullable<Promise<void>>;
  /** @internal */
  constructor(asset: string, settings?: FoliageLayerSettings) {
    this._asset = asset;
    this._instances = new Float32Array(0);
    this._count = 0;
    this._castShadow = settings?.castShadow ?? true;
    this._cullDistance = settings?.cullDistance ?? 300;
    this._alignToNormal = settings?.alignToNormal ?? 0;
    this._collision = copyCollision(settings?.collision);
    this._parts = null;
    this._bounds = null;
    this._assetColliders = [];
    this._loading = null;
  }
  /** Path of the prefab or model asset the layer scatters */
  get asset() {
    return this._asset;
  }
  /** Number of instances */
  get count() {
    return this._count;
  }
  /** Whether the instances cast shadows */
  get castShadow() {
    return this._castShadow;
  }
  /** Distance from the camera beyond which the instances are not drawn */
  get cullDistance() {
    return this._cullDistance;
  }
  /** How much the instances lean with the ground: 0 stays upright, 1 follows the normal */
  get alignToNormal() {
    return this._alignToNormal;
  }
  /** What the instances collide with; null for nothing. A copy: change it with {@link FoliageSystem.setLayerSettings}. */
  get collision(): Nullable<FoliageCollision> {
    return copyCollision(this._collision);
  }
  /** @internal */
  _colliderTemplates(): FoliageColliderTemplate[] {
    const c = this._collision;
    if (!c) {
      return [];
    }
    if (c.shape === 'asset') {
      return this._assetColliders;
    }
    const b = this._bounds;
    const ext = b ? Vector3.sub(b.maxPoint, b.minPoint) : new Vector3(1, 1, 1);
    const center = b ? Vector3.scale(Vector3.add(b.minPoint, b.maxPoint), 0.5) : new Vector3(0, 0.5, 0);
    const bottom = b ? b.minPoint.y : 0;
    const height = c.height ?? ext.y;
    const radius =
      c.radius ?? (c.shape === 'sphere' ? Math.max(ext.x, ext.y, ext.z) : Math.min(ext.x, ext.z)) / 2;
    const offset = c.offset
      ? new Vector3(c.offset[0], c.offset[1], c.offset[2])
      : c.shape === 'capsule' || c.shape === 'cylinder'
        ? new Vector3(0, bottom + height / 2, 0)
        : center;
    return [
      {
        matrix: Matrix4x4.identity(),
        shape: c.shape,
        size: c.size ? new Vector3(c.size[0], c.size[1], c.size[2]) : ext,
        radius,
        height,
        offset,
        friction: c.friction ?? 0.5,
        restitution: c.restitution ?? 0,
        layer: c.layer ?? 0
      }
    ];
  }
  /**
   * The instances, {@link FOLIAGE_INSTANCE_STRIDE} floats each: x, z (local to the foliage system),
   * height offset above the ground, rotation about the vertical axis in radians, uniform scale.
   * A copy: change instances with the methods of {@link FoliageSystem}.
   */
  getInstances() {
    return this._instances.slice(0, this._count * FOLIAGE_INSTANCE_STRIDE);
  }
  /** @internal */
  _dispose() {
    for (const part of this._parts ?? []) {
      part.primitive.dispose();
      part.material.dispose();
    }
    this._parts = null;
    this._bounds = null;
    this._assetColliders = [];
  }
}

const COLLISION_SHAPES: readonly FoliageCollisionShape[] = ['box', 'sphere', 'capsule', 'cylinder', 'asset'];

/** A copy of a collision setting; null for none, or for one without a valid shape */
function copyCollision(c: Nullable<FoliageCollision> | undefined): Nullable<FoliageCollision> {
  if (!c || !COLLISION_SHAPES.includes(c.shape)) {
    return null;
  }
  return {
    ...c,
    size: c.size ? [c.size[0], c.size[1], c.size[2]] : undefined,
    offset: c.offset ? [c.offset[0], c.offset[1], c.offset[2]] : undefined
  };
}

type FoliageChunk = {
  layer: FoliageLayer;
  group: BatchGroup;
  /** Static body holding the colliders of the chunk's instances */
  colliders: Nullable<SceneNode>;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  visible: boolean;
};

const tmpQuat = new Quaternion();
const tmpAlign = new Quaternion();
const tmpNormal = new Vector3();
const tmpScale = new Vector3();
const tmpPos = new Vector3();
const tmpMatrix = new Matrix4x4();
const tmpMatrix2 = new Matrix4x4();
const UP = Vector3.axisPY();

/**
 * Scatters many copies of prefabs or models, such as trees, bushes and rocks, over a terrain.
 *
 * @remarks
 * Each {@link FoliageLayer} scatters one asset. An instance stores only its horizontal position,
 * an offset above the ground, a rotation about the vertical axis and a scale; its height is taken
 * from the {@link ClipmapTerrain} the system is a descendant of, so the instances follow the
 * ground when the terrain changes. Without a terrain ancestor the offset is the height.
 *
 * Instances are drawn in square chunks of {@link FoliageSystem.chunkSize}, each a
 * {@link BatchGroup} built on demand and not serialized, which draws a whole chunk in a few
 * instanced draw calls; chunks farther than the cull distance of their layer are hidden.
 *
 * Positions are in the space of the foliage system, which is meant to be translated only.
 * @public
 */
export class FoliageSystem extends GraphNode {
  private _layers: FoliageLayer[];
  private _chunkSize: number;
  private _chunks: FoliageChunk[];
  private _dirty: boolean;
  private _buildSerial: number;
  private _builtHeightData: unknown;
  private _builtTerrain: Nullable<ClipmapTerrain>;
  /**
   * Creates a foliage system
   * @param scene - The scene to which the node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._layers = [];
    this._chunkSize = 64;
    this._chunks = [];
    this._dirty = false;
    this._buildSerial = 0;
    this._builtHeightData = null;
    this._builtTerrain = null;
  }
  /** Edge length of the square chunks the instances are drawn in. Default 64. */
  get chunkSize() {
    return this._chunkSize;
  }
  set chunkSize(val: number) {
    val = Math.max(1, val);
    if (val !== this._chunkSize) {
      this._chunkSize = val;
      this.invalidate();
    }
  }
  /** Number of layers */
  get numLayers() {
    return this._layers.length;
  }
  /** Total number of instances of all layers */
  get numInstances() {
    return this._layers.reduce((sum, layer) => sum + layer._count, 0);
  }
  /**
   * Gets a layer
   * @param index - Layer index
   */
  getLayer(index: number): Nullable<FoliageLayer> {
    return this._layers[index] ?? null;
  }
  /**
   * Adds a layer scattering a prefab (.zprefab) or a model asset
   * @param asset - Path of the asset
   * @param settings - Layer settings
   * @returns Index of the new layer
   */
  addLayer(asset: string, settings?: FoliageLayerSettings) {
    this._layers.push(new FoliageLayer(asset, settings));
    this.invalidate();
    return this._layers.length - 1;
  }
  /**
   * Removes a layer and its instances
   * @param index - Layer index
   */
  removeLayer(index: number) {
    const layer = this._layers[index];
    if (layer) {
      this._layers.splice(index, 1);
      layer._dispose();
      this.invalidate();
    }
  }
  /**
   * Removes every layer
   */
  clearLayers() {
    for (const layer of this._layers) {
      layer._dispose();
    }
    this._layers = [];
    this.invalidate();
  }
  /**
   * Changes the settings of a layer
   * @param index - Layer index
   * @param settings - Settings to change; omitted ones are kept
   */
  setLayerSettings(index: number, settings: FoliageLayerSettings & { asset?: string }) {
    const layer = this._layers[index];
    if (!layer) {
      return;
    }
    if (settings.asset !== undefined && settings.asset !== layer._asset) {
      layer._dispose();
      layer._asset = settings.asset;
    }
    layer._castShadow = settings.castShadow ?? layer._castShadow;
    layer._cullDistance = settings.cullDistance ?? layer._cullDistance;
    layer._alignToNormal = settings.alignToNormal ?? layer._alignToNormal;
    if (settings.collision !== undefined) {
      layer._collision = copyCollision(settings.collision);
    }
    this.invalidate();
  }
  /**
   * Replaces the instances of a layer
   * @param index - Layer index
   * @param data - {@link FOLIAGE_INSTANCE_STRIDE} floats per instance, see {@link FoliageLayer.getInstances}
   */
  setInstances(index: number, data: ArrayLike<number>) {
    const layer = this._layers[index];
    if (!layer) {
      return;
    }
    const count = Math.floor(data.length / FOLIAGE_INSTANCE_STRIDE);
    layer._instances = Float32Array.from({ length: count * FOLIAGE_INSTANCE_STRIDE }, (_, i) => data[i]);
    layer._count = count;
    this.invalidate();
  }
  /**
   * Appends instances to a layer
   * @param index - Layer index
   * @param data - {@link FOLIAGE_INSTANCE_STRIDE} floats per instance, see {@link FoliageLayer.getInstances}
   */
  addInstances(index: number, data: ArrayLike<number>) {
    const layer = this._layers[index];
    if (!layer) {
      return;
    }
    const count = Math.floor(data.length / FOLIAGE_INSTANCE_STRIDE);
    const total = layer._count + count;
    if (total * FOLIAGE_INSTANCE_STRIDE > layer._instances.length) {
      const grown = new Float32Array(Math.max(total, layer._count * 2) * FOLIAGE_INSTANCE_STRIDE);
      grown.set(layer._instances.subarray(0, layer._count * FOLIAGE_INSTANCE_STRIDE));
      layer._instances = grown;
    }
    for (let i = 0; i < count * FOLIAGE_INSTANCE_STRIDE; i++) {
      layer._instances[layer._count * FOLIAGE_INSTANCE_STRIDE + i] = data[i];
    }
    layer._count = total;
    this.invalidate();
  }
  /**
   * Removes the instances standing within a circle
   * @param x - Circle centre x, local to the foliage system
   * @param z - Circle centre z, local to the foliage system
   * @param radius - Circle radius
   * @param index - Layer index, or -1 for every layer
   * @returns Number of instances removed
   */
  removeInstancesInCircle(x: number, z: number, radius: number, index = -1) {
    let removed = 0;
    const r2 = radius * radius;
    this._layers.forEach((layer, i) => {
      if (index >= 0 && i !== index) {
        return;
      }
      const d = layer._instances;
      let n = 0;
      for (let k = 0; k < layer._count; k++) {
        const o = k * FOLIAGE_INSTANCE_STRIDE;
        const dx = d[o] - x;
        const dz = d[o + 1] - z;
        if (dx * dx + dz * dz <= r2) {
          continue;
        }
        if (n !== k) {
          d.copyWithin(n * FOLIAGE_INSTANCE_STRIDE, o, o + FOLIAGE_INSTANCE_STRIDE);
        }
        n++;
      }
      removed += layer._count - n;
      layer._count = n;
    });
    if (removed > 0) {
      this.invalidate();
    }
    return removed;
  }
  /**
   * The terrain the instances stand on: the closest {@link ClipmapTerrain} ancestor
   */
  get terrain(): Nullable<ClipmapTerrain> {
    let node = this.parent;
    while (node) {
      if (node.isClipmapTerrain()) {
        return node;
      }
      node = node.parent;
    }
    return null;
  }
  /**
   * Schedules the chunks to be rebuilt; called by the methods changing layers or instances
   */
  invalidate() {
    this._dirty = true;
    this.scene?.queuePerCameraUpdateNode(this);
  }
  /** {@inheritDoc SceneNode.updatePerCamera} */
  updatePerCamera(camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number) {
    this.scene?.queuePerCameraUpdateNode(this);
    const terrain = this.terrain;
    // Rebuilt once the terrain heights the instances stand on are known again after a change
    if (terrain !== this._builtTerrain || (terrain && terrain.heightData !== this._builtHeightData)) {
      if (!terrain || terrain.heightData) {
        this._dirty = true;
      } else {
        terrain.whenHeightDataReady();
      }
    }
    if (this._dirty) {
      this._dirty = false;
      this.rebuild();
    }
    const eye = camera.getWorldPosition();
    const ox = this.worldMatrix.m03;
    const oz = this.worldMatrix.m23;
    const ex = eye.x - ox;
    const ez = eye.z - oz;
    for (const chunk of this._chunks) {
      const dx = Math.max(chunk.minX - ex, 0, ex - chunk.maxX);
      const dz = Math.max(chunk.minZ - ez, 0, ez - chunk.maxZ);
      const visible = dx * dx + dz * dz <= chunk.layer._cullDistance * chunk.layer._cullDistance;
      if (visible !== chunk.visible) {
        chunk.visible = visible;
        chunk.group.showState = visible ? 'inherit' : 'hidden';
      }
    }
  }
  /** @internal */
  protected _onAttached(): void {
    super._onAttached();
    this.invalidate();
  }
  /** Rebuilds every chunk, loading the layer assets first */
  private rebuild() {
    const serial = ++this._buildSerial;
    const terrain = this.terrain;
    const heightData = terrain?.heightData ?? null;
    const pending = this._layers.filter((layer) => !layer._parts).map((layer) => this.loadLayer(layer));
    Promise.all(pending).then(() => {
      if (serial !== this._buildSerial || this.disposed) {
        return;
      }
      this.clearChunks();
      this._builtTerrain = terrain;
      this._builtHeightData = heightData;
      for (const layer of this._layers) {
        this.buildLayer(layer, terrain);
      }
    });
  }
  private clearChunks() {
    for (const chunk of this._chunks) {
      chunk.group.remove();
      chunk.group.dispose();
      chunk.colliders?.dispose();
    }
    this._chunks = [];
  }
  private loadLayer(layer: FoliageLayer) {
    if (!layer._loading) {
      layer._loading = (async () => {
        const scene = this.scene!;
        const tmp = new SceneNode(scene);
        tmp.remove();
        let root: Nullable<SceneNode> = null;
        try {
          const manager = getEngine().resourceManager;
          root = layer._asset.toLowerCase().endsWith('.zprefab')
            ? await manager.instantiatePrefab(tmp, layer._asset)
            : ((await manager.fetchModel(layer._asset, scene)) ?? null);
          if (root) {
            root.parent = tmp;
            root.position.setXYZ(0, 0, 0);
            root.rotation.identity();
            root.scale.setXYZ(1, 1, 1);
          }
        } catch (err) {
          console.error(`Foliage: cannot load ${layer._asset}: ${err}`);
        }
        const parts: FoliagePart[] = [];
        const colliders: FoliageColliderTemplate[] = [];
        let bounds: Nullable<AABB> = null;
        root?.iterate((node) => {
          for (const c of node.physics?.colliders ?? []) {
            if (PRIMITIVE_COLLIDER_SHAPES.includes(c.shape)) {
              colliders.push({
                matrix: new Matrix4x4(node.worldMatrix),
                shape: c.shape,
                size: new Vector3(c.size),
                radius: c.radius,
                height: c.height,
                offset: new Vector3(c.offset),
                friction: c.friction,
                restitution: c.restitution,
                layer: c.layer
              });
            } else {
              console.warn(`Foliage: ${c.shape} colliders of ${layer._asset} are skipped`);
            }
          }
          if (node.isMesh() && node.primitive && node.material) {
            const box = node.primitive.getBoundingVolume()?.toAABB();
            if (box) {
              const world = AABB.transform(box, node.worldMatrix);
              if (bounds) {
                bounds.union(world);
              } else {
                bounds = world;
              }
            }
            if (node.skeletonName || node.morphTargetGroups?.length) {
              console.warn(`Foliage: skinned and morphed meshes of ${layer._asset} are skipped`);
              return false;
            }
            const material = node.material as MeshMaterial;
            parts.push({
              primitive: new DRef(node.primitive),
              // Instance materials are what lets the copies of a mesh be drawn instanced
              material: new DRef(material.$isInstance ? material : material.createInstance()),
              matrix: new Matrix4x4(node.worldMatrix)
            });
          }
          return false;
        });
        tmp.dispose();
        if (parts.length === 0) {
          console.error(`Foliage: ${layer._asset} has no mesh to scatter`);
        }
        layer._parts = parts;
        layer._bounds = bounds;
        layer._assetColliders = colliders;
        layer._loading = null;
      })();
    }
    return layer._loading;
  }
  private buildLayer(layer: FoliageLayer, terrain: Nullable<ClipmapTerrain>) {
    const parts = layer._parts;
    if (!parts || parts.length === 0 || layer._count === 0) {
      return;
    }
    const size = this._chunkSize;
    const buckets = new Map<string, number[]>();
    const d = layer._instances;
    for (let k = 0; k < layer._count; k++) {
      const o = k * FOLIAGE_INSTANCE_STRIDE;
      const key = `${Math.floor(d[o] / size)},${Math.floor(d[o + 1] / size)}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(o);
    }
    const ox = this.worldMatrix.m03;
    const oy = this.worldMatrix.m13;
    const oz = this.worldMatrix.m23;
    const templates = layer._colliderTemplates();
    for (const [key, offsets] of buckets) {
      const [cx, cz] = key.split(',').map(Number);
      const group = new BatchGroup(this.scene!);
      group.sealed = true;
      group.name = `Foliage chunk ${cx},${cz}`;
      group.parent = this;
      // One static body per chunk, with a collider node per instance and template
      let colliders: Nullable<SceneNode> = null;
      if (templates.length > 0) {
        colliders = new SceneNode(this.scene!);
        colliders.sealed = true;
        colliders.name = `Foliage colliders ${cx},${cz}`;
        colliders.parent = this;
        const body = new RigidBody();
        body.motionType = 'static';
        colliders.physics = new NodePhysics({ body });
      }
      for (const o of offsets) {
        const x = d[o];
        const z = d[o + 1];
        let y = d[o + 2];
        let upright = true;
        if (terrain) {
          const h = terrain.getHeightAt(x + ox, z + oz);
          if (h !== null) {
            y += h - oy;
            if (layer._alignToNormal > 0 && terrain.getNormalAt(x + ox, z + oz, tmpNormal)) {
              Quaternion.unitVectorToUnitVector(UP, tmpNormal, tmpAlign);
              Quaternion.slerp(Quaternion.identity(tmpQuat), tmpAlign, layer._alignToNormal, tmpAlign);
              upright = false;
            }
          }
        }
        Quaternion.fromAxisAngle(UP, d[o + 3], tmpQuat);
        if (!upright) {
          Quaternion.multiply(tmpAlign, tmpQuat, tmpQuat);
        }
        const s = d[o + 4];
        Matrix4x4.compose(tmpScale.setXYZ(s, s, s), tmpQuat, tmpPos.setXYZ(x, y, z), tmpMatrix);
        for (const part of parts) {
          const mesh = new Mesh(this.scene!, part.primitive.get()!, part.material.get()!);
          mesh.sealed = true;
          mesh.castShadow = layer._castShadow;
          mesh.gpuPickable = false;
          mesh.parent = group;
          mesh.setLocalTransform(Matrix4x4.multiply(tmpMatrix, part.matrix, tmpMatrix2));
        }
        for (const t of templates) {
          const node = new SceneNode(this.scene!);
          node.sealed = true;
          node.parent = colliders;
          node.setLocalTransform(Matrix4x4.multiply(tmpMatrix, t.matrix, tmpMatrix2));
          const collider = new Collider();
          collider.shape = t.shape;
          collider.size = t.size;
          collider.radius = t.radius;
          collider.height = t.height;
          collider.offset = t.offset;
          collider.friction = t.friction;
          collider.restitution = t.restitution;
          collider.layer = t.layer;
          node.physics = new NodePhysics({ colliders: [collider] });
        }
      }
      this._chunks.push({
        layer,
        group,
        colliders,
        minX: cx * size,
        minZ: cz * size,
        maxX: (cx + 1) * size,
        maxZ: (cz + 1) * size,
        visible: true
      });
    }
  }
  /** {@inheritDoc SceneNode.onDispose} */
  protected onDispose() {
    this._buildSerial++;
    this.clearChunks();
    for (const layer of this._layers) {
      layer._dispose();
    }
    this._layers = [];
    super.onDispose();
  }
}
