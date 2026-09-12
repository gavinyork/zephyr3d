import type { Vec3 } from '@zephyr3d/modelgen';

/**
 * An oriented box that geometry rules operate on, equivalent to the "scope" of a
 * CGA shape grammar.
 *
 * The scope is defined by its minimum corner plus an orthonormal local frame, so
 * local coordinates run from `[0, 0, 0]` to {@link Scope.size}. Keeping the origin
 * at the corner (rather than the centre) is what makes splitting cheap: a split
 * only walks the origin along one axis.
 *
 * A face scope produced by {@link faceOf} has `size[2] === 0`; use {@link extrude}
 * to give it thickness before emitting geometry.
 *
 * @public
 */
export interface Scope {
  /** World-space position of the scope's local origin (its minimum corner). */
  origin: Vec3;
  /** Orthonormal local X, Y and Z axes expressed in world space. Right-handed. */
  basis: [Vec3, Vec3, Vec3];
  /** Extents along the local X, Y and Z axes. Never negative. */
  size: Vec3;
}

/**
 * The six faces of a scope, named by the local axis they face along.
 * @public
 */
export type FaceName = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/**
 * One entry in a {@link split} size list.
 *
 * - `absolute` - a fixed length in world units.
 * - `relative` - a fraction of the axis extent being split.
 * - `floating` - a weight; floating entries share whatever length is left over.
 *
 * @public
 */
export type SplitSize =
  | { kind: 'absolute'; value: number }
  | { kind: 'relative'; value: number }
  | { kind: 'floating'; value: number };

/** A fixed length in world units. @public */
export function abs(value: number): SplitSize {
  return { kind: 'absolute', value };
}

/** A fraction (0..1) of the axis being split. @public */
export function rel(value: number): SplitSize {
  return { kind: 'relative', value };
}

/** A weight that absorbs leftover length. @public */
export function flt(value = 1): SplitSize {
  return { kind: 'floating', value };
}

const IDENTITY_BASIS: [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1]
];

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

function cloneBasis(basis: [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
  return [[...basis[0]], [...basis[1]], [...basis[2]]];
}

/**
 * Creates an axis-aligned scope sitting on the XZ plane.
 *
 * @param size - Extents along X, Y and Z.
 * @param origin - World position of the minimum corner. Defaults to the world origin.
 * @param basis - Local frame. Defaults to the world axes.
 * @public
 */
export function createScope(size: Vec3, origin: Vec3 = [0, 0, 0], basis?: [Vec3, Vec3, Vec3]): Scope {
  return {
    origin: [...origin],
    basis: basis ? cloneBasis(basis) : cloneBasis(IDENTITY_BASIS),
    size: [Math.max(0, size[0]), Math.max(0, size[1]), Math.max(0, size[2])]
  };
}

/** Deep-copies a scope. @public */
export function cloneScope(scope: Scope): Scope {
  return {
    origin: [...scope.origin],
    basis: cloneBasis(scope.basis),
    size: [...scope.size]
  };
}

/**
 * Converts a point in the scope's local coordinates to world space.
 * @public
 */
export function localToWorld(scope: Scope, local: Vec3): Vec3 {
  const [bx, by, bz] = scope.basis;
  return [
    scope.origin[0] + bx[0] * local[0] + by[0] * local[1] + bz[0] * local[2],
    scope.origin[1] + bx[1] * local[0] + by[1] * local[1] + bz[1] * local[2],
    scope.origin[2] + bx[2] * local[0] + by[2] * local[1] + bz[2] * local[2]
  ];
}

/** World-space centre of the scope. @public */
export function scopeCenter(scope: Scope): Vec3 {
  return localToWorld(scope, [scope.size[0] * 0.5, scope.size[1] * 0.5, scope.size[2] * 0.5]);
}

/**
 * Resolves a list of {@link SplitSize} entries into concrete lengths along an axis
 * of the given total extent.
 *
 * Absolute and relative entries are taken first; floating entries then share the
 * remainder by weight. If there are no floating entries and the fixed lengths do
 * not add up to `total`, every entry is scaled to fit, so a split never silently
 * overflows or leaves a gap.
 *
 * @public
 */
export function resolveSplit(total: number, sizes: readonly SplitSize[]): number[] {
  if (sizes.length === 0) {
    return [];
  }
  const lengths = sizes.map((size) => {
    switch (size.kind) {
      case 'absolute':
        return Math.max(0, size.value);
      case 'relative':
        return Math.max(0, size.value) * total;
      default:
        return 0;
    }
  });
  const floatWeight = sizes.reduce(
    (sum, size) => (size.kind === 'floating' ? sum + Math.max(0, size.value) : sum),
    0
  );
  const fixed = lengths.reduce((sum, value) => sum + value, 0);

  if (floatWeight > 0) {
    const remainder = Math.max(0, total - fixed);
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      if (size.kind === 'floating') {
        lengths[i] = (remainder * Math.max(0, size.value)) / floatWeight;
      }
    }
    // Fixed entries alone already overflow: fall through to the rescale below.
    if (fixed <= total) {
      return lengths;
    }
  }

  if (fixed > 0 && Math.abs(fixed - total) > 1e-9) {
    const k = total / fixed;
    for (let i = 0; i < lengths.length; i++) {
      lengths[i] *= k;
    }
  }
  return lengths;
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/**
 * The local axis a {@link split} or {@link repeat} runs along.
 * @public
 */
export type ScopeAxis = keyof typeof AXIS_INDEX;

/**
 * Splits a scope along one local axis, returning one child scope per size entry.
 *
 * Children keep the parent's orientation and its extents on the other two axes.
 * @public
 */
export function split(scope: Scope, axis: ScopeAxis, sizes: readonly SplitSize[]): Scope[] {
  const index = AXIS_INDEX[axis];
  const lengths = resolveSplit(scope.size[index], sizes);
  const direction = scope.basis[index];
  const children: Scope[] = [];
  let cursor = 0;
  for (const length of lengths) {
    const size: Vec3 = [...scope.size];
    size[index] = length;
    children.push({
      origin: add(scope.origin, scale(direction, cursor)),
      basis: cloneBasis(scope.basis),
      size
    });
    cursor += length;
  }
  return children;
}

/**
 * Divides a scope along one axis into equal slices of roughly `approxSize`.
 *
 * The slice count is rounded to the nearest whole number so slices always tile the
 * axis exactly — this is what keeps floors and facade bays aligned.
 *
 * @param approxSize - Preferred slice length; the actual length is adjusted to fit.
 * @param limits - Optional clamp on the resulting slice count.
 * @public
 */
export function repeat(
  scope: Scope,
  axis: ScopeAxis,
  approxSize: number,
  limits?: { min?: number; max?: number }
): Scope[] {
  const index = AXIS_INDEX[axis];
  const extent = scope.size[index];
  if (extent <= 0 || approxSize <= 0) {
    return [];
  }
  let count = Math.round(extent / approxSize);
  count = Math.max(limits?.min ?? 1, count);
  if (limits?.max !== undefined) {
    count = Math.min(limits.max, count);
  }
  return split(scope, axis, new Array<SplitSize>(count).fill(flt(1)));
}

/**
 * Extracts one face of a scope as a flat scope whose local Z is the outward normal.
 *
 * The result has `size[2] === 0`, local Y pointing along the parent's up axis for
 * the four side faces, and local X sweeping the face left to right when viewed from
 * outside. Feed it to {@link extrude} to build panels, or to {@link split} to lay
 * out a facade.
 *
 * @public
 */
export function faceOf(scope: Scope, face: FaceName): Scope {
  const [bx, by, bz] = scope.basis;
  const [sx, sy, sz] = scope.size;
  switch (face) {
    case '+x':
      return {
        origin: localToWorld(scope, [sx, 0, sz]),
        basis: [negate(bz), [...by], [...bx]],
        size: [sz, sy, 0]
      };
    case '-x':
      return {
        origin: localToWorld(scope, [0, 0, 0]),
        basis: [[...bz], [...by], negate(bx)],
        size: [sz, sy, 0]
      };
    case '+z':
      return {
        origin: localToWorld(scope, [0, 0, sz]),
        basis: [[...bx], [...by], [...bz]],
        size: [sx, sy, 0]
      };
    case '-z':
      return {
        origin: localToWorld(scope, [sx, 0, 0]),
        basis: [negate(bx), [...by], negate(bz)],
        size: [sx, sy, 0]
      };
    case '+y':
      return {
        origin: localToWorld(scope, [0, sy, 0]),
        basis: [[...bz], [...bx], [...by]],
        size: [sz, sx, 0]
      };
    default:
      return {
        origin: localToWorld(scope, [0, 0, 0]),
        basis: [[...bx], [...bz], negate(by)],
        size: [sx, sz, 0]
      };
  }
}

/**
 * The four vertical faces of a scope, in +x, -x, +z, -z order.
 * @public
 */
export function sideFaces(scope: Scope): Scope[] {
  return [faceOf(scope, '+x'), faceOf(scope, '-x'), faceOf(scope, '+z'), faceOf(scope, '-z')];
}

/**
 * Gives a scope thickness along its local Z.
 *
 * A positive depth grows along +Z (outward, for a face scope); a negative depth
 * grows along -Z while keeping the extent positive.
 *
 * @public
 */
export function extrude(scope: Scope, depth: number): Scope {
  const result = cloneScope(scope);
  if (depth >= 0) {
    result.size[2] = scope.size[2] + depth;
    return result;
  }
  result.origin = add(scope.origin, scale(scope.basis[2], depth));
  result.size[2] = scope.size[2] - depth;
  return result;
}

/**
 * Shrinks a scope towards its centre, removing `amounts[i]` from *each* side of
 * axis `i`.
 *
 * Pass `[dx, dy, 0]` to inset a face scope, `[dx, 0, dz]` to inset a plan.
 *
 * @public
 */
export function inset(scope: Scope, amounts: Vec3): Scope {
  const d: Vec3 = [
    Math.min(amounts[0], scope.size[0] * 0.5),
    Math.min(amounts[1], scope.size[1] * 0.5),
    Math.min(amounts[2], scope.size[2] * 0.5)
  ];
  return {
    origin: localToWorld(scope, d),
    basis: cloneBasis(scope.basis),
    size: [
      Math.max(0, scope.size[0] - d[0] * 2),
      Math.max(0, scope.size[1] - d[1] * 2),
      Math.max(0, scope.size[2] - d[2] * 2)
    ]
  };
}

/**
 * Translates a scope along one of its own local axes.
 * @public
 */
export function offsetLocal(scope: Scope, axis: ScopeAxis, amount: number): Scope {
  const result = cloneScope(scope);
  result.origin = add(scope.origin, scale(scope.basis[AXIS_INDEX[axis]], amount));
  return result;
}

/**
 * Resizes a scope about its centre by a per-axis factor.
 *
 * Useful for setbacks, where an upper mass keeps the lower mass's centreline:
 * `scaleAboutCenter(mass, [0.7, 1, 0.7])`.
 *
 * @public
 */
export function scaleAboutCenter(scope: Scope, factors: Vec3): Scope {
  const size: Vec3 = [
    Math.max(0, scope.size[0] * factors[0]),
    Math.max(0, scope.size[1] * factors[1]),
    Math.max(0, scope.size[2] * factors[2])
  ];
  return {
    origin: localToWorld(scope, [
      (scope.size[0] - size[0]) * 0.5,
      (scope.size[1] - size[1]) * 0.5,
      (scope.size[2] - size[2]) * 0.5
    ]),
    basis: cloneBasis(scope.basis),
    size
  };
}

/** True when the scope has no volume worth emitting geometry for. @public */
export function isDegenerate(scope: Scope, epsilon = 1e-6): boolean {
  return scope.size[0] <= epsilon || scope.size[1] <= epsilon || scope.size[2] <= epsilon;
}
