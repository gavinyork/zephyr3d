import type { Nullable } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D } from '@zephyr3d/device';
import type { Camera } from '../../camera';
import { MaterialVaryingFlags } from '../../values';
import type { DrawContext, Drawable } from '../drawable';
import { RenderQueue, InstanceBindGroupAllocator } from '../render_queue';
import { LightPass } from '../lightpass';
import { DepthPass } from '../depthpass';
import type { RGExecuteContext } from './types';

// The facade renders to a single color target.
const SURFACE_MRT_FLAGS =
  MaterialVaryingFlags.SCENE_STORE_ROUGHNESS |
  MaterialVaryingFlags.SSS_STORE_PROFILE |
  MaterialVaryingFlags.SSS_STORE_DIFFUSE |
  MaterialVaryingFlags.SCENE_STORE_NORMAL |
  MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
  MaterialVaryingFlags.SKIN_SSS_STORE;

const _sceneLightPass = new LightPass();
const _sceneDepthPass = new DepthPass();

type DrawContextState = Pick<
  DrawContext,
  | 'renderPass'
  | 'renderPassHash'
  | 'shaderVariantHash'
  | 'flip'
  | 'drawEnvLight'
  | 'env'
  | 'queue'
  | 'lightBlending'
  | 'instanceData'
  | 'oit'
  | 'currentShadowLight'
  | 'materialFlags'
  | 'shadowMaskClusterSample'
  | 'compositor'
  | 'depthPrepassAttachment'
  | 'sunLight'
  | 'primaryDirectionalLight'
  | 'primaryTransmissionLight'
>;

function snapshotDrawContext(ctx: DrawContext): DrawContextState {
  return {
    renderPass: ctx.renderPass,
    renderPassHash: ctx.renderPassHash,
    shaderVariantHash: ctx.shaderVariantHash,
    flip: ctx.flip,
    drawEnvLight: ctx.drawEnvLight,
    env: ctx.env,
    queue: ctx.queue,
    lightBlending: ctx.lightBlending,
    instanceData: ctx.instanceData,
    oit: ctx.oit,
    currentShadowLight: ctx.currentShadowLight,
    materialFlags: ctx.materialFlags,
    shadowMaskClusterSample: ctx.shadowMaskClusterSample,
    compositor: ctx.compositor,
    depthPrepassAttachment: ctx.depthPrepassAttachment,
    sunLight: ctx.sunLight,
    primaryDirectionalLight: ctx.primaryDirectionalLight,
    primaryTransmissionLight: ctx.primaryTransmissionLight
  };
}

function restoreDrawContext(ctx: DrawContext, state: DrawContextState): void {
  Object.assign(ctx, state);
}

/** Test-only access to the facade-owned pass instances. @internal */
export function _getSceneRenderPassesForTest() {
  return { light: _sceneLightPass, depth: _sceneDepthPass };
}

/** Scene render options. Omitted or null clear values preserve the target. @public */
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

/** Builder for a pass-scoped render queue. Call `finalize` before rendering. @public */
export interface SceneRenderQueueBuilder {
  /** Add a drawable, using the frame camera by default. */
  add(drawable: Drawable, camera?: Camera): this;

  /** Finalize batching and return the renderable queue. */
  finalize(camera?: Camera): RenderQueue;
}

/** Caller-owned render queue that can be reused across frames. @public */
export interface PersistentSceneQueue {
  /** Renderable queue, valid after {@link PersistentSceneQueue.finalize}. */
  readonly queue: RenderQueue;

  /** Clear the queue for rebuilding. */
  clear(): this;

  /** Add a drawable. */
  add(drawable: Drawable, camera: Camera): this;

  /** Finalize batching, optionally creating reusable render bundles. */
  finalize(camera: Camera, createRenderBundles?: boolean): this;

  /** Release the queue and its private allocator's GPU resources. */
  dispose(): void;
}

/** Scene rendering facade for custom render graph passes. @public */
export interface SceneRenderContext {
  /** The frame draw context (camera, scene, env, device). */
  readonly ctx: DrawContext;

  /** Cull into a pass-scoped queue, optionally filtering drawables. */
  cull(camera?: Camera, filter?: (drawable: Drawable) => boolean): RenderQueue;

  /** Start building a user-authored queue. */
  createQueue(): SceneRenderQueueBuilder;

  /** Render opaque and transparent geometry into `target`. */
  renderScene(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /** Render only the opaque geometry of a queue. See {@link SceneRenderContext.renderScene}. */
  renderOpaque(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /** Render only the transparent geometry of a queue. See {@link SceneRenderContext.renderScene}. */
  renderTransparent(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /** Render a linear-depth pass for a queue's opaque geometry. See {@link SceneRenderContext.renderScene}. */
  renderDepth(target: FrameBuffer, queue: RenderQueue, opts?: SceneRenderOptions): void;

  /**
   * Create a caller-managed queue. It is not disposed with the current pass.
   */
  createPersistentQueue(): PersistentSceneQueue;
}

/** @internal */
class SceneRenderContextImpl implements SceneRenderContext {
  private readonly _ctx: DrawContext;
  private readonly _rgCtx: RGExecuteContext;
  private readonly _ownedQueues: RenderQueue[] = [];
  private _cleanupRegistered = false;

  constructor(ctx: DrawContext, rgCtx: RGExecuteContext) {
    this._ctx = ctx;
    this._rgCtx = rgCtx;
  }

  get ctx(): DrawContext {
    return this._ctx;
  }

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
    const savedContext = snapshotDrawContext(this._ctx);
    let queue: RenderQueue;
    try {
      queue = _sceneLightPass.cullScene(this._ctx, cullCamera);
    } finally {
      restoreDrawContext(this._ctx, savedContext);
    }
    if (!filter) {
      return this._own(queue);
    }
    // Rebuild because cullScene returns an already-finalized queue.
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
        allocator.reset();
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
        allocator.dispose();
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
    // Restore all shared pass and draw-context state after rendering.
    const savedTransmission = _sceneLightPass.transmission;
    const savedRenderOpaque = _sceneLightPass.renderOpaque;
    const savedRenderTransparent = _sceneLightPass.renderTransparent;
    const savedRenderSky = _sceneLightPass.renderSky;
    const savedClearColor = _sceneLightPass.clearColor;
    const savedClearDepth = _sceneLightPass.clearDepth;
    const savedClearStencil = _sceneLightPass.clearStencil;
    const savedContext = snapshotDrawContext(ctx);
    ctx.depthPrepassAttachment = undefined;
    device.pushDeviceStates();
    try {
      device.setFramebuffer(target);
      device.setViewport(null);
      device.setScissor(null);
      // The facade target has no surface MRT or compositor attachments.
      ctx.materialFlags = savedContext.materialFlags & ~SURFACE_MRT_FLAGS;
      ctx.compositor = null;
      ctx.sunLight = queue.sunLight;
      ctx.primaryDirectionalLight = queue.primaryDirectionalLight;
      ctx.primaryTransmissionLight = queue.primaryTransmissionLight;
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
      restoreDrawContext(ctx, savedContext);
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
    const savedContext = snapshotDrawContext(ctx);
    device.pushDeviceStates();
    try {
      device.setFramebuffer(target);
      device.setViewport(null);
      device.setScissor(null);
      ctx.materialFlags = savedContext.materialFlags & ~SURFACE_MRT_FLAGS;
      ctx.sunLight = queue.sunLight;
      ctx.primaryDirectionalLight = queue.primaryDirectionalLight;
      ctx.primaryTransmissionLight = queue.primaryTransmissionLight;
      _sceneDepthPass.transmission = false;
      _sceneDepthPass.renderBackface = false;
      _sceneDepthPass.encodeDepth = encodeDepth;
      _sceneDepthPass.clearColor =
        opts && 'clearColor' in opts
          ? (opts.clearColor ?? null)
          : encodeDepth
            ? new Vector4(0, 0, 0, 1)
            : new Vector4(1, 1, 1, 1);
      _sceneDepthPass.clearDepth =
        opts && 'clearDepth' in opts ? (opts.clearDepth ?? null) : DEPTH_CLEAR_VALUE;
      _sceneDepthPass.clearStencil = opts && 'clearStencil' in opts ? (opts.clearStencil ?? null) : null;
      _sceneDepthPass.render(ctx, camera, camera, queue);
    } finally {
      _sceneDepthPass.transmission = savedTransmission;
      _sceneDepthPass.encodeDepth = savedEncodeDepth;
      _sceneDepthPass.renderBackface = savedRenderBackface;
      _sceneDepthPass.clearColor = savedClearColor ?? null;
      _sceneDepthPass.clearDepth = savedClearDepth;
      _sceneDepthPass.clearStencil = savedClearStencil;
      restoreDrawContext(ctx, savedContext);
      device.popDeviceStates();
    }
  }
}

/** @internal */
function finalizeQueue(queue: RenderQueue, camera: Camera, createRenderBundles?: boolean): void {
  (queue as unknown as { end(camera: Camera, createRenderBundles?: boolean): RenderQueue }).end(
    camera,
    createRenderBundles
  );
}

/** Create a scene facade bound to the current graph pass. @public */
export function createSceneRenderer(ctx: DrawContext, rgCtx: RGExecuteContext): SceneRenderContext {
  return new SceneRenderContextImpl(ctx, rgCtx);
}
