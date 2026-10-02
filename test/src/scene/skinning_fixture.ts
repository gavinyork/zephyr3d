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
import { SkinPaletteAtlas } from '../../../libs/scene/src/animation/skin_palette_atlas';

// Shared by the animation bank tests. Test files using it mock '@zephyr3d/scene/app/api'.

export function appendNode(parent: SceneNode, name: string) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  node.parent = parent;
  return node;
}

/** A scaled armature with a three-joint chain, its skin binding and a one second clip */
export function buildModel() {
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
export function bindingPalette(
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
export function readPalette(base: number, jointCount: number) {
  const data = (SkinPaletteAtlas.instance as unknown as { _data: Float32Array })._data;
  const current = data[base * 16];
  return { palette: data.slice(current * 16, (current + jointCount) * 16), base: current };
}

export function expectPalettesClose(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i]).toBeCloseTo(b[i], 4);
  }
}
