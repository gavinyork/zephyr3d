import { vec3 } from 'gl-matrix';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class AABB {
  constructor(
    public readonly min: Readonly<vec3>,
    public readonly max: Readonly<vec3>
  ) {}

  closestPoint(p: Readonly<vec3>): vec3 {
    return vec3.fromValues(
      clamp(p[0], this.min[0], this.max[0]),
      clamp(p[1], this.min[1], this.max[1]),
      clamp(p[2], this.min[2], this.max[2])
    );
  }

  distance(p: Readonly<vec3>): number {
    return vec3.distance(p, this.closestPoint(p));
  }
}
