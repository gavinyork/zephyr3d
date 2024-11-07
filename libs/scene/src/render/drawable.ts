import type { Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  ColorState,
  FaceMode,
  GPUDataBuffer,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import type { XForm } from '../scene/xform';
import type { Camera } from '../camera/camera';
import type { FogType, RenderPass } from '.';
import type { DrawableInstanceInfo, InstanceData, RenderQueue, RenderQueueRef } from './render_queue';
import type { ShadowMapParams } from '../shadow';
import type { Environment } from '../scene/environment';
import type { DirectionalLight, PunctualLight, Scene, SceneNode } from '../scene';
import type { Compositor, CompositorContext } from '../posteffect';
import type { ClusteredLight } from './cluster_light';
import type { MeshMaterial } from '../material';
import type { GlobalBindGroupAllocator } from './globalbindgroup_allocator';
import type { OIT } from './oit';

/**
 * Pick target
 * @public
 */
export type PickTarget = { node: SceneNode; label?: string };

/**
 * The context for drawing objects
 * @public
 */
export interface DrawContext {
  /** Render device */
  device: AbstractDevice;
  /** The camera position of the primary render pass */
  primaryCamera: Camera;
  /** The render queue which is currently being rendered */
  renderQueue?: RenderQueue;
  /** Global bind group allocator */
  globalBindGroupAllocator: GlobalBindGroupAllocator;
  /** The camera for current drawing task */
  camera: Camera;
  /** OIT */
  oit: OIT;
  /** hierarchical depth */
  HiZ: boolean;
  /** hierarchical depth buffer */
  HiZTexture: Texture2D;
  /** The scene that is currently been drawing */
  scene: Scene;
  /** The render pass to which the current drawing task belongs */
  renderPass: RenderPass;
  /** Hash value for the drawing task */
  renderPassHash: string;
  /** Whether should apply fog to fragment */
  applyFog: FogType;
  /** Wether should flip upside down */
  flip: boolean;
  /** Whether current render pass is base light pass */
  drawEnvLight: boolean;
  /** The scene environment */
  env: Environment;
  /** Timestamp */
  timestamp: number;
  /** current queue */
  queue: number;
  /** whether GPU picking is enabled */
  picking: boolean;
  /** whether is blending light */
  lightBlending: boolean;
  /** Depth texture */
  depthTexture?: Texture2D;
  /** Linear depth texture */
  linearDepthTexture?: Texture2D;
  /** Scene color texture */
  sceneColorTexture?: Texture2D;
  /** viewport X */
  viewportX?: number;
  /** viewport Y */
  viewportY?: number;
  /** viewport width */
  viewportWidth?: number;
  /** viewport height */
  viewportHeight?: number;
  /** whether render to default viewport */
  defaultViewport?: boolean;
  /** Default depth buffer format */
  depthFormat?: TextureFormat;
  /** Instance data for current drawing task */
  instanceData?: InstanceData;
  /** The compositor used to apply postprocessing effects */
  compositor?: Compositor;
  /** The posteffect rendering context */
  compositorContex?: CompositorContext;
  /** @internal */
  shadowMapInfo?: Map<PunctualLight, ShadowMapParams>;
  /** @internal */
  currentShadowLight?: PunctualLight;
  /** the sun light */
  sunLight?: DirectionalLight;
  /** clustered light index */
  clusteredLight?: ClusteredLight;
  /** Material varying flags */
  materialFlags: number;
  /** Force cull mode */
  forceCullMode?: FaceMode;
  /** Force color mask state */
  forceColorState?: ColorState;
}

/**
 * Base interface for a drawble object
 * @public
 */
export interface Drawable {
  /** Gets name of the drawable object */
  getName(): string;
  /** Gets unique id of the drawable object */
  getId(): number;
  /** Gets the XForm of the object */
  getXForm(): XForm;
  /** Gets the instance color */
  getInstanceColor(): Vector4;
  /** If set, the pick target will be returned as the pick result  */
  getPickTarget(): PickTarget;
  /** Gets the texture that contains the bone matrices of the object */
  getBoneMatrices(): Texture2D;
  /** Gets the object color used for GPU picking */
  getObjectColor(): Vector4;
  /** Gets the morph texture */
  getMorphData(): Texture2D;
  /** Gets the morph information buffer */
  getMorphInfo(): GPUDataBuffer;
  /** Gets the distance for object sorting */
  getSortDistance(camera: Camera): number;
  /** Gets the type of render queue */
  getQueueType(): number;
  /** Need scene color */
  needSceneColor(): boolean;
  /** true if the shading of this object is independent of lighting */
  isUnlit(): boolean;
  /** Gets the associated material */
  getMaterial(): MeshMaterial;
  /** Set render queue reference */
  pushRenderQueueRef(ref: RenderQueueRef);
  /** Apply transform uniforms */
  applyTransformUniforms(renderQueue: RenderQueue): void;
  /**
   * Draw the object
   * @param ctx - Context of the drawing task
   */
  draw(ctx: DrawContext);
  /**
   * returns true if the object is batchable
   */
  isBatchable(): this is BatchDrawable;
}

/**
 * interface for any objects that support instancing
 * @public
 */
export interface BatchDrawable extends Drawable {
  /**
   * Gets the instance id of the object
   * @param renderPass - The render pass to which current drawing task belongs
   * @internal
   */
  getInstanceId(renderPass: RenderPass): string;
  /**
   * Gets the instance uniforms
   * @internal
   */
  getInstanceUniforms(): Float32Array;
  /**
   * Apply instance offset and stride to bind group
   * @param renderQueue - The render queue to which the bind group belongs.
   * @param stride - Instance stride
   * @param offset - Instance offset
   * @internal
   */
  applyInstanceOffsetAndStride(renderQueue: RenderQueue, stride: number, offset: number): void;
  /**
   * Apply material uniforms of the drawable
   * @param instanceInfo - Instance data information
   * @internal
   */
  applyMaterialUniforms(instanceInfo: DrawableInstanceInfo);
  /**
   * Apply material uniforms to all of the instance informations that the material belongs to
   * @internal
   */
  applyMaterialUniformsAll();
}
