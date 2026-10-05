import { Disposable, makeObservable, type Nullable } from '@zephyr3d/base';
import type { SceneNode, SceneNodeComponent } from '@zephyr3d/scene';
import type { PhysicsContactEvent, PhysicsTriggerEvent } from './events';
import { PhysicsWorld } from './world';

/**
 * Events of a physics object: a {@link RigidBody}, or a {@link Collider} with no
 * rigid body above it.
 *
 * @remarks
 * Raised once per pair of objects, however many of their colliders touch, and
 * dispatched after the frame's simulation steps, when nodes are already in
 * their new places. Changing physics components from a handler takes effect in
 * the next frame.
 *
 * - `collisionenter` / `collisionexit`: two solid objects start or stop touching.
 * - `collisionstay`: every frame while they keep touching.
 * - `triggerenter` / `triggerexit`: an object enters or leaves a trigger. Both
 *   the trigger and the object receive it.
 *
 * Objects resting asleep keep touching and raise no `collisionexit`.
 *
 * @public
 */
export type PhysicsEventMap = {
  collisionenter: [event: PhysicsContactEvent];
  collisionstay: [event: PhysicsContactEvent];
  collisionexit: [event: PhysicsContactEvent];
  triggerenter: [event: PhysicsTriggerEvent];
  triggerexit: [event: PhysicsTriggerEvent];
};

let nextPhysicsId = 1;

/**
 * Common lifecycle of the physics components: joins the scene's
 * {@link PhysicsWorld} while the host node is in a scene, leaves it otherwise.
 *
 * @public
 */
export abstract class PhysicsComponent
  extends makeObservable(Disposable)<PhysicsEventMap>()
  implements SceneNodeComponent
{
  /** Identifies the component in pair bookkeeping, in creation order. @internal */
  readonly _physicsId: number;
  private _host: Nullable<SceneNode>;
  private _world: Nullable<PhysicsWorld>;
  constructor() {
    super();
    this._physicsId = nextPhysicsId++;
    this._host = null;
    this._world = null;
  }
  /** The node this component is attached to. */
  get host() {
    return this._host;
  }
  /** The world this component is part of, while its node is in a scene. */
  get world() {
    return this._world;
  }
  /** See {@link SceneNodeComponent}. */
  attach(host: SceneNode) {
    if (this._host === host) {
      return;
    }
    if (this._host) {
      throw new Error('Physics component is already attached to another scene node.');
    }
    this._host = host;
    if (host.attached) {
      this.hostAttached();
    }
  }
  /** See {@link SceneNodeComponent}. */
  detach(host?: SceneNode) {
    if (!this._host || (host && this._host !== host)) {
      return;
    }
    this.hostDetached();
    this._host = null;
  }
  /** See {@link SceneNodeComponent}. */
  hostAttached() {
    const scene = this._host?.scene;
    if (scene && !this._world) {
      this._world = PhysicsWorld.get(scene);
      this._join(this._world);
    }
  }
  /** See {@link SceneNodeComponent}. */
  hostDetached() {
    if (this._world) {
      if (!this._world.disposed) {
        this._leave(this._world);
      }
      this._world = null;
    }
  }
  /** Whether anything listens to an event, to skip computing it otherwise. @internal */
  _hasListeners(type: keyof PhysicsEventMap) {
    return !!this._listeners?.[type]?.some((l) => !l.removed);
  }
  /** @internal */
  protected abstract _join(world: PhysicsWorld): void;
  /** @internal */
  protected abstract _leave(world: PhysicsWorld): void;
  protected onDispose() {
    super.onDispose();
    this.detach();
  }
}
