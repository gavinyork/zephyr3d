import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  ColorState,
  FrameBuffer,
  GPUProgram,
  Texture2D,
  Texture2DArray,
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
import { ShadowMaskRenderer } from '../shadow_mask_pass';
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
import { RGBlackboard, FrameResources } from './blackboard';
import { OrderingScope } from './frame_graph_context';
import type { FrameGraphContext } from './frame_graph_context';
import type { RenderModule } from './render_module';
import type { RGExecuteContext, RGHandle } from './types';
import { renderObjectColors } from '../gpu_picking';
import type { Primitive } from '../primitive';
import { BoxShape } from '../../shapes';

// ─── Shared Pass Instances ──────────────────────────────────────────

const _scenePass = new LightPass();
const _depthPass = new DepthPass();
const _shadowMapPass = new ShadowMapPass();
const _clusters: ClusteredLight[] = [];
const _shadowMaskRenderer = new ShadowMaskRenderer();
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
  // The SSR roughness/normal MRT textures use the glossy surface format; they
  // are graph textures now, so derive the format directly instead of reading
  // the (not yet resolved) DrawContext fields.
  const surfaceFormat = getSurfaceTextureFormat(ctx);
  const colorBytes =
    getTextureFormatBytes(ctx, colorFormat) +
    getTextureFormatBytes(ctx, surfaceFormat) +
    getTextureFormatBytes(ctx, surfaceFormat);
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

/** Result of the depth prepass module. @internal */
export interface DepthPrepassResult {
  depthHandle: RGHandle;
  motionVectorHandle?: RGHandle;
  graphDepthAttachmentHandle?: RGHandle;
  externalDepthAttachment: Nullable<Texture2D>;
  depthFramebufferHandle: RGHandle;
}

/** Result of the scene-color grab module. @internal */
export interface SceneColorGrabResult {
  copyHandle: RGHandle;
  copyFramebufferHandle?: RGHandle;
}

/** Result of the main light pass module. @internal */
export interface LightPassResult {
  sceneColorHandle: RGHandle;
  sceneColorCopyHandle?: RGHandle;
  sceneColorFramebufferHandle?: RGHandle;
  ssrRoughnessHandle?: RGHandle;
  ssrNormalHandle?: RGHandle;
  sssDiffuseHandle?: RGHandle;
  sssTransmissionHandle?: RGHandle;
  skinSSSHandle?: RGHandle;
}

/**
 * Mutable build-state shared between Forward+ modules for intermediate results
 * that are not render-graph resources (result bundles, derived flags, ordering
 * tokens). Resource handles that downstream post-effects also consume flow
 * through the blackboard instead; this holds the build-internal wiring.
 *
 * Fields are populated as modules run in authored order; a field is only read
 * after the module that produces it has run.
 *
 * @internal
 */
export interface ForwardPlusBuildState {
  /** Depth prepass outputs. */
  depth?: DepthPrepassResult;
  /** Depth attachment used by scene-color/SSS framebuffers (handle or backend texture). */
  renderDepthAttachment: RGHandle | Texture2D | null;
  /** True when the scene renders directly into the final framebuffer. */
  useFinalFramebufferAsIntermediate: boolean;
  /** Ordering token from the pre-light transmission-depth pass, if any. */
  preLightTransmissionDepthToken?: RGHandle;
  /** Screen-space shadow mask texture array handle, or null. */
  shadowMaskHandle: RGHandle | null;
  /** Hi-Z pyramid handle, if built. */
  hiZHandle?: RGHandle;
  /** History textures kept in a read scope while the light pass executes. */
  lightHistoryReadBindings: HistoryReadBinding[];
  /** Forward SSS profile pass outputs, if built. */
  sssProfile?: SSSProfilePassResult;
  /** Scene-color grab outputs, if built. */
  grab?: SceneColorGrabResult;
  /** Main light pass outputs. */
  lightPass?: LightPassResult;
}

// ─── Pre-scene side-effect modules ──────────────────────────────────
// Sky update, clustered-light setup, GPU picking and shadow maps produce no
// graph texture; they are sequenced through the ordering-token chain. Each is a
// self-describing {@link RenderModule} so the pre-scene sequence is a plain list.

/** @internal */
const SkyUpdateModule: RenderModule = {
  type: 'SkyUpdate',
  enabled: () => true,
  setup({ graph, ctx, frame, ordering }) {
    graph.addPass('SkyUpdate', (builder) => {
      ordering.emit(builder, 'SkyUpdateDone');
      builder.sideEffect();
      builder.setExecute(() => {
        frame.sunLightColor = ctx.scene.env.sky.update(ctx);
      });
    });
  }
};

/** @internal */
const ClusterLightsModule: RenderModule = {
  type: 'ClusterLights',
  enabled: () => true,
  setup({ graph, ctx, renderQueue, ordering }) {
    graph.addPass('ClusterLights', (builder) => {
      ordering.chainInto(builder);
      ordering.emit(builder, 'ClusterLightsDone');
      builder.sideEffect();
      builder.setExecute(() => {
        ctx.clusteredLight = getClusteredLight();
        ctx.clusteredLight.calculateLightIndex(ctx.camera, renderQueue);
      });
    });
  }
};

/** @internal */
const GPUPickingModule: RenderModule = {
  type: 'GPUPicking',
  enabled: ({ options }) => options.gpuPicking,
  setup({ graph, ctx, renderQueue, ordering }) {
    graph.addPass('GPUPicking', (builder) => {
      ordering.chainInto(builder);
      ordering.emit(builder, 'GPUPickingDone');
      builder.sideEffect();
      builder.setExecute(() => {
        const pickResolveFunc = ctx.camera.getPickResultResolveFunc();
        if (pickResolveFunc) {
          renderObjectColors(ctx, pickResolveFunc, renderQueue);
        }
      });
    });
  }
};

/** @internal */
const ShadowMapsModule: RenderModule = {
  type: 'ShadowMaps',
  // Shadow maps are managed internally by lights; mark as side effect.
  enabled: ({ renderQueue }) => renderQueue.shadowedLights.length > 0,
  setup({ graph, ctx, renderQueue, ordering }) {
    graph.addPass('ShadowMaps', (builder) => {
      ordering.chainInto(builder);
      ordering.emit(builder, 'ShadowMapsDone');
      builder.sideEffect();
      builder.setExecute(() => {
        renderShadowMaps(ctx, renderQueue.shadowedLights);
      });
    });
  }
};

/** @internal */
const PRE_SCENE_MODULES: readonly RenderModule[] = [
  SkyUpdateModule,
  ClusterLightsModule,
  GPUPickingModule,
  ShadowMapsModule
];

// ─── Depth prepass module ───────────────────────────────────────────

/** @internal */
const DepthPrepassModule: RenderModule = {
  type: 'DepthPrepass',
  enabled: () => true,
  setup(fg) {
    const { graph, ctx, frame, ordering, blackboard, options } = fg;
    const result = graph.addPass('DepthPrepass', (builder) => {
      ordering.chainInto(builder);
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
      const depthAttachmentOrFormat =
        externalDepthAttachment ?? graphDepthAttachmentHandle ?? ctx.depthFormat;
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
        frame.depthFramebuffer = renderSceneDepth(
          frame,
          depthFramebuffer,
          rgCtx,
          undefined,
          undefined,
          false
        );
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

    fg.state.depth = result;
    // Linear depth is threaded through the blackboard, not a mutable local:
    // passes that mutate it in place (TransmissionDepth*) re-register the
    // post-write version, so any block reading `blackboard.expect(LinearDepth)`
    // at build time gets the version live at its position in the pipeline.
    blackboard.set(FrameResources.LinearDepth, result.depthHandle);
    if (result.motionVectorHandle) {
      blackboard.set(FrameResources.MotionVector, result.motionVectorHandle);
    }
    if (result.graphDepthAttachmentHandle) {
      blackboard.set(FrameResources.SceneDepthAttachment, result.graphDepthAttachmentHandle);
    }
    // Derived attachment + final-framebuffer mode are consumed by later modules.
    fg.state.renderDepthAttachment =
      result.graphDepthAttachmentHandle ?? result.externalDepthAttachment ?? null;
    // Rendering the scene directly into the final framebuffer is only possible
    // when no opaque-layer effect is enabled: those effects must sample the
    // opaque scene color as a texture and may require surface MRT attachments
    // (SSR roughness / SSS / SkinSSS), which the single-color final framebuffer
    // cannot carry.
    const opaqueLayerHasEffects = !!ctx.compositor?.layerHasEnabledEffect(PostEffectLayer.opaque);
    fg.state.useFinalFramebufferAsIntermediate =
      !!result.externalDepthAttachment &&
      result.externalDepthAttachment === ctx.finalFramebuffer?.getDepthAttachment() &&
      !opaqueLayerHasEffects;
  }
};

// ─── Screen-space shadow mask module ────────────────────────────────

/** @internal */
const ShadowMaskModule: RenderModule = {
  type: 'ShadowMaskPass',
  // Gate on build-time state only: renderQueue.shadowedLights is available now,
  // whereas ctx.shadowMapInfo is populated later by the ShadowMaps pass execute
  // (which runs before this pass thanks to the ordering-token chain), so it must
  // not be part of the pass-creation condition.
  enabled: ({ ctx, renderQueue }) => ctx.screenSpaceShadowMask && renderQueue.shadowedLights.length > 0,
  setup(fg) {
    // When active, render each shadow-casting light's visibility into an RGBA8
    // texture array (4 lights per layer). The clustered LightPass samples this
    // mask instead of each shadowed light running its own additive pass. The
    // layer/channel order is locked to ClusteredLight.getVisibleLights: shadow
    // lights fill clustered buffer indices 1..N in renderQueue.shadowedLights
    // order, and ordinal s = index-1 maps to layer s>>2, channel s&3.
    const { graph, ctx, renderQueue, blackboard } = fg;
    const depthPassResult = fg.state.depth!;
    const numShadowLights = renderQueue.shadowedLights.length;
    const numLayers = ShadowMaskRenderer.getLayerCount(numShadowLights);
    const maskPassResult = graph.addPass('ShadowMaskPass', (builder) => {
      // Freeze the current linear-depth handle at build time. Reading the
      // blackboard here returns the version live at this pipeline position (the
      // opaque prepass depth, before any TransmissionDepth mutation), which is
      // what the shadow mask is built from; capturing it by value avoids reading
      // a later version this pass never declared.
      const maskDepthHandle = blackboard.expect(FrameResources.LinearDepth);
      builder.read(maskDepthHandle);
      builder.read(depthPassResult.depthFramebufferHandle);
      // createTexture already registers this pass as the resource producer, so
      // downstream passes read this handle directly (same pattern as HiZ). The
      // per-layer framebuffers are created inside execute (rgCtx.createFramebuffer),
      // which the graph cannot see; the createTexture producer edge is what keeps
      // the resource alive and ordered before the LightPass reader.
      const maskHandle = builder.createTexture({
        format: 'rgba8unorm',
        label: 'shadowMask',
        arrayLayers: numLayers
      });
      builder.setExecute((rgCtx) => {
        const depthTex = rgCtx.getTexture<Texture2D>(maskDepthHandle);
        const maskTex = rgCtx.getTexture<Texture2DArray>(maskHandle);
        _shadowMaskRenderer.render(ctx, depthTex, renderQueue.shadowedLights, (layer) =>
          rgCtx.createFramebuffer<FrameBuffer>({
            width: maskTex.width,
            height: maskTex.height,
            colorAttachments: maskTex,
            depthAttachment: null,
            attachmentLayer: layer
          })
        );
        ctx.shadowMaskTexture = maskTex;
      });
      return { maskHandle };
    });
    fg.state.shadowMaskHandle = maskPassResult.maskHandle;
    blackboard.set(FrameResources.ShadowMask, maskPassResult.maskHandle);
  }
};

// ─── Pre-light transmission depth module (SSR Hi-Z) ─────────────────

/** @internal */
const TransmissionDepthForSSRModule: RenderModule = {
  type: 'TransmissionDepthForSSR',
  enabled: ({ options }) => options.needsTransmissionDepthForSSR,
  setup(fg) {
    const { graph, frame, blackboard } = fg;
    const depthPassResult = fg.state.depth!;
    const transmissionDepthResult = graph.addPass('TransmissionDepthForSSR', (builder) => {
      const currentDepth = blackboard.expect(FrameResources.LinearDepth);
      builder.read(currentDepth);
      builder.read(depthPassResult.depthFramebufferHandle);
      // This pass renders transmission geometry into the prepass linear-depth
      // texture: model the mutation as a write so later readers order against
      // it through data flow instead of relying on the token alone.
      const depthOut = builder.write(currentDepth);
      const done = builder.createToken('TransmissionDepthForSSRDone');
      builder.sideEffect();
      builder.setExecute((rgCtx) => {
        renderTransmissionDepthPass(frame, rgCtx);
      });
      return { done, depthOut };
    });
    fg.state.preLightTransmissionDepthToken = transmissionDepthResult.done;
    // Re-register so blackboard consumers read the post-transmission version.
    blackboard.set(FrameResources.LinearDepth, transmissionDepthResult.depthOut);
  }
};

// ─── Hi-Z pyramid module ────────────────────────────────────────────

/** @internal */
const HiZModule: RenderModule = {
  type: 'HiZ',
  enabled: ({ options }) => options.hiZ,
  setup(fg) {
    const { graph, ctx, frame, blackboard } = fg;
    const depthPassResult = fg.state.depth!;
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    let hiZHandle: RGHandle | undefined;
    graph.addPass('HiZ', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      hiZHandle = builder.createTexture({
        format: 'rg32f',
        label: 'hiZ',
        mipLevels: getFullMipLevelCount(ctx.renderWidth, ctx.renderHeight)
      });
      const hiZFramebufferHandle = builder.createFramebuffer({
        label: 'HiZFramebuffer',
        colorAttachments: hiZHandle,
        depthAttachment: null
      });
      builder.setExecute((rgCtx) => {
        const passCtx = frame.ctx;
        // Use the depth texture from the framebuffer (which contains the RenderGraph texture)
        const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;
        if (depthTex) {
          // Get the HiZ texture allocated by the executor
          const hiZTex = rgCtx.getTexture<Texture2D>(hiZHandle!);
          const HiZFrameBuffer = rgCtx.getFramebuffer<FrameBuffer>(hiZFramebufferHandle);
          buildHiZ(depthTex, HiZFrameBuffer);
          passCtx.HiZTexture = hiZTex;
        }
      });
    });
    if (hiZHandle) {
      fg.state.hiZHandle = hiZHandle;
      blackboard.set(FrameResources.HiZ, hiZHandle);
    }
  }
};

// ─── Forward SSS profile module ─────────────────────────────────────

/** @internal */
const SSSProfileModule: RenderModule = {
  type: 'SSSProfile',
  enabled: ({ options }) => options.sss,
  setup(fg) {
    const { graph, ctx, frame, blackboard } = fg;
    const depthPassResult = fg.state.depth!;
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    fg.state.sssProfile = graph.addPass('SSSProfile', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      const profileHandle = builder.createTexture({ format: 'rgba16f', label: 'sssProfile' });
      const paramHandle = builder.createTexture({ format: 'rgba8unorm', label: 'sssParam' });
      const normalHandle = fg.options.ssr
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
};

// ─── Scene color grab module ────────────────────────────────────────

/** @internal */
const SceneColorGrabModule: RenderModule = {
  type: 'SceneColorGrab',
  enabled: ({ options }) => options.needSceneColor,
  setup(fg) {
    // Renders the full scene (no transmission) into a copy texture that
    // transmission/refraction materials sample as background.
    const { graph, ctx, frame, blackboard, options } = fg;
    const depthPassResult = fg.state.depth!;
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    fg.state.grab = graph.addPass('SceneColorGrab', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      const copyHandle = builder.createTexture({
        format: ctx.colorFormat!,
        label: 'sceneColorCopy'
      });
      // SSR may pre-insert transmission depth before LightPass for Hi-Z. In that
      // case the refraction scene-color copy needs an isolated depth buffer so
      // transmission surfaces do not occlude the background they sample.
      const copyFramebufferHandle = !options.needsTransmissionDepthForSSR
        ? builder.createFramebuffer({
            label: 'SceneColorCopyFramebuffer',
            width: ctx.renderWidth,
            height: ctx.renderHeight,
            colorAttachments: copyHandle,
            depthAttachment: renderDepthAttachment,
            ignoreDepthStencil: false
          })
        : undefined;
      builder.setExecute((rgCtx) => {
        renderSceneColorGrab(frame, rgCtx, copyHandle, copyFramebufferHandle);
      });
      return { copyHandle, copyFramebufferHandle };
    });
  }
};

// ─── Main light pass module ─────────────────────────────────────────

/** @internal */
const LightPassModule: RenderModule = {
  type: 'LightPass',
  enabled: () => true,
  setup(fg) {
    const { graph, ctx, frame, blackboard, options, backbuffer } = fg;
    const depthPassResult = fg.state.depth!;
    const shadowMaskHandle = fg.state.shadowMaskHandle;
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    const hiZHandle = fg.state.hiZHandle;
    const sssProfileResult = fg.state.sssProfile;
    const grabResult = fg.state.grab;
    const useFinalFramebufferAsIntermediate = fg.state.useFinalFramebufferAsIntermediate;
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    const historyManager = fg.history;

    // Import previous-frame SSR history textures the light pass samples through
    // its temporal reflection path (kept in a read scope during execute).
    const lightHistoryReadBindings = fg.state.lightHistoryReadBindings;
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
    // Note: TAA history import/commit is handled by TAA.setup() (self-describing).

    const lightPassResult = graph.addPass('LightPass', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (shadowMaskHandle) {
        builder.read(shadowMaskHandle);
      }
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      if (hiZHandle) {
        builder.read(hiZHandle);
      }
      for (const binding of lightHistoryReadBindings) {
        builder.read(binding.handle);
      }

      // Scene color: in final-framebuffer-as-intermediate mode the scene is
      // physically rendered into the final framebuffer, so declare the
      // backbuffer write — the graph sees the real data flow and no keep-alive
      // reads are needed downstream. Otherwise render into a graph texture.
      const sceneColorHandle = useFinalFramebufferAsIntermediate
        ? builder.write(backbuffer)
        : builder.createTexture({
            format: ctx.colorFormat!,
            label: 'sceneColor'
          });

      // Transmission/refraction background produced by the SceneColorGrab pass
      const sceneColorCopyHandle = grabResult?.copyHandle;
      if (sceneColorCopyHandle) {
        builder.read(sceneColorCopyHandle);
      }
      if (sssProfileResult) {
        builder.read(sssProfileResult.profileHandle);
        builder.read(sssProfileResult.paramHandle);
        if (sssProfileResult.normalHandle) {
          builder.read(sssProfileResult.normalHandle);
        }
      }
      const includeSSRSurfaceMRT = !!options.ssr;
      // SSR glossy-surface MRT outputs (roughness + world normal) are graph
      // textures owned by this pass; effects reach them through the blackboard
      // handles (or the ctx fields resolved below during execution).
      const ssrRoughnessHandle = includeSSRSurfaceMRT
        ? builder.createTexture({ format: getSurfaceTextureFormat(ctx), label: 'ssrRoughness' })
        : undefined;
      const ssrNormalHandle = includeSSRSurfaceMRT
        ? builder.createTexture({ format: getSurfaceTextureFormat(ctx), label: 'ssrNormal' })
        : undefined;
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

      builder.setExecute((rgCtx) => {
        const sceneColorTex = rgCtx.getTexture<Texture2D>(sceneColorHandle);
        const sceneColorCopyTex = sceneColorCopyHandle
          ? rgCtx.getTexture<Texture2D>(sceneColorCopyHandle)
          : null;
        // Resolve MRT products into the DrawContext bridge fields that scene
        // rendering and apply()-based effects still read.
        ctx.SSRRoughnessTexture = ssrRoughnessHandle ? rgCtx.getTexture<Texture2D>(ssrRoughnessHandle) : null;
        ctx.SSRNormalTexture = ssrNormalHandle ? rgCtx.getTexture<Texture2D>(ssrNormalHandle) : null;
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
          renderOpaqueScenePass(frame, sceneColorTex, sceneColorCopyTex, rgCtx, sceneColorFramebufferHandle);
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

      return {
        sceneColorHandle,
        sceneColorCopyHandle,
        sceneColorFramebufferHandle,
        ssrRoughnessHandle,
        ssrNormalHandle,
        sssDiffuseHandle,
        sssTransmissionHandle,
        skinSSSHandle
      };
    });
    fg.state.lightPass = lightPassResult;
    // Register the LightPass MRT products so effects can look them up by name.
    if (lightPassResult.ssrRoughnessHandle) {
      blackboard.set(FrameResources.SSRRoughness, lightPassResult.ssrRoughnessHandle);
    }
    if (lightPassResult.ssrNormalHandle) {
      blackboard.set(FrameResources.SSRNormal, lightPassResult.ssrNormalHandle);
    } else if (sssProfileResult?.normalHandle) {
      blackboard.set(FrameResources.SSRNormal, sssProfileResult.normalHandle);
    }
    if (lightPassResult.sssDiffuseHandle) {
      blackboard.set(FrameResources.SSSDiffuse, lightPassResult.sssDiffuseHandle);
    }
    if (lightPassResult.sssTransmissionHandle) {
      blackboard.set(FrameResources.SSSTransmission, lightPassResult.sssTransmissionHandle);
    }
    if (lightPassResult.skinSSSHandle) {
      blackboard.set(FrameResources.SkinSSS, lightPassResult.skinSSSHandle);
    }
  }
};

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
  // Reset any shadow mask carried over from a previous frame; the ShadowMask
  // module re-sets it during execution only when the mask is actually produced.
  ctx.shadowMaskTexture = null;

  // Named registry of shared frame resources (consumed by post effect setup)
  const blackboard = new RGBlackboard();

  // Shared mutable frame state
  const frame: FrameState = {
    ctx,
    renderQueue,
    depthFramebuffer: null,
    sunLightColor: null,
    options,
    renderQueueDisposed: false,
    clusteredLightReleased: false,
    sunLightRestored: false
  };

  // Build-time context threaded through the pass-build blocks. Inter-block
  // handles flow through `blackboard` (by FrameResources name) and ordering
  // tokens through `ordering`, so no block reaches another's local variables.
  const ordering = new OrderingScope();
  const fg: FrameGraphContext = {
    graph,
    ctx,
    renderQueue,
    blackboard,
    frame,
    history: ctx.camera?.getHistoryResourceManager?.() ?? null,
    options,
    ordering,
    backbuffer,
    state: {
      renderDepthAttachment: null,
      useFinalFramebufferAsIntermediate: false,
      shadowMaskHandle: null,
      lightHistoryReadBindings: []
    }
  };

  // ── 1-4. Pre-scene side-effect passes ─────────────────────────────
  // These carry no data product; they are ordered relative to one another and
  // to the depth prepass through the ordering-token chain. Each is a
  // self-describing module reading only from the shared context.
  for (const module of PRE_SCENE_MODULES) {
    if (module.enabled(fg)) {
      module.setup(fg);
    }
  }

  // ── 5. Depth Prepass ──────────────────────────────────────────────
  DepthPrepassModule.setup(fg);
  const depthPassResult = fg.state.depth!;
  const renderDepthAttachment = fg.state.renderDepthAttachment;
  const useFinalFramebufferAsIntermediate = fg.state.useFinalFramebufferAsIntermediate;

  // ── Screen-space shadow mask ────────────────────────────────────────────
  if (ShadowMaskModule.enabled(fg)) {
    ShadowMaskModule.setup(fg);
  }

  // ── Pre-light transmission depth (SSR Hi-Z) ─────────────────────────────
  if (TransmissionDepthForSSRModule.enabled(fg)) {
    TransmissionDepthForSSRModule.setup(fg);
  }

  // ── 6. Hi-Z (optional) ───────────────────────────────────────────
  if (HiZModule.enabled(fg)) {
    HiZModule.setup(fg);
  }
  const hiZHandle = fg.state.hiZHandle;

  // ── 7. Main light pass (SSS profile → scene-color grab → opaque lighting) ─

  // ── 7a. Forward SSS profile (optional) ────────────────────────────
  if (SSSProfileModule.enabled(fg)) {
    SSSProfileModule.setup(fg);
  }
  const sssProfileResult = fg.state.sssProfile;

  // ── 7b. Scene color grab (optional) ───────────────────────────────
  if (SceneColorGrabModule.enabled(fg)) {
    SceneColorGrabModule.setup(fg);
  }
  const grabResult = fg.state.grab;

  // ── 7c. Main light pass (imports SSR history, resolves MRT bridge fields) ─
  LightPassModule.setup(fg);
  const lightPassResult = fg.state.lightPass!;
  const lightHistoryReadBindings = fg.state.lightHistoryReadBindings;
  const historyManager = fg.history;

  // 7d. Opaque-layer post effects (SAO/SSR/SSS/SkinSSS). They read the opaque
  // scene color and must complete before transparent geometry renders on top
  // of their output. Never direct-write: the chain output becomes the
  // transparent pass's render target. In final-framebuffer-as-intermediate
  // mode the scene color handle is the LightPass's backbuffer write version,
  // so the data flow is real either way — no keep-alive reads needed.
  const opaqueChainInput = lightPassResult.sceneColorHandle;
  // Data dependencies for every effect pass: frame textures the effects sample
  // through DrawContext fields (linear depth, HiZ, scene color copy, SSS MRT
  // outputs) rather than through declared require* hooks.
  const opaqueChainDeps: RGHandle[] = [blackboard.expect(FrameResources.LinearDepth)];
  if (hiZHandle) {
    opaqueChainDeps.push(hiZHandle);
  }
  if (lightPassResult.sceneColorFramebufferHandle) {
    opaqueChainDeps.push(lightPassResult.sceneColorFramebufferHandle);
  }
  if (grabResult) {
    opaqueChainDeps.push(grabResult.copyHandle);
  }
  if (sssProfileResult) {
    opaqueChainDeps.push(sssProfileResult.profileHandle, sssProfileResult.paramHandle);
    if (sssProfileResult.normalHandle) {
      opaqueChainDeps.push(sssProfileResult.normalHandle);
    }
  }
  for (const handle of [
    lightPassResult.ssrRoughnessHandle,
    lightPassResult.ssrNormalHandle,
    lightPassResult.sssDiffuseHandle,
    lightPassResult.sssTransmissionHandle,
    lightPassResult.skinSSSHandle
  ]) {
    if (handle) {
      opaqueChainDeps.push(handle);
    }
  }
  const opaqueChainResult = ctx.compositor
    ? ctx.compositor.buildLayer({
        graph,
        ctx,
        layer: PostEffectLayer.opaque,
        blackboard,
        input: opaqueChainInput,
        finalOutput: null,
        sceneDepthAttachment: renderDepthAttachment,
        dependencies: opaqueChainDeps,
        historyReads: lightHistoryReadBindings,
        history: historyManager
      })
    : { color: opaqueChainInput, wroteFinal: false };
  const opaqueChainRan = opaqueChainResult.color !== opaqueChainInput;

  // 7e. Transparent scene geometry (transmission/transparent lists + OIT).
  // Renders on top of the opaque-chain output; graph-wise an in-place write
  // producing a new version of the current scene color.
  const sceneColorHandle = graph.addPass('TransparentPass', (builder) => {
    builder.read(blackboard.expect(FrameResources.LinearDepth));
    builder.read(depthPassResult.depthFramebufferHandle);
    if (hiZHandle) {
      // Transparent-phase materials may ray-march HiZ (e.g. water SSR)
      builder.read(hiZHandle);
    }
    if (lightPassResult.sceneColorFramebufferHandle) {
      builder.read(lightPassResult.sceneColorFramebufferHandle);
    }
    if (lightPassResult.sceneColorCopyHandle) {
      builder.read(lightPassResult.sceneColorCopyHandle);
    }
    builder.read(opaqueChainResult.color);
    const out = builder.write(opaqueChainResult.color);
    builder.setExecute((rgCtx) => {
      renderTransparentScenePass(
        frame,
        rgCtx,
        opaqueChainRan ? opaqueChainResult.color : null,
        lightPassResult.sceneColorFramebufferHandle
      );
    });
    return out;
  });
  blackboard.set(FrameResources.SceneColor, sceneColorHandle);
  if (lightPassResult.sceneColorCopyHandle) {
    blackboard.set(FrameResources.SceneColorCopy, lightPassResult.sceneColorCopyHandle);
  }
  if (sssProfileResult) {
    blackboard.set(FrameResources.SSSProfile, sssProfileResult.profileHandle);
    blackboard.set(FrameResources.SSSParam, sssProfileResult.paramHandle);
  }

  // 8. Post effect chains + transmission depth.
  //
  // Chain input: the TransparentPass output version — the authoritative scene
  // color regardless of whether it physically lives in a texture or in the
  // backbuffer (final framebuffer used as intermediate, no opaque effects).
  const chainInput = sceneColorHandle;
  // When the scene color still physically resides in the final framebuffer,
  // the Present blit must be skipped if no effect moved it to a texture.
  // (Opaque-layer effects disable final-as-intermediate mode, so the scene
  // color is backbuffer-resident whenever that mode is active.)
  const backbufferResidentHandle = useFinalFramebufferAsIntermediate ? sceneColorHandle : null;
  // No extra chain dependencies: the effect chains link to the scene color
  // through their inputs, and per-effect texture needs are declared via the
  // require* hooks in AbstractPostEffect.setup().
  const chainDependencies: RGHandle[] = [];
  const finalOutput = { handle: backbuffer, isScreen: !ctx.finalFramebuffer };
  const endLayerHasEffects = !!ctx.compositor?.layerHasEnabledEffect(PostEffectLayer.end);

  // 8a. Transparent-layer effects (bloom, tonemap, FXAA, ...). They run right
  // after the light pass and must sample the pre-transmission linear depth, so
  // they carry no transmissionDepthToken dependency; TransmissionDepth is
  // instead ordered after this chain (see 8b).
  const transparentChainResult = ctx.compositor
    ? ctx.compositor.buildLayer({
        graph,
        ctx,
        layer: PostEffectLayer.transparent,
        blackboard,
        input: chainInput,
        finalOutput: endLayerHasEffects ? null : finalOutput,
        inputResidesInFinalTarget: !!backbufferResidentHandle,
        sceneDepthAttachment: renderDepthAttachment,
        dependencies: chainDependencies,
        history: historyManager
      })
    : { color: chainInput, wroteFinal: false };

  // 8b. Transmission depth pass (optional). Mutates the linear depth texture;
  // the mutation is modeled as a graph write: the WAR hazard orders this pass
  // after every pre-transmission depth reader (the transparent-layer chain),
  // and re-registering the post-write version in the blackboard gives
  // end-layer effects (TAA) a real data dependency on the transmission depth.
  let transmissionDepthToken: RGHandle | undefined;
  if (options.needSceneColor && !options.needsTransmissionDepthForSSR) {
    const transmissionDepthResult = graph.addPass('TransmissionDepth', (builder) => {
      const currentDepth = blackboard.expect(FrameResources.LinearDepth);
      builder.read(sceneColorHandle);
      if (transparentChainResult.color !== sceneColorHandle) {
        builder.read(transparentChainResult.color);
      }
      builder.read(currentDepth);
      builder.read(depthPassResult.depthFramebufferHandle);
      const depthOut = builder.write(currentDepth);
      const done = builder.createToken('TransmissionDepthDone');
      builder.sideEffect();
      builder.setExecute((rgCtx) => {
        renderTransmissionDepthPass(frame, rgCtx);
      });
      return { done, depthOut };
    });
    transmissionDepthToken = transmissionDepthResult.done;
    // The transparent-layer chain above read the pre-transmission version;
    // everything built from here on (end-layer chain) reads this one.
    blackboard.set(FrameResources.LinearDepth, transmissionDepthResult.depthOut);
  }

  // 9. End-layer effects (TAA). Ordered after TransmissionDepth.
  const endChainDependencies = transmissionDepthToken
    ? [...chainDependencies, transmissionDepthToken]
    : chainDependencies;
  const chainResult = ctx.compositor
    ? ctx.compositor.buildLayer({
        graph,
        ctx,
        layer: PostEffectLayer.end,
        blackboard,
        input: transparentChainResult.color,
        finalOutput,
        // Still backbuffer-resident if the transparent-layer chain ran no effect
        inputResidesInFinalTarget: !!backbufferResidentHandle && transparentChainResult.color === chainInput,
        sceneDepthAttachment: renderDepthAttachment,
        dependencies: endChainDependencies,
        history: historyManager
      })
    : { color: transparentChainResult.color, wroteFinal: false };
  const finalWroteFinal = chainResult.wroteFinal || transparentChainResult.wroteFinal;

  // 10. Present + frame cleanup.
  let presentedBackbuffer: RGHandle;
  if (finalWroteFinal) {
    // The last effect wrote the final target directly; only cleanup remains.
    presentedBackbuffer = chainResult.color;
    graph.addPass('FrameCleanup', (builder) => {
      builder.read(presentedBackbuffer);
      for (const dep of endChainDependencies) {
        builder.read(dep);
      }
      builder.sideEffect();
      builder.setExecute(() => {
        finishFrame(frame);
      });
    });
  } else {
    presentedBackbuffer = graph.addPass('Present', (builder) => {
      builder.read(chainResult.color);
      for (const dep of endChainDependencies) {
        builder.read(dep);
      }
      const outputBackbuffer = builder.write(backbuffer);
      // Skip the blit when the chain output already lives in the final target
      // (final framebuffer used as intermediate and no end-layer effect ran).
      const needsBlit = chainResult.color !== backbufferResidentHandle;
      builder.setExecute((rgCtx) => {
        const sourceTex = needsBlit ? rgCtx.getTexture<Texture2D>(chainResult.color) : null;
        if (sourceTex) {
          const blitter = new CopyBlitter();
          blitter.srgbOut = !ctx.finalFramebuffer;
          blitter.blit(sourceTex, ctx.finalFramebuffer ?? null, fetchSampler('clamp_nearest_nomip'));
        }
        finishFrame(frame);
      });
      return outputBackbuffer;
    });
  }

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
  // Device state is contained within each pass now (LightPass/TransparentPass
  // push/pop their own framebuffer bindings); only the context field remains.
  frame.ctx.intermediateFramebuffer = null;
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

/**
 * Renders the full scene (no transmission) into the scene-color copy texture
 * used as refraction background. Runs as its own graph pass before LightPass.
 * @internal
 */
function renderSceneColorGrab(
  frame: FrameState,
  rgCtx: RGExecuteContext,
  copyHandle: RGHandle,
  copyFramebufferHandle?: RGHandle
): void {
  const { ctx, renderQueue } = frame;
  const device = ctx.device;
  const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;
  const copyTex = rgCtx.getTexture<Texture2D>(copyHandle);
  const compositor = ctx.compositor;
  ctx.compositor = null;
  const isolateSceneColorDepth = frame.options.needsTransmissionDepthForSSR;
  const savedDepthPrepassAttachment = ctx.depthPrepassAttachment;
  const savedMaterialFlags = ctx.materialFlags;

  // MRT store flags never apply to the background copy
  const sceneColorMaterialFlags = ctx.materialFlags & ~SURFACE_MRT_FLAGS;
  const sceneColorFramebuffer = copyFramebufferHandle
    ? rgCtx.getFramebuffer<FrameBuffer>(copyFramebufferHandle)
    : rgCtx.createFramebuffer<FrameBuffer>({
        width: copyTex.width,
        height: copyTex.height,
        colorAttachments: copyTex,
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
    } else {
      _scenePass.clearDepth = depthTex ? null : 1;
      _scenePass.clearStencil = depthTex ? null : 0;
    }
    ctx.materialFlags = sceneColorMaterialFlags;
    _scenePass.render(ctx, null, null, renderQueue);
  } finally {
    ctx.materialFlags = savedMaterialFlags;
    if (isolateSceneColorDepth) {
      ctx.depthPrepassAttachment = savedDepthPrepassAttachment;
    }
    if (sceneColorStatePushed) {
      device.popDeviceStates();
    }
    ctx.compositor = compositor;
  }
}

/** @internal */
function renderOpaqueScenePass(
  frame: FrameState,
  sceneColorTex: Texture2D,
  sceneColorCopyTex: Nullable<Texture2D>,
  rgCtx: RGExecuteContext,
  sceneColorFramebufferHandle?: RGHandle
): void {
  const { ctx, renderQueue } = frame;

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

  // The graph scene color framebuffer takes priority: it is absent only when
  // the graph was built in final-framebuffer-as-intermediate mode (external
  // depth shared with the final framebuffer AND no opaque-layer effects).
  // Checking the shared depth first would wrongly route the MRT/opaque-effect
  // case into the single-color final framebuffer.
  if (sceneColorFramebufferHandle && !hasSurfaceMRT(ctx)) {
    ctx.intermediateFramebuffer = rgCtx.getFramebuffer<FrameBuffer>(sceneColorFramebufferHandle);
  } else if (!sceneColorFramebufferHandle && depthTex === ctx.finalFramebuffer?.getDepthAttachment()) {
    ctx.intermediateFramebuffer = ctx.finalFramebuffer;
  } else {
    ctx.intermediateFramebuffer = rgCtx.createFramebuffer<FrameBuffer>({
      width: sceneColorTex.width,
      height: sceneColorTex.height,
      colorAttachments: getLightPassColorAttachments(ctx, sceneColorTex),
      depthAttachment: depthTex
    });
  }

  // The scene target is bound explicitly and the device state is restored at
  // the end of this pass: graph passes never communicate through leftover
  // device state. TransparentPass re-binds the same target (or the opaque
  // chain output) explicitly.
  ctx.device.pushDeviceStates();
  try {
    // setFramebuffer() no-ops when the target is unchanged, so reset the
    // viewport/scissor explicitly to cover that case.
    ctx.device.setFramebuffer(ctx.intermediateFramebuffer);
    ctx.device.setViewport(null);
    ctx.device.setScissor(null);

    _scenePass.transmission = false;
    _scenePass.clearDepth = depthTex ? null : 1;
    _scenePass.clearStencil = depthTex ? null : 0;

    if (renderQueue.needSceneColor() && sceneColorCopyTex) {
      // Background copy was produced by the SceneColorGrab pass; seed the main
      // color attachment with it and render only transmission/transparent on top.
      ctx.sceneColorTexture = sceneColorCopyTex;
      blitToCurrentColorAttachment(ctx, ctx.sceneColorTexture);
      if (hasSurfaceMRT(ctx)) {
        // The background copy carries no surface MRT attachments, so opaque
        // geometry exists only there without roughness/normal (and SSS
        // lighting) data. Re-render the opaque lists into the MRT scene
        // target: early-z against the prepass depth keeps this cheap, and the
        // color output matches the blitted copy on opaque pixels while the
        // MRT attachments receive the surface data SSR/SSS require.
        _scenePass.clearColor = null;
        _scenePass.clearDepth = null;
        _scenePass.clearStencil = null;
        _scenePass.renderOpaque = true;
        _scenePass.renderTransparent = false;
        _scenePass.render(ctx, null, null, renderQueue);
      }
      _scenePass.transmission = true;
      _scenePass.clearColor = null;
      _scenePass.clearDepth = null;
      _scenePass.clearStencil = null;
    }
    _scenePass.renderOpaque = true;
    _scenePass.renderTransparent = false;
    _scenePass.render(ctx, null, null, renderQueue);
  } finally {
    // Restore the shared _scenePass flags so no state leaks to the next pass:
    // the transparent pass sets transmission/renderOpaque/renderTransparent
    // itself rather than inheriting whatever this pass happened to leave.
    _scenePass.renderTransparent = true;
    _scenePass.transmission = false;
    ctx.device.popDeviceStates();
  }
}

/**
 * Renders the transmission/transparent geometry lists (including OIT) on top
 * of the opaque result. The target framebuffer is always bound explicitly:
 * the opaque chain output when opaque-layer effects ran, otherwise the same
 * scene target the light pass rendered into. OIT implementations composite
 * into the currently bound framebuffer, which this pass guarantees.
 * @internal
 */
function renderTransparentScenePass(
  frame: FrameState,
  rgCtx: RGExecuteContext,
  opaqueChainOutput: Nullable<RGHandle>,
  sceneColorFramebufferHandle?: RGHandle
): void {
  const { ctx, renderQueue } = frame;
  const device = ctx.device;
  let framebuffer: Nullable<FrameBuffer>;
  if (opaqueChainOutput) {
    // Opaque-layer effects redirected the scene color into their chain output;
    // transparent geometry renders on top of it with the scene depth attached.
    const chainTex = rgCtx.getTexture<Texture2D>(opaqueChainOutput);
    const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;
    framebuffer = rgCtx.createFramebuffer<FrameBuffer>({
      width: chainTex.width,
      height: chainTex.height,
      colorAttachments: chainTex,
      depthAttachment: depthTex
    });
    // The chain output is single-color: surface MRT stores no longer apply.
    ctx.materialFlags &= ~SURFACE_MRT_FLAGS;
  } else if (sceneColorFramebufferHandle) {
    // No opaque-layer effect ran (thus no surface MRT either): continue in the
    // graph scene color framebuffer the light pass rendered into.
    framebuffer = rgCtx.getFramebuffer<FrameBuffer>(sceneColorFramebufferHandle);
  } else {
    // Final framebuffer used as scene intermediate.
    framebuffer = ctx.finalFramebuffer;
  }
  device.pushDeviceStates();
  try {
    // setFramebuffer() no-ops when the target is unchanged, so reset the
    // viewport/scissor explicitly to cover that case.
    device.setFramebuffer(framebuffer);
    device.setViewport(null);
    device.setScissor(null);
    // Derive transmission mode from the same single source of truth the opaque
    // pass used (renderQueue.needSceneColor()) instead of inheriting leftover
    // _scenePass state. When scene color is needed the opaque pass seeded the
    // refraction background and drew the transmission-opaque list, so here we
    // draw transmission_trans + transparent; otherwise just the transparent
    // list. Never clear: the opaque result is already in the target.
    _scenePass.transmission = renderQueue.needSceneColor();
    _scenePass.clearColor = null;
    _scenePass.clearDepth = null;
    _scenePass.clearStencil = null;
    _scenePass.renderOpaque = false;
    _scenePass.renderTransparent = true;
    try {
      _scenePass.render(ctx, null, null, renderQueue);
    } finally {
      _scenePass.renderOpaque = true;
    }
  } finally {
    device.popDeviceStates();
  }
}

/** @internal */
function renderTransmissionDepthPass(frame: FrameState, rgCtx: RGExecuteContext): void {
  renderSceneDepth(frame, frame.depthFramebuffer, rgCtx);
}

/**
 * Frame-tail housekeeping shared by the Present and FrameCleanup passes.
 *
 * The end-layer post effect chain and the final blit are graph passes now
 * (see buildForwardPlusGraphInternal step 9/10); this only releases per-frame
 * state. The compositor's scene ping-pong is flushed back to the intermediate
 * framebuffer by compositor.end() at the tail of the light pass.
 *
 * @internal
 */
function finishFrame(frame: FrameState): void {
  const { ctx } = frame;

  disposeRenderQueue(frame);
  ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_PROFILE;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_DIFFUSE;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_NORMAL;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_TRANSMISSION;
  ctx.materialFlags &= ~MaterialVaryingFlags.SKIN_SSS_STORE;

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
