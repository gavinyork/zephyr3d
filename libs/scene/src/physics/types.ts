import type { Matrix4x4, Nullable, Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';
import type { Collider } from './collider';
import type { RigidBody } from './rigid_body';
import type { NodePhysics } from './node_physics';
import type { PhysicsContactEvent, PhysicsTriggerEvent } from './events';

/**
 * How a rigid body moves.
 *
 * - `dynamic`: moved by the simulation - gravity, collisions, forces.
 * - `kinematic`: moved by its node (animation, scripts); pushes dynamic bodies.
 * - `static`: does not move.
 *
 * @public
 */
export type MotionType = 'dynamic' | 'kinematic' | 'static';

/**
 * Events of a physics object: the {@link NodePhysics} of a node with a rigid
 * body or character controller, or with colliders and no rigid body above them.
 *
 * @remarks
 * Raised once per pair of objects, however many of their colliders touch, and
 * dispatched after the frame's simulation steps, when nodes are already in
 * their new places. Changing physics settings from a handler takes effect in
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

/**
 * Events of a {@link PhysicsWorld}.
 *
 * - `fixedupdate`: before each simulation step, with the step length in seconds.
 *   Forces applied from here act on that step only.
 *
 * @public
 */
export type PhysicsWorldEventMap = {
  fixedupdate: [fixedDeltaTime: number];
};

/**
 * A shape for queries, in world units.
 *
 * @public
 */
export type PhysicsShape =
  | { type: 'box'; size: Vector3 }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; radius: number; height: number }
  | { type: 'cylinder'; radius: number; height: number };

/**
 * Filters of a query.
 *
 * @public
 */
export interface PhysicsQueryOptions {
  /** Bit `1 << layer` set for each collider layer to consider. Default: all layers. */
  layerMask?: number;
  /** Whether triggers can be hit. Default false. */
  includeTriggers?: boolean;
  /** A physics object to ignore, such as the one asking: all its colliders are skipped. */
  exclude?: Nullable<NodePhysics>;
}

/**
 * What a query hit.
 *
 * @public
 */
export interface PhysicsQueryHit {
  collider: Collider;
  /** The rigid body the collider belongs to, if any. */
  body: Nullable<RigidBody>;
  /** The physics object the collider raises events on. */
  object: NodePhysics;
  /** The collider's node. */
  node: SceneNode;
  /** Where the hit is, in world space. */
  point: Vector3;
  /** Surface direction at the hit, in world space, pointing out of the collider. */
  normal: Vector3;
  /** How far along the ray or cast the hit is. */
  distance: number;
}

/**
 * Something a character ran into during {@link CharacterController.move}.
 *
 * @public
 */
export interface CharacterCollision {
  collider: Collider;
  node: SceneNode;
  /** Contact point on the obstacle, world space. */
  point: Vector3;
  /** Surface direction of the obstacle there, world space, pointing at the character. */
  normal: Vector3;
}

/**
 * The outcome of {@link CharacterController.move}.
 *
 * @public
 */
export interface CharacterMoveResult {
  /** How far the character actually moved, world space. */
  movement: Vector3;
  /** Whether it ended standing on something. */
  grounded: boolean;
  /** Direction of the ground under it, or null when not grounded. */
  groundNormal: Nullable<Vector3>;
  collisions: CharacterCollision[];
}

/**
 * Lines tracing a collider's shape as the simulation builds it, for tools to
 * draw. See {@link PhysicsWorld.getColliderOutline}.
 *
 * @public
 */
export interface ColliderOutline {
  /** Line segments, two points of three floats each per segment, in the collider's frame. */
  segments: Float32Array;
  /**
   * From the collider's frame to its node's local space. Draw the segments with
   * the node's world matrix times this; it stays valid while the node moves and
   * turns, but not when it is scaled (the scale is part of the shape).
   */
  transform: Matrix4x4;
}

/**
 * Contact details between two touching colliders, in world space, as a physics
 * implementation reports them.
 *
 * @public
 */
export interface PhysicsContactInfo {
  /** From the first collider towards the second. */
  normal: Vector3;
  points: Vector3[];
  /** Total normal impulse of the last step, N·s. */
  impulse: number;
}
