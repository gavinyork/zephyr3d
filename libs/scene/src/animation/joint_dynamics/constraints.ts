// Constraint creation utilities — port of SPCRJointDynamicsController constraint building

import { Vector3 } from '@zephyr3d/base';
import { ConstraintType, type Constraint, type BoneNode } from './types';

/** Options for constraint generation from bone hierarchy */
export interface ConstraintBuildOptions {
  /** Generate parent→child vertical constraints */
  structuralVertical: boolean;
  /** Generate same-depth horizontal constraints across chains */
  structuralHorizontal: boolean;
  /** Generate diagonal cross-bracing constraints */
  shear: boolean;
  /** Generate skip-one vertical bending constraints */
  bendingVertical: boolean;
  /** Generate skip-one horizontal bending constraints */
  bendingHorizontal: boolean;
  /** Connect last root point back to first (for cylindrical topology like skirts) */
  isLoop: boolean;
  /** Enable per-constraint collision detection on structural vertical pairs */
  collideStructuralVertical: boolean;
  /** Enable per-constraint collision detection on structural horizontal pairs */
  collideStructuralHorizontal: boolean;
  /** Enable per-constraint collision detection on shear pairs */
  collideShear: boolean;
  /** Enable surface/triangle collision (overrides per-type collision flags) */
  enableSurfaceCollision: boolean;
}

interface RawConstraint {
  type: ConstraintType;
  indexA: number;
  indexB: number;
  length: number;
}

function getFirstChild(node: BoneNode): BoneNode | null {
  return node.children.length > 0 ? node.children[0] : null;
}

function constraintLength(a: BoneNode, b: BoneNode): number {
  return Vector3.distance(a.position, b.position);
}

// ── Structural Vertical: parent→child chains ──

function createStructuralVertical(node: BoneNode, out: RawConstraint[]) {
  for (const child of node.children) {
    out.push({
      type: ConstraintType.Structural_Vertical,
      indexA: node.index,
      indexB: child.index,
      length: constraintLength(node, child)
    });
    createStructuralVertical(child, out);
  }
}

// ── Structural Horizontal: same-depth siblings across chains ──

function createHorizontal(
  a: BoneNode | null,
  b: BoneNode | null,
  type: ConstraintType,
  out: RawConstraint[]
) {
  if (!a || !b || a === b) {
    return;
  }
  const childA = getFirstChild(a);
  const childB = getFirstChild(b);

  if (childA && childB) {
    out.push({
      type,
      indexA: childA.index,
      indexB: childB.index,
      length: constraintLength(childA, childB)
    });
    createHorizontal(childA, childB, type, out);
  } else if (childA && !childB) {
    out.push({
      type,
      indexA: childA.index,
      indexB: b.index,
      length: constraintLength(childA, b)
    });
  } else if (!childA && childB) {
    out.push({
      type,
      indexA: a.index,
      indexB: childB.index,
      length: constraintLength(a, childB)
    });
  }
}

// ── Shear: diagonal cross-bracing ──

function createShear(a: BoneNode | null, b: BoneNode | null, out: RawConstraint[]) {
  if (!a || !b || a === b) {
    return;
  }
  const cA = getFirstChild(a);
  const cB = getFirstChild(b);
  const cA2 = cA ? getFirstChild(cA) : null;
  const cB2 = cB ? getFirstChild(cB) : null;
  const cA3 = cA2 ? getFirstChild(cA2) : null;
  const cB3 = cB2 ? getFirstChild(cB2) : null;

  const target1 = cA ?? cA2 ?? cA3;
  if (target1) {
    out.push({
      type: ConstraintType.Shear,
      indexA: target1.index,
      indexB: b.index,
      length: constraintLength(target1, b)
    });
  }

  const target2 = cB ?? cB2 ?? cB3;
  if (target2) {
    out.push({
      type: ConstraintType.Shear,
      indexA: a.index,
      indexB: target2.index,
      length: constraintLength(a, target2)
    });
  }

  createShear(cA, cB, out);
}

// ── Bending Vertical: skip-one (grandparent→grandchild) ──

function createBendingVertical(node: BoneNode, out: RawConstraint[]) {
  if (node.children.length !== 1) {
    return;
  }
  const childA = node.children[0];
  if (childA.children.length !== 1) {
    return;
  }
  const childB = childA.children[0];

  out.push({
    type: ConstraintType.Bending_Vertical,
    indexA: node.index,
    indexB: childB.index,
    length: constraintLength(node, childB)
  });
  createBendingVertical(childA, out);
}

// ── Constraint grouping (no shared point indices per group) ──

function findSameIndex(group: Constraint[], c: Constraint): boolean {
  for (const g of group) {
    if (g.indexA === c.indexA || g.indexA === c.indexB || g.indexB === c.indexA || g.indexB === c.indexB) {
      return true;
    }
  }
  return false;
}

function pushToGroups(groups: Constraint[][], c: Constraint) {
  for (const g of groups) {
    if (!findSameIndex(g, c)) {
      g.push(c);
      return;
    }
  }
  groups.push([c]);
}

// ── Surface faces (quads → 2 triangles of 3 indices) ──

function createSurfaceFaces(a: BoneNode | null, b: BoneNode | null, out: number[]) {
  if (!a || !b || a === b) {
    return;
  }
  const cA = getFirstChild(a);
  const cB = getFirstChild(b);
  if (cA && cB) {
    if (
      a.useForSurfaceCollision !== false &&
      b.useForSurfaceCollision !== false &&
      cA.useForSurfaceCollision !== false &&
      cB.useForSurfaceCollision !== false
    ) {
      // Quad ABCD → triangles ABC, CDA
      out.push(a.index, b.index, cB.index, cB.index, cA.index, a.index);
    }
    createSurfaceFaces(cA, cB, out);
  }
}

// ── Public API ──

export function buildConstraints(rootPoints: BoneNode[], options: ConstraintBuildOptions): Constraint[] {
  const n = rootPoints.length;
  const groups: Constraint[][] = [];

  const addRaw = (raws: RawConstraint[], collide: boolean) => {
    for (const r of raws) {
      const bothFixed = isBoneFixed(rootPoints, r.indexA) && isBoneFixed(rootPoints, r.indexB);
      pushToGroups(groups, {
        type: r.type,
        indexA: r.indexA,
        indexB: r.indexB,
        length: r.length,
        isCollision: !bothFixed && collide ? 1 : 0
      });
    }
  };

  // Bending Horizontal
  if (options.bendingHorizontal) {
    const raw: RawConstraint[] = [];
    const pairs = options.isLoop
      ? Array.from({ length: n }, (_, i) => [i, (i + 2) % n])
      : Array.from({ length: Math.max(0, n - 2) }, (_, i) => [i, i + 2]);
    for (const [a, b] of pairs) {
      createHorizontal(rootPoints[a], rootPoints[b], ConstraintType.Bending_Horizontal, raw);
    }
    addRaw(raw, false);
  }

  // Bending Vertical
  if (options.bendingVertical) {
    const raw: RawConstraint[] = [];
    for (const root of rootPoints) {
      createBendingVertical(root, raw);
    }
    addRaw(raw, false);
  }

  // Shear
  if (options.shear) {
    const raw: RawConstraint[] = [];
    const pairs = options.isLoop
      ? Array.from({ length: n }, (_, i) => [i, (i + 1) % n])
      : Array.from({ length: Math.max(0, n - 1) }, (_, i) => [i, i + 1]);
    for (const [a, b] of pairs) {
      createShear(rootPoints[a], rootPoints[b], raw);
    }
    addRaw(raw, options.enableSurfaceCollision || options.collideShear);
  }

  // Structural Horizontal
  if (options.structuralHorizontal) {
    const raw: RawConstraint[] = [];
    const pairs = options.isLoop
      ? Array.from({ length: n }, (_, i) => [i, (i + 1) % n])
      : Array.from({ length: Math.max(0, n - 1) }, (_, i) => [i, i + 1]);
    for (const [a, b] of pairs) {
      createHorizontal(rootPoints[a], rootPoints[b], ConstraintType.Structural_Horizontal, raw);
    }
    addRaw(raw, options.enableSurfaceCollision || options.collideStructuralHorizontal);
  }

  // Structural Vertical
  if (options.structuralVertical) {
    const raw: RawConstraint[] = [];
    for (const root of rootPoints) {
      createStructuralVertical(root, raw);
    }
    addRaw(raw, options.enableSurfaceCollision || options.collideStructuralVertical);
  }

  // Flatten groups into single array
  return groups.flat();
}

export function buildSurfaceFaces(rootPoints: BoneNode[], isLoop: boolean): number[] {
  const out: number[] = [];
  const n = rootPoints.length;
  for (let i = 0; i < n - 1; i++) {
    createSurfaceFaces(rootPoints[i], rootPoints[i + 1], out);
  }
  if (isLoop && n > 1) {
    createSurfaceFaces(rootPoints[n - 1], rootPoints[0], out);
  }
  return out;
}

export function computeMaxDepth(rootPoints: BoneNode[]): number {
  let max = 0;
  function walk(node: BoneNode) {
    if (node.depth > max) {
      max = node.depth;
    }
    for (const c of node.children) {
      walk(c);
    }
  }
  for (const r of rootPoints) {
    walk(r);
  }
  return max;
}

export function sortRootPointsByProximity(
  roots: BoneNode[],
  ignoreY: boolean,
  fixedBeginEnd: boolean
): BoneNode[] {
  if (roots.length <= 2) {
    return [...roots];
  }
  const sorted: BoneNode[] = [];
  const remaining = [...roots];

  if (fixedBeginEnd) {
    sorted.push(remaining.shift()!);
    const last = remaining.pop()!;
    while (remaining.length > 0) {
      const cur = sorted[sorted.length - 1];
      let bestIdx = 0,
        bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = distXYZ(cur.position, remaining[i].position, ignoreY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      sorted.push(remaining.splice(bestIdx, 1)[0]);
    }
    sorted.push(last);
  } else {
    sorted.push(remaining.shift()!);
    while (remaining.length > 0) {
      const cur = sorted[sorted.length - 1];
      let bestIdx = 0,
        bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = distXYZ(cur.position, remaining[i].position, ignoreY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      sorted.push(remaining.splice(bestIdx, 1)[0]);
    }
  }
  return sorted;
}

// ── Helpers ──

function distXYZ(a: Vector3, b: Vector3, ignoreY: boolean): number {
  const dx = a.x - b.x,
    dz = a.z - b.z;
  const dy = ignoreY ? 0 : a.y - b.y;
  return dx * dx + dy * dy + dz * dz;
}

// Walk all nodes to find if a given index is fixed
function isBoneFixed(roots: BoneNode[], index: number): boolean {
  function find(node: BoneNode): boolean {
    if (node.index === index) {
      return node.isFixed;
    }
    for (const c of node.children) {
      const r = find(c);
      if (r !== undefined) {
        return r;
      }
    }
    return false;
  }
  for (const r of roots) {
    const res = find(r);
    if (res) {
      return true;
    }
  }
  return false;
}
