import { AABB } from '@zephyr3d/base';
import type { SceneNode } from '@zephyr3d/scene';

export function calcHierarchyBoundingBox(node: SceneNode, bboxOut?: AABB): AABB {
  bboxOut = bboxOut ?? new AABB();
  bboxOut.beginExtend();
  node.iterate((child) => {
    const bbox = child.getWorldBoundingVolume();
    if (bbox) {
      const aabb = bbox.toAABB();
      bboxOut.extend(aabb.minPoint);
      bboxOut.extend(aabb.maxPoint);
    }
  });
  if (!bboxOut.isValid()) {
    const worldPos = node.getWorldPosition();
    bboxOut.minPoint.x = worldPos.x - 1;
    bboxOut.minPoint.y = worldPos.y - 1;
    bboxOut.minPoint.z = worldPos.z - 1;
    bboxOut.maxPoint.x = worldPos.x + 1;
    bboxOut.maxPoint.y = worldPos.y + 1;
    bboxOut.maxPoint.z = worldPos.z + 1;
  }
  return bboxOut;
}
