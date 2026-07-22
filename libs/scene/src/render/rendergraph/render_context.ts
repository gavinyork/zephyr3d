import type { Nullable } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import type { RGHandle, RGPassBuilder } from './types';
import type { RenderGraph } from './rendergraph';
import type { RGBlackboard } from './blackboard';
import type { HistoryResourceManager } from './history_resource_manager';
import type { RenderQueue } from '../render_queue';

/**
 * Ordering helper that encapsulates the side-effect "order token" chain.
 *
 * Side-effect passes (SkyUpdate, ClusterLights, ...) carry no data product, so
 * they are ordered relative to one another through logical tokens rather than
 * texture reads/writes. This scope tracks the most recently emitted token so a
 * pass can chain after the previous one and (optionally) emit its own, without
 * the builder threading a mutable `orderToken` local between blocks.
 *
 * @public
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
 * Pipeline-agnostic build-time context threaded through a {@link ./render_pipeline#RenderPipeline}.
 *
 * This is the base contract every {@link ./render_module#RenderModule} can rely
 * on, regardless of which concrete pipeline (Forward+, Deferred, or a fully
 * custom one) it belongs to. It carries only pipeline-independent infrastructure:
 * the render graph being populated, the shared resource blackboard, the ordering
 * scope for side-effect passes, the imported backbuffer sink, the cross-frame
 * history manager and the culled render queue.
 *
 * A concrete pipeline extends this with its own context type (see
 * {@link ./frame_graph_context#ForwardPlusModuleContext}) to add the state its
 * modules need — the pipeline and its modules are then parameterized over that
 * context type, so the generic contract never mentions pipeline-specific types.
 *
 * @public
 */
export interface RenderContext {
  /** The render graph being populated for this frame. */
  readonly graph: RenderGraph;
  /** The culled render queue for this frame. */
  readonly renderQueue: RenderQueue;
  /** Named registry of shared frame-resource handles (see {@link ./blackboard#FrameResources}). */
  readonly blackboard: RGBlackboard;
  /** Cross-frame history resource manager, or null when unavailable. */
  readonly history: Nullable<HistoryResourceManager<Texture2D>>;
  /** Ordering-token chain for side-effect passes. */
  readonly ordering: OrderingScope;
  /** The imported backbuffer handle (graph sink). */
  readonly backbuffer: RGHandle;
}
