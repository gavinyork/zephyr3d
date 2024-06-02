import type { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene/scene_node';
import type { Skeleton } from './skeleton';

/**
 * Animation that contains multiple tracks
 * @public
 */
export class AnimationClip {
  /** @internal */
  protected _name: string;
  /** @internal */
  protected _duration: number;
  /** @internal */
  protected _tracks: Map<SceneNode, AnimationTrack[]>;
  /** @internal */
  protected _skeletons: Set<Skeleton>;
  /**
   * Creates an animation instance
   * @param name - Name of the animation
   * @param model - Parent node if this is a skeleton animation
   */
  constructor(name: string) {
    this._name = name;
    this._tracks = new Map();
    this._duration = 0;
    this._skeletons = new Set();
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
   * Adds an animation track to the animation
   * @param node - The node that will be controlled by the track
   * @param track - The track to be added
   * @returns self
   */
  addTrack(node: SceneNode, track: AnimationTrack): this {
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
    const tracks = this._tracks.get(node);
    if (tracks && tracks.findIndex((track) => track.getBlendId() === blendId) >= 0) {
      console.error('Tracks with same BlendId could not be added to same animation');
      return;
    }
    track.animation = this;
    let trackInfo = this._tracks.get(node);
    if (!trackInfo) {
      trackInfo = [];
      this._tracks.set(node, trackInfo);
    }
    trackInfo.push(track);
    this._duration = Math.max(this._duration, track.interpolator.maxTime);
    track.reset(node);
    return this;
  }
}
