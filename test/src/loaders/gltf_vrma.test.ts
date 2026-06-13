import { DRef, Vector3 } from '@zephyr3d/base';
import {
  HumanoidBodyRig,
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
  test('creates a humanoid skeleton from VRMC_vrm_animation and retargets its clip', async () => {
    const times = new Float32Array([0, 1]);
    const hipsTranslation = new Float32Array([0, 1, 0, 0, 1.5, 0]);
    const headRotation = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);
    const { buffer, bufferViews } = packFloatAccessors([times, hipsTranslation, headRotation]);
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
          }
        }
      },
      nodes: [
        { name: 'root', children: [1] },
        { name: 'animated_pelvis', translation: [0, 1, 0], children: [2] },
        { name: 'animated_torso', translation: [0, 1, 0], children: [3] },
        { name: 'animated_skull', translation: [0, 1, 0] }
      ],
      scenes: [{ nodes: [0] }],
      scene: 0,
      bufferViews,
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC4' }
      ],
      animations: [
        {
          name: 'walk',
          samplers: [
            { input: 0, output: 1, interpolation: 'LINEAR' },
            { input: 0, output: 2, interpolation: 'LINEAR' }
          ],
          channels: [
            { sampler: 0, target: { node: 1, path: 'translation' } },
            { sampler: 1, target: { node: 3, path: 'rotation' } },
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
    expect(sharedModel.animations[0].tracks).toHaveLength(2);

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
  });
});
