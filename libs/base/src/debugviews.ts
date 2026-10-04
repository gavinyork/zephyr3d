/// <reference path="./debugviews.env.d.ts" />

/**
 * Whether debug views are available, selected at load time.
 *
 * Debug views (wireframe, level of detail coloration, ...) only take effect when this is true.
 * Some take extra memory, draw calls or shader resources even while turned off, which a build
 * without them does not pay: the editor turns them on, shipped applications leave them off.
 *
 * Selection order:
 * 1. Build-time `__ZEPHYR3D_DEBUG_VIEWS__` define.
 * 2. `globalThis.__ZEPHYR3D_DEBUG_VIEWS__`, set before importing engine modules.
 * 3. Default: off.
 *
 * The setting is process-wide and immutable.
 */
function resolveDebugViews(): boolean {
  if (typeof __ZEPHYR3D_DEBUG_VIEWS__ !== 'undefined') {
    return !!__ZEPHYR3D_DEBUG_VIEWS__;
  }
  const g = globalThis as Record<string, unknown>;
  return !!g.__ZEPHYR3D_DEBUG_VIEWS__;
}

/**
 * Whether debug views (wireframe, level of detail coloration, ...) are available. Set with the
 * `__ZEPHYR3D_DEBUG_VIEWS__` build-time define or `globalThis.__ZEPHYR3D_DEBUG_VIEWS__` before
 * engine modules load; off by default. The editor turns it on.
 * @public
 */
export const DEBUG_VIEWS: boolean = resolveDebugViews();
