import type { Matrix4x4, AABB } from '@zephyr3d/base';
import { Vector3, Vector4, Ray, makeEventTarget } from '@zephyr3d/base';
import { SceneNode } from './scene_node';
import { Octree } from './octree';
import { RaycastVisitor } from './raycast_visitor';
import { Application } from '../app';
import { Environment } from './environment';
import type { GraphNode } from './graph_node';
import type { Camera } from '../camera/camera';
import type { AnimationSet } from '../animation/animationset';
import type { PickTarget } from '../render';

/**
 * Presents a world that manages a couple of objects that will be rendered
 * @public
 */
export class Scene extends makeEventTarget(Object)<{ sceneupdate: [Scene] }>() {
  /** @internal */
  private static _nextId = 0;
  /** @internal */
  protected _rootNode: SceneNode;
  /** @internal */
  protected _octree: Octree;
  /** @internal */
  protected _nodePlaceList: Set<GraphNode>;
  /** @internal */
  protected _env: Environment;
  /** @internal */
  protected _updateFrame: number;
  /** @internal */
  protected _animationSet: AnimationSet[];
  /** @internal */
  protected _id: number;
  /**
   * Creates an instance of scene
   */
  constructor() {
    super();
    this._id = ++Scene._nextId;
    this._octree = new Octree(this, 8, 8);
    this._nodePlaceList = new Set();
    this._env = new Environment();
    this._updateFrame = -1;
    this._animationSet = [];
    this._rootNode = new SceneNode(this);
  }
  /** @internal */
  get animationSet(): AnimationSet[] {
    return this._animationSet;
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
    return this._rootNode;
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
    this._rootNode = null;
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
  /** @internal */
  invalidateNodePlacement(node: GraphNode) {
    if (node.placeToOctree || node.octreeNode) {
      this._nodePlaceList.add(node);
    }
  }
  /** @internal */
  frameUpdate() {
    const frameInfo = Application.instance.device.frameInfo;
    if (frameInfo.frameCounter !== this._updateFrame) {
      this._updateFrame = frameInfo.frameCounter;
      for (const an of this._animationSet) {
        if (an.model.attached) {
          an.update();
        }
      }
      // check environment lighting
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
      // update scene objects first
      this.dispatchEvent('sceneupdate', this);
      this.updateNodePlacement(this._octree, this._nodePlaceList);
    }
  }
  /**
   * Update node placement in the octree
   */
  updateNodePlacement(octree: Octree, list: Set<GraphNode>) {
    function placeNode(node: GraphNode, attached: boolean) {
      if (attached && !node.hidden && node.placeToOctree) {
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
          placeNode(node, node.attached);
        } else {
          list.delete(node);
        }
      }
    }
  }
}
