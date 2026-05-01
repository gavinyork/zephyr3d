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
import { RGHistoryResources } from './history_resources';
import type { RGExecuteContext, RGHandle } from './types';
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
  intermediateDeviceStatePushed: boolean;
  renderQueueDisposed: boolean;
  clusteredLightReleased: boolean;
  sunLightRestored: boolean;
}

interface ForwardPlusGraphBuildResult {
  backbuffer: RGHandle;
  frame: FrameState;
}

interface HistoryReadBinding {
  name: string;
  handle: RGHandle;
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
  return buildForwardPlusGraphInternal(graph, ctx, renderQueue, options).backbuffer;
}

function buildForwardPlusGraphInternal(
  graph: RenderGraph,
  ctx: DrawContext,
  renderQueue: RenderQueue,
  options: ForwardPlusOptions
): ForwardPlusGraphBuildResult {
  const backbuffer = graph.importTexture('backbuffer');

  // Shared mutable frame state
  const frame: FrameState = {
    ctx,
    renderQueue,
    depthFramebuffer: null,
    sunLightColor: null,
    options,
    intermediateDeviceStatePushed: false,
    renderQueueDisposed: false,
    clusteredLightReleased: false,
    sunLightRestored: false
  };

  // ── 1. Sky Update ─────────────────────────────────────────────────
  let orderToken = graph.addPass('SkyUpdate', (builder) => {
    const done = builder.createToken('SkyUpdateDone');
    builder.sideEffect();
    builder.setExecute(() => {
      frame.sunLightColor = ctx.scene.env.sky.update(ctx);
    });
    return done;
  });

  // ── 2. Clustered Light Setup ──────────────────────────────────────
  orderToken = graph.addPass('ClusterLights', (builder) => {
    builder.read(orderToken);
    const done = builder.createToken('ClusterLightsDone');
    builder.sideEffect();
    builder.setExecute(() => {
      ctx.clusteredLight = getClusteredLight();
      ctx.clusteredLight.calculateLightIndex(ctx.camera, renderQueue);
    });
    return done;
  });

  // ── 3. GPU Picking (optional, sideEffect) ─────────────────────────
  if (options.gpuPicking) {
    orderToken = graph.addPass('GPUPicking', (builder) => {
      builder.read(orderToken);
      const done = builder.createToken('GPUPickingDone');
      builder.sideEffect();
      builder.setExecute(() => {
        const pickResolveFunc = ctx.camera.getPickResultResolveFunc();
        if (pickResolveFunc) {
          renderObjectColors(ctx, pickResolveFunc, renderQueue);
        }
      });
      return done;
    });
  }

  // ── 4. Shadow Maps ────────────────────────────────────────────────
  // Shadow maps are managed internally by lights, mark as side effect
  if (renderQueue.shadowedLights.length > 0) {
    orderToken = graph.addPass('ShadowMaps', (builder) => {
      builder.read(orderToken);
      const done = builder.createToken('ShadowMapsDone');
      builder.sideEffect();
      builder.setExecute(() => {
        renderShadowMaps(ctx, renderQueue.shadowedLights);
      });
      return done;
    });
  }

  // ── 5. Depth Prepass ──────────────────────────────────────────────
  // Declare transient depth and motion vector textures
  const depthPassResult = graph.addPass('DepthPrepass', (builder) => {
    builder.read(orderToken);
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
    const finalDepthAttachment = ctx.finalFramebuffer?.getDepthAttachment();
    const externalDepthAttachment = finalDepthAttachment?.isTexture2D()
      ? (finalDepthAttachment as Texture2D)
      : null;
    const graphDepthAttachmentHandle = externalDepthAttachment
      ? undefined
      : builder.createTexture({ format: ctx.depthFormat, label: 'sceneDepth' });
    const depthAttachmentOrFormat = externalDepthAttachment ?? graphDepthAttachmentHandle ?? ctx.depthFormat;
    const depthFramebufferHandle = builder.createFramebuffer({
      label: 'DepthPrepassFramebuffer',
      width: ctx.renderWidth,
      height: ctx.renderHeight,
      colorAttachments: motionVectorHandle ? [depthHandle, motionVectorHandle] : depthHandle,
      depthAttachment: depthAttachmentOrFormat,
      ignoreDepthStencil: false
    });
    const skyMotionVectorFramebufferHandle = motionVectorHandle
      ? builder.createFramebuffer({
          label: 'SkyMotionVectorFramebuffer',
          width: ctx.renderWidth,
          height: ctx.renderHeight,
          colorAttachments: motionVectorHandle,
          depthAttachment: depthAttachmentOrFormat
        })
      : undefined;

    builder.addSubpass('SceneDepth', (rgCtx) => {
      const depthFramebuffer = rgCtx.getFramebuffer<FrameBuffer>(depthFramebufferHandle);
      frame.depthFramebuffer = renderSceneDepth(frame, depthFramebuffer, rgCtx, undefined, undefined, false);
    });
    if (skyMotionVectorFramebufferHandle) {
      builder.addSubpass('SkyMotionVectors', (rgCtx) => {
        renderSkyMotionVectors(ctx, rgCtx, skyMotionVectorFramebufferHandle);
      });
    }

    return {
      depthHandle,
      motionVectorHandle,
      graphDepthAttachmentHandle,
      externalDepthAttachment,
      depthFramebufferHandle
    };
  });

  const depthHandle = depthPassResult.depthHandle;
  const motionVectorHandle = depthPassResult.motionVectorHandle;
  const renderDepthAttachment =
    depthPassResult.graphDepthAttachmentHandle ?? depthPassResult.externalDepthAttachment ?? null;

  // ── 6. Hi-Z (optional) ───────────────────────────────────────────
  let hiZHandle: RGHandle | undefined;
  if (options.hiZ) {
    graph.addPass('HiZ', (builder) => {
      builder.read(depthHandle!);
      builder.read(depthPassResult.depthFramebufferHandle);
      hiZHandle = builder.createTexture({ format: 'r32f', label: 'hiZ', mipLevels: 10 });
      const hiZFramebufferHandle = builder.createFramebuffer({
        label: 'HiZFramebuffer',
        colorAttachments: hiZHandle,
        depthAttachment: null
      });
      builder.setExecute((rgCtx) => {
        const ctx = frame.ctx;
        // Use the depth texture from the framebuffer (which contains the RenderGraph texture)
        const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;
        if (depthTex) {
          // Get the HiZ texture allocated by the executor
          const hiZTex = rgCtx.getTexture<Texture2D>(hiZHandle!);
          const HiZFrameBuffer = rgCtx.getFramebuffer<FrameBuffer>(hiZFramebufferHandle);
          buildHiZ(depthTex, HiZFrameBuffer);
          ctx.HiZTexture = hiZTex;
        }
      });
    });
  }

  // ── 7. Main Light Pass ────────────────────────────────────────────
  const lightPassResult = graph.addPass('LightPass', (builder) => {
    builder.read(depthHandle);
    builder.read(depthPassResult.depthFramebufferHandle);
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
    const useFinalFramebufferAsIntermediate =
      !!depthPassResult.externalDepthAttachment &&
      depthPassResult.externalDepthAttachment === ctx.finalFramebuffer?.getDepthAttachment();
    const sceneColorFramebufferHandle = useFinalFramebufferAsIntermediate
      ? undefined
      : builder.createFramebuffer({
          label: 'SceneColorFramebuffer',
          width: ctx.renderWidth,
          height: ctx.renderHeight,
          colorAttachments: sceneColorHandle,
          depthAttachment: renderDepthAttachment
        });
    const sceneColorCopyFramebufferHandle = sceneColorCopyHandle
      ? builder.createFramebuffer({
          label: 'SceneColorCopyFramebuffer',
          width: ctx.renderWidth,
          height: ctx.renderHeight,
          colorAttachments: sceneColorCopyHandle,
          depthAttachment: renderDepthAttachment,
          ignoreDepthStencil: false
        })
      : undefined;

    builder.setExecute((rgCtx) => {
      const sceneColorTex = rgCtx.getTexture<Texture2D>(sceneColorHandle);
      const sceneColorCopyTex = sceneColorCopyHandle
        ? rgCtx.getTexture<Texture2D>(sceneColorCopyHandle)
        : null;
      renderMainLightPass(
        frame,
        sceneColorTex,
        sceneColorCopyTex,
        rgCtx,
        sceneColorFramebufferHandle,
        sceneColorCopyFramebufferHandle
      );
    });

    return { sceneColorHandle, sceneColorCopyHandle, sceneColorFramebufferHandle };
  });

  const sceneColorHandle = lightPassResult.sceneColorHandle;
  const historyManager = ctx.camera?.getHistoryResourceManager?.() ?? null;
  const historyReadBindings: HistoryReadBinding[] = [];
  if (historyManager && ctx.camera?.TAA && options.motionVectors) {
    const historySize = { width: ctx.renderWidth, height: ctx.renderHeight };
    const colorHistoryHandle = historyManager.importPreviousIfCompatible(
      graph,
      RGHistoryResources.TAA_COLOR,
      {
        format: ctx.colorFormat!,
        sizeMode: 'absolute',
        width: ctx.renderWidth,
        height: ctx.renderHeight
      },
      historySize
    );
    const motionVectorHistoryHandle = historyManager.importPreviousIfCompatible(
      graph,
      RGHistoryResources.TAA_MOTION_VECTOR,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: ctx.renderWidth,
        height: ctx.renderHeight
      },
      historySize
    );
    if (colorHistoryHandle && motionVectorHistoryHandle) {
      historyReadBindings.push(
        { name: RGHistoryResources.TAA_COLOR, handle: colorHistoryHandle },
        { name: RGHistoryResources.TAA_MOTION_VECTOR, handle: motionVectorHistoryHandle }
      );
    }
  }

  // 8. Transmission depth pass (optional)
  let transmissionDepthToken: RGHandle | undefined;
  if (options.needSceneColor) {
    transmissionDepthToken = graph.addPass('TransmissionDepth', (builder) => {
      builder.read(sceneColorHandle);
      builder.read(depthPassResult.depthFramebufferHandle);
      const done = builder.createToken('TransmissionDepthDone');
      builder.sideEffect();
      builder.setExecute((rgCtx) => {
        renderTransmissionDepthPass(frame, rgCtx);
      });
      return done;
    });
  }

  // 9. Post effects + final composite
  const presentedBackbuffer = graph.addPass('Composite', (builder) => {
    builder.read(sceneColorHandle);
    builder.read(depthHandle);
    if (hiZHandle) {
      builder.read(hiZHandle);
    }
    if (motionVectorHandle) {
      builder.read(motionVectorHandle);
    }
    if (lightPassResult.sceneColorFramebufferHandle) {
      builder.read(lightPassResult.sceneColorFramebufferHandle);
    }
    if (transmissionDepthToken) {
      builder.read(transmissionDepthToken);
    }
    for (const binding of historyReadBindings) {
      builder.read(binding.handle);
    }
    const outputBackbuffer = builder.write(backbuffer);
    builder.setExecute((rgCtx) => {
      if (historyManager && historyReadBindings.length > 0) {
        historyManager.beginReadScope(
          historyReadBindings.map((binding) => ({
            name: binding.name,
            texture: rgCtx.getTexture<Texture2D>(binding.handle)
          }))
        );
        try {
          renderComposite(frame);
        } finally {
          historyManager.endReadScope();
        }
      } else {
        renderComposite(frame);
      }
    });
    return outputBackbuffer;
  });

  return { backbuffer: presentedBackbuffer, frame };
}

// ─── Pass Implementation Helpers ────────────────────────────────────
// These wrap the existing SceneRenderer static methods, adapted to work
// with the FrameState pattern. They contain the same logic as the
// original methods but read/write through FrameState.

/** @internal */
function renderShadowMaps(ctx: DrawContext, lights: PunctualLight[]): void {
  ctx.renderPass = _shadowMapPass;
  ctx.device.pushDeviceStates();
  try {
    for (const light of lights) {
      light.shadow.render(ctx, _shadowMapPass);
    }
  } finally {
    ctx.device.popDeviceStates();
  }
}

function releaseIntermediateFramebuffer(frame: FrameState): void {
  const { ctx } = frame;
  if (frame.intermediateDeviceStatePushed) {
    ctx.device.popDeviceStates();
    frame.intermediateDeviceStatePushed = false;
  }
  ctx.intermediateFramebuffer = null;
}

function releaseDepthFramebuffer(frame: FrameState): void {
  frame.depthFramebuffer = null;
}

function disposeRenderQueue(frame: FrameState): void {
  if (!frame.renderQueueDisposed) {
    frame.renderQueue.dispose();
    frame.renderQueueDisposed = true;
  }
}

function releaseClusteredLight(frame: FrameState): void {
  if (!frame.clusteredLightReleased && frame.ctx.clusteredLight) {
    freeClusteredLight(frame.ctx.clusteredLight);
    frame.ctx.clusteredLight = undefined;
    frame.clusteredLightReleased = true;
  }
}

function restoreSunLight(frame: FrameState): void {
  if (!frame.sunLightRestored && frame.sunLightColor && frame.ctx.sunLight) {
    frame.ctx.sunLight.color = frame.sunLightColor;
    frame.sunLightRestored = true;
  }
}

function cleanupFrame(frame: FrameState): void {
  releaseIntermediateFramebuffer(frame);
  releaseDepthFramebuffer(frame);
  releaseClusteredLight(frame);
  disposeRenderQueue(frame);
  restoreSunLight(frame);
}

/** @internal */
function renderSceneDepth(
  frame: FrameState,
  existingDepthFb: Nullable<FrameBuffer>,
  rgCtx: RGExecuteContext,
  depthTex?: Texture2D,
  motionVectorTex?: Nullable<Texture2D>,
  transmissionOverride?: boolean
): FrameBuffer {
  const ctx = frame.ctx;
  const renderQueue = frame.renderQueue;
  const transmission = transmissionOverride ?? !!existingDepthFb;
  let depthFramebuffer = existingDepthFb;

  if (!depthFramebuffer) {
    // Use RenderGraph-allocated textures if provided
    if (depthTex) {
      const colorAttachments = motionVectorTex ? [depthTex, motionVectorTex] : depthTex;
      const depthAttachment = ctx.finalFramebuffer?.getDepthAttachment();
      const depthTexOrFormat = depthAttachment?.isTexture2D() ? depthAttachment : ctx.depthFormat;

      depthFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
        width: depthTex.width,
        height: depthTex.height,
        colorAttachments,
        depthAttachment: depthTexOrFormat,
        ignoreDepthStencil: false
      });
    } else {
      // Allocate through RenderGraph so framebuffer lifetime is owned by the executor.
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
        depthFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
          width: ctx.renderWidth,
          height: ctx.renderHeight,
          colorAttachments: ctx.motionVectors ? [format, mvFormat] : format,
          depthAttachment: ctx.depthFormat,
          ignoreDepthStencil: false
        });
      } else {
        const originDepth = ctx.finalFramebuffer?.getDepthAttachment();
        if (originDepth?.isTexture2D()) {
          depthFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
            width: originDepth.width,
            height: originDepth.height,
            colorAttachments: ctx.motionVectors ? [format, mvFormat] : format,
            depthAttachment: originDepth,
            ignoreDepthStencil: false
          });
        } else {
          depthFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
            width: ctx.renderWidth,
            height: ctx.renderHeight,
            colorAttachments: ctx.motionVectors ? [format, mvFormat] : format,
            depthAttachment: ctx.depthFormat,
            ignoreDepthStencil: false
          });
        }
      }
    }
  }

  if (!transmission) {
    frame.depthFramebuffer = depthFramebuffer!;
  }

  ctx.device.pushDeviceStates();
  try {
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
  } finally {
    ctx.forceColorState = null;
    ctx.forceCullMode = null;
    _depthPass.renderBackface = false;
    ctx.device.popDeviceStates();
  }

  if (!transmission) {
    ctx.motionVectorTexture = ctx.motionVectors
      ? (depthFramebuffer!.getColorAttachments()[1] as Texture2D)
      : null;
    ctx.linearDepthTexture = depthFramebuffer!.getColorAttachments()[0] as Texture2D;
    ctx.depthTexture = depthFramebuffer!.getDepthAttachment() as Texture2D;
    // HiZ is now built in the dedicated HiZ pass
  }
  return depthFramebuffer!;
}

// ─── Sky Motion Vector State ────────────────────────────────────────

let _skyMVProgram: Nullable<GPUProgram> = null;
let _skyMVBindGroup: Nullable<BindGroup> = null;
let _skyMVBox: Nullable<Primitive> = null;

/** @internal */
function renderSkyMotionVectors(
  ctx: DrawContext,
  rgCtx: RGExecuteContext,
  framebufferHandle?: RGHandle
): void {
  if (!ctx.motionVectorTexture) {
    return;
  }

  const device = ctx.device;
  const fb = framebufferHandle
    ? rgCtx.getFramebuffer<FrameBuffer>(framebufferHandle)
    : rgCtx.createFramebuffer<FrameBuffer>({
        colorAttachments: ctx.motionVectorTexture,
        depthAttachment: ctx.depthTexture
      });

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
}

/** @internal */
function renderMainLightPass(
  frame: FrameState,
  sceneColorTex: Texture2D,
  sceneColorCopyTex: Nullable<Texture2D>,
  rgCtx: RGExecuteContext,
  sceneColorFramebufferHandle?: RGHandle,
  sceneColorCopyFramebufferHandle?: RGHandle
): void {
  const { ctx, renderQueue } = frame;
  const device = ctx.device;

  // Use RenderGraph-allocated scene color texture
  const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;

  if (depthTex === ctx.finalFramebuffer?.getDepthAttachment()) {
    ctx.intermediateFramebuffer = ctx.finalFramebuffer;
  } else if (sceneColorFramebufferHandle) {
    ctx.intermediateFramebuffer = rgCtx.getFramebuffer<FrameBuffer>(sceneColorFramebufferHandle);
  } else {
    ctx.intermediateFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
      width: sceneColorTex.width,
      height: sceneColorTex.height,
      colorAttachments: sceneColorTex,
      depthAttachment: depthTex
    });
  }

  if (ctx.intermediateFramebuffer && ctx.intermediateFramebuffer !== ctx.finalFramebuffer) {
    device.pushDeviceStates();
    frame.intermediateDeviceStatePushed = true;
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
    const sceneColorFramebuffer =
      sceneColorCopyFramebufferHandle && !(ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS)
        ? rgCtx.getFramebuffer<FrameBuffer>(sceneColorCopyFramebufferHandle)
        : rgCtx.createFramebuffer<FrameBuffer>({
            width: sceneColorCopyTex.width,
            height: sceneColorCopyTex.height,
            colorAttachments:
              ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS
                ? [
                    sceneColorCopyTex,
                    device.getFramebuffer()!.getColorAttachments()[1]!,
                    device.getFramebuffer()!.getColorAttachments()[2]!
                  ]
                : sceneColorCopyTex,
            depthAttachment: depthTex,
            ignoreDepthStencil: false
          });
    let sceneColorStatePushed = false;
    try {
      device.pushDeviceStates();
      sceneColorStatePushed = true;
      device.setFramebuffer(sceneColorFramebuffer);
      _scenePass.transmission = false;
      _scenePass.render(ctx, null, null, renderQueue);
    } finally {
      if (sceneColorStatePushed) {
        device.popDeviceStates();
      }
      ctx.compositor = compositor;
    }
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
  }
  _scenePass.render(ctx, null, null, renderQueue);
}

/** @internal */
function renderTransmissionDepthPass(frame: FrameState, rgCtx: RGExecuteContext): void {
  renderSceneDepth(frame, frame.depthFramebuffer, rgCtx);
}

/** @internal */
function renderComposite(frame: FrameState): void {
  const { ctx } = frame;

  ctx.compositor?.drawPostEffects(ctx, PostEffectLayer.end, ctx.linearDepthTexture!);
  ctx.compositor?.end(ctx);
  disposeRenderQueue(frame);
  ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;

  if (ctx.intermediateFramebuffer && ctx.intermediateFramebuffer !== ctx.finalFramebuffer) {
    const blitter = new CopyBlitter();
    blitter.srgbOut = !ctx.finalFramebuffer;
    const srcTex = ctx.intermediateFramebuffer.getColorAttachments()[0] as Texture2D;
    blitter.blit(srcTex, ctx.finalFramebuffer ?? null, fetchSampler('clamp_nearest_nomip'));
  }

  releaseIntermediateFramebuffer(frame);
  releaseDepthFramebuffer(frame);
  releaseClusteredLight(frame);
  restoreSunLight(frame);
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
  historyManager.beginFrame();

  const { backbuffer, frame } = buildForwardPlusGraphInternal(graph, ctx, renderQueue, options);

  const compiled = graph.compile([backbuffer]);

  // Use RenderGraphExecutor for automatic resource management
  const executor = new RenderGraphExecutor(_devicePoolAllocator, ctx.renderWidth, ctx.renderHeight);

  // Register imported backbuffer (if using finalFramebuffer)
  if (ctx.finalFramebuffer) {
    const backbufferTex = ctx.finalFramebuffer.getColorAttachments()[0] as Texture2D;
    executor.setImportedTexture(backbuffer, backbufferTex);
  }
  historyManager.bindImportedTextures(executor);

  try {
    executor.execute(compiled);
    historyManager.commitFrame();
  } finally {
    historyManager.discardFrame();
    cleanupFrame(frame);
    executor.reset();
  }
}
