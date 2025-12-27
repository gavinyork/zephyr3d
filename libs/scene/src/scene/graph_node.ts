import { SceneNode } from './scene_node';
import type { Texture2D } from '@zephyr3d/device';
import type { BatchDrawable } from '../render/drawable';
import type { Scene } from './scene';
import type { Camera } from '../camera/camera';
import type { OctreeNode } from '.';
import type { Nullable } from '@zephyr3d/base';

/**
 * Graph scene node
 *
 * @remarks
 * Graph node is the base class of any kind of scene node that will be placed into the octree
 *
 * @public
 */
export class GraphNode extends SceneNode {
  private _octreeNode: Nullable<OctreeNode>;
  /**
   * Creates a graph node
   * @param scene - The scene to which the node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._octreeNode = null;
  }
  /** @internal */
  get octreeNode() {
    return this._octreeNode;
  }
  set octreeNode(node) {
    this._octreeNode = node;
  }
  /** Gets the name */
  getName(): string {
    return this._name;
  }
  /**
   * {@inheritDoc SceneNode.isGraphNode}
   * @override
   */
  isGraphNode(): this is GraphNode {
    return true;
  }
  /**
   * {@inheritDoc Drawable.getNode}
   */
  getNode(): SceneNode {
    return this;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices(): Nullable<Texture2D> {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getSortDistance}
   */
  getSortDistance(camera: Camera): number {
    const cameraWorldMatrix = camera.worldMatrix;
    const objectWorldMatrix = this.worldMatrix;
    const dx = cameraWorldMatrix.m03 - objectWorldMatrix.m03;
    const dy = cameraWorldMatrix.m13 - objectWorldMatrix.m13;
    const dz = cameraWorldMatrix.m23 - objectWorldMatrix.m23;
    return dx * dx + dy * dy * dz * dz;
  }
  /**
   * {@inheritDoc Drawable.isBatchable}
   */
  isBatchable(): this is BatchDrawable {
    return false;
  }
  /** @internal */
  protected _visibleChanged(): void {
    this._scene?.invalidateNodePlacement(this);
  }
}
