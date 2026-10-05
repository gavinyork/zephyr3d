import { Vector3 } from '@zephyr3d/base';
import type { BackendBody, MotionType } from './backend/types';
import { PhysicsComponent } from './component';
import type { PhysicsWorld } from './world';

const zero = Vector3.zero();

/**
 * Makes its node a rigid body: moved by the simulation, by its node, or not at
 * all, depending on {@link RigidBody.motionType}.
 *
 * @remarks
 * The body's shape comes from the {@link Collider} components on the same node
 * and on descendant nodes that have no rigid body of their own; together they
 * form one compound body. A body with no collider does not collide.
 *
 * The body turns about its node's origin, and the node's scale only affects the
 * colliders' sizes, not the body.
 *
 * @public
 */
export class RigidBody extends PhysicsComponent {
  private _motionType: MotionType;
  private _mass: number;
  private _linearDamping: number;
  private _angularDamping: number;
  private _gravityScale: number;
  private _ccd: boolean;
  private _canSleep: boolean;
  private readonly _force: Vector3;
  private readonly _torque: Vector3;
  private readonly _impulse: Vector3;
  private readonly _torqueImpulse: Vector3;
  private _pendingLinearVelocity: Vector3 | null;
  private _pendingAngularVelocity: Vector3 | null;

  constructor() {
    super();
    this._motionType = 'dynamic';
    this._mass = 1;
    this._linearDamping = 0;
    this._angularDamping = 0.05;
    this._gravityScale = 1;
    this._ccd = false;
    this._canSleep = true;
    this._force = new Vector3();
    this._torque = new Vector3();
    this._impulse = new Vector3();
    this._torqueImpulse = new Vector3();
    this._pendingLinearVelocity = null;
    this._pendingAngularVelocity = null;
  }

  /** How the body moves. Default `'dynamic'`. */
  get motionType() {
    return this._motionType;
  }
  set motionType(value: MotionType) {
    if (value !== this._motionType) {
      this._motionType = value;
      this.world?._markBodyDirty(this);
    }
  }
  /** Mass in kilograms, for dynamic bodies. Default 1. */
  get mass() {
    return this._mass;
  }
  set mass(value: number) {
    this._mass = Math.max(1e-6, value);
    this._backend()?.setMass(this._mass);
  }
  /** How quickly linear motion dies down without contact, per second. Default 0. */
  get linearDamping() {
    return this._linearDamping;
  }
  set linearDamping(value: number) {
    this._linearDamping = Math.max(0, value);
    this._backend()?.setDamping(this._linearDamping, this._angularDamping);
  }
  /** How quickly spinning dies down, per second. Default 0.05. */
  get angularDamping() {
    return this._angularDamping;
  }
  set angularDamping(value: number) {
    this._angularDamping = Math.max(0, value);
    this._backend()?.setDamping(this._linearDamping, this._angularDamping);
  }
  /** Multiplier on the world's gravity for this body. Default 1. */
  get gravityScale() {
    return this._gravityScale;
  }
  set gravityScale(value: number) {
    this._gravityScale = value;
    this._backend()?.setGravityScale(value);
  }
  /**
   * Continuous collision detection: keeps fast, small bodies from passing
   * through thin colliders between two steps, at some cost. Default false.
   */
  get ccd() {
    return this._ccd;
  }
  set ccd(value: boolean) {
    this._ccd = !!value;
    this._backend()?.setCcd(this._ccd);
  }
  /** Whether the body may stop being simulated once it comes to rest. Default true. */
  get canSleep() {
    return this._canSleep;
  }
  set canSleep(value: boolean) {
    if (!!value !== this._canSleep) {
      this._canSleep = !!value;
      this.world?._markBodyDirty(this);
    }
  }

  /** Linear velocity in m/s. Returns zero before the body exists in a simulation. */
  getLinearVelocity(out = new Vector3()): Vector3 {
    const body = this._backend();
    if (body) {
      return body.getLinearVelocity(out);
    }
    out.set(this._pendingLinearVelocity ?? zero);
    return out;
  }
  setLinearVelocity(value: Vector3) {
    const body = this._backend();
    if (body) {
      body.setLinearVelocity(value);
    } else {
      this._pendingLinearVelocity = value.clone();
    }
  }
  /** Angular velocity in rad/s, as an axis scaled by speed. */
  getAngularVelocity(out = new Vector3()): Vector3 {
    const body = this._backend();
    if (body) {
      return body.getAngularVelocity(out);
    }
    out.set(this._pendingAngularVelocity ?? zero);
    return out;
  }
  setAngularVelocity(value: Vector3) {
    const body = this._backend();
    if (body) {
      body.setAngularVelocity(value);
    } else {
      this._pendingAngularVelocity = value.clone();
    }
  }
  /**
   * Adds a force (newtons, world space) acting on the centre of mass during the
   * next frame's simulation steps. Forces add up and are cleared after use.
   */
  applyForce(force: Vector3) {
    this._force.addBy(force);
  }
  /** Adds a torque (N·m, world space) for the next frame's steps. */
  applyTorque(torque: Vector3) {
    this._torque.addBy(torque);
  }
  /** Adds an instantaneous change of momentum (N·s, world space), applied once. */
  applyImpulse(impulse: Vector3) {
    this._impulse.addBy(impulse);
  }
  /** Adds an instantaneous change of angular momentum, applied once. */
  applyTorqueImpulse(impulse: Vector3) {
    this._torqueImpulse.addBy(impulse);
  }
  /** Whether the body is resting and not being simulated. */
  get isSleeping() {
    return this._backend()?.isSleeping() ?? false;
  }
  /** Brings a resting body back into the simulation. */
  wakeUp() {
    this._backend()?.wakeUp();
  }

  /** @internal */
  _applyPendingVelocities(body: BackendBody) {
    if (this._pendingLinearVelocity) {
      body.setLinearVelocity(this._pendingLinearVelocity);
      this._pendingLinearVelocity = null;
    }
    if (this._pendingAngularVelocity) {
      body.setAngularVelocity(this._pendingAngularVelocity);
      this._pendingAngularVelocity = null;
    }
  }
  /** Hands the accumulated inputs to the body before a frame's steps. @internal */
  _applyInputs(body: BackendBody) {
    if (this._motionType !== 'dynamic') {
      return;
    }
    body.setForce(this._force, this._torque);
    if (!this._impulse.equalsTo(zero) || !this._torqueImpulse.equalsTo(zero)) {
      body.applyImpulse(this._impulse, this._torqueImpulse);
    }
    this._impulse.setXYZ(0, 0, 0);
    this._torqueImpulse.setXYZ(0, 0, 0);
  }
  /** @internal */
  _clearForces(body: BackendBody) {
    if (!this._force.equalsTo(zero) || !this._torque.equalsTo(zero)) {
      this._force.setXYZ(0, 0, 0);
      this._torque.setXYZ(0, 0, 0);
      body.setForce(zero, zero);
    }
  }
  private _backend() {
    return this.world?._getBackendBody(this) ?? null;
  }
  protected _join(world: PhysicsWorld) {
    world._registerBody(this);
  }
  protected _leave(world: PhysicsWorld) {
    world._unregisterBody(this);
  }
}
