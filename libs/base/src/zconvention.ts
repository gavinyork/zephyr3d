/// <reference path="./zconvention.env.d.ts" />

/**
 * Engine depth convention selected at load time.
 *
 * - Standard-Z: device depth 0 at the near plane, 1 at the far plane.
 * - Reverse-Z (default): device depth 1 at the near plane, 0 at the far plane,
 *   improving floating-point precision at long distances.
 *
 * Selection order:
 * 1. Build-time `__ZEPHYR3D_REVERSE_Z__` define.
 * 2. `globalThis.__ZEPHYR3D_REVERSE_Z__`, set before importing engine modules.
 * 3. Default: Reverse-Z.
 *
 * The convention is process-wide and immutable. For the same eye-space position,
 * `standardDepth + reverseDepth === 1`.
 */

function resolveReverseZ(): boolean {
  if (typeof __ZEPHYR3D_REVERSE_Z__ !== 'undefined') {
    return !!__ZEPHYR3D_REVERSE_Z__;
  }
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__ZEPHYR3D_REVERSE_Z__ !== 'undefined') {
    return !!g.__ZEPHYR3D_REVERSE_Z__;
  }
  return true;
}

/**
 * Depth comparison directions expressed as the engine's `CompareFunc`
 * string values (structurally compatible with `@zephyr3d/device`).
 */
export type DepthCompareFunc = 'lt' | 'le' | 'gt' | 'ge';

/** Names of the two-argument reduction functions selecting between depths. */
export type DepthReduceFunc = 'min' | 'max';

/** Whether the engine runs with the Reverse-Z depth convention. */
export const REVERSE_Z: boolean = resolveReverseZ();

/** Human readable name of the active depth convention. */
export const Z_CONVENTION: 'standard' | 'reverse' = REVERSE_Z ? 'reverse' : 'standard';

/** Device depth value the depth buffer must be cleared to. */
export const DEPTH_CLEAR_VALUE: number = REVERSE_Z ? 0 : 1;

/** Device depth value at the far plane (background/sky). */
export const DEPTH_FARTHEST: number = REVERSE_Z ? 0 : 1;

/** Device depth value at the near plane. */
export const DEPTH_NEAREST: number = REVERSE_Z ? 1 : 0;

/** Default depth test: pass when the incoming fragment is closer or equal. */
export const DEPTH_COMPARE_DEFAULT: DepthCompareFunc = REVERSE_Z ? 'ge' : 'le';

/** Depth test passing when the incoming fragment is strictly closer. */
export const DEPTH_COMPARE_CLOSER: DepthCompareFunc = REVERSE_Z ? 'gt' : 'lt';

/** Depth test passing when the incoming fragment is closer or equal. */
export const DEPTH_COMPARE_CLOSER_EQUAL: DepthCompareFunc = REVERSE_Z ? 'ge' : 'le';

/** Depth test passing when the incoming fragment is strictly farther. */
export const DEPTH_COMPARE_FARTHER: DepthCompareFunc = REVERSE_Z ? 'lt' : 'gt';

/** Depth test passing when the incoming fragment is farther or equal. */
export const DEPTH_COMPARE_FARTHER_EQUAL: DepthCompareFunc = REVERSE_Z ? 'le' : 'ge';

/** Reduction function that selects the closer of two device depth values. */
export const DEPTH_REDUCE_CLOSER: DepthReduceFunc = REVERSE_Z ? 'max' : 'min';

/** Reduction function that selects the farther of two device depth values. */
export const DEPTH_REDUCE_FARTHER: DepthReduceFunc = REVERSE_Z ? 'min' : 'max';

/** Returns the closer of two device depth values. */
export function closerDepth(a: number, b: number): number {
  return Math[DEPTH_REDUCE_CLOSER](a, b);
}

/** Returns the farther of two device depth values. */
export function fartherDepth(a: number, b: number): number {
  return Math[DEPTH_REDUCE_FARTHER](a, b);
}
