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
import {
  RenderQueue,
  type RenderItemList,
  type RenderItemListInfo,
  type RenderQueueItem
} from '../render_queue';
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
const SURFACE_MRT_FLAGS =
  MaterialVaryingFlags.SSR_STORE_ROUGHNESS |
  MaterialVaryingFlags.SSS_STORE_PROFILE |
  MaterialVaryingFlags.SSS_STORE_DIFFUSE |
  MaterialVaryingFlags.SSS_STORE_NORMAL |
  MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
  MaterialVaryingFlags.SKIN_SSS_STORE;

function getClusteredLight(): ClusteredLight {
  return _clusters.length > 0 ? _clusters.pop()! : new ClusteredLight();
}
function freeClusteredLight(cl: ClusteredLight): void {
  _clusters.push(cl);
}

function getCoreMaterial(material: unknown): unknown {
  return (material as { coreMaterial?: unknown } | null | undefined)?.coreMaterial ?? material ?? null;
}

function hasSSSMaterialCore(material: unknown): boolean {
  return !!(getCoreMaterial(material) as { subsurfaceProfile?: unknown } | null)?.subsurfaceProfile;
}

function hasSkinSSSMaterialCore(material: unknown): boolean {
  return !!(getCoreMaterial(material) as { skinSSS?: unknown } | null)?.skinSSS;
}

function renderQueueHasActiveSSS(renderQueue: RenderQueue): boolean {
  const itemList = renderQueue.itemList;
  if (!itemList) {
    return false;
  }
  const lists = [...itemList.opaque.lit, ...itemList.opaque.unlit];
  for (const list of lists) {
    for (const material of list.materialList) {
      if (hasSSSMaterialCore(material)) {
        return true;
      }
    }
  }
  return false;
}

function renderQueueHasActiveSkinSSS(renderQueue: RenderQueue): boolean {
  const itemList = renderQueue.itemList;
  if (!itemList) {
    return false;
  }
  const lists = [...itemList.opaque.lit, ...itemList.opaque.unlit];
  for (const list of lists) {
    for (const material of list.materialList) {
      if (hasSkinSSSMaterialCore(material)) {
        return true;
      }
    }
  }
  return false;
}

function filterActualSSSItemList(items: RenderQueueItem[]): RenderQueueItem[] {
  return items.filter((item) => hasSSSMaterialCore(item.drawable.getMaterial?.()));
}

function filterActualSSSMaterialList(materialList: Set<any>): Set<any> {
  const filtered = new Set<any>();
  materialList.forEach((mat) => {
    if (hasSSSMaterialCore(mat)) {
      filtered.add(mat);
    }
  });
  return filtered;
}

function cloneActualSSSListInfo(source: RenderItemListInfo, _targetQueue: RenderQueue): RenderItemListInfo {
  return {
    itemList: filterActualSSSItemList(source.itemList),
    skinItemList: filterActualSSSItemList(source.skinItemList),
    morphItemList: filterActualSSSItemList(source.morphItemList),
    skinAndMorphItemList: filterActualSSSItemList(source.skinAndMorphItemList),
    instanceItemList: filterActualSSSItemList(source.instanceItemList),
    materialList: filterActualSSSMaterialList(source.materialList),
    instanceList: {},
    renderQueue: source.renderQueue
  };
}

function cloneActualSSSBundle(
  source: RenderItemList['opaque'],
  targetQueue: RenderQueue
): RenderItemList['opaque'] {
  return {
    lit: source.lit.map((info) => cloneActualSSSListInfo(info, targetQueue)),
    unlit: source.unlit.map((info) => cloneActualSSSListInfo(info, targetQueue))
  };
}

function hasAnyActualSSSItems(renderItems: RenderItemListInfo[]): boolean {
  return renderItems.some(
    (info) =>
      info.itemList.length > 0 ||
      info.skinItemList.length > 0 ||
      info.morphItemList.length > 0 ||
      info.skinAndMorphItemList.length > 0 ||
      info.instanceItemList.length > 0
  );
}

function createActualSSSRenderQueue(renderQueue: RenderQueue): RenderQueue | null {
  const itemList = renderQueue.itemList;
  if (!itemList) {
    return null;
  }
  const queue = new RenderQueue(_scenePass);
  const sssOpaque = cloneActualSSSBundle(itemList.opaque, queue);
  if (!hasAnyActualSSSItems([...sssOpaque.lit, ...sssOpaque.unlit])) {
    queue.dispose();
    return null;
  }
  const emptyBundle = { lit: [], unlit: [] };
  const target = queue as unknown as {
    _itemList: RenderItemList;
    _shadowedLightList: PunctualLight[];
    _unshadowedLightList: PunctualLight[];
    _sunLight: typeof renderQueue.sunLight;
    _primaryDirectionalLight: typeof renderQueue.primaryDirectionalLight;
    _primaryTransmissionLight: typeof renderQueue.primaryTransmissionLight;
    _needSceneColor: boolean;
    _needSceneDepth: boolean;
    _needSceneColorWithDepth: boolean;
    _drawTransparent: boolean;
  };
  target._itemList = {
    opaque: sssOpaque,
    transmission: emptyBundle,
    transparent: emptyBundle,
    transmission_trans: emptyBundle
  };
  target._shadowedLightList = renderQueue.shadowedLights;
  target._unshadowedLightList = renderQueue.unshadowedLights;
  target._sunLight = renderQueue.sunLight;
  target._primaryDirectionalLight = renderQueue.primaryDirectionalLight;
  target._primaryTransmissionLight = renderQueue.primaryTransmissionLight;
  target._needSceneColor = false;
  target._needSceneDepth = false;
  target._needSceneColorWithDepth = false;
  target._drawTransparent = false;
  return queue;
}

function getSurfaceTextureFormat(ctx: DrawContext): TextureFormat {
  const caps = ctx.device.getDeviceCaps?.();
  return caps?.textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba8unorm';
}

function getTextureFormatBytes(ctx: DrawContext, format: TextureFormat): number {
  return ctx.device.getDeviceCaps().textureCaps.getTextureFormatInfo(format).size;
}

function shouldStoreSSSDiffuse(ctx: DrawContext): boolean {
  return ctx.camera.sssStrength > 0 && ctx.camera.sssBlurScale > 0;
}

function shouldStoreSSSTransmission(ctx: DrawContext): boolean {
  return ctx.camera.sssStrength > 0 && ctx.camera.sssTransmissionStrength > 0;
}

function getSSSLightingTextureFormat(
  ctx: DrawContext,
  attachmentCount: number,
  includeSSRSurfaceMRT: boolean
): TextureFormat {
  const colorFormat = ctx.colorFormat!;
  if (!includeSSRSurfaceMRT || attachmentCount === 0) {
    return colorFormat;
  }
  const caps = ctx.device.getDeviceCaps();
  const roughnessFormat = ctx.SSRRoughnessTexture?.format ?? colorFormat;
  const normalFormat = ctx.SSRNormalTexture?.format ?? colorFormat;
  const colorBytes =
    getTextureFormatBytes(ctx, colorFormat) +
    getTextureFormatBytes(ctx, roughnessFormat) +
    getTextureFormatBytes(ctx, normalFormat);
  const fullPrecisionBytes = colorBytes + getTextureFormatBytes(ctx, colorFormat) * attachmentCount;
  if (fullPrecisionBytes <= caps.framebufferCaps.maxColorAttachmentBytesPerSample) {
    return colorFormat;
  }
  return 'rgba8unorm';
}

function getFullMipLevelCount(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.log2(Math.max(1, width, height))) + 1);
}

function hasSurfaceMRT(ctx: DrawContext): boolean {
  return !!(ctx.materialFlags & SURFACE_MRT_FLAGS);
}

function getLightPassColorAttachments(
  ctx: DrawContext,
  colorAttachment: TextureFormat | Texture2D
): TextureFormat | Texture2D | Array<TextureFormat | Texture2D> {
  const attachments: Array<TextureFormat | Texture2D> = [colorAttachment];
  if (ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
    attachments.push(ctx.SSRRoughnessTexture!, ctx.SSRNormalTexture!);
  } else if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_NORMAL) {
    attachments.push(ctx.SSRNormalTexture!);
  }
  if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_PROFILE) {
    attachments.push(ctx.SSSProfileTexture!, ctx.SSSParamTexture!);
  }
  if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_DIFFUSE) {
    attachments.push(ctx.SSSDiffuseTexture!);
  }
  if (ctx.materialFlags & MaterialVaryingFlags.SSS_STORE_TRANSMISSION) {
    attachments.push(ctx.SSSTransmissionTexture!);
  }
  if (ctx.materialFlags & MaterialVaryingFlags.SKIN_SSS_STORE) {
    attachments.push(ctx.SkinSSSTexture!);
  }
  return attachments.length === 1 ? attachments[0] : attachments;
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
  /** Whether scene-color-dependent materials also require scene depth. */
  needSceneColorWithDepth: boolean;
  /** Whether SSR needs transmission depth before the main light pass. */
  needsTransmissionDepthForSSR: boolean;
  /** Enable screen-space subsurface scattering. */
  sss: boolean;
  /** Enable the stylized skin-specific SSS pass. */
  skinSSS: boolean;
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
  const sss = camera.SSS && renderQueueHasActiveSSS(renderQueue);
  const skinSSS = camera.skinSSS && renderQueueHasActiveSkinSSS(renderQueue);
  const needSceneColor = renderQueue.needSceneColor();
  const needSceneColorWithDepth = renderQueue.needSceneColorWithDepth();
  return {
    depthPrepass: true,
    motionVectors:
      deviceType !== 'webgl' && (camera.TAA || camera.motionBlur || (!!ssr && camera.ssrTemporal)),
    hiZ: camera.HiZ && deviceType !== 'webgl',
    ssr: !!ssr,
    ssrCalcThickness: !!ssr && camera.ssrCalcThickness,
    gpuPicking: !!camera.getPickResultResolveFunc(),
    needSceneColor,
    needSceneColorWithDepth,
    needsTransmissionDepthForSSR: !!ssr && needSceneColor && !needSceneColorWithDepth,
    sss: !!sss,
    skinSSS: !!skinSSS
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

interface SSSProfilePassResult {
  profileHandle: RGHandle;
  paramHandle: RGHandle;
  normalHandle?: RGHandle;
  framebufferHandle: RGHandle;
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
  ctx.SSS = !!options.sss;
  ctx.SkinSSSTexture = null;

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
  const useFinalFramebufferAsIntermediate =
    !!depthPassResult.externalDepthAttachment &&
    depthPassResult.externalDepthAttachment === ctx.finalFramebuffer?.getDepthAttachment();

  let preLightTransmissionDepthToken: RGHandle | undefined;
  if (options.needsTransmissionDepthForSSR) {
    preLightTransmissionDepthToken = graph.addPass('TransmissionDepthForSSR', (builder) => {
      builder.read(depthPassResult.depthFramebufferHandle);
      const done = builder.createToken('TransmissionDepthForSSRDone');
      builder.sideEffect();
      builder.setExecute((rgCtx) => {
        renderTransmissionDepthPass(frame, rgCtx);
      });
      return done;
    });
  }

  // ── 6. Hi-Z (optional) ───────────────────────────────────────────
  let hiZHandle: RGHandle | undefined;
  if (options.hiZ) {
    graph.addPass('HiZ', (builder) => {
      builder.read(depthHandle!);
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      hiZHandle = builder.createTexture({
        format: 'r32f',
        label: 'hiZ',
        mipLevels: getFullMipLevelCount(ctx.renderWidth, ctx.renderHeight)
      });
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
  const historyManager = ctx.camera?.getHistoryResourceManager?.() ?? null;
  const lightHistoryReadBindings: HistoryReadBinding[] = [];
  const compositeHistoryReadBindings: HistoryReadBinding[] = [];
  const historySize = { width: ctx.renderWidth, height: ctx.renderHeight };
  if (historyManager && options.ssr && ctx.camera?.ssrTemporal && options.motionVectors) {
    const reflectHistoryHandle = historyManager.importPreviousIfCompatible(
      graph,
      RGHistoryResources.SSR_REFLECT,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: ctx.renderWidth,
        height: ctx.renderHeight
      },
      historySize
    );
    const motionVectorHistoryHandle = historyManager.importPreviousIfCompatible(
      graph,
      RGHistoryResources.SSR_MOTION_VECTOR,
      {
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: ctx.renderWidth,
        height: ctx.renderHeight
      },
      historySize
    );
    if (reflectHistoryHandle && motionVectorHistoryHandle) {
      lightHistoryReadBindings.push(
        { name: RGHistoryResources.SSR_REFLECT, handle: reflectHistoryHandle },
        { name: RGHistoryResources.SSR_MOTION_VECTOR, handle: motionVectorHistoryHandle }
      );
    }
  }
  if (historyManager && ctx.camera?.TAA && options.motionVectors) {
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
      compositeHistoryReadBindings.push(
        { name: RGHistoryResources.TAA_COLOR, handle: colorHistoryHandle },
        { name: RGHistoryResources.TAA_MOTION_VECTOR, handle: motionVectorHistoryHandle }
      );
    }
  }

  let sssProfileResult: SSSProfilePassResult | undefined;
  if (options.sss) {
    sssProfileResult = graph.addPass('SSSProfile', (builder) => {
      builder.read(depthHandle);
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      const profileHandle = builder.createTexture({ format: 'rgba16f', label: 'sssProfile' });
      const paramHandle = builder.createTexture({ format: 'rgba8unorm', label: 'sssParam' });
      const normalHandle = options.ssr
        ? undefined
        : builder.createTexture({ format: getSurfaceTextureFormat(ctx), label: 'sssNormal' });
      const colorAttachments = normalHandle
        ? [ctx.colorFormat!, normalHandle, profileHandle, paramHandle]
        : [ctx.colorFormat!, profileHandle, paramHandle];
      const framebufferHandle = builder.createFramebuffer({
        label: 'SSSProfileFramebuffer',
        width: ctx.renderWidth,
        height: ctx.renderHeight,
        colorAttachments,
        depthAttachment: renderDepthAttachment,
        ignoreDepthStencil: false
      });

      builder.setExecute((rgCtx) => {
        renderForwardSSSProfile(
          frame,
          rgCtx.getFramebuffer<FrameBuffer>(framebufferHandle),
          rgCtx.getTexture<Texture2D>(profileHandle),
          rgCtx.getTexture<Texture2D>(paramHandle),
          normalHandle ? rgCtx.getTexture<Texture2D>(normalHandle) : null
        );
      });

      return {
        profileHandle,
        paramHandle,
        normalHandle,
        framebufferHandle
      };
    });
  }

  const lightPassResult = graph.addPass('LightPass', (builder) => {
    builder.read(depthHandle);
    builder.read(depthPassResult.depthFramebufferHandle);
    if (preLightTransmissionDepthToken) {
      builder.read(preLightTransmissionDepthToken);
    }
    if (hiZHandle) {
      builder.read(hiZHandle);
    }
    for (const binding of lightHistoryReadBindings) {
      builder.read(binding.handle);
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
    if (sssProfileResult) {
      builder.read(sssProfileResult.profileHandle);
      builder.read(sssProfileResult.paramHandle);
      if (sssProfileResult.normalHandle) {
        builder.read(sssProfileResult.normalHandle);
      }
    }
    const includeSSRSurfaceMRT = !!options.ssr;
    const writeSSSDiffuse = options.sss && shouldStoreSSSDiffuse(ctx);
    let writeSSSTransmission = options.sss && shouldStoreSSSTransmission(ctx);
    if (
      writeSSSDiffuse &&
      writeSSSTransmission &&
      includeSSRSurfaceMRT &&
      getSSSLightingTextureFormat(ctx, 2, includeSSRSurfaceMRT) !== ctx.colorFormat
    ) {
      writeSSSTransmission = false;
    }
    const writeSkinSSS = options.skinSSS;
    const sssLightingAttachmentCount =
      (writeSSSDiffuse ? 1 : 0) + (writeSSSTransmission ? 1 : 0) + (writeSkinSSS ? 1 : 0);
    const sssLightingFormat = getSSSLightingTextureFormat(
      ctx,
      sssLightingAttachmentCount,
      includeSSRSurfaceMRT
    );
    const sssDiffuseHandle = writeSSSDiffuse
      ? builder.createTexture({ format: sssLightingFormat, label: 'sssDiffuse' })
      : undefined;
    const sssTransmissionHandle = writeSSSTransmission
      ? builder.createTexture({ format: sssLightingFormat, label: 'sssTransmission' })
      : undefined;
    const skinSSSHandle = writeSkinSSS
      ? builder.createTexture({ format: sssLightingFormat, label: 'skinSSS' })
      : undefined;
    const sceneColorFramebufferHandle = useFinalFramebufferAsIntermediate
      ? undefined
      : builder.createFramebuffer({
          label: 'SceneColorFramebuffer',
          width: ctx.renderWidth,
          height: ctx.renderHeight,
          colorAttachments: sceneColorHandle,
          depthAttachment: renderDepthAttachment
        });
    // SSR may pre-insert transmission depth before LightPass for Hi-Z. In that case the
    // refraction scene-color copy needs an isolated depth buffer so transmission surfaces
    // do not occlude the background color they are about to sample.
    const sceneColorCopyFramebufferHandle =
      sceneColorCopyHandle && !options.needsTransmissionDepthForSSR
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
      if (sssProfileResult) {
        ctx.SSSProfileTexture = rgCtx.getTexture<Texture2D>(sssProfileResult.profileHandle);
        ctx.SSSParamTexture = rgCtx.getTexture<Texture2D>(sssProfileResult.paramHandle);
        if (sssProfileResult.normalHandle) {
          ctx.SSRNormalTexture = rgCtx.getTexture<Texture2D>(sssProfileResult.normalHandle);
        }
      }
      ctx.SSSDiffuseTexture = sssDiffuseHandle ? rgCtx.getTexture<Texture2D>(sssDiffuseHandle) : null;
      ctx.SSSTransmissionTexture = sssTransmissionHandle
        ? rgCtx.getTexture<Texture2D>(sssTransmissionHandle)
        : null;
      ctx.SkinSSSTexture = skinSSSHandle ? rgCtx.getTexture<Texture2D>(skinSSSHandle) : null;
      const renderLightPass = () =>
        renderMainLightPass(
          frame,
          sceneColorTex,
          sceneColorCopyTex,
          rgCtx,
          sceneColorFramebufferHandle,
          sceneColorCopyFramebufferHandle
        );
      if (historyManager && lightHistoryReadBindings.length > 0) {
        historyManager.beginReadScope(
          lightHistoryReadBindings.map((binding) => ({
            name: binding.name,
            texture: rgCtx.getTexture<Texture2D>(binding.handle)
          }))
        );
        try {
          renderLightPass();
        } finally {
          historyManager.endReadScope();
        }
      } else {
        renderLightPass();
      }
    });

    return { sceneColorHandle, sceneColorCopyHandle, sceneColorFramebufferHandle };
  });

  const sceneColorHandle = lightPassResult.sceneColorHandle;

  // 8. Transmission depth pass (optional)
  let transmissionDepthToken: RGHandle | undefined;
  if (options.needSceneColor && !options.needsTransmissionDepthForSSR) {
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
    for (const binding of compositeHistoryReadBindings) {
      builder.read(binding.handle);
    }
    const outputBackbuffer = builder.write(backbuffer);
    const taaHistoryColorHandle = useFinalFramebufferAsIntermediate ? outputBackbuffer : sceneColorHandle;
    builder.setExecute((rgCtx) => {
      const renderAndCommitComposite = () => {
        renderComposite(frame);
        queueTAAHistoryCommit(frame, rgCtx, historyManager, taaHistoryColorHandle, motionVectorHandle);
      };
      if (historyManager && compositeHistoryReadBindings.length > 0) {
        historyManager.beginReadScope(
          compositeHistoryReadBindings.map((binding) => ({
            name: binding.name,
            texture: rgCtx.getTexture<Texture2D>(binding.handle)
          }))
        );
        try {
          renderAndCommitComposite();
        } finally {
          historyManager.endReadScope();
        }
      } else {
        renderAndCommitComposite();
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

function renderForwardSSSProfile(
  frame: FrameState,
  profileFramebuffer: FrameBuffer,
  profileTexture: Texture2D,
  paramTexture: Texture2D,
  normalTexture: Nullable<Texture2D>
): void {
  const { ctx, renderQueue } = frame;
  if (!ctx.SSS || !ctx.depthTexture) {
    return;
  }
  const sssRenderQueue = createActualSSSRenderQueue(renderQueue);
  if (!sssRenderQueue) {
    return;
  }

  const device = ctx.device;
  const savedMaterialFlags = ctx.materialFlags;
  const savedCompositor = ctx.compositor;
  const savedTransmission = _scenePass.transmission;
  const savedRenderOpaque = _scenePass.renderOpaque;
  const savedRenderTransparent = _scenePass.renderTransparent;
  const savedClearColor = _scenePass.clearColor;
  const savedClearDepth = _scenePass.clearDepth;
  const savedClearStencil = _scenePass.clearStencil;
  const savedCommandBufferReuse = ctx.camera.commandBufferReuse;
  const savedProfileTexture = ctx.SSSProfileTexture;
  const savedParamTexture = ctx.SSSParamTexture;
  const savedNormalTexture = ctx.SSRNormalTexture;

  let profileFlags = MaterialVaryingFlags.SSS_STORE_PROFILE;
  if (normalTexture) {
    profileFlags |= MaterialVaryingFlags.SSS_STORE_NORMAL;
  }

  device.pushDeviceStates();
  try {
    device.setFramebuffer(profileFramebuffer);
    ctx.SSSProfileTexture = profileTexture;
    ctx.SSSParamTexture = paramTexture;
    ctx.SSRNormalTexture = normalTexture;
    ctx.compositor = null;
    ctx.camera.commandBufferReuse = false;
    ctx.materialFlags =
      (ctx.materialFlags &
        ~(
          MaterialVaryingFlags.SSR_STORE_ROUGHNESS |
          MaterialVaryingFlags.SSS_STORE_PROFILE |
          MaterialVaryingFlags.SSS_STORE_NORMAL |
          MaterialVaryingFlags.SSS_STORE_DIFFUSE |
          MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
          MaterialVaryingFlags.SKIN_SSS_STORE
        )) |
      profileFlags;
    _scenePass.transmission = false;
    _scenePass.renderOpaque = true;
    _scenePass.renderTransparent = false;
    _scenePass.clearColor = Vector4.zero();
    _scenePass.clearDepth = null;
    _scenePass.clearStencil = null;
    _scenePass.render(ctx, null, null, sssRenderQueue);
  } finally {
    _scenePass.clearColor = savedClearColor;
    _scenePass.clearDepth = savedClearDepth;
    _scenePass.clearStencil = savedClearStencil;
    _scenePass.renderTransparent = savedRenderTransparent;
    _scenePass.renderOpaque = savedRenderOpaque;
    _scenePass.transmission = savedTransmission;
    ctx.camera.commandBufferReuse = savedCommandBufferReuse;
    ctx.materialFlags = savedMaterialFlags;
    ctx.compositor = savedCompositor;
    ctx.SSSProfileTexture = savedProfileTexture;
    ctx.SSSParamTexture = savedParamTexture;
    ctx.SSRNormalTexture = savedNormalTexture;
    device.popDeviceStates();
    sssRenderQueue.dispose();
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
    ctx.depthPrepassAttachment = ctx.depthTexture;
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

function blitToCurrentColorAttachment(ctx: DrawContext, source: Texture2D): void {
  const framebuffer = ctx.device.getFramebuffer();
  const destination = framebuffer?.getColorAttachment<Texture2D>(0) ?? null;
  new CopyBlitter().blit(source, destination, fetchSampler('clamp_nearest_nomip'));
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

  ctx.materialFlags &= ~(
    MaterialVaryingFlags.SSR_STORE_ROUGHNESS |
    MaterialVaryingFlags.SSS_STORE_PROFILE |
    MaterialVaryingFlags.SSS_STORE_DIFFUSE |
    MaterialVaryingFlags.SSS_STORE_NORMAL |
    MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
    MaterialVaryingFlags.SKIN_SSS_STORE
  );

  if (ctx.SSR) {
    ctx.materialFlags |= MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
  }
  if (ctx.SSS) {
    if (ctx.SSSDiffuseTexture) {
      ctx.materialFlags |= MaterialVaryingFlags.SSS_STORE_DIFFUSE;
    }
    if (ctx.SSSTransmissionTexture) {
      ctx.materialFlags |= MaterialVaryingFlags.SSS_STORE_TRANSMISSION;
    }
  }
  if (ctx.SkinSSSTexture) {
    ctx.materialFlags |= MaterialVaryingFlags.SKIN_SSS_STORE;
  }

  if (depthTex === ctx.finalFramebuffer?.getDepthAttachment()) {
    ctx.intermediateFramebuffer = ctx.finalFramebuffer;
  } else if (sceneColorFramebufferHandle && !hasSurfaceMRT(ctx)) {
    ctx.intermediateFramebuffer = rgCtx.getFramebuffer<FrameBuffer>(sceneColorFramebufferHandle);
  } else {
    ctx.intermediateFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
      width: sceneColorTex.width,
      height: sceneColorTex.height,
      colorAttachments: getLightPassColorAttachments(ctx, sceneColorTex),
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

  ctx.compositor?.begin(ctx);

  if (renderQueue.needSceneColor() && sceneColorCopyTex) {
    const compositor = ctx.compositor;
    ctx.compositor = null;
    const isolateSceneColorDepth = frame.options.needsTransmissionDepthForSSR;
    const savedDepthPrepassAttachment = ctx.depthPrepassAttachment;
    const savedClearDepth = _scenePass.clearDepth;
    const savedClearStencil = _scenePass.clearStencil;
    const savedMaterialFlags = ctx.materialFlags;

    // Use RenderGraph-allocated sceneColorCopy texture
    const sceneColorMaterialFlags = ctx.materialFlags & ~SURFACE_MRT_FLAGS;
    const sceneColorFramebuffer = sceneColorCopyFramebufferHandle
      ? rgCtx.getFramebuffer<FrameBuffer>(sceneColorCopyFramebufferHandle)
      : rgCtx.createFramebuffer<FrameBuffer>({
          width: sceneColorCopyTex.width,
          height: sceneColorCopyTex.height,
          colorAttachments: sceneColorCopyTex,
          depthAttachment: isolateSceneColorDepth ? ctx.depthFormat : depthTex,
          ignoreDepthStencil: false
        });
    let sceneColorStatePushed = false;
    try {
      device.pushDeviceStates();
      sceneColorStatePushed = true;
      device.setFramebuffer(sceneColorFramebuffer);
      _scenePass.transmission = false;
      if (isolateSceneColorDepth) {
        ctx.depthPrepassAttachment = undefined;
        _scenePass.clearDepth = 1;
        _scenePass.clearStencil = 0;
      }
      ctx.materialFlags = sceneColorMaterialFlags;
      _scenePass.render(ctx, null, null, renderQueue);
    } finally {
      ctx.materialFlags = savedMaterialFlags;
      if (isolateSceneColorDepth) {
        ctx.depthPrepassAttachment = savedDepthPrepassAttachment;
        _scenePass.clearDepth = savedClearDepth;
        _scenePass.clearStencil = savedClearStencil;
      }
      if (sceneColorStatePushed) {
        device.popDeviceStates();
      }
      ctx.compositor = compositor;
    }
    ctx.sceneColorTexture = sceneColorCopyTex;
    blitToCurrentColorAttachment(ctx, ctx.sceneColorTexture);
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

function queueTAAHistoryCommit(
  frame: FrameState,
  rgCtx: RGExecuteContext,
  historyManager: Nullable<HistoryResourceManager<Texture2D>>,
  colorHandle: RGHandle,
  motionVectorHandle?: RGHandle
): void {
  const { ctx } = frame;
  if (
    !historyManager?.frameActive ||
    !ctx.camera.TAA ||
    !frame.options.motionVectors ||
    !motionVectorHandle
  ) {
    return;
  }
  const colorTexture = rgCtx.getTexture<Texture2D>(colorHandle);
  const colorSize = { width: colorTexture.width, height: colorTexture.height };
  historyManager.queueRetainedCommit(
    RGHistoryResources.TAA_COLOR,
    {
      format: colorTexture.format,
      sizeMode: 'absolute',
      width: colorTexture.width,
      height: colorTexture.height
    },
    colorSize,
    colorTexture
  );

  const motionVectorTexture = rgCtx.getTexture<Texture2D>(motionVectorHandle);
  const motionVectorSize = {
    width: motionVectorTexture.width,
    height: motionVectorTexture.height
  };
  historyManager.queueRetainedCommit(
    RGHistoryResources.TAA_MOTION_VECTOR,
    {
      format: motionVectorTexture.format,
      sizeMode: 'absolute',
      width: motionVectorTexture.width,
      height: motionVectorTexture.height
    },
    motionVectorSize,
    motionVectorTexture
  );
}

/** @internal */
function renderComposite(frame: FrameState): void {
  const { ctx } = frame;

  ctx.compositor?.drawPostEffects(ctx, PostEffectLayer.end, ctx.linearDepthTexture!);
  ctx.compositor?.end(ctx);
  disposeRenderQueue(frame);
  ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_PROFILE;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_DIFFUSE;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_NORMAL;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_TRANSMISSION;
  ctx.materialFlags &= ~MaterialVaryingFlags.SKIN_SSS_STORE;

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
  let renderQueue: RenderQueue | null = null;
  let frame: FrameState | null = null;
  let executor: RenderGraphExecutor<Texture2D, FrameBuffer> | null = null;
  let historyManager: HistoryResourceManager<Texture2D> | null = null;
  let historyFrameStarted = false;

  try {
    // Cull scene first (needed to derive options)
    renderQueue = _scenePass.cullScene(ctx, ctx.camera);

    const options = deriveForwardPlusOptions(ctx.scene, ctx.camera, device.type, renderQueue);
    ctx.SSS = options.sss;

    // Ensure the camera has a history resource manager for temporal effects (TAA, motion blur)
    historyManager = ctx.camera.getHistoryResourceManager();
    if (!historyManager) {
      historyManager = new HistoryResourceManager<Texture2D>(_devicePoolAllocator);
      ctx.camera.setHistoryResourceManager(historyManager);
    }
    historyManager.beginFrame();
    historyFrameStarted = true;

    const buildResult = buildForwardPlusGraphInternal(graph, ctx, renderQueue, options);
    frame = buildResult.frame;

    const compiled = graph.compile([buildResult.backbuffer]);

    // Use RenderGraphExecutor for automatic resource management
    executor = new RenderGraphExecutor(_devicePoolAllocator, ctx.renderWidth, ctx.renderHeight);

    // Register imported backbuffer (if using finalFramebuffer)
    if (ctx.finalFramebuffer) {
      const backbufferTex = ctx.finalFramebuffer.getColorAttachments()[0] as Texture2D;
      executor.setImportedTexture(buildResult.backbuffer, backbufferTex);
    }
    historyManager.bindImportedTextures(executor);

    executor.execute(compiled);
    historyManager.commitFrame();
  } finally {
    if (historyFrameStarted) {
      historyManager?.discardFrame();
    }
    if (frame) {
      cleanupFrame(frame);
    } else {
      renderQueue?.dispose();
    }
    executor?.reset();
  }
}
