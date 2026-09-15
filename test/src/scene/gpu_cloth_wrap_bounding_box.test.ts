import { Matrix4x4, Vector3 } from '@zephyr3d/base';
import { calculateGPUClothWrapBoundingBox } from '../../../libs/scene/src/animation/cloth/gpu_cloth_system';
import { Mesh } from '../../../libs/scene/src/scene/mesh';
import { BoundingBox } from '../../../libs/scene/src/utility/bounding_volume';

describe('GPU cloth wrap bounds', () => {
  it('excludes zero-weight offsets and includes skinned and partially wrapped vertices', () => {
    const sourceBox = new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
    const skinPositions = new Float32Array([5, 0, 0, 100, 0, 0, 10, 0, 0]);
    const offsets = new Float32Array([100, 2, 4]);
    const weights = new Float32Array([0, 1, 0.5]);
    const box = calculateGPUClothWrapBoundingBox(
      sourceBox,
      new Matrix4x4().identity(),
      skinPositions,
      offsets,
      weights
    );

    expect(box.minPoint.x).toBeCloseTo(-2.001);
    expect(box.maxPoint.x).toBeCloseTo(7.501);
    expect(box.minPoint.y).toBeCloseTo(-2.001);
    expect(box.maxPoint.y).toBeCloseTo(3.001);
  });

  it('transforms wrapped bounds into target space without including zero-weight source bounds', () => {
    const sourceBox = new BoundingBox(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const box = calculateGPUClothWrapBoundingBox(
      sourceBox,
      Matrix4x4.translationXYZ(20, 0, 0),
      new Float32Array([5, 0, 0, 100, 0, 0]),
      new Float32Array([100, 1]),
      new Float32Array([0, 1])
    );

    expect(box.minPoint.x).toBeCloseTo(4.999);
    expect(box.maxPoint.x).toBeCloseTo(22.001);
  });

  it('retains externally updated bounds while skinning is suspended', () => {
    const mesh = Object.create(Mesh.prototype) as Mesh;
    const box = new BoundingBox(new Vector3(-1, -2, -3), new Vector3(1, 2, 3));
    (mesh as any)._suspendSkinning = false;
    (mesh as any)._animatedBoundingBox = box;
    mesh.setAnimatedBoundingBox = jest.fn((value) => {
      (mesh as any)._animatedBoundingBox = value;
    });
    mesh.suspendSkinning = true;
    expect(mesh.getAnimatedBoundingBox()).toBeNull();

    mesh.setAnimatedBoundingBox(box);
    mesh.setBoneMatrices = jest.fn();
    (mesh as any).updateSkeletonState();

    expect(mesh.getAnimatedBoundingBox()).toBe(box);
  });
});
