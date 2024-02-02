import { vec2, vec3 } from 'gl-matrix';
import { SampleStatus } from '..';

import { OceanField } from '../ocean-field';
import { PointsSampler } from '../sampler';
import { Sample } from '../sampler/sample';
import { FloatingBody } from './floating-body';
import { RigidBodyInterface } from './rigid-body.interface';

export interface FloatingBodyOptions {
  submergeDepth: number;
  buoyancyStrengh: number;
  waterDrag: number;
  waterAngularDrag: number;
  gravity: vec3;
}

export const floatingBodyDefaultOptions: FloatingBodyOptions = {
  submergeDepth: 1,
  buoyancyStrengh: 0.75,
  waterDrag: 1.0,
  waterAngularDrag: 0.75,
  gravity: vec3.fromValues(0.0, -9.8, 0.0),
};

export class OceanFieldBuoyancy {
  private readonly bodies: FloatingBody[] = [];
  private readonly world: vec3[] = [];
  private readonly points: vec2[] = [];
  private sampled: vec3[] | null = null;
  private sample: Sample<vec3[]> = null;
  private sampler: PointsSampler;
  private dirty = true;

  constructor(public readonly oceanField: OceanField) {}

  createFloatingBody(
    body: RigidBodyInterface,
    floaters: vec3[],
    options: Partial<FloatingBodyOptions> = {}
  ): FloatingBody {
    options = { ...floatingBodyDefaultOptions, ...options };

    const floatingBody = new FloatingBody(
      body,
      floaters,
      options.submergeDepth,
      options.buoyancyStrengh,
      options.waterDrag,
      options.waterAngularDrag,
      options.gravity
    );
    this.bodies.push(floatingBody);

    floaters.forEach(() => {
      this.world.push(vec3.create());
      this.points.push(vec2.create());
    });

    this.dirty = true;
    this.sample = null;

    return floatingBody;
  }

  update() {
    this.sampleOceanField();
    if (this.sampled) {
      let offset = 0;
      for (const body of this.bodies) {
        body.applyForces(this.sampled, this.world, offset);
        offset += body.floaters.length;
      }
    }
  }

  destroyFloatingBody(body: FloatingBody) {
    this.bodies.splice(this.bodies.indexOf(body), 1);
    body.floaters.forEach(() => {
      this.world.pop();
      this.points.pop();
    });

    this.dirty = true;
    this.sample = null;
  }

  private sampleOceanField() {
    if (!this.sample) {
      let i = 0;
      for (const body of this.bodies) {
        for (const floater of body.floaters) {
          vec3.transformMat4(this.world[i], floater, body.body.transform);
          vec2.set(this.points[i], this.world[i][0], this.world[i][2]);
          i++;
        }
      }

      if (this.dirty) {
        this.sampler?.dispose();
        this.sampler = new PointsSampler(this.oceanField, i);
        this.dirty = false;
      }

      this.sample = this.sampler.sample(...this.points);
    } else {
      const status = this.sample.status();
      if (status !== SampleStatus.Pending) {
        if (status === SampleStatus.Complete) {
          this.sampled = this.sample.outcome();
        }
        this.sample.release();
        this.sample = null;
      }
    }
  }
}
