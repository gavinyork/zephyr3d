import type { DRef, TypedArray, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  ColorState,
  FaceMode,
  FrameBuffer,
  GPUDataBuffer,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import type { Camera } from '../camera/camera';
import type { Primitive, RenderPass } from '.';
import type { DrawableInstanceInfo, InstanceData, RenderQueue, RenderQueueRef } from './render_queue';
import type { ShadowMapParams } from '../shadow';
import type { Environment } from '../scene/environment';
import type { DirectionalLight, PunctualLight, Scene, SceneNode } from '../scene';
import type { Compositor } from '../posteffect';
import type { ClusteredLight } from './cluster_light';
import type { MeshMaterial } from '../material';
import type { GlobalBindGroupAllocator } from './globalbindgroup_allocator';
import type { OIT } from './oit';

/**
 * Picking result target container.
 *
 * Use to override/annotate which scene node (and optional label) a drawable should report
 * when GPU picking or raycast returns a hit.
 *
 * @public
 */
export type PickTarget = { node: SceneNode; label?: string };

/**
 * Context object passed to draw calls and render helpers.
 *
 * It aggregates all per-frame, per-pass, and per-draw state derived from the engine and renderer,
 * including device handles, textures, passes, flags, and post-processing links.
 *
 * Notes:
 * - Not all textures/fields are present for every pass; check for undefined when optional.
 * - Values like `HiZ`, `TAA`, `SSR` signal features the renderer has activated for the current pass.
 *
 * @public
 */
export interface DrawContext {
  /** Render device used for issuing GPU commands. */
  device: AbstractDevice;
  /** Framebuffer width for rendering (in pixels). */
  renderWidth: number;
  /** Framebuffer height for rendering (in pixels). */
  renderHeight: number;
  /** The camera position/view used by the primary render pass of this frame. */
  primaryCamera: Camera;
  /** The render queue which is currently being rendered (if applicable). */
  renderQueue?: RenderQueue;
  /** Allocator for global (frame/pass) bind groups and descriptor resources. */
  globalBindGroupAllocator: GlobalBindGroupAllocator;
  /** The camera associated with the current drawing task (may differ from primaryCamera). */
  camera: Camera;
  /** Order-Independent Transparency interface for transparent passes. */
  oit: OIT;
  /** Whether motion vectors are being written this pass (used by TAA/MotionBlur). */
  motionVectors: boolean;
  /** Motion vector texture target when motion vectors are active. */
  motionVectorTexture?: Texture2D;
  /** Whether hierarchical depth (Hi-Z) is enabled for the current pass. */
  HiZ: boolean;
  /** Hi-Z (hierarchical Z) depth texture, when generated. */
  HiZTexture: Texture2D;
  /** The scene currently being drawn. */
  scene: Scene;
  /** The render pass to which this drawing task belongs. */
  renderPass: RenderPass;
  /** Stable hash for the current pass/draw state, for render bundle or pipeline cache. */
  renderPassHash: string;
  /** Fog application flags for transparent objects (bitmask). */
  fogFlags: number;
  /** Whether the output orientation is flipped vertically (e.g., due to framebuffer conventions). */
  flip: boolean;
  /** Whether this is the base lighting pass that draws environment lighting. */
  drawEnvLight: boolean;
  /** Scene environment (sky, IBL, exposure, etc.) used for shading. */
  env: Environment;
  /** Timestamp for the current draw (engine-defined time units). */
  timestamp: number;
  /** Current sub-queue index within the render queue (e.g., opaque, transparent). */
  queue: number;
  /** Whether GPU-based picking is currently enabled. */
  picking: boolean;
  /** Whether the current lighting pass is blending light accumulations. */
  lightBlending: boolean;
  /** Scene (non-linear) depth texture bound for sampling. */
  depthTexture?: Texture2D;
  /** Linearized depth texture bound for sampling. */
  linearDepthTexture?: Texture2D;
  /** Scene color texture bound for sampling (previous pass or resolved color). */
  sceneColorTexture?: Texture2D;
  /** Default depth buffer format for targets created in this pass. */
  depthFormat?: TextureFormat;
  /** Default color buffer format for targets created in this pass. */
  colorFormat?: TextureFormat;
  /** Instance data buffer/metadata for the current drawing task (instanced rendering). */
  instanceData?: InstanceData;
  /** Compositor used to apply post-processing effects at the end of the frame/pass. */
  compositor?: Compositor;
  /** @internal Map of punctual lights to their shadow map parameters for this pass. */
  shadowMapInfo?: Map<PunctualLight, ShadowMapParams>;
  /** @internal The punctual light currently rendering shadows (shadow pass). */
  currentShadowLight?: PunctualLight;
  /** Sun/directional light reference for passes that need it. */
  sunLight?: DirectionalLight;
  /** Clustered light index/structure for lighting in forward+, clustered shading, etc. */
  clusteredLight?: ClusteredLight;
  /** Material varying bit flags that influence shader selection. */
  materialFlags: number;
  /** Force cull mode override for special passes (optional). */
  forceCullMode?: FaceMode;
  /** Force color mask state override for special passes (optional). */
  forceColorState?: ColorState;
  /** Temporal anti-aliasing is active this frame/pass. */
  TAA: boolean;
  /** Screen-space reflections are active this frame/pass. */
  SSR: boolean;
  /** Whether SSR thickness should be computed dynamically in this pass. */
  SSRCalcThickness: boolean;
  /** SSR roughness input texture. */
  SSRRoughnessTexture: Texture2D;
  /** SSR normal input texture (usually view-space or world-space normals). */
  SSRNormalTexture: Texture2D;
  /** Final framebuffer target where the last stage renders. */
  finalFramebuffer: FrameBuffer;
  /** Intermediate framebuffer used by the compositor or multi-pass pipelines. */
  intermediateFramebuffer: FrameBuffer;
}

/**
 * Morph Data
 * @public
 */
export type MorphData = {
  width: number;
  height: number;
  data: Float32Array<ArrayBuffer>;
  texture?: DRef<Texture2D>;
};

/**
 * Morph information
 * @public
 */
export type MorphInfo = { data: TypedArray; buffer?: DRef<GPUDataBuffer> };

/**
 * Base interface for a drawable (renderable) object.
 *
 * A drawable encapsulates geometry, material, and GPU-resident data required to be rendered.
 * Implementations integrate with render queues, batching, and instancing.
 *
 * @public
 */
export interface Drawable {
  /** Gets the display name of the drawable object (for debugging/UI). */
  getName(): string;
  /** Unique, stable identifier for the drawable, used in caches and picking. */
  getDrawableId(): number;
  /** Returns the owning scene node (transform and hierarchy). */
  getNode(): SceneNode;
  /**
   * Returns the pick target override to be reported when this object is picked.
   *
   * If not set, a default target derived from the node/material may be used.
   */
  getPickTarget(): PickTarget;
  /** Returns the texture containing bone matrices for skinned meshes. */
  getBoneMatrices(): Texture2D;
  /** Returns the unique color used for GPU picking (object ID in color). */
  getObjectColor(): Vector4;
  /** Returns the morph target data texture (if morphing is used). */
  getMorphData(): MorphData;
  /** Returns the morph information buffer (weights, ranges, etc.). */
  getMorphInfo(): MorphInfo;
  /**
   * Computes the distance used for sorting (e.g., transparent draw order).
   *
   * @param camera - Camera from which to compute distance (usually camera -\> object).
   */
  getSortDistance(camera: Camera): number;
  /** Returns the type/category of render queue this object belongs to. */
  getQueueType(): number;
  /** Whether the object requires access to the scene color buffer. */
  needSceneColor(): boolean;
  /** Whether the object requires access to the scene depth (linear or non-linear). */
  needSceneDepth(): boolean;
  /** True if shading is unlit (does not depend on scene lighting). */
  isUnlit(): boolean;
  /** Returns the bound material driving shading for this drawable. */
  getMaterial(): MeshMaterial;
  /** Returns the geometry primitive to be drawn. */
  getPrimitive(): Primitive;
  /**
   * Pushes a reference to the current render queue for cleanup or back-references.
   *
   * Useful for batching or deferred state application.
   */
  pushRenderQueueRef(ref: RenderQueueRef);
  /**
   * Applies transform-related uniforms to the active bind group or pipeline.
   *
   * @param renderQueue - The current render queue issuing this draw.
   */
  applyTransformUniforms(renderQueue: RenderQueue): void;
  /**
   * Issues draw commands for this object.
   *
   * @param ctx - Full draw context for the current pass.
   * @param hash - Optional hash key for render bundle or pipeline caching.
   */
  draw(ctx: DrawContext, hash?: string);
  /**
   * Returns true if the object supports instanced rendering.
   *
   * When true, the object should also implement the {@link BatchDrawable} methods.
   */
  isBatchable(): this is BatchDrawable;
  /** Releases all GPU resources and detaches from the renderer. */
  dispose(): void;
}

/**
 * Interface for drawables that support hardware instancing.
 *
 * Instanced drawables supply instance-specific uniforms, offsets, and strides
 * to allow a single draw call to render many instances efficiently.
 *
 * @public
 */
export interface BatchDrawable extends Drawable {
  /**
   * Returns a stable instance ID string for use with the given render pass.
   *
   * Used to group compatible instances into batches within a pass.
   *
   * @param renderPass - The render pass to which current drawing task belongs.
   * @internal
   */
  getInstanceId(renderPass: RenderPass): string;
  /**
   * Returns a tightly-packed float array of instance uniforms for GPU upload.
   *
   * The returned memory should be compatible with ArrayBuffer views used by the renderer.
   *
   * @internal
   */
  getInstanceUniforms(): Float32Array<ArrayBuffer>;
  /**
   * Applies instance stride and starting offset to the active bind group.
   *
   * This informs the shader how to index into the instance buffer for this batch.
   *
   * @param renderQueue - Render queue associated with the bind group or pipeline.
   * @param stride - Per-instance stride in bytes or floats (renderer-defined).
   * @param offset - Starting instance offset within the instance buffer.
   * @internal
   */
  applyInstanceOffsetAndStride(renderQueue: RenderQueue, stride: number, offset: number): void;
  /**
   * Applies material uniforms for a single instance group.
   *
   * @param instanceInfo - Instance data information for this batch.
   * @internal
   */
  applyMaterialUniforms(instanceInfo: DrawableInstanceInfo);
  /**
   * Applies material uniforms across all grouped instance informations belonging to this material.
   *
   * Useful when batching merges multiple instance groups sharing the same material.
   *
   * @internal
   */
  applyMaterialUniformsAll();
}
