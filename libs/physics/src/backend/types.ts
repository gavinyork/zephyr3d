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
  | { type: 'cylinder'; halfHeight: number; radius: number };

/** Surface response of a collider. @internal */
export interface ColliderMaterialDesc {
  friction: number;
  restitution: number;
  isTrigger: boolean;
}

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
  createCollider(
    body: BackendBody,
    shape: ShapeDesc,
    position: Vector3,
    rotation: Quaternion,
    material: ColliderMaterialDesc
  ): BackendCollider;
  removeCollider(collider: BackendCollider): void;
  step(dt: number): void;
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
