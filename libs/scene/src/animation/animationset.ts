import { weightedAverage, Disposable, Interpolator } from '@zephyr3d/base';
import type { DRef, IDisposable, Nullable, Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../scene';
import { AnimationClip } from './animation';
import type { AnimationTrack } from './animationtrack';
import { NodeRotationTrack } from './rotationtrack';
import { NodeEulerRotationTrack } from './eulerrotationtrack';
import { NodeTranslationTrack } from './translationtrack';
import { NodeScaleTrack } from './scaletrack';
import { Skeleton } from './skeleton';

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
  private _skeletons: DRef<Skeleton>[];
  /** @internal */
  private readonly _activeTracks: Map<object, Map<unknown, AnimationTrack[]>>;
  /** @internal */
  private readonly _activeSkeletons: Map<Skeleton, number>;
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
    this._activeSkeletons = new Map();
    this._activeAnimations = new Map();
    this._skeletons = [];
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
   * - Apply all active skeletons to update skinning transforms.
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
        if (v.currentTime > k.timeDuration) {
          v.repeatCounter++;
          v.currentTime = 0;
        } else if (v.currentTime < 0) {
          v.repeatCounter++;
          v.currentTime = k.timeDuration;
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
    // Update skeletons
    this._skeletons.forEach((v) => {
      v.get()?.apply(deltaInSeconds);
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
   * - If the clip is already playing, updates its fade-in (resets fade-out).
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
    const fadeIn = Math.max(options?.fadeIn ?? 0, 0);
    const info = this._activeAnimations.get(ani);
    if (info) {
      info.fadeOut = 0;
      info.fadeIn = fadeIn;
    } else {
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
        const skeleton = this.model.findSkeletonById(k);
        if (skeleton) {
          const refcount = this._activeSkeletons.get(skeleton);
          if (refcount) {
            this._activeSkeletons.set(skeleton, refcount + 1);
          } else {
            this._activeSkeletons.set(skeleton, 1);
          }
          skeleton.playing = true;
        }
      });
    }
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
          const skeleton = this.model.findSkeletonById(k);
          if (skeleton) {
            const refcount = this._activeSkeletons.get(skeleton)!;
            if (refcount === 1) {
              skeleton.reset();
              this._activeSkeletons.delete(skeleton);
            } else {
              this._activeSkeletons.set(skeleton, refcount - 1);
            }
          }
        });
      }
    }
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
    targetName?: string
  ): AnimationClip | null {
    const destName = targetName ?? animationName;
    const sourceClip = sourceSet.get(animationName);
    if (!sourceClip) {
      console.error(`copyHumanoidAnimationFrom: animation '${animationName}' not found in source set`);
      return null;
    }
    if (this._animations[destName]) {
      console.error(`copyHumanoidAnimationFrom: animation '${destName}' already exists in target set`);
      return null;
    }

    // Per-joint retargeting info indexed by source joint node
    type JointRemap = {
      dstNode: SceneNode;
      srcBindRot: Quaternion;
      dstBindRot: Quaternion;
      translationScale: number;
    };

    if (sourceClip.skeletons.size !== 1) {
      console.error(
        `copyHumanoidAnimationFrom: source animation clip must be affected by exactly one skeleton`
      );
      return null;
    }
    const srcSkeletonId = [...sourceClip.skeletons][0];
    const srcSkeleton = Skeleton.findSkeletonById(srcSkeletonId);
    if (!srcSkeleton) {
      console.error(`copyHumanoidAnimationFrom: source skeleton '${srcSkeletonId}' not found`);
      return null;
    }

    // Check that source skeleton has humanoid mapping
    const srcHumanoidMapping = srcSkeleton.humanoidJointMapping;
    if (!srcHumanoidMapping) {
      console.error(`copyHumanoidAnimationFrom: source skeleton does not have a humanoid joint mapping`);
      return null;
    }

    const nodeMap = new Map<object, SceneNode>();
    const jointRemapBySrcNode = new Map<object, JointRemap>();

    // Find a destination skeleton that has a humanoid mapping and share at least the body rig keys
    let srcJointsFiltered: SceneNode[] = [];
    let dstJointsFiltered: SceneNode[] = [];

    const dstSkeleton = this._skeletons
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

    // Build remap for matched joint pairs
    for (let fi = 0; fi < srcJointsFiltered.length; fi++) {
      const srcJoint = srcJointsFiltered[fi];
      const dstJoint = dstJointsFiltered[fi];
      const si = srcSkeleton.joints.indexOf(srcJoint);
      const di = dstSkeleton.joints.indexOf(dstJoint);
      const srcLen = srcSkeleton.bindPose[si].position.magnitude;
      const dstLen = dstSkeleton.bindPose[di].position.magnitude;
      const translationScale = srcLen > 1e-6 ? dstLen / srcLen : 1;
      nodeMap.set(srcJoint, dstJoint);
      jointRemapBySrcNode.set(srcJoint, {
        dstNode: dstJoint,
        srcBindRot: srcSkeleton.bindPose[si].rotation,
        dstBindRot: dstSkeleton.bindPose[di].rotation,
        translationScale
      });
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
        // Not every humanoid joint must have a track; skip silently
        continue;
      }
      const dstNode = nodeMap.get(srcNode)!;
      const remap = jointRemapBySrcNode.get(srcNode) ?? null;

      for (const srcTrack of srcTracks) {
        let dstTrack: AnimationTrack;
        if (srcTrack instanceof NodeRotationTrack) {
          dstTrack = retargetRotationTrack(srcTrack);
        } else if (srcTrack instanceof NodeEulerRotationTrack) {
          dstTrack = retargetEulerToRotationTrack(srcTrack);
        } else if (srcTrack instanceof NodeTranslationTrack) {
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
        dstTrack.target = srcTrack.target;
        dstTrack.jointIndex = srcTrack.jointIndex;
        dstClip.addTrack(dstNode, dstTrack);
      }
    }

    return dstClip;

    function retargetTranslationTrack(
      src: NodeTranslationTrack,
      remap: JointRemap | null
    ): NodeTranslationTrack {
      if (!remap || Math.abs(remap.translationScale - 1) < 1e-6) {
        return new NodeTranslationTrack(cloneInterpolator(src.interpolator));
      }
      const scale = remap.translationScale;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const newOutputs = new Float32Array(srcOutputs.length);
      for (let i = 0; i < newOutputs.length; i++) {
        newOutputs[i] = srcOutputs[i] * scale;
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

    function cloneInterpolator(src: Interpolator): Interpolator {
      return new Interpolator(
        src.mode,
        src.target,
        src.inputs instanceof Float32Array ? new Float32Array(src.inputs) : [...src.inputs],
        src.outputs instanceof Float32Array ? new Float32Array(src.outputs) : [...src.outputs]
      );
    }

    function retargetRotationTrack(src: NodeRotationTrack): NodeRotationTrack {
      const isCubic = src.interpolator.mode === 'cubicspline';
      const frameStride = isCubic ? 12 : 4;
      const numFrames = (src.interpolator.inputs as Float32Array).length;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const newOutputs = new Float32Array(srcOutputs.length);
      for (let f = 0; f < numFrames; f++) {
        const base = f * frameStride;
        newOutputs.set(srcOutputs.subarray(base, base + (isCubic ? 12 : 4)), base);
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

    function retargetEulerToRotationTrack(src: NodeEulerRotationTrack): NodeRotationTrack {
      const srcInputs = src.interpolator.inputs as Float32Array;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const numFrames = srcInputs.length;
      const newOutputs = new Float32Array(numFrames * 3);
      for (let f = 0; f < numFrames; f++) {
        const base = f * 3;
        newOutputs.set(srcOutputs.subarray(base, base + 3), base);
      }
      return new NodeRotationTrack(
        new Interpolator('linear', 'quat', new Float32Array(srcInputs), newOutputs)
      );
    }
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

    // Per-joint retargeting info indexed by source joint node
    type JointRemap = {
      dstNode: SceneNode;
      srcBindRot: Quaternion;
      dstBindRot: Quaternion;
      translationScale: number;
    };
    if (sourceClip.skeletons.size !== 1) {
      console.error(`copyAnimationFrom: source animation clip must be affected by exactly one skeleton`);
      return null;
    }
    const srcSkeletonId = [...sourceClip.skeletons][0];
    const srcSkeleton = Skeleton.findSkeletonById(srcSkeletonId);
    if (!srcSkeleton) {
      console.error(`copyAnimationFrom: source skeleton '${srcSkeletonId}' not found`);
      return null;
    }
    const nodeMap = new Map<object, SceneNode>();
    const jointRemapBySrcNode = new Map<object, JointRemap>();

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
    const dstSkeleton = this._skeletons
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
      const si = srcSkeleton.joints.indexOf(srcJoint);
      const di = dstSkeleton.joints.indexOf(dstJoint);
      const srcLen = srcSkeleton.bindPose[si].position.magnitude;
      const dstLen = dstSkeleton.bindPose[di].position.magnitude;
      const translationScale = srcLen > 1e-6 ? dstLen / srcLen : 1;
      nodeMap.set(srcJoint, dstJoint);
      jointRemapBySrcNode.set(srcJoint, {
        dstNode: dstJoint,
        srcBindRot: srcSkeleton.bindPose[si].rotation,
        dstBindRot: dstSkeleton.bindPose[di].rotation,
        translationScale
      });
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
      const remap = jointRemapBySrcNode.get(srcNode) ?? null;

      for (const srcTrack of srcTracks) {
        let dstTrack: AnimationTrack;
        if (srcTrack instanceof NodeRotationTrack) {
          dstTrack = retargetRotationTrack(srcTrack);
        } else if (srcTrack instanceof NodeEulerRotationTrack) {
          dstTrack = retargetEulerToRotationTrack(srcTrack);
        } else if (srcTrack instanceof NodeTranslationTrack) {
          dstTrack = retargetTranslationTrack(srcTrack, remap);
        } else if (srcTrack instanceof NodeScaleTrack) {
          dstTrack = new NodeScaleTrack(cloneInterpolator(srcTrack.interpolator));
        } else {
          console.warn(`copyAnimationFrom: unsupported track type '${srcTrack.constructor.name}', skipping`);
          continue;
        }

        dstTrack.name = srcTrack.name;
        dstTrack.target = srcTrack.target;
        dstTrack.jointIndex = srcTrack.jointIndex;
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
    function retargetTranslationTrack(
      src: NodeTranslationTrack,
      remap: JointRemap | null
    ): NodeTranslationTrack {
      if (!remap || Math.abs(remap.translationScale - 1) < 1e-6) {
        return new NodeTranslationTrack(cloneInterpolator(src.interpolator));
      }
      const scale = remap.translationScale;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const newOutputs = new Float32Array(srcOutputs.length);
      for (let i = 0; i < newOutputs.length; i++) {
        newOutputs[i] = srcOutputs[i] * scale;
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

    function cloneInterpolator(src: Interpolator): Interpolator {
      return new Interpolator(
        src.mode,
        src.target,
        src.inputs instanceof Float32Array ? new Float32Array(src.inputs) : [...src.inputs],
        src.outputs instanceof Float32Array ? new Float32Array(src.outputs) : [...src.outputs]
      );
    }

    function retargetRotationTrack(src: NodeRotationTrack): NodeRotationTrack {
      const isCubic = src.interpolator.mode === 'cubicspline';
      const frameStride = isCubic ? 12 : 4;
      const numFrames = (src.interpolator.inputs as Float32Array).length;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const newOutputs = new Float32Array(srcOutputs.length);
      for (let f = 0; f < numFrames; f++) {
        const base = f * frameStride;
        newOutputs.set(srcOutputs.subarray(base, base + (isCubic ? 12 : 4)), base);
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

    function retargetEulerToRotationTrack(src: NodeEulerRotationTrack): NodeRotationTrack {
      const srcInputs = src.interpolator.inputs as Float32Array;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const numFrames = srcInputs.length;
      const newOutputs = new Float32Array(numFrames * 3);
      for (let f = 0; f < numFrames; f++) {
        const base = f * 3;
        newOutputs.set(srcOutputs.subarray(base, base + 3), base);
      }
      return new NodeRotationTrack(
        new Interpolator('linear', 'quat', new Float32Array(srcInputs), newOutputs)
      );
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
    this._activeSkeletons.clear();
    this._activeTracks.clear();
  }
}
