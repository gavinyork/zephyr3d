import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  ColorState,
  FrameBuffer,
  GPUProgram,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import type { DrawContext } from '../drawable';
import type { RenderQueue } from '../render_queue';
import type { PunctualLight, Scene } from '../../scene';
import type { Camera } from '../../camera';
import { LightPass } from '../lightpass';
import { ShadowMapPass } from '../shadowmap_pass';
import { DepthPass } from '../depthpass';
import { ClusteredLight } from '../cluster_light';
import { buildHiZ } from '../hzb';
import { CopyBlitter } from '../../blitter';
import { fetchSampler } from '../../utility/misc';
import { MaterialVaryingFlags } from '../../values';
import { AbstractPostEffect, PostEffectLayer } from '../../posteffect/posteffect';
import { RenderGraph } from './rendergraph';
import { RenderGraphExecutor } from './executor';
import { DevicePoolAllocator } from './device_pool_allocator';
import { HistoryResourceManager } from './history_resource_manager';
import type { RGHandle } from './types';
import { renderObjectColors } from '../gpu_picking';
import type { Primitive } from '../primitive';
import { BoxShape } from '../../shapes';

// ─── Shared Pass Instances ──────────────────────────────────────────

const _scenePass = new LightPass();
const _depthPass = new DepthPass();
const _shadowMapPass = new ShadowMapPass();
const _clusters: ClusteredLight[] = [];
const _devicePoolAllocator = new DevicePoolAllocator();
let _backDepthColorState: Nullable<ColorState> = null;
let _frontDepthColorState: Nullable<ColorState> = null;

function getClusteredLight(): ClusteredLight {
  return _clusters.length > 0 ? _clusters.pop()! : new ClusteredLight();
}
function freeClusteredLight(cl: ClusteredLight): void {
  _clusters.push(cl);
}

// ─── Pipeline Options ───────────────────────────────────────────────

/**
 * Options controlling which features are enabled in the forward+ pipeline.
 *
 * Derived from camera settings and device capabilities each frame.
 *
 * @public
 */
export interface ForwardPlusOptions {
  /** Enable depth prepass (always true for now). */
  depthPrepass: boolean;
  /** Enable motion vectors (requires TAA or motionBlur). */
  motionVectors: boolean;
  /** Enable Hi-Z pyramid (for SSR ray tracing). */
  hiZ: boolean;
  /** Enable screen-space reflections. */
  ssr: boolean;
  /** Whether to compute SSR thickness. */
  ssrCalcThickness: boolean;
  /** Whether GPU picking is requested this frame. */
  gpuPicking: boolean;
  /** Whether transmission/refraction materials are present. */
  needSceneColor: boolean;
}

/**
 * Derive pipeline options from the current scene/camera state.
 * @internal
 */
export function deriveForwardPlusOptions(
  scene: Scene,
  camera: Camera,
  deviceType: string,
  renderQueue: RenderQueue
): ForwardPlusOptions {
  const ssr = camera.SSR && scene.env.light.envLight && scene.env.light.envLight.hasRadiance();
  return {
    depthPrepass: true,
    motionVectors: deviceType !== 'webgl' && (camera.TAA || camera.motionBlur),
    hiZ: camera.HiZ && deviceType !== 'webgl',
    ssr: !!ssr,
    ssrCalcThickness: !!ssr && camera.ssrCalcThickness,
    gpuPicking: !!camera.getPickResultResolveFunc(),
    needSceneColor: renderQueue.needSceneColor()
  };
}

// ─── Shared Frame State ─────────────────────────────────────────────

/**
 * Mutable state shared between pass execute callbacks within a single frame.
 *
 * This replaces the monolithic DrawContext mutation pattern with an explicit
 * object that graph passes can read from and write to.
 *
 * @internal
 */
export interface FrameState {
  ctx: DrawContext;
  renderQueue: RenderQueue;
  depthFramebuffer: Nullable<FrameBuffer>;
  sunLightColor: Nullable<any>;
  options: ForwardPlusOptions;
}

// ─── Forward+ Graph Builder ─────────────────────────────────────────

/**
 * Constructs a render graph representing the forward+ pipeline.
 *
 * Each step in the existing `SceneRenderer._renderScene` becomes a graph pass.
 * Execute callbacks delegate to the existing rendering code, sharing a mutable
 * `FrameState`.
 *
 * @param graph - The render graph to populate.
 * @param ctx - The draw context for this frame.
 * @param renderQueue - The culled render queue.
 * @param options - Pipeline feature toggles.
 * @returns The backbuffer handle (graph output).
 *
 * @public
 */
export function buildForwardPlusGraph(
  graph: RenderGraph,
  ctx: DrawContext,
  renderQueue: RenderQueue,
  options: ForwardPlusOptions
): RGHandle {
  const backbuffer = graph.importTexture('backbuffer');

  // Shared mutable frame state
  const frame: FrameState = {
    ctx,
    renderQueue,
    depthFramebuffer: null,
    sunLightColor: null,
    options
  };

  // ── 1. Sky Update ─────────────────────────────────────────────────
  graph.addPass('SkyUpdate', (builder) => {
    builder.sideEffect();
    builder.setExecute(() => {
      frame.sunLightColor = ctx.scene.env.sky.update(ctx);
    });
  });

  // ── 2. Clustered Light Setup ──────────────────────────────────────
  graph.addPass('ClusterLights', (builder) => {
    builder.sideEffect();
    builder.setExecute(() => {
      ctx.clusteredLight = getClusteredLight();
      ctx.clusteredLight.calculateLightIndex(ctx.camera, renderQueue);
    });
  });

  // ── 3. GPU Picking (optional, sideEffect) ─────────────────────────
  if (options.gpuPicking) {
    graph.addPass('GPUPicking', (builder) => {
      builder.sideEffect();
      builder.setExecute(() => {
        const pickResolveFunc = ctx.camera.getPickResultResolveFunc();
        if (pickResolveFunc) {
          renderObjectColors(ctx, pickResolveFunc, renderQueue);
        }
      });
    });
  }

  // ── 4. Shadow Maps ────────────────────────────────────────────────
  // Shadow maps are managed internally by lights, mark as side effect
  if (renderQueue.shadowedLights.length > 0) {
    graph.addPass('ShadowMaps', (builder) => {
      builder.sideEffect();
      builder.setExecute(() => {
        renderShadowMaps(ctx, renderQueue.shadowedLights);
      });
    });
  }

  // ── 5. Depth Prepass ──────────────────────────────────────────────
  // Declare transient depth and motion vector textures
  const depthPassResult = graph.addPass('DepthPrepass', (builder) => {
    const format: TextureFormat =
      ctx.device.type === 'webgl'
        ? ctx.SSRCalcThickness
          ? 'rgba16f'
          : 'rgba8unorm'
        : ctx.SSRCalcThickness
          ? 'rg32f'
          : 'r32f';
    const mvFormat: TextureFormat = 'rgba16f';

    const depthHandle = builder.createTexture({ format, label: 'linearDepth' });
    const motionVectorHandle = options.motionVectors
      ? builder.createTexture({ format: mvFormat, label: 'motionVector' })
      : undefined;

    builder.setExecute((rgCtx) => {
      const depthTex = rgCtx.getTexture<Texture2D>(depthHandle);
      const mvTex = motionVectorHandle ? rgCtx.getTexture<Texture2D>(motionVectorHandle) : null;
      frame.depthFramebuffer = renderSceneDepth(frame, null, depthTex, mvTex);
    });

    return { depthHandle, motionVectorHandle };
  });

  const depthHandle = depthPassResult.depthHandle;
  const motionVectorHandle = depthPassResult.motionVectorHandle;

  // ── 6. Hi-Z (optional) ───────────────────────────────────────────
  let hiZHandle: RGHandle | undefined;
  if (options.hiZ) {
    graph.addPass('HiZ', (builder) => {
      builder.read(depthHandle!);
      hiZHandle = builder.createTexture({ format: 'r32f', label: 'hiZ', mipLevels: 10 });
      builder.setExecute((rgCtx) => {
        const ctx = frame.ctx;
        // Use the depth texture from the framebuffer (which contains the RenderGraph texture)
        const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;
        if (depthTex) {
          // Get the HiZ texture allocated by the executor
          const hiZTex = rgCtx.getTexture<Texture2D>(hiZHandle!);
          const w = hiZTex.width;
          const h = hiZTex.height;
          const HiZFrameBuffer = ctx.device.pool.fetchTemporalFramebuffer(false, w, h, hiZTex, null, false);
          buildHiZ(depthTex, HiZFrameBuffer);
          ctx.HiZTexture = hiZTex;
          ctx.device.pool.releaseFrameBuffer(HiZFrameBuffer);
        }
      });
    });
  }

  // ── 7. Main Light Pass ────────────────────────────────────────────
  const lightPassResult = graph.addPass('LightPass', (builder) => {
    builder.read(depthHandle);
    if (hiZHandle) {
      builder.read(hiZHandle);
    }

    // Create scene color texture (intermediate render target)
    const sceneColorHandle = builder.createTexture({
      format: ctx.colorFormat!,
      label: 'sceneColor'
    });

    // Create optional sceneColorCopy for transmission/refraction materials
    let sceneColorCopyHandle: RGHandle | undefined;
    if (options.needSceneColor) {
      sceneColorCopyHandle = builder.createTexture({
        format: ctx.colorFormat!,
        label: 'sceneColorCopy'
      });
    }

    builder.setExecute((rgCtx) => {
      const sceneColorTex = rgCtx.getTexture<Texture2D>(sceneColorHandle);
      const sceneColorCopyTex = sceneColorCopyHandle
        ? rgCtx.getTexture<Texture2D>(sceneColorCopyHandle)
        : null;
      renderMainLightPass(frame, sceneColorTex, sceneColorCopyTex);
    });

    return { sceneColorHandle, sceneColorCopyHandle };
  });

  const sceneColorHandle = lightPassResult.sceneColorHandle;

  // ── 8. Post Effects + Final Composite ─────────────────────────────
  graph.addPass('Composite', (builder) => {
    builder.read(sceneColorHandle);
    if (motionVectorHandle) {
      builder.read(motionVectorHandle);
    }
    builder.write(backbuffer);
    builder.setExecute(() => {
      renderComposite(frame);
    });
  });

  return backbuffer;
}

// ─── Pass Implementation Helpers ────────────────────────────────────
// These wrap the existing SceneRenderer static methods, adapted to work
// with the FrameState pattern. They contain the same logic as the
// original methods but read/write through FrameState.

/** @internal */
function renderShadowMaps(ctx: DrawContext, lights: PunctualLight[]): void {
  ctx.renderPass = _shadowMapPass;
  ctx.device.pushDeviceStates();
  for (const light of lights) {
    light.shadow.render(ctx, _shadowMapPass);
  }
  ctx.device.popDeviceStates();
}

/** @internal */
function renderSceneDepth(
  frame: FrameState,
  existingDepthFb: Nullable<FrameBuffer>,
  depthTex?: Texture2D,
  motionVectorTex?: Nullable<Texture2D>
): FrameBuffer {
  const ctx = frame.ctx;
  const renderQueue = frame.renderQueue;
  const transmission = !!existingDepthFb;
  let depthFramebuffer = existingDepthFb;

  if (!depthFramebuffer) {
    // Use RenderGraph-allocated textures if provided
    if (depthTex) {
      const colorAttachments = motionVectorTex ? [depthTex, motionVectorTex] : depthTex;
      const depthAttachment = ctx.finalFramebuffer?.getDepthAttachment();
      const depthTexOrFormat = depthAttachment?.isTexture2D() ? depthAttachment : ctx.depthFormat;

      depthFramebuffer = ctx.device.pool.fetchTemporalFramebuffer(
        true,
        depthTex.width,
        depthTex.height,
        colorAttachments,
        depthTexOrFormat,
        false
      );
    } else {
      // Fallback: allocate from pool (legacy path)
      const format: TextureFormat =
        ctx.device.type === 'webgl'
          ? ctx.SSRCalcThickness
            ? 'rgba16f'
            : 'rgba8unorm'
          : ctx.SSRCalcThickness
            ? 'rg32f'
            : 'r32f';
      const mvFormat: TextureFormat = 'rgba16f';
      if (!ctx.finalFramebuffer) {
        depthFramebuffer = ctx.device.pool.fetchTemporalFramebuffer(
          true,
          ctx.renderWidth,
          ctx.renderHeight,
          ctx.motionVectors ? [format, mvFormat] : format,
          ctx.depthFormat,
          false
        );
      } else {
        const originDepth = ctx.finalFramebuffer?.getDepthAttachment();
        depthFramebuffer = originDepth?.isTexture2D()
          ? ctx.device.pool.fetchTemporalFramebuffer(
              true,
              originDepth.width,
              originDepth.height,
              ctx.motionVectors ? [format, mvFormat] : format,
              originDepth,
              false
            )
          : ctx.device.pool.fetchTemporalFramebuffer(
              true,
              ctx.renderWidth,
              ctx.renderHeight,
              ctx.motionVectors ? [format, mvFormat] : format,
              ctx.depthFormat,
              false
            );
      }
    }
  }

  ctx.device.pushDeviceStates();
  ctx.device.setFramebuffer(depthFramebuffer!);
  _depthPass.encodeDepth = depthFramebuffer!.getColorAttachments()[0].format === 'rgba8unorm';
  _depthPass.clearColor = transmission
    ? null
    : _depthPass.encodeDepth
      ? new Vector4(0, 0, 0, 1)
      : new Vector4(1, 1, 1, 1);
  _depthPass.clearDepth = transmission ? null : 1;
  _depthPass.clearStencil = null;
  _depthPass.transmission = transmission;

  if (ctx.SSRCalcThickness && !transmission) {
    if (!_backDepthColorState) {
      _backDepthColorState = ctx.device.createColorState().setColorMask(false, true, false, false);
    }
    if (!_frontDepthColorState) {
      _frontDepthColorState = ctx.device.createColorState().setColorMask(true, false, false, false);
    }
    ctx.forceColorState = _backDepthColorState;
    ctx.forceCullMode = 'front';
    _depthPass.renderBackface = true;
    _depthPass.transmission = false;
    _depthPass.render(ctx, null, null, renderQueue);
    _depthPass.clearColor = null;
    _depthPass.renderBackface = false;
    ctx.forceColorState = _frontDepthColorState;
    ctx.forceCullMode = null;
  }
  _depthPass.render(ctx, null, null, renderQueue);
  ctx.forceColorState = null;
  ctx.device.popDeviceStates();

  if (!transmission) {
    ctx.motionVectorTexture = ctx.motionVectors
      ? (depthFramebuffer!.getColorAttachments()[1] as Texture2D)
      : null;
    ctx.linearDepthTexture = depthFramebuffer!.getColorAttachments()[0] as Texture2D;
    ctx.depthTexture = depthFramebuffer!.getDepthAttachment() as Texture2D;
    if (ctx.motionVectorTexture) {
      // Sky motion vectors rendering is handled inline
      renderSkyMotionVectors(ctx);
    }
    // HiZ is now built in the dedicated HiZ pass
  }
  return depthFramebuffer!;
}

// ─── Sky Motion Vector State ────────────────────────────────────────

let _skyMVProgram: Nullable<GPUProgram> = null;
let _skyMVBindGroup: Nullable<BindGroup> = null;
let _skyMVBox: Nullable<Primitive> = null;

/** @internal */
function renderSkyMotionVectors(ctx: DrawContext): void {
  if (!ctx.motionVectorTexture) {
    return;
  }

  const device = ctx.device;
  const fb = device.pool.fetchTemporalFramebuffer(false, 0, 0, ctx.motionVectorTexture, ctx.depthTexture);

  if (!_skyMVProgram) {
    _skyMVProgram = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.VPMatrix = pb.mat4().uniform(0);
        this.prevVPMatrix = pb.mat4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.prevCameraPos = pb.vec3().uniform(0);
        pb.main(function () {
          this.$l.worldPos = pb.add(this.$inputs.pos, this.cameraPos);
          this.$l.prevWorldPos = pb.add(this.$inputs.pos, this.prevCameraPos);
          this.$l.clipPos = pb.mul(this.VPMatrix, pb.vec4(this.worldPos, 1));
          this.$l.prevClipPos = pb.mul(this.prevVPMatrix, pb.vec4(this.prevWorldPos, 1));
          this.clipPos.z = this.clipPos.w;
          this.$builtins.position = this.clipPos;
          this.$outputs.currentPos = this.clipPos;
          this.$outputs.prevPos = this.prevClipPos;
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.motionVector = pb.mul(
            pb.sub(
              pb.div(this.$inputs.currentPos.xy, this.$inputs.currentPos.w),
              pb.div(this.$inputs.prevPos.xy, this.$inputs.prevPos.w)
            ),
            0.5
          );
          this.$outputs.color = pb.vec4(this.motionVector, 0, 1);
        });
      }
    })!;
    _skyMVProgram.name = '@TAA_SkyMotionVector';
  }

  if (!_skyMVBindGroup) {
    _skyMVBindGroup = device.createBindGroup(_skyMVProgram.bindGroupLayouts[0]);
  }

  if (!_skyMVBox) {
    _skyMVBox = new BoxShape({ size: 2, needNormal: false, needUV: false });
  }

  _skyMVBindGroup.setValue('VPMatrix', ctx.camera.viewProjectionMatrix);
  _skyMVBindGroup.setValue('prevVPMatrix', ctx.camera.prevVPMatrix!);
  _skyMVBindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
  _skyMVBindGroup.setValue('prevCameraPos', ctx.camera.prevPosition!);

  device.pushDeviceStates();
  device.setProgram(_skyMVProgram);
  device.setBindGroup(0, _skyMVBindGroup);
  device.setRenderStates(AbstractPostEffect.getDefaultRenderState(ctx, 'le'));
  device.setFramebuffer(fb);
  _skyMVBox.draw();
  device.popDeviceStates();
  device.pool.releaseFrameBuffer(fb);
}

/** @internal */
function renderMainLightPass(
  frame: FrameState,
  sceneColorTex: Texture2D,
  sceneColorCopyTex: Nullable<Texture2D>
): void {
  const { ctx, renderQueue } = frame;
  const device = ctx.device;

  // Use RenderGraph-allocated scene color texture
  const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;

  if (depthTex === ctx.finalFramebuffer?.getDepthAttachment()) {
    ctx.intermediateFramebuffer = ctx.finalFramebuffer;
  } else {
    ctx.intermediateFramebuffer = device.pool.fetchTemporalFramebuffer(
      false,
      sceneColorTex.width,
      sceneColorTex.height,
      sceneColorTex,
      depthTex
    );
  }

  if (ctx.intermediateFramebuffer && ctx.intermediateFramebuffer !== ctx.finalFramebuffer) {
    device.pushDeviceStates();
    device.setFramebuffer(ctx.intermediateFramebuffer);
  } else {
    device.setViewport(null);
    device.setScissor(null);
  }

  _scenePass.transmission = false;
  _scenePass.clearDepth = depthTex ? null : 1;
  _scenePass.clearStencil = depthTex ? null : 0;

  if (ctx.SSR && !renderQueue.needSceneColor()) {
    ctx.materialFlags |= MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
  }

  ctx.compositor?.begin(ctx);

  if (renderQueue.needSceneColor() && sceneColorCopyTex) {
    const compositor = ctx.compositor;
    ctx.compositor = null;

    // Use RenderGraph-allocated sceneColorCopy texture
    const sceneColorFramebuffer = device.pool.fetchTemporalFramebuffer(
      true,
      sceneColorCopyTex.width,
      sceneColorCopyTex.height,
      ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS
        ? [
            sceneColorCopyTex,
            device.getFramebuffer()!.getColorAttachments()[1]!,
            device.getFramebuffer()!.getColorAttachments()[2]!
          ]
        : sceneColorCopyTex,
      depthTex,
      false
    );
    device.pushDeviceStates();
    device.setFramebuffer(sceneColorFramebuffer);
    _scenePass.transmission = false;
    _scenePass.render(ctx, null, null, renderQueue);
    device.popDeviceStates();
    ctx.sceneColorTexture = sceneColorCopyTex;
    new CopyBlitter().blit(
      ctx.sceneColorTexture,
      device.getFramebuffer() ?? null,
      fetchSampler('clamp_nearest_nomip')
    );
    _scenePass.transmission = true;
    _scenePass.clearColor = null;
    _scenePass.clearDepth = null;
    _scenePass.clearStencil = null;
    ctx.compositor = compositor;
  }
  _scenePass.render(ctx, null, null, renderQueue);

  if (renderQueue.needSceneColor()) {
    renderSceneDepth(frame, frame.depthFramebuffer);
  }
}

/** @internal */
function renderComposite(frame: FrameState): void {
  const { ctx, renderQueue } = frame;
  const device = ctx.device;

  ctx.compositor?.drawPostEffects(ctx, PostEffectLayer.end, ctx.linearDepthTexture!);
  ctx.compositor?.end(ctx);
  renderQueue.dispose();
  ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;

  if (ctx.intermediateFramebuffer && ctx.intermediateFramebuffer !== ctx.finalFramebuffer) {
    const blitter = new CopyBlitter();
    blitter.srgbOut = !ctx.finalFramebuffer;
    const srcTex = ctx.intermediateFramebuffer.getColorAttachments()[0] as Texture2D;
    blitter.blit(srcTex, ctx.finalFramebuffer ?? null, fetchSampler('clamp_nearest_nomip'));
    device.popDeviceStates();
    device.pool.releaseFrameBuffer(ctx.intermediateFramebuffer);
  }

  freeClusteredLight(ctx.clusteredLight!);

  if (frame.sunLightColor) {
    ctx.sunLight!.color = frame.sunLightColor;
  }
}

// ─── Convenience: Execute Full Pipeline ─────────────────────────────

/**
 * Build, compile, and execute the forward+ pipeline as a render graph.
 *
 * This is the drop-in replacement for `SceneRenderer._renderScene`.
 *
 * @param ctx - The draw context for this frame.
 * @public
 */
export function executeForwardPlusGraph(ctx: DrawContext): void {
  const device = ctx.device;
  const graph = new RenderGraph();

  // Cull scene first (needed to derive options)
  const renderQueue = _scenePass.cullScene(ctx, ctx.camera);

  const options = deriveForwardPlusOptions(ctx.scene, ctx.camera, device.type, renderQueue);

  // Ensure the camera has a history resource manager for temporal effects (TAA, motion blur)
  let historyManager = ctx.camera.getHistoryResourceManager();
  if (!historyManager) {
    historyManager = new HistoryResourceManager<Texture2D>(_devicePoolAllocator);
    ctx.camera.setHistoryResourceManager(historyManager);
  }

  const backbuffer = buildForwardPlusGraph(graph, ctx, renderQueue, options);

  const compiled = graph.compile([backbuffer]);

  // Use RenderGraphExecutor for automatic resource management
  const executor = new RenderGraphExecutor(_devicePoolAllocator, ctx.renderWidth, ctx.renderHeight);

  // Register imported backbuffer (if using finalFramebuffer)
  if (ctx.finalFramebuffer) {
    const backbufferTex = ctx.finalFramebuffer.getColorAttachments()[0] as Texture2D;
    executor.setImportedTexture(backbuffer, backbufferTex);
  }

  executor.execute(compiled);
  executor.reset();

  // Swap history buffers at frame end (ping-pong)
  historyManager.swap();
}
