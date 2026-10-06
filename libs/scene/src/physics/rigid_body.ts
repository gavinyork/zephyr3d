import { Vector3 } from '@zephyr3d/base';
import type { MotionType } from './types';
import type { PhysicsBodyHandle } from './world';
import { PhysicsPart } from './part';
import type { PhysicsWorld } from './world';

const zero = Vector3.zero();
const tmpForce = new Vector3();
const tmpTorque = new Vector3();

type Axes = [boolean, boolean, boolean];

/**
 * Makes its node a rigid body: moved by the simulation, by its node, or not at
 * all, depending on {@link RigidBody.motionType}.
 *
 * @remarks
 * The body's shape comes from the colliders ({@link NodePhysics.colliders}) of
 * the same node and of descendant nodes that have no rigid body of their own; together they
 * form one compound body. A body with no collider does not collide.
 *
 * The body turns about its node's origin, and the node's scale only affects the
 * colliders' sizes, not the body.
 *
 * Collision and trigger events of all its colliders are raised on the body; see
 * {@link PhysicsEventMap}.
 *
 * @public
 */
export class RigidBody extends PhysicsPart {
  private _motionType: MotionType;
  private _mass: number;
  private _linearDamping: number;
  private _angularDamping: number;
  private _gravityScale: number;
  private _ccd: boolean;
  private _canSleep: boolean;
  private readonly _lockTranslation: Axes;
  private readonly _lockRotation: Axes;
  /** Applied during every step of the frame, from outside the fixed update. */
  private readonly _force: Vector3;
  private readonly _torque: Vector3;
  /** Applied during the current step only, from the fixed update. */
  private readonly _stepForce: Vector3;
  private readonly _stepTorque: Vector3;
  private readonly _impulse: Vector3;
  private readonly _torqueImpulse: Vector3;
  /** Whether the backend body currently has a non-zero force set. */
  private _forceSet: boolean;
  private _pendingLinearVelocity: Vector3 | null;
  private _pendingAngularVelocity: Vector3 | null;
  private readonly _initialLinearVelocity: Vector3;
  private readonly _initialAngularVelocity: Vector3;
  /** Whether the initial velocities were given to the body since it joined its world. */
  private _initialApplied: boolean;

  constructor() {
    super();
    this._motionType = 'dynamic';
    this._mass = 1;
    this._linearDamping = 0;
    this._angularDamping = 0.05;
    this._gravityScale = 1;
    this._ccd = false;
    this._canSleep = true;
    this._lockTranslation = [false, false, false];
    this._lockRotation = [false, false, false];
    this._force = new Vector3();
    this._torque = new Vector3();
    this._stepForce = new Vector3();
    this._stepTorque = new Vector3();
    this._impulse = new Vector3();
    this._torqueImpulse = new Vector3();
    this._forceSet = false;
    this._pendingLinearVelocity = null;
    this._pendingAngularVelocity = null;
    this._initialLinearVelocity = new Vector3();
    this._initialAngularVelocity = new Vector3();
    this._initialApplied = false;
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
  /** Keeps the body from moving along the world X axis. Default false. */
  get lockTranslationX() {
    return this._lockTranslation[0];
  }
  set lockTranslationX(value: boolean) {
    this._setLock(this._lockTranslation, 0, value);
  }
  /** Keeps the body from moving along the world Y axis. Default false. */
  get lockTranslationY() {
    return this._lockTranslation[1];
  }
  set lockTranslationY(value: boolean) {
    this._setLock(this._lockTranslation, 1, value);
  }
  /** Keeps the body from moving along the world Z axis. Default false. */
  get lockTranslationZ() {
    return this._lockTranslation[2];
  }
  set lockTranslationZ(value: boolean) {
    this._setLock(this._lockTranslation, 2, value);
  }
  /** Keeps the body from turning about the world X axis. Default false. */
  get lockRotationX() {
    return this._lockRotation[0];
  }
  set lockRotationX(value: boolean) {
    this._setLock(this._lockRotation, 0, value);
  }
  /** Keeps the body from turning about the world Y axis. Default false. */
  get lockRotationY() {
    return this._lockRotation[1];
  }
  set lockRotationY(value: boolean) {
    this._setLock(this._lockRotation, 1, value);
  }
  /** Keeps the body from turning about the world Z axis. Default false. */
  get lockRotationZ() {
    return this._lockRotation[2];
  }
  set lockRotationZ(value: boolean) {
    this._setLock(this._lockRotation, 2, value);
  }

  /**
   * Velocity in m/s, world space, a dynamic body starts with when its node
   * enters a simulated scene. Rebuilding the body later (changing its settings)
   * does not apply it again; leaving and re-entering the scene does. A velocity
   * set from a script before the body starts wins. Default (0, 0, 0).
   */
  get initialLinearVelocity(): Vector3 {
    return this._initialLinearVelocity;
  }
  set initialLinearVelocity(value: Vector3) {
    this._initialLinearVelocity.set(value);
  }
  /**
   * Spin in rad/s a dynamic body starts with, as an axis scaled by speed in
   * world space; see {@link RigidBody.initialLinearVelocity}. Default (0, 0, 0).
   */
  get initialAngularVelocity(): Vector3 {
    return this._initialAngularVelocity;
  }
  set initialAngularVelocity(value: Vector3) {
    this._initialAngularVelocity.set(value);
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
  /** Sets the linear velocity; components along locked axes are ignored. */
  setLinearVelocity(value: Vector3) {
    const v = this._mask(value, this._lockTranslation);
    const body = this._backend();
    if (body) {
      body.setLinearVelocity(v);
    } else {
      this._pendingLinearVelocity = v;
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
  /** Sets the angular velocity; components about locked axes are ignored. */
  setAngularVelocity(value: Vector3) {
    const v = this._mask(value, this._lockRotation);
    const body = this._backend();
    if (body) {
      body.setAngularVelocity(v);
    } else {
      this._pendingAngularVelocity = v;
    }
  }
  /**
   * Adds a force (newtons, world space) acting on the centre of mass.
   *
   * @remarks
   * Called during a fixed update (`RuntimeScript.onFixedUpdate` or the world's
   * `fixedupdate` event), the force acts on that one simulation step; called at
   * any other time, it acts on every step of the next frame. Forces add up and
   * are cleared after use.
   */
  applyForce(force: Vector3) {
    (this.world?._inFixedUpdate ? this._stepForce : this._force).addBy(force);
  }
  /** Adds a torque (N·m, world space); acts like {@link RigidBody.applyForce}. */
  applyTorque(torque: Vector3) {
    (this.world?._inFixedUpdate ? this._stepTorque : this._torque).addBy(torque);
  }
  /** Adds an instantaneous change of momentum (N·s, world space), applied at the next step. */
  applyImpulse(impulse: Vector3) {
    this._impulse.addBy(impulse);
  }
  /** Adds an instantaneous change of angular momentum, applied at the next step. */
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

  _translationAxes(): Axes {
    return [!this._lockTranslation[0], !this._lockTranslation[1], !this._lockTranslation[2]];
  }
  _rotationAxes(): Axes {
    return [!this._lockRotation[0], !this._lockRotation[1], !this._lockRotation[2]];
  }
  _applyPendingVelocities(body: PhysicsBodyHandle) {
    if (!this._initialApplied) {
      this._initialApplied = true;
      if (this._motionType === 'dynamic') {
        if (!this._initialLinearVelocity.equalsTo(zero)) {
          body.setLinearVelocity(this._mask(this._initialLinearVelocity, this._lockTranslation));
        }
        if (!this._initialAngularVelocity.equalsTo(zero)) {
          body.setAngularVelocity(this._mask(this._initialAngularVelocity, this._lockRotation));
        }
      }
    }
    if (this._pendingLinearVelocity) {
      body.setLinearVelocity(this._pendingLinearVelocity);
      this._pendingLinearVelocity = null;
    }
    if (this._pendingAngularVelocity) {
      body.setAngularVelocity(this._pendingAngularVelocity);
      this._pendingAngularVelocity = null;
    }
  }
  /** Hands the accumulated inputs to the body before a step. */
  _applyStepInputs(body: PhysicsBodyHandle) {
    if (this._motionType !== 'dynamic') {
      this._stepForce.setXYZ(0, 0, 0);
      this._stepTorque.setXYZ(0, 0, 0);
      this._impulse.setXYZ(0, 0, 0);
      this._torqueImpulse.setXYZ(0, 0, 0);
      return;
    }
    const force = Vector3.add(this._force, this._stepForce, tmpForce);
    const torque = Vector3.add(this._torque, this._stepTorque, tmpTorque);
    const nonZero = !force.equalsTo(zero) || !torque.equalsTo(zero);
    if (nonZero || this._forceSet) {
      body.setForce(force, torque);
      this._forceSet = nonZero;
    }
    this._stepForce.setXYZ(0, 0, 0);
    this._stepTorque.setXYZ(0, 0, 0);
    if (!this._impulse.equalsTo(zero) || !this._torqueImpulse.equalsTo(zero)) {
      body.applyImpulse(this._impulse, this._torqueImpulse);
      this._impulse.setXYZ(0, 0, 0);
      this._torqueImpulse.setXYZ(0, 0, 0);
    }
  }
  /** Clears the frame's forces once all its steps are taken. */
  _clearForces(body: PhysicsBodyHandle) {
    this._force.setXYZ(0, 0, 0);
    this._torque.setXYZ(0, 0, 0);
    if (this._forceSet) {
      body.setForce(zero, zero);
      this._forceSet = false;
    }
  }
  private _setLock(axes: Axes, index: number, value: boolean) {
    if (axes[index] === !!value) {
      return;
    }
    axes[index] = !!value;
    const body = this._backend();
    if (body) {
      body.setEnabledAxes(this._translationAxes(), this._rotationAxes());
    }
    // Axis locks stop forces and contacts moving the body along an axis,
    // not velocity it already has; drop that too, so a lock means "still".
    if (value) {
      if (axes === this._lockTranslation) {
        this.setLinearVelocity(this.getLinearVelocity());
      } else {
        this.setAngularVelocity(this.getAngularVelocity());
      }
    }
  }
  private _mask(value: Vector3, locks: Axes) {
    return new Vector3(locks[0] ? 0 : value.x, locks[1] ? 0 : value.y, locks[2] ? 0 : value.z);
  }
  private _backend() {
    return this.world?._getBodyHandle(this) ?? null;
  }
  protected _join(world: PhysicsWorld) {
    this._initialApplied = false;
    world._registerBody(this);
  }
  protected _leave(world: PhysicsWorld) {
    world._unregisterBody(this);
  }
}
