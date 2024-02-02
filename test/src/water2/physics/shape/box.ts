import { mat3, vec3 } from 'gl-matrix';

import { MassDistributionInterface } from '../interfaces';

export class Box implements MassDistributionInterface {
  constructor(public readonly extents: vec3) {}

  getInertiaTensor(mass: number): mat3 {
    const tensor = mat3.create();
    const factor = (1.0 / 12.0) * mass;
    tensor[0] =
      factor *
      (this.extents[1] * this.extents[1] + this.extents[2] * this.extents[2]);
    tensor[4] =
      factor *
      (this.extents[0] * this.extents[0] + this.extents[2] * this.extents[2]);
    tensor[8] =
      factor *
      (this.extents[0] * this.extents[0] + this.extents[1] * this.extents[1]);
    return tensor;
  }
}
