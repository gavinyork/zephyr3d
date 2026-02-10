import { Vector3, AABB } from '@zephyr3d/base';
import { rand } from './common';

function randAABB() {
  const v1 = new Vector3(rand(-1000, 1000), rand(-1000, 1000), rand(-1000, 1000));
  const v2 = new Vector3(rand(-1000, 1000), rand(-1000, 1000), rand(-1000, 1000));
  const [min, max] = [Vector3.min(v1, v2), Vector3.max(v1, v2)];
  return new AABB(min, max);
}

function getCorners(box: AABB): Vector3[] {
  const [minx, miny, minz] = box.minPoint;
  const [maxx, maxy, maxz] = box.maxPoint;
  return [
    new Vector3(minx, miny, minz),
    new Vector3(maxx, miny, minz),
    new Vector3(maxx, maxy, minz),
    new Vector3(minx, maxy, minz),
    new Vector3(minx, miny, maxz),
    new Vector3(maxx, miny, maxz),
    new Vector3(maxx, maxy, maxz),
    new Vector3(minx, maxy, maxz)
  ];
}

function classifyPoints(box: AABB, points: Vector3[]) {
  let inside = 0;
  let outside = 0;
  for (const p of points) {
    if (box.containsPoint(p)) {
      inside++;
    } else {
      outside++;
    }
  }
  return [inside, outside] as const;
}

describe('AABB intersection / containment (fuzz test)', () => {
  test('random AABB pairs satisfy intersection/containment invariants', () => {
    // 多跑几次，增加覆盖面
    for (let i = 0; i < 200; i++) {
      const a = randAABB();
      const b = randAABB();

      const [a_inside_b, a_outside_b] = classifyPoints(b, getCorners(a));
      const [b_inside_a, b_outside_a] = classifyPoints(a, getCorners(b));

      let intersected = false;
      let a_contains_b = false;
      let b_contains_a = false;

      if ((a_inside_b !== 0 && a_outside_b !== 0) || (b_inside_a !== 0 && b_outside_a !== 0)) {
        intersected = true;
      } else if (a_inside_b === 0) {
        // 如果 a 的角点全部在 b 外，则 b 的角点要么全在 a 内，要么全在 a 外
        expect(b_inside_a === 0 || b_outside_a === 0).toBeTruthy();

        a_contains_b = b_inside_a !== 0;
      } else {
        // a_inside_b !== 0 且 a_outside_b === 0，则 a 完全包含在 b 内
        b_contains_a = true;
      }

      if (intersected) {
        expect(a.intersectedWithBox(b)).toBe(true);
        expect(b.intersectedWithBox(a)).toBe(true);
      }

      if (a_contains_b) {
        expect(a.containsBox(b)).toBe(true);
      }

      if (b_contains_a) {
        expect(b.containsBox(a)).toBe(true);
      }
    }
  });
});
