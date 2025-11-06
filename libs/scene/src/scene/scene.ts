import type { Matrix4x4, AABB } from '@zephyr3d/base';
import { Vector3, Vector4, Ray, DRef, DWeakRef, makeObservable, Disposable } from '@zephyr3d/base';
import { SceneNode } from './scene_node';
import { Octree } from './octree';
import { RaycastVisitor } from './raycast_visitor';
import { Environment } from './environment';
import type { GraphNode } from './graph_node';
import type { Camera } from '../camera/camera';
import type { PickTarget } from '../render';
import { SceneRenderer } from '../render';
import type { Compositor } from '../posteffect';
import type { Metadata } from 'draco3d';
import { getDevice } from '../app/api';
import type { IRenderable } from '../app';

/**
 * Represents a renderable world that manages scene graph, spatial indexing, and environment.
 *
 * Core responsibilities:
 * - Owns the root {@link SceneNode} and maintains a spatial {@link Octree} for culling/raycasting.
 * - Manages environment/lighting via {@link Environment}.
 * - Provides per-frame update queues (global and per-camera) for scene nodes.
 * - Offers utilities like ray construction and raycasting.
 * - Emits observable events: `update`, `startrender`, `endrender`.
 *
 * Performance notes:
 * - Octree placement is lazily synchronized on demand before reads (e.g., `octree`, `boundingBox`)
 *   and during per-frame updates.
 * - Update queues use weak references to avoid retaining disposed nodes.
 *
 * @public
 */
export class Scene
  extends makeObservable(Disposable)<{
    /** Dispatched once per frame before render-related work. */
    update: [Scene];
    /** Dispatched immediately before rendering begins for a camera. */
    startrender: [Scene, Camera, Compositor];
    /** Dispatched immediately after rendering finishes for a camera. */
    endrender: [Scene, Camera, Compositor];
  }>()
  implements IRenderable
{
  /** @internal */
  private static _nextId = 0;
  /** @internal Scene name. */
  protected _name: string;
  /** @internal Root node reference. */
  protected _rootNode: DRef<SceneNode>;
  /** @internal Spatial index for placement/culling. */
  protected _octree: Octree;
  /**
   * @internal Pending nodes whose placement in the octree must be updated.
   * Populated by {@link Scene.invalidateNodePlacement} and drained by {@link Scene.updateNodePlacement}.
   */
  protected _nodePlaceList: Set<GraphNode>;
  /** @internal Environment data (sky/light/IBL). */
  protected _env: Environment;
  /** @internal Frame counter that last updated this scene. */
  protected _updateFrame: number;
  /** @internal Unique scene ID. */
  protected _id: number;
  /** @internal One-shot per-frame update queue (runs before render). */
  protected _nodeUpdateQueue: DWeakRef<SceneNode>[];
  /** @internal One-shot per-frame-per-camera update queue. */
  protected _perCameraUpdateQueue: DWeakRef<SceneNode>[];
  /** @internal Main camera reference. */
  protected _mainCamera: DRef<Camera>;
  /** @internal Arbitrary metadata loaded with the scene (optional). */
  protected _metaData: Metadata;
  /** @internal User-attached script entry (engine-defined). */
  private _script: string;
  /**
   * Creates an instance of Scene.
   *
   * Initializes:
   * - Unique ID
   * - Empty environment
   * - Octree with default depth/leaf capacities
   * - Root scene node named "Root"
   *
   * @param name - Optional scene name for diagnostics/UI.
   */
  constructor(name?: string) {
    super();
    this._id = ++Scene._nextId;
    this._name = name ?? '';
    this._octree = new Octree(this, 8, 8);
    this._nodePlaceList = new Set();
    this._nodeUpdateQueue = [];
    this._perCameraUpdateQueue = [];
    this._env = new Environment();
    this._updateFrame = -1;
    this._rootNode = new DRef(new SceneNode(this));
    this._rootNode.get().name = 'Root';
    this._metaData = null;
    this._script = '';
    this._mainCamera = new DRef();
  }
  /**
   * Gets the unique identifier of the scene.
   */
  get id(): number {
    return this._id;
  }
  /**
   * Name of the scene
   */
  get name() {
    return this._name;
  }
  set name(val: string) {
    this._name = val ?? '';
  }
  /**
   * Main camera used to render the scene by default.
   */
  get mainCamera() {
    return this._mainCamera.get();
  }
  set mainCamera(camera: Camera) {
    this._mainCamera.set(camera);
  }
  /**
   * Gets the root scene node of the scene
   */
  get rootNode() {
    return this._rootNode?.get() ?? null;
  }
  /**
   * Gets the octree used for spatial organization and queries.
   *
   * Ensures pending node placements are synchronized before returning.
   */
  get octree(): Octree {
    // Make sure the octree state is up to date
    this.updateNodePlacement(this._octree, this._nodePlaceList);
    return this._octree;
  }
  /**
   * Gets the world-axis-aligned bounding box of the scene.
   *
   * Ensures pending node placements are synchronized before computing.
   */
  get boundingBox(): AABB {
    this.updateNodePlacement(this._octree, this._nodePlaceList);
    // this._syncBVChangedList();
    return this._octree.getRootNode().getBoxLoosed();
  }
  /**
   * The environment (sky, lights, IBL) of the scene.
   */
  get env(): Environment {
    return this._env;
  }
  /**
   * Arbitrary metadata associated with the scene (e.g., imported asset info).
   */
  get metaData(): Metadata {
    return this._metaData;
  }
  set metaData(val: Metadata) {
    this._metaData = val;
  }
  /**
   * Attached script filename or identifier (engine-specific).
   *
   * @remarks
   * Integrates with the engine’s scripting system if available.
   */
  get script() {
    return this._script;
  }
  set script(fileName: string) {
    this._script = fileName ?? '';
  }
  /**
   * Finds a scene node by its persistent ID.
   *
   * @typeParam T - Expected node type.
   * @param id - Persistent identifier to match against `SceneNode.persistentId`.
   * @returns The first matching node, or `null` if not found.
   */
  findNodeById<T extends SceneNode>(id: string) {
    return this._rootNode.get().findNodeById<T>(id);
  }
  /**
   * Finds a scene node by name.
   *
   * If multiple nodes share the same name, returns the first match encountered
   * during traversal.
   *
   * @typeParam T - Expected node type.
   * @param name - Node name to match.
   * @returns The first matching node, or `null` if not found.
   *
   * @remarks
   * Names are not guaranteed unique. Prefer IDs for stable references.
   */
  findNodeByName<T extends SceneNode>(name: string) {
    return this._rootNode.get().findNodeByName<T>(name);
  }
  /**
   * Casts a ray into the scene and returns the closest intersection, if any.
   *
   * @param ray - The ray in world space.
   * @param length - Maximum ray length. Defaults to `Infinity`.
   * @returns Intersection info `{ target, dist, point }`, or `null` if no hit.
   *
   */
  raycast(ray: Ray, length = Infinity): { target: PickTarget; dist: number; point: Vector3 } {
    const raycastVisitor = new RaycastVisitor(ray, length);
    this.octree.getRootNode().traverse(raycastVisitor);
    return raycastVisitor.intersected
      ? {
          target: raycastVisitor.intersected,
          dist: raycastVisitor.intersectedDist,
          point: raycastVisitor.intersectedPoint
        }
      : null;
  }
  /**
   * Constructs a world-space ray from a camera and a screen position.
   *
   * @param camera - Camera whose projection/view defines the ray.
   * @param viewportWidth - Current viewport width in pixels.
   * @param viewportHeight - Current viewport height in pixels.
   * @param screenX - Screen-space x (pixels).
   * @param screenY - Screen-space y (pixels).
   * @param invModelMatrix - Optional inverse model matrix to transform the ray into local space.
   * @returns The constructed Ray.
   *
   * @remarks
   * Computes NDC from screen coordinates, unprojects using `invViewProjectionMatrix`,
   * then forms a ray from the camera world position to the unprojected point.
   * If `invModelMatrix` is provided, both origin and direction are transformed.
   */
  constructRay(
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    screenX: number,
    screenY: number,
    invModelMatrix?: Matrix4x4
  ): Ray {
    const vClip = new Vector4((2 * screenX) / viewportWidth - 1, 1 - (2 * screenY) / viewportHeight, 1, 1);
    const vWorld = camera.invViewProjectionMatrix.transform(vClip);
    vWorld.scaleBy(1 / vWorld.w);
    let vEye = camera.getWorldPosition();
    let vDir = Vector3.sub(vWorld.xyz(), vEye).inplaceNormalize();
    if (invModelMatrix) {
      vEye = invModelMatrix.transformPointAffine(vEye);
      vDir = invModelMatrix.transformVectorAffine(vDir);
    }
    return new Ray(vEye, vDir);
  }
  /**
   * Queues a node for a one-shot update before the next render.
   *
   * The node's `update(frame, elapsedSeconds, deltaSeconds)` will be called
   * during Scene.frameUpdate and then the node is removed from the queue.
   *
   * @param node - Node to schedule.
   *
   * @remarks
   * - To update continuously each frame, call `queueUpdateNode(this)` from within the node's `update` method.
   * - Duplicate scheduling within the same frame is prevented.
   */
  queueUpdateNode(node: SceneNode) {
    if (node && this._nodeUpdateQueue.findIndex((val) => val.get() === node) < 0) {
      this._nodeUpdateQueue.push(new DWeakRef(node));
    }
  }
  /**
   * Queues a node for a one-shot per-camera update before render.
   *
   * The node's `updatePerCamera(camera, elapsedSeconds, deltaSeconds)` will be
   * called once for each camera during {@link Scene.frameUpdatePerCamera}, then removed.
   *
   * @param node - Node to schedule.
   *
   * @remarks
   * - To run per-camera work continuously, re-queue from `updatePerCamera`.
   * - Duplicate scheduling within the same frame is prevented.
   */
  queuePerCameraUpdateNode(node: SceneNode) {
    if (node && this._perCameraUpdateQueue.findIndex((val) => val.get() === node) < 0) {
      this._perCameraUpdateQueue.push(new DWeakRef(node));
    }
  }
  /**
   * Renders this scene using the `mainCamera`, if present.
   *
   * Equivalent to `mainCamera.render(this)` when `mainCamera` is set.
   */
  render() {
    if (this.mainCamera) {
      this.mainCamera.render(this);
    }
  }
  /**
   * Marks a graph node as needing placement update in the octree.
   *
   * Called by nodes when their transform/visibility/attachment changes in a way
   * that affects spatial placement.
   *
   * @internal
   */
  invalidateNodePlacement(node: GraphNode) {
    this._nodePlaceList.add(node);
  }
  /**
   * Synchronizes environment light maps (IBL, SH/FB) with the sky as needed.
   *
   * Uses device capabilities to decide between Spherical Harmonics floating-point blending (SHFB)
   * and classic SH textures, and lazily fills missing environment fields from the sky.
   *
   * @internal
   */
  private updateEnvLight() {
    if (this.env.light.type === 'ibl' || this.env.light.type === 'ibl-sh') {
      const useSHFB =
        getDevice().type === 'webgl' || !getDevice().getDeviceCaps().framebufferCaps.supportFloatBlending;
      if (!this.env.light.radianceMap) {
        this.env.light.radianceMap = this.env.sky.radianceMap;
      }
      if (!this.env.light.irradianceMap) {
        this.env.light.irradianceMap = this.env.sky.irradianceMap;
      }
      if (useSHFB && !this.env.light.irradianceSHFB) {
        this.env.light.irradianceSHFB = this.env.sky.irradianceSHFB;
      }
      if (!useSHFB && !this.env.light.irradianceSH) {
        this.env.light.irradianceSH = this.env.sky.irradianceSH;
      }
    }
  }
  /**
   * Returns the renderer class used to render the scene.
   *
   * Override in subclasses to supply a custom renderer.
   *
   * @internal
   */
  getRenderer(): typeof SceneRenderer {
    return SceneRenderer;
  }
  /**
   * Performs per-frame scene updates, once per device frame.
   *
   * Steps:
   * - Ensure this runs only once per frame (via `frameInfo.frameCounter`).
   * - Update environment light synchronization.
   * - Dispatch `update` event.
   * - Drain the one-shot node update queue and call `node.update(...)`.
   * - Apply pending octree placement updates.
   *
   */
  frameUpdate() {
    const frameInfo = getDevice().frameInfo;
    if (frameInfo.frameCounter !== this._updateFrame) {
      this._updateFrame = frameInfo.frameCounter;
      //this.updateAnimations();
      this.updateEnvLight();
      this.dispatchEvent('update', this);
      if (this._nodeUpdateQueue.length > 0) {
        const elapsedInSeconds = frameInfo.elapsedOverall * 0.001;
        const deltaInSeconds = frameInfo.elapsedFrame * 0.001;
        const queue = this._nodeUpdateQueue;
        this._nodeUpdateQueue = [];
        while (queue.length > 0) {
          const ref = queue.shift();
          const node = ref.get();
          if (node?.attached) {
            node.update(frameInfo.frameCounter, elapsedInSeconds, deltaInSeconds);
          }
          ref.dispose();
        }
      }
      this.updateNodePlacement(this._octree, this._nodePlaceList);
    }
  }
  /**
   * Performs per-camera scene updates for the current frame.
   *
   * Steps:
   * - Drain the per-camera update queue and call `node.updatePerCamera(camera, ...)`.
   * - Apply pending octree placement updates.
   *
   * @param camera - The camera being updated for.
   */
  frameUpdatePerCamera(camera: Camera) {
    if (this._perCameraUpdateQueue.length > 0) {
      const frameInfo = getDevice().frameInfo;
      const elapsedInSeconds = frameInfo.elapsedOverall * 0.001;
      const deltaInSeconds = frameInfo.elapsedFrame * 0.001;
      const queue = this._perCameraUpdateQueue;
      this._perCameraUpdateQueue = [];
      while (queue.length > 0) {
        const ref = queue.shift();
        ref.get()?.updatePerCamera(camera, elapsedInSeconds, deltaInSeconds);
        ref.dispose();
      }
    }
    this.updateNodePlacement(this._octree, this._nodePlaceList);
  }
  /**
   * Applies placement changes for nodes in `list` to the given `octree`.
   *
   * Rules:
   * - If node is not disposed, attached, not hidden, and `placeToOctree` is true,
   *   it is placed; otherwise removed.
   * - Drains `list` until empty.
   *
   * @param octree - Target spatial index.
   * @param list - Set of nodes awaiting placement evaluation.
   */
  updateNodePlacement(octree: Octree, list: Set<GraphNode>) {
    function placeNode(node: GraphNode) {
      if (!node.disposed && node.attached && !node.hidden && node.placeToOctree) {
        octree.placeNode(node);
      } else {
        octree.removeNode(node);
      }
      list.delete(node);
    }
    if (list.size > 0) {
      while (list.size > 0) {
        const node = list.keys().next().value;
        if (octree) {
          placeNode(node);
        } else {
          list.delete(node);
        }
      }
    }
  }
  /**
   * Disposes the scene and its owned resources.
   *
   * Disposes:
   * - Environment
   * - Root node (and, by extension, its hierarchy)
   * - Main camera reference wrapper
   *
   */
  protected onDispose() {
    this._env.dispose();
    this._rootNode.dispose();
    this._mainCamera.dispose();
  }
}
