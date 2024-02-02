import { mat3 } from 'gl-matrix';
import { MassDistributionInterface } from '../interfaces';

export class Sphere implements MassDistributionInterface {
  constructor(public readonly radius: number) {}

  getInertiaTensor(mass: number): mat3 {
    const tensor = mat3.create();
    tensor[0] = tensor[4] = tensor[8] = 0.4 * mass * this.radius * this.radius;
    return tensor;
  }
}
