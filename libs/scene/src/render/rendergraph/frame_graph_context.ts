import type { DrawContext } from '../drawable';
import type { FrameBuffer } from '@zephyr3d/device';
import type { RenderContext } from './render_context';
import type { ForwardPlusOptions, FrameState, ForwardPlusBuildState } from './forward_plus_builder';

/** Forward+ module build context. @public */
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

/** Forward+ build context including internal shared state. @public */
export interface FrameGraphContext extends ForwardPlusModuleContext {
  /** Mutable execute-time state shared between pass callbacks. */
  readonly frame: FrameState;
  /** Mutable build-state shared between modules for non-resource intermediates. */
  readonly state: ForwardPlusBuildState;
}

/** Backend framebuffer type used by the Forward+ allocator. */
export type ForwardPlusFramebuffer = FrameBuffer;
