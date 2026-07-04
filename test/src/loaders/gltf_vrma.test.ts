import { DRef, Vector3 } from '@zephyr3d/base';
import {
  HumanoidBodyRig,
  MorphTargetGroupTrack,
  NodeTranslationTrack,
  Scene,
  SceneNode,
  SharedModel,
  SkeletonRig
} from '@zephyr3d/scene';
import { GLTFImporter } from '../../../libs/loaders/src/gltf/gltf_importer';

jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    createTexture2D: (_format: string, width: number, height: number) => ({
      width,
      height,
      update: () => undefined,
      dispose: () => undefined
    })
  }))
}));

function packFloatAccessors(arrays: Float32Array[]) {
  let offset = 0;
  const bufferViews = arrays.map((array) => {
    const view = {
      buffer: 0,
      byteOffset: offset,
      byteLength: array.byteLength
    };
    offset += array.byteLength;
    return view;
  });
  const buffer = new ArrayBuffer(offset);
  arrays.forEach((array, index) => {
    new Float32Array(buffer, bufferViews[index].byteOffset, array.length).set(array);
  });
  return { buffer, bufferViews };
}

function identityMatrices(count: number) {
  const result = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    result[i * 16 + 0] = 1;
    result[i * 16 + 5] = 1;
    result[i * 16 + 10] = 1;
    result[i * 16 + 15] = 1;
  }
  return result;
}

function appendNode(parent: SceneNode, name: string, position?: Vector3) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  if (position) {
    node.position.set(position);
  }
  node.parent = parent;
  return node;
}

function bindPose(nodes: SceneNode[]) {
  return nodes.map((node) => ({
    position: node.position.clone(),
    rotation: node.rotation.clone(),
    scale: node.scale.clone()
  }));
}

describe('GLTFImporter VRMA support', () => {
  test('uses VRM 0 humanoid extension mapping for skeletons', async () => {
    const { buffer, bufferViews } = packFloatAccessors([identityMatrices(3)]);
    const gltf = {
      asset: { version: '2.0' },
      extensionsUsed: ['VRM'],
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: 'hips', node: 1 },
              { bone: 'spine', node: 2 },
              { bone: 'head', node: 3 }
            ]
          }
        }
      },
      nodes: [
        { name: 'root', children: [1] },
        { name: 'not_named_like_hips', children: [2] },
        { name: 'not_named_like_spine', children: [3] },
        { name: 'not_named_like_head' }
      ],
      skins: [{ name: 'humanoidSkin', joints: [1, 2, 3], inverseBindMatrices: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
      bufferViews,
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'MAT4' }],
      _loadedBuffers: [buffer]
    };
    const importer = new GLTFImporter();
    const sharedModel = new SharedModel();
    await importer.loadJson(gltf as any, sharedModel, '', {} as any);

    expect(sharedModel.skeletons).toHaveLength(1);
    expect((sharedModel.skeletons[0] as any).humanoidJointMapping.body[HumanoidBodyRig.Hips]).toBe(
      sharedModel.nodes[1]
    );
    expect((sharedModel.skeletons[0] as any).humanoidJointMapping.body[HumanoidBodyRig.Spine]).toBe(
      sharedModel.nodes[2]
    );
    expect((sharedModel.skeletons[0] as any).humanoidJointMapping.body[HumanoidBodyRig.Head]).toBe(
      sharedModel.nodes[3]
    );
  });

  test('keeps VRM 0 partial humanoid mappings on split skins', async () => {
    const { buffer, bufferViews } = packFloatAccessors([identityMatrices(2), identityMatrices(2)]);
    const gltf = {
      asset: { version: '2.0' },
      extensionsUsed: ['VRM'],
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: 'hips', node: 1 },
              { bone: 'head', node: 2 },
              { bone: 'leftFoot', node: 3 },
              { bone: 'leftToes', node: 4 }
            ]
          }
        }
      },
      nodes: [
        { name: 'root', children: [1, 3] },
        { name: 'pelvis', children: [2] },
        { name: 'skull' },
        { name: 'foot', children: [4] },
        { name: 'toe' }
      ],
      skins: [
        { name: 'bodySkin', joints: [1, 2], inverseBindMatrices: 0 },
        { name: 'toeSkin', joints: [3, 4], inverseBindMatrices: 1 }
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
      bufferViews,
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'MAT4' },
        { bufferView: 1, componentType: 5126, count: 2, type: 'MAT4' }
      ],
      _loadedBuffers: [buffer]
    };
    const importer = new GLTFImporter();
    const sharedModel = new SharedModel();
    await importer.loadJson(gltf as any, sharedModel, '', {} as any);

    expect(sharedModel.skeletons).toHaveLength(2);
    const toeMapping = (sharedModel.skeletons[1] as any).humanoidJointMapping;
    expect(toeMapping.body[HumanoidBodyRig.Hips]).toBeUndefined();
    expect(toeMapping.body[HumanoidBodyRig.LeftFoot]).toBe(sharedModel.nodes[3]);
    expect(toeMapping.body[HumanoidBodyRig.LeftToes]).toBe(sharedModel.nodes[4]);
  });

  test('creates a humanoid skeleton from VRMC_vrm_animation and retargets its clip', async () => {
    const times = new Float32Array([0, 1]);
    const hipsTranslation = new Float32Array([0, 1, 0, 0, 1.5, 0]);
    const headRotation = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);
    const happyExpressionTranslation = new Float32Array([-0.5, 0, 0, 1.2, 0, 0]);
    const { buffer, bufferViews } = packFloatAccessors([
      times,
      hipsTranslation,
      headRotation,
      happyExpressionTranslation
    ]);
    const gltf = {
      asset: { version: '2.0' },
      extensionsUsed: ['VRMC_vrm_animation'],
      extensions: {
        VRMC_vrm_animation: {
          specVersion: '1.0',
          humanoid: {
            humanBones: {
              hips: { node: 1 },
              spine: { node: 2 },
              head: { node: 3 }
            }
          },
          expressions: {
            preset: {
              happy: { node: 4 }
            }
          }
        }
      },
      nodes: [
        { name: 'root', children: [1, 4] },
        { name: 'animated_pelvis', translation: [0, 1, 0], children: [2] },
        { name: 'animated_torso', translation: [0, 1, 0], children: [3] },
        { name: 'animated_skull', translation: [0, 1, 0] },
        { name: 'happy_expression', translation: [0, 0, 0] }
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
      bufferViews,
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC4' },
        { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' }
      ],
      animations: [
        {
          name: 'walk',
          samplers: [
            { input: 0, output: 1, interpolation: 'LINEAR' },
            { input: 0, output: 2, interpolation: 'LINEAR' },
            { input: 0, output: 3, interpolation: 'LINEAR' }
          ],
          channels: [
            { sampler: 0, target: { node: 1, path: 'translation' } },
            { sampler: 1, target: { node: 3, path: 'rotation' } },
            { sampler: 2, target: { node: 4, path: 'translation' } },
            { sampler: 0, target: { path: 'translation' } }
          ]
        }
      ],
      _loadedBuffers: [buffer]
    };
    const importer = new GLTFImporter();
    const sharedModel = new SharedModel();
    await importer.loadJson(gltf as any, sharedModel, '', {} as any);

    expect(sharedModel.skeletons).toHaveLength(1);
    expect((sharedModel.skeletons[0] as any).humanoidJointMapping.body[HumanoidBodyRig.Hips]).toBe(
      sharedModel.nodes[1]
    );
    expect(sharedModel.animations[0].skeletons).toContain(sharedModel.skeletons[0]);
    expect(sharedModel.animations[0].tracks).toHaveLength(3);
    expect(
      sharedModel.animations[0].tracks.some(
        (track: any) => track.type === 'morph-target-group' && track.morphTargetGroupName === 'happy'
      )
    ).toBe(true);

    const scene = new Scene();
    const sourceRoot = await sharedModel.createSceneNode(
      {} as any,
      scene,
      false,
      false,
      true,
      true,
      false,
      {} as any
    );
    const targetRoot = new SceneNode(scene);
    const targetHips = appendNode(targetRoot, 'targetHips', new Vector3(0, 1, 0));
    const targetSpine = appendNode(targetHips, 'targetSpine', new Vector3(0, 1, 0));
    const targetHead = appendNode(targetSpine, 'targetHead', new Vector3(0, 1, 0));
    const targetRig = new SkeletonRig(
      [targetHips, targetSpine, targetHead],
      bindPose([targetHips, targetSpine, targetHead]),
      { rootJoint: targetHips }
    );
    (targetRig as any)._humanoidJointMapping = {
      body: {
        [HumanoidBodyRig.Hips]: targetHips,
        [HumanoidBodyRig.Spine]: targetSpine,
        [HumanoidBodyRig.Head]: targetHead
      } as any
    };
    targetRoot.animationSet.rigs.push(new DRef(targetRig));

    const copied = targetRoot.animationSet.copyHumanoidAnimationFrom(sourceRoot.animationSet, 'walk');
    expect(copied).not.toBeNull();
    expect(copied!.skeletons.has(targetRig.persistentId)).toBe(true);
    expect(copied!.tracks.get(targetHips)?.some((track) => track instanceof NodeTranslationTrack)).toBe(true);
    expect(copied!.tracks.get(targetRoot)?.some((track) => track instanceof MorphTargetGroupTrack)).toBe(
      true
    );

    const appliedExpressionWeights: number[] = [];
    const originalSetMorphTargetGroupWeight = targetRoot.setMorphTargetGroupWeight.bind(targetRoot);
    (targetRoot as any).setMorphTargetGroupWeight = (name: string, weight: number) => {
      if (name === 'happy') {
        appliedExpressionWeights.push(weight);
      }
      originalSetMorphTargetGroupWeight(name, weight);
    };
    const playback = targetRoot.animationSet.play('walk');
    expect(playback).not.toBeNull();
    playback!.seek(1, { apply: true });
    expect(appliedExpressionWeights[appliedExpressionWeights.length - 1]).toBe(1);
  });
});
