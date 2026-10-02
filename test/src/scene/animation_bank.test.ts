import { DRef, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import {
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack,
  Scene,
  SceneNode,
  SkeletonRig,
  SkinBinding
} from '@zephyr3d/scene';
import { AnimationBank } from '../../../libs/scene/src/animation/animation_bank';
import { SkinPaletteAtlas } from '../../../libs/scene/src/animation/skin_palette_atlas';

jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    frameInfo: { frameCounter: 0 },
    getDeviceCaps: () => ({ textureCaps: { maxTextureSize: 4096 } }),
    createTexture2D: (_format: string, width: number, height: number) => ({
      width,
      height,
      update: () => undefined,
      dispose: () => undefined
    })
  }))
}));

function appendNode(parent: SceneNode, name: string) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  node.parent = parent;
  return node;
}

/** A scaled armature with a three-joint chain, its skin binding and a one second clip */
function buildModel() {
  const scene = new Scene();
  const model = appendNode(scene.rootNode, 'model');
  model.position.setXYZ(5, 0, -3);
  const armature = appendNode(model, 'armature');
  armature.scale.setXYZ(0.01, 0.01, 0.01);
  armature.rotation.set(Quaternion.fromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
  const root = appendNode(armature, 'root');
  const spine = appendNode(root, 'spine');
  spine.position.setXYZ(0, 100, 0);
  const head = appendNode(spine, 'head');
  head.position.setXYZ(0, 50, 0);
  head.scale.setXYZ(1.5, 1.5, 1.5);
  const joints = [root, spine, head];
  const bindPose = joints.map((joint) => ({
    position: joint.position.clone(),
    rotation: joint.rotation.clone(),
    scale: joint.scale.clone()
  }));
  const rig = new SkeletonRig(joints, bindPose);
  const invArmature = Matrix4x4.invertAffine(armature.worldMatrix);
  const inverseBind = joints.map((joint) =>
    Matrix4x4.invertAffine(Matrix4x4.multiplyAffine(invArmature, joint.worldMatrix))
  );
  const binding = new SkinBinding(rig, inverseBind);
  model.animationSet.skeletons.push(new DRef(binding));
  const clip = model.animationSet.createAnimation('walk')!;
  clip.addSkeleton(binding.persistentId);
  clip.addTrack(
    root,
    new NodeTranslationTrack('linear', [
      { time: 0, value: Vector3.zero() },
      { time: 1, value: new Vector3(0, 0, 30) }
    ])
  );
  clip.addTrack(
    spine,
    new NodeRotationTrack('linear', [
      { time: 0, value: Quaternion.identity() },
      { time: 0.5, value: Quaternion.fromAxisAngle(new Vector3(0, 0, 1), 0.6) },
      { time: 1, value: Quaternion.identity() }
    ])
  );
  clip.addTrack(
    head,
    new NodeScaleTrack('linear', [
      { time: 0, value: new Vector3(1.5, 1.5, 1.5) },
      { time: 1, value: new Vector3(2, 2, 2) }
    ])
  );
  return { scene, model, armature, joints, binding };
}

/** Palette the skin binding writes for the clip posed at a time */
function bindingPalette(
  model: SceneNode,
  binding: SkinBinding,
  time: number
): { palette: Float32Array; base: number } {
  const clip = model.animationSet.get('walk')!;
  for (const [target, tracks] of clip.tracks) {
    for (const track of tracks) {
      track.applyState(target, track.calculateState(target, time));
    }
  }
  // Internals of the source build, not in the published typings the tests compile against
  const internal = binding as unknown as { updateJointMatrices(): void; paletteBase: number };
  internal.updateJointMatrices();
  return readPalette(internal.paletteBase, binding.joints.length);
}

/** Current palette set of a block in the atlas mirror */
function readPalette(base: number, jointCount: number) {
  const data = (SkinPaletteAtlas.instance as unknown as { _data: Float32Array })._data;
  const current = data[base * 16];
  return { palette: data.slice(current * 16, (current + jointCount) * 16), base: current };
}

function expectPalettesClose(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i]).toBeCloseTo(b[i], 4);
  }
}

describe('AnimationBank', () => {
  test('bakes clips at 30 frames per second including the end pose', () => {
    const { scene, model, binding } = buildModel();
    const bank = new AnimationBank(model.animationSet as never, binding as never);
    expect(bank.entries.length).toBe(1);
    expect(bank.entries[0].frameCount).toBe(31);
    expect(bank.entries[0].playLength).toBeCloseTo(1);
    bank.dispose();
    scene.dispose();
  });

  test('restores joint transforms after baking', () => {
    const { scene, model, joints, binding } = buildModel();
    joints[1].rotation.set(Quaternion.fromAxisAngle(new Vector3(0, 1, 0), 0.3));
    const before = joints.map((joint) => [
      joint.position.clone(),
      joint.rotation.clone(),
      joint.scale.clone()
    ]);
    const bank = new AnimationBank(model.animationSet as never, binding as never);
    joints.forEach((joint, i) => {
      expect(Vector3.distance(joint.position, before[i][0] as Vector3)).toBeCloseTo(0);
      expect(joint.rotation.equalsTo(before[i][1] as Quaternion)).toBe(true);
      expect(Vector3.distance(joint.scale, before[i][2] as Vector3)).toBeCloseTo(0);
    });
    bank.dispose();
    scene.dispose();
  });

  test('writes the palette of the skin binding at sampled frames', () => {
    const { scene, model, binding } = buildModel();
    const bank = new AnimationBank(model.animationSet as never, binding as never);
    for (const time of [0, 0.2, 0.5, 0.9, 1]) {
      const track = bank.createTrack('walk', { position: time, autoPlay: false, loop: false });
      const fromBank = readPalette(track.paletteBase, binding.joints.length).palette;
      const fromBinding = bindingPalette(model, binding, time).palette;
      expectPalettesClose(fromBank, fromBinding);
      track.dispose();
    }
    bank.dispose();
    scene.dispose();
  });

  test('palettes do not depend on where the model is placed', () => {
    const { scene, model, binding } = buildModel();
    const bank = new AnimationBank(model.animationSet as never, binding as never);
    const track = bank.createTrack('walk', { position: 0.5, autoPlay: false });
    const before = readPalette(track.paletteBase, binding.joints.length).palette;
    model.position.setXYZ(-40, 7, 12);
    model.rotation.set(Quaternion.fromAxisAngle(new Vector3(0, 1, 0), 1.2));
    track.position = 0.5;
    track.update(0);
    expectPalettesClose(readPalette(track.paletteBase, binding.joints.length).palette, before);
    track.dispose();
    bank.dispose();
    scene.dispose();
  });

  test('advances, loops and keeps the previous pose for motion vectors', () => {
    const { scene, model, binding } = buildModel();
    const bank = new AnimationBank(model.animationSet as never, binding as never);
    const track = bank.createTrack('walk', { position: 0.9, playRate: 0.5 });
    const data = (SkinPaletteAtlas.instance as unknown as { _data: Float32Array })._data;
    const header0 = data[track.paletteBase * 16];
    track.update(0.4);
    expect(track.position).toBeCloseTo(0.1);
    expect(data[track.paletteBase * 16 + 1]).toBe(header0);
    expect(data[track.paletteBase * 16]).not.toBe(header0);

    track.loop = false;
    track.playRate = -1;
    track.update(0.5);
    expect(track.position).toBe(0);
    track.autoPlay = false;
    track.update(0.1);
    track.update(0.1);
    // A still pose points both sets at the same matrices
    expect(data[track.paletteBase * 16 + 1]).toBe(data[track.paletteBase * 16]);
    track.dispose();
    bank.dispose();
    scene.dispose();
  });

  test('rejects skins with other joints', () => {
    const a = buildModel();
    const b = buildModel();
    const bank = new AnimationBank(a.model.animationSet as never, a.binding as never);
    expect(bank.isCompatible(b.binding as never)).toBe(true);
    b.joints[2].name = 'neck';
    expect(bank.isCompatible(b.binding as never)).toBe(false);
    bank.dispose();
    a.scene.dispose();
    b.scene.dispose();
  });
});
