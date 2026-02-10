import { GraphNode } from './graph_node';
import type { CullVisitor, RenderPass } from '../render';
import { RenderQueue, InstanceBindGroupAllocator } from '../render';
import type { Scene } from './scene';
import { BoundingBox, type BoundingVolume } from '../utility/bounding_volume';
import { Matrix4x4 } from '@zephyr3d/base';

const tmpMatrix = new Matrix4x4();

/**
 * Batch group node
 * @public
 */
export class BatchGroup extends GraphNode {
  private readonly _renderQueueMap: Map<
    RenderPass,
    {
      queue: RenderQueue;
      tag: number;
    }
  >;
  private readonly _bindGroupAllocator: InstanceBindGroupAllocator;
  private _changeTag: number;
  private _staticBV: boolean;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._renderQueueMap = new Map();
    this._changeTag = 0;
    this._bindGroupAllocator = new InstanceBindGroupAllocator();
    this._staticBV = false;
    const bvCallback = function (this: BatchGroup) {
      if (!this._staticBV) {
        this.invalidateBoundingVolume();
      }
    }.bind(this);
    this.on('visiblechanged', (node) => {
      node.iterate((child) => {
        if (child.isMesh()) {
          this._changeTag++;
          return true;
        }
        return false;
      });
    });
    this.on('nodeattached', (node) => {
      node.iterate((child) => {
        if (child.isMesh()) {
          child.placeToOctree = false;
          if (!this._staticBV) {
            this.invalidateBoundingVolume();
          }
          child.on('bvchanged', bvCallback);
          this._changeTag++;
        }
      });
    });
    this.on('noderemoved', (node) => {
      node.iterate((child) => {
        if (child.isMesh()) {
          child.placeToOctree = true;
          if (!this._staticBV) {
            this.invalidateBoundingVolume();
          }
          child.off('bvchanged', bvCallback);
          this._changeTag++;
        }
      });
    });
  }
  /**
   * {@inheritDoc Drawable.getName}
   */
  getName() {
    return this._name;
  }
  /**
   * {@inheritDoc SceneNode.isBatchGroup}
   */
  isBatchGroup(): this is BatchGroup {
    return true;
  }
  /**
   * Force the batch state to be rebuilt
   */
  invalidate() {
    this._changeTag++;
  }
  /** @internal */
  protected _onDetached() {
    super._onDetached();
    // Usually the node will be garbage collected after it is detached,
    // We should reset the render queue to release the render bundles.
    this._renderQueueMap.forEach((val) => {
      val.queue.reset();
    });
    this.invalidate();
  }
  /** @internal */
  protected _onAttached() {
    // Reset the render queue when attached to a new scene.
    this.invalidate();
  }
  /** @internal */
  computeBoundingVolume() {
    const bv = new BoundingBox();
    const invWorldMatrix = Matrix4x4.invertAffine(this.worldMatrix);
    bv.beginExtend();
    this.iterate((node) => {
      if (node.isMesh()) {
        Matrix4x4.multiplyAffine(invWorldMatrix, node.worldMatrix, tmpMatrix);
        const wb = node.getBoundingVolume()!.transform(tmpMatrix).toAABB();
        bv.extend(wb.minPoint);
        bv.extend(wb.maxPoint);
      }
    });
    return bv.isValid() ? bv : null;
  }
  /** @internal */
  setBoundingVolume(bv: BoundingVolume) {
    this._staticBV = !!bv;
    super.setBoundingVolume(bv);
  }
  /** @internal */
  cull(cullVisitor: CullVisitor) {
    let queueInfo = this._renderQueueMap.get(cullVisitor.renderPass);
    if (!queueInfo) {
      queueInfo = {
        queue: new RenderQueue(cullVisitor.renderPass, this._bindGroupAllocator),
        tag: -1
      };
      this._renderQueueMap.set(cullVisitor.renderPass, queueInfo);
    }
    if (queueInfo.tag !== this._changeTag) {
      queueInfo.tag = this._changeTag;
      queueInfo.queue.reset();
      const frustumCulling = cullVisitor.frustumCulling;
      const renderQueue = cullVisitor.renderQueue;
      cullVisitor.frustumCulling = false;
      cullVisitor.renderQueue = queueInfo.queue;
      this.iterate((node) => {
        if (node.isMesh()) {
          cullVisitor.visit(node);
        }
      });
      queueInfo.queue.end(cullVisitor.camera, true);
      cullVisitor.frustumCulling = frustumCulling;
      cullVisitor.renderQueue = renderQueue;
    }
    cullVisitor.pushRenderQueue(queueInfo.queue);
  }
}
