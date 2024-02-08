import type { Matrix4x4, Vector4 } from '@zephyr3d/base';
import type { Texture2D, TextureFormat } from '@zephyr3d/device';
import type { XForm } from '../scene/xform';
import type { Camera } from '../camera/camera';
import type { RenderPass } from '.';
import type { InstanceData } from './render_queue';
import type { ShadowMapParams } from '../shadow';
import type { Environment } from '../scene/environment';
import type { DirectionalLight, GraphNode, PunctualLight, Scene } from '../scene';
import type { Compositor, CompositorContext } from '../posteffect';
import type { RenderLogger } from '../logger/logger';
import type { ClusteredLight } from './cluster_light';

/**
 * The context for drawing objects
 * @public
 */
export interface DrawContext {
  /** The camera position of the primary render pass */
  primaryCamera: Camera;
  /** The camera for current drawing task */
  camera: Camera;
  /** The scene that is currently been drawing */
  scene: Scene;
  /** The object that is currently being drawn */
  target: Drawable;
  /** The render pass to which the current drawing task belongs */
  renderPass: RenderPass;
  /** Hash value for the drawing task */
  renderPassHash: string;
  /** Whether should apply fog to fragment */
  applyFog: boolean;
  /** Wether should flip upside down */
  flip: boolean;
  /** Whether current render pass is base light pass */
  drawEnvLight: boolean;
  /** The scene environment */
  env: Environment;
  /** Timestamp */
  timestamp: number;
  /** Depth texture */
  depthTexture?: Texture2D;
  /** Linear depth texture */
  linearDepthTexture?: Texture2D;
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
  /** render logger */
  logger?: RenderLogger;
  /** user data */
  userData?: unknown;
}

/**
 * Base interface for a drawble object
 * @public
 */
export interface Drawable {
  /** Gets name of the drawable object */
  getName(): string;
  /** Gets the XForm of the object */
  getXForm(): XForm;
  /** Gets the instance color */
  getInstanceColor(): Vector4;
  /** If set, the pick target will be returned as the pick result  */
  getPickTarget(): GraphNode;
  /** Gets the texture that contains the bone matrices of the object */
  getBoneMatrices(): Texture2D;
  /** Gets the inversed bind matrix for skeleton animation */
  getInvBindMatrix(): Matrix4x4;
  /** Gets the distance for object sorting */
  getSortDistance(camera: Camera): number;
  /** true if the object is transparency, false otherwise */
  isTransparency(): boolean;
  /** true if the shading of this object is independent of lighting */
  isUnlit(): boolean;
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
   */
  getInstanceId(renderPass: RenderPass): string;
}