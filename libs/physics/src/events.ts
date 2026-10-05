import { Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '@zephyr3d/scene';
import type { ContactInfo } from './backend/types';
import type { RigidBody } from './rigid_body';
import type { Collider } from './collider';

/**
 * A rigid body, or a collider that has no rigid body above it: what physics
 * events are raised on and refer to.
 *
 * @public
 */
export type PhysicsObject = RigidBody | Collider;

/**
 * Passed with `collisionenter`, `collisionstay` and `collisionexit`.
 *
 * @remarks
 * Contact details are worked out only when read, and only while the handler
 * runs; read them there rather than keeping the event. On `collisionexit` the
 * objects no longer touch, so there are none.
 *
 * @public
 */
export class PhysicsContactEvent {
  private _resolve: (() => ContactInfo | null) | null;
  private _info: ContactInfo | null;
  private readonly _flip: boolean;
  /** @internal */
  constructor(
    /** The other object. */
    readonly other: PhysicsObject,
    /** One of this object's colliders that touches the other object. */
    readonly collider: Collider,
    /** The other object's collider it touches. */
    readonly otherCollider: Collider,
    resolve: (() => ContactInfo | null) | null,
    flip: boolean
  ) {
    this._resolve = resolve;
    this._info = null;
    this._flip = flip;
  }
  /** The other object's node. */
  get otherNode(): SceneNode | null {
    return this.other.host;
  }
  /**
   * Direction of the contact in world space, pointing from this object towards
   * the other. Zero when there is no contact to report.
   */
  get normal(): Vector3 {
    return this._get()?.normal ?? Vector3.zero();
  }
  /** Contact points in world space, between the two colliders. */
  get contacts(): Vector3[] {
    return this._get()?.points ?? [];
  }
  /**
   * How hard the two pressed against each other during the last simulation
   * step, in N·s; large for an impact, small for resting contact.
   */
  get impulse(): number {
    return this._get()?.impulse ?? 0;
  }
  /** Ends the time contact details can be read. @internal */
  _expire() {
    this._resolve = null;
  }
  private _get() {
    if (!this._info && this._resolve) {
      const info = this._resolve();
      if (info && this._flip) {
        info.normal.scaleBy(-1);
      }
      this._info = info;
      this._resolve = null;
    }
    return this._info;
  }
}

/**
 * Passed with `triggerenter` and `triggerexit`.
 *
 * @public
 */
export class PhysicsTriggerEvent {
  /** @internal */
  constructor(
    /** The other object: the trigger, or what entered it. */
    readonly other: PhysicsObject,
    /** This object's collider involved. */
    readonly collider: Collider,
    /** The other object's collider involved. */
    readonly otherCollider: Collider
  ) {}
  /** The other object's node. */
  get otherNode(): SceneNode | null {
    return this.other.host;
  }
}
