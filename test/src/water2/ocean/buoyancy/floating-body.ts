import { vec3 } from 'gl-matrix';

import { RigidBodyInterface } from './rigid-body.interface';

export class FloatingBody {
  constructor(
    public readonly body: RigidBodyInterface,
    public readonly floaters: vec3[],
    public readonly submergeDepth: number,
    public readonly buoyancyStrength: number,
    public readonly waterDrag: number,
    public readonly waterAngularDrag: number,
    public readonly gravity: vec3
  ) {}

  applyForces(sampled: vec3[], world: vec3[], offset: number) {
    const center = vec3.create();
    for (
      let i = offset, j = 0, end = this.floaters.length + offset;
      i < end;
      i++, j++
    ) {
      if (sampled[i][1] <= world[i][1]) {
        continue;
      }
      const submerging = Math.min(
        Math.max((sampled[i][1] - world[i][1]) / this.submergeDepth, 0.0),
        1.0
      );

      this.body.applyForce(
        vec3.scale(
          vec3.create(),
          this.gravity,
          -this.body.mass * submerging * this.buoyancyStrength
        ),
        this.floaters[j]
      );
      this.body.applyForce(
        vec3.scale(
          vec3.create(),
          this.body.velocity,
          -this.waterDrag * submerging
        ),
        center
      );
      this.body.applyTorque(
        vec3.scale(
          vec3.create(),
          this.body.omega,
          -this.waterAngularDrag * submerging
        )
      );
    }
  }
}
