import { AABB, ClipState, Vector3 } from '@zephyr3d/base';
import { OctreeNode } from '../scene/octree';
import { RENDER_PASS_TYPE_SHADOWMAP } from '../values';
import { GraphNode } from '../scene/graph_node';
import type { RenderQueue } from './render_queue';
import type { RenderPass, Drawable } from '.';
import type { Mesh } from '../scene/mesh';
import type { Terrain } from '../scene/terrain';
import type { PunctualLight } from '../scene/light';
import type { Visitor } from '../scene/visitor';
import type { Camera } from '../camera/camera';
import type { SceneNode } from '../scene/scene_node';

/**
 * Node visitor for culling
 * @public
 */
export class CullVisitor implements Visitor {
  /** @internal */
  private _primaryCamera: Camera;
  /** @internal */
  private _camera: Camera;
  /** @internal */
  private _skipClipTest: boolean;
  /** @internal */
  private _renderQueue: RenderQueue;
  /** @internal */
  private _renderPass: RenderPass;
  /**
   * Creates an instance of CullVisitor
   * @param renderPass - Render pass for the culling task
   * @param camera - Camera that will be used for culling
   * @param rendeQueue - RenderQueue
   * @param viewPoint - Camera position of the primary render pass
   */
  constructor(renderPass: RenderPass, camera: Camera, renderQueue: RenderQueue, primaryCamera: Camera) {
    this._primaryCamera = primaryCamera;
    this._camera = camera;
    this._renderQueue = renderQueue;
    this._skipClipTest = false;
    this._renderPass = renderPass;
  }
  /** The camera that will be used for culling */
  get camera() {
    return this._camera;
  }
  /** The camera position of the primary render pass */
  get primaryCamera() {
    return this._primaryCamera;
  }
  set camera(camera: Camera) {
    this._camera = camera || null;
  }
  /** Render pass for the culling task */
  get renderPass(): RenderPass {
    return this._renderPass;
  }
  /** The result of culling */
  get renderQueue() {
    return this._renderQueue;
  }
  /** Frustum for culling */
  get frustum() {
    return this._camera?.frustum || null;
  }
  /** @internal */
  push(camera: Camera, drawable: Drawable, renderOrder: number) {
    this.renderQueue.push(camera, drawable, renderOrder);
  }
  /**
   * Visits a node
   * @param target - The node to be visit
   */
  visit(target: SceneNode|OctreeNode): unknown {
    if (target instanceof OctreeNode) {
      return this.visitOctreeNode(target);
    } else  if (target.isMesh()) {
      return this.visitMesh(target);
    } else if (target.isTerrain()) {
      return this.visitTerrain(target);
    } else if (target.isPunctualLight()) {
      return this.visitPunctualLight(target);
    }
  }
  /** @internal */
  visitPunctualLight(node: PunctualLight) {
    if (!node.hidden) {
      const clipState = this.getClipStateWithNode(node);
      if (clipState !== ClipState.NOT_CLIPPED) {
        this.renderQueue.pushLight(node);
        return true;
      }
    }
    return false;
  }
  /** @internal */
  visitTerrain(node: Terrain) {
    if (!node.hidden && (node.castShadow || this._renderPass.type !== RENDER_PASS_TYPE_SHADOWMAP)) {
      const clipState = this.getClipStateWithNode(node);
      if (clipState !== ClipState.NOT_CLIPPED) {
        return node.cull(this) > 0
      }
    }
    return false;
  }
  /** @internal */
  visitMesh(node: Mesh) {
    if (!node.hidden && (node.castShadow || this._renderPass.type !== RENDER_PASS_TYPE_SHADOWMAP)) {
      const clipState = this.getClipStateWithNode(node);
      if (clipState !== ClipState.NOT_CLIPPED) {
        this.push(this._camera, node, node.renderOrder);
        return true;
      }
    }
    return false;
  }
  /** @internal */
  visitOctreeNode(node: OctreeNode) {
    const clipState = node.getLevel() > 0 ? this.getClipStateWithAABB(node.getBoxLoosed()) : ClipState.CLIPPED;
    if (clipState !== ClipState.NOT_CLIPPED) {
      const saveSkipFlag = this._skipClipTest;
      this._skipClipTest = clipState === ClipState.A_INSIDE_B;
      const nodes = node.getNodes();
      for (let i = 0; i < nodes.length; i++) {
        this.visit(nodes[i]);
      }
      this._skipClipTest = saveSkipFlag;
      return true;
    }
    return false;
  }
  /** @internal */
  protected getClipStateWithNode(node: GraphNode): ClipState {
    let clipState: ClipState;
    if (this._skipClipTest) {
      clipState = ClipState.A_INSIDE_B;
    } else if (node.computedClipMode === GraphNode.CLIP_DISABLED) {
      clipState = ClipState.CLIPPED;
    } else {
      const bv = node.getWorldBoundingVolume();
      clipState = bv ? this.getClipStateWithAABB(bv.toAABB()) : ClipState.CLIPPED;
    }
    return clipState;
  }
  /** @internal */
  protected getClipStateWithAABB(aabb: AABB): ClipState {
    return this.camera.clipMask
      ? aabb.getClipStateWithFrustumMask(this.frustum, this.camera.clipMask)
      : aabb.getClipStateWithFrustum(this.frustum)
  }
}
