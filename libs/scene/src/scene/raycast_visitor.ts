import { Ray, Vector3 } from '@zephyr3d/base';
import { OctreeNode } from './octree';
import type { Mesh } from './mesh';
import type { Terrain } from './terrain';
import type { Visitor } from './visitor';
import type { SceneNode } from './scene_node';
import type { PickTarget } from '../render';
import type { Water } from './water';

/** @internal */
export class RaycastVisitor implements Visitor<SceneNode | OctreeNode> {
  /** @internal */
  private _ray: Ray;
  /** @internal */
  private _rayLocal: Ray;
  /** @internal */
  private _intersected: PickTarget;
  /** @internal */
  private _intersectedDist: number;
  constructor(ray: Ray, length: number) {
    this._ray = ray;
    this._rayLocal = new Ray();
    this._intersected = null;
    this._intersectedDist = length;
  }
  get intersected(): PickTarget {
    return this._intersected;
  }
  get intersectedDist(): number {
    return this._intersectedDist;
  }
  get intersectedPoint(): Vector3 {
    return Vector3.add(this._ray.origin, Vector3.scale(this._ray.direction, this._intersectedDist));
  }
  visit(target: SceneNode | OctreeNode): boolean {
    if (target instanceof OctreeNode) {
      return this.visitOctreeNode(target);
    }
    if (target.isMesh()) {
      return this.visitMesh(target);
    } else if (target.isTerrain()) {
      return this.visitTerrain(target);
    } else if (target.isWater()) {
      return this.visitWater(target);
    }
    return false;
  }
  visitTerrain(node: Terrain) {
    if (!node.hidden && node.pickable) {
      this._ray.transform(node.invWorldMatrix, this._rayLocal);
      const d = node.rayIntersect(this._rayLocal); // this._rayLocal.bboxIntersectionTestEx(node.getBoundingVolume().toAABB());
      if (d !== null && d < this._intersectedDist) {
        this._intersectedDist = d;
        this._intersected = { node };
        return true;
      }
    }
    return false;
  }
  visitWater(node: Water) {
    if (!node.hidden && node.pickable) {
      const bv = node.getWorldBoundingVolume().toAABB();
      const d = this._ray.bboxIntersectionTestEx(bv);
      if (d !== null && d < this._intersectedDist) {
        this._intersectedDist = d;
        this._intersected = { node };
        return true;
      }
    }
    return false;
  }
  visitMesh(node: Mesh) {
    if (!node.hidden && node.pickable) {
      this._ray.transform(node.invWorldMatrix, this._rayLocal);
      const d = node.primitive.raycast(this._rayLocal);
      if (d !== null && d < this._intersectedDist) {
        this._intersectedDist = d;
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
}
