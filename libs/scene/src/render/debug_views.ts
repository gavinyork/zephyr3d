import type { Nullable } from '@zephyr3d/base';
import { DEBUG_VIEWS } from '@zephyr3d/base';
import type { DrawContext } from './drawable';
import { RENDER_PASS_TYPE_DEPTH, RENDER_PASS_TYPE_LIGHT } from '../values';

/**
 * Wireframe debug view: while active, triangle primitives draw as the edges of their triangles,
 * see Primitive. Nested, so a wireframe mesh drawn inside a wireframe view ends it only once.
 */
let wireframeDepth = 0;

/** @internal Whether primitives drawn now are drawn as wireframe */
export function isWireframeActive() {
  return DEBUG_VIEWS && wireframeDepth > 0;
}

/**
 * @internal Whether a draw in this context may draw wireframe: the depth and light passes, which
 * must agree for the light pass's equal depth test. Shadows and picking keep the triangles.
 */
export function isWireframePass(ctx: Nullable<DrawContext>) {
  const type = ctx?.renderPass?.type;
  return DEBUG_VIEWS && (type === RENDER_PASS_TYPE_LIGHT || type === RENDER_PASS_TYPE_DEPTH);
}

/** @internal Start drawing primitives as wireframe, until the matching {@link endWireframe} */
export function beginWireframe() {
  wireframeDepth++;
}

/** @internal End a {@link beginWireframe} */
export function endWireframe() {
  wireframeDepth = Math.max(0, wireframeDepth - 1);
}

const warned = new Set<string>();

/**
 * @internal Warn once that a debug view was turned on without DEBUG_VIEWS, where it has no effect.
 * @returns DEBUG_VIEWS
 */
export function checkDebugViews(name: string) {
  if (!DEBUG_VIEWS && !warned.has(name)) {
    warned.add(name);
    console.warn(
      `${name} is a debug view and has no effect: set globalThis.__ZEPHYR3D_DEBUG_VIEWS__ = true before the engine loads to use it`
    );
  }
  return DEBUG_VIEWS;
}
