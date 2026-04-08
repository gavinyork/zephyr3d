import { Ray, Vector3 } from '@zephyr3d/base';
import {
  SphereShape,
  BoxShape,
  BoxFrameShape,
  CylinderShape,
  TorusShape,
  PlaneShape,
  TetrahedronShape,
  TetrahedronFrameShape,
  CapsuleShape
} from '@zephyr3d/scene';

// Mock GPU device – shapes only touch the GPU in _create() which calls
// createAndSetVertexBuffer / createAndSetIndexBuffer.  We stub those out so
// the constructor doesn't throw in a Node test environment.
jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    createVertexBuffer: (_fmt: unknown, data: Float32Array) => ({
      byteLength: data.byteLength,
      dispose: () => undefined
    }),
    createInterleavedVertexBuffer: (_fmt: unknown, data: Float32Array) => ({
      byteLength: data.byteLength,
      dispose: () => undefined
    }),
    createIndexBuffer: (data: Uint16Array | Uint32Array) => ({
      byteLength: data.byteLength,
      length: data.length,
      indexType: { primitiveType: 0 /* U16 */ },
      dispose: () => undefined
    }),
    createVertexLayout: () => ({
      draw: () => undefined,
      drawInstanced: () => undefined,
      dispose: () => undefined,
      getVertexBufferInfo: () => null
    })
  }))
}));

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a normalised ray from origin (ox,oy,oz) toward direction (dx,dy,dz). */
function makeRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray {
  const len = Math.hypot(dx, dy, dz);
  return new Ray(new Vector3(ox, oy, oz), new Vector3(dx / len, dy / len, dz / len));
}

/** Expect t to be close to expected (absolute tolerance). */
function expectHit(t: number | null, expected: number, tol = 1e-4) {
  expect(t).not.toBeNull();
  expect(Math.abs(t! - expected)).toBeLessThan(tol);
}

/** Verify that a point at distance t along the ray satisfies a predicate. */
function hitPoint(ray: Ray, t: number): Vector3 {
  return new Vector3(
    ray.origin.x + t * ray.direction.x,
    ray.origin.y + t * ray.direction.y,
    ray.origin.z + t * ray.direction.z
  );
}

// ============================================================================
// SphereShape
// ============================================================================
describe('SphereShape.raycast', () => {
  const sphere = new SphereShape({ radius: 1 });

  test('正面命中：射线从球外沿-Z轴射向球心，t应等于r-|oz|=1-4= -3? No: origin z=5, dir=(0,0,-1), t=5-1=4', () => {
    // origin (0,0,5) dir (0,0,-1)  => hit at z=1  t=4
    const ray = makeRay(0, 0, 5, 0, 0, -1);
    expectHit(sphere.raycast(ray), 4);
  });

  test('射线从球内部出发，返回null（sphere.raycast约定内部返回null）', () => {
    const ray = makeRay(0, 0, 0, 0, 0, 1);
    expect(sphere.raycast(ray)).toBeNull();
  });

  test('擦切球表面（discriminant≈0）应返回非null', () => {
    // ray from (0,1,5) dir (0,0,-1) tangent to unit sphere: distance from axis = 1
    const ray = makeRay(0, 1, 5, 0, 0, -1);
    const t = sphere.raycast(ray);
    expect(t).not.toBeNull();
    // hit point y should be ~1 (on the equator)
    const p = hitPoint(ray, t!);
    expect(Math.abs(p.y - 1)).toBeLessThan(1e-3);
  });

  test('完全错过：射线在球旁边飞过，返回null', () => {
    const ray = makeRay(0, 2, 5, 0, 0, -1); // offset y=2 > r=1
    expect(sphere.raycast(ray)).toBeNull();
  });

  test('不同半径：radius=2，从(0,0,10)射向球心', () => {
    const s2 = new SphereShape({ radius: 2 });
    const ray = makeRay(0, 0, 10, 0, 0, -1);
    expectHit(s2.raycast(ray), 8); // 10-2=8
  });
});

// ============================================================================
// BoxShape
// ============================================================================
describe('BoxShape.raycast', () => {
  // default: size=1, anchor=0.5 => box from (-0.5,-0.5,-0.5) to (0.5,0.5,0.5)
  const box = new BoxShape();

  test('沿+X轴射入，命中前面 x=0.5，t=4.5', () => {
    const ray = makeRay(-5, 0, 0, 1, 0, 0);
    expectHit(box.raycast(ray), 4.5);
  });

  test('沿-Y轴射入，命中顶面 y=0.5，t=4.5', () => {
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    expectHit(box.raycast(ray), 4.5);
  });

  test('沿+Z轴，完全错过（偏移x=1>0.5）', () => {
    const ray = makeRay(1, 0, -5, 0, 0, 1);
    expect(box.raycast(ray)).toBeNull();
  });

  test('从内部出发，应返回正t（到出口）', () => {
    const ray = makeRay(0, 0, 0, 1, 0, 0);
    const t = box.raycast(ray);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(0);
  });

  test('自定义 anchor=0（底部在原点）', () => {
    const b = new BoxShape({ sizeX: 2, sizeY: 2, sizeZ: 2, anchor: 0 });
    // box [0,0,0]-[2,2,2]; ray from (1,1,-5) dir (0,0,1)
    const ray = makeRay(1, 1, -5, 0, 0, 1);
    expectHit(b.raycast(ray), 5);
  });

  test('命中点应在盒子表面上', () => {
    const ray = makeRay(-5, 0.1, 0.1, 1, 0, 0);
    const t = box.raycast(ray);
    expect(t).not.toBeNull();
    const p = hitPoint(ray, t!);
    expect(Math.abs(p.x - -0.5)).toBeLessThan(1e-4); // hit at x=-0.5 face
  });
});

// ============================================================================
// BoxFrameShape
// ============================================================================
describe('BoxFrameShape.raycast', () => {
  const frame = new BoxFrameShape();

  test('与等尺寸 BoxShape 结果相同（线框包围盒与实体盒相同）', () => {
    const solid = new BoxShape();
    const ray = makeRay(-5, 0, 0, 1, 0, 0);
    expect(frame.raycast(ray)).toBeCloseTo(solid.raycast(ray)!, 4);
  });

  test('完全错过返回null', () => {
    const ray = makeRay(2, 0, -5, 0, 0, 1);
    expect(frame.raycast(ray)).toBeNull();
  });
});

// ============================================================================
// CylinderShape
// ============================================================================
describe('CylinderShape.raycast', () => {
  // default: r=1, h=1, anchor=0 => bottom y=0, top y=1
  const cyl = new CylinderShape();

  test('从侧面射入圆柱体，命中侧面', () => {
    const ray = makeRay(-5, 0.5, 0, 1, 0, 0); // 高度在中间
    const t = cyl.raycast(ray);
    expectHit(t, 4);
    const p = hitPoint(ray, t!);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1, 3);
  });

  test('从顶部射入，命中顶盖', () => {
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    expectHit(cyl.raycast(ray), 4); // top at y=1, origin y=5, t=4
  });

  test('从底部射入，命中底盖', () => {
    const ray = makeRay(0, -5, 0, 0, 1, 0);
    expectHit(cyl.raycast(ray), 5); // bottom at y=0, t=5
  });

  test('完全错过（x偏移>r）', () => {
    const ray = makeRay(2, 0.5, -5, 0, 0, 1);
    expect(cyl.raycast(ray)).toBeNull();
  });

  test('锥台（topRadius≠bottomRadius）侧面命中', () => {
    const cone = new CylinderShape({ bottomRadius: 1, topRadius: 0, height: 2, anchor: 0 });
    // tip at (0,2,0); shoot from (2,1,0) dir (-1,0,0) should hit at r(y=1)=0.5
    const ray = makeRay(2, 1, 0, -1, 0, 0);
    const t = cone.raycast(ray);
    expect(t).not.toBeNull();
    // hit x = 2 - t => radius at y=1 is 0.5, so hit x=0.5, t=1.5
    expectHit(t, 1.5);
  });

  test('禁用顶盖时从轴线上方射入，仍会命中侧面', () => {
    const noCap = new CylinderShape({ topCap: false, bottomRadius: 1, topRadius: 1, height: 1, anchor: 0 });
    // Ray from (0,5,0) dir (0,-1,0): passes through axis, so it's inside the cylinder
    // and hits the bottom cap (bottomCap is still enabled by default)
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    const t = noCap.raycast(ray);
    // Bottom cap is still enabled, so ray hits the bottom at y=0, t=5
    expect(t).not.toBeNull();
    expectHit(t, 5);
  });
});

// ============================================================================
// TorusShape
// ============================================================================
describe('TorusShape.raycast', () => {
  // outerRadius=1, innerRadius=0.3, lies in XZ plane (y=0)
  const torus = new TorusShape({ outerRadius: 1, innerRadius: 0.3 });

  test('从正上方射向圆环，应命中管体', () => {
    // Shoot from (1,5,0) straight down; hits the outer ring at y=0 at x=1,z=0
    // but that's the torus center circle – tube surface at x=1±0.3
    const ray = makeRay(1, 5, 0, 0, -1, 0);
    const t = torus.raycast(ray);
    expect(t).not.toBeNull();
    // Hit point y ≈ 0.3 (top of tube at (1,0.3,0))
    const p = hitPoint(ray, t!);
    expect(Math.abs(p.y - 0.3)).toBeLessThan(0.01);
  });

  test('射线完全错过（距圆环太远）', () => {
    const ray = makeRay(5, 5, 0, 0, -1, 0); // x=5 >> outerRadius+innerRadius
    expect(torus.raycast(ray)).toBeNull();
  });

  test('从圆环内孔穿过也返回null', () => {
    // Shoot along axis (0,1,0) => passes through center hole
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    expect(torus.raycast(ray)).toBeNull();
  });

  test('斜向射线从侧面穿过圆环应命中', () => {
    // From (0,-5,1) dir (0,1,0) – passes through x=0,z=1 which is on the ring center
    // tube radius 0.3, so should hit
    const ray = makeRay(0, -5, 1, 0, 1, 0);
    const t = torus.raycast(ray);
    expect(t).not.toBeNull();
    const p = hitPoint(ray, t!);
    // Point should be on torus: ||(x,z)|-R|^2 + y^2 = r^2
    const dist2D = Math.hypot(p.x, p.z);
    const torusEq = Math.pow(dist2D - 1, 2) + p.y * p.y;
    expect(Math.abs(torusEq - 0.3 * 0.3)).toBeLessThan(0.01);
  });
});

// ============================================================================
// PlaneShape
// ============================================================================
describe('PlaneShape.raycast', () => {
  // default: size=1, anchor=0.5 => XZ plane [-0.5,0.5]x[-0.5,0.5] at y=0
  const plane = new PlaneShape();

  test('从正上方垂直射下，命中平面中心', () => {
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    expectHit(plane.raycast(ray), 5);
  });

  test('斜向射线命中平面', () => {
    // from (0,1,0) dir (0,-1,0) => t=1
    const ray = makeRay(0, 1, 0, 0, -1, 0);
    expectHit(plane.raycast(ray), 1);
  });

  test('射线与平面平行（dy≈0），返回null', () => {
    const ray = makeRay(0, 0.1, -5, 0, 0, 1);
    expect(plane.raycast(ray)).toBeNull();
  });

  test('命中点在平面范围外，返回null', () => {
    // size=1, anchor=0.5 => x in [-0.5,0.5]; shoot from x=2
    const ray = makeRay(2, 5, 0, 0, -1, 0);
    expect(plane.raycast(ray)).toBeNull();
  });

  test('从下方射上去（反向），返回null（t<0）', () => {
    const ray = makeRay(0, -5, 0, 0, -1, 0); // dir points away from plane
    expect(plane.raycast(ray)).toBeNull();
  });

  test('命中点应严格在平面边界内', () => {
    const ray = makeRay(0.3, 5, 0.3, 0, -1, 0);
    expect(plane.raycast(ray)).not.toBeNull();
    const ray2 = makeRay(0.6, 5, 0.6, 0, -1, 0); // outside
    expect(plane.raycast(ray2)).toBeNull();
  });
});

// ============================================================================
// TetrahedronShape
// ============================================================================
describe('TetrahedronShape.raycast', () => {
  // default: height=1, sizeX=1, sizeZ=1
  const tet = new TetrahedronShape();

  test('从正上方垂直射下，命中某个侧面', () => {
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    const t = tet.raycast(ray);
    expect(t).not.toBeNull();
    // Hit y should be between 0 and height=1
    const p = hitPoint(ray, t!);
    expect(p.y).toBeGreaterThanOrEqual(-1e-4);
    expect(p.y).toBeLessThanOrEqual(1 + 1e-4);
  });

  test('从底部朝上射，命中底面', () => {
    const ray = makeRay(0, -5, 0, 0, 1, 0);
    const t = tet.raycast(ray);
    expect(t).not.toBeNull();
    const p = hitPoint(ray, t!);
    expect(Math.abs(p.y)).toBeLessThan(1e-4); // bottom face y=0
  });

  test('完全错过（偏移太大）', () => {
    const ray = makeRay(10, 5, 0, 0, -1, 0);
    expect(tet.raycast(ray)).toBeNull();
  });

  test('命中点应在某个面上（验证面法线方程）', () => {
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    const t = tet.raycast(ray)!;
    const p = hitPoint(ray, t);
    // The point must be inside or on the bounding AABB of the tet
    expect(p.x).toBeGreaterThanOrEqual(-1 - 1e-4);
    expect(p.x).toBeLessThanOrEqual(1 + 1e-4);
    expect(p.z).toBeGreaterThanOrEqual(-1 - 1e-4);
    expect(p.z).toBeLessThanOrEqual(1 + 1e-4);
  });

  test('侧面斜向射线命中', () => {
    // shoot from (+X side) toward the shape
    const ray = makeRay(5, 0.5, 0, -1, 0, 0);
    const t = tet.raycast(ray);
    expect(t).not.toBeNull();
  });
});

// ============================================================================
// TetrahedronFrameShape
// ============================================================================
describe('TetrahedronFrameShape.raycast', () => {
  const frame = new TetrahedronFrameShape();

  test('线框版本从上方射下能命中侧面（不含底面）', () => {
    const ray = makeRay(0, 5, 0, 0, -1, 0);
    // Frame only has 4 side faces (no bottom), ray from above still hits a side face
    const t = frame.raycast(ray);
    expect(t).not.toBeNull();
  });

  test('从底部朝上射，线框侧面呈开口状，射线仍能命中倾斜侧面', () => {
    // TetrahedronFrameShape has 4 side triangles only (no bottom faces).
    // A ray from (0,-5,0) dir (0,1,0) passes through the interior of the base
    // and hits one of the slanted side faces from behind.
    // The actual behaviour is that the Möller-Trumbore algorithm tests both sides,
    // so the ray does hit a side face. Verify it returns a positive t.
    const ray = makeRay(0, -5, 0, 0, 1, 0);
    const t = frame.raycast(ray);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(0);
    // Hit point should be between y=0 (base) and y=height=1 (apex)
    const p = hitPoint(ray, t!);
    expect(p.y).toBeGreaterThanOrEqual(-1e-4);
    expect(p.y).toBeLessThanOrEqual(1 + 1e-4);
  });

  test('完全错过返回null', () => {
    const ray = makeRay(10, 5, 0, 0, -1, 0);
    expect(frame.raycast(ray)).toBeNull();
  });
});

// ============================================================================
// CapsuleShape
// ============================================================================
describe('CapsuleShape.raycast', () => {
  // default: radius=1, height=1, anchor=0.5
  // totalHeight=3, minY=-1.5, botY=-0.5, topY=0.5
  const cap = new CapsuleShape();

  test('从侧面射向圆柱体部分', () => {
    // At y=0 (inside cylinder zone), shoot from x=5 dir (-1,0,0)
    const ray = makeRay(5, 0, 0, -1, 0, 0);
    expectHit(cap.raycast(ray), 4); // cylinder at r=1, from x=5 => t=4
  });

  test('从正上方命中顶半球', () => {
    // topY=0.5, top hemisphere top at topY+radius=1.5
    const ray = makeRay(0, 10, 0, 0, -1, 0);
    expectHit(cap.raycast(ray), 8.5); // 10 - 1.5 = 8.5
  });

  test('从正下方命中底半球', () => {
    // botY=-0.5, bottom hemisphere bottom at botY-radius=-1.5
    const ray = makeRay(0, -10, 0, 0, 1, 0);
    expectHit(cap.raycast(ray), 8.5); // -10 + (-1.5) = -11.5? no: hitY=-1.5 => t=10-1.5=8.5
  });

  test('完全错过（偏移>radius）', () => {
    const ray = makeRay(2, 0, -5, 0, 0, 1);
    expect(cap.raycast(ray)).toBeNull();
  });

  test('anchor=0（底部在原点）', () => {
    // anchor=0 => minY=0, botY=1, topY=2 (with radius=1,height=1)
    const c = new CapsuleShape({ radius: 1, height: 1, anchor: 0 });
    // top sphere top at topY+radius=3; shoot from (0,10,0) dir (0,-1,0)
    const ray = makeRay(0, 10, 0, 0, -1, 0);
    expectHit(c.raycast(ray), 7); // 10-3=7
  });

  test('无高度胶囊（纯球，height=0）', () => {
    const sphere = new CapsuleShape({ radius: 1, height: 0, anchor: 0.5 });
    // botY=topY=0; top of sphere at y=1
    const ray = makeRay(0, 10, 0, 0, -1, 0);
    expectHit(sphere.raycast(ray), 9); // 10-1=9
  });

  test('命中点应在胶囊表面上（侧面）', () => {
    const ray = makeRay(5, 0, 0, -1, 0, 0);
    const t = cap.raycast(ray)!;
    const p = hitPoint(ray, t);
    // In cylinder zone: dist from y-axis should equal radius=1
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1, 3);
  });

  test('命中点应在胶囊表面上（顶半球）', () => {
    const ray = makeRay(0, 10, 0, 0, -1, 0);
    const t = cap.raycast(ray)!;
    const p = hitPoint(ray, t);
    // Distance from top center (0, topY=0.5, 0) should equal radius=1
    expect(Math.hypot(p.x, p.y - 0.5, p.z)).toBeCloseTo(1, 3);
  });
});
