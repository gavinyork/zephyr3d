import {
  weightedAverage,
  Disposable,
  Interpolator,
  Vector3,
  Observable,
  makeObservable
} from '@zephyr3d/base';
import type { DRef, IDisposable, Nullable } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../scene';
import { AnimationClip } from './animation';
import type { AnimationMarker, AnimationTimeRef } from './animation';
import type { AnimationTrack } from './animationtrack';
import { NodeRotationTrack } from './rotationtrack';
import { NodeEulerRotationTrack } from './eulerrotationtrack';
import { NodeTranslationTrack } from './translationtrack';
import { NodeScaleTrack } from './scaletrack';
import { MorphTargetGroupTrack } from './morphtargetgrouptrack';
import type { SkeletonBindPose, SkeletonRig, SkinBinding } from './skeleton';
import { HumanoidBodyRig } from './skeleton';
import type { SkeletalAnimationMaskOptions } from './animationmask';
import { createSkeletalMaskedAnimationClip } from './animationmask';

/**
 * How a new playback copies phase from an existing active playback.
 *
 * - `'normalized'`: copy the source playback's normalized phase and map it into the new clip.
 * - `'time'`: copy the source playback's time in seconds.
 *
 * @public
 */
export type AnimationPlaybackSyncMode = 'normalized' | 'time';

/**
 * Options for starting a playback at the same phase as another active playback.
 *
 * Use this when switching between matching locomotion clips, upper/lower body clips, or a
 * layered setup and a full-body clip that must stay phase-aligned.
 *
 * @public
 */
export type AnimationPlaybackSyncOptions = {
  /**
   * Active playback to synchronize with.
   *
   * The value is resolved as an active clip name first, then as an active playback id. Timeline
   * `play` steps also resolve local `id` references before forwarding the options to
   * `AnimationSet`.
   */
  target: string;
  /**
   * Synchronization mode. Defaults to `'normalized'`.
   */
  mode?: AnimationPlaybackSyncMode;
  /**
   * Optional phase offset.
   *
   * In `'normalized'` mode this is a normalized phase offset where 1 is one full cycle. In
   * `'time'` mode this is an offset in seconds.
   */
  offset?: number;
  /**
   * Whether the synchronized time wraps into the destination clip or range. Defaults to true.
   *
   * Set to false to clamp the initial time to the destination clip or range.
   */
  wrap?: boolean;
};

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
   * Fade-out duration in seconds used after the playback completes naturally.
   *
   * When greater than 0, the playback emits `complete` at the authored end time but remains active
   * for this duration while its weight fades to 0. This lets a following playback cross-fade from
   * the completed pose instead of snapping after the completed clip is removed.
   */
  completionFadeOut?: number;
  /**
   * Weight of the animation clip.
   *
   * Used during blending when multiple animations affect the same property.
   * Default is the clip's configured weight.
   */
  weight?: number;
  /**
   * Optional stable playback id. Useful for blueprint/editor references.
   */
  id?: string;
  /**
   * Logical layer/channel name used by higher-level controllers.
   */
  layer?: string;
  /**
   * Priority used by higher-level interrupt policies.
   */
  priority?: number;
  /**
   * Whether higher-level controllers may interrupt this playback.
   */
  interruptible?: boolean;
  /**
   * Optional sub-range to play.
   */
  range?: {
    start?: AnimationTimeRef;
    end?: AnimationTimeRef;
  };
  /**
   * Optional phase synchronization source used to choose the initial playback time.
   *
   * When omitted, playback starts at the range start (or clip start), and reverse playback starts
   * at the range end (or clip end). When set, the new playback starts at the phase copied from the
   * referenced active playback.
   */
  sync?: AnimationPlaybackSyncOptions;
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
  /**
   * Stop reason reported by playback events.
   */
  reason?: AnimationStopReason;
};

/** @public */
export type AnimationPlaybackState =
  | 'scheduled'
  | 'playing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'completed';

/** @public */
export type AnimationStopReason = 'manual' | 'interrupted' | 'completed' | 'deleted' | 'replaced';

/** @public */
export type AnimationPlaybackEvent = {
  playback: AnimationPlayback;
  animationSet: AnimationSet;
  clip: AnimationClip;
  time: number;
  normalizedTime: number;
};

/** @public */
export type AnimationMarkerEvent = AnimationPlaybackEvent & {
  marker: AnimationMarker;
  direction: 1 | -1;
};

/** @public */
export type AnimationFrameEvent = AnimationPlaybackEvent & {
  frame: number;
};

/** @public */
export type AnimationPlaybackStopEvent = AnimationPlaybackEvent & {
  reason: AnimationStopReason;
};

/** @public */
export type AnimationPlaybackEventMap = {
  start: [event: AnimationPlaybackEvent];
  loop: [event: AnimationPlaybackEvent];
  marker: [event: AnimationMarkerEvent];
  frame: [event: AnimationFrameEvent];
  complete: [event: AnimationPlaybackEvent];
  stop: [event: AnimationPlaybackStopEvent];
  pause: [event: AnimationPlaybackEvent];
  resume: [event: AnimationPlaybackEvent];
};

/** @public */
export type AnimationSetEventMap = {
  playbackstart: [event: AnimationPlaybackEvent];
  playbackloop: [event: AnimationPlaybackEvent];
  marker: [event: AnimationMarkerEvent];
  frame: [event: AnimationFrameEvent];
  playbackcomplete: [event: AnimationPlaybackEvent];
  playbackstop: [event: AnimationPlaybackStopEvent];
  playbackpause: [event: AnimationPlaybackEvent];
  playbackresume: [event: AnimationPlaybackEvent];
};

let nextAnimationPlaybackId = 1;

/**
 * Runtime handle for one playback of an AnimationClip.
 * @public
 */
export class AnimationPlayback extends Observable<AnimationPlaybackEventMap> {
  /** @internal */
  private readonly _animationSet: AnimationSet;
  /** @internal */
  private readonly _clip: AnimationClip;
  /** @internal */
  private readonly _options: PlayAnimationOptions;
  /** @internal */
  private readonly _id: string;
  /** @internal */
  private readonly _frameWaiters: Map<number, ((event: AnimationFrameEvent | undefined) => void)[]>;
  /** @internal */
  private _state: AnimationPlaybackState;
  /** @internal */
  private _time: number;
  /** @internal */
  private _weight: number;
  /** @internal */
  private _speedRatio: number;
  /** @internal */
  private _layer: string;
  /** @internal */
  private _priority: number;
  /** @internal */
  private _interruptible: boolean;

  constructor(animationSet: AnimationSet, clip: AnimationClip, options?: PlayAnimationOptions) {
    super();
    this._animationSet = animationSet;
    this._clip = clip;
    this._options = { ...(options ?? {}) };
    this._id = this._options.id ?? `animation-playback-${nextAnimationPlaybackId++}`;
    this._state = 'scheduled';
    this._speedRatio = this._options.speedRatio ?? 1;
    this._weight = this._options.weight ?? clip.weight ?? 1;
    this._time = this._speedRatio < 0 ? clip.timeDuration : 0;
    this._layer = this._options.layer ?? 'default';
    this._priority = this._options.priority ?? 0;
    this._interruptible = this._options.interruptible ?? true;
    this._frameWaiters = new Map();
  }
  get id() {
    return this._id;
  }
  get animationSet() {
    return this._animationSet;
  }
  get clip() {
    return this._clip;
  }
  get state() {
    return this._state;
  }
  get time() {
    return this._time;
  }
  set time(value: number) {
    this.seek(value);
  }
  get normalizedTime() {
    return this._clip.timeDuration > 0 ? this._time / this._clip.timeDuration : 0;
  }
  set normalizedTime(value: number) {
    this.seek(value * this._clip.timeDuration);
  }
  get weight() {
    return this._weight;
  }
  set weight(value: number) {
    this._animationSet.setPlaybackWeight(this, value);
  }
  get speedRatio() {
    return this._speedRatio;
  }
  set speedRatio(value: number) {
    this._animationSet.setPlaybackSpeedRatio(this, value);
  }
  get layer() {
    return this._layer;
  }
  get priority() {
    return this._priority;
  }
  get interruptible() {
    return this._interruptible;
  }
  play() {
    this._animationSet.startPlayback(this);
    return this;
  }
  pause() {
    this._animationSet.pausePlayback(this);
    return this;
  }
  resume() {
    this._animationSet.resumePlayback(this);
    return this;
  }
  stop(options?: StopAnimationOptions) {
    this._animationSet.stopPlayback(this, options);
    return this;
  }
  seek(time: number, options?: { emitEvents?: boolean; apply?: boolean }) {
    this._animationSet.seekPlayback(this, time, options);
    return this;
  }
  fadeTo(weight: number, duration: number) {
    this._animationSet.fadePlaybackTo(this, weight, duration);
    return this;
  }
  crossFadeTo(name: string, options?: PlayAnimationOptions & { duration?: number }) {
    const duration = Math.max(options?.duration ?? 0, 0);
    this.stop({ fadeOut: duration, reason: 'interrupted' });
    return this._animationSet.play(name, { ...options, fadeIn: duration });
  }
  waitForComplete() {
    return new Promise<this>((resolve) => {
      this.once('complete', () => resolve(this));
    });
  }
  waitForMarker(idOrName: string) {
    if (this._state === 'stopped' || this._state === 'completed') {
      return Promise.resolve(undefined);
    }
    return new Promise<AnimationMarkerEvent | undefined>((resolve) => {
      const handler = (event: AnimationMarkerEvent) => {
        if (event.marker.id === idOrName || event.marker.name === idOrName) {
          this.off('marker', handler);
          this.off('stop', stop);
          resolve(event);
        }
      };
      const stop = () => {
        this.off('marker', handler);
        this.off('stop', stop);
        resolve(undefined);
      };
      this.on('marker', handler);
      this.on('stop', stop);
    });
  }
  waitForFrame(frame: number) {
    if (this._state === 'stopped' || this._state === 'completed') {
      return Promise.resolve(undefined);
    }
    return new Promise<AnimationFrameEvent | undefined>((resolve) => {
      const waiters = this._frameWaiters.get(frame) ?? [];
      let settled = false;
      let stop: () => void;
      const wrappedResolve = (event: AnimationFrameEvent | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        this.off('stop', stop);
        resolve(event);
      };
      stop = () => {
        const current = this._frameWaiters.get(frame);
        if (current) {
          this._frameWaiters.set(
            frame,
            current.filter((item) => item !== wrappedResolve)
          );
        }
        wrappedResolve(undefined);
      };
      waiters.push(wrappedResolve);
      this._frameWaiters.set(frame, waiters);
      this.on('stop', stop);
    });
  }
  /** @internal */
  _getOptions() {
    return this._options;
  }
  /** @internal */
  _setState(state: AnimationPlaybackState) {
    this._state = state;
  }
  /** @internal */
  _setTime(time: number) {
    this._time = time;
  }
  /** @internal */
  _setWeight(weight: number) {
    this._weight = weight;
  }
  /** @internal */
  _setSpeedRatio(speedRatio: number) {
    this._speedRatio = speedRatio;
  }
  /** @internal */
  _getWatchedFrames() {
    return [...this._frameWaiters.keys()];
  }
  /** @internal */
  _emitStart(event: AnimationPlaybackEvent) {
    this.dispatchEvent('start', event);
  }
  /** @internal */
  _emitLoop(event: AnimationPlaybackEvent) {
    this.dispatchEvent('loop', event);
  }
  /** @internal */
  _emitMarker(event: AnimationMarkerEvent) {
    this.dispatchEvent('marker', event);
  }
  /** @internal */
  _emitFrame(event: AnimationFrameEvent) {
    this.dispatchEvent('frame', event);
    const waiters = this._frameWaiters.get(event.frame);
    if (waiters) {
      this._frameWaiters.delete(event.frame);
      waiters.forEach((resolve) => resolve(event));
    }
  }
  /** @internal */
  _emitComplete(event: AnimationPlaybackEvent) {
    this.dispatchEvent('complete', event);
  }
  /** @internal */
  _emitStop(event: AnimationPlaybackStopEvent) {
    this.dispatchEvent('stop', event);
  }
  /** @internal */
  _emitPause(event: AnimationPlaybackEvent) {
    this.dispatchEvent('pause', event);
  }
  /** @internal */
  _emitResume(event: AnimationPlaybackEvent) {
    this.dispatchEvent('resume', event);
  }
}

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
  rotationCorrection?: HumanoidRotationCorrection;
  srcBindPos: Vector3;
  dstBindPos: Vector3;
  translationScale: number;
  translationRotation?: Quaternion;
  translationCorrection?: HumanoidRotationCorrection;
  translationAxisLocks?: HumanoidRetargetAxisLocks;
};

type BindTransform = {
  position: Vector3;
  rotation: Quaternion;
};

type HumanoidRotationCorrection = {
  x: number;
  y: number;
  z: number;
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
  translationCorrection?: HumanoidRotationCorrection,
  translationAxisLocks?: HumanoidRetargetAxisLocks,
  rotationCorrection?: HumanoidRotationCorrection
): JointRetargetRemap {
  const si = srcSkeleton.joints.indexOf(srcJoint);
  const di = dstSkeleton.joints.indexOf(dstJoint);
  const srcBindPose = srcSkeleton.retargetPose[si];
  const dstBindPose = dstSkeleton.retargetPose[di];
  const srcLen = srcBindPose.position.magnitude;
  const dstLen = dstBindPose.position.magnitude;
  return {
    dstNode: dstJoint,
    dstJointIndex: di,
    srcNode: srcJoint,
    srcBindRotInv: Quaternion.inverse(srcBindPose.rotation),
    dstBindRot: dstBindPose.rotation.clone(),
    rotationCorrection,
    srcBindPos: srcBindPose.position.clone(),
    dstBindPos: dstBindPose.position.clone(),
    translationScale: translationScale ?? (srcLen > 1e-6 ? dstLen / srcLen : 1),
    translationRotation,
    translationCorrection,
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
  translationCorrection?: HumanoidRotationCorrection,
  translationAxisLocks?: HumanoidRetargetAxisLocks,
  rotationCorrection?: HumanoidRotationCorrection
): JointRetargetRemap {
  return {
    dstNode,
    dstJointIndex,
    srcNode,
    srcBindRotInv: Quaternion.identity(),
    dstBindRot: Quaternion.identity(),
    rotationCorrection,
    srcBindPos: srcBindPos.clone(),
    dstBindPos: dstBindPos.clone(),
    translationScale,
    translationRotation,
    translationCorrection,
    translationAxisLocks
  };
}

function getReferencePosition(skeleton: SkeletonRig, joint: SceneNode): Vector3 | null {
  const index = skeleton.joints.indexOf(joint);
  return index >= 0 ? skeleton.retargetPose[index].position : null;
}

function getSkeletonLocalReferenceTransform(
  skeleton: SkeletonRig,
  node: SceneNode,
  jointSet: Set<SceneNode>,
  cache: Map<SceneNode, BindTransform>
): BindTransform {
  let transform = cache.get(node);
  if (!transform) {
    const bindPose = getRigReferencePoseForNode(skeleton, node);
    const position = bindPose.position.clone();
    const rotation = bindPose.rotation.clone();
    const parent = node.parent;
    if (parent && jointSet.has(parent)) {
      const parentTransform = getSkeletonLocalReferenceTransform(skeleton, parent, jointSet, cache);
      parentTransform.rotation.transform(position, position);
      position.addBy(parentTransform.position);
      Quaternion.multiply(parentTransform.rotation, rotation, rotation);
    }
    transform = { position, rotation };
    cache.set(node, transform);
  }
  return transform;
}

function getHumanoidLateralXSign(skeleton: SkeletonRig): number {
  const mapping = skeleton.humanoidJointMapping;
  if (!mapping) {
    return 0;
  }
  const pairs: [HumanoidBodyRig, HumanoidBodyRig][] = [
    [HumanoidBodyRig.LeftShoulder, HumanoidBodyRig.RightShoulder],
    [HumanoidBodyRig.LeftUpperArm, HumanoidBodyRig.RightUpperArm],
    [HumanoidBodyRig.LeftLowerArm, HumanoidBodyRig.RightLowerArm],
    [HumanoidBodyRig.LeftHand, HumanoidBodyRig.RightHand],
    [HumanoidBodyRig.LeftUpperLeg, HumanoidBodyRig.RightUpperLeg],
    [HumanoidBodyRig.LeftLowerLeg, HumanoidBodyRig.RightLowerLeg],
    [HumanoidBodyRig.LeftFoot, HumanoidBodyRig.RightFoot],
    [HumanoidBodyRig.LeftToes, HumanoidBodyRig.RightToes]
  ];
  const jointSet = new Set(skeleton.joints);
  const cache = new Map<SceneNode, BindTransform>();
  let score = 0;
  let weight = 0;
  for (const [leftKey, rightKey] of pairs) {
    const left = mapping.body[leftKey];
    const right = mapping.body[rightKey];
    if (!left || !right || !jointSet.has(left) || !jointSet.has(right)) {
      continue;
    }
    const dx =
      getSkeletonLocalReferenceTransform(skeleton, left, jointSet, cache).position.x -
      getSkeletonLocalReferenceTransform(skeleton, right, jointSet, cache).position.x;
    if (Math.abs(dx) > 1e-5) {
      score += dx;
      weight++;
    }
  }
  if (weight === 0 || Math.abs(score) < 1e-5) {
    return 0;
  }
  return score > 0 ? 1 : -1;
}

function getHumanoidForwardZSign(skeleton: SkeletonRig): number {
  const mapping = skeleton.humanoidJointMapping;
  if (!mapping) {
    return 0;
  }
  const pairs: [HumanoidBodyRig, HumanoidBodyRig][] = [
    [HumanoidBodyRig.LeftFoot, HumanoidBodyRig.LeftToes],
    [HumanoidBodyRig.RightFoot, HumanoidBodyRig.RightToes]
  ];
  const jointSet = new Set(skeleton.joints);
  const cache = new Map<SceneNode, BindTransform>();
  let score = 0;
  let weight = 0;
  for (const [footKey, toesKey] of pairs) {
    const foot = mapping.body[footKey];
    const toes = mapping.body[toesKey];
    if (!foot || !toes || !jointSet.has(foot) || !jointSet.has(toes)) {
      continue;
    }
    const dz =
      getSkeletonLocalReferenceTransform(skeleton, toes, jointSet, cache).position.z -
      getSkeletonLocalReferenceTransform(skeleton, foot, jointSet, cache).position.z;
    if (Math.abs(dz) > 1e-5) {
      score += dz;
      weight++;
    }
  }
  if (weight === 0 || Math.abs(score) < 1e-5) {
    return 0;
  }
  return score > 0 ? 1 : -1;
}

function getHumanoidSignFromSkeletons(
  skeletons: SkeletonRig[],
  getSign: (skeleton: SkeletonRig) => number
): number {
  let score = 0;
  for (const skeleton of skeletons) {
    score += getSign(skeleton);
  }
  return score > 0 ? 1 : score < 0 ? -1 : 0;
}

function getHumanoidRotationCorrection(
  srcSkeleton: SkeletonRig,
  dstSkeleton: SkeletonRig,
  srcSignSkeletons: SkeletonRig[] = [srcSkeleton],
  dstSignSkeletons: SkeletonRig[] = [dstSkeleton]
): HumanoidRotationCorrection | null {
  const srcLateralXSign =
    getHumanoidLateralXSign(srcSkeleton) ||
    getHumanoidSignFromSkeletons(srcSignSkeletons, getHumanoidLateralXSign);
  const dstLateralXSign =
    getHumanoidLateralXSign(dstSkeleton) ||
    getHumanoidSignFromSkeletons(dstSignSkeletons, getHumanoidLateralXSign);
  const srcForwardZSign =
    getHumanoidForwardZSign(srcSkeleton) ||
    getHumanoidSignFromSkeletons(srcSignSkeletons, getHumanoidForwardZSign);
  const dstForwardZSign =
    getHumanoidForwardZSign(dstSkeleton) ||
    getHumanoidSignFromSkeletons(dstSignSkeletons, getHumanoidForwardZSign);
  const axisXSign = srcLateralXSign && dstLateralXSign && srcLateralXSign !== dstLateralXSign ? -1 : 1;
  const axisZSign = srcForwardZSign && dstForwardZSign && srcForwardZSign !== dstForwardZSign ? -1 : 1;
  if (axisXSign === 1 && axisZSign === 1) {
    return null;
  }
  const determinant = axisXSign * axisZSign;
  return {
    x: determinant * axisXSign,
    y: determinant,
    z: determinant * axisZSign
  };
}

function getRigReferencePoseForNode(skeleton: SkeletonRig, node: SceneNode): SkeletonBindPose {
  return (
    skeleton.getRetargetPoseForJoint(node) ??
    (node === skeleton.rootJoint
      ? skeleton.rootBindPose
      : {
          position: node.position,
          rotation: node.rotation,
          scale: node.scale
        })
  );
}

function getReferenceDistanceToAncestor(
  skeleton: SkeletonRig,
  joint: SceneNode,
  ancestor: SceneNode
): number {
  let distance = 0;
  let node: SceneNode | null = joint;
  while (node && node !== ancestor) {
    const bindPosition = getReferencePosition(skeleton, node);
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
    getReferenceDistanceToAncestor(skeleton, foot, hips),
    getReferenceDistanceToAncestor(skeleton, toes, hips)
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

function findAncestorTranslationTrack(
  clip: AnimationClip,
  node: SceneNode,
  modelRoot: SceneNode
): { node: SceneNode; track: NodeTranslationTrack } | null {
  let current = node.parent;
  while (current) {
    const track = findTranslationTrack(clip.tracks.get(current));
    if (track) {
      return { node: current, track };
    }
    if (current === modelRoot) {
      break;
    }
    current = current.parent;
  }
  return null;
}

function copyMorphTargetGroupTracks(sourceClip: AnimationClip, targetClip: AnimationClip, target: SceneNode) {
  for (const tracks of sourceClip.tracks.values()) {
    for (const track of tracks) {
      if (track instanceof MorphTargetGroupTrack) {
        const cloned = track.clone();
        cloned.name = track.name;
        cloned.target = target.persistentId;
        targetClip.addTrack(target, cloned);
      }
    }
  }
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
  if (remap.rotationCorrection) {
    applyHumanoidRotationCorrection(out, remap.rotationCorrection, out);
  }
  return out.inplaceNormalize();
}

function retargetRotationTangent(
  qSrcTangent: Quaternion,
  remap: JointRetargetRemap,
  out: Quaternion
): Quaternion {
  Quaternion.multiply(remap.srcBindRotInv, qSrcTangent, out);
  Quaternion.multiply(remap.dstBindRot, out, out);
  if (remap.rotationCorrection) {
    applyHumanoidRotationCorrection(out, remap.rotationCorrection, out);
  }
  return out;
}

function applyHumanoidRotationCorrection(
  q: Quaternion,
  correction: HumanoidRotationCorrection,
  out: Quaternion
): Quaternion {
  return out.setXYZW(q.x * correction.x, q.y * correction.y, q.z * correction.z, q.w);
}

function applyHumanoidTranslationCorrection(
  value: Vector3,
  correction: HumanoidRotationCorrection,
  out: Vector3
): Vector3 {
  return out.setXYZ(value.x * correction.x, value.y * correction.y, value.z * correction.z);
}

function retargetTranslationValue(srcValue: Vector3, remap: JointRetargetRemap, out: Vector3): Vector3 {
  out.setXYZ(srcValue.x, srcValue.y, srcValue.z);
  out.subBy(remap.srcBindPos);
  out.scaleBy(remap.translationScale);
  if (remap.translationRotation) {
    remap.translationRotation.transform(out, out);
  }
  if (remap.translationCorrection) {
    applyHumanoidTranslationCorrection(out, remap.translationCorrection, out);
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
  if (remap.translationCorrection) {
    applyHumanoidTranslationCorrection(out, remap.translationCorrection, out);
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
  remaps: JointRetargetRemap[],
  rotationCorrection: HumanoidRotationCorrection | null
) {
  const rotationTracksByRemap = new Map<
    JointRetargetRemap,
    NodeRotationTrack | NodeEulerRotationTrack | null
  >();
  const times = new Set<number>([0, sourceClip.timeDuration]);
  const remapsByDstNode = new Map<object, JointRetargetRemap>();
  const srcJointSet = new Set(srcSkeleton.joints);
  const dstJointSet = new Set(dstSkeleton.joints);
  const srcReferenceRotByNode = new Map<SceneNode, Quaternion>();
  const srcBaseRotByNode = new Map<SceneNode, Quaternion>();
  const dstReferenceRotByNode = new Map<SceneNode, Quaternion>();
  const srcRotationTrackByNode = new Map<SceneNode, NodeRotationTrack | NodeEulerRotationTrack | null>();

  for (let i = 0; i < srcSkeleton.joints.length; i++) {
    const joint = srcSkeleton.joints[i];
    srcReferenceRotByNode.set(joint, srcSkeleton.retargetPose[i].rotation);
    srcBaseRotByNode.set(joint, srcSkeleton.bindPose[i].rotation);
    const track = findRotationTrack(sourceClip.tracks.get(joint));
    srcRotationTrackByNode.set(joint, track);
    collectTrackTimes(track, times);
  }
  for (let i = 0; i < dstSkeleton.joints.length; i++) {
    dstReferenceRotByNode.set(dstSkeleton.joints[i], dstSkeleton.retargetPose[i].rotation);
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
  const tmpRootDelta = new Quaternion();
  const tmpParentInv = new Quaternion();
  const srcRootRotationInv = Quaternion.inverse(srcRootRotation);
  const dstRootRotationInv = Quaternion.inverse(dstRootRotation);

  for (const remap of remaps) {
    outputsByRemap.set(remap, new Float32Array(inputs.length * 4));
  }

  function getSrcBindWorldRot(node: SceneNode): Quaternion {
    let rot = srcBindWorldRots.get(node);
    if (!rot) {
      rot = (srcReferenceRotByNode.get(node) ?? Quaternion.identity()).clone();
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
      rot = (dstReferenceRotByNode.get(node) ?? Quaternion.identity()).clone();
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
      srcBaseRotByNode.get(node) ?? Quaternion.identity(),
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
    if (rotationCorrection) {
      Quaternion.multiply(srcRootRotationInv, tmpWorldDelta, tmpRootDelta);
      Quaternion.multiply(tmpRootDelta, srcRootRotation, tmpRootDelta);
      applyHumanoidRotationCorrection(tmpRootDelta, rotationCorrection, tmpRootDelta);
      Quaternion.multiply(dstRootRotation, tmpRootDelta, tmpWorldDelta);
      Quaternion.multiply(tmpWorldDelta, dstRootRotationInv, tmpWorldDelta);
    }
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
      rot = (dstReferenceRotByNode.get(parent) ?? Quaternion.identity()).clone();
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
    if (!rotationTracksByRemap.get(remap) && !srcSkeleton.hasRetargetPose && !dstSkeleton.hasRetargetPose) {
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

type ActiveAnimationInfo = {
  playback: AnimationPlayback;
  currentTime: number;
  repeat: number;
  repeatCounter: number;
  weight: number;
  targetWeight: number;
  speedRatio: number;
  firstFrame: boolean;
  started: boolean;
  paused: boolean;
  fadeIn: number;
  fadeOut: number;
  fadeOutStart: number;
  fadeToStart: number;
  fadeToDuration: number;
  fadeFromWeight: number;
  fadeTargetWeight: number;
  animateTime: number;
  stopReason: AnimationStopReason;
  completed: boolean;
  rangeStart: number | null;
  rangeEnd: number | null;
};

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
export class AnimationSet extends makeObservable(Disposable)<AnimationSetEventMap>() implements IDisposable {
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
  private readonly _activeAnimations: Map<AnimationClip, ActiveAnimationInfo>;
  /**
   * Callbacks driven by the same logical clock as the animations (see {@link update}).
   *
   * Used by higher-level constructs (e.g. timeline runners) that need to advance
   * wall-clock-independent timers in sync with playback, so they pause/scale with the
   * game clock instead of running on real time.
   * @internal
   */
  private readonly _timelineTickers: Set<(deltaInSeconds: number) => void>;
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
    this._timelineTickers = new Set();
  }
  /**
   * Register a callback advanced by {@link update} using the same delta time as the animations.
   * @internal
   */
  _registerTimelineTicker(ticker: (deltaInSeconds: number) => void) {
    this._timelineTickers.add(ticker);
  }
  /**
   * Unregister a callback previously registered with {@link _registerTimelineTicker}.
   * @internal
   */
  _unregisterTimelineTicker(ticker: (deltaInSeconds: number) => void) {
    this._timelineTickers.delete(ticker);
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
      if (!v.started) {
        v.started = true;
        const event = this.createPlaybackEvent(v, k);
        v.playback._emitStart(event);
        this.dispatchEvent('playbackstart', event);
      }
      if (v.paused) {
        return;
      }
      if (v.fadeOut > 0 && v.fadeOutStart < 0) {
        v.fadeOutStart = v.animateTime;
      }
      if (v.completed) {
        v.animateTime += Math.abs(deltaInSeconds * v.speedRatio);
        if (v.fadeOut > 0 && v.animateTime - v.fadeOutStart >= v.fadeOut) {
          this.stopAnimation(k.name, { reason: v.stopReason });
        }
        return;
      }
      // Update animation time
      if (v.firstFrame) {
        v.firstFrame = false;
      } else {
        const previousTime = v.currentTime;
        const timeAdvance = deltaInSeconds * v.speedRatio;
        v.currentTime += timeAdvance;
        v.animateTime += timeAdvance;
        const direction: 1 | -1 = timeAdvance >= 0 ? 1 : -1;
        if (k.timeDuration > 0) {
          if (v.rangeEnd !== null && v.speedRatio >= 0 && v.currentTime >= v.rangeEnd) {
            v.currentTime = v.rangeEnd;
            v.playback._setTime(v.currentTime);
            this.completePlayback(k, v);
            return;
          } else if (v.rangeStart !== null && v.speedRatio < 0 && v.currentTime <= v.rangeStart) {
            v.currentTime = v.rangeStart;
            v.playback._setTime(v.currentTime);
            this.completePlayback(k, v);
            return;
          } else if (v.currentTime > k.timeDuration) {
            const loops = Math.max(1, Math.floor(v.currentTime / k.timeDuration));
            if (v.repeat !== 0 && v.repeatCounter + loops >= v.repeat) {
              v.repeatCounter += loops;
              v.currentTime = k.timeDuration;
              v.playback._setTime(v.currentTime);
              this.emitCrossedMarkers(v, k, previousTime, v.currentTime, direction);
              this.emitCrossedFrames(v, k, previousTime, v.currentTime, direction);
              this.completePlayback(k, v);
              return;
            }
            v.repeatCounter += loops;
            v.currentTime %= k.timeDuration;
            const event = this.createPlaybackEvent(v, k);
            v.playback._emitLoop(event);
            this.dispatchEvent('playbackloop', event);
          } else if (v.currentTime < 0) {
            const loops = Math.max(1, Math.ceil(-v.currentTime / k.timeDuration));
            if (v.repeat !== 0 && v.repeatCounter + loops >= v.repeat) {
              v.repeatCounter += loops;
              v.currentTime = 0;
              v.playback._setTime(v.currentTime);
              this.emitCrossedMarkers(v, k, previousTime, v.currentTime, direction);
              this.emitCrossedFrames(v, k, previousTime, v.currentTime, direction);
              this.completePlayback(k, v);
              return;
            }
            v.repeatCounter += loops;
            v.currentTime = ((v.currentTime % k.timeDuration) + k.timeDuration) % k.timeDuration;
            const event = this.createPlaybackEvent(v, k);
            v.playback._emitLoop(event);
            this.dispatchEvent('playbackloop', event);
          }
        }
        v.playback._setTime(v.currentTime);
        this.emitCrossedMarkers(v, k, previousTime, v.currentTime, direction);
        this.emitCrossedFrames(v, k, previousTime, v.currentTime, direction);
        if (v.repeat !== 0 && v.repeatCounter >= v.repeat) {
          this.completePlayback(k, v);
        } else if (v.fadeOut > 0) {
          if (v.animateTime - v.fadeOutStart >= v.fadeOut) {
            this.stopAnimation(k.name, { reason: v.stopReason });
          }
        }
        if (v.fadeToDuration > 0) {
          const t = Math.min(1, (v.animateTime - v.fadeToStart) / v.fadeToDuration);
          v.weight = v.fadeFromWeight + (v.fadeTargetWeight - v.fadeFromWeight) * t;
          v.playback._setWeight(v.weight);
          if (t >= 1) {
            v.fadeToDuration = 0;
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
    // Advance logical-clock timers (e.g. timeline `wait` steps) with the same delta time,
    // so they stay in sync with playback and pause/scale with the game clock.
    if (this._timelineTickers.size > 0) {
      this._timelineTickers.forEach((ticker) => ticker(deltaInSeconds));
    }
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
      info.targetWeight = weight;
      info.playback._setWeight(weight);
    }
  }
  /**
   * Create a playback handle without starting it.
   */
  createPlayback(name: string, options?: PlayAnimationOptions) {
    const ani = this._animations[name];
    if (!ani) {
      console.error(`Animation ${name} not exists`);
      return null;
    }
    return new AnimationPlayback(this, ani, options);
  }
  /**
   * Start an animation and return its playback handle.
   */
  play(name: string, options?: PlayAnimationOptions) {
    const playback = this.createPlayback(name, options);
    playback?.play();
    return playback;
  }
  /**
   * Get currently active playbacks.
   */
  getPlaybacks(name?: string) {
    const playbacks: AnimationPlayback[] = [];
    this._activeAnimations.forEach((info, clip) => {
      if (!name || clip.name === name) {
        playbacks.push(info.playback);
      }
    });
    return playbacks;
  }
  /**
   * Get the currently active playback for a clip.
   */
  getPlayback(name: string) {
    const clip = this._animations[name];
    return clip ? (this._activeAnimations.get(clip)?.playback ?? null) : null;
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
    this.play(name, options);
  }
  /**
   * Start a previously created playback.
   * @internal
   */
  startPlayback(playback: AnimationPlayback) {
    const ani = playback.clip;
    if (!ani) {
      return;
    }
    const options = playback._getOptions();
    const fadeIn = Math.max(options?.fadeIn ?? 0, 0);
    const repeat = options?.repeat ?? 0;
    const speedRatio = playback.speedRatio;
    const weight = playback.weight;
    const rangeStart = ani.resolveTimeRef(options?.range?.start);
    const rangeEnd = ani.resolveTimeRef(options?.range?.end);
    const syncSource = this.resolvePlaybackSyncSource(options?.sync);
    const initialTime = this.computePlaybackInitialTime(
      ani,
      speedRatio,
      rangeStart,
      rangeEnd,
      options?.sync,
      syncSource
    );
    if (this.isPlayingAnimation(ani.name)) {
      this.stopAnimation(ani.name, { reason: 'replaced' });
    }
    playback._setState('playing');
    playback._setTime(initialTime);
    this._activeAnimations.set(ani, {
      playback,
      repeat,
      weight,
      targetWeight: weight,
      speedRatio,
      fadeIn,
      fadeOut: 0,
      repeatCounter: 0,
      currentTime: initialTime,
      animateTime: 0,
      fadeOutStart: 0,
      fadeToStart: 0,
      fadeToDuration: 0,
      fadeFromWeight: weight,
      fadeTargetWeight: weight,
      firstFrame: true,
      started: false,
      paused: false,
      stopReason: 'manual',
      completed: false,
      rangeStart,
      rangeEnd
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

  private resolvePlaybackSyncSource(sync: AnimationPlaybackSyncOptions | undefined) {
    if (!sync?.target) {
      return null;
    }
    const playback = this.resolveActivePlayback(sync.target);
    if (!playback) {
      return null;
    }
    const info = this._activeAnimations.get(playback.clip);
    return info?.playback === playback ? { playback, info, clip: playback.clip } : null;
  }

  private resolveActivePlayback(target: string): AnimationPlayback | null {
    const named = this.getPlayback(target);
    if (named) {
      return named;
    }
    for (const info of this._activeAnimations.values()) {
      if (info.playback.id === target) {
        return info.playback;
      }
    }
    return null;
  }

  private computePlaybackInitialTime(
    clip: AnimationClip,
    speedRatio: number,
    rangeStart: number | null,
    rangeEnd: number | null,
    sync: AnimationPlaybackSyncOptions | undefined,
    syncSource: { info: ActiveAnimationInfo; clip: AnimationClip } | null
  ) {
    const fallback = speedRatio < 0 ? (rangeEnd ?? rangeStart ?? clip.timeDuration) : (rangeStart ?? 0);
    if (!sync || !syncSource) {
      return fallback;
    }
    const destination = this.getPlaybackEffectiveRange(clip, rangeStart, rangeEnd);
    if (destination.duration <= 0) {
      return fallback;
    }
    const offset = Number.isFinite(sync.offset) ? (sync.offset ?? 0) : 0;
    const wrap = sync.wrap ?? true;
    if ((sync.mode ?? 'normalized') === 'time') {
      return this.constrainPlaybackTime(syncSource.info.currentTime + offset, destination, wrap);
    }
    const source = this.getPlaybackEffectiveRange(
      syncSource.clip,
      syncSource.info.rangeStart,
      syncSource.info.rangeEnd
    );
    if (source.duration <= 0) {
      return fallback;
    }
    const phase = (syncSource.info.currentTime - source.start) / source.duration + offset;
    return this.constrainPlaybackTime(destination.start + phase * destination.duration, destination, wrap);
  }

  private getPlaybackEffectiveRange(clip: AnimationClip, rangeStart: number | null, rangeEnd: number | null) {
    const start = rangeStart ?? 0;
    const end = rangeEnd ?? clip.timeDuration;
    return start <= end
      ? { start, end, duration: end - start }
      : { start: end, end: start, duration: start - end };
  }

  private constrainPlaybackTime(
    time: number,
    range: { start: number; end: number; duration: number },
    wrap: boolean
  ) {
    if (!Number.isFinite(time)) {
      return range.start;
    }
    if (!wrap) {
      return Math.max(range.start, Math.min(range.end, time));
    }
    if (time >= range.start && time < range.end) {
      return time;
    }
    const offset = (((time - range.start) % range.duration) + range.duration) % range.duration;
    return range.start + offset;
  }
  /**
   * Stop a playback handle.
   * @internal
   */
  stopPlayback(playback: AnimationPlayback, options?: StopAnimationOptions) {
    if (this._activeAnimations.get(playback.clip)?.playback === playback) {
      this.stopAnimation(playback.clip.name, options);
    }
  }
  /**
   * Pause a playback handle.
   * @internal
   */
  pausePlayback(playback: AnimationPlayback) {
    const info = this._activeAnimations.get(playback.clip);
    if (info?.playback === playback && !info.paused) {
      info.paused = true;
      playback._setState('paused');
      const event = this.createPlaybackEvent(info, playback.clip);
      playback._emitPause(event);
      this.dispatchEvent('playbackpause', event);
    }
  }
  /**
   * Resume a playback handle.
   * @internal
   */
  resumePlayback(playback: AnimationPlayback) {
    const info = this._activeAnimations.get(playback.clip);
    if (info?.playback === playback && info.paused) {
      info.paused = false;
      playback._setState('playing');
      const event = this.createPlaybackEvent(info, playback.clip);
      playback._emitResume(event);
      this.dispatchEvent('playbackresume', event);
    }
  }
  /**
   * Seek a playback handle.
   * @internal
   */
  seekPlayback(
    playback: AnimationPlayback,
    time: number,
    options?: { emitEvents?: boolean; apply?: boolean }
  ) {
    const clip = playback.clip;
    const info = this._activeAnimations.get(clip);
    const duration = clip.timeDuration;
    const clampedTime = duration > 0 ? Math.max(0, Math.min(duration, time)) : Math.max(0, time);
    const previousTime = info?.currentTime ?? playback.time;
    playback._setTime(clampedTime);
    if (info?.playback === playback) {
      info.currentTime = clampedTime;
      if (options?.emitEvents) {
        const direction: 1 | -1 = clampedTime >= previousTime ? 1 : -1;
        this.emitCrossedMarkers(info, clip, previousTime, clampedTime, direction);
        this.emitCrossedFrames(info, clip, previousTime, clampedTime, direction);
      }
      if (options?.apply) {
        this.update(0);
      }
    }
  }
  /**
   * Set playback weight.
   * @internal
   */
  setPlaybackWeight(playback: AnimationPlayback, weight: number) {
    playback._setWeight(weight);
    const info = this._activeAnimations.get(playback.clip);
    if (info?.playback === playback) {
      info.weight = weight;
      info.targetWeight = weight;
    }
  }
  /**
   * Set playback speed ratio.
   * @internal
   */
  setPlaybackSpeedRatio(playback: AnimationPlayback, speedRatio: number) {
    playback._setSpeedRatio(speedRatio);
    const info = this._activeAnimations.get(playback.clip);
    if (info?.playback === playback) {
      info.speedRatio = speedRatio;
    }
  }
  /**
   * Fade playback weight to a target value.
   * @internal
   */
  fadePlaybackTo(playback: AnimationPlayback, weight: number, duration: number) {
    const info = this._activeAnimations.get(playback.clip);
    if (info?.playback === playback) {
      info.fadeFromWeight = info.weight;
      info.fadeTargetWeight = weight;
      info.targetWeight = weight;
      info.fadeToStart = info.animateTime;
      info.fadeToDuration = Math.max(duration, 0);
      if (info.fadeToDuration === 0) {
        info.weight = weight;
        playback._setWeight(weight);
      }
    } else {
      playback._setWeight(weight);
    }
  }
  private createPlaybackEvent(info: ActiveAnimationInfo, clip: AnimationClip): AnimationPlaybackEvent {
    return {
      playback: info.playback,
      animationSet: this,
      clip,
      time: info.currentTime,
      normalizedTime: clip.timeDuration > 0 ? info.currentTime / clip.timeDuration : 0
    };
  }
  private completePlayback(clip: AnimationClip, info: ActiveAnimationInfo) {
    if (info.completed) {
      return;
    }
    const event = this.createPlaybackEvent(info, clip);
    const completionFadeOut = Math.max(info.playback._getOptions().completionFadeOut ?? 0, 0);
    info.playback._setState('completed');
    info.playback._emitComplete(event);
    this.dispatchEvent('playbackcomplete', event);
    if (completionFadeOut > 0) {
      info.completed = true;
      info.fadeOut = completionFadeOut;
      info.fadeOutStart = info.animateTime;
      info.stopReason = 'completed';
      return;
    }
    this.stopAnimation(clip.name, { reason: 'completed' });
  }
  private emitCrossedMarkers(
    info: ActiveAnimationInfo,
    clip: AnimationClip,
    fromTime: number,
    toTime: number,
    direction: 1 | -1
  ) {
    for (const marker of this.getCrossedMarkers(clip, fromTime, toTime, direction)) {
      const event: AnimationMarkerEvent = {
        ...this.createPlaybackEvent(info, clip),
        marker,
        direction
      };
      info.playback._emitMarker(event);
      this.dispatchEvent('marker', event);
    }
  }
  private emitCrossedFrames(
    info: ActiveAnimationInfo,
    clip: AnimationClip,
    fromTime: number,
    toTime: number,
    direction: 1 | -1
  ) {
    for (const frame of info.playback._getWatchedFrames()) {
      const frameTime = frame / clip.frameRate;
      const crossed =
        direction >= 0
          ? this.crossedForward(fromTime, toTime, frameTime, clip.timeDuration)
          : this.crossedBackward(fromTime, toTime, frameTime, clip.timeDuration);
      if (crossed) {
        const event: AnimationFrameEvent = {
          ...this.createPlaybackEvent(info, clip),
          frame
        };
        info.playback._emitFrame(event);
        this.dispatchEvent('frame', event);
      }
    }
  }
  private getCrossedMarkers(
    clip: AnimationClip,
    fromTime: number,
    toTime: number,
    direction: 1 | -1
  ): AnimationMarker[] {
    return clip.markers.filter((marker) => {
      const markerTime = clip.resolveMarkerTime(marker);
      if (markerTime === null) {
        return false;
      }
      return direction >= 0
        ? this.crossedForward(fromTime, toTime, markerTime, clip.timeDuration)
        : this.crossedBackward(fromTime, toTime, markerTime, clip.timeDuration);
    });
  }
  private crossedForward(fromTime: number, toTime: number, targetTime: number, duration: number) {
    return toTime >= fromTime
      ? targetTime > fromTime && targetTime <= toTime
      : (duration > 0 && targetTime > fromTime && targetTime <= duration) || targetTime <= toTime;
  }
  private crossedBackward(fromTime: number, toTime: number, targetTime: number, duration: number) {
    return toTime <= fromTime
      ? targetTime < fromTime && targetTime >= toTime
      : (duration > 0 && targetTime < fromTime && targetTime >= 0) || targetTime >= toTime;
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
      const reason = options?.reason ?? 'manual';
      if (fadeOut !== 0) {
        info.fadeOut = fadeOut;
        info.fadeOutStart = -1;
        info.stopReason = reason;
        info.playback._setState('stopping');
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
        const event: AnimationPlaybackStopEvent = {
          ...this.createPlaybackEvent(info, ani),
          reason
        };
        if (reason !== 'completed') {
          info.playback._setState('stopped');
        }
        info.playback._emitStop(event);
        this.dispatchEvent('playbackstop', event);
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

    const jointRemapsBySrcNode = new Map<SceneNode, JointRetargetRemap[]>();

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
        const srcHips = srcHumanoidMapping.body[HumanoidBodyRig.Hips];
        const dstHips = dstHumanoidMapping.body[HumanoidBodyRig.Hips];
        if (!srcHips || !dstHips || !srcSkeleton.joints.includes(srcHips) || !sk.joints.includes(dstHips)) {
          return false;
        }

        // Collect matched (srcJoint, dstJoint) pairs via shared humanoid rig keys
        const srcMatched: SceneNode[] = [];
        const dstMatched: SceneNode[] = [];
        const addMatch = (srcJoint: SceneNode | undefined, dstJoint: SceneNode | undefined) => {
          if (srcJoint && dstJoint && srcSkeleton.joints.includes(srcJoint) && sk.joints.includes(dstJoint)) {
            srcMatched.push(srcJoint);
            dstMatched.push(dstJoint);
          }
        };

        // Match body rig joints
        for (const key of Object.keys(srcHumanoidMapping.body) as (keyof typeof srcHumanoidMapping.body)[]) {
          addMatch(srcHumanoidMapping.body[key], dstHumanoidMapping.body[key]);
        }

        // Match left hand rig joints only when both sides define them; skip silently if either is absent
        if (srcHumanoidMapping.leftHand && dstHumanoidMapping.leftHand) {
          for (const key of Object.keys(
            srcHumanoidMapping.leftHand
          ) as (keyof typeof srcHumanoidMapping.leftHand)[]) {
            addMatch(srcHumanoidMapping.leftHand[key], dstHumanoidMapping.leftHand[key]);
          }
        }

        // Match right hand rig joints only when both sides define them; skip silently if either is absent
        if (srcHumanoidMapping.rightHand && dstHumanoidMapping.rightHand) {
          for (const key of Object.keys(
            srcHumanoidMapping.rightHand
          ) as (keyof typeof srcHumanoidMapping.rightHand)[]) {
            addMatch(srcHumanoidMapping.rightHand[key], dstHumanoidMapping.rightHand[key]);
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
    const srcAncestorTranslationTrackInfo = !srcRootTranslationTrack
      ? findAncestorTranslationTrack(sourceClip, srcRootNode, sourceSet.model)
      : null;
    const srcFallbackHipsTranslationTrack =
      !srcRootTranslationTrack && !srcAncestorTranslationTrackInfo && srcRootNode !== srcHipsNode
        ? findTranslationTrack(sourceClip.tracks.get(srcHipsNode))
        : null;
    const srcMotionTrack =
      srcRootTranslationTrack ?? srcAncestorTranslationTrackInfo?.track ?? srcFallbackHipsTranslationTrack;
    const srcMotionNode = srcRootTranslationTrack
      ? srcRootNode
      : srcAncestorTranslationTrackInfo
        ? srcAncestorTranslationTrackInfo.node
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
    const jointRemapsByDstSkeleton = new Map<SkeletonRig, JointRetargetRemap[]>([[dstSkeleton, jointRemaps]]);
    const srcSignSkeletons = sourceSet._rigs.map((ref) => ref.get()).filter((sk): sk is SkeletonRig => !!sk);
    const dstSignSkeletons = this._rigs.map((ref) => ref.get()).filter((sk): sk is SkeletonRig => !!sk);
    const humanoidRotationCorrection = getHumanoidRotationCorrection(
      srcSkeleton,
      dstSkeleton,
      srcSignSkeletons,
      dstSignSkeletons
    );
    const addJointRemap = (
      targetSkeleton: SkeletonRig,
      srcJoint: SceneNode | undefined,
      dstJoint: SceneNode | undefined,
      applyRotationCorrection = true
    ) => {
      if (
        !srcJoint ||
        !dstJoint ||
        !srcSkeleton.joints.includes(srcJoint) ||
        !targetSkeleton.joints.includes(dstJoint)
      ) {
        return;
      }
      const remap = createJointRetargetRemap(
        srcSkeleton,
        targetSkeleton,
        srcJoint,
        dstJoint,
        undefined,
        undefined,
        humanoidRotationCorrection ?? undefined,
        undefined,
        applyRotationCorrection ? (humanoidRotationCorrection ?? undefined) : undefined
      );
      let targetRemaps = jointRemapsByDstSkeleton.get(targetSkeleton);
      if (!targetRemaps) {
        targetRemaps = [];
        jointRemapsByDstSkeleton.set(targetSkeleton, targetRemaps);
      }
      targetRemaps.push(remap);
      let srcRemaps = jointRemapsBySrcNode.get(srcJoint);
      if (!srcRemaps) {
        srcRemaps = [];
        jointRemapsBySrcNode.set(srcJoint, srcRemaps);
      }
      srcRemaps.push(remap);
    };
    const addHumanoidMappingRemaps = (targetSkeleton: SkeletonRig) => {
      const targetMapping = targetSkeleton.humanoidJointMapping;
      if (!targetMapping) {
        return;
      }
      const applyRotationCorrection = targetSkeleton === dstSkeleton;
      for (const key of Object.keys(srcHumanoidMapping.body) as (keyof typeof srcHumanoidMapping.body)[]) {
        addJointRemap(
          targetSkeleton,
          srcHumanoidMapping.body[key],
          targetMapping.body[key],
          applyRotationCorrection
        );
      }
      if (srcHumanoidMapping.leftHand && targetMapping.leftHand) {
        for (const key of Object.keys(
          srcHumanoidMapping.leftHand
        ) as (keyof typeof srcHumanoidMapping.leftHand)[]) {
          addJointRemap(
            targetSkeleton,
            srcHumanoidMapping.leftHand[key],
            targetMapping.leftHand[key],
            applyRotationCorrection
          );
        }
      }
      if (srcHumanoidMapping.rightHand && targetMapping.rightHand) {
        for (const key of Object.keys(
          srcHumanoidMapping.rightHand
        ) as (keyof typeof srcHumanoidMapping.rightHand)[]) {
          addJointRemap(
            targetSkeleton,
            srcHumanoidMapping.rightHand[key],
            targetMapping.rightHand[key],
            applyRotationCorrection
          );
        }
      }
    };
    // Build remap for matched joint pairs
    for (let fi = 0; fi < srcJointsFiltered.length; fi++) {
      addJointRemap(dstSkeleton, srcJointsFiltered[fi], dstJointsFiltered[fi], true);
    }
    for (const targetSkeleton of dstSignSkeletons) {
      if (targetSkeleton !== dstSkeleton) {
        addHumanoidMappingRemaps(targetSkeleton);
      }
    }

    const dstClip = this.createAnimation(destName);
    if (!dstClip) {
      return null;
    }
    dstClip.timeDuration = sourceClip.timeDuration;
    dstClip.weight = sourceClip.weight;
    dstClip.autoPlay = sourceClip.autoPlay;

    copyMorphTargetGroupTracks(sourceClip, dstClip, this._model);

    for (const [targetSkeleton, targetRemaps] of jointRemapsByDstSkeleton) {
      if (targetRemaps.length === 0) {
        continue;
      }
      const hasCopyableTrack =
        targetSkeleton === dstSkeleton ||
        targetRemaps.some((remap) => {
          const srcTracks = sourceClip.tracks.get(remap.srcNode);
          if (!srcTracks) {
            return false;
          }
          for (const srcTrack of srcTracks) {
            if (srcTrack instanceof NodeRotationTrack || srcTrack instanceof NodeEulerRotationTrack) {
              return true;
            }
            if (
              srcTrack instanceof NodeTranslationTrack &&
              remap.srcNode !== srcRootNode &&
              srcTrack !== srcMotionTrack &&
              jointTranslations === 'preserve'
            ) {
              return true;
            }
            if (srcTrack instanceof NodeScaleTrack) {
              return true;
            }
          }
          return false;
        });
      if (!hasCopyableTrack) {
        continue;
      }
      dstClip.addSkeleton(targetSkeleton.persistentId);
      const targetRootNode =
        targetSkeleton.rootJoint ??
        targetSkeleton.humanoidJointMapping?.body[HumanoidBodyRig.Hips] ??
        targetRemaps[0].dstNode;
      const targetRootRot =
        targetRootNode === dstRootNode
          ? dstRootRot
          : computeParentChainRotation(targetRootNode, this._model, targetSkeleton);
      bakeHumanoidRotationTracks(
        sourceClip,
        srcSkeleton,
        targetSkeleton,
        srcRootRot,
        targetRootRot,
        dstClip,
        targetRemaps,
        humanoidRotationCorrection
      );
    }

    if (rootMotion !== 'none') {
      const dstRootBindPose = getRigReferencePoseForNode(dstSkeleton, dstRootNode);
      let dstRootTrack: NodeTranslationTrack | null = null;
      if (rootMotion === 'locked') {
        dstRootTrack = createConstantTranslationTrack(dstRootBindPose.position);
      } else if (srcMotionTrack && srcMotionNode) {
        const srcMotionBindPose = getRigReferencePoseForNode(srcSkeleton, srcMotionNode);
        const rootRemap = createTranslationRetargetRemap(
          srcMotionNode,
          dstRootNode,
          srcMotionBindPose.position,
          dstRootBindPose.position,
          dstSkeleton.joints.indexOf(dstRootNode),
          rootTranslationScale,
          rootTranslationRotation,
          humanoidRotationCorrection ?? undefined,
          options.lockRootMotionAxes,
          humanoidRotationCorrection ?? undefined
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

    for (const [srcNode, srcRemaps] of jointRemapsBySrcNode) {
      const srcTracks = sourceClip.tracks.get(srcNode);
      if (!srcTracks) {
        // Not every humanoid joint must have a track; skip silently
        continue;
      }
      for (const remap of srcRemaps) {
        const dstNode = remap.dstNode;
        for (const srcTrack of srcTracks) {
          let dstTrack: AnimationTrack;
          if (srcTrack instanceof NodeRotationTrack || srcTrack instanceof NodeEulerRotationTrack) {
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
    copyMorphTargetGroupTracks(sourceClip, dstClip, this._model);

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
