import { GraphNode } from './graph_node';
import { RenderQueue, CullVisitor, RenderPass, InstanceBindGroupAllocator, SceneRenderer } from '../render';
import type { Scene } from './scene';
import type { BoundingVolume } from '../utility/bounding_volume';
import { SceneNode } from '.';

/**
 * Batch group node
 * @public
 */
export class BatchGroup extends GraphNode {
  private _renderQueueMap: WeakMap<RenderPass, {
    queue: RenderQueue,
    tag: number
  }>;
  private _bindGroupAllocator: InstanceBindGroupAllocator;
  private _transformHandler: (node: SceneNode) => void;
  private _changeTag: number;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._renderQueueMap = new WeakMap();
    this._changeTag = 0;
    this._bindGroupAllocator = new InstanceBindGroupAllocator();
    this._transformHandler = (node: SceneNode) => {
      if (node.isGraphNode() && node.isBatchable()) {
        const lightInstanceInfo = node.getInstanceDataBuffer(SceneRenderer.sceneRenderPass);
        if (lightInstanceInfo?.buffer) {
          lightInstanceInfo.buffer.set(node.worldMatrix, lightInstanceInfo.offset);
        }
        const depthInstanceInfo = node.getInstanceDataBuffer(SceneRenderer.depthRenderPass);
        if (depthInstanceInfo?.buffer) {
          depthInstanceInfo.buffer.set(node.worldMatrix, depthInstanceInfo.offset);
        }
        const shadowMapInstanceInfo = node.getInstanceDataBuffer(SceneRenderer.shadowMapRenderPass);
        if (shadowMapInstanceInfo?.buffer) {
          shadowMapInstanceInfo.buffer.set(node.worldMatrix, shadowMapInstanceInfo.offset);
        }
      }
    };
    this.on('nodeattached', node => {
      node.iterate(child => {
        if (child.isGraphNode()) {
          if (!node.isMesh()) {
            console.error('Only batch node can be added to batch group');
          }
          child.on('transformchanged', this._transformHandler);
          child.placeToOctree = false;
          if (child.isBatchable()) {
            child.setInstanceDataBuffer(SceneRenderer.sceneRenderPass, null, 0);
            child.setInstanceDataBuffer(SceneRenderer.depthRenderPass, null, 0);
            child.setInstanceDataBuffer(SceneRenderer.shadowMapRenderPass, null, 0);
          }
        }
      });
      this._changeTag++;
    });
    this.on('noderemoved', node => {
      node.iterate(child => {
        if (child.isGraphNode()) {
          child.off('transformchanged', this._transformHandler);
          child.placeToOctree = true;
        }
      });
      this._changeTag++;
    });
  }
  /**
   * {@inheritDoc Drawable.getName}
   */
  getName(): string {
    return this._name;
  }
  /**
   * {@inheritDoc SceneNode.isBatchGroup}
   */
  isBatchGroup(): boolean {
    return true;
  }
  /** @internal */
  computeBoundingVolume(bv: BoundingVolume): BoundingVolume {
    return super.computeBoundingVolume(bv);
  }
  getRenderQueue(cullVisitor: CullVisitor) {
    let queueInfo = this._renderQueueMap.get(cullVisitor.renderPass);
    if (!queueInfo) {
      queueInfo = {
        queue: new RenderQueue(cullVisitor.renderPass, this._bindGroupAllocator),
        tag: -1
      }
      this._renderQueueMap.set(cullVisitor.renderPass, queueInfo);
    }
    if (queueInfo.tag !== this._changeTag) {
      queueInfo.tag = this._changeTag;
      queueInfo.queue.reset();
      const frustumCulling = cullVisitor.frustumCulling;
      const renderQueue = cullVisitor.renderQueue;
      cullVisitor.frustumCulling = false;
      cullVisitor.renderQueue = queueInfo.queue;
      this.iterate(node => {
        if (node.isMesh()) {
          cullVisitor.visit(node);
        }
      });
      cullVisitor.frustumCulling = frustumCulling;
      cullVisitor.renderQueue = renderQueue;
    }
    return queueInfo.queue;
  }
}
