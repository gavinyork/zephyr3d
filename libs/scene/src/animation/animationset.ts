import { weightedAverage, Disposable, Interpolator, Vector3 } from '@zephyr3d/base';
import type { DRef, IDisposable, Nullable } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../scene';
import { AnimationClip } from './animation';
import type { AnimationTrack } from './animationtrack';
import { NodeRotationTrack } from './rotationtrack';
import { NodeEulerRotationTrack } from './eulerrotationtrack';
import { NodeTranslationTrack } from './translationtrack';
import { NodeScaleTrack } from './scaletrack';
import type { SkeletonBindPose, SkeletonRig, SkinBinding } from './skeleton';
import { HumanoidBodyRig } from './skeleton';
import type { SkeletalAnimationMaskOptions } from './animationmask';
import { createSkeletalMaskedAnimationClip } from './animationmask';

/**
 * Options for playing an animation.
 *
 * Controls looping, playback speed (including reverse), and fade-in blending.
 * @public
 **/
export type PlayAnimationOptions = {
  /**
   * Number of loops to play.
   *
   * - 0: infinite looping (default).
   * - n \> 0: play exactly n loops (each loop is one full duration of the clip).
   */
  repeat?: number;
  /**
   * Playback speed multiplier.
   *
   * - 1: normal speed (default).
   * - \>1: faster; \<1: slower.
   * - Negative values play the clip in reverse. The initial `currentTime` will be set to the end.
   */
  speedRatio?: number;
  /**
   * Fade-in duration in seconds.
   *
   * Interpolates the animation weight from 0 to the clip's configured weight over this time.
   * Use together with `stopAnimation(..., { fadeOut })` for smooth cross-fading.
   * Default is 0 (no fade-in).
   */
  fadeIn?: number;
  /**
   * Weight of the animation clip.
   *
   * Used during blending when multiple animations affect the same property.
   * Default is the clip's configured weight.
   */
  weight?: number;
};

/**
 * Options for stopping an animation.
 *
 * Allows a graceful fade-out instead of abrupt stop.
 * @public
 */
export type StopAnimationOptions = {
  /**
   * Fade-out duration in seconds.
   *
   * Interpolates the current animation weight down to 0 over this time.
   * Default is 0 (immediate stop).
   */
  fadeOut?: number;
};

/** @public */
export type HumanoidRootMotionMode = 'scaled' | 'copy' | 'locked' | 'none';

/** @public */
export type HumanoidRootMotionScaleMode = 'legLength' | 'none' | number;

/** @public */
export type HumanoidRetargetAxisLocks = {
  x?: boolean;
  y?: boolean;
  z?: boolean;
};

/** @public */
export type CopyHumanoidAnimationOptions = {
  /**
   * Name for the new clip. Ignored when the legacy third `targetName` argument is a string.
   */
  targetName?: string;
  /**
   * How root translation should be handled.
   *
   * - `scaled`: retarget and scale root motion to the destination rig size.
   * - `copy`: retarget root motion without scale.
   * - `locked`: write a constant destination bind-pose root translation.
   * - `none`: do not create a root translation track.
   */
  rootMotion?: HumanoidRootMotionMode;
  /**
   * Scale used when `rootMotion` is `scaled`.
   */
  rootMotionScale?: HumanoidRootMotionScaleMode;
  /**
   * Axis locks applied after root motion retargeting. Locked axes stay at the destination bind pose.
   */
  lockRootMotionAxes?: HumanoidRetargetAxisLocks;
  /**
   * Whether to preserve non-root humanoid translation tracks. These are skipped by default because
   * retargeting humanoid joints should normally keep the destination skeleton lengths intact.
   */
  jointTranslations?: 'skip' | 'preserve';
};

type JointRetargetRemap = {
  dstNode: SceneNode;
  dstJointIndex: number;
  srcNode: SceneNode;
  srcBindRotInv: Quaternion;
  dstBindRot: Quaternion;
  srcBindPos: Vector3;
  dstBindPos: Vector3;
  translationScale: number;
  translationRotation?: Quaternion;
  translationAxisLocks?: HumanoidRetargetAxisLocks;
};

function cloneInterpolator(src: Interpolator): Interpolator {
  return new Interpolator(
    src.mode,
    src.target,
    src.inputs instanceof Float32Array ? new Float32Array(src.inputs) : [...src.inputs],
    src.outputs instanceof Float32Array ? new Float32Array(src.outputs) : [...src.outputs]
  );
}

function createJointRetargetRemap(
  srcSkeleton: SkeletonRig,
  dstSkeleton: SkeletonRig,
  srcJoint: SceneNode,
  dstJoint: SceneNode,
  translationRotation?: Quaternion,
  translationScale?: number,
  translationAxisLocks?: HumanoidRetargetAxisLocks
): JointRetargetRemap {
  const si = srcSkeleton.joints.indexOf(srcJoint);
  const di = dstSkeleton.joints.indexOf(dstJoint);
  const srcBindPose = srcSkeleton.bindPose[si];
  const dstBindPose = dstSkeleton.bindPose[di];
  const srcLen = srcBindPose.position.magnitude;
  const dstLen = dstBindPose.position.magnitude;
  return {
    dstNode: dstJoint,
    dstJointIndex: di,
    srcNode: srcJoint,
    srcBindRotInv: Quaternion.inverse(srcBindPose.rotation),
    dstBindRot: dstBindPose.rotation.clone(),
    srcBindPos: srcBindPose.position.clone(),
    dstBindPos: dstBindPose.position.clone(),
    translationScale: translationScale ?? (srcLen > 1e-6 ? dstLen / srcLen : 1),
    translationRotation,
    translationAxisLocks
  };
}

function createTranslationRetargetRemap(
  srcNode: SceneNode,
  dstNode: SceneNode,
  srcBindPos: Vector3,
  dstBindPos: Vector3,
  dstJointIndex: number,
  translationScale: number,
  translationRotation?: Quaternion,
  translationAxisLocks?: HumanoidRetargetAxisLocks
): JointRetargetRemap {
  return {
    dstNode,
    dstJointIndex,
    srcNode,
    srcBindRotInv: Quaternion.identity(),
    dstBindRot: Quaternion.identity(),
    srcBindPos: srcBindPos.clone(),
    dstBindPos: dstBindPos.clone(),
    translationScale,
    translationRotation,
    translationAxisLocks
  };
}

function getBindPosition(skeleton: SkeletonRig, joint: SceneNode): Vector3 | null {
  const index = skeleton.joints.indexOf(joint);
  return index >= 0 ? skeleton.bindPose[index].position : null;
}

function getRigBindPoseForNode(skeleton: SkeletonRig, node: SceneNode): SkeletonBindPose {
  return (
    skeleton.getBindPoseForJoint(node) ??
    (node === skeleton.rootJoint
      ? skeleton.rootBindPose
      : {
          position: node.position,
          rotation: node.rotation,
          scale: node.scale
        })
  );
}

function getBindDistanceToAncestor(skeleton: SkeletonRig, joint: SceneNode, ancestor: SceneNode): number {
  let distance = 0;
  let node: SceneNode | null = joint;
  while (node && node !== ancestor) {
    const bindPosition = getBindPosition(skeleton, node);
    if (!bindPosition) {
      return 0;
    }
    distance += bindPosition.magnitude;
    node = node.parent;
  }
  return node === ancestor ? distance : 0;
}

function getHumanoidLegLength(skeleton: SkeletonRig, side: 'left' | 'right'): number {
  const mapping = skeleton.humanoidJointMapping;
  if (!mapping) {
    return 0;
  }
  const body = mapping.body;
  const hips = body[HumanoidBodyRig.Hips];
  const foot = side === 'left' ? body[HumanoidBodyRig.LeftFoot] : body[HumanoidBodyRig.RightFoot];
  const toes = side === 'left' ? body[HumanoidBodyRig.LeftToes] : body[HumanoidBodyRig.RightToes];
  return Math.max(
    getBindDistanceToAncestor(skeleton, foot, hips),
    getBindDistanceToAncestor(skeleton, toes, hips)
  );
}

function getHumanoidRootMotionScale(srcSkeleton: SkeletonRig, dstSkeleton: SkeletonRig): number {
  const srcLeftLeg = getHumanoidLegLength(srcSkeleton, 'left');
  const srcRightLeg = getHumanoidLegLength(srcSkeleton, 'right');
  const dstLeftLeg = getHumanoidLegLength(dstSkeleton, 'left');
  const dstRightLeg = getHumanoidLegLength(dstSkeleton, 'right');
  const srcLegLength = Math.max(srcLeftLeg, srcRightLeg);
  const dstLegLength = Math.max(dstLeftLeg, dstRightLeg);
  return srcLegLength > 1e-6 && dstLegLength > 1e-6 ? dstLegLength / srcLegLength : 1;
}

function findTranslationTrack(tracks: AnimationTrack[] | undefined): NodeTranslationTrack | null {
  return (tracks?.find((track) => track instanceof NodeTranslationTrack) ??
    null) as NodeTranslationTrack | null;
}

function applyTranslationAxisLocks(
  value: Vector3,
  bindValue: Vector3,
  locks: HumanoidRetargetAxisLocks | undefined
) {
  if (locks?.x) {
    value.x = bindValue.x;
  }
  if (locks?.y) {
    value.y = bindValue.y;
  }
  if (locks?.z) {
    value.z = bindValue.z;
  }
}

function applyTranslationTangentAxisLocks(value: Vector3, locks: HumanoidRetargetAxisLocks | undefined) {
  if (locks?.x) {
    value.x = 0;
  }
  if (locks?.y) {
    value.y = 0;
  }
  if (locks?.z) {
    value.z = 0;
  }
}

function retargetRotation(qSrcAnim: Quaternion, remap: JointRetargetRemap, out: Quaternion): Quaternion {
  Quaternion.multiply(remap.srcBindRotInv, qSrcAnim, out);
  Quaternion.multiply(remap.dstBindRot, out, out);
  return out.inplaceNormalize();
}

function retargetRotationTangent(
  qSrcTangent: Quaternion,
  remap: JointRetargetRemap,
  out: Quaternion
): Quaternion {
  Quaternion.multiply(remap.srcBindRotInv, qSrcTangent, out);
  Quaternion.multiply(remap.dstBindRot, out, out);
  return out;
}

function retargetTranslationValue(srcValue: Vector3, remap: JointRetargetRemap, out: Vector3): Vector3 {
  out.setXYZ(srcValue.x, srcValue.y, srcValue.z);
  out.subBy(remap.srcBindPos);
  out.scaleBy(remap.translationScale);
  if (remap.translationRotation) {
    remap.translationRotation.transform(out, out);
  }
  out.addBy(remap.dstBindPos);
  applyTranslationAxisLocks(out, remap.dstBindPos, remap.translationAxisLocks);
  return out;
}

function retargetTranslationTangent(srcValue: Vector3, remap: JointRetargetRemap, out: Vector3): Vector3 {
  out.setXYZ(srcValue.x, srcValue.y, srcValue.z);
  out.scaleBy(remap.translationScale);
  if (remap.translationRotation) {
    remap.translationRotation.transform(out, out);
  }
  applyTranslationTangentAxisLocks(out, remap.translationAxisLocks);
  return out;
}

function retargetRotationTrack(src: NodeRotationTrack, remap: JointRetargetRemap): NodeRotationTrack {
  const isCubic = src.interpolator.mode === 'cubicspline';
  const frameStride = isCubic ? 12 : 4;
  const numFrames = (src.interpolator.inputs as Float32Array).length;
  const srcOutputs = src.interpolator.outputs as Float32Array;
  const newOutputs = new Float32Array(srcOutputs.length);
  const t = isCubic ? 4 : 0;
  const q = new Quaternion();
  for (let f = 0; f < numFrames; f++) {
    const base = f * frameStride;
    q.setXYZW(
      srcOutputs[base + t],
      srcOutputs[base + t + 1],
      srcOutputs[base + t + 2],
      srcOutputs[base + t + 3]
    );
    retargetRotation(q, remap, q);
    if (isCubic) {
      // Cubic quaternion tangents live in the same component space, so apply the
      // same constant bind-pose transform without normalizing them.
      q.setXYZW(srcOutputs[base], srcOutputs[base + 1], srcOutputs[base + 2], srcOutputs[base + 3]);
      newOutputs.set(retargetRotationTangent(q, remap, q), base);
      newOutputs.set(
        retargetRotation(new Quaternion(srcOutputs.subarray(base + 4, base + 8)), remap, q),
        base + 4
      );
      q.setXYZW(srcOutputs[base + 8], srcOutputs[base + 9], srcOutputs[base + 10], srcOutputs[base + 11]);
      newOutputs.set(retargetRotationTangent(q, remap, q), base + 8);
    } else {
      newOutputs.set(q, base);
    }
  }
  return new NodeRotationTrack(
    new Interpolator(
      src.interpolator.mode,
      'quat',
      new Float32Array(src.interpolator.inputs as Float32Array),
      newOutputs
    )
  );
}

function retargetEulerToRotationTrack(
  src: NodeEulerRotationTrack,
  remap: JointRetargetRemap
): NodeRotationTrack {
  const srcInputs = src.interpolator.inputs as Float32Array;
  const srcOutputs = src.interpolator.outputs as Float32Array;
  const isCubic = src.interpolator.mode === 'cubicspline';
  const frameStride = isCubic ? 9 : 3;
  const t = isCubic ? 3 : 0;
  const numFrames = srcInputs.length;
  const newOutputs = new Float32Array(numFrames * 4);
  const q = new Quaternion();
  for (let f = 0; f < numFrames; f++) {
    const base = f * frameStride + t;
    q.fromEulerAngle(srcOutputs[base], srcOutputs[base + 1], srcOutputs[base + 2]);
    retargetRotation(q, remap, q);
    newOutputs.set(q, f * 4);
  }
  return new NodeRotationTrack(
    new Interpolator(
      src.interpolator.mode === 'step' ? 'step' : 'linear',
      'quat',
      new Float32Array(srcInputs),
      newOutputs
    )
  );
}

function retargetTranslationTrack(
  src: NodeTranslationTrack,
  remap: JointRetargetRemap
): NodeTranslationTrack {
  const isCubic = src.interpolator.mode === 'cubicspline';
  const frameStride = isCubic ? 9 : 3;
  const numFrames = (src.interpolator.inputs as Float32Array).length;
  const srcOutputs = src.interpolator.outputs as Float32Array;
  const newOutputs = new Float32Array(srcOutputs.length);
  const t = isCubic ? 3 : 0;
  const v = new Vector3();
  for (let f = 0; f < numFrames; f++) {
    const base = f * frameStride;
    v.setXYZ(srcOutputs[base + t], srcOutputs[base + t + 1], srcOutputs[base + t + 2]);
    retargetTranslationValue(v, remap, v);
    if (isCubic) {
      v.setXYZ(srcOutputs[base], srcOutputs[base + 1], srcOutputs[base + 2]);
      newOutputs.set(retargetTranslationTangent(v, remap, v), base);
      v.setXYZ(srcOutputs[base + 3], srcOutputs[base + 4], srcOutputs[base + 5]);
      newOutputs.set(retargetTranslationValue(v, remap, v), base + 3);
      v.setXYZ(srcOutputs[base + 6], srcOutputs[base + 7], srcOutputs[base + 8]);
      newOutputs.set(retargetTranslationTangent(v, remap, v), base + 6);
    } else {
      newOutputs.set(v, base);
    }
  }
  return new NodeTranslationTrack(
    new Interpolator(
      src.interpolator.mode,
      'vec3',
      new Float32Array(src.interpolator.inputs as Float32Array),
      newOutputs
    )
  );
}

function createConstantTranslationTrack(value: Vector3): NodeTranslationTrack {
  return new NodeTranslationTrack(
    new Interpolator('step', 'vec3', new Float32Array([0]), new Float32Array([value.x, value.y, value.z]))
  );
}

function findRotationTrack(
  tracks: AnimationTrack[] | undefined
): NodeRotationTrack | NodeEulerRotationTrack | null {
  return (tracks?.find(
    (track) => track instanceof NodeRotationTrack || track instanceof NodeEulerRotationTrack
  ) ?? null) as NodeRotationTrack | NodeEulerRotationTrack | null;
}

function collectTrackTimes(track: AnimationTrack | null, times: Set<number>) {
  if (track instanceof NodeRotationTrack || track instanceof NodeEulerRotationTrack) {
    for (const time of track.interpolator.inputs as Float32Array) {
      times.add(time);
    }
  }
}

function sampleRotationTrack(
  track: NodeRotationTrack | NodeEulerRotationTrack | null,
  time: number,
  fallback: Quaternion,
  out: Quaternion
): Quaternion {
  if (!track) {
    out.set(fallback);
    return out;
  }
  const state = track.calculateState({}, time);
  out.set(state);
  return out;
}

function bakeHumanoidRotationTracks(
  sourceClip: AnimationClip,
  srcSkeleton: SkeletonRig,
  dstSkeleton: SkeletonRig,
  srcRootRotation: Quaternion,
  dstRootRotation: Quaternion,
  dstClip: AnimationClip,
  remaps: JointRetargetRemap[]
) {
  const rotationTracksByRemap = new Map<
    JointRetargetRemap,
    NodeRotationTrack | NodeEulerRotationTrack | null
  >();
  const times = new Set<number>([0, sourceClip.timeDuration]);
  const remapsByDstNode = new Map<object, JointRetargetRemap>();
  const srcJointSet = new Set(srcSkeleton.joints);
  const dstJointSet = new Set(dstSkeleton.joints);
  const srcBindRotByNode = new Map<SceneNode, Quaternion>();
  const dstBindRotByNode = new Map<SceneNode, Quaternion>();
  const srcRotationTrackByNode = new Map<SceneNode, NodeRotationTrack | NodeEulerRotationTrack | null>();

  for (let i = 0; i < srcSkeleton.joints.length; i++) {
    const joint = srcSkeleton.joints[i];
    srcBindRotByNode.set(joint, srcSkeleton.bindPose[i].rotation);
    const track = findRotationTrack(sourceClip.tracks.get(joint));
    srcRotationTrackByNode.set(joint, track);
    collectTrackTimes(track, times);
  }
  for (let i = 0; i < dstSkeleton.joints.length; i++) {
    dstBindRotByNode.set(dstSkeleton.joints[i], dstSkeleton.bindPose[i].rotation);
  }
  for (const remap of remaps) {
    const track = findRotationTrack(sourceClip.tracks.get(remap.srcNode));
    rotationTracksByRemap.set(remap, track);
    remapsByDstNode.set(remap.dstNode, remap);
  }
  const inputs = new Float32Array([...times].sort((a, b) => a - b));
  const srcBindWorldRots = new Map<SceneNode, Quaternion>();
  const dstBindWorldRots = new Map<SceneNode, Quaternion>();
  const srcAnimWorldRots = new Map<SceneNode, Quaternion>();
  const dstAnimWorldRots = new Map<SceneNode, Quaternion>();
  const outputsByRemap = new Map<JointRetargetRemap, Float32Array>();
  const tmpLocalRot = new Quaternion();
  const tmpWorldDelta = new Quaternion();
  const tmpParentInv = new Quaternion();

  for (const remap of remaps) {
    outputsByRemap.set(remap, new Float32Array(inputs.length * 4));
  }

  function getSrcBindWorldRot(node: SceneNode): Quaternion {
    let rot = srcBindWorldRots.get(node);
    if (!rot) {
      rot = (srcBindRotByNode.get(node) ?? Quaternion.identity()).clone();
      const parent = node.parent;
      if (parent && srcJointSet.has(parent)) {
        Quaternion.multiply(getSrcBindWorldRot(parent), rot, rot);
      } else {
        Quaternion.multiply(srcRootRotation, rot, rot);
      }
      srcBindWorldRots.set(node, rot);
    }
    return rot;
  }

  function getDstBindWorldRot(node: SceneNode): Quaternion {
    let rot = dstBindWorldRots.get(node);
    if (!rot) {
      rot = (dstBindRotByNode.get(node) ?? Quaternion.identity()).clone();
      const parent = node.parent;
      if (parent && dstJointSet.has(parent)) {
        Quaternion.multiply(getDstBindWorldRot(parent), rot, rot);
      } else {
        Quaternion.multiply(dstRootRotation, rot, rot);
      }
      dstBindWorldRots.set(node, rot);
    }
    return rot;
  }

  function getSrcAnimWorldRot(node: SceneNode, time: number): Quaternion {
    let rot = srcAnimWorldRots.get(node);
    if (!rot) {
      rot = new Quaternion();
      srcAnimWorldRots.set(node, rot);
    }
    const parent = node.parent;
    const parentWorldRot = parent && srcJointSet.has(parent) ? getSrcAnimWorldRot(parent, time) : null;
    sampleRotationTrack(
      srcRotationTrackByNode.get(node) ?? null,
      time,
      srcBindRotByNode.get(node) ?? Quaternion.identity(),
      tmpLocalRot
    );
    if (parentWorldRot) {
      Quaternion.multiply(parentWorldRot, tmpLocalRot, rot);
    } else {
      Quaternion.multiply(srcRootRotation, tmpLocalRot, rot);
    }
    return rot;
  }

  function getDstAnimWorldRot(remap: JointRetargetRemap, time: number): Quaternion {
    let rot = dstAnimWorldRots.get(remap.dstNode);
    if (!rot) {
      rot = new Quaternion();
      dstAnimWorldRots.set(remap.dstNode, rot);
    }
    const srcBindWorldRot = getSrcBindWorldRot(remap.srcNode);
    const srcAnimWorldRot = getSrcAnimWorldRot(remap.srcNode, time);
    Quaternion.multiply(srcAnimWorldRot, Quaternion.inverse(srcBindWorldRot, tmpWorldDelta), tmpWorldDelta);
    Quaternion.multiply(tmpWorldDelta, getDstBindWorldRot(remap.dstNode), rot);
    return rot;
  }

  function getDstParentAnimWorldRot(node: SceneNode, time: number): Quaternion | null {
    const parent = node.parent;
    if (!parent || !dstJointSet.has(parent)) {
      return dstRootRotation;
    }
    const mappedParent = remapsByDstNode.get(parent);
    if (mappedParent) {
      return getDstAnimWorldRot(mappedParent, time);
    }
    let rot = dstAnimWorldRots.get(parent);
    if (!rot) {
      rot = (dstBindRotByNode.get(parent) ?? Quaternion.identity()).clone();
      const parentWorldRot = getDstParentAnimWorldRot(parent, time);
      if (parentWorldRot) {
        Quaternion.multiply(parentWorldRot, rot, rot);
      }
      dstAnimWorldRots.set(parent, rot);
    }
    return rot;
  }

  for (let i = 0; i < inputs.length; i++) {
    const time = inputs[i];
    srcAnimWorldRots.clear();
    dstAnimWorldRots.clear();
    for (const remap of remaps) {
      const dstAnimWorldRot = getDstAnimWorldRot(remap, time);
      const parentWorldRot = getDstParentAnimWorldRot(remap.dstNode, time);
      if (parentWorldRot) {
        Quaternion.multiply(Quaternion.inverse(parentWorldRot, tmpParentInv), dstAnimWorldRot, tmpLocalRot);
      } else {
        tmpLocalRot.set(dstAnimWorldRot);
      }
      tmpLocalRot.inplaceNormalize();
      outputsByRemap.get(remap)!.set(tmpLocalRot, i * 4);
    }
  }

  for (const remap of remaps) {
    if (!rotationTracksByRemap.get(remap)) {
      continue;
    }
    const outputs = new Float32Array(outputsByRemap.get(remap)!);
    const track = new NodeRotationTrack(
      new Interpolator('linear', 'quat', new Float32Array(inputs), outputs)
    );
    track.name = 'rotation';
    track.target = remap.dstNode.persistentId;
    track.jointIndex = remap.dstJointIndex;
    dstClip.addTrack(remap.dstNode, track);
  }
}

/**
 * Animation set
 *
 * Manages a collection of named animation clips for a model and orchestrates:
 * - Playback state (time, loops, speed, weights, fade-in/out).
 * - Blending across multiple tracks targeting the same property via weighted averages.
 * - Skeleton usage and application for clips that drive skeletal animation.
 * - Active track registration and cleanup as clips start/stop.
 *
 * Usage:
 * - Create or retrieve `AnimationClip`s by name.
 * - Start playback with `playAnimation(name, options)`.
 * - Advance animation with `update(deltaSeconds)`.
 * - Optionally adjust weight while playing with `setAnimationWeight(name, weight)`.
 *
 * Lifetime:
 * - Disposing the set releases references to the model, clips, and clears active state.
 *
 * @public
 */
export class AnimationSet extends Disposable implements IDisposable {
  /** @internal */
  private _model: SceneNode;
  /** @internal */
  private _animations: Partial<Record<string, AnimationClip>>;
  /** @internal */
  private _skeletons: DRef<SkinBinding>[];
  /** @internal */
  private _rigs: DRef<SkeletonRig>[];
  /** @internal */
  private readonly _activeTracks: Map<object, Map<unknown, AnimationTrack[]>>;
  /** @internal */
  private readonly _activeSkinBindings: Map<SkinBinding, number>;
  /** @internal */
  private readonly _activeRigs: Map<SkeletonRig, number>;
  /** @internal */
  private readonly _activeAnimations: Map<
    AnimationClip,
    {
      currentTime: number;
      repeat: number;
      repeatCounter: number;
      weight: number;
      speedRatio: number;
      firstFrame: boolean;
      fadeIn: number;
      fadeOut: number;
      fadeOutStart: number;
      animateTime: number;
    }
  >;
  /**
   * Create an AnimationSet controlling the provided model.
   *
   * @param model - The SceneNode (model root) controlled by this animation set.
   */
  constructor(model: SceneNode) {
    super();
    this._model = model;
    this._animations = {};
    this._activeTracks = new Map();
    this._activeSkinBindings = new Map();
    this._activeRigs = new Map();
    this._activeAnimations = new Map();
    this._skeletons = [];
    this._rigs = [];
  }
  /**
   * The model (SceneNode) controlled by this animation set.
   */
  get model() {
    return this._model;
  }
  /**
   * Number of animation clips registered in this set.
   */
  get numAnimations() {
    return Object.getOwnPropertyNames(this._animations).length;
  }
  /**
   * The skeletons used by animations in this set.
   */
  get skeletons() {
    return this._skeletons;
  }
  /**
   * The shared rigs used by animations in this set.
   */
  get rigs() {
    return this._rigs;
  }
  /**
   * Per-skin bindings used by skinned meshes in this set.
   */
  get skinBindings() {
    return this._skeletons;
  }
  private resolveRigByAnimationBindingId(id: string): SkeletonRig | null {
    return this._model.findSkeletonRigById(id) ?? this._model.findSkinBindingById(id)?.rig ?? null;
  }
  private resolveClipRig(clip: AnimationClip): SkeletonRig | null {
    let rig: SkeletonRig | null = null;
    for (const id of clip.skeletons) {
      const nextRig = this.resolveRigByAnimationBindingId(id);
      if (!nextRig) {
        continue;
      }
      if (!rig) {
        rig = nextRig;
      } else if (rig !== nextRig) {
        return null;
      }
    }
    return rig;
  }
  /**
   * Retrieve an animation clip by name.
   *
   * @param name - Name of the animation.
   * @returns The clip if present; otherwise null.
   */
  get(name: string) {
    return this._animations[name] ?? null;
  }
  /**
   * Create and register a new animation clip.
   *
   * @param name - Unique name for the animation clip.
   * @param embedded - Whether the clip is embedded/owned (implementation-specific). Default false.
   * @returns The created clip, or null if the name is empty or not unique.
   */
  createAnimation(name: string, embedded = false) {
    if (!name || this._animations[name]) {
      console.error('Animation must have unique name');
      return null;
    } else {
      const animation = new AnimationClip(name, this, embedded);
      this._animations[name] = animation;
      this._model.scene?.queueUpdateNode(this._model);
      return animation;
    }
  }
  /**
   * Delete and dispose an animation clip by name.
   *
   * - If the animation is currently playing, it is first stopped (immediately).
   *
   * @param name - Name of the animation to remove.
   */
  deleteAnimation(name: string) {
    const animation = this._animations[name];
    if (animation) {
      this.stopAnimation(name);
      delete this._animations[name];
      animation.dispose();
    }
  }
  /**
   * Get the list of all registered animation names.
   *
   * @returns An array of clip names.
   */
  getAnimationNames() {
    return Object.keys(this._animations);
  }
  /**
   * Advance and apply active animations.
   *
   * Responsibilities per call:
   * - Update time cursor for each active clip (respecting speedRatio and looping).
   * - Enforce repeat limits and apply fade-out termination if configured.
   * - For each animated target, blend active tracks (weighted by clip weight × fade-in × fade-out)
   *   and apply the resulting state to the target.
   * - Apply shared rig modifiers once, then update skin binding palettes.
   *
   * @param deltaInSeconds - Time step in seconds since last update.
   */
  update(deltaInSeconds: number) {
    this._activeAnimations.forEach((v, k) => {
      if (v.fadeOut > 0 && v.fadeOutStart < 0) {
        v.fadeOutStart = v.animateTime;
      }
      // Update animation time
      if (v.firstFrame) {
        v.firstFrame = false;
      } else {
        const timeAdvance = deltaInSeconds * v.speedRatio;
        v.currentTime += timeAdvance;
        v.animateTime += timeAdvance;
        if (k.timeDuration > 0) {
          if (v.currentTime > k.timeDuration) {
            v.repeatCounter += Math.max(1, Math.floor(v.currentTime / k.timeDuration));
            v.currentTime %= k.timeDuration;
          } else if (v.currentTime < 0) {
            v.repeatCounter += Math.max(1, Math.ceil(-v.currentTime / k.timeDuration));
            v.currentTime = ((v.currentTime % k.timeDuration) + k.timeDuration) % k.timeDuration;
          }
        }
        if (v.repeat !== 0 && v.repeatCounter >= v.repeat) {
          this.stopAnimation(k.name);
        } else if (v.fadeOut > 0) {
          if (v.animateTime - v.fadeOutStart >= v.fadeOut) {
            this.stopAnimation(k.name);
          }
        }
      }
    });
    // Update tracks
    this._activeTracks.forEach((v, k) => {
      v.forEach((alltracks) => {
        // Only deal with tracks which have not been removed
        const tracks = alltracks.filter(
          (track) => track.animation && this.isPlayingAnimation(track.animation.name)
        );
        if (tracks.length > 0) {
          const weights = tracks.map((track) => {
            const info = this._activeAnimations.get(track.animation!)!;
            const weight = info.weight;
            const fadeIn = info.fadeIn === 0 ? 1 : Math.min(1, info.animateTime / info.fadeIn);
            let fadeOut = 1;
            if (info.fadeOut !== 0) {
              fadeOut = 1 - (info.animateTime - info.fadeOutStart) / info.fadeOut;
            }
            return weight * fadeIn * fadeOut;
          });
          const states = tracks.map((track) => {
            const info = this._activeAnimations.get(track.animation!)!;
            const t = (info.currentTime / track.animation!.timeDuration) * track.getDuration();
            return track.calculateState(k, t);
          });
          const state = weightedAverage(weights, states, (a, b, t) => {
            return tracks[0].mixState(a, b, t);
          });
          tracks[0].applyState(k, state);
        }
      });
    });
    // Update rigs once before computing per-skin palettes.
    this._rigs.forEach((v) => {
      v.get()?.apply(deltaInSeconds);
    });
    this._skeletons.forEach((v) => {
      v.get()?.apply();
    });
  }
  /**
   * Check whether an animation is currently playing.
   *
   * @param name - Optional animation name. If omitted, returns true if any animation is playing.
   * @returns True if playing; otherwise false.
   */
  isPlayingAnimation(name?: string) {
    if (name) {
      const animation = this._animations[name];
      return !!animation && this._activeAnimations.has(animation);
    }
    return this._activeAnimations.size > 0;
  }
  /**
   * Get an animation clip by name.
   *
   * Alias of `get(name)` returning a nullable type.
   *
   * @param name - Name of the animation.
   * @returns The clip if present; otherwise null.
   */
  getAnimationClip(name: string) {
    return this._animations[name] ?? null;
  }
  /**
   * Set the runtime blend weight for a currently playing animation.
   *
   * Has no effect if the clip is not active.
   *
   * @param name - Name of the playing animation.
   * @param weight - New weight value used during blending.
   */
  setAnimationWeight(name: string, weight: number) {
    const ani = this._animations[name];
    if (!ani) {
      console.error(`Animation ${name} not exists`);
      return;
    }
    const info = this._activeAnimations.get(ani);
    if (info) {
      info.weight = weight;
    }
  }
  /**
   * Start (or update) playback of an animation clip.
   *
   * Behavior:
   * - If the clip is already playing, stops it first.
   * - Otherwise initializes playback state (repeat counter, speed, weight, initial time).
   * - Registers clip tracks and skeletons into the active sets for blending and application.
   *
   * @param name - Name of the animation to play.
   * @param options - Playback options (repeat, speedRatio, fadeIn).
   */
  playAnimation(name: string, options?: PlayAnimationOptions) {
    const ani = this._animations[name];
    if (!ani) {
      console.error(`Animation ${name} not exists`);
      return;
    }
    if (this.isPlayingAnimation(name)) {
      this.stopAnimation(name);
    }
    const fadeIn = Math.max(options?.fadeIn ?? 0, 0);
    const repeat = options?.repeat ?? 0;
    const speedRatio = options?.speedRatio ?? 1;
    const weight = options?.weight ?? ani.weight ?? 1;
    this._activeAnimations.set(ani, {
      repeat,
      weight,
      speedRatio,
      fadeIn,
      fadeOut: 0,
      repeatCounter: 0,
      currentTime: speedRatio < 0 ? ani.timeDuration : 0,
      animateTime: 0,
      fadeOutStart: 0,
      firstFrame: true
    });
    ani.tracks?.forEach((v, k) => {
      let nodeTracks = this._activeTracks.get(k);
      if (!nodeTracks) {
        nodeTracks = new Map();
        this._activeTracks.set(k, nodeTracks);
      }
      for (const track of v) {
        const blendId = track.getBlendId();
        let blendedTracks = nodeTracks.get(blendId);
        if (!blendedTracks) {
          blendedTracks = [];
          nodeTracks.set(blendId, blendedTracks);
        }
        blendedTracks.push(track);
      }
    });
    ani.skeletons?.forEach((v, k) => {
      const rig = this.model.findSkeletonRigById(k);
      if (rig) {
        const refcount = this._activeRigs.get(rig);
        this._activeRigs.set(rig, refcount ? refcount + 1 : 1);
        rig.playing = true;
        return;
      }
      const binding = this.model.findSkinBindingById(k);
      if (binding) {
        const refcount = this._activeSkinBindings.get(binding);
        this._activeSkinBindings.set(binding, refcount ? refcount + 1 : 1);
        binding.playing = true;
        const rigRefcount = this._activeRigs.get(binding.rig);
        this._activeRigs.set(binding.rig, rigRefcount ? rigRefcount + 1 : 1);
        binding.rig.playing = true;
      }
    });
  }
  /**
   * Stop playback of an animation clip.
   *
   * Behavior:
   * - If `options.fadeOut > 0`, marks the clip for fade-out; actual removal occurs after fade completes.
   * - If `fadeOut` is 0 or omitted, immediately:
   *   - Removes the clip from active animations.
   *   - Unregisters its tracks from active track maps.
   *   - Decrements skeleton reference counts; resets and removes skeletons when refcount reaches 0.
   *
   * @param name - Name of the animation to stop.
   * @param options - Optional fade-out configuration.
   */
  stopAnimation(name: string, options?: StopAnimationOptions) {
    const ani = this._animations[name];
    if (!ani) {
      console.error(`Animation ${name} not exists`);
      return;
    }
    const info = this._activeAnimations.get(ani);
    if (info) {
      const fadeOut = Math.max(options?.fadeOut ?? 0, 0);
      if (fadeOut !== 0) {
        info.fadeOut = fadeOut;
        info.fadeOutStart = -1;
      } else {
        this._activeAnimations.delete(ani);
        this._activeTracks.forEach((v) => {
          v.forEach((tracks, id) => {
            v.set(
              id,
              tracks.filter((track) => track.animation !== ani)
            );
          });
        });
        ani.skeletons?.forEach((v, k) => {
          const rig = this.model.findSkeletonRigById(k);
          if (rig) {
            const refcount = this._activeRigs.get(rig)!;
            if (refcount === 1) {
              rig.reset();
              this._activeRigs.delete(rig);
            } else {
              this._activeRigs.set(rig, refcount - 1);
            }
            return;
          }
          const binding = this.model.findSkinBindingById(k);
          if (binding) {
            const refcount = this._activeSkinBindings.get(binding)!;
            if (refcount === 1) {
              binding.reset();
              this._activeSkinBindings.delete(binding);
            } else {
              this._activeSkinBindings.set(binding, refcount - 1);
            }
            const rigRefcount = this._activeRigs.get(binding.rig)!;
            if (rigRefcount === 1) {
              binding.rig.reset();
              this._activeRigs.delete(binding.rig);
            } else {
              this._activeRigs.set(binding.rig, rigRefcount - 1);
            }
          }
        });
      }
    }
  }
  /**
   * Create a skeletal-only masked clip from an existing clip in this set.
   *
   * The generated clip is a regular `AnimationClip`: it contains cloned node transform tracks
   * for the selected rig joints and can be played/blended through the normal animation system.
   * Non-skeletal tracks are skipped by default.
   *
   * @param sourceName - Name of the source clip.
   * @param targetName - Name of the generated clip.
   * @param options - Humanoid semantic or joint-name based mask options.
   * @returns The generated clip, or null on failure.
   */
  createSkeletalMaskedAnimation(
    sourceName: string,
    targetName: string,
    options: SkeletalAnimationMaskOptions
  ): AnimationClip | null {
    const sourceClip = this.get(sourceName);
    if (!sourceClip) {
      console.error(`createSkeletalMaskedAnimation: animation '${sourceName}' not found`);
      return null;
    }
    const rig = this.resolveClipRig(sourceClip);
    if (!rig) {
      console.error(`createSkeletalMaskedAnimation: source animation must resolve to exactly one rig`);
      return null;
    }
    return createSkeletalMaskedAnimationClip(this, sourceClip, targetName, rig, options);
  }
  /**
   * Copy a humanoid animation clip from another AnimationSet into this one via humanoid rig mapping.
   *
   * Prerequisites:
   * - Both source and destination skeletons must have a non-null `humanoidJointMapping`.
   * - Joints are matched by shared `HumanoidBodyRig` / `HumanoidHandRig` keys instead of joint names.
   * - The source clip must exist in `sourceSet` and must be driven by exactly one skeleton.
   *
   * @param sourceSet - The AnimationSet to copy from.
   * @param animationName - Name of the clip to copy.
   * @param targetName - Name for the new clip in this set. Defaults to `animationName`.
   * @returns The newly created AnimationClip, or null on failure.
   */
  copyHumanoidAnimationFrom(
    sourceSet: AnimationSet,
    animationName: string,
    options?: CopyHumanoidAnimationOptions
  ): AnimationClip | null;
  copyHumanoidAnimationFrom(
    sourceSet: AnimationSet,
    animationName: string,
    targetName?: string,
    options?: CopyHumanoidAnimationOptions
  ): AnimationClip | null;
  copyHumanoidAnimationFrom(
    sourceSet: AnimationSet,
    animationName: string,
    targetNameOrOptions?: string | CopyHumanoidAnimationOptions,
    copyOptions?: CopyHumanoidAnimationOptions
  ): AnimationClip | null {
    const options =
      typeof targetNameOrOptions === 'string' ? (copyOptions ?? {}) : (targetNameOrOptions ?? {});
    const destName =
      typeof targetNameOrOptions === 'string' ? targetNameOrOptions : (options.targetName ?? animationName);
    const rootMotion = options.rootMotion ?? 'scaled';
    const jointTranslations = options.jointTranslations ?? 'skip';
    const sourceClip = sourceSet.get(animationName);
    if (!sourceClip) {
      console.error(`copyHumanoidAnimationFrom: animation '${animationName}' not found in source set`);
      return null;
    }
    if (this._animations[destName]) {
      console.error(`copyHumanoidAnimationFrom: animation '${destName}' already exists in target set`);
      return null;
    }

    const srcSkeletonId = [...sourceClip.skeletons][0] ?? '';
    const srcSkeleton = sourceSet.resolveClipRig(sourceClip);
    if (!srcSkeleton) {
      console.error(
        `copyHumanoidAnimationFrom: source animation clip must resolve to exactly one humanoid rig`
      );
      return null;
    }

    // Check that source skeleton has humanoid mapping
    const srcHumanoidMapping = srcSkeleton.humanoidJointMapping;
    if (!srcHumanoidMapping) {
      console.error(`copyHumanoidAnimationFrom: source skeleton does not have a humanoid joint mapping`);
      return null;
    }

    const nodeMap = new Map<object, SceneNode>();
    const jointRemapBySrcNode = new Map<object, JointRetargetRemap>();

    // Find a destination skeleton that has a humanoid mapping and share at least the body rig keys
    let srcJointsFiltered: SceneNode[] = [];
    let dstJointsFiltered: SceneNode[] = [];

    const dstSkeleton = this._rigs
      .map((ref) => ref.get())
      .find((sk) => {
        if (!sk) {
          return false;
        }
        // Check that destination skeleton has humanoid mapping
        const dstHumanoidMapping = sk.humanoidJointMapping;
        if (!dstHumanoidMapping) {
          return false;
        }

        // Collect matched (srcJoint, dstJoint) pairs via shared humanoid rig keys
        const srcMatched: SceneNode[] = [];
        const dstMatched: SceneNode[] = [];

        // Match body rig joints
        for (const key of Object.keys(srcHumanoidMapping.body) as (keyof typeof srcHumanoidMapping.body)[]) {
          const srcJoint = srcHumanoidMapping.body[key];
          const dstJoint = dstHumanoidMapping.body[key];
          if (srcJoint && dstJoint) {
            srcMatched.push(srcJoint);
            dstMatched.push(dstJoint);
          }
        }

        // Match left hand rig joints only when both sides define them; skip silently if either is absent
        if (srcHumanoidMapping.leftHand && dstHumanoidMapping.leftHand) {
          for (const key of Object.keys(
            srcHumanoidMapping.leftHand
          ) as (keyof typeof srcHumanoidMapping.leftHand)[]) {
            const srcJoint = srcHumanoidMapping.leftHand[key];
            const dstJoint = dstHumanoidMapping.leftHand[key];
            if (srcJoint && dstJoint) {
              srcMatched.push(srcJoint);
              dstMatched.push(dstJoint);
            }
          }
        }

        // Match right hand rig joints only when both sides define them; skip silently if either is absent
        if (srcHumanoidMapping.rightHand && dstHumanoidMapping.rightHand) {
          for (const key of Object.keys(
            srcHumanoidMapping.rightHand
          ) as (keyof typeof srcHumanoidMapping.rightHand)[]) {
            const srcJoint = srcHumanoidMapping.rightHand[key];
            const dstJoint = dstHumanoidMapping.rightHand[key];
            if (srcJoint && dstJoint) {
              srcMatched.push(srcJoint);
              dstMatched.push(dstJoint);
            }
          }
        }

        if (srcMatched.length === 0) {
          return false;
        }

        srcJointsFiltered = srcMatched;
        dstJointsFiltered = dstMatched;
        return true;
      });

    if (!dstSkeleton) {
      console.error(
        `copyHumanoidAnimationFrom: no matching humanoid skeleton in target set for '${srcSkeletonId}'`
      );
      return null;
    }

    // Compute the world-space rotation of the parent chain above a motion node,
    // walking ALL ancestor nodes up to (but not including) the model root.
    // This must include non-joint nodes such as "Armature" in Mixamo rigs, which
    // carry a 90° X rotation that is NOT captured by humanoidRootRotation (which
    // only traverses nodes inside the skeleton joints list).
    function computeParentChainRotation(
      node: SceneNode,
      modelRoot: SceneNode,
      skeleton: SkeletonRig
    ): Quaternion {
      const result = Quaternion.identity();
      const jointSet = new Set(skeleton.joints);
      let p = node.parent;
      while (p && p !== modelRoot) {
        if (!jointSet.has(p)) {
          Quaternion.multiply(p.rotation, result, result);
        }
        p = p.parent;
      }
      return result;
    }

    const srcHipsNode = srcSkeleton.humanoidJointMapping!.body[HumanoidBodyRig.Hips];
    const dstHipsNode = dstSkeleton.humanoidJointMapping!.body[HumanoidBodyRig.Hips];
    const srcRootNode = srcSkeleton.rootJoint ?? srcHipsNode;
    const dstRootNode = dstSkeleton.rootJoint ?? dstHipsNode;
    const srcRootRot = computeParentChainRotation(srcRootNode, sourceSet.model, srcSkeleton);
    const dstRootRot = computeParentChainRotation(dstRootNode, this._model, dstSkeleton);
    const srcRootTranslationTrack = findTranslationTrack(sourceClip.tracks.get(srcRootNode));
    const srcFallbackHipsTranslationTrack =
      !srcRootTranslationTrack && srcRootNode !== srcHipsNode
        ? findTranslationTrack(sourceClip.tracks.get(srcHipsNode))
        : null;
    const srcMotionTrack = srcRootTranslationTrack ?? srcFallbackHipsTranslationTrack;
    const srcMotionNode = srcRootTranslationTrack
      ? srcRootNode
      : srcFallbackHipsTranslationTrack
        ? srcHipsNode
        : null;
    const srcMotionParentRot = srcMotionNode
      ? computeParentChainRotation(srcMotionNode, sourceSet.model, srcSkeleton)
      : srcRootRot;
    const rootTranslationRotation = Quaternion.multiply(Quaternion.inverse(dstRootRot), srcMotionParentRot);
    const rootTranslationScale =
      rootMotion === 'scaled'
        ? typeof options.rootMotionScale === 'number'
          ? options.rootMotionScale
          : options.rootMotionScale === 'none'
            ? 1
            : getHumanoidRootMotionScale(srcSkeleton, dstSkeleton)
        : 1;
    const jointRemaps: JointRetargetRemap[] = [];
    const mappedSrcNodes = new Set<SceneNode>();
    const mappedDstNodes = new Set<SceneNode>();
    // Build remap for matched joint pairs
    for (let fi = 0; fi < srcJointsFiltered.length; fi++) {
      const srcJoint = srcJointsFiltered[fi];
      const dstJoint = dstJointsFiltered[fi];
      if (mappedSrcNodes.has(srcJoint) || mappedDstNodes.has(dstJoint)) {
        continue;
      }
      mappedSrcNodes.add(srcJoint);
      mappedDstNodes.add(dstJoint);
      nodeMap.set(srcJoint, dstJoint);
      const remap = createJointRetargetRemap(srcSkeleton, dstSkeleton, srcJoint, dstJoint);
      jointRemaps.push(remap);
      jointRemapBySrcNode.set(srcJoint, remap);
    }

    const dstClip = this.createAnimation(destName);
    if (!dstClip) {
      return null;
    }
    dstClip.timeDuration = sourceClip.timeDuration;
    dstClip.weight = sourceClip.weight;
    dstClip.autoPlay = sourceClip.autoPlay;

    // Register destination skeleton
    dstClip.addSkeleton(dstSkeleton.persistentId);

    bakeHumanoidRotationTracks(
      sourceClip,
      srcSkeleton,
      dstSkeleton,
      srcRootRot,
      dstRootRot,
      dstClip,
      jointRemaps
    );

    if (rootMotion !== 'none') {
      const dstRootBindPose = getRigBindPoseForNode(dstSkeleton, dstRootNode);
      let dstRootTrack: NodeTranslationTrack | null = null;
      if (rootMotion === 'locked') {
        dstRootTrack = createConstantTranslationTrack(dstRootBindPose.position);
      } else if (srcMotionTrack && srcMotionNode) {
        const srcMotionBindPose = getRigBindPoseForNode(srcSkeleton, srcMotionNode);
        const rootRemap = createTranslationRetargetRemap(
          srcMotionNode,
          dstRootNode,
          srcMotionBindPose.position,
          dstRootBindPose.position,
          dstSkeleton.joints.indexOf(dstRootNode),
          rootTranslationScale,
          rootTranslationRotation,
          options.lockRootMotionAxes
        );
        dstRootTrack = retargetTranslationTrack(srcMotionTrack, rootRemap);
      }
      if (dstRootTrack) {
        dstRootTrack.name = srcMotionTrack?.name ?? 'translation';
        dstRootTrack.target = dstRootNode.persistentId;
        dstRootTrack.jointIndex = dstSkeleton.joints.indexOf(dstRootNode);
        dstClip.addTrack(dstRootNode, dstRootTrack);
      }
    }

    for (const srcNode of srcJointsFiltered) {
      const srcTracks = sourceClip.tracks.get(srcNode);
      if (!srcTracks) {
        // Not every humanoid joint must have a track; skip silently
        continue;
      }
      const dstNode = nodeMap.get(srcNode)!;
      const remap = jointRemapBySrcNode.get(srcNode)!;

      for (const srcTrack of srcTracks) {
        let dstTrack: AnimationTrack;
        if (srcTrack instanceof NodeRotationTrack) {
          continue;
        } else if (srcTrack instanceof NodeEulerRotationTrack) {
          continue;
        } else if (srcTrack instanceof NodeTranslationTrack) {
          if (srcNode === srcRootNode || srcTrack === srcMotionTrack || jointTranslations !== 'preserve') {
            continue;
          }
          dstTrack = retargetTranslationTrack(srcTrack, remap);
        } else if (srcTrack instanceof NodeScaleTrack) {
          dstTrack = new NodeScaleTrack(cloneInterpolator(srcTrack.interpolator));
        } else {
          console.warn(
            `copyHumanoidAnimationFrom: unsupported track type '${srcTrack.constructor.name}', skipping`
          );
          continue;
        }

        dstTrack.name = srcTrack.name;
        dstTrack.target = dstNode.persistentId;
        dstTrack.jointIndex = remap.dstJointIndex;
        dstClip.addTrack(dstNode, dstTrack);
      }
    }

    return dstClip;
  }
  /**
   * Copy an animation clip from another AnimationSet into this one.
   *
   * Prerequisites:
   * - Both sets must reference skeletons with identical joint names and counts.
   * - The source clip must exist in `sourceSet`.
   *
   * @param sourceSet - The AnimationSet to copy from.
   * @param animationName - Name of the clip to copy.
   * @param targetName - Name for the new clip in this set. Defaults to `animationName`.
   * @param excludeJoint - Optional predicate; joints whose name returns true are excluded from
   *   skeleton structure matching.
   * @returns The newly created AnimationClip, or null on failure.
   *
   * @deprecated Use AnimationSet.copyHumanoidAnimationFrom instead.
   */
  copyAnimationFrom(
    sourceSet: AnimationSet,
    animationName: string,
    targetName?: string,
    excludeJoint?: (jointName: string) => boolean
  ): AnimationClip | null {
    const destName = targetName ?? animationName;
    const sourceClip = sourceSet.get(animationName);
    if (!sourceClip) {
      console.error(`copyAnimationFrom: animation '${animationName}' not found in source set`);
      return null;
    }
    if (this._animations[destName]) {
      console.error(`copyAnimationFrom: animation '${destName}' already exists in target set`);
      return null;
    }

    const srcSkeletonId = [...sourceClip.skeletons][0] ?? '';
    const srcSkeleton = sourceSet.resolveClipRig(sourceClip);
    if (!srcSkeleton) {
      console.error(`copyAnimationFrom: source animation clip must resolve to exactly one rig`);
      return null;
    }
    const nodeMap = new Map<object, SceneNode>();
    const jointRemapBySrcNode = new Map<object, JointRetargetRemap>();

    const jointsFiltered = srcSkeleton.joints.filter((j) => !excludeJoint?.(j.name));
    const srcRootNode = findRootJoint(jointsFiltered);
    if (!srcRootNode) {
      console.error(`copyAnimationFrom: cannot determine the root joint for source skeleton`);
      return null;
    }
    // Build filtered joint lists for matching (exclude joints rejected by filterJoint)
    const srcJointsFiltered = sortJoints(srcRootNode, jointsFiltered);
    if (!srcJointsFiltered) {
      console.error(`copyAnimationFrom: invalid source skeleton structure`);
      return null;
    }
    let dstJointsFiltered: SceneNode[] = [];
    const dstSkeleton = this._rigs
      .map((ref) => ref.get())
      .find((sk) => {
        if (!sk) {
          return false;
        }
        const jointsFiltered = sk.joints.filter((j) => !excludeJoint?.(j.name));
        if (jointsFiltered.length !== srcJointsFiltered.length) {
          return false;
        }
        const rootNode = findRootJoint(jointsFiltered);
        if (!rootNode) {
          return false;
        }
        const sortedJointsFiltered = sortJoints(rootNode, jointsFiltered);
        if (
          sortedJointsFiltered &&
          srcJointsFiltered.every((j, i) => j.name === sortedJointsFiltered[i].name)
        ) {
          dstJointsFiltered = sortedJointsFiltered;
          return true;
        }
        return false;
      });
    if (!dstJointsFiltered || !dstSkeleton) {
      console.error(`copyAnimationFrom: no matching skeleton in target set for '${srcSkeletonId}'`);
      return null;
    }
    // Build remap only for joints that pass the filter
    for (let fi = 0; fi < srcJointsFiltered.length; fi++) {
      const srcJoint = srcJointsFiltered[fi];
      const dstJoint = dstJointsFiltered[fi];
      nodeMap.set(srcJoint, dstJoint);
      jointRemapBySrcNode.set(
        srcJoint,
        createJointRetargetRemap(srcSkeleton, dstSkeleton, srcJoint, dstJoint)
      );
    }

    const dstClip = this.createAnimation(destName);
    if (!dstClip) {
      return null;
    }
    dstClip.timeDuration = sourceClip.timeDuration;
    dstClip.weight = sourceClip.weight;
    dstClip.autoPlay = sourceClip.autoPlay;

    // Register destination skeleton
    dstClip.addSkeleton(dstSkeleton.persistentId);

    for (const srcNode of srcJointsFiltered) {
      const srcTracks = sourceClip.tracks.get(srcNode);
      if (!srcTracks) {
        console.error(`copyAnimationFrom: no track for joint: ${srcNode.name}`);
        return null;
      }
      const dstNode = nodeMap.get(srcNode)!;
      const remap = jointRemapBySrcNode.get(srcNode)!;

      for (const srcTrack of srcTracks) {
        let dstTrack: AnimationTrack;
        if (srcTrack instanceof NodeRotationTrack) {
          dstTrack = retargetRotationTrack(srcTrack, remap);
        } else if (srcTrack instanceof NodeEulerRotationTrack) {
          dstTrack = retargetEulerToRotationTrack(srcTrack, remap);
        } else if (srcTrack instanceof NodeTranslationTrack) {
          dstTrack = retargetTranslationTrack(srcTrack, remap);
        } else if (srcTrack instanceof NodeScaleTrack) {
          dstTrack = new NodeScaleTrack(cloneInterpolator(srcTrack.interpolator));
        } else {
          console.warn(`copyAnimationFrom: unsupported track type '${srcTrack.constructor.name}', skipping`);
          continue;
        }

        dstTrack.name = srcTrack.name;
        dstTrack.target = dstNode.persistentId;
        dstTrack.jointIndex = remap.dstJointIndex;
        dstClip.addTrack(dstNode, dstTrack);
      }
    }

    return dstClip;

    function findRootJoint(joints: SceneNode[]) {
      let root: Nullable<SceneNode> = null;
      for (const joint of joints) {
        if (!root) {
          root = joint;
        }
        while (!root!.isParentOf(joint)) {
          root = root!.parent;
        }
        if (!root) {
          break;
        }
      }
      if (!root || !joints.includes(root)) {
        return null;
      }
      return root;
    }

    function sortJoints(root: SceneNode, joints: SceneNode[]): Nullable<SceneNode[]> {
      const ordered: SceneNode[] = [];
      const visited = new Set<SceneNode>();
      function visit(joint: SceneNode) {
        if (visited.has(joint)) {
          return true;
        }
        if (!joints.includes(joint)) {
          return false;
        }
        if (joint !== root) {
          visit(joint.parent!);
        }
        visited.add(joint);
        ordered.push(joint);
        return true;
      }
      for (const joint of joints) {
        if (!visit(joint)) {
          return null;
        }
      }
      return ordered;
    }
  }

  /**
   * Reset all skeleton modifiers
   */
  resetSkeletonModifiers() {
    for (const sk of this._skeletons) {
      for (const modifier of sk.get()!.modifiers) {
        modifier.reset();
      }
    }
  }

  /**
   * Dispose the animation set and release owned resources.
   *
   * - Disposes the weak reference to the model.
   * - Disposes all registered animation clips.
   * - Clears active animations, tracks, and skeleton references.
   */
  protected onDispose() {
    super.onDispose();
    for (const k in this._animations) {
      this._animations[k]!.dispose();
    }
    this._animations = {};
    this._activeAnimations.clear();
    this._activeSkinBindings.clear();
    this._activeRigs.clear();
    this._activeTracks.clear();
  }
}
