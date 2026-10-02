import { DRef, Matrix4x4, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  AnimationBank,
  Mesh,
  NodeRotationTrack,
  NodeTranslationTrack,
  PlaneShape,
  Primitive,
  SceneNode,
  SkeletonRig,
  SkinBinding
} from '@zephyr3d/scene';
import type { MeshMaterial, Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, lambert, pbr, placeCamera, shadowKeyLight } from './common';

/** Height of the skinned tube */
const TUBE_HEIGHT = 2.4;
const TUBE_RADIUS = 0.22;
/** Joints along the tube, evenly spaced from its base */
const JOINT_COUNT = 4;
/**
 * The armature works in centimetres under a 0.01 scale, as Mixamo and most DCC
 * exports do, so the palettes have to carry the reference node's scale correctly
 */
const ARMATURE_SCALE = 0.01;
/** Length of the looping clip in seconds */
const CLIP_LENGTH = 2;
/** Playback offsets of the instances, so each one holds a distinct pose */
const PHASES = [0, 0.35, 0.7, 1.05, 1.4];
/** Instance spacing along X */
const SPACING = 1.25;
/**
 * Enough frames that the clips have advanced well past their start pose, and
 * that motion vectors and the double-buffered palettes have a previous frame
 */
const FRAMES = 12;

/**
 * A vertical tube rigged to a chain of joints, each vertex weighted to the two
 * joints around its height. Built once and shared by every instance, which is one
 * of the two conditions for instancing (the other is an instanced material).
 */
function tubePrimitive() {
  const radial = 20;
  const rings = 36;
  const positions: number[] = [];
  const normals: number[] = [];
  const blendIndices: number[] = [];
  const blendWeights: number[] = [];
  const indices: number[] = [];
  const segment = TUBE_HEIGHT / (JOINT_COUNT - 1);
  for (let r = 0; r <= rings; r++) {
    const y = (TUBE_HEIGHT * r) / rings;
    const t = Math.min(y / segment, JOINT_COUNT - 1 - 1e-6);
    const j0 = Math.floor(t);
    const w1 = t - j0;
    for (let s = 0; s <= radial; s++) {
      const a = (2 * Math.PI * s) / radial;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      positions.push(nx * TUBE_RADIUS, y, nz * TUBE_RADIUS);
      normals.push(nx, 0, nz);
      blendIndices.push(j0, j0 + 1, 0, 0);
      blendWeights.push(1 - w1, w1, 0, 0);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * (radial + 1) + s;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const prim = new Primitive();
  prim.createAndSetVertexBuffer('position_f32x3', new Float32Array(positions));
  prim.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
  prim.createAndSetVertexBuffer('blendindices_f32x4', new Float32Array(blendIndices));
  prim.createAndSetVertexBuffer('blendweights_f32x4', new Float32Array(blendWeights));
  prim.createAndSetIndexBuffer(new Uint16Array(indices));
  prim.indexCount = indices.length;
  prim.primitiveType = 'triangle-list';
  return {
    prim,
    positions: new Float32Array(positions),
    blendIndices: new Float32Array(blendIndices),
    blendWeights: new Float32Array(blendWeights)
  };
}

type TubeData = ReturnType<typeof tubePrimitive>;

/**
 * One model instance: its own armature, joints, skin binding and a looping clip
 * that sways the chain sideways and bobs the root, like a prefab instantiated in
 * the editor.
 */
function tubeModel(scene: Scene, tube: TubeData, material: MeshMaterial, x: number) {
  const model = new SceneNode(scene);
  model.name = 'tube';
  // Meshes find their skin binding through the nearest prefab root
  model.prefabId = 'visual-test/skinned-tube';
  model.position.setXYZ(x, 0, 0);

  const armature = new SceneNode(scene);
  armature.parent = model;
  armature.scale.setXYZ(ARMATURE_SCALE, ARMATURE_SCALE, ARMATURE_SCALE);
  const joints: SceneNode[] = [];
  const step = TUBE_HEIGHT / (JOINT_COUNT - 1) / ARMATURE_SCALE;
  for (let i = 0; i < JOINT_COUNT; i++) {
    const joint = new SceneNode(scene);
    joint.name = `joint${i}`;
    joint.parent = i === 0 ? armature : joints[i - 1];
    joint.position.setXYZ(0, i === 0 ? 0 : step, 0);
    joints.push(joint);
  }

  const mesh = new Mesh(scene, tube.prim, material);
  mesh.parent = model;
  const rig = new SkeletonRig(
    joints,
    joints.map((joint) => ({
      position: joint.position.clone(),
      rotation: joint.rotation.clone(),
      scale: joint.scale.clone()
    }))
  );
  // Inverse bind matrices take mesh space to each joint's space in the bind pose
  const inverseBind = joints.map((joint) =>
    Matrix4x4.invertAffine(Matrix4x4.multiplyAffine(mesh.invWorldMatrix, joint.worldMatrix))
  );
  const binding = new SkinBinding(rig, inverseBind);
  model.animationSet.rigs.push(new DRef(rig));
  model.animationSet.skeletons.push(new DRef(binding));
  mesh.setSkinnedBoundingInfo(
    binding.getBoundingInfo({
      positions: tube.positions,
      blendIndices: tube.blendIndices,
      weights: tube.blendWeights
    })
  );
  mesh.skinBindingName = binding.persistentId;

  const clip = model.animationSet.createAnimation('sway')!;
  clip.addSkeleton(binding.persistentId);
  const keyTimes = [0, 0.5, 1, 1.5, 2].map((t) => (t * CLIP_LENGTH) / 2);
  const bend = [0, 1, 0, -1, 0];
  clip.addTrack(
    joints[0],
    new NodeTranslationTrack(
      'linear',
      keyTimes.map((time, i) => ({
        time,
        value: new Vector3(0, Math.abs(bend[i]) * 15, 0)
      }))
    )
  );
  for (let j = 1; j < JOINT_COUNT; j++) {
    clip.addTrack(
      joints[j],
      new NodeRotationTrack(
        'linear',
        keyTimes.map((time, i) => ({
          time,
          // Upper joints bend further and lag a little, so the chain curls
          value: Quaternion.fromAxisAngle(new Vector3(0, 0, 1), bend[(i + (j > 1 ? 1 : 0)) % 4] * 0.35 * j)
        }))
      )
    );
  }
  return { model, mesh, binding };
}

/** Ground, shadowing light and camera shared by the skinning scenes */
function skinningStage(scene: Scene) {
  bareScene(scene);
  shadowKeyLight(scene, 'pcf');
  const ground = new Mesh(scene, new PlaneShape({ size: 9 }), lambert(new Vector4(0.62, 0.62, 0.6, 1)));
  ground.position.setXYZ(0, 0, 0);
}

const TINTS = [
  new Vector4(0.9, 0.3, 0.25, 1),
  new Vector4(0.95, 0.7, 0.2, 1),
  new Vector4(0.35, 0.8, 0.35, 1),
  new Vector4(0.25, 0.55, 0.95, 1),
  new Vector4(0.7, 0.35, 0.9, 1)
];

/** One instanced material per instance, tinted so the instances are told apart */
function instanceMaterials() {
  const core = pbr(new Vector4(1, 1, 1, 1), 0, 0.6);
  return TINTS.map((tint) => {
    const m = core.createInstance();
    m.albedoColor = tint;
    return m;
  });
}

function placeSkinningCamera(scene: Scene, camera: Parameters<VisualScene['setup']>[0]['camera']) {
  placeCamera(camera, new Vector3(0, 2.6, 6.8), new Vector3(0, 1.1, 0));
  void scene;
}

/**
 * Skinned instances animated by their own skeletons on the CPU, drawn as one
 * instanced batch per pass.
 */
export const skinInstancedCpu: VisualScene = {
  name: 'skin-instanced-cpu',
  description:
    'Five rigged tubes swaying at different phases under a centimetre-scaled armature, one instanced batch. Pins model-space skin palettes in the shared atlas, per-instance palette bases and instanced skinned shadows.',
  frames: FRAMES,
  setup({ scene, camera }) {
    skinningStage(scene);
    const tube = tubePrimitive();
    const materials = instanceMaterials();
    PHASES.forEach((phase, i) => {
      const { model } = tubeModel(scene, tube, materials[i], (i - (PHASES.length - 1) / 2) * SPACING);
      model.animationSet.play('sway')?.seek(phase);
    });
    placeSkinningCamera(scene, camera);
  }
};

/**
 * The same instances played by baked animation bank tracks instead of their
 * skeletons. Should match {@link skinInstancedCpu} up to the bank's 30Hz
 * resampling; the two neighbouring instances at the end share one track.
 */
export const skinAnimationBank: VisualScene = {
  name: 'skin-animation-bank',
  description:
    'The skin-instanced-cpu tubes driven by baked animation bank tracks, two of them sharing one track. Pins bank baking, key interpolation, track playback and palette overrides against the CPU skeleton path.',
  frames: FRAMES,
  setup({ scene, camera }) {
    skinningStage(scene);
    const tube = tubePrimitive();
    const materials = instanceMaterials();
    let bank: AnimationBank | null = null;
    const tracks = new Map<number, ReturnType<AnimationBank['createTrack']>>();
    // The last two instances share the phase, and so the track, of the fourth
    const phases = [...PHASES.slice(0, 4), PHASES[3]];
    phases.forEach((phase, i) => {
      const { model, binding } = tubeModel(
        scene,
        tube,
        materials[i],
        (i - (phases.length - 1) / 2) * SPACING
      );
      bank ??= new AnimationBank(model.animationSet, binding);
      let track = tracks.get(phase);
      if (!track) {
        track = bank.createTrack('sway', { position: phase });
        tracks.set(phase, track);
      }
      track.attach(model);
    });
    placeSkinningCamera(scene, camera);
  }
};
