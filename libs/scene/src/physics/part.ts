import { Disposable, makeObservable } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';
import type { NodePhysics } from './node_physics';
import type { PhysicsWorld } from './world';

let nextPhysicsId = 1;

/**
 * Events of physics parts: `ready` is raised by a {@link Collider} when it comes
 * into the simulation.
 *
 * @public
 */
export type PhysicsPartEventMap = {
  ready: [];
};

/**
 * Common lifecycle of the physics data on a node - {@link RigidBody},
 * {@link Collider}, {@link Joint}, {@link CharacterController}, {@link Vehicle}
 * and {@link Wheel}: part of the scene's {@link PhysicsWorld} while its node is
 * in a scene that has one.
 *
 * @remarks
 * A part belongs to at most one {@link NodePhysics}.
 *
 * @public
 */
export abstract class PhysicsPart extends makeObservable(Disposable)<PhysicsPartEventMap>() {
  /** Identifies the part in pair bookkeeping, in creation order. */
  readonly _physicsId: number;
  private _owner: Nullable<NodePhysics>;
  /** The node, for parts that belong to another part rather than to a NodePhysics. */
  private _ownerNode: Nullable<SceneNode>;
  private _world: Nullable<PhysicsWorld>;
  constructor() {
    super();
    this._physicsId = nextPhysicsId++;
    this._owner = null;
    this._ownerNode = null;
    this._world = null;
  }
  /** The physics data of the node this part is on. */
  get owner(): Nullable<NodePhysics> {
    return this._owner;
  }
  /** The node this part is on. */
  get node(): Nullable<SceneNode> {
    return this._owner?.node ?? this._ownerNode;
  }
  /** The world this part is in, while its node is in a scene that has one. */
  get world(): Nullable<PhysicsWorld> {
    return this._world;
  }
  /** Puts the part on a NodePhysics, or takes it off with null. */
  _setOwner(owner: Nullable<NodePhysics>) {
    if (owner === this._owner) {
      return;
    }
    if (owner && this._owner) {
      throw new Error('Physics data already belongs to another node.');
    }
    if (!owner) {
      this._leaveWorld();
    }
    this._owner = owner;
    if (owner) {
      this._enterWorld();
    }
  }
  /** Puts a part owned by another part on a node, or takes it off with null. */
  _setOwnerNode(node: Nullable<SceneNode>) {
    if (node === this._ownerNode) {
      return;
    }
    if (!node) {
      this._leaveWorld();
    }
    this._ownerNode = node;
    if (node) {
      this._enterWorld();
    }
  }
  /** Joins the world of the node's scene, if the node is in one. */
  _enterWorld() {
    const node = this.node;
    if (this._world || !node?.attached || !node.scene) {
      return;
    }
    const world = node.scene.physicsWorld;
    if (world && !world.disposed) {
      this._world = world;
      this._join(world);
    }
  }
  /** Leaves its world. */
  _leaveWorld() {
    if (this._world) {
      if (!this._world.disposed) {
        this._leave(this._world);
      }
      this._world = null;
    }
  }
  /** Whether anything listens to an event, to skip computing it otherwise. */
  _hasListeners(type: keyof PhysicsPartEventMap) {
    return !!this._listeners?.[type]?.some((l) => !l.removed);
  }
  protected abstract _join(world: PhysicsWorld): void;
  protected abstract _leave(world: PhysicsWorld): void;
  protected onDispose() {
    super.onDispose();
    this._leaveWorld();
  }
}
