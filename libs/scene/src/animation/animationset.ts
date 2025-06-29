import { weightedAverage } from '@zephyr3d/base';
import type { SceneNode } from '../scene';
import type { AnimationClip } from './animation';
import type { AnimationTrack } from './animationtrack';
import type { Skeleton } from './skeleton';
import type { Disposable } from '../app/gc/ref';
import { DWeakRef } from '../app/gc/ref';

/**
 * Options for playing animation
 * @public
 **/
export type PlayAnimationOptions = {
  /**
   * Repeat times
   *
   * @remarks
   * Number of loops, 0 for infinite loops. Default value is 0
   **/
  repeat?: number;
  /**
   * Speed factor
   *
   * @remarks
   * The larger the absolute value, the faster the speed.
   * If it is a negative value, it plays in reverse.
   * Default value is 1
   */
  speedRatio?: number;
  /**
   * Blending weight
   *
   * @remarks
   * When multiple animations are playing at the same time,
   * all animations are weighted and averaged using this weight.
   * Default value is 1
   */
  weight?: number;
  /**
   * Fade-in time
   *
   * @remarks
   * How long it takes for the animation weight to increase from 0 to weight,
   * default is 0, indicating no fade-in effect. Usually used in conjunction
   * with the fadeOut parameter of stopAnimation() for seamless transition
   * between two animations
   **/
  fadeIn?: number;
};

/**
 * Options for stop playing animation
 * @public
 **/
export type StopAnimationOptions = {
  /**
   * Fade-out time
   *
   * @remarks
   * How long it takes for the animation weight to decrease from current weight
   * to 0, default is 0, indicating no fade-out effect. Usually used in conjunction
   * with the fadeIn parameter of startAnimation() for seamless transition between
   * two animations
   */
  fadeOut?: number;
};

/**
 * Animation set
 * @public
 */
export class AnimationSet implements Disposable {
  /** @internal */
  private _disposed: boolean;
  /** @internal */
  private _model: DWeakRef<SceneNode>;
  /** @internal */
  private _animations: Record<string, AnimationClip>;
  /** @internal */
  private _activeTracks: Map<unknown, Map<unknown, AnimationTrack[]>>;
  /** @internal */
  private _activeSkeletons: Map<Skeleton, number>;
  /** @internal */
  private _activeAnimations: Map<
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
   * Creates an instance of AnimationSet
   * @param scene - The scene to which the animation set belongs
   * @param model - The model which is controlled by the animation set
   */
  constructor(model: SceneNode) {
    this._disposed = false;
    this._model = new DWeakRef<SceneNode>(model);
    this._animations = {};
    this._activeTracks = new Map();
    this._activeSkeletons = new Map();
    this._activeAnimations = new Map();
  }
  /**
   * The model which is controlled by the animation set
   */
  get model(): SceneNode {
    return this._model.get();
  }
  /**
   * How many animations in this set
   */
  get numAnimations(): number {
    return Object.getOwnPropertyNames(this._animations).length;
  }
  /**
   * Gets an animation clip by name
   * @param name - name of the animation to get
   */
  get(name: string): AnimationClip {
    return this._animations[name] ?? null;
  }
  /**
   * Adds an animation
   */
  add(animation: AnimationClip) {
    this._animations[animation.name] = animation;
  }
  /**
   * Gets names of all the animations of the model
   * @returns An array of string that contains the animation names
   */
  getAnimationNames(): string[] {
    return Object.keys(this._animations);
  }
  /**
   * Updates all animations of the model
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
      v.forEach((tracks) => {
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
            track.calculateState(k, this._activeAnimations.get(track.animation).currentTime)
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
   * Checks whether an animation is playing
   * @param name - Name of the animation to be checked, if not given, checks if any animation is playing
   * @returns true if the animation is playing, otherwise false
   */
  isPlayingAnimation(name?: string): boolean {
    return name ? this._activeAnimations.has(this._animations[name]) : this._activeAnimations.size > 0;
  }
  /**
   * Gets the animation clip by name
   * @param name - Name of the animation to get
   * @returns The animation clip if exists, otherwise null
   */
  getAnimationClip(name: string): AnimationClip | null {
    return this._animations[name] ?? null;
  }
  /**
   * Gets the weight of specific animation which is currently playing
   * @param name - Name of the animation
   * @returns Weight of the animation or 0 if this animation is not playing
   */
  getAnimationWeight(name: string): number {
    const ani = this._animations[name];
    const info = this._activeAnimations.get(ani);
    return info?.weight ?? 0;
  }
  /**
   * Sets the weight of specific animation which is currently playing
   * @param name - Name of the animation
   * @param weight - New weight value
   */
  setAnimationWeight(name: string, weight: number): void {
    const ani = this._animations[name];
    const info = this._activeAnimations.get(ani);
    if (info) {
      info.weight = weight;
    }
  }
  /**
   * Starts playing an animation of the model
   * @param name - Name of the animation to play
   * @param options - Playing options
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
      const weight = options?.weight ?? 1;
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
      });
    }
  }
  /**
   * Stops playing an animation of the model
   * @param name - Name of the animation to stop playing
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
        this._activeTracks.forEach((v, k) => {
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
  dispose() {
    this._disposed = true;
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
  get disposed() {
    return this._disposed;
  }
}
