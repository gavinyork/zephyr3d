import type { Nullable } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import type { RGHandle, RGPassBuilder } from './types';
import type { RenderGraph } from './rendergraph';
import type { RGBlackboard } from './blackboard';
import type { HistoryResourceManager } from './history_resource_manager';
import type { RenderQueue } from '../render_queue';

/** Orders side-effect passes through logical tokens. @public */
export class OrderingScope {
  /** @internal */
  private _last: Nullable<RGHandle> = null;

  /** Order the current pass after the latest token, if any. */
  chainInto(builder: RGPassBuilder): void {
    if (this._last) {
      builder.read(this._last);
    }
  }

  /** Emit and record a new ordering token. */
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

/** Pipeline-independent context used while building graph modules. @public */
export interface RenderContext {
  /** The external framebuffer presented by this frame, or null for the screen. */
  readonly finalFramebuffer: FrameBuffer | null;
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
