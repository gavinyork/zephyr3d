/**
 * Enumerator used to refer to a box side
 * @public
 */
export enum BoxSide {
  /** Left side (-x) */
  LEFT = 0,
  /** Right side (+x) */
  RIGHT = 1,
  /** Bottom side (-y) */
  BOTTOM = 2,
  /** Top side (+y) */
  TOP = 3,
  /** Front side (+z) */
  FRONT = 4,
  /** Back side (-z) */
  BACK = 5
}

/**
 * The intersection test result of two object A and B
 * @public
 */
export enum ClipState {
  /** A does not intersect with B */
  NOT_CLIPPED = 0,
  /** A is inside B */
  A_INSIDE_B = 1,
  /** B is inside A */
  B_INSIDE_A = 2,
  /** A and B partially overlap */
  CLIPPED = 2
}

/**
 * Enumerator used to refer to the cube face
 * @public
 */
export enum CubeFace {
  PX = 0,
  NX = 1,
  PY = 2,
  NY = 3,
  PZ = 4,
  NZ = 5
}
