import { MemoryFS, Vector3, uint8ArrayToBase64 } from '@zephyr3d/base';
import {
  AssetHierarchyNode,
  BoundingBox,
  Mesh,
  ResourceManager,
  Scene,
  SceneNode,
  SharedModel,
  setSceneMeshAssetBinding,
  type AssetMeshData,
  type AssetSubMeshData
} from '../../../libs/scene/src';
import { MAX_MORPH_ATTRIBUTES, MAX_MORPH_TARGETS } from '../../../libs/scene/src/values';

let mockResourceManager: ResourceManager | null = null;

jest.mock('../../../libs/scene/src/app/api', () => ({
  getDevice: jest.fn(() => ({
    type: 'webgpu',
    frameInfo: {
      frameCounter: 0,
      elapsedFrame: 16.6667,
      elapsedOverall: 16.6667
    },
    getDeviceCaps: jest.fn(() => ({
      textureCaps: {
        maxTextureSize: 4096
      }
    })),
    createTexture2D: jest.fn(() => ({
      update: jest.fn(),
      dispose: jest.fn()
    })),
    createStructuredBuffer: jest.fn(() => ({
      bufferSubData: jest.fn((_dstOffset, data, srcOffset, srcLength) => {
        const offset = Number(srcOffset) || 0;
        const length = Number(srcLength) || data.length - offset;
        if (offset + length > data.length) {
          throw new Error('bufferSubData() failed: source buffer is too small');
        }
      }),
      dispose: jest.fn()
    }))
  })),
  getEngine: jest.fn(() => ({
    resourceManager: mockResourceManager
  })),
  tryGetApp: jest.fn(() => null)
}));

function createSubMesh(name: string, numTargets: number): AssetSubMeshData {
  return {
    name,
    primitive: null,
    material: null,
    rawPositions: null,
    rawBlendIndices: null,
    rawJointWeights: null,
    numTargets
  };
}

function createAssetMesh(name: string, morphNames: string[]): AssetMeshData {
  return {
    morphNames,
    subMeshes: [createSubMesh(name, morphNames.length)]
  };
}

function setMorphInfo(mesh: Mesh, names: string[], weights: number[] = []) {
  const data = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
  data[3] = names.length;
  weights.forEach((weight, index) => {
    data[4 + index] = weight;
  });
  const nameMap: Record<string, number> = {};
  names.forEach((name, index) => {
    nameMap[name] = index;
  });
  mesh.setMorphInfo({ data, names: nameMap });
}

function expectBoundingBox(box: BoundingBox | null, min: number[], max: number[]) {
  expect(box).not.toBeNull();
  expect(box!.minPoint.x).toBeCloseTo(min[0]);
  expect(box!.minPoint.y).toBeCloseTo(min[1]);
  expect(box!.minPoint.z).toBeCloseTo(min[2]);
  expect(box!.maxPoint.x).toBeCloseTo(max[0]);
  expect(box!.maxPoint.y).toBeCloseTo(max[1]);
  expect(box!.maxPoint.z).toBeCloseTo(max[2]);
}

describe('morph target groups', () => {
  test('builds SharedModel morph target groups by target name', () => {
    const model = new SharedModel();
    const face = new AssetHierarchyNode('face', model);
    face.mesh = createAssetMesh('face-0', ['smile', 'blink']);
    const mouth = new AssetHierarchyNode('mouth', model);
    mouth.mesh = createAssetMesh('mouth-0', ['smile', 'aa']);

    model.buildMorphTargetGroupsByName();

    expect(model.morphTargetGroups.map((group) => group.name)).toEqual(['smile', 'blink', 'aa']);
    expect(model.getMorphTargetGroup('smile')?.bindings).toHaveLength(2);
  });

  test('limits generated morph target groups to the runtime morph target capacity', () => {
    const model = new SharedModel();
    const assetNode = new AssetHierarchyNode('face', model);
    assetNode.mesh = createAssetMesh(
      'face-0',
      Array.from({ length: MAX_MORPH_TARGETS + 4 }, (_, index) => `Target${index}`)
    );

    model.buildMorphTargetGroupsByName();

    expect(model.morphTargetGroups).toHaveLength(MAX_MORPH_TARGETS);
    expect(model.getMorphTargetGroup(`Target${MAX_MORPH_TARGETS - 1}`)).not.toBeNull();
    expect(model.getMorphTargetGroup(`Target${MAX_MORPH_TARGETS}`)).toBeNull();
  });

  test('initializes runtime group weight from mesh morph weights', () => {
    const model = new SharedModel();
    const assetNode = new AssetHierarchyNode('face', model);
    const assetMesh = createAssetMesh('face-0', ['smile']);
    assetNode.mesh = assetMesh;
    model.buildMorphTargetGroupsByName();

    const scene = new Scene();
    const root = new SceneNode(scene);
    const faceMesh = new Mesh(scene);
    faceMesh.parent = root;
    setMorphInfo(faceMesh, ['smile'], [0.5]);

    (model as any).createMorphTargetGroups(root, new Map([[assetMesh.subMeshes[0], faceMesh]]));

    expect(root.getMorphTargetGroupWeight('smile')).toBe(0.5);
    expect(root.getSerializedMorphTargetGroups()).toEqual([
      {
        name: 'smile',
        isBinary: undefined,
        weight: 0.5,
        bindings: [
          {
            meshId: faceMesh.persistentId,
            targetIndex: 0,
            targetName: 'smile',
            weight: 1
          }
        ]
      }
    ]);
  });

  test('applies morph target group only to matching asset mesh bindings', () => {
    const model = new SharedModel();
    const assetNode = new AssetHierarchyNode('face', model);
    const assetMesh = createAssetMesh('face-0', ['smile']);
    assetNode.mesh = assetMesh;
    model.buildMorphTargetGroupsByName();

    const scene = new Scene();
    const root = new SceneNode(scene);
    root.sharedModel = model;

    const faceMesh = new Mesh(scene);
    faceMesh.parent = root;
    setMorphInfo(faceMesh, ['smile']);
    setSceneMeshAssetBinding(faceMesh, {
      node: assetNode,
      mesh: assetMesh,
      subMesh: assetMesh.subMeshes[0]
    });

    const unrelatedMesh = new Mesh(scene);
    unrelatedMesh.parent = root;
    setMorphInfo(unrelatedMesh, ['smile']);

    root.setMorphTargetGroupWeight('smile', 0.75);

    expect(faceMesh.getMorphWeight('smile')).toBe(0.75);
    expect(unrelatedMesh.getMorphWeight('smile')).toBe(0);
  });

  test('serializes and restores runtime morph target groups', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const faceMesh = new Mesh(scene);
    faceMesh.parent = root;
    setMorphInfo(faceMesh, ['smile']);
    root.morphTargetGroups = [
      {
        name: 'happy',
        weight: 0.5,
        bindings: [
          {
            mesh: faceMesh,
            targetIndex: 0,
            targetName: 'smile',
            weight: 1
          }
        ]
      }
    ];

    const serialized = root.getSerializedMorphTargetGroups();
    expect(serialized).toEqual([
      {
        name: 'happy',
        isBinary: undefined,
        weight: 0.5,
        bindings: [
          {
            meshId: faceMesh.persistentId,
            targetIndex: 0,
            targetName: 'smile',
            weight: 1
          }
        ]
      }
    ]);

    const restoredRoot = new SceneNode(scene);
    const restoredFaceMesh = new Mesh(scene);
    restoredFaceMesh.persistentId = faceMesh.persistentId;
    restoredFaceMesh.parent = restoredRoot;
    setMorphInfo(restoredFaceMesh, ['smile']);

    restoredRoot.setSerializedMorphTargetGroups(serialized);
    expect(restoredRoot.collectMorphTargetGroupNames()).toEqual(['happy']);
    expect(restoredFaceMesh.getMorphWeight('smile')).toBe(0.5);

    restoredRoot.setMorphTargetGroupWeight('happy', 0.25);
    expect(restoredRoot.getMorphTargetGroupWeight('happy')).toBe(0.25);
    expect(restoredFaceMesh.getMorphWeight('smile')).toBe(0.25);
  });

  test('round-trips morph target groups through SceneNode serialization', async () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    root.remove();
    const faceMesh = new Mesh(scene);
    faceMesh.parent = root;
    setMorphInfo(faceMesh, ['smile']);
    root.morphTargetGroups = [
      {
        name: 'happy',
        weight: 0.5,
        bindings: [
          {
            mesh: faceMesh,
            targetIndex: 0,
            targetName: 'smile',
            weight: 1
          }
        ]
      }
    ];

    const manager = new ResourceManager(new MemoryFS());
    mockResourceManager = manager;
    const serialized = await manager.serializeObject(root);
    const restored = (await manager.deserializeObject<SceneNode>(new SceneNode(scene), serialized))!;
    const restoredMesh = restored.children[0] as Mesh;

    expect(restored.collectMorphTargetGroupNames()).toEqual(['happy']);
    expect(restored.getMorphTargetGroupWeight('happy')).toBe(0.5);
    expect(restoredMesh.getMorphWeight('smile')).toBe(0.5);

    restored.setMorphTargetGroupWeight('happy', 0.25);
    expect(restoredMesh.getMorphWeight('smile')).toBe(0.25);
  });

  test('updates serialized morph bounding info after weight changes', async () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    root.remove();
    const faceMesh = new Mesh(scene);
    faceMesh.parent = root;
    setMorphInfo(faceMesh, ['smile'], [0.5]);
    faceMesh.setMorphBoundingInfo({
      originBox: new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1)),
      targetBoxes: [new BoundingBox(new Vector3(-1, -2, -3), new Vector3(2, 3, 4))]
    });
    expectBoundingBox(faceMesh.getAnimatedBoundingBox(), [-0.5, -1, -1.5], [2, 2.5, 3]);

    const manager = new ResourceManager(new MemoryFS());
    mockResourceManager = manager;
    const serialized = await manager.serializeObject(root);
    const restored = (await manager.deserializeObject<SceneNode>(new SceneNode(scene), serialized))!;
    const restoredMesh = restored.children[0] as Mesh;

    expectBoundingBox(restoredMesh.getAnimatedBoundingBox(), [-0.5, -1, -1.5], [2, 2.5, 3]);

    restoredMesh.setMorphWeight('smile', 1);
    expectBoundingBox(restoredMesh.getAnimatedBoundingBox(), [-1, -2, -3], [3, 4, 5]);
  });

  test('restores morph data from source GLB reference without inlining MorphData', async () => {
    const manager = new ResourceManager(new MemoryFS());
    mockResourceManager = manager;

    const sourceModel = new SharedModel();
    const sourceNode = new AssetHierarchyNode('face', sourceModel);
    sourceNode.mesh = {
      morphNames: ['smile'],
      subMeshes: [
        {
          name: 'face-0',
          primitive: {
            name: 'face-0',
            vertices: {
              position: {
                format: 'position_f32x3',
                data: new Float32Array([0, 0, 0])
              }
            } as any,
            indices: null,
            indexCount: 1,
            type: 'point-list',
            boxMin: new Vector3(0, 0, 0),
            boxMax: new Vector3(0, 0, 0)
          },
          material: null,
          rawPositions: null,
          rawBlendIndices: null,
          rawJointWeights: null,
          numTargets: 1,
          targets: {
            0: {
              numComponents: 3,
              data: [new Float32Array([1, 2, 3])]
            }
          }
        }
      ]
    };
    const fetchModelDataSpy = jest.spyOn(manager.assetManager, 'fetchModelData').mockResolvedValue(sourceModel);

    const scene = new Scene();
    const mesh = new Mesh(scene);
    setMorphInfo(mesh, ['smile'], [0.5]);
    mesh.setMorphBoundingInfo({
      originBox: new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1)),
      targetBoxes: [new BoundingBox(new Vector3(-1, -1, -1), new Vector3(2, 2, 2))]
    });
    mesh.setMorphSource({
      sourcePath: '/assets/test/head.glb',
      nodePath: 'face',
      subMeshName: 'face-0'
    });

    const serialized = await manager.serializeObject(mesh);
    expect((serialized.Object as Record<string, unknown>).MorphData).toBe('');
    expect((serialized.Object as Record<string, unknown>).MorphSource).toBe(
      '{"sourcePath":"/assets/test/head.glb","nodePath":"face","subMeshName":"face-0"}'
    );

    const restored = new Mesh(scene);
    await manager.deserializeObjectProps(restored, serialized.Object as Record<string, unknown>);

    expect(fetchModelDataSpy).toHaveBeenCalledWith('/assets/test/head.glb');
    expect(restored.getMorphSource()).toEqual({
      sourcePath: '/assets/test/head.glb',
      nodePath: 'face',
      subMeshName: 'face-0'
    });
    expect(restored.getMorphData()).not.toBeNull();
    expect(restored.getMorphData()!.width).toBe(1);
    expect(Array.from(restored.getMorphData()!.data.slice(0, 3))).toEqual([1, 2, 3]);
  });

  test('resolves morph source by node path and sub-mesh name', async () => {
    const manager = new ResourceManager(new MemoryFS());
    mockResourceManager = manager;

    const sourceModel = new SharedModel();
    const root = new AssetHierarchyNode('root', sourceModel);
    const wrong = new AssetHierarchyNode('wrong', sourceModel, root);
    wrong.mesh = {
      morphNames: ['frown'],
      subMeshes: [
        {
          name: 'face-0',
          primitive: {
            name: 'face-0',
            vertices: {
              position: {
                format: 'position_f32x3',
                data: new Float32Array([0, 0, 0])
              }
            } as any,
            indices: null,
            indexCount: 1,
            type: 'point-list',
            boxMin: new Vector3(0, 0, 0),
            boxMax: new Vector3(0, 0, 0)
          },
          material: null,
          rawPositions: null,
          rawBlendIndices: null,
          rawJointWeights: null,
          numTargets: 1,
          targets: {
            0: {
              numComponents: 3,
              data: [new Float32Array([9, 9, 9])]
            }
          },
          targetBox: [new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1))]
        }
      ]
    };
    const face = new AssetHierarchyNode('face', sourceModel, root);
    face.mesh = {
      morphNames: ['smile'],
      subMeshes: [
        {
          name: 'other',
          primitive: {
            name: 'other',
            vertices: {
              position: {
                format: 'position_f32x3',
                data: new Float32Array([0, 0, 0])
              }
            } as any,
            indices: null,
            indexCount: 1,
            type: 'point-list',
            boxMin: new Vector3(0, 0, 0),
            boxMax: new Vector3(0, 0, 0)
          },
          material: null,
          rawPositions: null,
          rawBlendIndices: null,
          rawJointWeights: null,
          numTargets: 1,
          targets: {
            0: {
              numComponents: 3,
              data: [new Float32Array([4, 5, 6])]
            }
          },
          targetBox: [new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1))]
        },
        {
          name: 'face-0',
          primitive: {
            name: 'face-0',
            vertices: {
              position: {
                format: 'position_f32x3',
                data: new Float32Array([0, 0, 0])
              }
            } as any,
            indices: null,
            indexCount: 1,
            type: 'point-list',
            boxMin: new Vector3(0, 0, 0),
            boxMax: new Vector3(0, 0, 0)
          },
          material: null,
          rawPositions: null,
          rawBlendIndices: null,
          rawJointWeights: null,
          numTargets: 1,
          targets: {
            0: {
              numComponents: 3,
              data: [new Float32Array([1, 2, 3])]
            }
          },
          targetBox: [new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1))]
        }
      ]
    };
    const fetchModelDataSpy = jest.spyOn(manager.assetManager, 'fetchModelData').mockResolvedValue(sourceModel);

    const scene = new Scene();
    const template = new Mesh(scene);
    setMorphInfo(template, ['placeholder']);
    template.setMorphBoundingInfo({
      originBox: new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1)),
      targetBoxes: [new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1))]
    });
    const serialized = await manager.serializeObject(template);
    const objectProps = serialized.Object as Record<string, unknown>;
    objectProps.MorphData = '';
    objectProps.MorphSource =
      '{"sourcePath":"/assets/test/head.glb","nodePath":"root/face","subMeshName":"face-0"}';

    const restored = new Mesh(scene);
    await manager.deserializeObjectProps(restored, objectProps);

    expect(fetchModelDataSpy).toHaveBeenCalledWith('/assets/test/head.glb');
    expect(restored.getMorphSource()).toEqual({
      sourcePath: '/assets/test/head.glb',
      nodePath: 'root/face',
      subMeshName: 'face-0'
    });
    expect(restored.getMorphSourceData()).not.toBeNull();
    expect(restored.getMorphSourceData()!.numTargets).toBe(1);
    expect(Array.from(restored.getMorphSourceData()!.targets[0]!.data[0])).toEqual([1, 2, 3]);
  });

  test('clamps oversized serialized morph info when restoring source GLB references', async () => {
    const manager = new ResourceManager(new MemoryFS());
    mockResourceManager = manager;

    const totalTargets = MAX_MORPH_TARGETS + 2;
    const morphNames = Array.from({ length: totalTargets }, (_, index) => `Target${index}`);
    const targetData = morphNames.map((_, index) => new Float32Array([index + 1, 0, 0]));
    const sourceModel = new SharedModel();
    const sourceNode = new AssetHierarchyNode('face', sourceModel);
    sourceNode.mesh = {
      morphNames,
      subMeshes: [
        {
          name: 'face-0',
          primitive: {
            name: 'face-0',
            vertices: {
              position: {
                format: 'position_f32x3',
                data: new Float32Array([0, 0, 0])
              }
            } as any,
            indices: null,
            indexCount: 1,
            type: 'point-list',
            boxMin: new Vector3(0, 0, 0),
            boxMax: new Vector3(0, 0, 0)
          },
          material: null,
          rawPositions: null,
          rawBlendIndices: null,
          rawJointWeights: null,
          numTargets: totalTargets,
          targets: {
            0: {
              numComponents: 3,
              data: targetData
            }
          },
          targetBox: [new BoundingBox(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))]
        }
      ]
    };
    const fetchModelDataSpy = jest.spyOn(manager.assetManager, 'fetchModelData').mockResolvedValue(sourceModel);

    const oversizedMorphInfo = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
    oversizedMorphInfo[0] = 1;
    oversizedMorphInfo[1] = 1;
    oversizedMorphInfo[2] = 1;
    oversizedMorphInfo[3] = totalTargets;
    oversizedMorphInfo[4 + MAX_MORPH_TARGETS] = 0;
    for (let i = 1; i < MAX_MORPH_ATTRIBUTES; i++) {
      oversizedMorphInfo[4 + MAX_MORPH_TARGETS + i] = -1;
    }
    const nameMap: Record<string, number> = {};
    morphNames.forEach((name, index) => {
      nameMap[name] = index;
    });

    const scene = new Scene();
    const restored = new Mesh(scene);
    await manager.deserializeObjectProps(restored, {
      MorphData: '',
      MorphSource: '{"sourcePath":"/assets/test/head.glb","nodePath":"face","subMeshName":"face-0"}',
      MorphInfo: JSON.stringify({
        data: uint8ArrayToBase64(new Uint8Array(oversizedMorphInfo.buffer)),
        names: nameMap
      }),
      MorphBoundingInfo: JSON.stringify({
        originBox: [0, 0, 0, 1, 1, 1],
        targetBoxes: [[-1, -1, -1, 1, 1, 1]]
      })
    });

    expect(fetchModelDataSpy).toHaveBeenCalledWith('/assets/test/head.glb');
    expect(restored.getMorphData()).not.toBeNull();
    expect(restored.getNumMorphTargets()).toBe(MAX_MORPH_TARGETS);
    expect(restored.getMorphTargetName(MAX_MORPH_TARGETS - 1)).toBe(`Target${MAX_MORPH_TARGETS - 1}`);
    expect(restored.getMorphTargetIndexByName(`Target${MAX_MORPH_TARGETS}`)).toBe(-1);

    restored.setMorphWeightByIndex(MAX_MORPH_TARGETS - 1, 0.5);
    expect(() => restored.update(1, 0, 0)).not.toThrow();
  });

  test('does not queue morph updates when Float32 weights are unchanged', () => {
    const scene = new Scene();
    const mesh = new Mesh(scene);
    setMorphInfo(mesh, ['smile'], [0.1]);
    const queueUpdateNode = jest.spyOn(scene, 'queueUpdateNode');

    mesh.updateMorphWeights([0.1]);
    mesh.setMorphWeightByIndex(0, 0.1);

    expect(queueUpdateNode).not.toHaveBeenCalled();

    mesh.updateMorphWeights([0.2]);
    expect(queueUpdateNode).toHaveBeenCalledTimes(1);
  });

  test('keeps the full morph texture stable when the active target set changes', () => {
    const scene = new Scene();
    const mesh = new Mesh(scene);
    setMorphInfo(mesh, ['smile', 'blink'], [0.5, 0]);
    mesh.setMorphSourceData({
      numTargets: 2,
      numVertices: 1,
      targets: {
        0: {
          numComponents: 3,
          data: [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])]
        }
      }
    });

    const morphData = mesh.getMorphData()!;
    const morphTexture = morphData.texture!.get() as any;
    expect(Array.from(morphData.data.slice(0, 8))).toEqual([1, 2, 3, 0, 4, 5, 6, 0]);
    expect(morphTexture.update).toHaveBeenCalledTimes(1);

    mesh.updateMorphWeights([0, 0.75]);
    mesh.update(1, 0, 0);

    expect(mesh.getMorphData()).toBe(morphData);
    expect(mesh.getMorphData()!.texture!.get()).toBe(morphTexture);
    expect(morphTexture.update).toHaveBeenCalledTimes(1);
    const renderInfo = mesh.getRenderMorphInfo()!;
    expect(renderInfo.data[3]).toBe(1);
    expect(renderInfo.data[4]).toBe(0.75);
    expect(renderInfo.data[4 + MAX_MORPH_TARGETS]).toBe(1);
    expect(renderInfo.data[4 + MAX_MORPH_TARGETS * 2]).toBe(0);
  });

  test('keeps combined animated bounds stable when skinning and morphing are both active', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const mesh = new Mesh(scene);
    mesh.parent = root;
    setMorphInfo(mesh, ['smile'], [0.5]);
    mesh.setMorphBoundingInfo({
      originBox: new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1)),
      targetBoxes: [new BoundingBox(new Vector3(-1, -2, -3), new Vector3(2, 3, 4))]
    });
    mesh.setBoneMatrices({ dispose() {} } as any);
    mesh.setSkinnedBoundingInfo({
      boundingVertices: [],
      boundingVertexBlendIndices: new Float32Array(24),
      boundingVertexJointWeights: new Float32Array(24),
      boundingBox: new BoundingBox(new Vector3(10, 10, 10), new Vector3(11, 11, 11))
    });
    (mesh as any).refreshAnimatedBoundingBox();

    expectBoundingBox(mesh.getAnimatedBoundingBox(), [-0.5, -1, -1.5], [11, 11, 11]);
  });
});
