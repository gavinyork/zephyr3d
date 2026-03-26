import { weightedAverage, Disposable, Interpolator, Quaternion } from '@zephyr3d/base';
import type { DRef, IDisposable } from '@zephyr3d/base';
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
   * Copy an animation clip from another AnimationSet into this one.
   *
   * Prerequisites:
   * - Both sets must reference skeletons with identical joint names and counts.
   * - The source clip must exist in `sourceSet`.
   *
   * BindPose differences are handled for rotation tracks: each keyframe rotation is
   * retargeted from the source joint's bind orientation to the target joint's bind
   * orientation using: `R_dst = dstBind.inverse * srcBind * R_src`.
   * Translation and scale tracks are copied verbatim (they store local-space offsets
   * that are independent of bind pose orientation).
   *
   * @param sourceSet - The AnimationSet to copy from.
   * @param animationName - Name of the clip to copy.
   * @param targetName - Name for the new clip in this set. Defaults to `animationName`.
   * @param excludeJoint - Optional predicate; joints whose name returns true are excluded from
   *   skeleton structure matching. Useful when one model has extra bone chains (e.g. accessories)
   *   that the other lacks. Tracks targeting excluded joints are still copied if a same-named
   *   node exists in the target model.
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
    const nodeMap = new Map<object, SceneNode>();
    const jointRemapBySrcNode = new Map<object, JointRemap>();

    for (const srcSkeletonId of sourceClip.skeletons) {
      const srcSkeleton = Skeleton.findSkeletonById(srcSkeletonId);
      if (!srcSkeleton) {
        console.error(`copyAnimationFrom: source skeleton '${srcSkeletonId}' not found`);
        return null;
      }
      // Build filtered joint lists for matching (exclude joints rejected by filterJoint)
      const srcJointsFiltered = srcSkeleton.joints.filter((j) => !excludeJoint?.(j.name));
      const dstSkeleton = this._skeletons
        .map((ref) => ref.get())
        .find((sk) => {
          if (!sk) {
            return false;
          }
          const dstJointsFiltered = sk.joints.filter((j) => !excludeJoint?.(j.name));
          return (
            dstJointsFiltered.length === srcJointsFiltered.length &&
            srcJointsFiltered.every((j, i) => j.name === dstJointsFiltered[i].name)
          );
        });
      if (!dstSkeleton) {
        console.error(`copyAnimationFrom: no matching skeleton in target set for '${srcSkeletonId}'`);
        return null;
      }
      // Build remap only for joints that pass the filter
      const dstJointsFiltered = dstSkeleton.joints.filter((j) => !excludeJoint?.(j.name));
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
    }

    // Map non-skeleton nodes by name
    /*
    for (const srcNode of sourceClip.tracks.keys()) {
      if (!nodeMap.has(srcNode)) {
        const name = (srcNode as SceneNode).name;
        const dstNode = this._model.findNodeByName<SceneNode>(name);
        if (!dstNode) {
          console.warn(`copyAnimationFrom: target model has no node named '${name}'`);
        } else {
          nodeMap.set(srcNode, dstNode);
        }
      }
    }
    */

    const dstClip = this.createAnimation(destName);
    if (!dstClip) {
      return null;
    }
    dstClip.timeDuration = sourceClip.timeDuration;
    dstClip.weight = sourceClip.weight;
    dstClip.autoPlay = sourceClip.autoPlay;

    // Register destination skeleton ids
    for (const srcSkeletonId of sourceClip.skeletons) {
      const srcSkeleton = Skeleton.findSkeletonById(srcSkeletonId)!;
      const firstSrcJoint = srcSkeleton.joints[0];
      const firstDstJoint = nodeMap.get(firstSrcJoint);
      const dstSkeleton = this._skeletons
        .map((r) => r.get())
        .find((sk) => sk && sk.joints[0] === firstDstJoint);
      if (dstSkeleton) {
        dstClip.addSkeleton(dstSkeleton.persistentId);
      }
    }

    const tmpSrcBind = new Quaternion();
    const tmpDstBindInv = new Quaternion();

    for (const [srcNode, srcTracks] of sourceClip.tracks) {
      const dstNode = nodeMap.get(srcNode);
      if (!dstNode) {
        continue;
      }
      const remap = jointRemapBySrcNode.get(srcNode) ?? null;

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

    function retargetRotationTrack(src: NodeRotationTrack, remap: JointRemap | null): NodeRotationTrack {
      if (!remap) {
        return new NodeRotationTrack(cloneInterpolator(src.interpolator));
      }
      tmpSrcBind.set(remap.srcBindRot);
      Quaternion.conjugate(remap.dstBindRot, tmpDstBindInv);
      const isCubic = src.interpolator.mode === 'cubicspline';
      const frameStride = isCubic ? 12 : 4;
      const numFrames = (src.interpolator.inputs as Float32Array).length;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const newOutputs = new Float32Array(srcOutputs.length);
      const q = new Quaternion();
      for (let f = 0; f < numFrames; f++) {
        const base = f * frameStride;
        if (isCubic) {
          // layout per frame: [inTangent×4, value×4, outTangent×4] — only retarget value
          newOutputs.set(srcOutputs.subarray(base, base + 4), base);
          q.set(srcOutputs.subarray(base + 4, base + 8));
          Quaternion.multiply(tmpSrcBind, q, q);
          Quaternion.multiply(tmpDstBindInv, q, q);
          newOutputs[base + 4] = q.x;
          newOutputs[base + 5] = q.y;
          newOutputs[base + 6] = q.z;
          newOutputs[base + 7] = q.w;
          newOutputs.set(srcOutputs.subarray(base + 8, base + 12), base + 8);
        } else {
          q.set(srcOutputs.subarray(base, base + 4));
          Quaternion.multiply(tmpSrcBind, q, q);
          Quaternion.multiply(tmpDstBindInv, q, q);
          newOutputs[base] = q.x;
          newOutputs[base + 1] = q.y;
          newOutputs[base + 2] = q.z;
          newOutputs[base + 3] = q.w;
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
      remap: JointRemap | null
    ): NodeRotationTrack {
      const srcInputs = src.interpolator.inputs as Float32Array;
      const srcOutputs = src.interpolator.outputs as Float32Array;
      const numFrames = srcInputs.length;
      const newOutputs = new Float32Array(numFrames * 4);
      const q = new Quaternion();
      if (remap) {
        tmpSrcBind.set(remap.srcBindRot);
        Quaternion.conjugate(remap.dstBindRot, tmpDstBindInv);
      }
      for (let f = 0; f < numFrames; f++) {
        const b3 = f * 3;
        const b4 = f * 4;
        q.fromEulerAngle(srcOutputs[b3], srcOutputs[b3 + 1], srcOutputs[b3 + 2]);
        if (remap) {
          Quaternion.multiply(tmpSrcBind, q, q);
          Quaternion.multiply(tmpDstBindInv, q, q);
        }
        newOutputs[b4] = q.x;
        newOutputs[b4 + 1] = q.y;
        newOutputs[b4 + 2] = q.z;
        newOutputs[b4 + 3] = q.w;
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
