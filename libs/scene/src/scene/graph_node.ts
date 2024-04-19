import type { Matrix4x4 } from '@zephyr3d/base';
import { SceneNode } from './scene_node';
import type { Texture2D } from '@zephyr3d/device';
import type { XForm } from './xform';
import type { BatchDrawable } from '../render/drawable';
import type { Scene } from './scene';
import type { Camera } from '../camera/camera';
import type { OctreeNode } from '.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Graph scene node
 *
 * @remarks
 * Graph node is the base class of any kind of scene node that will be placed into the octree
 *
 * @public
 */
export class GraphNode extends SceneNode {
  private _octreeNode: OctreeNode;
  /**
   * Creates a graph node
   * @param scene - The scene to which the node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._renderOrder = 0;
    this._octreeNode = null;
  }
  /** @internal */
  get octreeNode(): OctreeNode {
    return this._octreeNode;
  }
  set octreeNode(node: OctreeNode) {
    this._octreeNode = node;
  }
  /**
   * Render order of the node
   */
  get renderOrder() {
    return this._renderOrder;
  }
  set renderOrder(val: number) {
    this._renderOrder = val;
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
   * {@inheritDoc Drawable.getXForm}
   */
  getXForm(): XForm {
    return this;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices(): Texture2D {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getInvBindMatrix}
   */
  getInvBindMatrix(): Matrix4x4 {
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
