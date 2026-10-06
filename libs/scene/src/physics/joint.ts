import { Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';
import { PhysicsPart } from './part';
import type { PhysicsWorld } from './world';

/**
 * What a {@link Joint} allows its two bodies to do.
 *
 * - `fixed`: nothing - they move as one.
 * - `hinge`: turn about the joint's axis, like a door.
 * - `slider`: slide along the joint's axis, like a drawer.
 * - `ball`: turn freely about the pivot, like a shoulder or a chain link.
 * - `rope`: move freely, but no further apart than {@link Joint.length}.
 * - `spring`: pulled back towards {@link Joint.length} apart.
 *
 * @public
 */
export type JointType = 'fixed' | 'hinge' | 'slider' | 'ball' | 'rope' | 'spring';

/**
 * Drives a hinge or slider.
 *
 * - `off`: no drive.
 * - `velocity`: towards turning or sliding at {@link Joint.motorTarget}.
 * - `position`: towards the angle or position {@link Joint.motorTarget}.
 *
 * @public
 */
export type JointMotorMode = 'off' | 'velocity' | 'position';

/**
 * Connects two rigid bodies, or a rigid body and a fixed point in the world.
 *
 * @remarks
 * The joint's own node is the joint's frame: the pivot is the node's origin
 * (moved by {@link Joint.anchor}), and a hinge turns about, or a slider moves
 * along, the node's local {@link Joint.axis}. To put a door's hinge at the edge
 * of the door, put the joint on a child node placed there. A rope or spring
 * runs from that pivot to {@link Joint.connectedAnchor} at the other end.
 *
 * Angles and positions measure how the joint's own body has turned or moved
 * relative to the other end, about or along the axis: a hinge turning
 * counter-clockwise seen from the tip of its axis has a growing angle.
 *
 * One side is the nearest {@link RigidBody} on the joint's node or above it; the
 * other is the nearest rigid body on {@link Joint.connectedBody} or above it, or
 * the world when that is empty.
 *
 * The joint holds the bodies in the pose they have when it is created: a
 * hinge's angle is 0 there. Limits and motor targets are relative to it.
 *
 * Joints cannot break under load: physics implementations do not report the
 * forces on them.
 *
 * @public
 */
export class Joint extends PhysicsPart {
  private _type: JointType;
  private _connectedBodyId: string;
  private _connectedBody: SceneNode | null;
  private readonly _anchor: Vector3;
  private readonly _connectedAnchor: Vector3;
  private readonly _axis: Vector3;
  private _collideConnected: boolean;
  private _limitsEnabled: boolean;
  private _lowerLimit: number;
  private _upperLimit: number;
  private _swingLimit: number;
  private _twistLimit: number;
  private _motorMode: JointMotorMode;
  private _motorTarget: number;
  private _motorStiffness: number;
  private _motorDamping: number;
  private _motorMaxForce: number;
  private _length: number;
  private _stiffness: number;
  private _damping: number;
  private _error: string;

  constructor() {
    super();
    this._type = 'hinge';
    this._connectedBodyId = '';
    this._connectedBody = null;
    this._anchor = new Vector3();
    this._connectedAnchor = new Vector3();
    this._axis = new Vector3(0, 1, 0);
    this._collideConnected = false;
    this._limitsEnabled = false;
    this._lowerLimit = -45;
    this._upperLimit = 45;
    this._swingLimit = 45;
    this._twistLimit = 45;
    this._motorMode = 'off';
    this._motorTarget = 0;
    this._motorStiffness = 1000;
    this._motorDamping = 100;
    this._motorMaxForce = 0;
    this._length = 1;
    this._stiffness = 100;
    this._damping = 5;
    this._error = '';
  }

  /** What the joint allows. Default `'hinge'`. */
  get type() {
    return this._type;
  }
  set type(value: JointType) {
    if (value !== this._type) {
      this._type = value;
      this._rebuild();
    }
  }
  /**
   * The node whose rigid body is the other side of the joint; null connects to
   * a fixed point in the world. Stored by the node's persistent id, so it may
   * be set before that node is loaded or added.
   */
  get connectedBody(): SceneNode | null {
    const scene = this.node?.scene;
    if (!this._connectedBodyId || !scene) {
      return this._connectedBody;
    }
    // Looked up again if it left the scene: it may come back, or be replaced
    // by a node loaded with the same id.
    if (!this._connectedBody || this._connectedBody.scene !== scene || !this._connectedBody.attached) {
      this._connectedBody = scene.findNodeById(this._connectedBodyId) ?? null;
    }
    return this._connectedBody?.attached ? this._connectedBody : null;
  }
  set connectedBody(node: SceneNode | null) {
    this._connectedBody = node;
    this._connectedBodyId = node?.persistentId ?? '';
    this._rebuild();
  }
  /** Persistent id of {@link Joint.connectedBody}, or an empty string. */
  get connectedBodyId() {
    return this._connectedBodyId;
  }
  set connectedBodyId(id: string) {
    if (id !== this._connectedBodyId) {
      this._connectedBodyId = id;
      this._connectedBody = null;
      this._rebuild();
    }
  }
  /** Pivot position in the joint node's local space. Default (0, 0, 0). */
  get anchor(): Vector3 {
    return this._anchor;
  }
  set anchor(value: Vector3) {
    this._anchor.set(value);
    this._rebuild();
  }
  /**
   * Where a rope or spring is tied at the other end: in the connected body's
   * node space, or in world space when connected to the world. Default (0, 0, 0).
   * Other joints pivot at the joint node only.
   */
  get connectedAnchor(): Vector3 {
    return this._connectedAnchor;
  }
  set connectedAnchor(value: Vector3) {
    this._connectedAnchor.set(value);
    this._rebuild();
  }
  /** Hinge or slider axis in the joint node's local space. Default (0, 1, 0). */
  get axis(): Vector3 {
    return this._axis;
  }
  set axis(value: Vector3) {
    this._axis.set(value);
    this._rebuild();
  }
  /** Whether the two connected bodies still collide with each other. Default false. */
  get collideConnected() {
    return this._collideConnected;
  }
  set collideConnected(value: boolean) {
    this._collideConnected = !!value;
    this.world?._getJointHandle(this)?.setContactsEnabled(this._collideConnected);
  }
  /** Whether a hinge, slider or ball joint is limited. Default false. */
  get limitsEnabled() {
    return this._limitsEnabled;
  }
  set limitsEnabled(value: boolean) {
    if (!!value !== this._limitsEnabled) {
      this._limitsEnabled = !!value;
      // Limits can only be turned off again by rebuilding the joint.
      this._rebuild();
    }
  }
  /** Lowest angle of a hinge in degrees, or position of a slider in metres. Default -45. */
  get lowerLimit() {
    return this._lowerLimit;
  }
  set lowerLimit(value: number) {
    this._lowerLimit = value;
    this.world?._applyJointLimits(this);
  }
  /** Highest angle of a hinge in degrees, or position of a slider in metres. Default 45. */
  get upperLimit() {
    return this._upperLimit;
  }
  set upperLimit(value: number) {
    this._upperLimit = value;
    this.world?._applyJointLimits(this);
  }
  /** How far a ball joint may swing away from its axis, in degrees each way. Default 45. */
  get swingLimit() {
    return this._swingLimit;
  }
  set swingLimit(value: number) {
    this._swingLimit = Math.max(0, value);
    this.world?._applyJointLimits(this);
  }
  /** How far a ball joint may twist about its axis, in degrees each way. Default 45. */
  get twistLimit() {
    return this._twistLimit;
  }
  set twistLimit(value: number) {
    this._twistLimit = Math.max(0, value);
    this.world?._applyJointLimits(this);
  }
  /** How a hinge or slider is driven. Default `'off'`. */
  get motorMode() {
    return this._motorMode;
  }
  set motorMode(value: JointMotorMode) {
    this._motorMode = value;
    this.world?._applyJointMotor(this);
  }
  /**
   * In `velocity` mode the speed to reach: degrees per second for a hinge,
   * metres per second for a slider. In `position` mode the angle (degrees) or
   * position (metres) to reach. Default 0.
   */
  get motorTarget() {
    return this._motorTarget;
  }
  set motorTarget(value: number) {
    this._motorTarget = value;
    this.world?._applyJointMotor(this);
  }
  /** How strongly a `position` motor pulls towards its target. Default 1000. */
  get motorStiffness() {
    return this._motorStiffness;
  }
  set motorStiffness(value: number) {
    this._motorStiffness = Math.max(0, value);
    this.world?._applyJointMotor(this);
  }
  /**
   * How strongly a motor resists overshooting; in `velocity` mode, how quickly
   * it gets up to speed. Default 100.
   */
  get motorDamping() {
    return this._motorDamping;
  }
  set motorDamping(value: number) {
    this._motorDamping = Math.max(0, value);
    this.world?._applyJointMotor(this);
  }
  /** Most force (or torque) the motor applies; 0 for no limit. Default 0. */
  get motorMaxForce() {
    return this._motorMaxForce;
  }
  set motorMaxForce(value: number) {
    this._motorMaxForce = Math.max(0, value);
    this.world?._applyJointMotor(this);
  }
  /** A rope's longest distance, or a spring's rest length, in metres. Default 1. */
  get length() {
    return this._length;
  }
  set length(value: number) {
    this._length = Math.max(0, value);
    this._rebuild();
  }
  /** How hard a spring pulls, per metre stretched. Default 100. */
  get stiffness() {
    return this._stiffness;
  }
  set stiffness(value: number) {
    this._stiffness = Math.max(0, value);
    this._rebuild();
  }
  /** How quickly a spring stops bouncing. Default 5. */
  get damping() {
    return this._damping;
  }
  set damping(value: number) {
    this._damping = Math.max(0, value);
    this._rebuild();
  }
  /** A hinge's current angle in degrees, 0 where it was created; 0 for other joints. */
  get angle() {
    return this._type === 'hinge' ? (this.world?._jointValue(this) ?? 0) : 0;
  }
  /** A slider's current position in metres, 0 where it was created; 0 for other joints. */
  get position() {
    return this._type === 'slider' ? (this.world?._jointValue(this) ?? 0) : 0;
  }
  /** Why the joint could not be created, or an empty string. */
  get error() {
    return this._error;
  }

  _setError(error: string) {
    this._error = error;
  }
  private _rebuild() {
    this.world?._markJointDirty(this);
  }
  protected _join(world: PhysicsWorld) {
    world._registerJoint(this);
  }
  protected _leave(world: PhysicsWorld) {
    world._unregisterJoint(this);
  }
}
