import { Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';
import type { PhysicsContactInfo } from './types';
import type { NodePhysics } from './node_physics';
import type { Collider } from './collider';

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
  private _resolve: (() => PhysicsContactInfo | null) | null;
  private _info: PhysicsContactInfo | null;
  private readonly _flip: boolean;
  constructor(
    /** The other physics object: the physics data of its node. */
    readonly other: NodePhysics,
    /** One of this object's colliders that touches the other object. */
    readonly collider: Collider,
    /** The other object's collider it touches. */
    readonly otherCollider: Collider,
    resolve: (() => PhysicsContactInfo | null) | null,
    flip: boolean
  ) {
    this._resolve = resolve;
    this._info = null;
    this._flip = flip;
  }
  /** The other object's node. */
  get otherNode(): SceneNode | null {
    return this.other.node;
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
  /** Ends the time contact details can be read. */
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
  constructor(
    /** The other object: the trigger, or what entered it. */
    readonly other: NodePhysics,
    /** This object's collider involved. */
    readonly collider: Collider,
    /** The other object's collider involved. */
    readonly otherCollider: Collider
  ) {}
  /** The other object's node. */
  get otherNode(): SceneNode | null {
    return this.other.node;
  }
}
