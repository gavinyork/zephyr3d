import { weightedAverage } from '@zephyr3d/base';
import { Application } from '../app';
import type { Scene, SceneNode } from '../scene';
import type { AnimationClip } from './animation';
import type { AnimationTrack } from './animationtrack';
import type { Skeleton } from './skeleton';

/**
 * Animation set
 * @public
 */
export class AnimationSet {
  /** @internal */
  private _model: SceneNode;
  /** @internal */
  private _animations: Record<string, AnimationClip>;
  /** @internal */
  private _scene: Scene;
  /** @internal */
  private _activeTracks: Map<SceneNode, Map<unknown, AnimationTrack[]>>;
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
    }
  >;
  /**
   * Creates an instance of AnimationSet
   * @param scene - The scene to which the animation set belongs
   */
  constructor(scene: Scene, model: SceneNode) {
    this._scene = scene;
    this._model = model;
    this._scene.animationSet.push(this);
    this._animations = {};
    this._activeTracks = new Map();
    this._activeSkeletons = new Map();
    this._activeAnimations = new Map();
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
  update(): void {
    this._activeAnimations.forEach((v, k) => {
      // Update animation time
      if (v.firstFrame) {
        v.firstFrame = false;
      } else {
        const timeAdvance = Application.instance.device.frameInfo.elapsedFrame * 0.001 * v.speedRatio;
        v.currentTime += timeAdvance;
        if (v.currentTime > k.timeDuration) {
          v.repeatCounter++;
          v.currentTime = 0;
        } else if (v.currentTime < 0) {
          v.repeatCounter++;
          v.currentTime = k.timeDuration;
        }
        if (v.repeat !== 0 && v.repeatCounter >= v.repeat) {
          this.stopAnimation(k.name);
        }
      }
    });
    // Update tracks
    this._activeTracks.forEach((v, k) => {
      v.forEach((tracks) => {
        if (tracks.length > 0) {
          const weights = tracks.map((track) => {
            return this._activeAnimations.get(track.animation).weight;
          });
          const states = tracks.map((track) =>
            track.calculateState(this._activeAnimations.get(track.animation).currentTime)
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
   * @param name - Name of the animation to be checked
   * @returns true if the animation is playing, otherwise false
   */
  isPlayingAnimation(name?: string): boolean {
    return name ? this._activeAnimations.has(this._animations[name]) : this._activeAnimations.size > 0;
  }
  /**
   * Starts playing an animation of the model
   * @param name - Name of the animation to play
   * @param repeat - The repeat times, 0 for always repeating, default is 0
   * @param ratio - The speed ratio, default is 1. Use negative value to play backwards
   */
  playAnimation(name: string, repeat = 0, speedRatio = 1): void {
    const ani = this._animations[name];
    if (ani && !this._activeAnimations.has(ani)) {
      this._activeAnimations.set(ani, {
        repeat: repeat,
        repeatCounter: 0,
        currentTime: speedRatio < 0 ? ani.timeDuration : 0,
        firstFrame: true,
        weight: 1,
        speedRatio
      });
      ani.play(repeat, speedRatio);
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
  stopAnimation(name: string): void {
    const ani = this._animations[name];
    if (this._activeAnimations.has(ani)) {
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
          k.reset(this._model);
          this._activeSkeletons.delete(k);
        } else {
          this._activeSkeletons.set(k, refcount - 1);
        }
      });
    }
    this._animations[name]?.stop();
  }
  dispose() {
    const index = this._scene.animationSet.indexOf(this);
    if (index >= 0) {
      this._scene.animationSet.splice(index, 1);
    }
    for (const k in this._animations) {
      this._animations[k].dispose();
    }
    this._animations = {};
    this._activeAnimations.clear();
    this._activeSkeletons.clear();
    this._activeTracks.clear();
  }
}
