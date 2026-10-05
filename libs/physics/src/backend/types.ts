import type { Quaternion, Vector3 } from '@zephyr3d/base';

/**
 * How a rigid body moves.
 *
 * - `dynamic`: moved by the simulation (gravity, contacts, forces).
 * - `kinematic`: moved by its node (animation, scripts); pushes dynamic bodies
 *   but is not pushed back.
 * - `static`: never moves; the cheapest kind, for floors and walls.
 *
 * @public
 */
export type MotionType = 'dynamic' | 'kinematic' | 'static';

/** A collision shape in body-relative units, already scaled. @internal */
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

/** Surface response and filtering of a collider. @internal */
export interface ColliderMaterialDesc {
  friction: number;
  restitution: number;
  isTrigger: boolean;
  /** Packed collision groups: membership in the high 16 bits, filter in the low 16. */
  groups: number;
}

/** A collision or trigger pair starting or stopping, by collider key. @internal */
export type CollisionCallback = (key1: number, key2: number, started: boolean) => void;

/** Contact details between two touching colliders, in world space. @internal */
export interface ContactInfo {
  /** From the first collider towards the second. */
  normal: Vector3;
  points: Vector3[];
  /** Total normal impulse over the last step. */
  impulse: number;
}

/** @internal */
export interface BackendRayHit {
  key: number;
  distance: number;
  normal: Vector3;
}

/** @internal */
export interface BackendShapeHit {
  key: number;
  distance: number;
  /** On the hit collider, world space. */
  point: Vector3;
  /** Outward from the hit collider, world space. */
  normal: Vector3;
}

/** Returns false to skip a collider in a query. @internal */
export type QueryPredicate = (key: number) => boolean;

/** @internal */
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
 * The operations the physics components need from an engine.
 *
 * @remarks
 * Kept to what both Rapier and Jolt can provide, so a second backend can be
 * added without changing the components (see the design notes on determinism).
 *
 * @internal
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
  setColliderGroups(collider: BackendCollider, groups: number): void;
  createJoint(desc: JointDesc, body1: BackendBody, body2: BackendBody): BackendJoint;
  removeJoint(joint: BackendJoint): void;
  createCharacter(settings: CharacterSettings): BackendCharacter;
  /** Moves colliders of bodies teleported since the last step, for queries and characters. */
  syncColliders(): void;
  /** Steps, reporting colliders that started or stopped touching. */
  step(dt: number, onCollision?: CollisionCallback): void;
  /** Contact details of a touching pair, or null if they no longer touch. */
  contactInfo(c1: BackendCollider, c2: BackendCollider): ContactInfo | null;
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

/** @internal */
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

/** @internal */
export type BackendCollider = object;

/** Joint types the components use. @internal */
export type JointKind = 'fixed' | 'hinge' | 'slider' | 'ball' | 'rope' | 'spring';

/**
 * A joint between two bodies. Anchors and frames are in each body's local
 * space; a frame's X axis is the joint's hinge or slide axis, and a ball's
 * twist axis.
 *
 * @internal
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

/** @internal */
export type MotorMode = 'off' | 'velocity' | 'position';

/** @internal */
export interface BackendJoint {
  setContactsEnabled(enabled: boolean): void;
  /** Limits of a hinge (radians) or slider (metres). */
  setLimits(min: number, max: number): void;
  /** Limits of a ball joint, radians either side: twist about X, swing about Y and Z. */
  setBallLimits(twist: number, swing: number): void;
  setMotor(mode: MotorMode, target: number, stiffness: number, damping: number, maxForce: number): void;
}

/** Settings of a character controller. @internal */
export interface CharacterSettings {
  skinWidth: number;
  /** Radians. */
  slopeLimit: number;
  /** Radians. */
  slideSlope: number;
  stepHeight: number;
  stepMinWidth: number;
  snapToGround: number;
  pushBodies: boolean;
  characterMass: number;
}

/** @internal */
export interface CharacterHit {
  key: number;
  point: Vector3;
  /** On the obstacle, pointing towards the character. */
  normal: Vector3;
}

/** @internal */
export interface CharacterMove {
  movement: Vector3;
  grounded: boolean;
  hits: CharacterHit[];
}

/** @internal */
export interface BackendCharacter {
  configure(settings: CharacterSettings): void;
  /** Works out how far a collider can go towards `desired`, sliding and stepping. */
  move(collider: BackendCollider, desired: Vector3, filter: QueryPredicate): CharacterMove;
  dispose(): void;
}
