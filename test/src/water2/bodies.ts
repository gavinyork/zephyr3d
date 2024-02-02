import { vec3 } from 'gl-matrix';

import { Geometry } from './graphics';
import { FloatingBody, OceanFieldBuoyancy } from './ocean';
import { Box, World, Cylinder, Sphere } from './physics';
import OBJ from './assets/objects/shapes';
import { loadObj } from './utils';

const obj = loadObj(OBJ);

export const createCube = (
  world: World,
  buoyancy: OceanFieldBuoyancy,
  size: number = 1
): [FloatingBody, Geometry] => {
  const body = world.createBody(
    1,
    new Box(vec3.fromValues(size, size, size)),
    vec3.fromValues(3.0, 2.0, 3.0)
  );

  const geometry = buoyancy.oceanField['gpu'].createGeometry(obj['cube']);

  const floatingBody = buoyancy.createFloatingBody(body, [
    vec3.fromValues(0.5 * size, -0.5 * size, 0.5 * size),
    vec3.fromValues(0.5 * size, -0.5 * size, -0.5 * size),
    vec3.fromValues(-0.5 * size, -0.5 * size, -0.5 * size),
    vec3.fromValues(-0.5 * size, -0.5 * size, 0.5 * size),
    vec3.fromValues(0.5 * size, 0.5 * size, 0.5 * size),
    vec3.fromValues(0.5 * size, 0.5 * size, -0.5 * size),
    vec3.fromValues(-0.5 * size, 0.5 * size, -0.5 * size),
    vec3.fromValues(-0.5 * size, 0.5 * size, 0.5 * size),
  ]);

  return [floatingBody, geometry];
};

export const createCylinder = (
  world: World,
  buoyancy: OceanFieldBuoyancy,
  height: number = 2,
  radius: number = 0.5
): [FloatingBody, Geometry] => {
  const body = world.createBody(
    1,
    new Cylinder(height, radius),
    vec3.fromValues(-3.0, 2.0, 3.0)
  );
  const geometry = buoyancy.oceanField['gpu'].createGeometry(obj['cylinder']);
  const floatingBody = buoyancy.createFloatingBody(body, [
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      0.5 * height,
      -radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      0.5 * height,
      radius * Math.SQRT1_2
    ),
    vec3.fromValues(radius * Math.SQRT1_2, 0.5 * height, radius * Math.SQRT1_2),
    vec3.fromValues(
      radius * Math.SQRT1_2,
      0.5 * height,
      -radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      -0.5 * height,
      -radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      -0.5 * height,
      radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      radius * Math.SQRT1_2,
      -0.5 * height,
      radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      radius * Math.SQRT1_2,
      -0.5 * height,
      -radius * Math.SQRT1_2
    ),
  ]);

  return [floatingBody, geometry];
};

export const createDuck = (
  world: World,
  buoyancy: OceanFieldBuoyancy,
  size: number = 1
): [FloatingBody, Geometry] => {
  const body = world.createBody(
    1,
    new Sphere(size),
    vec3.fromValues(-3.0, 2.0, -3.0)
  );

  const geometry = buoyancy.oceanField['gpu'].createGeometry(obj['duck']);
  const floatingBody = buoyancy.createFloatingBody(body, [
    vec3.fromValues(-size * Math.SQRT1_2, -size * 0.5, -size * Math.SQRT1_2),
    vec3.fromValues(-size * Math.SQRT1_2, -size * 0.5, size * Math.SQRT1_2),
    vec3.fromValues(size * Math.SQRT1_2, -size * 0.5, size * Math.SQRT1_2),
    vec3.fromValues(size * Math.SQRT1_2, -size * 0.5, -size * Math.SQRT1_2),
  ]);

  return [floatingBody, geometry];
};

export const createDonut = (
  world: World,
  buoyancy: OceanFieldBuoyancy,
  radius: number = 1.0,
  innterRadius: number = 0.25
): [FloatingBody, Geometry] => {
  const body = world.createBody(
    1,
    new Cylinder(innterRadius * 2, radius + innterRadius),
    vec3.fromValues(3.0, 2.0, -3.0)
  );

  const geometry = buoyancy.oceanField['gpu'].createGeometry(obj['donut']);
  const floatingBody = buoyancy.createFloatingBody(body, [
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      -innterRadius,
      -radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      -innterRadius,
      radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      radius * Math.SQRT1_2,
      -innterRadius,
      radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      radius * Math.SQRT1_2,
      -innterRadius,
      -radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      innterRadius,
      -radius * Math.SQRT1_2
    ),
    vec3.fromValues(
      -radius * Math.SQRT1_2,
      innterRadius,
      radius * Math.SQRT1_2
    ),
    vec3.fromValues(radius * Math.SQRT1_2, innterRadius, radius * Math.SQRT1_2),
    vec3.fromValues(
      radius * Math.SQRT1_2,
      innterRadius,
      -radius * Math.SQRT1_2
    ),
  ]);

  return [floatingBody, geometry];
};
