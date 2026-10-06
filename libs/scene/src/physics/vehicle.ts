import type { Quaternion } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { SceneNode } from '../scene/scene_node';
import { PhysicsPart } from './part';
import type { PhysicsWorld } from './world';

/**
 * Which way the front of a {@link Vehicle} faces, in its node's space.
 *
 * @public
 */
export type VehicleForward = '+z' | '-z' | '+x' | '-x';

/**
 * Makes its node a car, truck or other wheeled vehicle, driven by
 * {@link Vehicle.throttle}, {@link Vehicle.brake} and {@link Vehicle.steering}.
 *
 * @remarks
 * The node needs a dynamic {@link RigidBody}, and colliders for the body. The
 * wheels are the {@link NodePhysics.wheel} of nodes below it, with no other rigid
 * body in between; each wheel node is placed where the wheel's centre is with
 * the suspension at rest. While simulating, the wheel nodes are moved up and
 * down with the suspension, turned with the steering and rolled with the
 * vehicle's motion.
 *
 * Up is the node's +Y; the front is {@link Vehicle.forward}. Wheels are rays
 * cast down from the body, as in Bullet's ray cast vehicle:
 * they find the ground, but do not collide - the body's colliders do.
 *
 * Inputs stay in effect until changed, and are applied every simulation step.
 *
 * @public
 */
export class Vehicle extends PhysicsPart {
  private _maxEngineForce: number;
  private _maxBrakeForce: number;
  private _maxHandbrakeForce: number;
  private _maxSteerAngle: number;
  private _forward: VehicleForward;
  private _layer: number;
  private _throttle: number;
  private _brake: number;
  private _handbrake: boolean;
  private _steering: number;
  private _error: string;

  constructor() {
    super();
    this._maxEngineForce = 4000;
    this._maxBrakeForce = 3000;
    this._maxHandbrakeForce = 6000;
    this._maxSteerAngle = 30;
    this._forward = '+z';
    this._layer = 0;
    this._throttle = 0;
    this._brake = 0;
    this._handbrake = false;
    this._steering = 0;
    this._error = '';
  }

  /** Total driving force at full throttle, in newtons, shared out by {@link Wheel.drive}. Default 4000. */
  get maxEngineForce() {
    return this._maxEngineForce;
  }
  set maxEngineForce(value: number) {
    this._maxEngineForce = Math.max(0, value);
  }
  /** Braking force of a wheel at full brake, in newtons, scaled by {@link Wheel.brake}. Default 3000. */
  get maxBrakeForce() {
    return this._maxBrakeForce;
  }
  set maxBrakeForce(value: number) {
    this._maxBrakeForce = Math.max(0, value);
  }
  /** Braking force of a wheel with the handbrake on, in newtons, scaled by {@link Wheel.handbrake}. Default 6000. */
  get maxHandbrakeForce() {
    return this._maxHandbrakeForce;
  }
  set maxHandbrakeForce(value: number) {
    this._maxHandbrakeForce = Math.max(0, value);
  }
  /** Steering angle at full lock, in degrees, scaled by {@link Wheel.steer}. Default 30. */
  get maxSteerAngle() {
    return this._maxSteerAngle;
  }
  set maxSteerAngle(value: number) {
    this._maxSteerAngle = value;
  }
  /** Which way the front faces in the node's space. Default `'+z'`. */
  get forward() {
    return this._forward;
  }
  set forward(value: VehicleForward) {
    if (value !== this._forward) {
      this._forward = value;
      this._rebuild();
    }
  }
  /** Collision layer of the wheels: they find ground on the layers this one collides with. Default 0. */
  get layer() {
    return this._layer;
  }
  set layer(value: number) {
    this._layer = Math.min(15, Math.max(0, Math.floor(value)));
  }

  /** Accelerator, -1 to 1; below 0 drives backwards. Overrides the brake on driven wheels. */
  get throttle() {
    return this._throttle;
  }
  set throttle(value: number) {
    this._throttle = Math.min(1, Math.max(-1, value));
  }
  /** Brake pedal, 0 to 1. */
  get brake() {
    return this._brake;
  }
  set brake(value: number) {
    this._brake = Math.min(1, Math.max(0, value));
  }
  /** Whether the handbrake is on. */
  get handbrake() {
    return this._handbrake;
  }
  set handbrake(value: boolean) {
    this._handbrake = !!value;
  }
  /** Steering wheel, -1 to 1; above 0 turns left. */
  get steering() {
    return this._steering;
  }
  set steering(value: number) {
    this._steering = Math.min(1, Math.max(-1, value));
  }

  /** Speed along the front direction in m/s; negative when going backwards. */
  get speed() {
    return this.world?._vehicleSpeed(this) ?? 0;
  }
  /** The wheels, in scene order, while the vehicle is in a simulation. */
  get wheels(): readonly Wheel[] {
    return this.world?._vehicleWheels(this) ?? [];
  }
  /** Why the vehicle could not be built, or an empty string. */
  get error() {
    return this._error;
  }

  /** The front direction in node space. */
  _forwardVector(out = new Vector3()) {
    switch (this._forward) {
      case '-z':
        return out.setXYZ(0, 0, -1);
      case '+x':
        return out.setXYZ(1, 0, 0);
      case '-x':
        return out.setXYZ(-1, 0, 0);
      default:
        return out.setXYZ(0, 0, 1);
    }
  }
  /** Whether any input asks the vehicle to move. */
  _hasInput() {
    return this._throttle !== 0 || this._brake !== 0 || this._handbrake || this._steering !== 0;
  }
  _setError(error: string) {
    this._error = error;
  }
  private _rebuild() {
    this.world?._markVehiclesDirty();
  }
  protected _join(world: PhysicsWorld) {
    world._registerVehicle(this);
  }
  protected _leave(world: PhysicsWorld) {
    world._unregisterVehicle(this);
  }
}

/**
 * A wheel of the {@link Vehicle} above its node.
 *
 * @remarks
 * Place the node where the wheel's centre is with the suspension at rest. The
 * suspension runs along the vehicle's down direction, the axle along its
 * sideways direction. While simulating, the node's local position and rotation
 * are set from the suspension, steering and roll; they go back to where they
 * were when the vehicle leaves the simulation.
 *
 * Suspension stiffness and damping are per kilogram of the vehicle, so they
 * feel the same on a light car and a heavy truck: with four wheels resting, the
 * suspension sinks by 9.81 / (4 × stiffness) metres.
 *
 * @public
 */
export class Wheel extends PhysicsPart {
  private _radius: number;
  private _suspensionRestLength: number;
  private _suspensionStiffness: number;
  private _suspensionCompression: number;
  private _suspensionRelaxation: number;
  private _maxSuspensionTravel: number;
  private _maxSuspensionForce: number;
  private _frictionSlip: number;
  private _sideFriction: number;
  private _steer: number;
  private _drive: number;
  private _brake: number;
  private _handbrake: number;
  /** Added to what the vehicle's inputs give this wheel. */
  engineForce: number;
  brakeForce: number;
  steerAngle: number;
  /** State after the last simulation step. */
  readonly _state: {
    suspensionLength: number;
    rotation: number;
    steering: number;
    inContact: boolean;
    contactPoint: Vector3;
    contactNormal: Vector3;
    groundKey: number;
    suspensionForce: number;
  };
  /** The node's local transform before the vehicle took it over. */
  _rest: { position: Vector3; rotation: Quaternion } | null;
  /** The node the vehicle last wrote to, to give the rest pose back to. */
  _restNode: SceneNode | null;
  private _error: string;

  constructor() {
    super();
    this._radius = 0.4;
    this._suspensionRestLength = 0.3;
    this._suspensionStiffness = 30;
    this._suspensionCompression = 2.2;
    this._suspensionRelaxation = 3.3;
    this._maxSuspensionTravel = 0.3;
    this._maxSuspensionForce = 1e6;
    this._frictionSlip = 1.5;
    this._sideFriction = 1;
    this._steer = 0;
    this._drive = 0;
    this._brake = 1;
    this._handbrake = 0;
    this.engineForce = 0;
    this.brakeForce = 0;
    this.steerAngle = 0;
    this._state = {
      suspensionLength: 0,
      rotation: 0,
      steering: 0,
      inContact: false,
      contactPoint: new Vector3(),
      contactNormal: new Vector3(),
      groundKey: -1,
      suspensionForce: 0
    };
    this._rest = null;
    this._restNode = null;
    this._error = '';
  }

  /** Wheel radius in metres. Default 0.4. */
  get radius() {
    return this._radius;
  }
  set radius(value: number) {
    this._set('_radius', Math.max(0.01, value));
  }
  /** Suspension length at rest, from where it is attached to the wheel's centre, in metres. Default 0.3. */
  get suspensionRestLength() {
    return this._suspensionRestLength;
  }
  set suspensionRestLength(value: number) {
    this._set('_suspensionRestLength', Math.max(0, value));
  }
  /** Spring strength per kilogram of vehicle; higher is firmer and sinks less. Default 30. */
  get suspensionStiffness() {
    return this._suspensionStiffness;
  }
  set suspensionStiffness(value: number) {
    this._set('_suspensionStiffness', Math.max(0, value));
  }
  /** Damping while the suspension compresses, per kilogram of vehicle. Default 2.2. */
  get suspensionCompression() {
    return this._suspensionCompression;
  }
  set suspensionCompression(value: number) {
    this._set('_suspensionCompression', Math.max(0, value));
  }
  /** Damping while the suspension extends, per kilogram of vehicle. Default 3.3. */
  get suspensionRelaxation() {
    return this._suspensionRelaxation;
  }
  set suspensionRelaxation(value: number) {
    this._set('_suspensionRelaxation', Math.max(0, value));
  }
  /** How far the suspension compresses or extends from rest, in metres. Default 0.3. */
  get maxSuspensionTravel() {
    return this._maxSuspensionTravel;
  }
  set maxSuspensionTravel(value: number) {
    this._set('_maxSuspensionTravel', Math.max(0, value));
  }
  /** Most force the suspension pushes with, in newtons. Default 1000000. */
  get maxSuspensionForce() {
    return this._maxSuspensionForce;
  }
  set maxSuspensionForce(value: number) {
    this._set('_maxSuspensionForce', Math.max(0, value));
  }
  /** Grip: the most sideways force per unit of load, like a friction coefficient. Default 1.5. */
  get frictionSlip() {
    return this._frictionSlip;
  }
  set frictionSlip(value: number) {
    this._set('_frictionSlip', Math.max(0, value));
  }
  /** Scales the sideways grip; lower lets the wheel slide out. Default 1. */
  get sideFriction() {
    return this._sideFriction;
  }
  set sideFriction(value: number) {
    this._set('_sideFriction', Math.max(0, value));
  }
  /** Share of the steering: 1 turns with the wheel, -1 against it (rear steer), 0 not at all. Default 0. */
  get steer() {
    return this._steer;
  }
  set steer(value: number) {
    this._steer = value;
  }
  /** Share of the engine force, e.g. 0.5 for each front wheel of a front wheel drive car. Default 0. */
  get drive() {
    return this._drive;
  }
  set drive(value: number) {
    this._drive = value;
  }
  /** Share of the brake. Default 1. */
  get brake() {
    return this._brake;
  }
  set brake(value: number) {
    this._brake = Math.max(0, value);
  }
  /** Share of the handbrake, usually 1 on rear wheels. Default 0. */
  get handbrake() {
    return this._handbrake;
  }
  set handbrake(value: number) {
    this._handbrake = Math.max(0, value);
  }

  /** Whether the wheel touched ground at the last step. */
  get inContact() {
    return this._state.inContact;
  }
  /** Where the wheel touches the ground, world space; valid when {@link Wheel.inContact}. */
  get contactPoint(): Vector3 {
    return this._state.contactPoint;
  }
  /** Direction of the ground under the wheel, world space; valid when {@link Wheel.inContact}. */
  get contactNormal(): Vector3 {
    return this._state.contactNormal;
  }
  /** The node of the ground under the wheel, or null. */
  get groundNode(): SceneNode | null {
    return this.world?._colliderNodeByKey(this._state.groundKey) ?? null;
  }
  /** Current suspension length in metres. */
  get suspensionLength() {
    return this._state.suspensionLength;
  }
  /** Force the suspension pushes with, in newtons. */
  get suspensionForce() {
    return this._state.suspensionForce;
  }
  /** Why the wheel is not part of a vehicle, or an empty string. */
  get error() {
    return this._error;
  }

  _setError(error: string) {
    this._error = error;
  }
  private _set(key: string, value: number) {
    const self = this as unknown as Record<string, number>;
    if (self[key] !== value) {
      self[key] = value;
      this.world?._markVehiclesDirty();
    }
  }
  protected _join(world: PhysicsWorld) {
    world._registerWheel(this);
  }
  protected _leave(world: PhysicsWorld) {
    world._unregisterWheel(this);
  }
}
