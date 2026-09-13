import type { ProceduralNode, UVSpec, Vec3, Vec4 } from '@zephyr3d/modelgen';
import { extrude, isDegenerate, scopeCenter, type Scope } from './scope';

/**
 * Converts an orthonormal basis (local X, Y, Z as world vectors) to a rotation
 * quaternion in `[x, y, z, w]` order, matching the procedural model spec.
 *
 * Uses Shepperd's method: the largest diagonal term is chosen as the pivot so the
 * square root never operates on a near-zero value.
 *
 * @public
 */
export function basisToQuaternion(basis: readonly [Vec3, Vec3, Vec3]): Vec4 {
  const [bx, by, bz] = basis;
  const m00 = bx[0];
  const m10 = bx[1];
  const m20 = bx[2];
  const m01 = by[0];
  const m11 = by[1];
  const m21 = by[2];
  const m02 = bz[0];
  const m12 = bz[1];
  const m22 = bz[2];
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

function isIdentityQuaternion(q: Vec4, epsilon = 1e-9): boolean {
  return (
    Math.abs(q[0]) < epsilon &&
    Math.abs(q[1]) < epsilon &&
    Math.abs(q[2]) < epsilon &&
    Math.abs(Math.abs(q[3]) - 1) < epsilon
  );
}

/**
 * Options shared by the scope-to-geometry helpers.
 * @public
 */
export interface EmitOptions {
  /** Optional id carried through to the emitted node, handy when debugging a ruleset. */
  id?: string;
  /** UV generation for the emitted node. */
  uv?: UVSpec;
}

/**
 * Emits a box filling the scope.
 *
 * Returns `null` for a scope with no volume, so callers can emit unconditionally
 * and let degenerate splits disappear instead of producing zero-area triangles.
 *
 * @public
 */
export function boxFromScope(scope: Scope, options?: EmitOptions): ProceduralNode | null {
  if (isDegenerate(scope)) {
    return null;
  }
  const rotation = basisToQuaternion(scope.basis);
  const node: ProceduralNode = {
    type: 'box',
    size: [...scope.size] as Vec3,
    position: scopeCenter(scope)
  };
  if (!isIdentityQuaternion(rotation)) {
    node.rotation = rotation;
  }
  if (options?.id) {
    node.id = options.id;
  }
  if (options?.uv) {
    node.uv = options.uv;
  }
  return node;
}

/**
 * Emits a slab of the given depth on a face scope.
 *
 * Positive depth builds outward from the face (a cornice, a sill); negative depth
 * builds inward (a recessed glazing band).
 *
 * @public
 */
export function panelFromFace(face: Scope, depth: number, options?: EmitOptions): ProceduralNode | null {
  if (depth === 0) {
    return null;
  }
  return boxFromScope(extrude(face, depth), options);
}
