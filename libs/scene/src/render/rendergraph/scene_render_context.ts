import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import type { Camera } from '../../camera';
import { MaterialVaryingFlags } from '../../values';
import type { DrawContext, Drawable } from '../drawable';
import { RenderQueue, InstanceBindGroupAllocator } from '../render_queue';
import { LightPass } from '../lightpass';
import { DepthPass } from '../depthpass';
import type { RGExecuteContext } from './types';

// Surface MRT store flags (SSR roughness/normal, SSS profile/diffuse/... , skin
// SSS). The facade never binds those extra MRT attachments, so it masks these
// off before rendering to avoid materials writing into attachments that do not
// exist on the user-provided target.
const SURFACE_MRT_FLAGS =
  MaterialVaryingFlags.SCENE_STORE_ROUGHNESS |
  MaterialVaryingFlags.SSS_STORE_PROFILE |
  MaterialVaryingFlags.SSS_STORE_DIFFUSE |
  MaterialVaryingFlags.SCENE_STORE_NORMAL |
  MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
  MaterialVaryingFlags.SKIN_SSS_STORE;

// Dedicated pass singletons owned by the facade. Kept separate from the built-in
// Forward+ `_scenePass`/`_depthPass` so a custom pass rendering through the
// facade can never leak render-control state (transmission / renderOpaque / ...)
// into the built-in pipeline passes, and vice versa.
const _sceneLightPass = new LightPass();
const _sceneDepthPass = new DepthPass();

/**
 * Options for a facade scene render call.
 *
 * Every clear field defaults to `undefined`, which means "do not clear that
 * buffer". Pass an explicit value to clear (e.g. `clearColor: Vector4.zero()`);
 * pass `null` to also skip the clear. This no-clear default lets successive
 * calls (e.g. {@link SceneRenderContext.renderOpaque} then
 * {@link SceneRenderContext.renderTransparent}) accumulate into one target.
 *
 * @public
 */
export interface SceneRenderOptions {
  /** Camera whose uniforms drive the render. Defaults to the frame's `ctx.camera`. */
  camera?: Camera;
  /** Color clear value. Omit or pass null to skip the color clear. */
  clearColor?: Nullable<Vector4>;
  /** Depth clear value. Omit or pass null to skip the depth clear. */
  clearDepth?: Nullable<number>;
  /** Stencil clear value. Omit or pass null to skip the stencil clear. */
  clearStencil?: Nullable<number>;
}

/**
 * Builder for a user-authored render queue.
 *
 * Obtained from {@link SceneRenderContext.createQueue}. Add drawables with
 * {@link SceneRenderQueueBuilder.add}, then call
 * {@link SceneRenderQueueBuilder.finalize} to run the queue's batching /
 * bind-group allocation and get a renderable {@link RenderQueue}. A queue must
 * be finalized before it can be rendered; the split return type enforces this.
 *
 * The produced queue is owned by the {@link SceneRenderContext}: it is disposed
 * automatically when the graph pass finishes. Do not cache it across frames —
 * the instance bind groups it allocates are frame-scoped.
 *
 * @public
 */
export interface SceneRenderQueueBuilder {
  /**
   * Add a drawable to the queue. The object is routed into the correct sub-list
   * (opaque / transmission / transparent, lit / unlit) automatically.
   *
   * @param drawable - The object to draw.
   * @param camera - Camera used for sort-distance/pick bookkeeping. Defaults to
   *   the frame's `ctx.camera`.
   */
  add(drawable: Drawable, camera?: Camera): this;

  /**
   * Finalize the queue (run instance batching and bind-group allocation) and
   * return a renderable {@link RenderQueue}.
   *
   * @param camera - Camera used to finalize sort/instance data. Defaults to the
   *   frame's `ctx.camera`.
   */
  finalize(camera?: Camera): RenderQueue;
}

/**
 * A render queue that persists across frames.
 *
 * Unlike the transient queues from {@link SceneRenderContext.createQueue} /
 * {@link SceneRenderContext.cull} (which are disposed when the pass finishes),
 * a persistent queue owns a private {@link ../render_queue#InstanceBindGroupAllocator}
 * and is caller-managed: build it once, reuse its {@link PersistentSceneQueue.queue}
 * every frame, and rebuild only when its contents change. This mirrors how
 * {@link ../../scene/batchgroup#BatchGroup} caches its queue.
 *
 * Because it holds a private allocator, its frame-scoped instance bind groups are
 * not clobbered by other queues between frames, so cross-frame reuse is safe as
 * long as the queue is finalized after the last content change.
 *
 * The caller owns the lifetime: call {@link PersistentSceneQueue.dispose} when
 * done (e.g. when the owning module/effect is torn down). Do not register it for
 * the pass-scoped cleanup.
 *
 * @public
 */
export interface PersistentSceneQueue {
  /**
   * The underlying renderable queue. Pass it to the facade's render methods.
   * Only valid after at least one {@link PersistentSceneQueue.finalize}.
   */
  readonly queue: RenderQueue;

  /**
   * Clear the queue's contents for a rebuild. Call before re-adding drawables
   * when the set of objects changed.
   */
  clear(): this;

  /**
   * Add a drawable. `camera` is used for sort-distance/pick bookkeeping.
   */
  add(drawable: Drawable, camera: Camera): this;

  /**
   * Finalize the queue (instance batching + bind-group allocation) so it can be
   * rendered. Call after adding drawables, and re-call after any rebuild.
   *
   * @param camera - Camera used to finalize sort/instance data.
   * @param createRenderBundles - Build render bundles for reuse (recommended for
   *   static, cross-frame queues). Default false.
   */
  finalize(camera: Camera, createRenderBundles?: boolean): this;

  /** Release the queue and its private allocator's GPU resources. */
  dispose(): void;
}

/**
 * Execute-time facade that lets a custom render-graph pass render scene objects
 * without touching the built-in pipeline's shared pass singletons or the manual
 * device-state save/restore dance.
 *
 * Obtain one inside a pass execute callback via
 * {@link ../frame_graph_context#FrameGraphContext} (`createSceneRenderer(fg, rgCtx)`),
 * then either render the frame's already-culled queue or build your own:
 *
 * ```ts
 * builder.setExecute((rgCtx) => {
 *   const target = rgCtx.getFramebuffer<FrameBuffer>(fbHandle);
 *   const sr = createSceneRenderer(fg, rgCtx);
 *   const queue = sr.createQueue().add(myMesh).finalize();
 *   sr.renderScene(target, queue, { clearColor: Vector4.zero(), clearDepth: 1 });
 * });
 * ```
 *
 * The render target framebuffer must still be declared to the graph (via
 * `builder.createFramebuffer` / `builder.write`) at setup time; the facade does
 * not create graph dependencies.
 *
 * @public
 */
export interface SceneRenderContext {
  /** The frame draw context (camera, scene, env, device). */
  readonly ctx: DrawContext;

  /**
   * Cull the scene into a fresh queue, optionally with a different camera and/or
   * a drawable filter. The returned queue is owned by the facade and disposed
   * when the pass finishes.
   *
   * @param camera - Camera to cull with. Defaults to the frame's `ctx.camera`.
   * @param filter - Optional predicate; only drawables for which it returns true
   *   are kept.
   */
  cull(camera?: Camera, filter?: (drawable: Drawable) => boolean): RenderQueue;

  /**
   * Start building a user-authored queue. Add drawables, then `finalize()`.
   */
  createQueue(): SceneRenderQueueBuilder;

  /**
   * Render the opaque and transparent geometry of a queue into `target`.
   *
   * @param target - Destination framebuffer (resolve from a graph handle).
   * @param queue - A finalized render queue.
   * @param opts - Clear / camera options.
   */
  renderScene(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /** Render only the opaque geometry of a queue. See {@link SceneRenderContext.renderScene}. */
  renderOpaque(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /** Render only the transparent geometry of a queue. See {@link SceneRenderContext.renderScene}. */
  renderTransparent(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /** Render a linear-depth pass for a queue's opaque geometry. See {@link SceneRenderContext.renderScene}. */
  renderDepth(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /**
   * Create a persistent, caller-managed queue backed by a private
   * {@link ../render_queue#InstanceBindGroupAllocator}.
   *
   * Unlike the transient queues from {@link SceneRenderContext.createQueue} /
   * {@link SceneRenderContext.cull}, this queue is **not** disposed when the
   * pass finishes. Build it once, reuse it every frame, and call
   * {@link PersistentSceneQueue.clear} + re-add + {@link PersistentSceneQueue.finalize}
   * only when its contents change. Call {@link PersistentSceneQueue.dispose}
   * when the queue is no longer needed.
   */
  createPersistentQueue(): PersistentSceneQueue;
}

/** @internal */
class SceneRenderContextImpl implements SceneRenderContext {
  private readonly _ctx: DrawContext;
  private readonly _rgCtx: RGExecuteContext;
  /** Queues created by this facade, disposed together when the pass finishes. */
  private readonly _ownedQueues: RenderQueue[] = [];
  private _cleanupRegistered = false;

  constructor(ctx: DrawContext, rgCtx: RGExecuteContext) {
    this._ctx = ctx;
    this._rgCtx = rgCtx;
  }

  get ctx(): DrawContext {
    return this._ctx;
  }

  /** Track a facade-owned queue and register the one-time cleanup callback. */
  private _own(queue: RenderQueue): RenderQueue {
    this._ownedQueues.push(queue);
    if (!this._cleanupRegistered) {
      this._cleanupRegistered = true;
      this._rgCtx.deferCleanup(() => {
        for (const q of this._ownedQueues) {
          q.dispose();
        }
        this._ownedQueues.length = 0;
      });
    }
    return queue;
  }

  cull(camera?: Camera, filter?: (drawable: Drawable) => boolean): RenderQueue {
    const cullCamera = camera ?? this._ctx.camera;
    const queue = _sceneLightPass.cullScene(this._ctx, cullCamera);
    if (!filter) {
      return this._own(queue);
    }
    // Rebuild a filtered queue: cullScene already finalized `queue`, so re-push
    // the surviving drawables into a fresh queue and finalize that instead.
    const filtered = new RenderQueue(_sceneLightPass);
    const itemList = queue.itemList;
    if (itemList) {
      const seen = new Set<Drawable>();
      const bundles = [
        itemList.opaque,
        itemList.transmission,
        itemList.transparent,
        itemList.transmission_trans
      ];
      for (const bundle of bundles) {
        for (const info of [...bundle.lit, ...bundle.unlit]) {
          const sources = [
            info.itemList,
            info.skinItemList,
            info.morphItemList,
            info.skinAndMorphItemList,
            info.instanceItemList
          ];
          for (const list of sources) {
            for (const item of list) {
              const drawable = item.drawable;
              if (!seen.has(drawable) && filter(drawable)) {
                seen.add(drawable);
                filtered.push(cullCamera, drawable);
              }
            }
          }
        }
      }
    }
    filtered.primaryDirectionalLight = queue.primaryDirectionalLight;
    filtered.primaryTransmissionLight = queue.primaryTransmissionLight;
    filtered.sunLight = queue.sunLight;
    finalizeQueue(filtered, cullCamera);
    queue.dispose();
    return this._own(filtered);
  }

  createPersistentQueue(): PersistentSceneQueue {
    const allocator = new InstanceBindGroupAllocator();
    const queue = new RenderQueue(_sceneLightPass, allocator);
    return {
      get queue(): RenderQueue {
        return queue;
      },
      clear(): PersistentSceneQueue {
        queue.reset();
        return this;
      },
      add(drawable: Drawable, camera: Camera): PersistentSceneQueue {
        queue.push(camera, drawable);
        return this;
      },
      finalize(camera: Camera, createRenderBundles?: boolean): PersistentSceneQueue {
        finalizeQueue(queue, camera, createRenderBundles);
        return this;
      },
      dispose(): void {
        queue.dispose();
      }
    };
  }

  createQueue(): SceneRenderQueueBuilder {
    const owner = this;
    const queue = new RenderQueue(_sceneLightPass);
    let finalized = false;
    const builder: SceneRenderQueueBuilder = {
      add(drawable: Drawable, camera?: Camera): SceneRenderQueueBuilder {
        if (finalized) {
          throw new Error('SceneRenderQueueBuilder: cannot add() after finalize().');
        }
        queue.push(camera ?? owner._ctx.camera, drawable);
        return builder;
      },
      finalize(camera?: Camera): RenderQueue {
        if (finalized) {
          throw new Error('SceneRenderQueueBuilder: finalize() called more than once.');
        }
        finalized = true;
        finalizeQueue(queue, camera ?? owner._ctx.camera);
        return owner._own(queue);
      }
    };
    return builder;
  }

  renderScene(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void {
    this._renderColor(target, queue, opts, true, true);
  }

  renderOpaque(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void {
    this._renderColor(target, queue, opts, true, false);
  }

  renderTransparent(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void {
    this._renderColor(target, queue, opts, false, true);
  }

  /** @internal */
  private _renderColor(
    target: FrameBuffer,
    queue: RenderQueue,
    opts: SceneRenderOptions | undefined,
    renderOpaque: boolean,
    renderTransparent: boolean
  ): void {
    const ctx = this._ctx;
    const device = ctx.device;
    const camera = opts?.camera ?? ctx.camera;
    // Snapshot the shared pass flags and the mutable ctx.materialFlags so nothing
    // leaks into the built-in pipeline passes that run after this one.
    const savedTransmission = _sceneLightPass.transmission;
    const savedRenderOpaque = _sceneLightPass.renderOpaque;
    const savedRenderTransparent = _sceneLightPass.renderTransparent;
    const savedRenderSky = _sceneLightPass.renderSky;
    const savedClearColor = _sceneLightPass.clearColor;
    const savedClearDepth = _sceneLightPass.clearDepth;
    const savedClearStencil = _sceneLightPass.clearStencil;
    const savedMaterialFlags = ctx.materialFlags;
    const savedCompositor = ctx.compositor;
    const savedPrepassDepth = ctx.depthPrepassAttachment;
    ctx.depthPrepassAttachment = undefined;
    device.pushDeviceStates();
    try {
      device.setFramebuffer(target);
      device.setViewport(null);
      device.setScissor(null);
      // The facade renders into a single-color target with no post-processing,
      // so strip surface-MRT store flags and detach the compositor.
      ctx.materialFlags = savedMaterialFlags & ~SURFACE_MRT_FLAGS;
      ctx.compositor = null;
      _sceneLightPass.transmission = false;
      _sceneLightPass.renderSky = false;
      _sceneLightPass.renderOpaque = renderOpaque;
      _sceneLightPass.renderTransparent = renderTransparent;
      _sceneLightPass.clearColor = opts && 'clearColor' in opts ? (opts.clearColor ?? null) : null;
      _sceneLightPass.clearDepth = opts && 'clearDepth' in opts ? (opts.clearDepth ?? null) : null;
      _sceneLightPass.clearStencil = opts && 'clearStencil' in opts ? (opts.clearStencil ?? null) : null;
      _sceneLightPass.render(ctx, camera, camera, queue);
    } finally {
      _sceneLightPass.transmission = savedTransmission;
      _sceneLightPass.renderOpaque = savedRenderOpaque;
      _sceneLightPass.renderTransparent = savedRenderTransparent;
      _sceneLightPass.renderSky = savedRenderSky;
      _sceneLightPass.clearColor = savedClearColor ?? null;
      _sceneLightPass.clearDepth = savedClearDepth;
      _sceneLightPass.clearStencil = savedClearStencil;
      ctx.materialFlags = savedMaterialFlags;
      ctx.compositor = savedCompositor;
      ctx.depthPrepassAttachment = savedPrepassDepth;
      device.popDeviceStates();
    }
  }

  renderDepth(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void {
    const ctx = this._ctx;
    const device = ctx.device;
    const camera = opts?.camera ?? ctx.camera;
    const colorAttachment = target.getColorAttachments()[0] as Nullable<Texture2D>;
    const encodeDepth = colorAttachment?.format === 'rgba8unorm';
    const savedTransmission = _sceneDepthPass.transmission;
    const savedEncodeDepth = _sceneDepthPass.encodeDepth;
    const savedRenderBackface = _sceneDepthPass.renderBackface;
    const savedClearColor = _sceneDepthPass.clearColor;
    const savedClearDepth = _sceneDepthPass.clearDepth;
    const savedClearStencil = _sceneDepthPass.clearStencil;
    const savedMaterialFlags = ctx.materialFlags;
    device.pushDeviceStates();
    try {
      device.setFramebuffer(target);
      device.setViewport(null);
      device.setScissor(null);
      ctx.materialFlags = savedMaterialFlags & ~SURFACE_MRT_FLAGS;
      _sceneDepthPass.transmission = false;
      _sceneDepthPass.renderBackface = false;
      _sceneDepthPass.encodeDepth = encodeDepth;
      _sceneDepthPass.clearColor =
        opts && 'clearColor' in opts
          ? (opts.clearColor ?? null)
          : encodeDepth
            ? new Vector4(0, 0, 0, 1)
            : new Vector4(1, 1, 1, 1);
      _sceneDepthPass.clearDepth = opts && 'clearDepth' in opts ? (opts.clearDepth ?? null) : 1;
      _sceneDepthPass.clearStencil = opts && 'clearStencil' in opts ? (opts.clearStencil ?? null) : null;
      _sceneDepthPass.render(ctx, camera, camera, queue);
    } finally {
      _sceneDepthPass.transmission = savedTransmission;
      _sceneDepthPass.encodeDepth = savedEncodeDepth;
      _sceneDepthPass.renderBackface = savedRenderBackface;
      _sceneDepthPass.clearColor = savedClearColor ?? null;
      _sceneDepthPass.clearDepth = savedClearDepth;
      _sceneDepthPass.clearStencil = savedClearStencil;
      ctx.materialFlags = savedMaterialFlags;
      device.popDeviceStates();
    }
  }
}

/**
 * Finalize a queue for rendering: runs the queue's instance batching and
 * bind-group allocation. Isolated here so both the builder and the filtered
 * `cull()` path share one call site into the queue's (internal) `end()`.
 * @internal
 */
function finalizeQueue(queue: RenderQueue, camera: Camera, createRenderBundles?: boolean): void {
  (queue as unknown as { end(camera: Camera, createRenderBundles?: boolean): RenderQueue }).end(
    camera,
    createRenderBundles
  );
}

/**
 * Create a {@link SceneRenderContext} for the current render-graph pass.
 *
 * Call this inside a pass execute callback, passing the frame draw context and
 * the pass's {@link RGExecuteContext}. Queues the facade creates are disposed
 * automatically when the pass finishes (via `rgCtx.deferCleanup`).
 *
 * @param ctx - The frame draw context (e.g. `fg.ctx`).
 * @param rgCtx - The execute context handed to the pass callback.
 * @returns A scene render facade bound to this pass.
 *
 * @public
 */
export function createSceneRenderer(ctx: DrawContext, rgCtx: RGExecuteContext): SceneRenderContext {
  return new SceneRenderContextImpl(ctx, rgCtx);
}
