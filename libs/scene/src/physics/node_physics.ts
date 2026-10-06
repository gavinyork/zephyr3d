import { Disposable, makeObservable } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';
import type { PhysicsPart } from './part';
import type { PhysicsEventMap } from './types';
import type { RigidBody } from './rigid_body';
import type { Collider } from './collider';
import type { Joint } from './joint';
import type { CharacterController } from './character';
import type { Vehicle, Wheel } from './vehicle';

let nextObjectId = 1;

/**
 * The physics data of a scene node: {@link SceneNode.physics}.
 *
 * @remarks
 * Plain data until the node is in a scene with a {@link PhysicsWorld}, which
 * then simulates it; without one it is kept, saved and loaded as is.
 *
 * - {@link NodePhysics.body}: a {@link RigidBody}, or a {@link CharacterController}.
 * - {@link NodePhysics.colliders}: collision shapes. They belong to the nearest
 *   rigid body on this node or above it; with none, they are static.
 * - {@link NodePhysics.joint}: links the nearest rigid body to another one.
 * - {@link NodePhysics.vehicle}: drives the node's dynamic rigid body as a vehicle.
 * - {@link NodePhysics.wheel}: a wheel of the vehicle above.
 *
 * Collision and trigger events are raised on the physics data of the node that
 * has the rigid body or character, or of a node with static colliders; see
 * {@link PhysicsEventMap}.
 *
 * @public
 */
export class NodePhysics extends makeObservable(Disposable)<PhysicsEventMap>() {
  /** Identifies the object in pair bookkeeping, in creation order. */
  readonly _physicsId: number;
  private _node: Nullable<SceneNode>;
  private _body: Nullable<RigidBody | CharacterController>;
  private _colliders: Collider[];
  private _joint: Nullable<Joint>;
  private _vehicle: Nullable<Vehicle>;
  private _wheel: Nullable<Wheel>;
  constructor() {
    super();
    this._physicsId = nextObjectId++;
    this._node = null;
    this._body = null;
    this._colliders = [];
    this._joint = null;
    this._vehicle = null;
    this._wheel = null;
  }
  /** The node this data is on. */
  get node(): Nullable<SceneNode> {
    return this._node;
  }
  /** The node's rigid body or character controller, or null. */
  get body(): Nullable<RigidBody | CharacterController> {
    return this._body;
  }
  set body(value: Nullable<RigidBody | CharacterController>) {
    const current = this._body;
    if (current !== value) {
      this._check(value);
      this._body = value ?? null;
      current?._setOwner(null);
      value?._setOwner(this);
    }
  }
  /** The node's collision shapes. */
  get colliders(): readonly Collider[] {
    return this._colliders;
  }
  set colliders(value: readonly Collider[]) {
    const next = [...new Set(value ?? [])];
    next.forEach((c) => this._check(c));
    for (const c of this._colliders) {
      if (!next.includes(c)) {
        c._setOwner(null);
      }
    }
    const added = next.filter((c) => !this._colliders.includes(c));
    this._colliders = next;
    for (const c of added) {
      c._setOwner(this);
    }
  }
  /** Adds a collision shape. */
  addCollider(collider: Collider) {
    if (!this._colliders.includes(collider)) {
      this.colliders = [...this._colliders, collider];
    }
    return collider;
  }
  /** Removes a collision shape; returns false if it was not on this node. */
  removeCollider(collider: Collider) {
    if (!this._colliders.includes(collider)) {
      return false;
    }
    this.colliders = this._colliders.filter((c) => c !== collider);
    return true;
  }
  /** The node's joint, or null. */
  get joint(): Nullable<Joint> {
    return this._joint;
  }
  set joint(value: Nullable<Joint>) {
    const current = this._joint;
    if (current !== value) {
      this._check(value);
      this._joint = value ?? null;
      current?._setOwner(null);
      value?._setOwner(this);
    }
  }
  /** Drives the node's dynamic rigid body as a vehicle, or null. */
  get vehicle(): Nullable<Vehicle> {
    return this._vehicle;
  }
  set vehicle(value: Nullable<Vehicle>) {
    const current = this._vehicle;
    if (current !== value) {
      this._check(value);
      this._vehicle = value ?? null;
      current?._setOwner(null);
      value?._setOwner(this);
    }
  }
  /** Makes the node a wheel of the vehicle above it, or null. */
  get wheel(): Nullable<Wheel> {
    return this._wheel;
  }
  set wheel(value: Nullable<Wheel>) {
    const current = this._wheel;
    if (current !== value) {
      this._check(value);
      this._wheel = value ?? null;
      current?._setOwner(null);
      value?._setOwner(this);
    }
  }
  /** Every part, in a fixed order: body, colliders, joint, vehicle, wheel. */
  get parts(): PhysicsPart[] {
    const parts: PhysicsPart[] = [];
    if (this._body) {
      parts.push(this._body);
    }
    parts.push(...this._colliders);
    for (const p of [this._joint, this._vehicle, this._wheel]) {
      if (p) {
        parts.push(p);
      }
    }
    return parts;
  }
  /** Whether anything listens to an event, to skip computing it otherwise. */
  _hasListeners(type: keyof PhysicsEventMap) {
    return !!this._listeners?.[type]?.some((l) => !l.removed);
  }
  /** Puts the data on a node, or takes it off with null. Called by {@link SceneNode.physics}. */
  _setNode(node: Nullable<SceneNode>) {
    if (node === this._node) {
      return;
    }
    if (node && this._node) {
      throw new Error('Physics data already belongs to another node.');
    }
    if (!node) {
      for (const part of this.parts) {
        part._leaveWorld();
      }
    }
    this._node = node;
    if (node) {
      for (const part of this.parts) {
        part._enterWorld();
      }
    }
  }
  /** The node entered a scene. */
  _hostAttached() {
    for (const part of this.parts) {
      part._enterWorld();
    }
  }
  /** The node left its scene. */
  _hostDetached() {
    for (const part of this.parts) {
      part._leaveWorld();
    }
  }
  private _check(part: Nullable<PhysicsPart>) {
    if (part?.owner && part.owner !== this) {
      throw new Error('Physics data already belongs to another node.');
    }
  }
  protected onDispose() {
    super.onDispose();
    for (const part of this.parts) {
      part.dispose();
    }
    this._colliders = [];
    this._body = null;
    this._joint = null;
    this._vehicle = null;
    this._wheel = null;
  }
}
