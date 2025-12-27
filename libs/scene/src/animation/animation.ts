import { Disposable } from '@zephyr3d/base';
import type { AnimationSet } from './animationset';
import type { AnimationTrack } from './animationtrack';

/**
 * Animation clip
 *
 * Represents a named animation composed of multiple tracks targeting various objects/properties,
 * with an overall duration, weight, and optional auto-play behavior. Tracks may target different
 * objects and are grouped by a per-target array. Skeletons used by this clip are tracked for
 * lifecycle and application during playback.
 *
 * Typical workflow:
 * - Create a clip via `AnimationSet.createAnimation(name)`.
 * - Add one or more `AnimationTrack`s via `addTrack(target, track)`.
 * - Optionally register skeletons via `addSkeleton(...)`.
 * - Start playback through the owning `AnimationSet.playAnimation(name, options)`.
 *
 * @public
 */
export class AnimationClip extends Disposable {
  /** @internal */
  protected _name: string;
  /** @internal */
  protected _animationSet: AnimationSet;
  /** @internal */
  protected _embedded: boolean;
  /** @internal */
  protected _duration: number;
  /** @internal */
  protected _autoPlay: boolean;
  /** @internal */
  protected _tracks: Map<object, AnimationTrack[]>;
  protected _weight: number;
  /** @internal */
  protected _skeletons: Set<string>;
  /**
   * Creates an animation instance
   * @param name - Name of the animation
   * @param model - Parent node if this is a skeleton animation
   */
  constructor(name: string, animationSet: AnimationSet, embedded = false) {
    super();
    this._name = name;
    this._animationSet = animationSet;
    this._embedded = embedded;
    this._tracks = new Map();
    this._duration = 0;
    this._weight = 1;
    this._autoPlay = false;
    this._skeletons = new Set();
  }
  /**
   * Whether this clip is embedded (owned inline by its container/resource).
   */
  get embedded(): boolean {
    return this._embedded;
  }
  /**
   * The `AnimationSet` that owns this clip.
   */
  get animationSet() {
    return this._animationSet;
  }
  /**
   * Global blend weight for the clip.
   *
   * Used by the animation system when combining multiple active clips.
   */
  get weight() {
    return this._weight;
  }
  set weight(val: number) {
    this._weight = val;
  }
  /**
   * Whether this clip should start playing automatically when loaded/instantiated.
   */
  get autoPlay() {
    return this._autoPlay;
  }
  set autoPlay(val: boolean) {
    this._autoPlay = val;
  }
  /**
   * The unique name of this clip.
   */
  get name(): string {
    return this._name;
  }
  /**
   * All animation tracks grouped by target object.
   *
   * Key: target object; Value: list of `AnimationTrack`s affecting that target.
   */
  get tracks() {
    return this._tracks;
  }
  /**
   * All skeletons referenced by this clip.
   */
  get skeletons() {
    return this._skeletons;
  }
  set skeletons(val: Set<string>) {
    this._skeletons = val;
  }
  /**
   * Total time span of the clip in seconds.
   *
   * Automatically extended when adding tracks with longer duration.
   */
  get timeDuration(): number {
    return this._duration;
  }
  set timeDuration(val: number) {
    this._duration = val;
  }
  /**
   * Add a skeleton used by this clip.
   *
   * @param skeletonId - Persistent ID of Skeleton to register for this clip.
   */
  addSkeleton(skeletonId: string) {
    this._skeletons.add(skeletonId);
  }
  /**
   * Remove a specific track from this clip.
   *
   * Errors if the track does not belong to this clip. Does nothing if not found.
   *
   * @param track - The track instance to remove.
   * @returns This clip (for chaining).
   */
  deleteTrack(track: AnimationTrack): this {
    if (track?.animation !== this) {
      console.error('Cannot delete animation track which is not belongs to THIS animation');
    }
    for (const k of this._tracks.keys()) {
      const tracks = this._tracks.get(k)!;
      const index = tracks.indexOf(track);
      if (index >= 0) {
        tracks.splice(index, 1);
      }
    }
    return this;
  }
  /**
   * Add a track to this clip for a specific target object.
   *
   * Constraints:
   * - The track must not already belong to another clip.
   * - Only one track with the same blendId may exist per target in a single clip.
   *
   * Side effects:
   * - Assigns this clip to `track.animation`.
   * - Extends `timeDuration` to cover the track duration if longer.
   * - Calls `track.reset(target)` to initialize the target state if needed.
   *
   * @param target - Target object controlled by the track.
   * @param track - Track to add.
   * @returns This clip (for chaining).
   */
  addTrack(target: object, track: AnimationTrack): this {
    if (!track) {
      return this;
    }
    if (track.animation) {
      if (track.animation === this) {
        return this;
      } else {
        console.error('Track is already in another animation');
        return this;
      }
    }
    const blendId = track.getBlendId();
    const tracks = this._tracks.get(target);
    if (tracks && tracks.findIndex((track) => track.getBlendId() === blendId) >= 0) {
      console.error('Tracks with same BlendId could not be added to same animation');
      return this;
    }
    track.animation = this;
    let trackInfo = this._tracks.get(target);
    if (!trackInfo) {
      trackInfo = [];
      this._tracks.set(target, trackInfo);
    }
    trackInfo.push(track);
    this._duration = Math.max(this._duration, track.getDuration() ?? 0);
    track.reset(target);
    return this;
  }
  /** @internal */
  resample(frames: number, callback: (frame: number) => void) {
    for (let frame = 0; frame <= frames; frame++) {
      const t = frame / this.timeDuration;
      for (const [k, v] of this.tracks) {
        for (const track of v) {
          const state = track.calculateState(k, t);
          track.applyState(k, state);
        }
      }
      for (const sk of this.skeletons) {
        const skeleton = this._animationSet.model.findSkeletonById(sk);
        if (skeleton) {
          skeleton.computeJoints();
        }
      }
      callback(frame);
    }
  }
}
