import type { Quaternion, Vector3 } from '@zephyr3d/base';
import type { CharacterSettings, MotionType, PhysicsContactInfo } from '@zephyr3d/scene';

/** A collision shape in body-relative units, already scaled. @public */
export type ShapeDesc =
  | { type: 'box'; halfExtents: Vector3 }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; halfHeight: number; radius: number }
  | { type: 'cylinder'; halfHeight: number; radius: number }
  /** Triangles, vertices already scaled, xyz per vertex. */
  | { type: 'trimesh'; vertices: Float32Array; indices: Uint32Array }
  /** The convex hull of points, already scaled. */
  | { type: 'convex'; points: Float32Array }
  /**
   * A height grid centred on the collider, `rows` samples along Z and `cols`
   * along X; `heights[x * rows + z]`. `scale.x` and `scale.z` are the full
   * extents, `scale.y` multiplies the heights.
   */
  | { type: 'heightfield'; rows: number; cols: number; heights: Float32Array; scale: Vector3 };

/** Surface response and filtering of a collider. @public */
export interface ColliderMaterialDesc {
  friction: number;
  restitution: number;
  isTrigger: boolean;
  /** Packed collision groups: membership in the high 16 bits, filter in the low 16. */
  groups: number;
}

/** A collision or trigger pair starting or stopping, by collider key. @public */
export type CollisionCallback = (key1: number, key2: number, started: boolean) => void;

/** @public */
export interface BackendRayHit {
  key: number;
  distance: number;
  normal: Vector3;
}

/** @public */
export interface BackendShapeHit {
  key: number;
  distance: number;
  /** On the hit collider, world space. */
  point: Vector3;
  /** Outward from the hit collider, world space. */
  normal: Vector3;
}

/** Returns false to skip a collider in a query. @public */
export type QueryPredicate = (key: number) => boolean;

/** @public */
export interface BodyDesc {
  motionType: MotionType;
  position: Vector3;
  rotation: Quaternion;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  ccd: boolean;
  canSleep: boolean;
  /** Axes along which the body may move and about which it may turn. */
  translationAxes: [boolean, boolean, boolean];
  rotationAxes: [boolean, boolean, boolean];
}

/**
 * One simulated world of a physics engine: the operations
 * {@link PhysicsSimulation} needs from it.
 *
 * @remarks
 * Implemented by physics engine packages such as `@zephyr3d/physics-rapier`;
 * applications do not use it. Kept to what common engines (Rapier, Jolt) can
 * provide. For a simulation to be reproducible, an implementation must give
 * the same results for the same calls in the same order.
 *
 * @public
 */
export interface BackendWorld {
  setGravity(gravity: Vector3): void;
  createBody(desc: BodyDesc): BackendBody;
  removeBody(body: BackendBody): void;
  /** Null when the shape cannot be built, e.g. the convex hull of points in a plane. */
  createCollider(
    body: BackendBody,
    shape: ShapeDesc,
    position: Vector3,
    rotation: Quaternion,
    material: ColliderMaterialDesc
  ): BackendCollider | null;
  removeCollider(collider: BackendCollider): void;
  /** Stable id of a collider while it exists, used in events and query results. */
  colliderKey(collider: BackendCollider): number;
  /**
   * The triangles of a mesh or convex collider as the backend built them (hull
   * computed, duplicates merged), in the collider's frame; null for other shapes.
   */
  colliderTriangles(collider: BackendCollider): { vertices: Float32Array; indices: Uint32Array } | null;
  setColliderGroups(collider: BackendCollider, groups: number): void;
  createJoint(desc: JointDesc, body1: BackendBody, body2: BackendBody): BackendJoint;
  removeJoint(joint: BackendJoint): void;
  createCharacter(settings: CharacterSettings): BackendCharacter;
  /**
   * A ray cast vehicle on a dynamic chassis body. Wheel vectors are in the
   * chassis body's local space; `forwardAxis` is the chassis axis (0 X, 1 Y,
   * 2 Z) its speed is measured along, up is always Y.
   */
  createVehicle(chassis: BackendBody, forwardAxis: number, wheels: VehicleWheelDesc[]): BackendVehicle;
  /** Moves colliders of bodies teleported since the last step, for queries and characters. */
  syncColliders(): void;
  /** Steps, reporting colliders that started or stopped touching. */
  step(dt: number, onCollision?: CollisionCallback): void;
  /** Contact details of a touching pair, or null if they no longer touch. */
  contactInfo(c1: BackendCollider, c2: BackendCollider): PhysicsContactInfo | null;
  castRay(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
    filter: QueryPredicate
  ): BackendRayHit | null;
  castRayAll(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
    filter: QueryPredicate
  ): BackendRayHit[];
  castShape(
    shape: ShapeDesc,
    position: Vector3,
    rotation: Quaternion,
    direction: Vector3,
    maxDistance: number,
    filter: QueryPredicate
  ): BackendShapeHit | null;
  overlapShape(shape: ShapeDesc, position: Vector3, rotation: Quaternion, filter: QueryPredicate): number[];
  overlapPoint(point: Vector3, filter: QueryPredicate): number[];
  dispose(): void;
}

/** @public */
export interface BackendBody {
  setMotionType(type: MotionType): void;
  setMass(mass: number): void;
  setDamping(linear: number, angular: number): void;
  setGravityScale(scale: number): void;
  setCcd(enabled: boolean): void;
  setCanSleep(enabled: boolean): void;
  /** A disabled body is left out of the simulation and of queries. */
  setEnabled(enabled: boolean): void;
  setEnabledAxes(translation: [boolean, boolean, boolean], rotation: [boolean, boolean, boolean]): void;
  /** Teleports the body. */
  setPose(position: Vector3, rotation: Quaternion): void;
  /** Where a kinematic body should be at the end of the next step. */
  setKinematicTarget(position: Vector3, rotation: Quaternion): void;
  getPosition(out: Vector3): Vector3;
  getRotation(out: Quaternion): Quaternion;
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

/** @public */
export type BackendCollider = object;

/** Joint types. @public */
export type JointKind = 'fixed' | 'hinge' | 'slider' | 'ball' | 'rope' | 'spring';

/**
 * A joint between two bodies. Anchors and frames are in each body's local
 * space; a frame's X axis is the joint's hinge or slide axis, and a ball's
 * twist axis.
 *
 * @public
 */
export interface JointDesc {
  type: JointKind;
  anchor1: Vector3;
  frame1: Quaternion;
  anchor2: Vector3;
  frame2: Quaternion;
  /** Rope: longest distance. Spring: rest length. */
  length: number;
  stiffness: number;
  damping: number;
  collideConnected: boolean;
}

/** @public */
export type MotorMode = 'off' | 'velocity' | 'position';

/** @public */
export interface BackendJoint {
  setContactsEnabled(enabled: boolean): void;
  /** Limits of a hinge (radians) or slider (metres). */
  setLimits(min: number, max: number): void;
  /** Limits of a ball joint, radians either side: twist about X, swing about Y and Z. */
  setBallLimits(twist: number, swing: number): void;
  setMotor(mode: MotorMode, target: number, stiffness: number, damping: number, maxForce: number): void;
}

/** @public */
export interface CharacterHit {
  key: number;
  point: Vector3;
  /** On the obstacle, pointing towards the character. */
  normal: Vector3;
}

/** @public */
export interface CharacterMove {
  movement: Vector3;
  grounded: boolean;
  hits: CharacterHit[];
}

/** @public */
export interface BackendCharacter {
  configure(settings: CharacterSettings): void;
  /** Works out how far a collider can go towards `desired`, sliding and stepping. */
  move(collider: BackendCollider, desired: Vector3, filter: QueryPredicate): CharacterMove;
  dispose(): void;
}

/** One wheel of a ray cast vehicle. @public */
export interface VehicleWheelDesc {
  /** Where the suspension is attached, chassis space. */
  connection: Vector3;
  /** Direction the suspension extends in, chassis space (down). */
  direction: Vector3;
  /** Axle, chassis space; forward is `normal × axle`. */
  axle: Vector3;
  restLength: number;
  radius: number;
  /** Per unit of chassis mass, as Rapier counts them. */
  stiffness: number;
  compression: number;
  relaxation: number;
  maxTravel: number;
  /** Newtons, not scaled by mass. */
  maxForce: number;
  frictionSlip: number;
  sideFriction: number;
}

/** State of one wheel after the last vehicle update. @public */
export interface VehicleWheelState {
  suspensionLength: number;
  /** Accumulated roll, radians. */
  rotation: number;
  /** Radians. */
  steering: number;
  inContact: boolean;
  contactPoint: Vector3;
  contactNormal: Vector3;
  /** Key of the collider under the wheel, or -1. */
  groundKey: number;
  suspensionForce: number;
}

/** @public */
export interface BackendVehicle {
  /**
   * Inputs for the next update: force along the wheel's rolling direction
   * (N), the most braking impulse per step (N·s), steering angle (radians).
   */
  setWheelInput(index: number, engineForce: number, brakeImpulse: number, steering: number): void;
  /** Casts the wheel rays and applies the wheels' impulses to the chassis; before a step. */
  update(dt: number, filter: QueryPredicate): void;
  wheelState(index: number, out: VehicleWheelState): VehicleWheelState;
  dispose(): void;
}

/**
 * A physics engine, as {@link initPhysics} takes it: loads the engine and
 * creates its worlds.
 *
 * @remarks
 * Each engine package exports one, such as `rapierPhysics` from
 * `@zephyr3d/physics-rapier`.
 *
 * @typeParam O - Options of {@link PhysicsBackend.init}.
 *
 * @public
 */
export interface PhysicsBackend<O = unknown> {
  /** Name of the engine, for messages. */
  readonly name: string;
  /** Whether {@link PhysicsBackend.init} has completed. */
  readonly ready: boolean;
  /** Loads the engine. Called by {@link initPhysics}; safe to call more than once. */
  init(options?: O): Promise<void>;
  /** A new, empty world; only called once the engine is ready. */
  createWorld(): BackendWorld;
}
