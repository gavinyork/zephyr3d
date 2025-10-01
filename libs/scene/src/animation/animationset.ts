import { weightedAverage, DWeakRef, Disposable } from '@zephyr3d/base';
import type { IDisposable } from '@zephyr3d/base';
import type { SceneNode } from '../scene';
import { AnimationClip } from './animation';
import type { AnimationTrack } from './animationtrack';
import type { Skeleton } from './skeleton';

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
  private _model: DWeakRef<SceneNode>;
  /** @internal */
  private _animations: Record<string, AnimationClip>;
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
    this._model = new DWeakRef<SceneNode>(model);
    this._animations = {};
    this._activeTracks = new Map();
    this._activeSkeletons = new Map();
    this._activeAnimations = new Map();
  }
  /**
   * The model (SceneNode) controlled by this animation set.
   */
  get model(): SceneNode {
    return this._model.get();
  }
  /**
   * Number of animation clips registered in this set.
   */
  get numAnimations(): number {
    return Object.getOwnPropertyNames(this._animations).length;
  }
  /**
   * Retrieve an animation clip by name.
   *
   * @param name - Name of the animation.
   * @returns The clip if present; otherwise null.
   */
  get(name: string): AnimationClip {
    return this._animations[name] ?? null;
  }
  /**
   * Create and register a new animation clip.
   *
   * @param name - Unique name for the animation clip.
   * @param embedded - Whether the clip is embedded/owned (implementation-specific). Default false.
   * @returns The created clip, or null if the name is empty or not unique.
   */
  createAnimation(name: string, embedded = false): AnimationClip {
    if (!name || this._animations[name]) {
      console.error('Animation must have unique name');
      return null;
    } else {
      const animation = new AnimationClip(name, this, embedded);
      this._animations[name] = animation;
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
  getAnimationNames(): string[] {
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
  update(deltaInSeconds: number): void {
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
            const info = this._activeAnimations.get(track.animation);
            const weight = info.weight;
            const fadeIn = info.fadeIn === 0 ? 1 : Math.min(1, info.animateTime / info.fadeIn);
            let fadeOut = 1;
            if (info.fadeOut !== 0) {
              fadeOut = 1 - (info.animateTime - info.fadeOutStart) / info.fadeOut;
            }
            return weight * fadeIn * fadeOut;
          });
          const states = tracks.map((track) =>
            track.calculateState(
              k,
              (this._activeAnimations.get(track.animation).currentTime / track.animation.timeDuration) *
                track.getDuration()
            )
          );
          const state = weightedAverage(weights, states, (a, b, t) => {
            return tracks[0].mixState(a, b, t);
          });
          tracks[0].applyState(k, state);
        }
      });
    });
    // Update skeletons
    this._activeSkeletons.forEach((v, k) => {
      k.apply();
    });
  }
  /**
   * Check whether an animation is currently playing.
   *
   * @param name - Optional animation name. If omitted, returns true if any animation is playing.
   * @returns True if playing; otherwise false.
   */
  isPlayingAnimation(name?: string): boolean {
    return name ? this._activeAnimations.has(this._animations[name]) : this._activeAnimations.size > 0;
  }
  /**
   * Get an animation clip by name.
   *
   * Alias of `get(name)` returning a nullable type.
   *
   * @param name - Name of the animation.
   * @returns The clip if present; otherwise null.
   */
  getAnimationClip(name: string): AnimationClip | null {
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
  setAnimationWeight(name: string, weight: number): void {
    const ani = this._animations[name];
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
  playAnimation(name: string, options?: PlayAnimationOptions): void {
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
      const weight = ani.weight;
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
        const refcount = this._activeSkeletons.get(k);
        if (refcount) {
          this._activeSkeletons.set(k, refcount + 1);
        } else {
          this._activeSkeletons.set(k, 1);
        }
        k.playing = true;
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
  stopAnimation(name: string, options?: StopAnimationOptions): void {
    const ani = this._animations[name];
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
          const refcount = this._activeSkeletons.get(k);
          if (refcount === 1) {
            k.reset();
            this._activeSkeletons.delete(k);
          } else {
            this._activeSkeletons.set(k, refcount - 1);
          }
        });
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
    this._model?.dispose();
    this._model = null;
    for (const k in this._animations) {
      this._animations[k].dispose();
    }
    this._animations = {};
    this._activeAnimations.clear();
    this._activeSkeletons.clear();
    this._activeTracks.clear();
  }
}
