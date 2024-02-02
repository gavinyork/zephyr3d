import { mat4, vec3 } from 'gl-matrix';

export interface RigidBodyInterface {
  readonly transform: mat4;
  readonly mass: number;
  readonly velocity: vec3;
  readonly omega: vec3;
  applyForce(force: vec3, at: vec3): void;
  applyTorque(torque: vec3): void;
}
