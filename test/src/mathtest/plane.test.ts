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
  test('射线垂直命中水平面（y=0，法向量+Y）', () => {
    // Plane: y=0, normal=(0,1,0), d=0  =>  0x+1y+0z+0=0
    const plane = new Plane(0, 1, 0, 0);
    // Ray from (0,5,0) pointing down
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    const t = ray.intersectionTestPlane(plane);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(5, 5);
  });

  test('命中点应精确位于平面上', () => {
    // Plane: y = 3  => 0x+1y+0z-3=0
    const plane = new Plane(0, 1, 0, -3);
    const ray = makeRay(0, 10, 0, 0, -1, 0);
    const t = ray.intersectionTestPlane(plane)!;
    const hitY = ray.origin.y + t * ray.direction.y;
    expect(hitY).toBeCloseTo(3, 5);
  });

  test('斜向射线命中任意方向平面', () => {
    // Plane: x=2 => 1x+0y+0z-2=0, normal=(1,0,0)
    const plane = new Plane(1, 0, 0, -2);
    // Ray from (-3,0,0) dir (+1,0,0) => hits at x=2, t=5
    const ray = makeRay(-3, 0, 0, 1, 0, 0);
    const t = ray.intersectionTestPlane(plane);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(5, 5);
  });

  test('射线方向背向平面（t < 0），返回null', () => {
    const plane = new Plane(0, 1, 0, 0); // y=0
    // Ray from (0,5,0) pointing UP – moving away from plane
    const ray = makeRay(0, 5, 0, 0, 1, 0);
    expect(ray.intersectionTestPlane(plane)).toBeNull();
  });

  test('射线与平面平行（法向量和方向垂直），返回null', () => {
    const plane = new Plane(0, 1, 0, 0); // y=0, normal=(0,1,0)
    // Ray direction is (1,0,0) – perpendicular to normal
    const ray = makeRay(0, 5, 0, 1, 0, 0);
    expect(ray.intersectionTestPlane(plane)).toBeNull();
  });

  test('射线起点在平面上（t=0），返回0', () => {
    const plane = new Plane(0, 1, 0, 0); // y=0
    const ray = makeRay(0, 0, 0, 0, -1, 0);
    const t = ray.intersectionTestPlane(plane);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0, 5);
  });

  test('从平面背面朝正面射入，仍应命中（t > 0）', () => {
    const plane = new Plane(0, 1, 0, 0); // y=0, normal points +Y
    // Ray from (0,-5,0) pointing +Y => hits y=0 at t=5
    const ray = makeRay(0, -5, 0, 0, 1, 0);
    const t = ray.intersectionTestPlane(plane);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(5, 5);
  });

  test('使用 initWithOriginNormal 构造的任意平面', () => {
    // Plane passing through (1,2,3) with normal (0,0,1) => z=3
    const plane = new Plane(new Vector3(1, 2, 3), new Vector3(0, 0, 1));
    // Ray from (7,8,-10) dir (0,0,1) => hits z=3 at t=13
    const ray = makeRay(7, 8, -10, 0, 0, 1);
    const t = ray.intersectionTestPlane(plane);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(13, 4);
  });

  test('使用三点构造的平面，命中点验证', () => {
    // Three points in the XY plane (z=0)
    const p0 = new Vector3(0, 0, 0);
    const p1 = new Vector3(1, 0, 0);
    const p2 = new Vector3(0, 1, 0);
    const plane = new Plane(p0, p1, p2);
    // Ray from (0.5, 0.5, -4) dir (0,0,1) => hits z=0 at t=4
    const ray = makeRay(0.5, 0.5, -4, 0, 0, 1);
    const t = ray.intersectionTestPlane(plane);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(4, 4);
    // Verify hit point lies on plane: distanceToPoint ≈ 0
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
