import { mat3, mat4, quat, vec3 } from 'gl-matrix';

import { SerializableInterface, TransformableInterface } from '../interfaces';

export class Body implements SerializableInterface, TransformableInterface {
  public static readonly STATE_SIZE = 13;

  get transform(): mat4 {
    return mat4.fromRotationTranslation(
      this._transform,
      this._rotation,
      this._position
    );
  }

  get mass(): number {
    return this._mass;
  }

  get Iinv() {
    return mat3.clone(this._Iinv);
  }

  get position() {
    return vec3.clone(this._position);
  }

  set position(position: vec3) {
    vec3.copy(this._position, position);
  }

  get rotation() {
    return quat.clone(this._rotation);
  }

  set rotation(rotation: quat) {
    quat.copy(this._rotation, rotation);
  }

  get momentum() {
    return vec3.clone(this._momentum);
  }

  get angularMomentum() {
    return vec3.clone(this._angularMomentum);
  }

  get velocity() {
    return vec3.clone(this._velocity);
  }

  get omega() {
    return vec3.clone(this._omega);
  }

  get force() {
    return vec3.clone(this._force);
  }

  get torque() {
    return vec3.clone(this._torque);
  }

  /**
   * Belogs to body only
   */
  private readonly _IbodyInv = mat3.create();

  /**
   * State Attributes
   */
  private readonly _position = vec3.create();
  private readonly _rotation = quat.create();
  private readonly _momentum = vec3.create();
  private readonly _angularMomentum = vec3.create();

  /**
   * Derived
   */
  private readonly _Iinv = mat3.create();
  private readonly _velocity = vec3.create();
  private readonly _omega = vec3.create();
  private readonly _rotationMatrix = mat3.create();
  private readonly _qdot = quat.create();

  /**
   * Computed
   */
  private readonly _force = vec3.create();
  private readonly _torque = vec3.create();
  private readonly _transform = mat4.create();

  constructor(private readonly _mass: number, private readonly _Ibody: mat3) {
    mat3.invert(this._IbodyInv, this._Ibody);
  }

  serializeState(out: Float32Array, offset: number = 0): void {
    for (const value of this._position) {
      out[offset++] = value;
    }

    for (const value of this._rotation) {
      out[offset++] = value;
    }

    for (const value of this._momentum) {
      out[offset++] = value;
    }

    for (const value of this._angularMomentum) {
      out[offset++] = value;
    }
  }

  deserializeState(from: Float32Array, offset: number = 0): void {
    vec3.set(this._position, from[offset++], from[offset++], from[offset++]);
    quat.set(
      this._rotation,
      from[offset++],
      from[offset++],
      from[offset++],
      from[offset++]
    );
    quat.normalize(this._rotation, this._rotation);

    vec3.set(this._momentum, from[offset++], from[offset++], from[offset++]);
    vec3.set(
      this._angularMomentum,
      from[offset++],
      from[offset++],
      from[offset++]
    );

    vec3.scale(this._velocity, this._momentum, 1.0 / this._mass);

    // Iinv
    mat3.fromQuat(this._rotationMatrix, this._rotation);
    mat3.transpose(this._Iinv, this._rotationMatrix);
    mat3.multiply(this._Iinv, this._IbodyInv, this._Iinv);
    mat3.multiply(this._Iinv, this._rotationMatrix, this._Iinv);

    vec3.transformMat3(this._omega, this._angularMomentum, this._Iinv);
  }

  serializeStateDerivative(out: Float32Array, offset: number = 0): void {
    for (const value of this._velocity) {
      out[offset++] = value;
    }

    quat.set(this._qdot, this._omega[0], this._omega[1], this._omega[2], 0);
    quat.multiply(this._qdot, this._qdot, this._rotation);
    quat.scale(this._qdot, this._qdot, 0.5);

    for (const value of this._qdot) {
      out[offset++] = value;
    }

    for (const value of this._force) {
      out[offset++] = value;
    }

    for (const value of this._torque) {
      out[offset++] = value;
    }
  }

  applyForce(force: vec3, at?: vec3) {
    vec3.add(this._force, this._force, force);

    if (at) {
      const torque = vec3.create();
      vec3.transformQuat(torque, at, this.rotation);
      vec3.cross(torque, torque, force);
      vec3.add(this._torque, this._torque, torque);
    }
  }

  applyTorque(torque: vec3) {
    vec3.add(this._torque, this._torque, torque);
  }

  clearForces() {
    vec3.set(this._force, 0, 0, 0);
    vec3.set(this._torque, 0, 0, 0);
  }
}
