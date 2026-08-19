import { Vector3 } from '@zephyr3d/base';
import {
  DEFAULT_SKIN_INFLUENCE_LIMIT,
  applyMeshSkinInfluenceData,
  Mesh,
  Scene,
  setSkinInfluenceLimit,
  type AssetPrimitiveInfo,
  type AssetSubMeshData
} from '../../../libs/scene/src';
import { GLTFImporter } from '../../../libs/loaders/src/gltf/gltf_importer';

jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    type: 'webgpu',
    frameInfo: {
      frameCounter: 0,
      elapsedFrame: 16.6667
    },
    createTexture2D: (_format: string, width: number, height: number) => ({
      width,
      height,
      update: () => undefined,
      dispose: () => undefined
    })
  })),
  tryGetApp: jest.fn(() => null)
}));

describe('GLTF skin influence count', () => {
  afterEach(() => {
    setSkinInfluenceLimit(DEFAULT_SKIN_INFLUENCE_LIMIT);
  });

  test('uses the actual mesh count instead of padding every vertex to the project limit', () => {
    setSkinInfluenceLimit(12);
    const accessors = [
      new Uint16Array([0, 1, 2, 3]),
      new Float32Array([0.4, 0.25, 0.2, 0.1]),
      new Uint16Array([4, 0, 0, 0]),
      new Float32Array([0.05, 0, 0, 0])
    ].map((data) => ({
      count: 1,
      type: 'VEC4',
      getComponentCount: () => 4,
      getNormalizedDeinterlacedView: () => data
    }));
    const primitive: AssetPrimitiveInfo = {
      vertices: {} as AssetPrimitiveInfo['vertices'],
      indices: null,
      indexCount: 1,
      type: 'point-list',
      boxMin: Vector3.zero(),
      boxMax: Vector3.zero()
    };
    const subMesh: AssetSubMeshData = {
      name: 'eyelashes',
      primitive,
      material: null,
      rawPositions: new Float32Array(3),
      rawBlendIndices: null,
      rawJointWeights: null,
      numTargets: 0
    };

    (
      new GLTFImporter() as unknown as {
        _finalizeSkinData(
          gltf: unknown,
          attributes: Record<string, number>,
          primitive: AssetPrimitiveInfo,
          subMesh: AssetSubMeshData
        ): void;
      }
    )._finalizeSkinData(
      { _accessors: accessors },
      { JOINTS_0: 0, WEIGHTS_0: 1, JOINTS_1: 2, WEIGHTS_1: 3 },
      primitive,
      subMesh
    );

    expect(subMesh.rawSkinInfluenceCount).toBe(5);
    expect(subMesh.rawBlendIndices).toHaveLength(5);
    expect(subMesh.rawJointWeights).toHaveLength(5);
  });

  test('does not read the next vertex when an odd influence count leaves half a texel empty', () => {
    const scene = new Scene();
    const mesh = new Mesh(scene);
    const subMesh: AssetSubMeshData = {
      name: 'eyelashes',
      primitive: {
        vertices: {} as AssetPrimitiveInfo['vertices'],
        indices: null,
        indexCount: 2,
        type: 'point-list',
        boxMin: Vector3.zero(),
        boxMax: Vector3.zero()
      },
      material: null,
      rawPositions: new Float32Array(6),
      rawBlendIndices: new Uint16Array([0, 1, 2, 3, 4, 10, 11, 12, 13, 14]),
      rawJointWeights: new Float32Array([0.4, 0.25, 0.2, 0.1, 0.05, 0.4, 0.25, 0.2, 0.1, 0.05]),
      rawSkinInfluenceCount: 5,
      numTargets: 0
    };

    applyMeshSkinInfluenceData(subMesh, mesh);

    expect(Array.from(mesh.getSkinInfluenceData()!.data.slice(0, 8))).toEqual(
      Array.from(new Float32Array([4, 0.05, 0, 0, 14, 0.05, 0, 0]))
    );
    scene.dispose();
  });
});
