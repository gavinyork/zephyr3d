import type { ProceduralNode, Vec3 } from '@zephyr3d/modelgen';
import { basisToQuaternion } from './emit';
import { localToWorld, type Scope } from './scope';

/**
 * A building plan: a closed outline in a scope's local XZ plane, as `[x, z]` points,
 * counter-clockwise (positive {@link planArea}) and rectilinear — every edge runs along X or Z
 * and consecutive edges turn by a right angle.
 *
 * Rectilinear plans cover the L, U and T shapes of real blocks while keeping offsets exact,
 * which is what lets a style inset a glazing line or push out a cornice per edge.
 *
 * @public
 */
export type Plan = [number, number][];

/**
 * Twice the signed area of an outline in `[x, z]`; positive for the winding plans use.
 * @public
 */
export function planArea(plan: readonly [number, number][]): number {
  let area = 0;
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i];
    const b = plan[(i + 1) % plan.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

/** Returns the outline wound as a {@link Plan}, reversing it if needed. @public */
export function orientPlan(plan: [number, number][]): Plan {
  return planArea(plan) < 0 ? [...plan].reverse() : plan;
}

/** A `width` × `depth` rectangle from the scope origin. @public */
export function rectPlan(width: number, depth: number): Plan {
  return [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth]
  ];
}

/**
 * Unit outward normal of edge `i` (from point `i` to point `i + 1`) in `[x, z]`.
 * @public
 */
export function planEdgeNormal(plan: Plan, i: number): [number, number] {
  const a = plan[i];
  const b = plan[(i + 1) % plan.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
}

/**
 * Moves every edge of a rectilinear plan inward by its own distance; negative distances move it
 * outward. With right-angled corners each new corner is exactly the old one shifted by both
 * adjacent edges' offsets, so the result stays rectilinear.
 *
 * @param offsets - One distance for all edges, or one per edge (edge `i` runs from point `i`).
 * @public
 */
export function offsetPlan(plan: Plan, offsets: number | readonly number[]): Plan {
  const n = plan.length;
  const offset = (i: number) => (typeof offsets === 'number' ? offsets : (offsets[i] ?? 0));
  return plan.map((p, i) => {
    const prev = (i + n - 1) % n;
    const np = planEdgeNormal(plan, prev);
    const ni = planEdgeNormal(plan, i);
    const dp = offset(prev);
    const di = offset(i);
    return [p[0] - np[0] * dp - ni[0] * di, p[1] - np[1] * dp - ni[1] * di] as [number, number];
  });
}

/**
 * Which side of the `width` × `depth` footprint an edge of the plan lies on, as an index in
 * `[+X, -X, +Z, -Z]` order, or -1 for an edge inside the footprint (the walls of a notch).
 * @public
 */
export function planEdgeSide(plan: Plan, i: number, width: number, depth: number, epsilon = 1e-6): number {
  const a = plan[i];
  const b = plan[(i + 1) % plan.length];
  if (Math.abs(a[0] - width) < epsilon && Math.abs(b[0] - width) < epsilon) {
    return 0;
  }
  if (Math.abs(a[0]) < epsilon && Math.abs(b[0]) < epsilon) {
    return 1;
  }
  if (Math.abs(a[1] - depth) < epsilon && Math.abs(b[1] - depth) < epsilon) {
    return 2;
  }
  if (Math.abs(a[1]) < epsilon && Math.abs(b[1]) < epsilon) {
    return 3;
  }
  return -1;
}

/**
 * The wall face over edge `i` of a plan, between local heights `y0` and `y0 + height`, as a
 * face scope in the convention of {@link faceOf}: local X sweeps the wall left to right seen
 * from outside, Y is up and Z the outward normal.
 * @public
 */
export function planEdgeFace(scope: Scope, plan: Plan, i: number, y0: number, height: number): Scope {
  const a = plan[i];
  const b = plan[(i + 1) % plan.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [bx, by, bz] = scope.basis;
  const local = (x: number, z: number): Vec3 => [
    bx[0] * x + bz[0] * z,
    bx[1] * x + bz[1] * z,
    bx[2] * x + bz[2] * z
  ];
  const dir = local((a[0] - b[0]) / length, (a[1] - b[1]) / length);
  const normal = planEdgeNormal(plan, i);
  return {
    origin: localToWorld(scope, [b[0], y0, b[1]]),
    basis: [dir, [...by], local(normal[0], normal[1])],
    size: [length, Math.max(0, height), 0]
  };
}

/**
 * A prism over a plan between local heights `y0` and `y0 + height`, as an `extrude` node.
 * @returns `null` for a plan without area or a non-positive height.
 * @public
 */
export function extrudePlan(
  scope: Scope,
  plan: Plan,
  y0: number,
  height: number,
  options?: { id?: string }
): ProceduralNode | null {
  if (height <= 1e-6 || planArea(plan) <= 1e-9) {
    return null;
  }
  const node: ProceduralNode = {
    type: 'extrude',
    profile: plan.map((p) => [p[0], p[1]] as [number, number]),
    height,
    smoothAngle: 0,
    position: localToWorld(scope, [0, y0, 0]),
    rotation: basisToQuaternion(scope.basis)
  };
  if (options?.id) {
    node.id = options.id;
  }
  return node;
}

/**
 * An L-shaped plan: the `width` × `depth` rectangle less a `notchWidth` × `notchDepth` corner.
 *
 * @param corner - Corner removed, as `[x side, z side]` with 1 for the max side, 0 for the min.
 * @public
 */
export function lPlan(
  width: number,
  depth: number,
  notchWidth: number,
  notchDepth: number,
  corner: [0 | 1, 0 | 1]
): Plan {
  // Built with the notch at the (+X, +Z) corner, then mirrored into place
  const base: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, depth - notchDepth],
    [width - notchWidth, depth - notchDepth],
    [width - notchWidth, depth],
    [0, depth]
  ];
  return orientPlan(
    base.map(([x, z]) => [corner[0] ? x : width - x, corner[1] ? z : depth - z] as [number, number])
  );
}

/**
 * A U-shaped plan: the `width` × `depth` rectangle less a courtyard notch `notchWidth` wide and
 * `notchDepth` deep, centred on one side and open to it.
 *
 * @param side - Side the courtyard opens to, in `[+X, -X, +Z, -Z]` order.
 * @public
 */
export function uPlan(
  width: number,
  depth: number,
  notchWidth: number,
  notchDepth: number,
  side: number
): Plan {
  // Built in (u, v) with the notch on +V, then mapped onto the requested side
  const alongX = side >= 2;
  const span = alongX ? width : depth;
  const reach = alongX ? depth : width;
  const wing = (span - notchWidth) * 0.5;
  const base: [number, number][] = [
    [0, 0],
    [span, 0],
    [span, reach],
    [span - wing, reach],
    [span - wing, reach - notchDepth],
    [wing, reach - notchDepth],
    [wing, reach],
    [0, reach]
  ];
  const map = ([u, v]: [number, number]): [number, number] => {
    switch (side) {
      case 0:
        return [v, u];
      case 1:
        return [width - v, u];
      case 3:
        return [u, depth - v];
      default:
        return [u, v];
    }
  };
  return orientPlan(base.map(map));
}
