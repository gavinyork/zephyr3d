import { Plane, Ray, Vector3 } from '@zephyr3d/base';
import { rand, numberEquals } from './common';

/** Build a normalised Ray from origin and direction components. */
function makeRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray {
  const len = Math.hypot(dx, dy, dz);
  return new Ray(new Vector3(ox, oy, oz), new Vector3(dx / len, dy / len, dz / len));
}

describe('Plane', () => {
  test('distanceToPoint and nearestPointToPoint and inplaceFlip', () => {
    const x = rand(-1000, 1000);
    const y = rand(1, 100);
    const z = rand(-1000, 1000);

    const plane = new Plane(new Vector3(x, y, z), new Vector3(0, 1, 0));

    const x1 = rand(-1000, 1000);
    const y1 = rand(y + rand(0, 100));
    const z1 = rand(-1000, 1000);
    const p1 = new Vector3(x1, y1, z1);

    // 原始平面
    expect(numberEquals(plane.distanceToPoint(p1), y1 - y)).toBe(true);
    expect(plane.nearestPointToPoint(p1).equalsTo(new Vector3(x1, y, z1))).toBe(true);

    // 翻转法线后
    plane.inplaceFlip();

    expect(numberEquals(plane.distanceToPoint(p1), y - y1)).toBe(true);
    expect(plane.nearestPointToPoint(p1).equalsTo(new Vector3(x1, y, z1))).toBe(true);
  });
});

describe('Ray.intersectionTestPlane', () => {
  // [description, plane, ray origin, ray direction, expected t (null: no hit)]
  const cases: [string, () => Plane, number[], number[], number | null][] = [
    ['垂直命中水平面 y=0', () => new Plane(0, 1, 0, 0), [0, 5, 0], [0, -1, 0], 5],
    ['斜向命中任意方向平面 x=2', () => new Plane(1, 0, 0, -2), [-3, 0, 0], [1, 0, 0], 5],
    ['方向背向平面，不命中', () => new Plane(0, 1, 0, 0), [0, 5, 0], [0, 1, 0], null],
    ['与平面平行，不命中', () => new Plane(0, 1, 0, 0), [0, 5, 0], [1, 0, 0], null],
    ['起点在平面上，t=0', () => new Plane(0, 1, 0, 0), [0, 0, 0], [0, -1, 0], 0],
    ['从平面背面射入，仍命中', () => new Plane(0, 1, 0, 0), [0, -5, 0], [0, 1, 0], 5],
    [
      'initWithOriginNormal 构造的平面 z=3',
      () => new Plane(new Vector3(1, 2, 3), new Vector3(0, 0, 1)),
      [7, 8, -10],
      [0, 0, 1],
      13
    ],
    [
      '三点构造的平面 z=0',
      () => new Plane(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
      [0.5, 0.5, -4],
      [0, 0, 1],
      4
    ]
  ];
  test.each(cases)('%s', (_name, makePlane, o, d, expected) => {
    const plane = makePlane();
    const ray = makeRay(o[0], o[1], o[2], d[0], d[1], d[2]);
    const t = ray.intersectionTestPlane(plane);
    if (expected === null) {
      expect(t).toBeNull();
      return;
    }
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(expected, 4);
    // The hit point lies on the plane.
    const hit = new Vector3(
      ray.origin.x + t! * ray.direction.x,
      ray.origin.y + t! * ray.direction.y,
      ray.origin.z + t! * ray.direction.z
    );
    expect(Math.abs(plane.distanceToPoint(hit))).toBeLessThan(1e-5);
  });

  test('随机平面和射线：命中点 distanceToPoint 应趋近于零', () => {
    for (let i = 0; i < 100; i++) {
      // Random plane through a random origin with random normal
      const origin = new Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      const nx = rand(-1, 1);
      const ny = rand(-1, 1);
      const nz = rand(-1, 1);
      const nlen = Math.hypot(nx, ny, nz);
      if (nlen < 1e-3) {
        continue;
      }
      const normal = new Vector3(nx / nlen, ny / nlen, nz / nlen);
      const plane = new Plane(origin, normal);

      // Ray that is guaranteed to hit: start from a point offset along the normal,
      // fire toward the plane
      const rayOrigin = new Vector3(
        origin.x + normal.x * rand(1, 5),
        origin.y + normal.y * rand(1, 5),
        origin.z + normal.z * rand(1, 5)
      );
      const ray = makeRay(rayOrigin.x, rayOrigin.y, rayOrigin.z, -normal.x, -normal.y, -normal.z);

      const t = ray.intersectionTestPlane(plane);
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThanOrEqual(0);

      // Verify the hit point lies on the plane
      const hit = new Vector3(
        ray.origin.x + t! * ray.direction.x,
        ray.origin.y + t! * ray.direction.y,
        ray.origin.z + t! * ray.direction.z
      );
      expect(Math.abs(plane.distanceToPoint(hit))).toBeLessThan(1e-4);
    }
  });
});
