import type { Nullable } from '@zephyr3d/base';
import type { RGHandle, RGPassBuilder } from './types';
import type { RenderGraph } from './rendergraph';
import type { RGBlackboard } from './blackboard';
import type { HistoryResourceManager } from './history_resource_manager';
import type { DrawContext } from '../drawable';
import type { RenderQueue } from '../render_queue';
import type { Texture2D, FrameBuffer } from '@zephyr3d/device';
import type { ForwardPlusOptions, FrameState } from './forward_plus_builder';

/**
 * Ordering helper that encapsulates the side-effect "order token" chain.
 *
 * Side-effect passes (SkyUpdate, ClusterLights, ...) carry no data product, so
 * they are ordered relative to one another through logical tokens rather than
 * texture reads/writes. This scope tracks the most recently emitted token so a
 * pass can chain after the previous one and (optionally) emit its own, without
 * the builder threading a mutable `orderToken` local between blocks.
 *
 * @internal
 */
export class OrderingScope {
  /** @internal */
  private _last: Nullable<RGHandle> = null;

  /**
   * Declare a read on the most recently emitted ordering token, if any, to
   * order the current pass after the previous side-effect pass.
   *
   * @param builder - The pass builder of the current pass.
   */
  chainInto(builder: RGPassBuilder): void {
    if (this._last) {
      builder.read(this._last);
    }
  }

  /**
   * Emit a new ordering token from the current pass and record it as the latest
   * link in the chain.
   *
   * @param builder - The pass builder of the current pass.
   * @param name - Debug label for the token.
   * @returns The newly created token handle.
   */
  emit(builder: RGPassBuilder, name: string): RGHandle {
    const token = builder.createToken(name);
    this._last = token;
    return token;
  }

  /** The most recently emitted ordering token, or null. */
  get last(): Nullable<RGHandle> {
    return this._last;
  }
}

/**
 * Build-time context threaded through the Forward+ graph assembly.
 *
 * This aggregates everything the individual pass-build blocks previously reached
 * through enclosing function locals (`orderToken`, the mutable `depthHandle`,
 * result bundles, ...). Collecting them here is the seam that lets each pass be
 * expressed as an independent unit reading its inputs from a shared context
 * rather than from closure-captured variables.
 *
 * Handles for well-known frame resources (linear depth, scene color, ...) flow
 * through {@link FrameGraphContext.blackboard} keyed by
 * {@link ./blackboard#FrameResources}; the mutable execute-time state that is
 * not a render-graph resource stays on {@link FrameGraphContext.frame}.
 *
 * @internal
 */
export interface FrameGraphContext {
  /** The render graph being populated for this frame. */
  readonly graph: RenderGraph;
  /** Frame draw context. */
  readonly ctx: DrawContext;
  /** The culled render queue for this frame. */
  readonly renderQueue: RenderQueue;
  /** Named registry of shared frame-resource handles. */
  readonly blackboard: RGBlackboard;
  /** Mutable execute-time state shared between pass callbacks. */
  readonly frame: FrameState;
  /** Cross-frame history resource manager, or null when unavailable. */
  readonly history: Nullable<HistoryResourceManager<Texture2D>>;
  /** Pipeline feature toggles derived from scene/camera state. */
  readonly options: ForwardPlusOptions;
  /** Ordering-token chain for side-effect passes. */
  readonly ordering: OrderingScope;
  /** The imported backbuffer handle (graph sink). */
  readonly backbuffer: RGHandle;
}

/** Backend framebuffer type used by the Forward+ allocator. */
export type ForwardPlusFramebuffer = FrameBuffer;
