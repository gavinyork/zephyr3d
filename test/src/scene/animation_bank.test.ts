import { Quaternion, Vector3 } from '@zephyr3d/base';
import { AnimationBank } from '../../../libs/scene/src/animation/animation_bank';
import { SkinPaletteAtlas } from '../../../libs/scene/src/animation/skin_palette_atlas';
import { bindingPalette, buildModel, expectPalettesClose, readPalette } from './skinning_fixture';

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
