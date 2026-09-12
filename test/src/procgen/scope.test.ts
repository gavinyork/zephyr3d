import type { Vec3 } from '@zephyr3d/modelgen';
import {
  abs,
  basisToQuaternion,
  boxFromScope,
  createScope,
  extrude,
  faceOf,
  flt,
  inset,
  localToWorld,
  offsetLocal,
  rel,
  repeat,
  resolveSplit,
  scaleAboutCenter,
  scopeCenter,
  sideFaces,
  split,
  type FaceName,
  type Scope
} from '@zephyr3d/procgen';

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function expectVecNear(actual: Vec3, expected: Vec3, tol = 1e-6): void {
  expect(actual[0]).toBeNear(expected[0], tol);
  expect(actual[1]).toBeNear(expected[1], tol);
  expect(actual[2]).toBeNear(expected[2], tol);
}

describe('procgen / resolveSplit', () => {
  it('takes absolute sizes literally', () => {
    expect(resolveSplit(10, [abs(3), abs(7)])).toEqual([3, 7]);
  });

  it('reads relative sizes as a fraction of the axis', () => {
    expect(resolveSplit(10, [rel(0.25), rel(0.75)])).toEqual([2.5, 7.5]);
  });

  it('gives the remainder to floating entries by weight', () => {
    expect(resolveSplit(10, [abs(4), flt(1), flt(3)])).toEqual([4, 1.5, 4.5]);
  });

  it('rescales to fit when fixed sizes overflow', () => {
    const lengths = resolveSplit(10, [abs(10), abs(30)]);
    expect(lengths[0]).toBeNear(2.5, 1e-9);
    expect(lengths[1]).toBeNear(7.5, 1e-9);
    expect(lengths[0] + lengths[1]).toBeNear(10, 1e-9);
  });

  it('rescales to fill when fixed sizes underflow and nothing floats', () => {
    const lengths = resolveSplit(10, [abs(2), abs(2)]);
    expect(lengths[0] + lengths[1]).toBeNear(10, 1e-9);
  });

  it('starves floating entries instead of overflowing', () => {
    const lengths = resolveSplit(10, [abs(12), flt(1)]);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeNear(10, 1e-9);
  });
});

describe('procgen / split and repeat', () => {
  const parent = createScope([6, 9, 12], [1, 2, 3]);

  it('tiles the axis exactly and leaves other axes alone', () => {
    const parts = split(parent, 'y', [abs(3), flt(1)]);
    expect(parts).toHaveLength(2);
    expect(parts[0].size).toEqual([6, 3, 12]);
    expect(parts[1].size).toEqual([6, 6, 12]);
    expect(parts[0].origin).toEqual([1, 2, 3]);
    expect(parts[1].origin).toEqual([1, 5, 3]);
  });

  it('keeps children inside the parent', () => {
    const parts = split(parent, 'x', [rel(0.3), rel(0.3), flt(1)]);
    const total = parts.reduce((sum, part) => sum + part.size[0], 0);
    expect(total).toBeNear(parent.size[0], 1e-9);
    const last = parts[parts.length - 1];
    expect(last.origin[0] + last.size[0]).toBeNear(parent.origin[0] + parent.size[0], 1e-9);
  });

  it('rounds repeat counts so slices tile exactly', () => {
    // 12 / 5 rounds to 2 slices of 6, not 2 slices of 5 plus a remainder.
    const slices = repeat(parent, 'z', 5);
    expect(slices).toHaveLength(2);
    for (const slice of slices) {
      expect(slice.size[2]).toBeNear(6, 1e-9);
    }
  });

  it('honours repeat count limits', () => {
    expect(repeat(parent, 'z', 0.5, { max: 3 })).toHaveLength(3);
    expect(repeat(parent, 'z', 100, { min: 2 })).toHaveLength(2);
  });

  it('returns nothing for a degenerate axis', () => {
    expect(repeat(createScope([4, 0, 4]), 'y', 1)).toHaveLength(0);
  });
});

describe('procgen / faces', () => {
  const box = createScope([2, 3, 4], [10, 0, 20]);
  const faces: FaceName[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

  it('points each face outward along the expected axis', () => {
    const expected: Record<FaceName, Vec3> = {
      '+x': [1, 0, 0],
      '-x': [-1, 0, 0],
      '+y': [0, 1, 0],
      '-y': [0, -1, 0],
      '+z': [0, 0, 1],
      '-z': [0, 0, -1]
    };
    for (const face of faces) {
      expectVecNear(faceOf(box, face).basis[2], expected[face]);
    }
  });

  it('keeps every face frame right-handed', () => {
    for (const face of faces) {
      const { basis } = faceOf(box, face);
      expectVecNear(cross(basis[0], basis[1]), basis[2]);
    }
  });

  it('produces flat scopes covering the face area', () => {
    for (const face of faces) {
      const f = faceOf(box, face);
      expect(f.size[2]).toBe(0);
      expect(f.size[0] * f.size[1]).toBeGreaterThan(0);
    }
    expect(faceOf(box, '+z').size).toEqual([2, 3, 0]);
    expect(faceOf(box, '+x').size).toEqual([4, 3, 0]);
    expect(faceOf(box, '+y').size).toEqual([4, 2, 0]);
  });

  it('places face corners on the parent boundary', () => {
    for (const face of faces) {
      const f = faceOf(box, face);
      for (const [u, v] of [
        [0, 0],
        [f.size[0], 0],
        [0, f.size[1]],
        [f.size[0], f.size[1]]
      ]) {
        const p = localToWorld(f, [u, v, 0]);
        expect(p[0]).toBeGreaterThanOrEqual(box.origin[0] - 1e-6);
        expect(p[0]).toBeLessThanOrEqual(box.origin[0] + box.size[0] + 1e-6);
        expect(p[1]).toBeGreaterThanOrEqual(box.origin[1] - 1e-6);
        expect(p[1]).toBeLessThanOrEqual(box.origin[1] + box.size[1] + 1e-6);
        expect(p[2]).toBeGreaterThanOrEqual(box.origin[2] - 1e-6);
        expect(p[2]).toBeLessThanOrEqual(box.origin[2] + box.size[2] + 1e-6);
      }
    }
  });

  it('lists the four vertical faces', () => {
    const sides = sideFaces(box);
    expect(sides).toHaveLength(4);
    for (const side of sides) {
      expect(side.basis[2][1]).toBeNear(0, 1e-9);
    }
  });
});

describe('procgen / scope transforms', () => {
  it('extrudes outward along the face normal', () => {
    const face = faceOf(createScope([2, 3, 4]), '+z');
    const slab = extrude(face, 0.5);
    expect(slab.size[2]).toBeNear(0.5, 1e-9);
    // Grew outward, so the near edge stays on the original face plane.
    expect(slab.origin[2]).toBeNear(4, 1e-9);
  });

  it('extrudes inward for a negative depth without flipping the box', () => {
    const face = faceOf(createScope([2, 3, 4]), '+z');
    const slab = extrude(face, -0.5);
    expect(slab.size[2]).toBeNear(0.5, 1e-9);
    expect(slab.origin[2]).toBeNear(3.5, 1e-9);
  });

  it('insets from both sides of each axis', () => {
    const result = inset(createScope([10, 4, 8], [0, 0, 0]), [1, 0, 2]);
    expect(result.size).toEqual([8, 4, 4]);
    expect(result.origin).toEqual([1, 0, 2]);
  });

  it('clamps an inset that would invert the scope', () => {
    const result = inset(createScope([2, 2, 2]), [5, 5, 5]);
    expect(result.size[0]).toBe(0);
    expect(result.size[1]).toBe(0);
  });

  it('preserves the centre when scaling about it', () => {
    const scope = createScope([10, 6, 8], [3, 0, -2]);
    const before = scopeCenter(scope);
    const after = scopeCenter(scaleAboutCenter(scope, [0.5, 1, 0.25]));
    expectVecNear(after, before);
  });

  it('offsets along a local axis', () => {
    const moved = offsetLocal(createScope([1, 1, 1], [0, 0, 0]), 'y', 2.5);
    expect(moved.origin).toEqual([0, 2.5, 0]);
  });
});

describe('procgen / emit', () => {
  it('maps an identity basis to the identity quaternion', () => {
    const q = basisToQuaternion([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]);
    expect(q[0]).toBeNear(0, 1e-9);
    expect(q[1]).toBeNear(0, 1e-9);
    expect(q[2]).toBeNear(0, 1e-9);
    expect(Math.abs(q[3])).toBeNear(1, 1e-9);
  });

  it('round-trips a quarter turn about Y', () => {
    // Local X points along -Z, local Z points along +X.
    const q = basisToQuaternion([
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0]
    ]);
    const half = Math.SQRT1_2;
    expect(Math.abs(q[1])).toBeNear(half, 1e-6);
    expect(Math.abs(q[3])).toBeNear(half, 1e-6);
  });

  it('emits a box centred on the scope', () => {
    const scope = createScope([2, 4, 6], [1, 2, 3]);
    const node = boxFromScope(scope);
    expect(node).not.toBeNull();
    expect(node!.type).toBe('box');
    expectVecNear(node!.position as Vec3, [2, 4, 6]);
    expect((node as { size: Vec3 }).size).toEqual([2, 4, 6]);
    // An axis-aligned scope should not carry a redundant rotation.
    expect(node!.rotation).toBeUndefined();
  });

  it('skips scopes with no volume', () => {
    const face: Scope = faceOf(createScope([2, 2, 2]), '+z');
    expect(boxFromScope(face)).toBeNull();
  });
});
