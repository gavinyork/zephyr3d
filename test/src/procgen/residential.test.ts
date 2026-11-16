import { generatePrimitive } from '@zephyr3d/modelgen';
import {
  generateBuildingParts,
  lPlan,
  offsetPlan,
  planArea,
  planEdgeSide,
  rectPlan,
  uPlan,
  type Plan
} from '@zephyr3d/procgen';

function isRectilinear(plan: Plan) {
  return plan.every((a, i) => {
    const b = plan[(i + 1) % plan.length];
    return Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9;
  });
}

describe('plans', () => {
  test('L and U plans are counter-clockwise, rectilinear, and lose exactly their notch', () => {
    for (const corner of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1]
    ] as [0 | 1, 0 | 1][]) {
      const plan = lPlan(30, 20, 12, 8, corner);
      expect(planArea(plan)).toBeCloseTo(30 * 20 - 12 * 8, 9);
      expect(isRectilinear(plan)).toBe(true);
    }
    for (let side = 0; side < 4; side++) {
      const plan = uPlan(30, 24, 10, 12, side);
      expect(planArea(plan)).toBeCloseTo(30 * 24 - 10 * 12, 9);
      expect(isRectilinear(plan)).toBe(true);
      // The courtyard opens to its side: that side of the footprint is cut in two
      const onSide = plan.filter((_, i) => planEdgeSide(plan, i, 30, 24) === side);
      expect(onSide.length).toBe(2);
    }
  });

  test('offsetting moves every edge by its own distance', () => {
    const plan = lPlan(30, 20, 12, 8, [1, 1]);
    const inset = offsetPlan(plan, 1);
    // An L of perimeter 100 inset by 1 loses perimeter × 1 less the corner overlaps
    expect(planArea(inset)).toBeCloseTo(planArea(plan) - 100 + 4, 9);
    expect(planArea(offsetPlan(rectPlan(10, 6), [2, 0, 0, 0]))).toBeCloseTo(10 * 4, 9);
    expect(planArea(offsetPlan(rectPlan(10, 6), -1))).toBeCloseTo(12 * 8, 9);
  });
});

describe('urban residential', () => {
  test('buildings tessellate and stay within the footprint plus balconies and cornice', () => {
    const footprints: [number, number][] = [
      [12, 10],
      [26, 22],
      [40, 30],
      [55, 18]
    ];
    let shapes = 0;
    for (const [w, d] of footprints) {
      for (let seed = 0; seed < 12; seed++) {
        const parts = generateBuildingParts({
          style: 'urban-residential',
          seed,
          footprint: [w, d],
          params: { floors: 3 + (seed % 8), entranceFaceMask: 1 << seed % 4 }
        });
        expect(parts.map((p) => p.part)).toEqual(['mass0']);
        const nodes = parts[0].spec.nodes ?? [];
        shapes += nodes.some((n) => n.type === 'extrude' && n.profile.length > 4) ? 1 : 0;
        const result = generatePrimitive(parts[0].spec, Infinity);
        const reach = 1.3 + 1e-6;
        expect(result.boxMin[0]).toBeGreaterThanOrEqual(-reach);
        expect(result.boxMin[2]).toBeGreaterThanOrEqual(-reach);
        expect(result.boxMax[0]).toBeLessThanOrEqual(w + reach);
        expect(result.boxMax[2]).toBeLessThanOrEqual(d + reach);
        expect(result.boxMin[1]).toBeGreaterThanOrEqual(-1e-6);
      }
    }
    // Some of the larger footprints came out L or U shaped
    expect(shapes).toBeGreaterThan(0);
  });

  test('a part height limit splits the building at floor lines', () => {
    const parts = generateBuildingParts({
      style: 'urban-residential',
      seed: 3,
      footprint: [20, 16],
      params: { floors: 12, maxPartHeight: 20 }
    });
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.part).toMatch(/^mass0\.\d+$/);
    }
  });
});
