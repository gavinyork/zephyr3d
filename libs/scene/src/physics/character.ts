import { Vector3 } from '@zephyr3d/base';
import type { CharacterMoveResult } from './types';
import { Collider } from './collider';
import { PhysicsPart } from './part';
import { RigidBody } from './rigid_body';
import type { PhysicsWorld } from './world';

/**
 * Settings of a character controller as a physics implementation takes them;
 * angles in radians.
 *
 * @public
 */
export interface CharacterSettings {
  skinWidth: number;
  slopeLimit: number;
  slideSlope: number;
  stepHeight: number;
  stepMinWidth: number;
  snapToGround: number;
  pushBodies: boolean;
  characterMass: number;
}

/**
 * Moves a character - a player, a creature - through the world without
 * passing through things: sliding along walls, walking up slopes and steps,
 * staying on the ground going down.
 *
 * @remarks
 * Brings its own collision shape: an upright capsule of {@link
 * CharacterController.height} and {@link CharacterController.radius} standing
 * on the node's origin, so a model whose origin is at its feet needs nothing
 * else. Do not add a {@link RigidBody} or {@link Collider} for it.
 *
 * Call {@link CharacterController.move} with how far the character should go;
 * it moves the node at once. Gravity is up to the caller, as are jumping and
 * control in the air: keep a vertical speed and add gravity to it each update.
 * On the ground, keep a small downward speed rather than none - it is what
 * keeps the character pressed to the ground, and what makes it slide off
 * slopes steeper than {@link CharacterController.slideSlope}:
 *
 * ```ts
 * onFixedUpdate(dt: number) {
 *   this.vy = this.controller.isGrounded ? -1 : this.vy - 9.81 * dt;
 *   this.controller.move(new Vector3(this.walk.x * dt, this.vy * dt, this.walk.z * dt));
 * }
 * ```
 *
 * Moving from `onFixedUpdate` keeps the result the same at any frame rate;
 * from `onUpdate` works too, but follows the frame rate. Like every query, a
 * move sees other objects as the last simulation step left them.
 *
 * It pushes dynamic bodies it walks into, and raises trigger events like any
 * physics object. Contacts between it and static things may not be reported,
 * depending on the physics implementation (`@zephyr3d/physics-rapier` reports
 * none), so what it ran into comes from the move result instead.
 *
 * @public
 */
export class CharacterController extends PhysicsPart {
  /** The kinematic body standing in for the character. */
  readonly _ownedBody: RigidBody;
  /** Its capsule. */
  readonly _ownedCollider: Collider;
  private _height: number;
  private _radius: number;
  private _skinWidth: number;
  private _slopeLimit: number;
  private _slideSlope: number;
  private _stepHeight: number;
  private _stepMinWidth: number;
  private _snapToGround: number;
  private _pushBodies: boolean;
  private _characterMass: number;
  private _grounded: boolean;
  private _groundNormal: Vector3 | null;

  constructor() {
    super();
    this._height = 1.8;
    this._radius = 0.3;
    this._skinWidth = 0.02;
    this._slopeLimit = 45;
    this._slideSlope = 30;
    this._stepHeight = 0.3;
    this._stepMinWidth = 0.2;
    this._snapToGround = 0.2;
    this._pushBodies = true;
    this._characterMass = 70;
    this._grounded = false;
    this._groundNormal = null;
    this._ownedBody = new RigidBody();
    this._ownedBody.motionType = 'kinematic';
    this._ownedCollider = new Collider();
    this._ownedCollider.shape = 'capsule';
    this._syncShape();
  }

  /** Total height of the capsule, from the feet at the node's origin. Default 1.8. */
  get height() {
    return this._height;
  }
  set height(value: number) {
    this._height = Math.max(0, value);
    this._syncShape();
  }
  /** Radius of the capsule. Default 0.3. */
  get radius() {
    return this._radius;
  }
  set radius(value: number) {
    this._radius = Math.max(0, value);
    this._syncShape();
  }
  /** Collision layer of the capsule, 0 to 15. Default 0. */
  get layer() {
    return this._ownedCollider.layer;
  }
  set layer(value: number) {
    this._ownedCollider.layer = value;
  }
  /**
   * Gap kept between the character and what it walks against. Too small and it
   * gets stuck in corners, too large and it visibly hovers. Default 0.02.
   */
  get skinWidth() {
    return this._skinWidth;
  }
  set skinWidth(value: number) {
    this._skinWidth = Math.max(0, value);
    this._configure();
  }
  /** Steepest slope it can walk up, in degrees. Default 45. */
  get slopeLimit() {
    return this._slopeLimit;
  }
  set slopeLimit(value: number) {
    this._slopeLimit = value;
    this._configure();
  }
  /**
   * Slopes steeper than this, in degrees, make it slide down - when it is
   * moving downwards, as it always is with gravity applied. Default 30.
   */
  get slideSlope() {
    return this._slideSlope;
  }
  set slideSlope(value: number) {
    this._slideSlope = value;
    this._configure();
  }
  /** Highest step it walks up without jumping; 0 turns stepping off. Default 0.3. */
  get stepHeight() {
    return this._stepHeight;
  }
  set stepHeight(value: number) {
    this._stepHeight = Math.max(0, value);
    this._configure();
  }
  /** Narrowest step top it steps onto. Default 0.2. */
  get stepMinWidth() {
    return this._stepMinWidth;
  }
  set stepMinWidth(value: number) {
    this._stepMinWidth = Math.max(0, value);
    this._configure();
  }
  /**
   * How far down it reaches to stay on the ground going down slopes and steps;
   * 0 turns it off. Default 0.2.
   */
  get snapToGround() {
    return this._snapToGround;
  }
  set snapToGround(value: number) {
    this._snapToGround = Math.max(0, value);
    this._configure();
  }
  /** Whether it pushes dynamic bodies it walks into. Default true. */
  get pushBodies() {
    return this._pushBodies;
  }
  set pushBodies(value: boolean) {
    this._pushBodies = !!value;
    this._configure();
  }
  /** Mass it pushes with, in kilograms. Default 70. */
  get characterMass() {
    return this._characterMass;
  }
  set characterMass(value: number) {
    this._characterMass = Math.max(0, value);
    this._configure();
  }
  /** Whether the last move ended on the ground. */
  get isGrounded() {
    return this._grounded;
  }
  /** Direction of the ground under it after the last move, or null. */
  get groundNormal() {
    return this._groundNormal;
  }

  /**
   * Moves the character by `displacement` (world space) as far as it can go,
   * and moves its node there at once.
   */
  move(displacement: Vector3): CharacterMoveResult {
    const result = this.world?._moveCharacter(this, displacement);
    if (result) {
      this._grounded = result.grounded;
      this._groundNormal = result.groundNormal;
      return result;
    }
    // Not simulated (no scene, or physics not loaded): nothing to collide with.
    const host = this.node;
    if (host) {
      host.setWorldPose(Vector3.add(host.getWorldPosition(), displacement, new Vector3()));
    }
    return { movement: displacement.clone(), grounded: false, groundNormal: null, collisions: [] };
  }

  _settings(): CharacterSettings {
    const toRad = Math.PI / 180;
    return {
      skinWidth: this._skinWidth,
      slopeLimit: this._slopeLimit * toRad,
      slideSlope: this._slideSlope * toRad,
      stepHeight: this._stepHeight,
      stepMinWidth: this._stepMinWidth,
      snapToGround: this._snapToGround,
      pushBodies: this._pushBodies,
      characterMass: this._characterMass
    };
  }

  private _syncShape() {
    const c = this._ownedCollider;
    c.radius = this._radius;
    c.height = this._height;
    // Feet on the node's origin.
    c.offset = new Vector3(0, this._height / 2, 0);
  }
  private _configure() {
    this.world?._configureCharacter(this);
  }
  protected _join(world: PhysicsWorld) {
    world._registerCharacter(this);
    // Its body and capsule join with it, on its node.
    this._ownedBody._setOwnerNode(this.node);
    this._ownedCollider._setOwnerNode(this.node);
  }
  protected _leave(world: PhysicsWorld) {
    this._ownedCollider._setOwnerNode(null);
    this._ownedBody._setOwnerNode(null);
    world._unregisterCharacter(this);
  }
}
