import type { IEventTarget, Nullable, Quaternion, Vector3 } from '@zephyr3d/base';
import type { Scene } from '../scene/scene';
import type { SceneNode } from '../scene/scene_node';
import type {
  CharacterMoveResult,
  ColliderOutline,
  PhysicsQueryHit,
  PhysicsQueryOptions,
  PhysicsShape,
  PhysicsWorldEventMap
} from './types';
import type { RigidBody } from './rigid_body';
import type { Collider } from './collider';
import type { Joint } from './joint';
import type { CharacterController } from './character';
import type { Vehicle, Wheel } from './vehicle';

/**
 * A simulated rigid body, as a physics implementation exposes it to
 * {@link RigidBody}. Application code uses {@link RigidBody} instead.
 *
 * @public
 */
export interface PhysicsBodyHandle {
  setMass(mass: number): void;
  setDamping(linear: number, angular: number): void;
  setGravityScale(scale: number): void;
  setCcd(enabled: boolean): void;
  setEnabledAxes(translation: [boolean, boolean, boolean], rotation: [boolean, boolean, boolean]): void;
  getLinearVelocity(out: Vector3): Vector3;
  setLinearVelocity(v: Vector3): void;
  getAngularVelocity(out: Vector3): Vector3;
  setAngularVelocity(v: Vector3): void;
  /** Sets the force and torque applied during the following steps, replacing earlier ones. */
  setForce(force: Vector3, torque: Vector3): void;
  applyImpulse(impulse: Vector3, torqueImpulse: Vector3): void;
  isSleeping(): boolean;
  wakeUp(): void;
}

/**
 * A simulated joint, as a physics implementation exposes it to {@link Joint}.
 *
 * @public
 */
export interface PhysicsJointHandle {
  setContactsEnabled(enabled: boolean): void;
}

/**
 * The physics simulation of one scene: steps the physics data on its nodes
 * ({@link SceneNode.physics}) and answers queries.
 *
 * @remarks
 * Scenes get one from the physics implementation an application loads, as
 * `scene.physicsWorld`; see {@link setPhysicsWorldFactory}. The members whose
 * names start with an underscore are how physics data talks to the
 * implementation; application code does not call them.
 *
 * @public
 */
export interface PhysicsWorld extends IEventTarget<PhysicsWorldEventMap> {
  /** The scene this world simulates. */
  readonly scene: Scene;
  /** Whether the world has been disposed. */
  readonly disposed: boolean;
  /** Gravity in m/s². Default (0, -9.81, 0). */
  gravity: Vector3;
  /** Length of one simulation step, in seconds. Default 1/60. */
  fixedTimeStep: number;
  /** Most simulation steps taken in one frame. Default 4. */
  maxSubSteps: number;
  /** Whether moving bodies are drawn between their last two simulated poses. Default true. */
  interpolation: boolean;
  /** Whether this world steps on its own each frame. Default true. */
  enabled: boolean;
  /** Whether the simulation waits to start until mesh and terrain colliders have their geometry. Default true. */
  waitForCollidersOnStart: boolean;
  /** Display names of the 16 collider layers. */
  readonly layerNames: readonly string[];
  /** Whether colliders on layers `a` and `b` collide. */
  getLayerCollision(a: number, b: number): boolean;
  /** Sets whether colliders on layers `a` and `b` collide; applies to both orders. */
  setLayerCollision(a: number, b: number, enabled: boolean): void;
  /** Advances the simulation by `dt` seconds of frame time; called each frame while enabled. */
  update(dt: number): void;
  /** Resolves once every collider waiting for its geometry has it, or failed to. */
  whenReady(): Promise<void>;
  /**
   * Brings the world up to date with the scene without stepping it: physics data added,
   * removed or changed, and nodes moved, since the last step. For tools querying a world that
   * is not simulated, such as the editor's; queries otherwise see the world as of the last step.
   *
   * @remarks
   * Moves no body. Colliders that come to touch through it start touching without a contact
   * event, so do not call it on a world being simulated if contact events matter.
   */
  syncWithScene(): void;
  /** The nearest collider along a ray. */
  raycast(
    origin: Vector3,
    direction: Vector3,
    maxDistance?: number,
    options?: PhysicsQueryOptions
  ): Nullable<PhysicsQueryHit>;
  /** Every collider along a ray, nearest first. */
  raycastAll(
    origin: Vector3,
    direction: Vector3,
    maxDistance?: number,
    options?: PhysicsQueryOptions
  ): PhysicsQueryHit[];
  /** The first collider a shape moved along a direction would touch. */
  shapeCast(
    shape: PhysicsShape,
    position: Vector3,
    rotation: Quaternion,
    direction: Vector3,
    maxDistance?: number,
    options?: PhysicsQueryOptions
  ): Nullable<PhysicsQueryHit>;
  /** Colliders overlapping a shape. */
  overlap(
    shape: PhysicsShape,
    position: Vector3,
    rotation: Quaternion,
    options?: PhysicsQueryOptions
  ): Collider[];
  /** Colliders containing a point. */
  overlapPoint(point: Vector3, options?: PhysicsQueryOptions): Collider[];
  /**
   * Traces a collider's shape (or a character controller's capsule) as lines,
   * exactly as the simulation builds it; for tools.
   */
  getColliderOutline(target: Collider | CharacterController): Promise<Nullable<ColliderOutline>>;
  /** A key that changes whenever {@link PhysicsWorld.getColliderOutline} would give a different outline. */
  getColliderOutlineKey(target: Collider | CharacterController): string;
  /** Releases the world. */
  dispose(): void;

  /** Whether a fixed update is running, so forces act on one step only. */
  readonly _inFixedUpdate: boolean;
  _registerBody(body: RigidBody): void;
  _unregisterBody(body: RigidBody): void;
  _markBodyDirty(body: RigidBody): void;
  _getBodyHandle(body: RigidBody): Nullable<PhysicsBodyHandle>;
  _registerCollider(collider: Collider): void;
  _unregisterCollider(collider: Collider): void;
  _markColliderDirty(collider: Collider): void;
  _updateColliderGroups(collider: Collider): void;
  _registerJoint(joint: Joint): void;
  _unregisterJoint(joint: Joint): void;
  _markJointDirty(joint: Joint): void;
  _getJointHandle(joint: Joint): Nullable<PhysicsJointHandle>;
  _applyJointLimits(joint: Joint): void;
  _applyJointMotor(joint: Joint): void;
  _jointValue(joint: Joint): number;
  _registerCharacter(character: CharacterController): void;
  _unregisterCharacter(character: CharacterController): void;
  _configureCharacter(character: CharacterController): void;
  _moveCharacter(character: CharacterController, displacement: Vector3): Nullable<CharacterMoveResult>;
  _registerVehicle(vehicle: Vehicle): void;
  _unregisterVehicle(vehicle: Vehicle): void;
  _registerWheel(wheel: Wheel): void;
  _unregisterWheel(wheel: Wheel): void;
  _markVehiclesDirty(): void;
  _vehicleSpeed(vehicle: Vehicle): number;
  _vehicleWheels(vehicle: Vehicle): readonly Wheel[];
  _colliderNodeByKey(key: number): Nullable<SceneNode>;
}

/**
 * Creates the physics world of a scene.
 *
 * @public
 */
export type PhysicsWorldFactory = (scene: Scene) => PhysicsWorld;

let worldFactory: Nullable<PhysicsWorldFactory> = null;

/**
 * Sets how scenes get their physics world.
 *
 * @remarks
 * Called by a physics implementation when it is loaded (`initPhysics` of
 * `@zephyr3d/physics`), not usually by applications. Scenes create their world
 * from it the first time they need one; scenes that already have a world keep
 * it. Without a factory, scenes have no world: physics data on nodes is kept,
 * saved and loaded, but not simulated.
 *
 * @public
 */
export function setPhysicsWorldFactory(factory: Nullable<PhysicsWorldFactory>) {
  worldFactory = factory;
}

/**
 * The factory set with {@link setPhysicsWorldFactory}, or null.
 *
 * @public
 */
export function getPhysicsWorldFactory() {
  return worldFactory;
}
