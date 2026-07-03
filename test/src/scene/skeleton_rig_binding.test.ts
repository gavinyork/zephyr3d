import { DRef, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { AnimationSet } from '@zephyr3d/scene';
import {
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack,
  Scene,
  SceneNode,
  SkeletonModifier,
  SkeletonRig,
  SkinBinding,
  HumanoidBodyRig,
  HumanoidHandRig
} from '@zephyr3d/scene';

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

class CountingModifier extends SkeletonModifier {
  count = 0;
  apply(_skeleton: SkeletonRig, _deltaTime: number): void {
    this.count++;
  }
  reset(): void {}
  protected _getWeight(): number {
    return 1;
  }
  protected _setWeight(_value: number): void {}
}

function appendNode(parent: SceneNode, name: string) {
  const node = new SceneNode(parent.scene);
  node.name = name;
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

function inverseBind(nodes: SceneNode[]) {
  return nodes.map(() => Matrix4x4.identity());
}

type MaskedAnimationSet = AnimationSet & {
  createSkeletalMaskedAnimation: (
    sourceName: string,
    targetName: string,
    options: {
      type: 'humanoid' | 'joints';
      preset?: string;
      boundary?: HumanoidBodyRig;
      includeBody?: HumanoidBodyRig[];
      include?: (string | RegExp | ((joint: SceneNode) => boolean))[];
      exclude?: (string | RegExp | ((joint: SceneNode) => boolean))[];
      includeDescendants?: boolean;
      rootMotion?: 'include' | 'exclude' | 'only';
    }
  ) => ReturnType<AnimationSet['getAnimationClip']>;
};

function getMaskedAnimationSet(node: SceneNode): MaskedAnimationSet {
  return node.animationSet as MaskedAnimationSet;
}

function buildHumanoid(parent: SceneNode, prefix: string) {
  const hips = appendNode(parent, `${prefix}Hips`);
  const spine = appendNode(hips, `${prefix}Spine`);
  const chest = appendNode(spine, `${prefix}Chest`);
  const upperChest = appendNode(chest, `${prefix}UpperChest`);
  const neck = appendNode(upperChest, `${prefix}Neck`);
  const head = appendNode(neck, `${prefix}Head`);
  const leftShoulder = appendNode(upperChest, `${prefix}LeftShoulder`);
  const leftUpperArm = appendNode(leftShoulder, `${prefix}LeftUpperArm`);
  const leftLowerArm = appendNode(leftUpperArm, `${prefix}LeftLowerArm`);
  const leftHand = appendNode(leftLowerArm, `${prefix}LeftHand`);
  const rightShoulder = appendNode(upperChest, `${prefix}RightShoulder`);
  const rightUpperArm = appendNode(rightShoulder, `${prefix}RightUpperArm`);
  const rightLowerArm = appendNode(rightUpperArm, `${prefix}RightLowerArm`);
  const rightHand = appendNode(rightLowerArm, `${prefix}RightHand`);
  const leftUpperLeg = appendNode(hips, `${prefix}LeftUpperLeg`);
  const leftLowerLeg = appendNode(leftUpperLeg, `${prefix}LeftLowerLeg`);
  const leftFoot = appendNode(leftLowerLeg, `${prefix}LeftFoot`);
  const leftToes = appendNode(leftFoot, `${prefix}LeftToes`);
  const rightUpperLeg = appendNode(hips, `${prefix}RightUpperLeg`);
  const rightLowerLeg = appendNode(rightUpperLeg, `${prefix}RightLowerLeg`);
  const rightFoot = appendNode(rightLowerLeg, `${prefix}RightFoot`);
  const rightToes = appendNode(rightFoot, `${prefix}RightToes`);
  return [
    hips,
    spine,
    chest,
    upperChest,
    neck,
    head,
    leftShoulder,
    leftUpperArm,
    leftLowerArm,
    leftHand,
    rightShoulder,
    rightUpperArm,
    rightLowerArm,
    rightHand,
    leftUpperLeg,
    leftLowerLeg,
    leftFoot,
    leftToes,
    rightUpperLeg,
    rightLowerLeg,
    rightFoot,
    rightToes
  ];
}

function humanoidBodyMapping(joints: SceneNode[]) {
  return {
    [HumanoidBodyRig.Hips]: joints[0],
    [HumanoidBodyRig.Spine]: joints[1],
    [HumanoidBodyRig.Chest]: joints[2],
    [HumanoidBodyRig.UpperChest]: joints[3],
    [HumanoidBodyRig.Neck]: joints[4],
    [HumanoidBodyRig.Head]: joints[5],
    [HumanoidBodyRig.LeftShoulder]: joints[6],
    [HumanoidBodyRig.LeftUpperArm]: joints[7],
    [HumanoidBodyRig.LeftLowerArm]: joints[8],
    [HumanoidBodyRig.LeftHand]: joints[9],
    [HumanoidBodyRig.RightShoulder]: joints[10],
    [HumanoidBodyRig.RightUpperArm]: joints[11],
    [HumanoidBodyRig.RightLowerArm]: joints[12],
    [HumanoidBodyRig.RightHand]: joints[13],
    [HumanoidBodyRig.LeftUpperLeg]: joints[14],
    [HumanoidBodyRig.LeftLowerLeg]: joints[15],
    [HumanoidBodyRig.LeftFoot]: joints[16],
    [HumanoidBodyRig.LeftToes]: joints[17],
    [HumanoidBodyRig.RightUpperLeg]: joints[18],
    [HumanoidBodyRig.RightLowerLeg]: joints[19],
    [HumanoidBodyRig.RightFoot]: joints[20],
    [HumanoidBodyRig.RightToes]: joints[21]
  } as Record<HumanoidBodyRig, SceneNode>;
}

function scaleHumanoidLegs(joints: SceneNode[], scale: number) {
  for (const joint of [
    joints[14],
    joints[15],
    joints[16],
    joints[17],
    joints[18],
    joints[19],
    joints[20],
    joints[21]
  ]) {
    joint.position.scaleBy(scale);
  }
}

function setHumanoidLateralBindPose(joints: SceneNode[], mirrored = false, forwardMirrored = false) {
  const left = mirrored ? -1 : 1;
  const right = -left;
  const forward = forwardMirrored ? -1 : 1;
  joints[1].position.setXYZ(0, 0.35, 0);
  joints[2].position.setXYZ(0, 0.3, 0);
  joints[3].position.setXYZ(0, 0.25, 0);
  joints[4].position.setXYZ(0, 0.2, 0);
  joints[5].position.setXYZ(0, 0.2, 0);
  joints[6].position.setXYZ(0.15 * left, 0.05, 0);
  joints[7].position.setXYZ(0.25 * left, 0, 0);
  joints[8].position.setXYZ(0.25 * left, 0, 0);
  joints[9].position.setXYZ(0.15 * left, 0, 0);
  joints[10].position.setXYZ(0.15 * right, 0.05, 0);
  joints[11].position.setXYZ(0.25 * right, 0, 0);
  joints[12].position.setXYZ(0.25 * right, 0, 0);
  joints[13].position.setXYZ(0.15 * right, 0, 0);
  joints[14].position.setXYZ(0.12 * left, -0.1, 0);
  joints[15].position.setXYZ(0, -0.45, 0);
  joints[16].position.setXYZ(0, -0.45, 0);
  joints[17].position.setXYZ(0, -0.05, 0.15 * forward);
  joints[18].position.setXYZ(0.12 * right, -0.1, 0);
  joints[19].position.setXYZ(0, -0.45, 0);
  joints[20].position.setXYZ(0, -0.45, 0);
  joints[21].position.setXYZ(0, -0.05, 0.15 * forward);
}

describe('SkeletonRig and SkinBinding', () => {
  test('updates shared rig modifiers once while preserving multiple skin bindings', () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const root = appendNode(model, 'root');
    const joint = appendNode(root, 'joint');
    joint.position.setXYZ(0, 1, 0);

    const joints = [root, joint];
    const rig = new SkeletonRig(joints, bindPose(joints));
    const bindingA = new SkinBinding(rig, inverseBind(joints));
    const bindingB = new SkinBinding(rig, inverseBind(joints));
    const modifier = new CountingModifier();
    rig.modifiers.push(modifier);
    model.animationSet.rigs.push(new DRef(rig));
    model.animationSet.skeletons.push(new DRef(bindingA), new DRef(bindingB));

    model.animationSet.update(1 / 60);

    expect(modifier.count).toBe(1);
    expect(model.animationSet.rigs).toHaveLength(1);
    expect(model.animationSet.skinBindings).toHaveLength(2);
    expect(bindingA.rig).toBe(rig);
    expect(bindingB.rig).toBe(rig);
    expect(bindingA.jointTexture).toBeTruthy();
    expect(bindingB.jointTexture).toBeTruthy();
  });

  test('preserves wrapped playback overshoot when looping across frame zero', () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const target = appendNode(model, 'target');
    const clip = model.animationSet.createAnimation('move')!;
    clip.addTrack(
      target,
      new NodeTranslationTrack('linear', [
        { time: 0, value: Vector3.zero() },
        { time: 1, value: new Vector3(10, 0, 0) }
      ])
    );

    model.animationSet.playAnimation('move');
    model.animationSet.update(0);
    model.animationSet.update(1.25);
    expect(target.position.x).toBeCloseTo(2.5);

    model.animationSet.stopAnimation('move');
    model.animationSet.playAnimation('move', { speedRatio: -1 });
    model.animationSet.update(0);
    model.animationSet.update(1.25);
    expect(target.position.x).toBeCloseTo(7.5);
  });

  test('retarget accepts legacy clips referencing multiple bindings for one rig', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcRoot = appendNode(srcModel, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    const srcHips = srcJoints[0];
    const srcRig = new SkeletonRig(srcJoints, bindPose(srcJoints));
    const dstRig = new SkeletonRig(dstJoints, bindPose(dstJoints));
    const srcBindingA = new SkinBinding(srcRig, inverseBind(srcJoints));
    const srcBindingB = new SkinBinding(srcRig, inverseBind(srcJoints));
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    srcModel.animationSet.skeletons.push(new DRef(srcBindingA), new DRef(srcBindingB));
    dstModel.animationSet.rigs.push(new DRef(dstRig));

    const srcClip = srcModel.animationSet.createAnimation('idle')!;
    srcClip.addSkeleton(srcBindingA.persistentId);
    srcClip.addSkeleton(srcBindingB.persistentId);
    srcClip.addTrack(
      srcHips,
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
      ])
    );

    const copied = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'idle',
      'idle_copy'
    );

    expect(copied).toBeTruthy();
    expect(copied!.skeletons.has(dstRig.persistentId)).toBe(true);
  });

  test('retarget skips humanoid rigs whose mapped joints are not part of the rig', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcRoot = appendNode(srcModel, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    const srcRig = new SkeletonRig(srcJoints, bindPose(srcJoints));
    const fullDstRig = new SkeletonRig(dstJoints, bindPose(dstJoints));
    const partialDstRig = new SkeletonRig([dstJoints[5]], bindPose([dstJoints[5]]), {
      humanoidJointMapping: fullDstRig.humanoidJointMapping
    });
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    dstModel.animationSet.rigs.push(new DRef(partialDstRig), new DRef(fullDstRig));

    const srcClip = srcModel.animationSet.createAnimation('idle')!;
    srcClip.addSkeleton(srcRig.persistentId);
    srcClip.addTrack(
      srcJoints[0],
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
      ])
    );

    const copied = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'idle',
      'idle_copy'
    );

    expect(copied).toBeTruthy();
    expect(copied!.skeletons.has(fullDstRig.persistentId)).toBe(true);
    expect(copied!.skeletons.has(partialDstRig.persistentId)).toBe(false);
  });

  test('retarget corrects humanoid rotations and root motion when destination axes are inverted', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcMotionRoot = appendNode(srcModel, 'SrcMotionRoot');
    const srcRoot = appendNode(srcMotionRoot, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    setHumanoidLateralBindPose(srcJoints);
    setHumanoidLateralBindPose(dstJoints, true, true);
    const srcRig = new SkeletonRig(srcJoints, bindPose(srcJoints));
    const dstMainJoints = dstJoints.filter((_, index) => index !== 17 && index !== 21);
    const dstToeJoints = [dstJoints[16], dstJoints[17], dstJoints[20], dstJoints[21]];
    const dstRig = new SkeletonRig(dstMainJoints, bindPose(dstMainJoints));
    const dstToeRig = new SkeletonRig(dstToeJoints, bindPose(dstToeJoints), {
      humanoidJointMapping: {
        body: {
          [HumanoidBodyRig.LeftFoot]: dstJoints[16],
          [HumanoidBodyRig.LeftToes]: dstJoints[17],
          [HumanoidBodyRig.RightFoot]: dstJoints[20],
          [HumanoidBodyRig.RightToes]: dstJoints[21]
        } as any
      }
    });
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    dstModel.animationSet.rigs.push(new DRef(dstRig), new DRef(dstToeRig));

    const srcClip = srcModel.animationSet.createAnimation('wide')!;
    srcClip.timeDuration = 1;
    srcClip.addSkeleton(srcRig.persistentId);
    srcClip.addTrack(
      srcMotionRoot,
      new NodeTranslationTrack('linear', [
        { time: 0, value: srcMotionRoot.position.clone() },
        { time: 1, value: srcMotionRoot.position.clone().addBy(new Vector3(0, 0, 1)) }
      ])
    );
    srcClip.addTrack(
      srcJoints[14],
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 4) }
      ])
    );
    srcClip.addTrack(
      srcJoints[18],
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPZ(), -Math.PI / 4) }
      ])
    );
    srcClip.addTrack(
      srcJoints[5],
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
      ])
    );

    const copied = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'wide',
      'wide_copy'
    );

    expect(copied).toBeTruthy();
    const getLastRotationZ = (joint: SceneNode) => {
      const track = copied!.tracks.get(joint)!.find((item) => item instanceof NodeRotationTrack);
      expect(track).toBeInstanceOf(NodeRotationTrack);
      const outputs = (track as NodeRotationTrack).interpolator.outputs as Float32Array;
      return outputs[outputs.length - 2];
    };
    expect(getLastRotationZ(dstJoints[14])).toBeLessThan(-0.1);
    expect(getLastRotationZ(dstJoints[18])).toBeGreaterThan(0.1);
    const headTrack = copied!.tracks.get(dstJoints[5])!.find((item) => item instanceof NodeRotationTrack);
    expect(headTrack).toBeInstanceOf(NodeRotationTrack);
    const headOutputs = (headTrack as NodeRotationTrack).interpolator.outputs as Float32Array;
    expect(headOutputs[headOutputs.length - 3]).toBeGreaterThan(0.1);
    const rootTrack = copied!.tracks.get(dstJoints[0])!.find((item) => item instanceof NodeTranslationTrack);
    expect(rootTrack).toBeInstanceOf(NodeTranslationTrack);
    const rootOutputs = (rootTrack as NodeTranslationTrack).interpolator.outputs as Float32Array;
    expect(rootOutputs[rootOutputs.length - 1] - rootOutputs[2]).toBeLessThan(-0.8);
  });

  test('retarget copies finger rotations from split humanoid rigs without hips', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcRoot = appendNode(srcModel, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    const srcIndexProximal = appendNode(srcJoints[9], 'SrcLeftIndexProximal');
    const srcIndexIntermediate = appendNode(srcIndexProximal, 'SrcLeftIndexIntermediate');
    const srcIndexDistal = appendNode(srcIndexIntermediate, 'SrcLeftIndexDistal');
    const dstIndexProximal = appendNode(dstJoints[9], 'DstLeftIndexProximal');
    const dstIndexIntermediate = appendNode(dstIndexProximal, 'DstLeftIndexIntermediate');
    const dstIndexDistal = appendNode(dstIndexIntermediate, 'DstLeftIndexDistal');
    const srcFingerMapping = {
      [HumanoidHandRig.IndexProximal]: srcIndexProximal,
      [HumanoidHandRig.IndexIntermediate]: srcIndexIntermediate,
      [HumanoidHandRig.IndexDistal]: srcIndexDistal
    } as Record<HumanoidHandRig, SceneNode>;
    const dstFingerMapping = {
      [HumanoidHandRig.IndexProximal]: dstIndexProximal,
      [HumanoidHandRig.IndexIntermediate]: dstIndexIntermediate,
      [HumanoidHandRig.IndexDistal]: dstIndexDistal
    } as Record<HumanoidHandRig, SceneNode>;
    const srcRigJoints = [...srcJoints, srcIndexProximal, srcIndexIntermediate, srcIndexDistal];
    const dstFingerJoints = [dstJoints[9], dstIndexProximal, dstIndexIntermediate, dstIndexDistal];
    const srcRig = new SkeletonRig(srcRigJoints, bindPose(srcRigJoints), {
      humanoidJointMapping: {
        body: humanoidBodyMapping(srcJoints),
        leftHand: srcFingerMapping
      }
    });
    const dstBodyRig = new SkeletonRig(dstJoints, bindPose(dstJoints), {
      humanoidJointMapping: {
        body: humanoidBodyMapping(dstJoints)
      }
    });
    const dstFingerRig = new SkeletonRig(dstFingerJoints, bindPose(dstFingerJoints), {
      humanoidJointMapping: {
        body: {} as any,
        leftHand: dstFingerMapping
      }
    });
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    dstModel.animationSet.rigs.push(new DRef(dstBodyRig), new DRef(dstFingerRig));

    const srcClip = srcModel.animationSet.createAnimation('finger')!;
    srcClip.timeDuration = 1;
    srcClip.addSkeleton(srcRig.persistentId);
    srcClip.addTrack(
      srcJoints[9],
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
      ])
    );
    srcClip.addTrack(
      srcIndexProximal,
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPX(), Math.PI / 6) }
      ])
    );

    const copied = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'finger',
      'finger_copy'
    );

    expect(copied).toBeTruthy();
    expect(copied!.skeletons.has(dstBodyRig.persistentId)).toBe(true);
    expect(copied!.skeletons.has(dstFingerRig.persistentId)).toBe(true);
    const fingerTrack = copied!.tracks
      .get(dstIndexProximal)!
      .find((item) => item instanceof NodeRotationTrack);
    expect(fingerTrack).toBeInstanceOf(NodeRotationTrack);
    const fingerOutputs = (fingerTrack as NodeRotationTrack).interpolator.outputs as Float32Array;
    expect(Math.abs(fingerOutputs[fingerOutputs.length - 3])).toBeLessThan(0.05);
    expect(Math.abs(fingerOutputs[fingerOutputs.length - 4])).toBeGreaterThan(0.1);
  });

  test('retarget scales humanoid hips translation by leg length', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcRoot = appendNode(srcModel, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    const srcHips = srcJoints[0];
    const dstHips = dstJoints[0];
    srcHips.position.setXYZ(0, 0, 0);
    dstHips.position.setXYZ(0, 0, 0);
    srcJoints[14].position.setXYZ(0.2, -0.5, 0);
    srcJoints[15].position.setXYZ(0, -0.5, 0);
    srcJoints[16].position.setXYZ(0, -0.1, 0.2);
    srcJoints[17].position.setXYZ(0, 0, 0.2);
    srcJoints[18].position.setXYZ(-0.2, -0.5, 0);
    srcJoints[19].position.setXYZ(0, -0.5, 0);
    srcJoints[20].position.setXYZ(0, -0.1, 0.2);
    srcJoints[21].position.setXYZ(0, 0, 0.2);
    for (let i = 14; i <= 21; i++) {
      dstJoints[i].position.set(srcJoints[i].position);
    }
    scaleHumanoidLegs(dstJoints, 2);
    const srcRig = new SkeletonRig(srcJoints, bindPose(srcJoints));
    const dstRig = new SkeletonRig(dstJoints, bindPose(dstJoints));
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    dstModel.animationSet.rigs.push(new DRef(dstRig));

    const srcClip = srcModel.animationSet.createAnimation('jump')!;
    srcClip.addSkeleton(srcRig.persistentId);
    srcClip.addTrack(
      srcHips,
      new NodeTranslationTrack('linear', [
        { time: 0, value: new Vector3(0, 0, 0) },
        { time: 1, value: new Vector3(0, 0.25, 0) }
      ])
    );

    const copied = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'jump',
      'jump_copy'
    );

    expect(copied).toBeTruthy();
    const dstTrack = copied!.tracks.get(dstHips)!.find((track) => track instanceof NodeTranslationTrack);
    expect(dstTrack).toBeInstanceOf(NodeTranslationTrack);
    const outputs = (dstTrack as NodeTranslationTrack).interpolator.outputs as Float32Array;
    expect(outputs[1]).toBeCloseTo(0);
    expect(outputs[4]).toBeCloseTo(0.5);
  });

  test('retarget handles explicit humanoid root motion modes', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcRoot = appendNode(srcModel, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    srcRoot.position.setXYZ(0, 0.1, 0);
    dstRoot.position.setXYZ(0, 1, 0);
    srcJoints[14].position.setXYZ(0.2, -0.5, 0);
    srcJoints[15].position.setXYZ(0, -0.5, 0);
    srcJoints[16].position.setXYZ(0, -0.1, 0.2);
    srcJoints[17].position.setXYZ(0, 0, 0.2);
    srcJoints[18].position.setXYZ(-0.2, -0.5, 0);
    srcJoints[19].position.setXYZ(0, -0.5, 0);
    srcJoints[20].position.setXYZ(0, -0.1, 0.2);
    srcJoints[21].position.setXYZ(0, 0, 0.2);
    for (let i = 14; i <= 21; i++) {
      dstJoints[i].position.set(srcJoints[i].position);
    }
    scaleHumanoidLegs(dstJoints, 2);

    const srcRig = new SkeletonRig(srcJoints, bindPose(srcJoints), { rootJoint: srcRoot });
    const dstRig = new SkeletonRig(dstJoints, bindPose(dstJoints), { rootJoint: dstRoot });
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    dstModel.animationSet.rigs.push(new DRef(dstRig));

    const srcClip = srcModel.animationSet.createAnimation('walk')!;
    srcClip.addSkeleton(srcRig.persistentId);
    srcClip.addTrack(
      srcRoot,
      new NodeTranslationTrack('linear', [
        { time: 0, value: new Vector3(0, 0.1, 0) },
        { time: 1, value: new Vector3(0, 0.35, 0) }
      ])
    );

    const scaled = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'walk',
      'walk_scaled',
      { rootMotion: 'scaled' }
    );
    expect(scaled).toBeTruthy();
    const scaledTrack = scaled!.tracks.get(dstRoot)!.find((track) => track instanceof NodeTranslationTrack);
    expect(scaledTrack).toBeInstanceOf(NodeTranslationTrack);
    expect(scaledTrack!.target).toBe(dstRoot.persistentId);
    expect(scaledTrack!.jointIndex).toBe(-1);
    const scaledOutputs = (scaledTrack as NodeTranslationTrack).interpolator.outputs as Float32Array;
    expect(scaledOutputs[1]).toBeCloseTo(1);
    expect(scaledOutputs[4]).toBeCloseTo(1.5);

    const locked = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'walk',
      'walk_locked',
      { rootMotion: 'locked' }
    );
    expect(locked).toBeTruthy();
    const lockedTrack = locked!.tracks.get(dstRoot)!.find((track) => track instanceof NodeTranslationTrack);
    expect(lockedTrack).toBeInstanceOf(NodeTranslationTrack);
    const lockedOutputs = (lockedTrack as NodeTranslationTrack).interpolator.outputs as Float32Array;
    expect(lockedOutputs[0]).toBeCloseTo(0);
    expect(lockedOutputs[1]).toBeCloseTo(1);
    expect(lockedOutputs[2]).toBeCloseTo(0);
  });

  test('retarget skips non-root humanoid translations unless explicitly preserved', () => {
    const scene = new Scene();
    const srcModel = appendNode(scene.rootNode, 'srcModel');
    const dstModel = appendNode(scene.rootNode, 'dstModel');
    const srcRoot = appendNode(srcModel, 'SrcRoot');
    const dstRoot = appendNode(dstModel, 'DstRoot');
    const srcJoints = buildHumanoid(srcRoot, 'Src');
    const dstJoints = buildHumanoid(dstRoot, 'Dst');
    const srcLowerLeg = srcJoints[15];
    const dstLowerLeg = dstJoints[15];
    const srcRig = new SkeletonRig(srcJoints, bindPose(srcJoints), { rootJoint: srcRoot });
    const dstRig = new SkeletonRig(dstJoints, bindPose(dstJoints), { rootJoint: dstRoot });
    srcModel.animationSet.rigs.push(new DRef(srcRig));
    dstModel.animationSet.rigs.push(new DRef(dstRig));

    const srcClip = srcModel.animationSet.createAnimation('bend')!;
    srcClip.addSkeleton(srcRig.persistentId);
    srcClip.addTrack(
      srcRoot,
      new NodeTranslationTrack('linear', [
        { time: 0, value: Vector3.zero() },
        { time: 1, value: new Vector3(0, 0.1, 0) }
      ])
    );
    srcClip.addTrack(
      srcLowerLeg,
      new NodeTranslationTrack('linear', [
        { time: 0, value: srcLowerLeg.position.clone() },
        { time: 1, value: srcLowerLeg.position.clone().addBy(new Vector3(0, 0.2, 0)) }
      ])
    );

    const skipped = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'bend',
      'bend_skipped'
    );
    expect(skipped).toBeTruthy();
    expect(skipped!.tracks.get(dstLowerLeg)).toBeUndefined();

    const preserved = dstModel.animationSet.copyHumanoidAnimationFrom(
      srcModel.animationSet as AnimationSet,
      'bend',
      'bend_preserved',
      { jointTranslations: 'preserve' }
    );
    expect(preserved).toBeTruthy();
    const preservedTrack = preserved!.tracks
      .get(dstLowerLeg)!
      .find((track) => track instanceof NodeTranslationTrack);
    expect(preservedTrack).toBeInstanceOf(NodeTranslationTrack);
  });

  test('creates humanoid upper and lower body masked clips from a full body clip', () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const root = appendNode(model, 'Root');
    const joints = buildHumanoid(root, '');
    const rig = new SkeletonRig(joints, bindPose(joints), { rootJoint: root });
    model.animationSet.rigs.push(new DRef(rig));

    const [hips, spine, chest, upperChest, , , , leftUpperArm, , , , , , , leftUpperLeg] = joints;
    const full = model.animationSet.createAnimation('full')!;
    full.addSkeleton(rig.persistentId);
    full.addTrack(
      root,
      new NodeTranslationTrack('linear', [
        { time: 0, value: Vector3.zero() },
        { time: 1, value: new Vector3(0, 0, 1) }
      ])
    );
    for (const joint of [hips, spine, chest, upperChest, leftUpperArm, leftUpperLeg]) {
      full.addTrack(
        joint,
        new NodeRotationTrack('linear', [
          { time: 0, value: Quaternion.identity() },
          { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
        ])
      );
    }

    const animationSet = getMaskedAnimationSet(model);
    const upper = animationSet.createSkeletalMaskedAnimation('full', 'full_upper', {
      type: 'humanoid',
      preset: 'upperBody'
    });
    const lower = animationSet.createSkeletalMaskedAnimation('full', 'full_lower', {
      type: 'humanoid',
      preset: 'lowerBody'
    });

    expect(upper).toBeTruthy();
    expect(lower).toBeTruthy();
    expect(upper!.tracks.has(root)).toBe(false);
    expect(upper!.tracks.has(hips)).toBe(false);
    expect(upper!.tracks.has(spine)).toBe(true);
    expect(upper!.tracks.has(leftUpperArm)).toBe(true);
    expect(upper!.tracks.has(leftUpperLeg)).toBe(false);
    expect(lower!.tracks.has(root)).toBe(true);
    expect(lower!.tracks.has(hips)).toBe(true);
    expect(lower!.tracks.has(spine)).toBe(false);
    expect(lower!.tracks.has(leftUpperArm)).toBe(false);
    expect(lower!.tracks.has(leftUpperLeg)).toBe(true);
  });

  test('plays complementary masked clips without blending unrelated body parts', () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const root = appendNode(model, 'Root');
    const joints = buildHumanoid(root, '');
    const rig = new SkeletonRig(joints, bindPose(joints), { rootJoint: root });
    model.animationSet.rigs.push(new DRef(rig));

    const spine = joints[1];
    const leftUpperLeg = joints[14];
    const full = model.animationSet.createAnimation('full')!;
    full.addSkeleton(rig.persistentId);
    full.addTrack(
      spine,
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 2) }
      ])
    );
    full.addTrack(
      leftUpperLeg,
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPX(), Math.PI / 2) }
      ])
    );

    const animationSet = getMaskedAnimationSet(model);
    animationSet.createSkeletalMaskedAnimation('full', 'upper', {
      type: 'humanoid',
      preset: 'upperBody'
    });
    animationSet.createSkeletalMaskedAnimation('full', 'lower', {
      type: 'humanoid',
      preset: 'lowerBody'
    });
    model.animationSet.playAnimation('upper');
    model.animationSet.playAnimation('lower');
    model.animationSet.update(0);
    model.animationSet.update(0.5);

    expect(spine.rotation.y).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(spine.rotation.x).toBeCloseTo(0);
    expect(leftUpperLeg.rotation.x).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(leftUpperLeg.rotation.y).toBeCloseTo(0);
  });

  test('creates name based masked clips with descendants and exclusions', () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const root = appendNode(model, 'Root');
    const joints = buildHumanoid(root, '');
    const rig = new SkeletonRig(joints, bindPose(joints), { rootJoint: root });
    model.animationSet.rigs.push(new DRef(rig));

    const spine = joints[1];
    const chest = joints[2];
    const leftHand = joints[9];
    const rightHand = joints[13];
    const full = model.animationSet.createAnimation('named')!;
    full.addSkeleton(rig.persistentId);
    for (const joint of [spine, chest, leftHand, rightHand]) {
      full.addTrack(
        joint,
        new NodeScaleTrack('linear', [
          { time: 0, value: Vector3.one() },
          { time: 1, value: new Vector3(2, 2, 2) }
        ])
      );
    }

    const masked = getMaskedAnimationSet(model).createSkeletalMaskedAnimation(
      'named',
      'named_spine_no_left_hand',
      {
        type: 'joints',
        include: ['Spine'],
        exclude: ['LeftHand'],
        includeDescendants: true
      }
    );

    expect(masked).toBeTruthy();
    expect(masked!.tracks.has(spine)).toBe(true);
    expect(masked!.tracks.has(chest)).toBe(true);
    expect(masked!.tracks.has(leftHand)).toBe(false);
    expect(masked!.tracks.has(rightHand)).toBe(true);
  });

  test('supports humanoid semantic include and explicit root motion only masks', () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const root = appendNode(model, 'Root');
    const joints = buildHumanoid(root, '');
    const rig = new SkeletonRig(joints, bindPose(joints), { rootJoint: root });
    model.animationSet.rigs.push(new DRef(rig));

    const leftHand = joints[9];
    const rightHand = joints[13];
    const full = model.animationSet.createAnimation('semantic')!;
    full.addSkeleton(rig.persistentId);
    full.addTrack(
      root,
      new NodeTranslationTrack('linear', [
        { time: 0, value: Vector3.zero() },
        { time: 1, value: new Vector3(0, 0, 1) }
      ])
    );
    full.addTrack(
      leftHand,
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
      ])
    );
    full.addTrack(
      rightHand,
      new NodeRotationTrack('linear', [
        { time: 0, value: Quaternion.identity() },
        { time: 1, value: Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI / 4) }
      ])
    );

    const animationSet = getMaskedAnimationSet(model);
    const leftArm = animationSet.createSkeletalMaskedAnimation('semantic', 'semantic_left_arm', {
      type: 'humanoid',
      includeBody: [HumanoidBodyRig.LeftUpperArm],
      includeDescendants: true
    });
    const motion = animationSet.createSkeletalMaskedAnimation('semantic', 'semantic_motion', {
      type: 'humanoid',
      preset: 'upperBody',
      rootMotion: 'only'
    });

    expect(leftArm).toBeTruthy();
    expect(leftArm!.tracks.has(root)).toBe(false);
    expect(leftArm!.tracks.has(leftHand)).toBe(true);
    expect(leftArm!.tracks.has(rightHand)).toBe(false);
    expect(motion).toBeTruthy();
    expect(motion!.tracks.has(root)).toBe(true);
    expect(motion!.tracks.has(leftHand)).toBe(false);
  });
});
