import { mat3 } from 'gl-matrix';

import { MassDistributionInterface } from '../interfaces';

export class Cylinder implements MassDistributionInterface {
  constructor(public readonly height: number, public readonly radius: number) {}

  getInertiaTensor(mass: number): mat3 {
    const tensor = mat3.create();
    const term0 = 0.25 * mass * this.radius * this.radius;
    const term1 = (1.0 / 12.0) * mass * this.height * this.height;
    tensor[0] = tensor[4] = term0 + term1;
    tensor[8] = 0.5 * mass * this.radius * this.radius;
    return tensor;
  }
}
