import { GraphNode } from './graph_node';
import type { CullVisitor, RenderPass } from '../render';
import { RenderQueue, InstanceBindGroupAllocator } from '../render';
import type { Scene } from './scene';
import type { BoundingVolume } from '../utility/bounding_volume';

/**
 * Batch group node
 * @public
 */
export class BatchGroup extends GraphNode {
  private _renderQueueMap: WeakMap<
    RenderPass,
    {
      queue: RenderQueue;
      tag: number;
    }
  >;
  private _bindGroupAllocator: InstanceBindGroupAllocator;
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
    this.on('nodeattached', (node) => {
      node.iterate((child) => {
        if (child.isGraphNode()) {
          if (!child.isMesh()) {
            console.error('Only mesh node can be added to batch group');
          }
          child.placeToOctree = false;
        }
      });
      this._changeTag++;
    });
    this.on('noderemoved', (node) => {
      node.iterate((child) => {
        if (child.isGraphNode()) {
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
    return queueInfo.queue;
  }
}
