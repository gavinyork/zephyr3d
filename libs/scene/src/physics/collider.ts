import { Vector3 } from '@zephyr3d/base';
import { PhysicsPart } from './part';
import type { PhysicsWorld } from './world';

/**
 * Basic collision shapes, defined in the node's local space.
 *
 * - `box`: {@link Collider.size} is the full extent along each axis.
 * - `sphere`: {@link Collider.radius}.
 * - `capsule`: a cylinder with hemispherical ends, along the node's Y axis;
 *   {@link Collider.height} is the total height, ends included.
 * - `cylinder`: along the node's Y axis, {@link Collider.height} tall.
 * - `mesh`: the triangles of the node's mesh, exactly. For floors, buildings
 *   and other things that do not move on their own: on a dynamic rigid body it
 *   has no volume, so it gets pushed into things; use `convex` there.
 * - `convex`: the convex hull of the node's mesh - the shape of the mesh
 *   shrink-wrapped, hollows filled in. For dynamic objects: rocks, props.
 * - `terrain`: the heights of the node's terrain. Static only.
 *
 * `mesh` and `convex` read the mesh back from the GPU, so they come into effect
 * a few frames later (see {@link Collider.ready}), unless given their triangles
 * with {@link Collider.setMeshData}.
 *
 * @public
 */
export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' | 'convex' | 'terrain';

/**
 * A collision shape on its node.
 *
 * @remarks
 * Belongs to the nearest {@link RigidBody} on its node or an ancestor. Without
 * one it is a static obstacle - a floor, a wall - that never moves on its own
 * but follows its node if the node is moved.
 *
 * Collision and trigger events are raised on the rigid body it belongs to, or
 * on the collider itself when it has none; see {@link PhysicsEventMap}.
 *
 * Sizes are in the node's local units and scale with the node's world scale. A
 * sphere scales by the largest axis, and capsules and cylinders by the larger
 * of X and Z for their radius; `mesh` and `convex` scale exactly, along each
 * axis.
 *
 * @public
 */
export class Collider extends PhysicsPart {
  private _shape: ColliderShape;
  private readonly _size: Vector3;
  private _radius: number;
  private _height: number;
  private readonly _offset: Vector3;
  private _friction: number;
  private _restitution: number;
  private _isTrigger: boolean;
  private _layer: number;
  private _meshLod: number;
  private _terrainResolution: number;
  _meshData: { positions: Float32Array; indices: Uint32Array } | null;
  /** The geometry last built from, for shapes that need it. */
  _geometry: unknown;
  private _ready: boolean;
  private _error: string;
  /** Warned that a mesh collider is on a dynamic body. */
  _warnedDynamicMesh: boolean;

  constructor() {
    super();
    this._shape = 'box';
    this._size = new Vector3(1, 1, 1);
    this._radius = 0.5;
    this._height = 2;
    this._offset = new Vector3();
    this._friction = 0.5;
    this._restitution = 0;
    this._isTrigger = false;
    this._layer = 0;
    this._meshLod = 0;
    this._terrainResolution = 1;
    this._meshData = null;
    this._geometry = null;
    this._ready = false;
    this._error = '';
    this._warnedDynamicMesh = false;
  }

  /** The shape. Default `'box'`. */
  get shape() {
    return this._shape;
  }
  set shape(value: ColliderShape) {
    this._shape = value;
    this._changed();
  }
  /** Full size of a box. Default (1, 1, 1). */
  get size(): Vector3 {
    return this._size;
  }
  set size(value: Vector3) {
    this._size.set(value);
    this._changed();
  }
  /** Radius of a sphere, capsule or cylinder. Default 0.5. */
  get radius() {
    return this._radius;
  }
  set radius(value: number) {
    this._radius = Math.max(0, value);
    this._changed();
  }
  /** Total height of a capsule or cylinder. Default 2. */
  get height() {
    return this._height;
  }
  set height(value: number) {
    this._height = Math.max(0, value);
    this._changed();
  }
  /** Position of the shape's centre in the node's local space. Default (0, 0, 0). */
  get offset(): Vector3 {
    return this._offset;
  }
  set offset(value: Vector3) {
    this._offset.set(value);
    this._changed();
  }
  /** How strongly surfaces resist sliding, usually 0 to 1. Default 0.5. */
  get friction() {
    return this._friction;
  }
  set friction(value: number) {
    this._friction = Math.max(0, value);
    this._changed();
  }
  /** Bounciness, from 0 (no bounce) to 1 (keeps all its speed). Default 0. */
  get restitution() {
    return this._restitution;
  }
  set restitution(value: number) {
    this._restitution = Math.max(0, value);
    this._changed();
  }
  /** A trigger detects overlaps but does not push anything. Default false. */
  get isTrigger() {
    return this._isTrigger;
  }
  set isTrigger(value: boolean) {
    this._isTrigger = !!value;
    this._changed();
  }

  /**
   * Collision layer, 0 to 15. Which layers collide with each other is set on
   * the world ({@link PhysicsWorld.setLayerCollision}); queries can be limited
   * to some layers. Default 0.
   */
  get layer() {
    return this._layer;
  }
  set layer(value: number) {
    const layer = Math.min(15, Math.max(0, Math.floor(value)));
    if (layer !== this._layer) {
      this._layer = layer;
      this.world?._updateColliderGroups(this);
    }
  }

  /**
   * Which level of detail of the mesh a `mesh` or `convex` collider is made
   * from; 0 is full detail. A level past the mesh's lowest detail uses the
   * lowest. Default 0.
   */
  get meshLod() {
    return this._meshLod;
  }
  set meshLod(value: number) {
    const lod = Math.max(0, Math.floor(value));
    if (lod !== this._meshLod) {
      this._meshLod = lod;
      this._changed();
    }
  }
  /**
   * Spacing of a `terrain` collider's height samples, in height map texels: 1
   * uses every texel, 2 every other one, and so on. Coarser is cheaper and
   * smaller but follows the ground less closely. Default 1.
   */
  get terrainResolution() {
    return this._terrainResolution;
  }
  set terrainResolution(value: number) {
    const resolution = Math.max(1, Math.floor(value));
    if (resolution !== this._terrainResolution) {
      this._terrainResolution = resolution;
      this._changed();
    }
  }
  /**
   * Gives a `mesh` or `convex` collider its triangles directly instead of
   * reading them from the node's mesh, so it takes effect right away.
   *
   * @remarks
   * For generated geometry, or collision geometry prepared in advance. Not
   * saved with the scene.
   *
   * @param positions - Vertex positions in the node's local space, xyz each.
   * @param indices - Three vertex indices per triangle. A `convex` collider
   *   only uses the positions and may leave this out.
   */
  setMeshData(positions: Float32Array, indices?: Uint32Array) {
    this._meshData = { positions, indices: indices ?? new Uint32Array(0) };
    this._changed();
  }
  /** Goes back to reading the triangles from the node's mesh. */
  clearMeshData() {
    if (this._meshData) {
      this._meshData = null;
      this._changed();
    }
  }
  /**
   * Whether the collider is in the simulation. Basic shapes are as soon as
   * their node is in a scene that is simulating; `mesh`, `convex` and `terrain`
   * may have to wait for their geometry. Raises `ready` when it becomes true.
   */
  get ready() {
    return this._ready;
  }
  /** Why the collider could not be built, or an empty string. */
  get error() {
    return this._error;
  }

  _setStatus(ready: boolean, error = '') {
    const becameReady = ready && !this._ready;
    this._ready = ready;
    this._error = error;
    if (becameReady) {
      this.dispatchEvent('ready');
    }
  }
  private _changed() {
    this.world?._markColliderDirty(this);
  }
  protected _join(world: PhysicsWorld) {
    world._registerCollider(this);
  }
  protected _leave(world: PhysicsWorld) {
    world._unregisterCollider(this);
  }
}
