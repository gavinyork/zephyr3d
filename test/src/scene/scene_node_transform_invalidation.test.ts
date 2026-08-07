import { SceneNode } from '@zephyr3d/scene';

class TransformInvalidationNode extends SceneNode {
  readonly descendantInvalidationRequests: boolean[] = [];

  override invalidateWorldBoundingVolume(transformChanged: boolean): void {
    this.descendantInvalidationRequests.push(transformChanged);
    super.invalidateWorldBoundingVolume(transformChanged);
  }
}

describe('SceneNode transform invalidation', () => {
  test('invalidates a synchronized transform subtree without repeated descendant scans', () => {
    const root = new TransformInvalidationNode(null);
    const child = new TransformInvalidationNode(null);
    const leaf = new TransformInvalidationNode(null);
    child.position.setXYZ(1, 0, 0);
    leaf.position.setXYZ(1, 0, 0);
    child.parent = root;
    leaf.parent = child;

    expect(leaf.getWorldPosition().x).toBeCloseTo(2);
    root.descendantInvalidationRequests.length = 0;
    child.descendantInvalidationRequests.length = 0;
    leaf.descendantInvalidationRequests.length = 0;

    root.position.setXYZ(1, 0, 0);

    expect(root.descendantInvalidationRequests).toEqual([false]);
    expect(child.descendantInvalidationRequests).toEqual([false]);
    expect(leaf.descendantInvalidationRequests).toEqual([false]);
    expect(leaf.getWorldPosition().x).toBeCloseTo(3);
  });
});
