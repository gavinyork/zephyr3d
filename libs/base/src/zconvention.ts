/// <reference path="./zconvention.env.d.ts" />

/**
 * Depth (Z) convention of the engine.
 *
 * The engine supports two depth conventions selected at load time:
 *
 * - Standard-Z: device depth 0 at the near plane, 1 at the far plane.
 * - Reverse-Z (default): device depth 1 at the near plane, 0 at the far plane. With a
 *   floating point depth buffer this yields a nearly uniform depth error
 *   distribution and greatly reduces far-distance z-fighting.
 *
 * Selection precedence:
 *
 * 1. Build-time define: bundlers may replace the bare identifier
 *    `__ZEPHYR3D_REVERSE_Z__` with a boolean literal so the unused code path
 *    can be eliminated by the minifier.
 * 2. Runtime global: `globalThis.__ZEPHYR3D_REVERSE_Z__`, which must be set
 *    before the first import of any `@zephyr3d/*` module.
 * 3. Default: Reverse-Z.
 *
 * The convention is fixed for the lifetime of the process. All engine code
 * must consume the derived constants below instead of hard-coding depth
 * values or comparison directions.
 *
 * The two conventions are related by the exact invariant
 * `standardDepth + reverseDepth === 1` for the same eye-space position.
 */

function resolveReverseZ(): boolean {
  // 1) Build-time define injected by the application bundler
  if (typeof __ZEPHYR3D_REVERSE_Z__ !== 'undefined') {
    return !!__ZEPHYR3D_REVERSE_Z__;
  }
  // 2) Runtime global fallback (must be set before engine modules load)
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__ZEPHYR3D_REVERSE_Z__ !== 'undefined') {
    return !!g.__ZEPHYR3D_REVERSE_Z__;
  }
  // 3) Default: Reverse-Z
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
