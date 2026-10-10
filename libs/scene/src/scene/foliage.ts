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
import { FOLIAGE_INSTANCE_STRIDE, FoliageInstanceBuckets } from './foliage_buckets';
import { FoliageDensityMask } from './foliage_mask';

export { FOLIAGE_INSTANCE_STRIDE } from './foliage_buckets';
export { FoliageDensityMask, FOLIAGE_MASK_TILE_SIZE, foliageBrushWeight } from './foliage_mask';

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
  /** How painted instances are generated; omitted fields keep their defaults */
  generation?: Partial<FoliageGeneration>;
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

/**
 * What painted instances of a {@link FoliageLayer} stand on: the terrain the foliage system is
 * a descendant of, following it when it changes, or whatever surface with a collider lies below,
 * at the height found when they were generated.
 * @public
 */
export type FoliageSurface = 'terrain' | 'any';

/**
 * How the painted instances of a {@link FoliageLayer} are generated from its density mask.
 *
 * @remarks
 * Candidates lie on a grid of `spacing` aligned with the origin of the foliage system, one per
 * cell, jittered within it. Each cell draws its position, a threshold, a rotation and a scale
 * from a random sequence seeded only by its coordinates and `seed`, so a candidate is the same
 * whenever and wherever it is evaluated. A candidate becomes an instance where the density
 * there, times what the place script returns, is above its threshold and the slope and height
 * filters pass; painting denser adds instances without moving the ones already there.
 * @public
 */
export interface FoliageGeneration {
  /** Distance between candidates, roughly the closest two instances get, in meters. Default 4. */
  spacing: number;
  /** Range of the uniform scale. Default [0.8, 1.2]. */
  scaleRange: [number, number];
  /** Range of the slope, in degrees from horizontal, instances grow on. Default [0, 45]. */
  slopeRange: [number, number];
  /** Range of the world height instances grow at; null for no limit. Default null. */
  heightRange: Nullable<[number, number]>;
  /** Height above the surface, negative to sink the base into the ground. Default 0. */
  yOffset: number;
  /** Whether instances turn randomly about the vertical axis. Default true. */
  randomYaw: boolean;
  /** Seed of the candidate grid. Default random at creation. */
  seed: number;
  /** What the instances stand on. Default 'terrain'. */
  surface: FoliageSurface;
  /** Optional `function place(p, api, input)`, as for the scatter tool; empty for none. */
  placeScript: string;
}

function defaultGeneration(): FoliageGeneration {
  return {
    spacing: 4,
    scaleRange: [0.8, 1.2],
    slopeRange: [0, 45],
    heightRange: null,
    yOffset: 0,
    randomYaw: true,
    seed: Math.floor(Math.random() * 0x7fffffff),
    surface: 'terrain',
    placeScript: ''
  };
}

function copyGeneration(g: FoliageGeneration): FoliageGeneration {
  return {
    ...g,
    scaleRange: [g.scaleRange[0], g.scaleRange[1]],
    slopeRange: [g.slopeRange[0], g.slopeRange[1]],
    heightRange: g.heightRange ? [g.heightRange[0], g.heightRange[1]] : null
  };
}

/** A generation setting with the omitted and invalid fields of `g` taken from `base` */
function mergeGeneration(base: FoliageGeneration, g: Partial<FoliageGeneration>): FoliageGeneration {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const pair = (v: unknown, d: [number, number]): [number, number] =>
    Array.isArray(v) && v.length === 2 ? [num(v[0], d[0]), num(v[1], d[1])] : [d[0], d[1]];
  return {
    spacing: Math.max(0.05, num(g.spacing, base.spacing)),
    scaleRange: pair(g.scaleRange, base.scaleRange),
    slopeRange: pair(g.slopeRange, base.slopeRange),
    heightRange:
      g.heightRange === undefined
        ? base.heightRange
          ? [base.heightRange[0], base.heightRange[1]]
          : null
        : g.heightRange
          ? pair(g.heightRange, [-Infinity, Infinity])
          : null,
    yOffset: num(g.yOffset, base.yOffset),
    randomYaw: typeof g.randomYaw === 'boolean' ? g.randomYaw : base.randomYaw,
    seed: Math.floor(num(g.seed, base.seed)) | 0,
    surface: g.surface === 'terrain' || g.surface === 'any' ? g.surface : base.surface,
    placeScript: typeof g.placeScript === 'string' ? g.placeScript : base.placeScript
  };
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
 * Which instances of a {@link FoliageLayer}: the ones generated from its density mask, the ones
 * placed directly (by the scatter tool or {@link FoliageSystem.setInstances}), or both.
 * @public
 */
export type FoliageInstanceGroup = 'generated' | 'manual' | 'all';

/**
 * One kind of object scattered by a {@link FoliageSystem}: an asset and where its copies stand.
 *
 * @remarks
 * A layer holds two groups of instances. The generated ones follow from its
 * {@link FoliageLayer.mask | density mask} and {@link FoliageLayer.generation | generation
 * settings}, and only painting and regenerating change them. The manual ones are placed
 * directly and are left alone by generation; only erasing and the instance methods remove them.
 * Both are drawn and collide alike.
 * @public
 */
export class FoliageLayer {
  /** The foliage system the layer belongs to @internal */
  _owner: Nullable<FoliageSystem>;
  /** @internal */
  _asset: string;
  /** @internal */
  _generated: FoliageInstanceBuckets;
  /** @internal */
  _manual: FoliageInstanceBuckets;
  /** @internal */
  _mask: FoliageDensityMask;
  /** @internal */
  _generation: FoliageGeneration;
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
  /**
   * Creates a layer; add it to a foliage system with {@link FoliageSystem.insertLayer}
   * @param asset - Path of the prefab or model asset the layer scatters
   * @param settings - Layer settings
   */
  constructor(asset = '', settings?: FoliageLayerSettings) {
    this._owner = null;
    this._asset = asset;
    this._generated = new FoliageInstanceBuckets(64);
    this._manual = new FoliageInstanceBuckets(64);
    this._mask = new FoliageDensityMask(1);
    this._generation = mergeGeneration(defaultGeneration(), settings?.generation ?? {});
    this._castShadow = settings?.castShadow ?? true;
    this._cullDistance = settings?.cullDistance ?? 300;
    this._alignToNormal = settings?.alignToNormal ?? 0;
    this._collision = copyCollision(settings?.collision);
    this._parts = null;
    this._bounds = null;
    this._assetColliders = [];
    this._loading = null;
  }
  /** The foliage system the layer belongs to */
  get owner() {
    return this._owner;
  }
  /** Path of the prefab or model asset the layer scatters; changing it keeps the instances */
  get asset() {
    return this._asset;
  }
  set asset(val: string) {
    if (val !== this._asset) {
      this._dispose();
      this._asset = val;
      this._owner?.invalidate();
    }
  }
  /** Number of instances of both groups */
  get count() {
    return this._generated.count + this._manual.count;
  }
  /** Number of instances generated from the density mask */
  get generatedCount() {
    return this._generated.count;
  }
  /** Number of instances placed directly */
  get manualCount() {
    return this._manual.count;
  }
  /**
   * Where the layer grows when painted. Change it through the foliage brush or
   * {@link FoliageSystem.paintMask}, which keep the generated instances in step.
   */
  get mask(): FoliageDensityMask {
    return this._mask;
  }
  /**
   * How painted instances are generated. Reading gives a copy; assigning one changes the
   * settings but not the instances, until the layer is regenerated.
   */
  get generation(): FoliageGeneration {
    return copyGeneration(this._generation);
  }
  set generation(val: Partial<FoliageGeneration>) {
    this._generation = mergeGeneration(this._generation, val);
  }
  /** Whether the instances cast shadows */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(val: boolean) {
    if (val !== this._castShadow) {
      this._castShadow = val;
      this._owner?.invalidate();
    }
  }
  /** Distance from the camera beyond which the instances are not drawn */
  get cullDistance() {
    return this._cullDistance;
  }
  set cullDistance(val: number) {
    // Only decides which chunks are shown each frame, nothing to rebuild
    this._cullDistance = val;
  }
  /** How much the instances lean with the ground: 0 stays upright, 1 follows the normal */
  get alignToNormal() {
    return this._alignToNormal;
  }
  set alignToNormal(val: number) {
    if (val !== this._alignToNormal) {
      this._alignToNormal = val;
      this._owner?.invalidate();
    }
  }
  /** What the instances collide with; null for nothing. Reading gives a copy; assign to change it. */
  get collision(): Nullable<FoliageCollision> {
    return copyCollision(this._collision);
  }
  set collision(val: Nullable<FoliageCollision>) {
    this._collision = copyCollision(val);
    this._owner?.invalidate();
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
   * @param group - Which instances; both groups by default, the manual ones first
   */
  getInstances(group: FoliageInstanceGroup = 'all') {
    if (group === 'generated') {
      return this._generated.toArray();
    }
    if (group === 'manual') {
      return this._manual.toArray();
    }
    const manual = this._manual.toArray();
    const generated = this._generated.toArray();
    const out = new Float32Array(manual.length + generated.length);
    out.set(manual);
    out.set(generated, manual.length);
    return out;
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
    // A load still running is for the old asset, it discards its result
    this._loading = null;
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

/** Deterministic value in [0, 1) from a position, standing in for the threshold of a manual instance */
function positionHash(x: number, z: number) {
  const f = new Float32Array([x, z]);
  const u = new Uint32Array(f.buffer);
  let h = Math.imul(u[0] ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(u[1] ^ 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

type FoliageChunk = {
  layer: FoliageLayer;
  key: string;
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

/** A region of the plane of a foliage system, `[minX, minZ, maxX, maxZ]` */
export type FoliageRegion = [number, number, number, number];

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
 * Changing the instances of an area rebuilds only the chunks it overlaps.
 *
 * Positions are in the space of the foliage system, which is meant to be translated only.
 * @public
 */
export class FoliageSystem extends GraphNode {
  private _layers: FoliageLayer[];
  private _chunkSize: number;
  private _maskCellSize: number;
  private _chunks: Map<FoliageLayer, Map<string, FoliageChunk>>;
  private _dirty: boolean;
  private _dirtyChunks: Map<FoliageLayer, Set<string>>;
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
    this._maskCellSize = 1;
    this._chunks = new Map();
    this._dirty = false;
    this._dirtyChunks = new Map();
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
      for (const layer of this._layers) {
        layer._generated.setChunkSize(val);
        layer._manual.setChunkSize(val);
      }
      this.invalidate();
    }
  }
  /**
   * Edge of a cell of the density masks of the layers, in meters. Default 1. Changing it keeps
   * the cell values, so what was painted scales with it; regenerate the layers afterwards.
   */
  get maskCellSize() {
    return this._maskCellSize;
  }
  set maskCellSize(val: number) {
    val = Math.max(0.05, val);
    if (val !== this._maskCellSize) {
      this._maskCellSize = val;
      for (const layer of this._layers) {
        layer._mask.cellSize = val;
      }
    }
  }
  /** Number of layers */
  get numLayers() {
    return this._layers.length;
  }
  /** Total number of instances of all layers */
  get numInstances() {
    return this._layers.reduce((sum, layer) => sum + layer.count, 0);
  }
  /**
   * Gets a layer
   * @param index - Layer index
   */
  getLayer(index: number): Nullable<FoliageLayer> {
    return this._layers[index] ?? null;
  }
  /**
   * Index of a layer of this system
   * @param layer - The layer
   * @returns Its index, or -1
   */
  indexOfLayer(layer: FoliageLayer) {
    return this._layers.indexOf(layer);
  }
  /**
   * Adds a layer scattering a prefab (.zprefab) or a model asset
   * @param asset - Path of the asset
   * @param settings - Layer settings
   * @returns Index of the new layer
   */
  addLayer(asset: string, settings?: FoliageLayerSettings) {
    return this.insertLayer(new FoliageLayer(asset, settings));
  }
  /**
   * Inserts a layer, which is moved out of the foliage system it belongs to
   * @param layer - The layer
   * @param index - Position to insert at; appended when omitted
   * @returns Index of the layer
   */
  insertLayer(layer: FoliageLayer, index?: number) {
    if (layer._owner) {
      layer._owner.detachLayer(layer);
    }
    const at = Math.max(0, Math.min(index ?? this._layers.length, this._layers.length));
    this._layers.splice(at, 0, layer);
    this.adoptLayer(layer);
    this.invalidate();
    return at;
  }
  /**
   * Removes a layer and its instances
   * @param index - Layer index
   */
  removeLayer(index: number) {
    const layer = this._layers[index];
    if (layer) {
      this.detachLayer(layer);
      layer._dispose();
    }
  }
  /**
   * Removes every layer
   */
  clearLayers() {
    for (const layer of this._layers) {
      layer._owner = null;
      layer._dispose();
    }
    this._layers = [];
    this.invalidate();
  }
  /**
   * Replaces the layer list. Layers already in the system keep their loaded assets, layers
   * left out are disposed, and layers of another system are moved here.
   * @param layers - The new layers, in order
   */
  setLayers(layers: FoliageLayer[]) {
    const next = layers.filter((layer, i) => layers.indexOf(layer) === i);
    for (const layer of this._layers) {
      if (!next.includes(layer)) {
        layer._owner = null;
        layer._dispose();
      }
    }
    for (const layer of next) {
      if (layer._owner && layer._owner !== this) {
        layer._owner.detachLayer(layer);
      }
      this.adoptLayer(layer);
    }
    this._layers = next;
    this.invalidate();
  }
  /** Makes a layer use this system's chunk and mask cell sizes */
  private adoptLayer(layer: FoliageLayer) {
    layer._owner = this;
    layer._generated.setChunkSize(this._chunkSize);
    layer._manual.setChunkSize(this._chunkSize);
    layer._mask.cellSize = this._maskCellSize;
  }
  /** Takes a layer out of the list, keeping its instances */
  private detachLayer(layer: FoliageLayer) {
    const index = this._layers.indexOf(layer);
    if (index >= 0) {
      this._layers.splice(index, 1);
      layer._owner = null;
      this.invalidate();
    }
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
    if (settings.asset !== undefined) {
      layer.asset = settings.asset;
    }
    layer._castShadow = settings.castShadow ?? layer._castShadow;
    layer._cullDistance = settings.cullDistance ?? layer._cullDistance;
    layer._alignToNormal = settings.alignToNormal ?? layer._alignToNormal;
    if (settings.collision !== undefined) {
      layer._collision = copyCollision(settings.collision);
    }
    if (settings.generation) {
      layer._generation = mergeGeneration(layer._generation, settings.generation);
    }
    this.invalidate();
  }
  /**
   * Replaces the instances of a layer of one group
   * @param index - Layer index
   * @param data - {@link FOLIAGE_INSTANCE_STRIDE} floats per instance, see {@link FoliageLayer.getInstances}
   * @param group - Which instances to replace. Default 'manual'; 'all' empties the generated
   * group and puts the instances in the manual one.
   */
  setInstances(index: number, data: ArrayLike<number>, group: FoliageInstanceGroup = 'manual') {
    const layer = this._layers[index];
    if (!layer) {
      return;
    }
    const touched = new Set<string>();
    if (group === 'generated') {
      for (const key of layer._generated.clear()) {
        touched.add(key);
      }
      layer._generated.add(data, touched);
    } else {
      if (group === 'all') {
        for (const key of layer._generated.clear()) {
          touched.add(key);
        }
      }
      for (const key of layer._manual.clear()) {
        touched.add(key);
      }
      layer._manual.add(data, touched);
    }
    this.invalidateChunks(layer, touched);
  }
  /**
   * Appends instances to a layer
   * @param index - Layer index
   * @param data - {@link FOLIAGE_INSTANCE_STRIDE} floats per instance, see {@link FoliageLayer.getInstances}
   * @param group - Which group receives them. Default 'manual'.
   */
  addInstances(index: number, data: ArrayLike<number>, group: 'generated' | 'manual' = 'manual') {
    const layer = this._layers[index];
    if (!layer) {
      return;
    }
    const touched = new Set<string>();
    (group === 'generated' ? layer._generated : layer._manual).add(data, touched);
    this.invalidateChunks(layer, touched);
  }
  /**
   * Replaces the generated instances of a layer standing within a region
   *
   * @remarks
   * Used by the foliage generator: the region is aligned with the candidate grid, so the
   * instances removed and the ones added are of the same candidates.
   * @param index - Layer index
   * @param region - `[minX, minZ, maxX, maxZ]`, local; instances with minX ≤ x < maxX and
   * minZ ≤ z < maxZ are replaced
   * @param data - The new instances of the region
   */
  replaceGeneratedInRegion(index: number, region: Readonly<FoliageRegion>, data: ArrayLike<number>) {
    const layer = this._layers[index];
    if (!layer) {
      return;
    }
    const touched = new Set<string>();
    layer._generated.removeWhere(
      region,
      (d, o) => d[o] >= region[0] && d[o] < region[2] && d[o + 1] >= region[1] && d[o + 1] < region[3],
      touched
    );
    layer._generated.add(data, touched);
    this.invalidateChunks(layer, touched);
  }
  /**
   * Changes the density mask of a layer within a circle; the generated instances are not
   * regenerated, see {@link FoliageLayer.mask}
   * @param index - Layer index
   * @param x - Circle centre x, local
   * @param z - Circle centre z, local
   * @param radius - Circle radius
   * @param amount - Change at full weight, -1 to 1; negative erases
   * @param falloff - Fraction of the radius over which the brush weight falls to 0
   * @returns The changed region, or null
   */
  paintMask(index: number, x: number, z: number, radius: number, amount: number, falloff = 0.5) {
    return this._layers[index]?._mask.paintCircle(x, z, radius, amount, falloff) ?? null;
  }
  /**
   * Moves the density mask of a layer within a circle towards a density; the generated
   * instances are not regenerated, see {@link FoliageLayer.mask}
   * @param index - Layer index
   * @param x - Circle centre x, local
   * @param z - Circle centre z, local
   * @param radius - Circle radius
   * @param density - Density inside the circle, 0 to 1
   * @param falloff - Fraction of the radius over which it blends into what is around
   * @returns The changed region, or null
   */
  fillMaskCircle(index: number, x: number, z: number, radius: number, density: number, falloff = 0.5) {
    return this._layers[index]?._mask.blendCircle(x, z, radius, density, falloff) ?? null;
  }
  /**
   * Erases manual instances within a circle, by brush weight: an instance goes where the weight
   * of the brush there is above a value derived from its position, so a soft brush thins them
   * out towards its edge, the same way every time
   * @param index - Layer index
   * @param x - Circle centre x, local
   * @param z - Circle centre z, local
   * @param radius - Circle radius
   * @param strength - Weight at the centre, 0 to 1
   * @param weight - Brush weight from the distance over the radius
   * @returns Number of instances removed
   */
  eraseManualInstances(
    index: number,
    x: number,
    z: number,
    radius: number,
    strength: number,
    weight: (t: number) => number
  ) {
    const layer = this._layers[index];
    if (!layer || !(radius > 0) || !(strength > 0)) {
      return 0;
    }
    const touched = new Set<string>();
    const removed = layer._manual.removeWhere(
      [x - radius, z - radius, x + radius, z + radius],
      (d, o) => {
        const t = Math.hypot(d[o] - x, d[o + 1] - z) / radius;
        return t < 1 && strength * weight(t) > positionHash(d[o], d[o + 1]);
      },
      touched
    );
    this.invalidateChunks(layer, touched);
    return removed;
  }
  /**
   * Removes the instances standing within a circle
   *
   * @remarks
   * Generated instances are removed by clearing the density mask under the circle, so
   * regenerating the layer does not bring them back.
   * @param x - Circle centre x, local to the foliage system
   * @param z - Circle centre z, local to the foliage system
   * @param radius - Circle radius
   * @param index - Layer index, or -1 for every layer
   * @param group - Which instances. Default 'all'.
   * @returns Number of instances removed
   */
  removeInstancesInCircle(
    x: number,
    z: number,
    radius: number,
    index = -1,
    group: FoliageInstanceGroup = 'all'
  ) {
    let removed = 0;
    const r2 = radius * radius;
    const region: FoliageRegion = [x - radius, z - radius, x + radius, z + radius];
    const inside = (d: Float32Array, o: number) => {
      const dx = d[o] - x;
      const dz = d[o + 1] - z;
      return dx * dx + dz * dz <= r2;
    };
    this._layers.forEach((layer, i) => {
      if (index >= 0 && i !== index) {
        return;
      }
      const touched = new Set<string>();
      if (group !== 'generated') {
        removed += layer._manual.removeWhere(region, inside, touched);
      }
      if (group !== 'manual') {
        layer._mask.fillCircle(x, z, radius, 0);
        removed += layer._generated.removeWhere(region, inside, touched);
      }
      this.invalidateChunks(layer, touched);
    });
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
   * Schedules every chunk to be rebuilt; called by the methods changing layers
   */
  invalidate() {
    this._dirty = true;
    // Also called while the base constructor attaches the node, before the fields exist
    this._dirtyChunks?.clear();
    this.scene?.queuePerCameraUpdateNode(this);
  }
  /** Schedules some chunks of a layer to be rebuilt */
  private invalidateChunks(layer: FoliageLayer, keys: Iterable<string>) {
    if (this._dirty) {
      return;
    }
    let set = this._dirtyChunks.get(layer);
    for (const key of keys) {
      if (!set) {
        set = new Set();
        this._dirtyChunks.set(layer, set);
      }
      set.add(key);
    }
    if (set) {
      this.scene?.queuePerCameraUpdateNode(this);
    }
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
      this._dirtyChunks.clear();
      this.rebuild();
    } else if (this._dirtyChunks.size > 0) {
      this.rebuildChunks();
    }
    const eye = camera.getWorldPosition();
    const ox = this.worldMatrix.m03;
    const oz = this.worldMatrix.m23;
    const ex = eye.x - ox;
    const ez = eye.z - oz;
    for (const chunks of this._chunks.values()) {
      for (const chunk of chunks.values()) {
        const dx = Math.max(chunk.minX - ex, 0, ex - chunk.maxX);
        const dz = Math.max(chunk.minZ - ez, 0, ez - chunk.maxZ);
        const visible = dx * dx + dz * dz <= chunk.layer._cullDistance * chunk.layer._cullDistance;
        if (visible !== chunk.visible) {
          chunk.visible = visible;
          chunk.group.showState = visible ? 'inherit' : 'hidden';
        }
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
        for (const key of new Set([...layer._generated.keys(), ...layer._manual.keys()])) {
          this.buildChunk(layer, key, terrain);
        }
      }
    });
  }
  /** Rebuilds the chunks marked dirty, once every layer is loaded */
  private rebuildChunks() {
    if (this._layers.some((layer) => !layer._parts)) {
      // A layer still loading: its full rebuild picks the changes up
      this._dirty = true;
      return;
    }
    const terrain = this._builtTerrain;
    for (const [layer, keys] of this._dirtyChunks) {
      if (!this._layers.includes(layer)) {
        continue;
      }
      for (const key of keys) {
        this.disposeChunk(layer, key);
        this.buildChunk(layer, key, terrain);
      }
    }
    this._dirtyChunks.clear();
  }
  private clearChunks() {
    for (const chunks of this._chunks.values()) {
      for (const chunk of chunks.values()) {
        chunk.group.remove();
        chunk.group.dispose();
        chunk.colliders?.dispose();
      }
    }
    this._chunks.clear();
  }
  private disposeChunk(layer: FoliageLayer, key: string) {
    const chunks = this._chunks.get(layer);
    const chunk = chunks?.get(key);
    if (chunk) {
      chunk.group.remove();
      chunk.group.dispose();
      chunk.colliders?.dispose();
      chunks!.delete(key);
    }
  }
  private loadLayer(layer: FoliageLayer) {
    if (!layer._asset) {
      // A layer just added in the editor, nothing to draw until an asset is picked
      layer._parts = [];
      return Promise.resolve();
    }
    if (!layer._loading) {
      const asset = layer._asset;
      layer._loading = (async () => {
        const scene = this.scene!;
        const tmp = new SceneNode(scene);
        tmp.remove();
        let root: Nullable<SceneNode> = null;
        try {
          const manager = getEngine().resourceManager;
          root = asset.toLowerCase().endsWith('.zprefab')
            ? await manager.instantiatePrefab(tmp, asset)
            : ((await manager.fetchModel(asset, scene)) ?? null);
          if (root) {
            root.parent = tmp;
            root.position.setXYZ(0, 0, 0);
            root.rotation.identity();
            root.scale.setXYZ(1, 1, 1);
          }
        } catch (err) {
          console.error(`Foliage: cannot load ${asset}: ${err}`);
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
              console.warn(`Foliage: ${c.shape} colliders of ${asset} are skipped`);
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
              console.warn(`Foliage: skinned and morphed meshes of ${asset} are skipped`);
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
        if (layer._asset !== asset) {
          // The asset changed while loading: the meshes are of the old one
          for (const part of parts) {
            part.primitive.dispose();
            part.material.dispose();
          }
          return;
        }
        if (parts.length === 0) {
          console.error(`Foliage: ${asset} has no mesh to scatter`);
        }
        layer._parts = parts;
        layer._bounds = bounds;
        layer._assetColliders = colliders;
        layer._loading = null;
      })();
    }
    return layer._loading;
  }
  /** Builds the batch group and colliders of one chunk of a layer, from both instance groups */
  private buildChunk(layer: FoliageLayer, key: string, terrain: Nullable<ClipmapTerrain>) {
    const parts = layer._parts;
    if (!parts || parts.length === 0) {
      return;
    }
    const sources = [layer._manual.get(key), layer._generated.get(key)].filter(
      (d): d is Float32Array => !!d && d.length > 0
    );
    if (sources.length === 0) {
      return;
    }
    const size = this._chunkSize;
    const [cx, cz] = key.split(',').map(Number);
    const ox = this.worldMatrix.m03;
    const oy = this.worldMatrix.m13;
    const oz = this.worldMatrix.m23;
    const templates = layer._colliderTemplates();
    // Painted instances on any surface store their height; the others stand on the terrain
    const onTerrain = (generated: boolean) => !generated || layer._generation.surface === 'terrain';
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
    const manual = layer._manual.get(key);
    for (const d of sources) {
      const followTerrain = onTerrain(d !== manual);
      for (let o = 0; o < d.length; o += FOLIAGE_INSTANCE_STRIDE) {
        const x = d[o];
        const z = d[o + 1];
        let y = d[o + 2];
        let upright = true;
        if (terrain && followTerrain) {
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
          // Chunks are built in updatePerCamera, after the frame update that refreshes the
          // matrices meshes draw with; without this the group draws them where they were created
          mesh.syncDrawableTransform();
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
    }
    let chunks = this._chunks.get(layer);
    if (!chunks) {
      chunks = new Map();
      this._chunks.set(layer, chunks);
    }
    chunks.set(key, {
      layer,
      key,
      group,
      colliders,
      minX: cx * size,
      minZ: cz * size,
      maxX: (cx + 1) * size,
      maxZ: (cz + 1) * size,
      visible: true
    });
  }
  /**
   * The chunk nodes built for this system, to tell them apart from other scene nodes
   * (e.g. to skip the foliage's own colliders when looking for the ground)
   * @param node - A scene node
   * @returns Whether the node is, or is below, a chunk of this system
   */
  ownsNode(node: Nullable<SceneNode>) {
    while (node && node !== this) {
      if (node.parent === this && node.sealed) {
        return true;
      }
      node = node.parent;
    }
    return false;
  }
  /** {@inheritDoc SceneNode.onDispose} */
  protected onDispose() {
    this._buildSerial++;
    this.clearChunks();
    for (const layer of this._layers) {
      layer._owner = null;
      layer._dispose();
    }
    this._layers = [];
    super.onDispose();
  }
}
