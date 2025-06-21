import type { Matrix4x4, AABB } from '@zephyr3d/base';
import { Vector3, Vector4, Ray, makeEventTarget } from '@zephyr3d/base';
import { SceneNode } from './scene_node';
import { Octree } from './octree';
import { RaycastVisitor } from './raycast_visitor';
import { Application } from '../app/app';
import { Environment } from './environment';
import type { GraphNode } from './graph_node';
import type { Camera } from '../camera/camera';
import type { AnimationSet } from '../animation/animationset';
import type { PickTarget } from '../render';
import { SceneRenderer } from '../render';
import type { Compositor } from '../posteffect';
import { DRef, DWeakRef } from '../app';

/**
 * Presents a world that manages a couple of objects that will be rendered
 * @public
 */
export class Scene extends makeEventTarget(Object)<{
  update: [Scene];
  startrender: [Scene, Camera, Compositor];
  endrender: [Scene, Camera, Compositor];
}>() {
  /** @internal */
  private static _nextId = 0;
  /** @internal */
  protected _rootNode: DRef<SceneNode>;
  /** @internal */
  protected _octree: Octree;
  /** @internal */
  protected _nodePlaceList: Set<GraphNode>;
  /** @internal */
  protected _env: Environment;
  /** @internal */
  protected _updateFrame: number;
  /** @internal */
  protected _animationSet: DWeakRef<AnimationSet>[];
  /** @internal */
  protected _id: number;
  /** @internal */
  protected _nodeUpdateQueue: DWeakRef<SceneNode>[];
  /** @internal */
  protected _perCameraUpdateQueue: DWeakRef<SceneNode>[];
  /**
   * Creates an instance of scene
   */
  constructor() {
    super();
    this._id = ++Scene._nextId;
    this._octree = new Octree(this, 8, 8);
    this._nodePlaceList = new Set();
    this._nodeUpdateQueue = [];
    this._perCameraUpdateQueue = [];
    this._env = new Environment();
    this._updateFrame = -1;
    this._animationSet = [];
    this._rootNode = new DRef(new SceneNode(this));
    this._rootNode.get().name = 'Root';
  }
  /**
   * Gets the animation sets in the scene
   * @returns All animation sets in the scene
   */
  getAnimatoinSets() {
    return this._animationSet;
  }
  /**
   * Adds an animation set to the scene
   * @param animationSet - The animation set to be added
   */
  addAnimationSet(animationSet: AnimationSet) {
    this._animationSet.push(new DWeakRef(animationSet));
  }
  /**
   * Deletes an animation set from the scene
   * @param animationSet - The animation set to be removed
   */
  deleteAnimationSet(animationSet: AnimationSet) {
    const index = this._animationSet.findIndex((val) => val.get() === animationSet);
    if (index >= 0) {
      this._animationSet[index].dispose();
      this._animationSet.splice(index, 1);
    }
  }
  /**
   * Gets the unique identifier of the scene
   */
  get id(): number {
    return this._id;
  }
  /**
   * Gets the root scene node of the scene
   */
  get rootNode() {
    return this._rootNode?.get() ?? null;
  }
  /**
   * Gets the octree
   */
  get octree(): Octree {
    // Make sure the octree state is up to date
    this.updateNodePlacement(this._octree, this._nodePlaceList);
    return this._octree;
  }
  /**
   * Gets the bounding box of the scene
   */
  get boundingBox(): AABB {
    this.updateNodePlacement(this._octree, this._nodePlaceList);
    // this._syncBVChangedList();
    return this._octree.getRootNode().getBoxLoosed();
  }
  /**
   * The environment of the scene
   */
  get env(): Environment {
    return this._env;
  }
  /**
   * Disposes the scene
   */
  dispose() {
    this._rootNode.dispose();
  }
  /**
   * Find scene node by id
   */
  findNodeById<T extends SceneNode>(id: string) {
    let node: T = null;
    this._rootNode?.get().iterate((child) => {
      if (child.id === id) {
        node = child as T;
        return true;
      }
    });
    return node;
  }
  /**
   * Cast a ray into the scene to get the closest object hit by the ray
   *
   * @param ray - The ray in world coordinate space
   * @param length - Length of the ray
   * @returns The closest object hit by the ray
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
   * Constructs a ray by a given camera and the position on screen
   * @param camera - The camera used to compute the ray
   * @param viewportWidth - Width of the viewport
   * @param viewportHeight - Height of the viewport
   * @param screenX - The x position on screen
   * @param screenY - The y position on screen
   * @param invModelMatrix - A matrix used to transform the ray
   * @returns The constructed ray
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
   * Add node to the update queue so the node's update method will be called before render.
   * @param node - Node to be queued to update
   *
   * @remarks
   * Node will be removed from update queue after frame rendered, to update the node continuous,
   * call queueUpdateNode in the update method.
   */
  queueUpdateNode(node: SceneNode) {
    if (node && this._nodeUpdateQueue.findIndex((val) => val.get() === node) < 0) {
      this._nodeUpdateQueue.push(new DWeakRef(node));
    }
  }
  /**
   * Add node to the per-camera update queue so the node's update method will be called once per camera before render.
   * @param node - Node to be queued to update
   *
   * @remarks
   * Node will be removed from update queue after frame rendered, to update the node continuous,
   * call queuePerCameraUpdateNode in the update method.
   */
  queuePerCameraUpdateNode(node: SceneNode) {
    if (node && this._perCameraUpdateQueue.findIndex((val) => val.get() === node) < 0) {
      this._perCameraUpdateQueue.push(new DWeakRef(node));
    }
  }
  /** @internal */
  invalidateNodePlacement(node: GraphNode) {
    this._nodePlaceList.add(node);
  }
  /** @internal */
  private updateAnimations() {
    for (let i = this._animationSet.length - 1; i >= 0; i--) {
      const animationSet = this._animationSet[i].get();
      if (!animationSet) {
        this._animationSet[i].dispose();
        this._animationSet.splice(i, 1);
      } else if (animationSet.model?.attached) {
        animationSet.update();
      }
    }
  }
  /** @internal */
  private updateEnvLight() {
    if (this.env.light.type === 'ibl') {
      if (!this.env.light.radianceMap) {
        if (this.env.sky.skyType !== 'none') {
          this.env.light.radianceMap = this.env.sky.radianceMap;
        }
      } else if (this.env.light.radianceMap === this.env.sky.radianceMap) {
        if (this.env.sky.skyType === 'none') {
          this.env.light.radianceMap = null;
        }
      }
      if (!this.env.light.irradianceMap) {
        if (this.env.sky.skyType !== 'none') {
          this.env.light.irradianceMap = this.env.sky.irradianceMap;
        }
      } else if (this.env.light.irradianceMap === this.env.sky.irradianceMap) {
        if (this.env.sky.skyType === 'none') {
          this.env.light.irradianceMap = null;
        }
      }
    }
  }
  /** @internal */
  getRenderer(): typeof SceneRenderer {
    return SceneRenderer;
  }
  /** @internal */
  frameUpdate() {
    const frameInfo = Application.instance.device.frameInfo;
    if (frameInfo.frameCounter !== this._updateFrame) {
      this._updateFrame = frameInfo.frameCounter;
      this.updateAnimations();
      this.updateEnvLight();
      this.dispatchEvent('update', this);
      if (this._nodeUpdateQueue.length > 0) {
        const elapsedInSeconds = frameInfo.elapsedOverall * 0.001;
        const deltaInSeconds = frameInfo.elapsedFrame * 0.001;
        const queue = this._nodeUpdateQueue;
        this._nodeUpdateQueue = [];
        while (queue.length > 0) {
          const ref = queue.shift();
          ref.get()?.update(frameInfo.frameCounter, elapsedInSeconds, deltaInSeconds);
          ref.dispose();
        }
      }
      this.updateNodePlacement(this._octree, this._nodePlaceList);
    }
  }
  /** @internal */
  frameUpdatePerCamera(camera: Camera) {
    if (this._perCameraUpdateQueue.length > 0) {
      const frameInfo = Application.instance.device.frameInfo;
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
   * Update node placement in the octree
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
}
