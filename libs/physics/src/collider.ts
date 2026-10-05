import { Vector3 } from '@zephyr3d/base';
import { PhysicsComponent } from './component';
import type { PhysicsWorld } from './world';

/**
 * Basic collision shapes, defined in the node's local space.
 *
 * - `box`: {@link Collider.size} is the full extent along each axis.
 * - `sphere`: {@link Collider.radius}.
 * - `capsule`: a cylinder with hemispherical ends, along the node's Y axis;
 *   {@link Collider.height} is the total height, ends included.
 * - `cylinder`: along the node's Y axis, {@link Collider.height} tall.
 *
 * @public
 */
export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder';

/**
 * A collision shape on its node.
 *
 * @remarks
 * Belongs to the nearest {@link RigidBody} on its node or an ancestor. Without
 * one it is a static obstacle - a floor, a wall - that never moves on its own
 * but follows its node if the node is moved.
 *
 * Sizes are in the node's local units and scale with the node's world scale. A
 * sphere scales by the largest axis, and capsules and cylinders by the larger
 * of X and Z for their radius.
 *
 * @public
 */
export class Collider extends PhysicsComponent {
  private _shape: ColliderShape;
  private readonly _size: Vector3;
  private _radius: number;
  private _height: number;
  private readonly _offset: Vector3;
  private _friction: number;
  private _restitution: number;
  private _isTrigger: boolean;

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
