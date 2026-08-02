import type { Nullable } from '@zephyr3d/base';
import {
  /*nextPowerOf2, */ DEPTH_CLEAR_VALUE,
  DEPTH_COMPARE_DEFAULT,
  REVERSE_Z,
  Vector4
} from '@zephyr3d/base';
import type {
  AbstractDevice,
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
import { ShaderHelper } from '../../material/shader/helper';
import { AbstractPostEffect, PostEffectLayer } from '../../posteffect/posteffect';
import { RenderGraph } from './rendergraph';
import { RenderGraphExecutor } from './executor';
import { RGTextureAffinityCache } from './texture_affinity_cache';
import { DevicePoolAllocator } from './device_pool_allocator';
import { HistoryResourceManager } from './history_resource_manager';
import { RGHistoryResources } from './history_resources';
import { RGBlackboard, FrameResources, type FrameResourceKey } from './blackboard';
import { OrderingScope } from './render_context';
import type { FrameGraphContext } from './frame_graph_context';
import type { RenderModule } from './render_module';
import { RenderPipeline } from './render_pipeline';
import type { FrameResourceRequirements } from './frame_resource_requirements';
import { mergeFrameResourceRequirements } from './frame_resource_requirements';
import type { RGExecuteContext, RGHandle } from './types';
import { renderObjectColors } from '../gpu_picking';
import type { Primitive } from '../primitive';
import { BoxShape } from '../../shapes';

const _scenePass = new LightPass();
const _depthPass = new DepthPass();
const _shadowMapPass = new ShadowMapPass();
const _clusters: ClusteredLight[] = [];
const _shadowMaskRenderer = new ShadowMaskRenderer();
const _devicePoolAllocator = new DevicePoolAllocator();
const _textureAffinityCaches = new WeakMap<
  Camera,
  { device: AbstractDevice; cache: RGTextureAffinityCache<Texture2D> }
>();

function getTextureAffinityCache(camera: Camera, device: AbstractDevice): RGTextureAffinityCache<Texture2D> {
  const current = _textureAffinityCaches.get(camera);
  if (current?.device === device) {
    return current.cache;
  }
  const cache = new RGTextureAffinityCache<Texture2D>();
  _textureAffinityCaches.set(camera, { device, cache });
  return cache;
}

/** Test-only access to the shared scene pass. @internal */
export function _getScenePassForTest(): LightPass {
  return _scenePass;
}

let _backDepthColorState: Nullable<ColorState> = null;
let _frontDepthColorState: Nullable<ColorState> = null;
const SURFACE_MRT_FLAGS =
  MaterialVaryingFlags.SCENE_STORE_ROUGHNESS |
  MaterialVaryingFlags.SSS_STORE_PROFILE |
  MaterialVaryingFlags.SSS_STORE_DIFFUSE |
  MaterialVaryingFlags.SCENE_STORE_NORMAL |
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

function supportsSSGIRenderTargets(ctx: DrawContext): boolean {
  const caps = ctx.device.getDeviceCaps();
  const rgba16fBytes = caps.textureCaps.getTextureFormatInfo('rgba16f').size;
  return !!(
    caps.textureCaps.supportHalfFloatColorBuffer &&
    caps.framebufferCaps.maxDrawBuffers >= 2 &&
    caps.framebufferCaps.maxColorAttachmentBytesPerSample >= rgba16fBytes * 2
  );
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
  surfaceAttachmentCount: number
): TextureFormat {
  const colorFormat = ctx.colorFormat!;
  if (surfaceAttachmentCount === 0 || attachmentCount === 0) {
    return colorFormat;
  }
  const caps = ctx.device.getDeviceCaps();
  // MRT graph textures are not resolved on DrawContext yet.
  const surfaceFormat = getSurfaceTextureFormat(ctx);
  const colorBytes =
    getTextureFormatBytes(ctx, colorFormat) +
    getTextureFormatBytes(ctx, surfaceFormat) * surfaceAttachmentCount;
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
  if (ctx.materialFlags & MaterialVaryingFlags.SCENE_STORE_ROUGHNESS) {
    attachments.push(ctx.SceneRoughnessTexture!);
  }
  if (ctx.materialFlags & MaterialVaryingFlags.SCENE_STORE_NORMAL) {
    attachments.push(ctx.SceneNormalTexture!);
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

/** Per-frame Forward+ feature options. @public */
export interface ForwardPlusOptions {
  /** Enable depth prepass (always true for now). */
  depthPrepass: boolean;
  /** Enable motion vectors (requires TAA or motionBlur). */
  motionVectors: boolean;
  /** Enable Hi-Z pyramid (for SSR ray tracing). */
  hiZ: boolean;
  /** Produce opaque-scene world normals. */
  sceneNormal: boolean;
  /** Produce opaque-scene roughness data. */
  sceneRoughness: boolean;
  /** Produce and consume the clustered screen-space shadow mask. */
  shadowMask: boolean;
  /** Enable screen-space reflections. */
  ssr: boolean;
  /** Enable screen-space diffuse global illumination. */
  ssgi: boolean;
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
  /** Whether height fog is composited over the opaque scene this frame. */
  fogPresents: boolean;
}

/** Derive Forward+ options from scene and camera state. @internal */
export function deriveForwardPlusOptions(
  scene: Scene,
  camera: Camera,
  deviceType: string,
  renderQueue: RenderQueue
): ForwardPlusOptions {
  const ssr = camera.SSR && scene.env.light.envLight && scene.env.light.envLight.hasRadiance();
  const ssgi =
    camera.SSGI &&
    camera.HDR &&
    camera.ssgiIntensity > 0 &&
    scene.env.light.type === 'ibl' &&
    !!scene.env.light.envLight?.hasRadiance() &&
    !!scene.env.light.envLight?.hasIrradiance();
  const sss = camera.SSS && renderQueueHasActiveSSS(renderQueue);
  const skinSSS = camera.skinSSS && renderQueueHasActiveSkinSSS(renderQueue);
  const needSceneColor = renderQueue.needSceneColor();
  const needSceneColorWithDepth = renderQueue.needSceneColorWithDepth();
  return {
    depthPrepass: true,
    motionVectors: false,
    hiZ: false,
    sceneNormal: false,
    sceneRoughness: false,
    shadowMask: false,
    ssr: !!ssr,
    ssgi: !!ssgi,
    ssrCalcThickness: !!ssr && camera.ssrCalcThickness,
    gpuPicking: !!camera.getPickResultResolveFunc(),
    needSceneColor,
    needSceneColorWithDepth,
    needsTransmissionDepthForSSR: !!ssr && needSceneColor && !needSceneColorWithDepth,
    sss: !!sss,
    skinSSS: !!skinSSS,
    fogPresents: !!scene.env.sky?.fogPresents
  };
}

function resolveFrameResourceRequirements(
  ctx: DrawContext,
  options: ForwardPlusOptions,
  requirements: FrameResourceRequirements
): void {
  const deviceType = ctx.device.type;
  options.motionVectors ||= !!requirements.motionVector;
  options.hiZ ||= !!requirements.hiZ;
  options.sceneNormal ||= !!requirements.sceneNormal;
  options.sceneRoughness ||= !!requirements.sceneRoughness;
  options.shadowMask ||= !!requirements.shadowMask;

  if (options.motionVectors && deviceType === 'webgl') {
    throw new Error('Forward+: MotionVector was requested but is not supported by the WebGL backend.');
  }
  if (options.hiZ && deviceType === 'webgl') {
    throw new Error('Forward+: HiZ was requested but is not supported by the WebGL backend.');
  }
  if (options.shadowMask && deviceType === 'webgl') {
    throw new Error('Forward+: ShadowMask was requested but is not supported by the WebGL backend.');
  }

  const surfaceAttachmentCount = Number(options.sceneNormal) + Number(options.sceneRoughness);
  if (surfaceAttachmentCount > 0) {
    const caps = ctx.device.getDeviceCaps();
    const maxDrawBuffers = caps.framebufferCaps.maxDrawBuffers ?? Number.MAX_SAFE_INTEGER;
    if (1 + surfaceAttachmentCount > maxDrawBuffers) {
      throw new Error(
        `Forward+: ${surfaceAttachmentCount} scene surface attachment(s) were requested, ` +
          `but the device supports only ${maxDrawBuffers} color attachments.`
      );
    }
    const bytesPerSample =
      getTextureFormatBytes(ctx, ctx.colorFormat) +
      getTextureFormatBytes(ctx, getSurfaceTextureFormat(ctx)) * surfaceAttachmentCount;
    if (bytesPerSample > caps.framebufferCaps.maxColorAttachmentBytesPerSample) {
      throw new Error(
        `Forward+: requested scene surface attachments require ${bytesPerSample} bytes per sample, ` +
          `but the device limit is ${caps.framebufferCaps.maxColorAttachmentBytesPerSample}.`
      );
    }
  }

  ctx.motionVectors = options.motionVectors;
  ctx.HiZ = options.hiZ;
  ctx.SSGI = options.ssgi;
  ctx.screenSpaceShadowMask = options.shadowMask;
  ctx.SSS = options.sss;
}

function validateProducedFrameResources(
  blackboard: RGBlackboard,
  options: ForwardPlusOptions,
  renderQueue: RenderQueue
): void {
  const required: Array<[boolean, FrameResourceKey]> = [
    [options.motionVectors, FrameResources.MotionVector],
    [options.hiZ, FrameResources.HiZ],
    [options.sceneNormal, FrameResources.SceneNormal],
    [options.sceneRoughness, FrameResources.SceneRoughness],
    [options.shadowMask && renderQueue.shadowedLights.length > 0, FrameResources.ShadowMask]
  ];
  for (const [needed, resource] of required) {
    if (needed && !blackboard.has(resource)) {
      throw new Error(
        `Forward+: frame resource "${resource}" was requested but no enabled RenderModule produced it.`
      );
    }
  }
}

/** Mutable state shared by pass callbacks for one frame. @public */
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
  externalDepthImport?: { handle: RGHandle; texture: Texture2D };
}

interface HistoryReadBinding {
  name: string;
  handle: RGHandle;
}

/** Result of the depth prepass module. @public */
export interface DepthPrepassResult {
  depthHandle: RGHandle;
  motionVectorHandle?: RGHandle;
  graphDepthAttachmentHandle?: RGHandle;
  externalDepthAttachmentHandle?: RGHandle;
  externalDepthAttachment: Nullable<Texture2D>;
  depthFramebufferHandle: RGHandle;
}

/** Result of the main light pass module. @public */
export interface LightPassResult {
  sceneColorHandle: RGHandle;
  sceneColorFramebufferHandle?: RGHandle;
  sceneRoughnessHandle?: RGHandle;
  sceneNormalHandle?: RGHandle;
  sssDiffuseHandle?: RGHandle;
  sssTransmissionHandle?: RGHandle;
  skinSSSHandle?: RGHandle;
}

/** Non-resource state shared while Forward+ modules build. @public */
export interface ForwardPlusBuildState {
  /** Depth prepass outputs. */
  depth?: DepthPrepassResult;
  /** Depth attachment used by scene-color/SSS framebuffers (handle or backend texture). */
  renderDepthAttachment: RGHandle | Texture2D | null;
  /** True when the scene renders directly into the final framebuffer. */
  useFinalFramebufferAsIntermediate: boolean;
  /** Ordering token from the pre-light transmission-depth pass, if any. */
  preLightTransmissionDepthToken?: RGHandle;
  /** History textures kept in a read scope while the light pass executes. */
  lightHistoryReadBindings: HistoryReadBinding[];
  /** Main light pass outputs. */
  lightPass?: LightPassResult;
  /** Graph output handle produced by the composite tail. */
  presentedBackbuffer?: RGHandle;
}

/** Require state produced by an earlier module. @internal */
function requireBuildState<K extends keyof ForwardPlusBuildState>(
  fg: FrameGraphContext,
  key: K,
  producerType: string,
  consumerType: string
): NonNullable<ForwardPlusBuildState[K]> {
  const value = fg.state[key];
  if (!value) {
    throw new Error(
      `Forward+ module "${consumerType}" requires module "${producerType}" ` +
        `(build state "${String(key)}" was not produced). Did you remove it from the pipeline?`
    );
  }
  return value;
}

/** @internal */
const SkyUpdateModule: RenderModule<FrameGraphContext> = {
  type: 'SkyUpdate',
  prepare: () => ({ enabled: true }),
  setup({ graph, ctx, frame, ordering }: FrameGraphContext) {
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
const ClusterLightsModule: RenderModule<FrameGraphContext> = {
  type: 'ClusterLights',
  prepare: () => ({ enabled: true }),
  setup({ graph, ctx, renderQueue, ordering }: FrameGraphContext) {
    graph.addPass('ClusterLights', (builder) => {
      ordering.chainInto(builder);
      ordering.emit(builder, 'ClusterLightsDone');
      builder.sideEffect();
      builder.setExecute(() => {
        ctx.clusteredLight = getClusteredLight();
        ctx.clusteredLight.calculateLightIndex(
          ctx.camera,
          renderQueue,
          ctx.screenSpaceShadowMask,
          ShaderHelper.getPreExposure(ctx)
        );
      });
    });
  }
};

/** @internal */
const GPUPickingModule: RenderModule<FrameGraphContext> = {
  type: 'GPUPicking',
  prepare: ({ options }) => ({ enabled: options.gpuPicking }),
  setup({ graph, ctx, renderQueue, ordering }: FrameGraphContext) {
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
const ShadowMapsModule: RenderModule<FrameGraphContext> = {
  type: 'ShadowMaps',
  // Light-owned shadow maps are observable side effects.
  prepare: ({ renderQueue }) => ({ enabled: renderQueue.shadowedLights.length > 0 }),
  setup({ graph, ctx, renderQueue, ordering }: FrameGraphContext) {
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
const DepthPrepassModule: RenderModule<FrameGraphContext> = {
  type: 'DepthPrepass',
  writes: [FrameResources.LinearDepth, FrameResources.MotionVector, FrameResources.SceneDepthAttachment],
  prepare: () => ({ enabled: true }),
  setup(fg: FrameGraphContext) {
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

      const depthHandle = builder.createTexture({
        format,
        label: 'linearDepth',
        allocationKey: 'ForwardPlus.LinearDepth'
      });
      const motionVectorHandle = options.motionVectors
        ? builder.createTexture({
            format: mvFormat,
            label: 'motionVector',
            allocationKey: 'ForwardPlus.MotionVector'
          })
        : undefined;
      const finalDepthAttachment = ctx.finalFramebuffer?.getDepthAttachment();
      const externalDepthAttachment = finalDepthAttachment?.isTexture2D()
        ? (finalDepthAttachment as Texture2D)
        : null;
      const externalDepthAttachmentHandle = externalDepthAttachment
        ? graph.importTexture('externalSceneDepth')
        : undefined;
      const graphDepthAttachmentHandle = externalDepthAttachment
        ? undefined
        : builder.createTexture({
            format: ctx.depthFormat,
            label: 'sceneDepth',
            allocationKey: 'ForwardPlus.SceneDepth'
          });
      const depthAttachmentOrFormat =
        externalDepthAttachmentHandle ?? graphDepthAttachmentHandle ?? ctx.depthFormat;
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
        externalDepthAttachmentHandle,
        externalDepthAttachment,
        depthFramebufferHandle
      };
    });

    fg.state.depth = result;
    // Depth mutations re-register their versions through the blackboard.
    blackboard.set(FrameResources.LinearDepth, result.depthHandle);
    if (result.motionVectorHandle) {
      blackboard.set(FrameResources.MotionVector, result.motionVectorHandle);
    }
    blackboard.set(
      FrameResources.SceneDepthAttachment,
      result.graphDepthAttachmentHandle ?? result.externalDepthAttachmentHandle!
    );
    // Later modules share this attachment without owning it.
    fg.state.renderDepthAttachment =
      result.graphDepthAttachmentHandle ?? result.externalDepthAttachmentHandle ?? null;
    // Opaque effects require a texture and may require surface MRT attachments.
    const opaqueLayerHasEffects = !!ctx.compositor?.layerHasEnabledEffect(PostEffectLayer.opaque);
    fg.state.useFinalFramebufferAsIntermediate =
      !!result.externalDepthAttachment &&
      result.externalDepthAttachment === ctx.finalFramebuffer?.getDepthAttachment() &&
      !opaqueLayerHasEffects;
  }
};

/** @internal */
const ShadowMaskModule: RenderModule<FrameGraphContext> = {
  type: 'ShadowMaskPass',
  writes: [FrameResources.ShadowMask],
  // shadowMapInfo is populated at execute time and cannot gate graph building.
  prepare: ({ ctx, options, renderQueue }) => ({
    enabled: options.shadowMask && renderQueue.shadowedLights.length > 0,
    requirements: {
      shadowMask:
        ctx.device.type !== 'webgl' &&
        ctx.camera.screenSpaceShadowMask &&
        renderQueue.shadowedLights.length > 0
    }
  }),
  setup(fg: FrameGraphContext) {
    // Four shadow lights share each RGBA8 layer in clustered-light order.
    const { graph, ctx, renderQueue, blackboard } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'ShadowMaskPass');
    const numShadowLights = renderQueue.shadowedLights.length;
    const numLayers = ShadowMaskRenderer.getLayerCount(numShadowLights);
    const maskPassResult = graph.addPass('ShadowMaskPass', (builder) => {
      // Capture the depth version declared at this pipeline position.
      const maskDepthHandle = blackboard.expect(FrameResources.LinearDepth);
      builder.read(maskDepthHandle);
      builder.read(depthPassResult.depthFramebufferHandle);
      // Per-layer framebuffers are temporary views of this graph texture.
      const maskHandle = builder.createTexture({
        format: 'rgba8unorm',
        label: 'shadowMask',
        arrayLayers: numLayers,
        allocationKey: 'ForwardPlus.ShadowMask'
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
      });
      return { maskHandle };
    });
    blackboard.set(FrameResources.ShadowMask, maskPassResult.maskHandle);
  }
};

/** @internal */
const TransmissionDepthForSSRModule: RenderModule<FrameGraphContext> = {
  type: 'TransmissionDepthForSSR',
  writes: [FrameResources.LinearDepth],
  prepare: ({ options }) => ({ enabled: options.needsTransmissionDepthForSSR }),
  setup(fg: FrameGraphContext) {
    const { graph, frame, blackboard } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'TransmissionDepthForSSR');
    const transmissionDepthResult = graph.addPass('TransmissionDepthForSSR', (builder) => {
      const currentDepth = blackboard.expect(FrameResources.LinearDepth);
      builder.read(currentDepth);
      builder.read(depthPassResult.depthFramebufferHandle);
      // Version the in-place depth mutation for downstream dependencies.
      const depthOut = builder.write(currentDepth);
      const done = builder.createToken('TransmissionDepthForSSRDone');
      builder.sideEffect();
      builder.setExecute((rgCtx) => {
        renderTransmissionDepthPass(frame, rgCtx);
      });
      return { done, depthOut };
    });
    fg.state.preLightTransmissionDepthToken = transmissionDepthResult.done;
    // Publish the post-transmission depth version.
    blackboard.set(FrameResources.LinearDepth, transmissionDepthResult.depthOut);
  }
};

/** @internal */
const HiZModule: RenderModule<FrameGraphContext> = {
  type: 'HiZ',
  writes: [FrameResources.HiZ],
  prepare: ({ options }) => ({ enabled: options.hiZ }),
  setup(fg: FrameGraphContext) {
    const { graph, ctx, frame, blackboard } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'HiZ');
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    //const hiZWidth = nextPowerOf2(ctx.renderWidth);
    //const hiZHeight = nextPowerOf2(ctx.renderHeight);
    let hiZHandle: RGHandle | undefined;
    graph.addPass('HiZ', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      hiZHandle = builder.createTexture({
        // Single-channel furthest-depth pyramid; the UE5-style tracer no
        // longer needs the closest depth. Under standard-Z r16f would not be
        // enough: far depth clusters near 1.0 where half floats only resolve
        // ~5e-4. Under reverse-Z far depth clusters near 0.0 where fp16
        // precision is relative, so the half-width pyramid halves the
        // bandwidth at no quality cost (matches UE's fp16 furthest HZB).
        format: REVERSE_Z ? 'r16f' : 'r32f',
        label: 'hiZ',
        sizeMode: 'backbuffer-relative',
        //width: hiZWidth,
        //height: hiZHeight,
        mipLevels: getFullMipLevelCount(ctx.renderWidth, ctx.renderHeight),
        allocationKey: 'ForwardPlus.HiZ'
      });
      const hiZFramebufferHandle = builder.createFramebuffer({
        label: 'HiZFramebuffer',
        colorAttachments: hiZHandle,
        depthAttachment: null
      });
      builder.setExecute((rgCtx) => {
        const passCtx = frame.ctx;
        // Resolve the declared handle, not mutable framebuffer state.
        const depthFb = rgCtx.getFramebuffer<FrameBuffer>(depthPassResult.depthFramebufferHandle);
        const depthTex = depthFb.getDepthAttachment() as Texture2D;
        if (!depthTex) {
          throw new Error('HiZ pass: depth prepass framebuffer has no depth attachment.');
        }
        const hiZTex = rgCtx.getTexture<Texture2D>(hiZHandle!);
        const HiZFrameBuffer = rgCtx.getFramebuffer<FrameBuffer>(hiZFramebufferHandle);
        buildHiZ(depthTex, HiZFrameBuffer);
        passCtx.HiZTexture = hiZTex;
      });
    });
    if (hiZHandle) {
      blackboard.set(FrameResources.HiZ, hiZHandle);
    }
  }
};

/** @internal */
const SSSProfileModule: RenderModule<FrameGraphContext> = {
  type: 'SSSProfile',
  prepare: ({ options }) => ({ enabled: options.sss }),
  setup(fg: FrameGraphContext) {
    const { graph, ctx, frame, blackboard } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'SSSProfile');
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    const shadowMaskHandle = blackboard.get(FrameResources.ShadowMask);
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    const sssProfileResult = graph.addPass('SSSProfile', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      if (shadowMaskHandle) {
        builder.read(shadowMaskHandle);
      }
      const profileHandle = builder.createTexture({
        format: 'rgba16f',
        label: 'sssProfile',
        allocationKey: 'ForwardPlus.SSSProfile'
      });
      const paramHandle = builder.createTexture({
        format: 'rgba8unorm',
        label: 'sssParam',
        allocationKey: 'ForwardPlus.SSSParam'
      });
      const colorAttachments = [ctx.colorFormat!, profileHandle, paramHandle];
      const framebufferHandle = builder.createFramebuffer({
        label: 'SSSProfileFramebuffer',
        width: ctx.renderWidth,
        height: ctx.renderHeight,
        colorAttachments,
        depthAttachment: renderDepthAttachment,
        ignoreDepthStencil: false
      });

      builder.setExecute((rgCtx) => {
        ctx.shadowMaskTexture = shadowMaskHandle ? rgCtx.getTexture<Texture2DArray>(shadowMaskHandle) : null;
        renderForwardSSSProfile(
          frame,
          rgCtx.getFramebuffer<FrameBuffer>(framebufferHandle),
          rgCtx.getTexture<Texture2D>(profileHandle),
          rgCtx.getTexture<Texture2D>(paramHandle),
          null
        );
      });

      return {
        profileHandle,
        paramHandle,
        framebufferHandle
      };
    });
    blackboard.set(FrameResources.SSSProfile, sssProfileResult.profileHandle);
    blackboard.set(FrameResources.SSSParam, sssProfileResult.paramHandle);
  }
};

/** @internal */
const SceneColorGrabModule: RenderModule<FrameGraphContext> = {
  type: 'SceneColorGrab',
  prepare: ({ options }) => ({ enabled: options.needSceneColor }),
  setup(fg: FrameGraphContext) {
    // Refraction samples this non-transmission scene copy.
    const { graph, ctx, frame, blackboard, options } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'SceneColorGrab');
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    const shadowMaskHandle = blackboard.get(FrameResources.ShadowMask);
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    const grabResult = graph.addPass('SceneColorGrab', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (preLightTransmissionDepthToken) {
        builder.read(preLightTransmissionDepthToken);
      }
      if (shadowMaskHandle) {
        builder.read(shadowMaskHandle);
      }
      const copyHandle = builder.createTexture({
        format: ctx.colorFormat!,
        label: 'sceneColorCopy',
        allocationKey: 'ForwardPlus.SceneColorCopy'
      });
      // Isolate depth when SSR inserts transmission depth before LightPass.
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
        ctx.shadowMaskTexture = shadowMaskHandle ? rgCtx.getTexture<Texture2DArray>(shadowMaskHandle) : null;
        renderSceneColorGrab(frame, rgCtx, copyHandle, copyFramebufferHandle);
      });
      return { copyHandle, copyFramebufferHandle };
    });
    blackboard.set(FrameResources.SceneColorCopy, grabResult.copyHandle);
  }
};

/** @internal */
const LightPassModule: RenderModule<FrameGraphContext> = {
  type: 'LightPass',
  writes: [
    FrameResources.SceneColor,
    FrameResources.SceneRoughness,
    FrameResources.SceneNormal,
    FrameResources.SSSDiffuse,
    FrameResources.SSSTransmission,
    FrameResources.SkinSSS
  ],
  prepare: () => ({ enabled: true }),
  setup(fg: FrameGraphContext) {
    const { graph, ctx, frame, blackboard, options, backbuffer } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'LightPass');
    const shadowMaskHandle = blackboard.get(FrameResources.ShadowMask);
    const preLightTransmissionDepthToken = fg.state.preLightTransmissionDepthToken;
    const hiZHandle = blackboard.get(FrameResources.HiZ);
    const sssProfileHandle = blackboard.get(FrameResources.SSSProfile);
    const sssParamHandle = blackboard.get(FrameResources.SSSParam);
    const sceneColorCopyHandle = blackboard.get(FrameResources.SceneColorCopy);
    const useFinalFramebufferAsIntermediate = fg.state.useFinalFramebufferAsIntermediate;
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    const historyManager = fg.history;

    // Keep SSR history scoped while the light pass executes.
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
    if (historyManager && options.ssgi) {
      const ssgiHistorySize = { width: ctx.renderWidth, height: ctx.renderHeight };
      const irradianceHistoryHandle = historyManager.importPreviousIfCompatible(
        graph,
        RGHistoryResources.SSGI_IRRADIANCE,
        {
          format: 'rgba16f',
          sizeMode: 'absolute',
          width: ctx.renderWidth,
          height: ctx.renderHeight
        },
        ssgiHistorySize
      );
      const surfaceHistoryHandle = historyManager.importPreviousIfCompatible(
        graph,
        RGHistoryResources.SSGI_SURFACE,
        {
          format: 'rgba16f',
          sizeMode: 'absolute',
          width: ctx.renderWidth,
          height: ctx.renderHeight
        },
        ssgiHistorySize
      );
      if (irradianceHistoryHandle && surfaceHistoryHandle) {
        lightHistoryReadBindings.push(
          { name: RGHistoryResources.SSGI_IRRADIANCE, handle: irradianceHistoryHandle },
          { name: RGHistoryResources.SSGI_SURFACE, handle: surfaceHistoryHandle }
        );
      }
    }

    const opaquePassResult = graph.addPass('LightPass', (builder) => {
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

      // Direct rendering writes the backbuffer; otherwise create a texture.
      const sceneColorHandle = useFinalFramebufferAsIntermediate
        ? builder.write(backbuffer)
        : builder.createTexture({
            format: ctx.colorFormat!,
            label: 'sceneColor',
            allocationKey: 'ForwardPlus.SceneColor'
          });

      if (sceneColorCopyHandle) {
        builder.read(sceneColorCopyHandle);
      }
      if (sssProfileHandle) {
        builder.read(sssProfileHandle);
      }
      if (sssParamHandle) {
        builder.read(sssParamHandle);
      }
      const surfaceAttachmentCount = Number(options.sceneRoughness) + Number(options.sceneNormal);
      // Surface MRT products are exposed through blackboard handles.
      const sceneRoughnessHandle = options.sceneRoughness
        ? builder.createTexture({
            format: getSurfaceTextureFormat(ctx),
            label: 'sceneRoughness',
            allocationKey: 'ForwardPlus.SceneRoughness'
          })
        : undefined;
      const sceneNormalHandle = options.sceneNormal
        ? builder.createTexture({
            format: getSurfaceTextureFormat(ctx),
            label: 'sceneNormal',
            allocationKey: 'ForwardPlus.SceneNormal'
          })
        : undefined;
      const writeSSSDiffuse = options.sss && shouldStoreSSSDiffuse(ctx);
      let writeSSSTransmission = options.sss && shouldStoreSSSTransmission(ctx);
      if (
        writeSSSDiffuse &&
        writeSSSTransmission &&
        surfaceAttachmentCount > 0 &&
        getSSSLightingTextureFormat(ctx, 2, surfaceAttachmentCount) !== ctx.colorFormat
      ) {
        writeSSSTransmission = false;
      }
      const writeSkinSSS = options.skinSSS;
      const sssLightingAttachmentCount =
        (writeSSSDiffuse ? 1 : 0) + (writeSSSTransmission ? 1 : 0) + (writeSkinSSS ? 1 : 0);
      const sssLightingFormat = getSSSLightingTextureFormat(
        ctx,
        sssLightingAttachmentCount,
        surfaceAttachmentCount
      );
      const sssDiffuseHandle = writeSSSDiffuse
        ? builder.createTexture({
            format: sssLightingFormat,
            label: 'sssDiffuse',
            allocationKey: 'ForwardPlus.SSSDiffuse'
          })
        : undefined;
      const sssTransmissionHandle = writeSSSTransmission
        ? builder.createTexture({
            format: sssLightingFormat,
            label: 'sssTransmission',
            allocationKey: 'ForwardPlus.SSSTransmission'
          })
        : undefined;
      const skinSSSHandle = writeSkinSSS
        ? builder.createTexture({
            format: sssLightingFormat,
            label: 'skinSSS',
            allocationKey: 'ForwardPlus.SkinSSS'
          })
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
        // Legacy effects still read resolved MRT textures from DrawContext.
        ctx.shadowMaskTexture = shadowMaskHandle ? rgCtx.getTexture<Texture2DArray>(shadowMaskHandle) : null;
        ctx.HiZTexture = hiZHandle ? rgCtx.getTexture<Texture2D>(hiZHandle) : null;
        ctx.SceneRoughnessTexture = sceneRoughnessHandle
          ? rgCtx.getTexture<Texture2D>(sceneRoughnessHandle)
          : null;
        ctx.SceneNormalTexture = sceneNormalHandle ? rgCtx.getTexture<Texture2D>(sceneNormalHandle) : null;
        ctx.SSSProfileTexture = sssProfileHandle ? rgCtx.getTexture<Texture2D>(sssProfileHandle) : null;
        ctx.SSSParamTexture = sssParamHandle ? rgCtx.getTexture<Texture2D>(sssParamHandle) : null;
        ctx.SSSDiffuseTexture = sssDiffuseHandle ? rgCtx.getTexture<Texture2D>(sssDiffuseHandle) : null;
        ctx.SSSTransmissionTexture = sssTransmissionHandle
          ? rgCtx.getTexture<Texture2D>(sssTransmissionHandle)
          : null;
        ctx.SkinSSSTexture = skinSSSHandle ? rgCtx.getTexture<Texture2D>(skinSSSHandle) : null;
        const renderLightPass = () =>
          renderOpaqueScenePass(frame, sceneColorTex, sceneColorCopyTex, rgCtx, sceneColorFramebufferHandle);
        if (historyManager && lightHistoryReadBindings.length > 0) {
          const ssgiIrradianceBinding = lightHistoryReadBindings.find(
            (binding) => binding.name === RGHistoryResources.SSGI_IRRADIANCE
          );
          const ssgiSurfaceBinding = lightHistoryReadBindings.find(
            (binding) => binding.name === RGHistoryResources.SSGI_SURFACE
          );
          ctx.SSGIIrradianceHistoryTexture = ssgiIrradianceBinding
            ? rgCtx.getTexture<Texture2D>(ssgiIrradianceBinding.handle)
            : null;
          ctx.SSGISurfaceHistoryTexture = ssgiSurfaceBinding
            ? rgCtx.getTexture<Texture2D>(ssgiSurfaceBinding.handle)
            : null;
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
            ctx.SSGIIrradianceHistoryTexture = null;
            ctx.SSGISurfaceHistoryTexture = null;
          }
        } else {
          renderLightPass();
        }
      });

      return {
        sceneColorHandle,
        sceneColorFramebufferHandle,
        sceneRoughnessHandle,
        sceneNormalHandle,
        sssDiffuseHandle,
        sssTransmissionHandle,
        skinSSSHandle
      };
    });
    const lightPassResult: LightPassResult = opaquePassResult;
    fg.state.lightPass = lightPassResult;
    blackboard.set(FrameResources.SceneColor, lightPassResult.sceneColorHandle);
    if (lightPassResult.sceneRoughnessHandle) {
      blackboard.set(FrameResources.SceneRoughness, lightPassResult.sceneRoughnessHandle);
    }
    if (lightPassResult.sceneNormalHandle) {
      blackboard.set(FrameResources.SceneNormal, lightPassResult.sceneNormalHandle);
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

/** @internal */
const SkyPassModule: RenderModule<FrameGraphContext> = {
  type: 'SkyPass',
  reads: [{ resource: FrameResources.SceneColor, version: 'current' }],
  writes: [FrameResources.SceneColor, FrameResources.SceneColorNoFog],
  prepare: () => ({ enabled: true }),
  setup(fg: FrameGraphContext) {
    const { graph, ctx, frame, blackboard, options } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'SkyPass');
    const lightPassResult = requireBuildState(fg, 'lightPass', 'LightPass', 'SkyPass');
    const sceneColorCopyHandle = blackboard.get(FrameResources.SceneColorCopy);
    const sceneColorHandle = blackboard.expect(FrameResources.SceneColor);
    // Screen-space passes must not read fog as surface radiance. Snapshot the lit
    // scene with sky but before fog, and only when fog is actually present and a
    // consumer exists, so fog-free scenes allocate nothing extra. The refraction
    // background path already baked sky and fog into the copy, so no fog-free
    // version can be recovered there and consumers keep their existing input.
    const captureNoFog = !sceneColorCopyHandle && (options.ssgi || options.ssr) && options.fogPresents;

    const skyPassResult = graph.addPass('SkyPass', (builder) => {
      builder.read(sceneColorHandle);
      builder.read(depthPassResult.depthFramebufferHandle);
      if (lightPassResult.sceneColorFramebufferHandle) {
        builder.read(lightPassResult.sceneColorFramebufferHandle);
      }
      const noFog = captureNoFog
        ? builder.createTexture({
            format: ctx.colorFormat!,
            label: 'sceneColorNoFog',
            allocationKey: 'ForwardPlus.SceneColorNoFog'
          })
        : null;
      const out = builder.write(sceneColorHandle);
      builder.setExecute((rgCtx) => {
        // The refraction background already contains sky and fog.
        if (!sceneColorCopyHandle) {
          renderSkyScenePass(
            frame,
            rgCtx,
            lightPassResult.sceneColorFramebufferHandle,
            noFog ? rgCtx.getTexture<Texture2D>(noFog) : null
          );
        }
      });
      return { color: out, noFog };
    });

    lightPassResult.sceneColorHandle = skyPassResult.color;
    blackboard.set(FrameResources.SceneColor, skyPassResult.color);
    if (skyPassResult.noFog) {
      blackboard.set(FrameResources.SceneColorNoFog, skyPassResult.noFog);
    }
  }
};

/** @internal */
const CompositeTailModule: RenderModule<FrameGraphContext> = {
  type: 'CompositeTail',
  writes: [FrameResources.SceneColor, FrameResources.LinearDepth, FrameResources.PresentedColor],
  prepare: () => ({ enabled: true }),
  setup(fg: FrameGraphContext) {
    const { graph, ctx, frame, blackboard, options, backbuffer } = fg;
    const depthPassResult = requireBuildState(fg, 'depth', 'DepthPrepass', 'CompositeTail');
    const hiZHandle = blackboard.get(FrameResources.HiZ);
    const sceneColorCopyHandle = blackboard.get(FrameResources.SceneColorCopy);
    const lightPassResult = requireBuildState(fg, 'lightPass', 'LightPass', 'CompositeTail');
    const renderDepthAttachment = fg.state.renderDepthAttachment;
    const useFinalFramebufferAsIntermediate = fg.state.useFinalFramebufferAsIntermediate;
    const lightHistoryReadBindings = fg.state.lightHistoryReadBindings;
    const historyManager = fg.history;

    // Opaque effects finish before transparent geometry uses their output.
    const opaqueChainInput = blackboard.expect(FrameResources.SceneColor);
    // Include textures sampled indirectly through DrawContext.
    const opaqueChainDeps: RGHandle[] = [blackboard.expect(FrameResources.LinearDepth)];
    if (hiZHandle) {
      opaqueChainDeps.push(hiZHandle);
    }
    if (lightPassResult.sceneColorFramebufferHandle) {
      opaqueChainDeps.push(lightPassResult.sceneColorFramebufferHandle);
    }
    if (sceneColorCopyHandle) {
      opaqueChainDeps.push(sceneColorCopyHandle);
    }
    for (const handle of [
      blackboard.get(FrameResources.SSSProfile),
      blackboard.get(FrameResources.SSSParam),
      blackboard.get(FrameResources.SceneRoughness),
      blackboard.get(FrameResources.SceneNormal),
      blackboard.get(FrameResources.SSSDiffuse),
      blackboard.get(FrameResources.SSSTransmission),
      blackboard.get(FrameResources.SkinSSS)
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

    // Transparent geometry writes a new version of the opaque-chain output.
    const sceneColorHandle = graph.addPass('TransparentPass', (builder) => {
      builder.read(blackboard.expect(FrameResources.LinearDepth));
      builder.read(depthPassResult.depthFramebufferHandle);
      if (hiZHandle) {
        // Transparent materials may ray-march HiZ.
        builder.read(hiZHandle);
      }
      if (lightPassResult.sceneColorFramebufferHandle) {
        builder.read(lightPassResult.sceneColorFramebufferHandle);
      }
      if (sceneColorCopyHandle) {
        builder.read(sceneColorCopyHandle);
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

    const chainInput = sceneColorHandle;
    // Track whether the chain input still resides in the final target.
    const backbufferResidentHandle = useFinalFramebufferAsIntermediate ? sceneColorHandle : null;
    const chainDependencies: RGHandle[] = [];
    const finalOutput = { handle: backbuffer, isScreen: !ctx.finalFramebuffer };
    const endLayerHasEffects = !!ctx.compositor?.layerHasEnabledEffect(PostEffectLayer.end);

    // Transparent-layer effects read depth before its transmission mutation.
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

    // WAR orders this depth mutation after pre-transmission readers.
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
      blackboard.set(FrameResources.LinearDepth, transmissionDepthResult.depthOut);
    }

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
          inputResidesInFinalTarget:
            !!backbufferResidentHandle && transparentChainResult.color === chainInput,
          sceneDepthAttachment: renderDepthAttachment,
          dependencies: endChainDependencies,
          history: historyManager
        })
      : { color: transparentChainResult.color, wroteFinal: false };
    const finalWroteFinal = chainResult.wroteFinal || transparentChainResult.wroteFinal;

    let presentedBackbuffer: RGHandle;
    if (finalWroteFinal) {
      presentedBackbuffer = chainResult.color;
    } else {
      presentedBackbuffer = graph.addPass('Blit', (builder) => {
        builder.read(chainResult.color);
        for (const dep of endChainDependencies) {
          builder.read(dep);
        }
        const outputBackbuffer = builder.write(backbuffer);
        // Skip copies when the output already resides in the final target.
        const needsBlit = chainResult.color !== backbufferResidentHandle;
        builder.setExecute((rgCtx) => {
          const sourceTex = needsBlit ? rgCtx.getTexture<Texture2D>(chainResult.color) : null;
          if (sourceTex) {
            const blitter = new CopyBlitter();
            blitter.srgbOut = !ctx.finalFramebuffer;
            blitter.blit(sourceTex, ctx.finalFramebuffer ?? null, fetchSampler('clamp_nearest_nomip'));
          }
        });
        return outputBackbuffer;
      });
    }
    fg.state.presentedBackbuffer = presentedBackbuffer;
    // Downstream modules may replace this sink registration.
    blackboard.set(FrameResources.PresentedColor, presentedBackbuffer);
  }
};

/** Built-in Forward+ modules addressable by pipeline anchors. @public */
export const ForwardPlusModules = {
  SkyUpdate: SkyUpdateModule,
  ClusterLights: ClusterLightsModule,
  GPUPicking: GPUPickingModule,
  ShadowMaps: ShadowMapsModule,
  DepthPrepass: DepthPrepassModule,
  ShadowMask: ShadowMaskModule,
  TransmissionDepthForSSR: TransmissionDepthForSSRModule,
  HiZ: HiZModule,
  SSSProfile: SSSProfileModule,
  SceneColorGrab: SceneColorGrabModule,
  LightPass: LightPassModule,
  SkyPass: SkyPassModule,
  CompositeTail: CompositeTailModule
} as const;

/** The default module order assembled by {@link createForwardPlusPipeline}. */
const DEFAULT_FORWARD_PLUS_MODULES: readonly RenderModule<FrameGraphContext>[] = [
  SkyUpdateModule,
  ClusterLightsModule,
  GPUPickingModule,
  ShadowMapsModule,
  DepthPrepassModule,
  ShadowMaskModule,
  TransmissionDepthForSSRModule,
  HiZModule,
  SSSProfileModule,
  SceneColorGrabModule,
  LightPassModule,
  SkyPassModule,
  CompositeTailModule
];

/** @internal */
let _defaultForwardPlusPipeline: RenderPipeline<FrameGraphContext> | null = null;

/** Create an independent pipeline with the built-in Forward+ modules. @public */
export function createForwardPlusPipeline(): RenderPipeline<FrameGraphContext> {
  return new RenderPipeline<FrameGraphContext>(DEFAULT_FORWARD_PLUS_MODULES);
}

/** Return the shared default pipeline. Mutations affect cameras using it. @public */
export function getDefaultForwardPlusPipeline(): RenderPipeline<FrameGraphContext> {
  if (!_defaultForwardPlusPipeline) {
    _defaultForwardPlusPipeline = createForwardPlusPipeline();
  }
  return _defaultForwardPlusPipeline;
}

/** Build the Forward+ render graph and return its backbuffer output. @public */
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
  // Irradiance, moments and surface history require renderable half-float
  // targets. Keep ordinary IBL active on devices that cannot provide them.
  options.ssgi &&= supportsSSGIRenderTargets(ctx);
  ctx.SSS = !!options.sss;
  ctx.SSGI = !!options.ssgi;
  ctx.SSGIIrradianceHistoryTexture = null;
  ctx.SSGISurfaceHistoryTexture = null;
  ctx.SkinSSSTexture = null;
  // ShadowMask sets this only when it produces a texture.
  ctx.shadowMaskTexture = null;

  const blackboard = new RGBlackboard();

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

  const ordering = new OrderingScope();
  const fg: FrameGraphContext = {
    graph,
    ctx,
    finalFramebuffer: ctx.finalFramebuffer,
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
      lightHistoryReadBindings: []
    }
  };

  const pipeline = ctx.camera?.renderPipeline ?? getDefaultForwardPlusPipeline();
  const requirements = ctx.compositor?.collectRequirements(ctx) ?? {};
  mergeFrameResourceRequirements(requirements, pipeline.collectRequirements(fg));
  resolveFrameResourceRequirements(ctx, options, requirements);

  pipeline.build(fg);
  validateProducedFrameResources(blackboard, options, renderQueue);

  const presented = blackboard.get(FrameResources.PresentedColor) ?? fg.state.presentedBackbuffer!;
  const depth = fg.state.depth;
  const externalDepthImport =
    depth?.externalDepthAttachmentHandle && depth.externalDepthAttachment
      ? { handle: depth.externalDepthAttachmentHandle, texture: depth.externalDepthAttachment }
      : undefined;
  return { backbuffer: presented, frame, externalDepthImport };
}

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
  const savedNormalTexture = ctx.SceneNormalTexture;

  let profileFlags = MaterialVaryingFlags.SSS_STORE_PROFILE;
  if (normalTexture) {
    profileFlags |= MaterialVaryingFlags.SCENE_STORE_NORMAL;
  }

  device.pushDeviceStates();
  try {
    device.setFramebuffer(profileFramebuffer);
    ctx.SSSProfileTexture = profileTexture;
    ctx.SSSParamTexture = paramTexture;
    ctx.SceneNormalTexture = normalTexture;
    ctx.compositor = null;
    ctx.camera.commandBufferReuse = false;
    ctx.materialFlags =
      (ctx.materialFlags &
        ~(
          MaterialVaryingFlags.SCENE_STORE_ROUGHNESS |
          MaterialVaryingFlags.SSS_STORE_PROFILE |
          MaterialVaryingFlags.SCENE_STORE_NORMAL |
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
    ctx.SceneNormalTexture = savedNormalTexture;
    device.popDeviceStates();
    sssRenderQueue.dispose();
  }
}

function releaseIntermediateFramebuffer(frame: FrameState): void {
  // Each pass owns device state; only clear the shared context field.
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
  const { ctx } = frame;
  ctx.materialFlags &= ~MaterialVaryingFlags.SCENE_STORE_ROUGHNESS;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_PROFILE;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_DIFFUSE;
  ctx.materialFlags &= ~MaterialVaryingFlags.SCENE_STORE_NORMAL;
  ctx.materialFlags &= ~MaterialVaryingFlags.SSS_STORE_TRANSMISSION;
  ctx.materialFlags &= ~MaterialVaryingFlags.SKIN_SSS_STORE;
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

  // Current callers must provide the graph-managed prepass framebuffer.
  console.assert(
    !!existingDepthFb,
    'renderSceneDepth: called without an existing depth framebuffer; the ' +
      'self-allocating fallback path is untested in the forward+ pipeline.'
  );

  if (!depthFramebuffer) {
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
    _depthPass.clearDepth = transmission ? null : DEPTH_CLEAR_VALUE;
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
  }
  return depthFramebuffer!;
}

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
          this.clipPos.z = ShaderHelper.farthestClipZ(this, this.clipPos.w);
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
  device.setRenderStates(AbstractPostEffect.getDefaultRenderState(ctx, DEPTH_COMPARE_DEFAULT));
  device.setFramebuffer(fb);
  _skyMVBox.draw();
  device.popDeviceStates();
}

function blitToCurrentColorAttachment(ctx: DrawContext, source: Texture2D): void {
  const framebuffer = ctx.device.getFramebuffer();
  const destination = framebuffer?.getColorAttachment<Texture2D>(0) ?? null;
  new CopyBlitter().blit(source, destination, fetchSampler('clamp_nearest_nomip'));
}

/** Render the refraction background before LightPass. @internal */
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

  // The background copy has no surface MRT attachments.
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
      _scenePass.clearDepth = DEPTH_CLEAR_VALUE;
      _scenePass.clearStencil = 0;
    } else {
      _scenePass.clearDepth = depthTex ? null : DEPTH_CLEAR_VALUE;
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
export function renderOpaqueScenePass(
  frame: FrameState,
  sceneColorTex: Texture2D,
  sceneColorCopyTex: Nullable<Texture2D>,
  rgCtx: RGExecuteContext,
  sceneColorFramebufferHandle?: RGHandle
): void {
  const { ctx, renderQueue } = frame;

  const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;

  ctx.materialFlags &= ~(
    MaterialVaryingFlags.SCENE_STORE_ROUGHNESS |
    MaterialVaryingFlags.SSS_STORE_PROFILE |
    MaterialVaryingFlags.SSS_STORE_DIFFUSE |
    MaterialVaryingFlags.SCENE_STORE_NORMAL |
    MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
    MaterialVaryingFlags.SKIN_SSS_STORE
  );

  if (ctx.SceneRoughnessTexture) {
    ctx.materialFlags |= MaterialVaryingFlags.SCENE_STORE_ROUGHNESS;
  }
  if (ctx.SceneNormalTexture) {
    ctx.materialFlags |= MaterialVaryingFlags.SCENE_STORE_NORMAL;
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

  // Prefer the graph framebuffer; final-target mode has no graph framebuffer.
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

  // Graph passes do not communicate through leftover device state.
  ctx.device.pushDeviceStates();
  try {
    // setFramebuffer may no-op, so reset viewport and scissor explicitly.
    ctx.device.setFramebuffer(ctx.intermediateFramebuffer);
    ctx.device.setViewport(null);
    ctx.device.setScissor(null);

    _scenePass.transmission = false;
    _scenePass.renderSky = false;
    _scenePass.clearDepth = depthTex ? null : DEPTH_CLEAR_VALUE;
    _scenePass.clearStencil = depthTex ? null : 0;

    if (renderQueue.needSceneColor() && sceneColorCopyTex) {
      // Seed the main target with the refraction background.
      ctx.sceneColorTexture = sceneColorCopyTex;
      blitToCurrentColorAttachment(ctx, ctx.sceneColorTexture);
      if (hasSurfaceMRT(ctx)) {
        // Re-render opaque lists to populate MRT data missing from the copy.
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
    // Restore shared pass flags before the next graph pass.
    _scenePass.renderTransparent = true;
    _scenePass.renderSky = true;
    _scenePass.transmission = false;
    ctx.device.popDeviceStates();
  }
}

/** Render sky and fog after opaque geometry. @internal */
export function renderSkyScenePass(
  frame: FrameState,
  rgCtx: RGExecuteContext,
  sceneColorFramebufferHandle?: RGHandle,
  sceneColorNoFog?: Nullable<Texture2D>
): void {
  const { ctx } = frame;
  const framebuffer = sceneColorFramebufferHandle
    ? rgCtx.getFramebuffer<FrameBuffer>(sceneColorFramebufferHandle)
    : ctx.finalFramebuffer;
  const device = ctx.device;
  device.pushDeviceStates();
  try {
    device.setFramebuffer(framebuffer);
    device.setViewport(null);
    device.setScissor(null);
    ctx.scene.env.sky.renderSky(ctx);
    if (ctx.scene.env.sky.fogPresents) {
      // Snapshot between sky and fog. Sky belongs in the copy - a ray that hits
      // the sky should read the sky - while fog does not, because the fog a
      // screen-space pass would sample lies along the camera ray rather than the
      // path it integrates.
      if (sceneColorNoFog) {
        const source = framebuffer?.getColorAttachment<Texture2D>(0) ?? null;
        if (source) {
          new CopyBlitter().blit(source, sceneColorNoFog, fetchSampler('clamp_nearest_nomip'));
          device.setFramebuffer(framebuffer);
          device.setViewport(null);
          device.setScissor(null);
        }
      }
      ctx.scene.env.sky.renderFog(ctx.camera);
    }
  } finally {
    device.popDeviceStates();
  }
}

/** Render transmission, transparency, and OIT over the opaque result. @internal */
export function renderTransparentScenePass(
  frame: FrameState,
  rgCtx: RGExecuteContext,
  opaqueChainOutput: Nullable<RGHandle>,
  sceneColorFramebufferHandle?: RGHandle
): void {
  const { ctx, renderQueue } = frame;
  const device = ctx.device;
  let framebuffer: Nullable<FrameBuffer>;
  if (opaqueChainOutput) {
    // Opaque effects redirect transparent rendering to their chain output.
    const chainTex = rgCtx.getTexture<Texture2D>(opaqueChainOutput);
    const depthTex = frame.depthFramebuffer?.getDepthAttachment() as Texture2D;
    framebuffer = rgCtx.createFramebuffer<FrameBuffer>({
      width: chainTex.width,
      height: chainTex.height,
      colorAttachments: chainTex,
      depthAttachment: depthTex
    });
    // The chain output has no surface MRT attachments.
    ctx.materialFlags &= ~SURFACE_MRT_FLAGS;
  } else if (sceneColorFramebufferHandle) {
    // Continue in the light pass target when no opaque effect ran.
    framebuffer = rgCtx.getFramebuffer<FrameBuffer>(sceneColorFramebufferHandle);
  } else {
    // Scene color already resides in the final framebuffer.
    framebuffer = ctx.finalFramebuffer;
  }
  device.pushDeviceStates();
  try {
    // setFramebuffer may no-op, so reset viewport and scissor explicitly.
    device.setFramebuffer(framebuffer);
    device.setViewport(null);
    device.setScissor(null);
    // Derive transmission mode instead of inheriting shared pass state.
    _scenePass.transmission = renderQueue.needSceneColor();
    _scenePass.clearColor = null;
    _scenePass.clearDepth = null;
    _scenePass.clearStencil = null;
    _scenePass.renderOpaque = false;
    _scenePass.renderTransparent = true;
    _scenePass.renderSky = false;
    try {
      _scenePass.render(ctx, null, null, renderQueue);
    } finally {
      _scenePass.renderOpaque = true;
      _scenePass.renderSky = true;
    }
  } finally {
    device.popDeviceStates();
  }
}

/** @internal */
function renderTransmissionDepthPass(frame: FrameState, rgCtx: RGExecuteContext): void {
  renderSceneDepth(frame, frame.depthFramebuffer, rgCtx);
}

/** Build and execute the Forward+ graph for one frame. @public */
export function executeForwardPlusGraph(ctx: DrawContext): void {
  const device = ctx.device;
  const graph = new RenderGraph();
  let renderQueue: RenderQueue | null = null;
  let frame: FrameState | null = null;
  let executor: RenderGraphExecutor<Texture2D, FrameBuffer> | null = null;
  let historyManager: HistoryResourceManager<Texture2D> | null = null;
  let historyFrameStarted = false;
  let motionVectorFramePrepared = false;
  let motionVectorFrameCommitted = false;

  try {
    renderQueue = _scenePass.cullScene(ctx, ctx.camera);

    const options = deriveForwardPlusOptions(ctx.scene, ctx.camera, device.type, renderQueue);
    options.ssgi &&= supportsSSGIRenderTargets(ctx);
    ctx.SSS = options.sss;

    historyManager = ctx.camera.getHistoryResourceManager();
    if (!historyManager) {
      historyManager = new HistoryResourceManager<Texture2D>(_devicePoolAllocator);
      ctx.camera.setHistoryResourceManager(historyManager);
    }
    if (!options.ssgi) {
      historyManager.invalidate(RGHistoryResources.SSGI_SCENE_COLOR);
      historyManager.invalidate(RGHistoryResources.SSGI_IRRADIANCE);
      historyManager.invalidate(RGHistoryResources.SSGI_SURFACE);
      historyManager.invalidate(RGHistoryResources.SSGI_MOMENTS);
    }
    historyManager.beginFrame();
    historyFrameStarted = true;

    const buildResult = buildForwardPlusGraphInternal(graph, ctx, renderQueue, options);
    frame = buildResult.frame;

    if (options.motionVectors) {
      ctx.camera.prepareMotionVectorFrame(ctx.camera.TAA, ctx.renderWidth, ctx.renderHeight);
      motionVectorFramePrepared = true;
    } else {
      ctx.camera.clearMotionVectorFrame();
    }

    const compiled = graph.compile([buildResult.backbuffer]);

    executor = new RenderGraphExecutor(_devicePoolAllocator, ctx.renderWidth, ctx.renderHeight, {
      textureAffinityCache: getTextureAffinityCache(ctx.camera, device)
    });

    if (ctx.finalFramebuffer) {
      const backbufferTex = ctx.finalFramebuffer.getColorAttachments()[0] as Texture2D;
      executor.setImportedTexture(buildResult.backbuffer, backbufferTex);
    }
    if (buildResult.externalDepthImport) {
      executor.setImportedTexture(
        buildResult.externalDepthImport.handle,
        buildResult.externalDepthImport.texture
      );
    }
    historyManager.bindImportedTextures(executor);

    executor.execute(compiled);
    historyManager.commitFrame();
    historyFrameStarted = false;
    if (motionVectorFramePrepared) {
      ctx.camera.commitMotionVectorFrame();
      motionVectorFrameCommitted = true;
    }
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
    if (motionVectorFramePrepared && !motionVectorFrameCommitted) {
      ctx.camera.clearMotionVectorFrame();
    }
  }
}
