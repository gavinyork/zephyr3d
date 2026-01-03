import type { Nullable } from '@zephyr3d/base';
import { Ray, Vector3 } from '@zephyr3d/base';
import { OctreeNode } from './octree';
import type { Mesh } from './mesh';
import type { Visitor } from './visitor';
import type { SceneNode } from './scene_node';
import type { PickTarget } from '../render';
import type { Water } from './water';

const tmpV3 = new Vector3();

/** @internal */
export class RaycastVisitor implements Visitor<SceneNode | OctreeNode> {
  /** @internal */
  private readonly _ray: Ray;
  /** @internal */
  private readonly _rayLocal: Ray;
  /** @internal */
  private _intersected: Nullable<PickTarget>;
  /** @internal */
  private _intersectedDist: number;
  /** @internal */
  private readonly _intersectedPoint: Vector3;
  constructor(ray: Ray, length: number) {
    this._ray = ray;
    this._rayLocal = new Ray();
    this._intersected = null;
    this._intersectedDist = length;
    this._intersectedPoint = new Vector3();
  }
  get intersected() {
    return this._intersected;
  }
  get intersectedDist() {
    return this._intersectedDist;
  }
  get intersectedPoint() {
    return this._intersectedPoint;
  }
  visit(target: SceneNode | OctreeNode) {
    if (target instanceof OctreeNode) {
      return this.visitOctreeNode(target);
    }
    if (target.isMesh()) {
      return this.visitMesh(target);
    } else if (target.isWater()) {
      return this.visitWater(target);
    }
    return false;
  }
  visitWater(node: Water) {
    if (!node.hidden && node.pickable) {
      const bv = node.getWorldBoundingVolume()!.toAABB();
      const d = this._ray.bboxIntersectionTestEx(bv);
      if (this.updateVisitResult(d, node)) {
        this._intersectedDist = d!;
        this._intersected = node.getPickTarget();
        return true;
      }
    }
    return false;
  }
  visitMesh(node: Mesh) {
    if (!node.hidden && node.pickable) {
      this._ray.transform(node.invWorldMatrix, this._rayLocal);
      const d = node.primitive!.raycast(this._rayLocal);
      if (this.updateVisitResult(d, node)) {
        this._intersected = node.getPickTarget();
        return true;
      }
    }
    return false;
  }
  visitOctreeNode(node: OctreeNode) {
    if (node.getLevel() === 0 || this._ray.bboxIntersectionTest(node.getBoxLoosed()) !== null) {
      const nodes = node.getNodes();
      for (let i = 0; i < nodes.length; i++) {
        this.visit(nodes[i]);
      }
      return true;
    }
    return false;
  }
  private updateVisitResult(d: Nullable<number>, node: SceneNode) {
    if (d !== null) {
      Vector3.combine(this._rayLocal.origin, this._rayLocal.direction, 1, d, tmpV3);
      node.worldMatrix.transformPointAffine(tmpV3, tmpV3);
      const dist = Vector3.distance(tmpV3, this._ray.origin);
      if (dist < this._intersectedDist) {
        this._intersectedDist = dist;
        this._intersectedPoint.set(tmpV3);
        return true;
      }
    }
    return false;
  }
}
