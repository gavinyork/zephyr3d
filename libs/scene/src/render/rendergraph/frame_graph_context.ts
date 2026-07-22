import type { DrawContext } from '../drawable';
import type { FrameBuffer } from '@zephyr3d/device';
import type { RenderContext } from './render_context';
import type { ForwardPlusOptions, FrameState, ForwardPlusBuildState } from './forward_plus_builder';

/**
 * Forward+ build-time context. Extends the pipeline-agnostic {@link RenderContext}
 * with the state the Forward+ modules need but that is not part of the generic
 * pipeline contract: the frame {@link ../drawable#DrawContext} and the Forward+
 * feature toggles.
 *
 * Handles for well-known frame resources (linear depth, scene color, ...) flow
 * through {@link RenderContext.blackboard} keyed by {@link ./blackboard#FrameResources}.
 *
 * @public
 */
export interface ForwardPlusModuleContext extends RenderContext {
  /** Frame draw context. */
  readonly ctx: DrawContext;
  /** Pipeline feature toggles derived from scene/camera state. */
  readonly options: ForwardPlusOptions;
}

/**
 * @deprecated Renamed to {@link ForwardPlusModuleContext}. The generic,
 * pipeline-agnostic base contract is now {@link RenderContext}; this alias is
 * kept for backward compatibility and will be removed in a future release.
 *
 * @public
 */
export type RenderModuleContext = ForwardPlusModuleContext;

/**
 * Full build-time context threaded through the Forward+ pipeline. Extends the
 * public {@link ForwardPlusModuleContext} with the Forward+ pipeline's internal
 * mutable state, which built-in modules read/write but custom modules should
 * not depend on.
 *
 * @public
 */
export interface FrameGraphContext extends ForwardPlusModuleContext {
  /** Mutable execute-time state shared between pass callbacks. */
  readonly frame: FrameState;
  /** Mutable build-state shared between modules for non-resource intermediates. */
  readonly state: ForwardPlusBuildState;
}

/** Backend framebuffer type used by the Forward+ allocator. */
export type ForwardPlusFramebuffer = FrameBuffer;
