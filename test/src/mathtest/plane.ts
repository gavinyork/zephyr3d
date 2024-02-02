import { Plane, Vector3 } from '@zephyr3d/base';
import { assert, rand, numberEquals } from './common';

export function testPlane() {
  const x = rand(-1000, 1000);
  const y = rand(1, 100);
  const z = rand(-1000, 1000);
  const plane = new Plane(new Vector3(x, y, z), new Vector3(0, 1, 0));
  const x1 = rand(-1000, 1000);
  const y1 = rand(y + rand(0, 100));
  const z1 = rand(-1000, 1000);
  assert(numberEquals(plane.distanceToPoint(new Vector3(x1, y1, z1)), y1 - y), 'distanceToPoint test failed');
  assert(
    plane.nearestPointToPoint(new Vector3(x1, y1, z1)).equalsTo(new Vector3(x1, y, z1)),
    'nearestPointToPoint test failed'
  );
  plane.inplaceFlip();
  assert(numberEquals(plane.distanceToPoint(new Vector3(x1, y1, z1)), y - y1), 'distanceToPoint test failed');
  assert(
    plane.nearestPointToPoint(new Vector3(x1, y1, z1)).equalsTo(new Vector3(x1, y, z1)),
    'nearestPointToPoint test failed'
  );
}
