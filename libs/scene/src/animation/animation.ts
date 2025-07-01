import type { AnimationTrack } from './animationtrack';
import type { Skeleton } from './skeleton';

/**
 * Animation that contains multiple tracks
 * @public
 */
export class AnimationClip {
  /** @internal */
  protected _name: string;
  /** @internal */
  protected _embedded: boolean;
  /** @internal */
  protected _duration: number;
  /** @internal */
  protected _autoPlay: boolean;
  /** @internal */
  protected _tracks: Map<unknown, AnimationTrack[]>;
  /** @internal */
  protected _skeletons: Set<Skeleton>;
  /**
   * Creates an animation instance
   * @param name - Name of the animation
   * @param model - Parent node if this is a skeleton animation
   */
  constructor(name: string, embedded = false) {
    this._name = name;
    this._embedded = embedded;
    this._tracks = new Map();
    this._duration = 0;
    this._skeletons = new Set();
  }
  /** Whether this is an embedded animation */
  get embedded(): boolean {
    return this._embedded;
  }
  /** Disposes self */
  dispose() {
    this._tracks = null;
    this._skeletons?.forEach((val, key) => key.dispose());
    this._skeletons = null;
  }
  /** Gets the name of the animation */
  get name(): string {
    return this._name;
  }
  /** Gets all the tracks of this animation */
  get tracks() {
    return this._tracks;
  }
  /** Gets all skeletons */
  get skeletons() {
    return this._skeletons;
  }
  /** The duration of the animation */
  get timeDuration(): number {
    return this._duration;
  }
  /**
   * Adds a skeleton to the animation
   * @param skeleton - The skeleton to be added
   * @param meshList - The meshes controlled by the skeleton
   * @param boundingBoxInfo - Bounding box information for the skeleton
   */
  addSkeleton(skeleton: Skeleton) {
    this._skeletons.add(skeleton);
  }
  /**
   * Deletes an animation track from this animation
   * @param track - The track to delete
   * @returns self
   */
  deleteTrack(track: AnimationTrack): this {
    if (track?.animation !== this) {
      console.error('Cannot delete animation track which is not belongs to THIS animation');
    }
    for (const k of this._tracks.keys()) {
      const tracks = this._tracks.get(k);
      const index = tracks.indexOf(track);
      if (index >= 0) {
        tracks.splice(index, 1);
      }
    }
    return this;
  }
  /**
   * Adds an animation track to this animation
   * @param target - The node that will be controlled by the track
   * @param track - The track to be added
   * @returns self
   */
  addTrack(target: unknown, track: AnimationTrack): this {
    if (!track) {
      return;
    }
    if (track.animation) {
      if (track.animation === this) {
        return;
      } else {
        console.error('Track is already in another animation');
        return;
      }
    }
    const blendId = track.getBlendId();
    const tracks = this._tracks.get(target);
    if (tracks && tracks.findIndex((track) => track.getBlendId() === blendId) >= 0) {
      console.error('Tracks with same BlendId could not be added to same animation');
      return;
    }
    track.animation = this;
    let trackInfo = this._tracks.get(target);
    if (!trackInfo) {
      trackInfo = [];
      this._tracks.set(target, trackInfo);
    }
    trackInfo.push(track);
    this._duration = Math.max(this._duration, track.interpolator?.maxTime ?? 0);
    track.reset(target);
    return this;
  }
}
