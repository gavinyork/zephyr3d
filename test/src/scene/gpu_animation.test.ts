import { Quaternion, Vector3 } from '@zephyr3d/base';
import { NodeTranslationTrack, SceneNode, SkeletonModifier } from '@zephyr3d/scene';
import type { SkeletonRig } from '@zephyr3d/scene';
import type { AnimationBankTrack } from '../../../libs/scene/src/animation/animation_bank';
import { SkinPaletteAtlas } from '../../../libs/scene/src/animation/skin_palette_atlas';
import { appendNode, buildModel, expectPalettesClose, readPalette } from './skinning_fixture';

jest.mock('@zephyr3d/scene/app/api', () => ({
  tryGetApp: jest.fn(() => null),
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

class NoopModifier extends SkeletonModifier {
  apply(_rig: SkeletonRig, _deltaTime: number): void {}
  reset(): void {}
  protected _getWeight(): number {
    return 1;
  }
  protected _setWeight(_value: number): void {}
}

/** Bank tracks of the driver of a model, by skin binding */
function driverTracks(model: SceneNode): Map<unknown, AnimationBankTrack> {
  const driver = (
    model.animationSet as unknown as { _gpuDriver: { _tracks: Map<unknown, AnimationBankTrack> } }
  )._gpuDriver;
  return driver?._tracks ?? new Map();
}

/** Palette a track writes for its current position, evaluated as the scene update would */
function trackPalette(model: SceneNode) {
  const [track] = [...driverTracks(model).values()];
  track.update(0);
  return readPalette(track.paletteBase, track.bank.jointCount).palette;
}

/** Palette the skin binding writes on the regular path */
function bindingPaletteOf(model: SceneNode) {
  const binding = model.animationSet.skeletons[0].get()! as unknown as { paletteBase: number };
  return readPalette(binding.paletteBase, model.animationSet.skeletons[0].get()!.joints.length).palette;
}

function playBoth(time: number) {
  const gpu = buildModel();
  const cpu = buildModel();
  gpu.model.animationSet.gpuAnimation = true;
  for (const { model } of [gpu, cpu]) {
    model.animationSet.play('walk');
    model.animationSet.update(0);
    model.animationSet.update(time);
  }
  return { gpu, cpu };
}

describe('AnimationSet.gpuAnimation', () => {
  test('is off by default and leaves playback on the joints', () => {
    const { scene, model } = buildModel();
    model.animationSet.play('walk');
    model.animationSet.update(0);
    model.animationSet.update(0.3);
    expect(model.animationSet.gpuAnimation).toBe(false);
    expect(model.animationSet.isPlayingOnGpu).toBe(false);
    scene.dispose();
  });

  test('poses the skin from a bank track as the regular path would', () => {
    // At a sampled frame of the bank; between frames they differ by the interpolation of the
    // sampled poses, about 1e-5 relative
    const { gpu, cpu } = playBoth(0.4);
    expect(gpu.model.animationSet.isPlayingOnGpu).toBe(true);
    expectPalettesClose(trackPalette(gpu.model), bindingPaletteOf(cpu.model));
    gpu.scene.dispose();
    cpu.scene.dispose();
  });

  test('leaves the joint nodes alone while playing from a bank', () => {
    const { scene, model, joints } = buildModel();
    model.animationSet.gpuAnimation = true;
    const before = joints.map((joint) => joint.position.clone());
    model.animationSet.play('walk');
    model.animationSet.update(0);
    model.animationSet.update(0.5);
    joints.forEach((joint, i) => expect(Vector3.distance(joint.position, before[i])).toBeCloseTo(0));
    scene.dispose();
  });

  test('shares one bank among instances of the same model', () => {
    const a = buildModel();
    const b = buildModel();
    a.model.prefabId = 'test/shared-model';
    b.model.prefabId = 'test/shared-model';
    for (const { model } of [a, b]) {
      model.animationSet.gpuAnimation = true;
      model.animationSet.play('walk');
      model.animationSet.update(0);
    }
    const [trackA] = driverTracks(a.model).values();
    const [trackB] = driverTracks(b.model).values();
    expect(trackA.bank).toBe(trackB.bank);
    expect(trackA).not.toBe(trackB);
    a.scene.dispose();
    b.scene.dispose();
  });

  test('falls back to the joints during a cross fade, posed where the bank left off', () => {
    const { gpu, cpu } = playBoth(0.4);
    const clip = gpu.model.animationSet.createAnimation('slide')!;
    clip.addSkeleton(gpu.binding.persistentId);
    clip.addTrack(
      gpu.joints[0],
      new NodeTranslationTrack('linear', [
        { time: 0, value: Vector3.zero() },
        { time: 1, value: new Vector3(50, 0, 0) }
      ])
    );
    gpu.model.animationSet.getPlayback('walk')!.crossFadeTo('slide', { duration: 0.5 });
    gpu.model.animationSet.update(0);
    expect(gpu.model.animationSet.isPlayingOnGpu).toBe(false);
    // The fading walk clip still poses the other joints as the regular path did at that time
    expect(gpu.joints[2].scale.equalsTo(cpu.joints[2].scale, 1e-4)).toBe(true);
    gpu.scene.dispose();
    cpu.scene.dispose();
  });

  test('poses the joints at the last time when playback stops', () => {
    const { gpu, cpu } = playBoth(0.6);
    gpu.model.animationSet.stopAnimation('walk');
    gpu.model.animationSet.update(0);
    expect(gpu.model.animationSet.isPlayingOnGpu).toBe(false);
    gpu.joints.forEach((joint, i) => {
      expect(Vector3.distance(joint.position, cpu.joints[i].position)).toBeCloseTo(0, 4);
      expect(joint.rotation.equalsTo(cpu.joints[i].rotation, 1e-4)).toBe(true);
      expect(joint.scale.equalsTo(cpu.joints[i].scale, 1e-4)).toBe(true);
    });
    gpu.scene.dispose();
    cpu.scene.dispose();
  });

  test('falls back while the rig has a skeleton modifier', () => {
    const { scene, model, binding } = buildModel();
    model.animationSet.gpuAnimation = true;
    model.animationSet.play('walk');
    model.animationSet.update(0);
    expect(model.animationSet.isPlayingOnGpu).toBe(true);
    binding.rig.modifiers.push(new NoopModifier());
    model.animationSet.update(0.1);
    expect(model.animationSet.isPlayingOnGpu).toBe(false);
    binding.rig.modifiers.length = 0;
    model.animationSet.update(0.1);
    expect(model.animationSet.isPlayingOnGpu).toBe(true);
    scene.dispose();
  });

  test('falls back while a node is attached below a joint', () => {
    const { scene, model, joints } = buildModel();
    model.animationSet.gpuAnimation = true;
    model.animationSet.play('walk');
    model.animationSet.update(0);
    expect(model.animationSet.isPlayingOnGpu).toBe(true);
    const sword = appendNode(joints[2], 'sword');
    model.animationSet.update(0.1);
    expect(model.animationSet.isPlayingOnGpu).toBe(false);
    sword.remove();
    model.animationSet.update(0.1);
    expect(model.animationSet.isPlayingOnGpu).toBe(true);
    scene.dispose();
  });

  test('falls back for clips animating other nodes than joints', () => {
    const { scene, model } = buildModel();
    const prop = new SceneNode(model.scene);
    prop.parent = model;
    const clip = model.animationSet.createAnimation('door')!;
    clip.addTrack(
      prop,
      new NodeTranslationTrack('linear', [
        { time: 0, value: Vector3.zero() },
        { time: 1, value: new Vector3(0, 1, 0) }
      ])
    );
    model.animationSet.gpuAnimation = true;
    model.animationSet.play('door');
    model.animationSet.update(0);
    expect(model.animationSet.isPlayingOnGpu).toBe(false);
    scene.dispose();
  });

  test('stops using banks when turned off', () => {
    const { scene, model } = buildModel();
    model.animationSet.gpuAnimation = true;
    model.animationSet.play('walk');
    model.animationSet.update(0);
    expect(model.animationSet.isPlayingOnGpu).toBe(true);
    model.animationSet.gpuAnimation = false;
    model.animationSet.update(0.1);
    expect(model.animationSet.isPlayingOnGpu).toBe(false);
    // Back on the regular path, the joints are posed by the clip again
    expect(model.animationSet.skeletons[0].get()!.joints[1].rotation.equalsTo(Quaternion.identity())).toBe(
      false
    );
    scene.dispose();
  });

  test('stops posing the joints of a still model while no clip plays', () => {
    const idle = buildModel();
    const regular = buildModel();
    idle.model.animationSet.gpuAnimation = true;
    const spy = (binding: unknown) =>
      jest.spyOn(binding as { updateJointMatrices(): void }, 'updateJointMatrices');
    const idleSpy = spy(idle.binding);
    const regularSpy = spy(regular.binding);
    for (let i = 0; i < 6; i++) {
      idle.model.animationSet.update(0.1);
      regular.model.animationSet.update(0.1);
    }
    // The regular path recomputes the joints every frame; the idle one twice, then stops
    expect(regularSpy).toHaveBeenCalledTimes(6);
    expect(idleSpy).toHaveBeenCalledTimes(2);
    // The two frames written leave the previous pose equal to the current one
    const data = (SkinPaletteAtlas.instance as unknown as { _data: Float32Array })._data;
    const base = (idle.binding as unknown as { paletteBase: number }).paletteBase;
    const n = idle.binding.joints.length;
    const current = data.slice(data[base * 16] * 16, (data[base * 16] + n) * 16);
    const previous = data.slice(data[base * 16 + 1] * 16, (data[base * 16 + 1] + n) * 16);
    expectPalettesClose(previous, current);
    // Playing again goes through the bank as usual
    idle.model.animationSet.play('walk');
    idle.model.animationSet.update(0);
    expect(idle.model.animationSet.isPlayingOnGpu).toBe(true);
    idle.scene.dispose();
    regular.scene.dispose();
  });

  test('keeps posing the joints of a still model while a skeleton modifier runs', () => {
    const { scene, model, binding } = buildModel();
    model.animationSet.gpuAnimation = true;
    binding.rig.modifiers.push(new NoopModifier());
    const updateSpy = jest.spyOn(
      binding as unknown as { updateJointMatrices(): void },
      'updateJointMatrices'
    );
    for (let i = 0; i < 5; i++) {
      model.animationSet.update(0.1);
    }
    expect(updateSpy).toHaveBeenCalledTimes(5);
    scene.dispose();
  });

  test('a still pose stops writing the atlas and waking skinned meshes', () => {
    const { scene, model, binding } = buildModel();
    const atlas = SkinPaletteAtlas.instance;
    const writeSpy = jest.spyOn(atlas, 'writeSlots');
    const version = () => (binding as unknown as { paletteVersion: number }).paletteVersion;
    // Regular path, no clip: the first frames write, then the pose is settled
    for (let i = 0; i < 3; i++) {
      model.animationSet.update(0.1);
    }
    writeSpy.mockClear();
    const settled = version();
    model.animationSet.update(0.1);
    model.position.setXYZ(10, 0, 0);
    model.animationSet.update(0.1);
    // Moving the whole model keeps the pose
    expect(writeSpy).not.toHaveBeenCalled();
    expect(version()).toBe(settled);
    // Posing a joint changes it
    binding.joints[1].rotation.set(Quaternion.fromAxisAngle(new Vector3(0, 0, 1), 0.2));
    model.animationSet.update(0.1);
    expect(writeSpy).toHaveBeenCalled();
    expect(version()).toBe(settled + 1);
    scene.dispose();
  });
});
