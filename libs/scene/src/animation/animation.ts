import { Disposable } from '@zephyr3d/base';
import type { AnimationSet } from './animationset';
import type { AnimationTrack } from './animationtrack';

/**
 * A serializable reference to a point on an animation clip timeline.
 * @public
 */
export type AnimationTimeRef =
  | number
  | {
      time: number;
    }
  | {
      frame: number;
      fps?: number;
    }
  | {
      marker: string;
    };

/**
 * Timeline marker metadata stored on an animation clip.
 *
 * Markers are data, not callbacks. Runtime systems may dispatch events when a
 * playback cursor crosses the marker.
 * @public
 */
export type AnimationMarker = {
  /** Stable marker id for editor and blueprint references. */
  id?: string;
  /** Display/event name. */
  name: string;
  /** Marker time in seconds. */
  time?: number;
  /** Marker frame. Converted with `fps` or the owning clip's `frameRate`. */
  frame?: number;
  /** Optional frame rate used for `frame` conversion. */
  fps?: number;
  /** Serializable user payload. */
  payload?: unknown;
};

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
  /** @internal */
  protected _frameRate: number;
  /** @internal */
  protected _markers: AnimationMarker[];
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
    this._frameRate = 30;
    this._markers = [];
  }
  /**
   * Whether this clip is embedded (owned inline by its container/resource).
   */
  get embedded() {
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
  get name() {
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
   * Default frame rate used to convert frame-based marker references.
   */
  get frameRate() {
    return this._frameRate;
  }
  set frameRate(val: number) {
    if (Number.isFinite(val) && val > 0) {
      this._frameRate = val;
    }
  }
  /**
   * Timeline markers stored on this clip.
   */
  get markers() {
    return this._markers;
  }
  /**
   * Total time span of the clip in seconds.
   *
   * Automatically extended when adding tracks with longer duration.
   */
  get timeDuration() {
    return this._duration;
  }
  set timeDuration(val) {
    this._duration = val;
  }
  /**
   * Add a serializable marker to this clip.
   *
   * @param marker - Marker metadata. If `id` is omitted, `name` is used as the id.
   * @returns The normalized marker.
   */
  addMarker(marker: AnimationMarker): AnimationMarker | null {
    if (!marker?.name) {
      console.error('Animation marker must have a name');
      return null;
    }
    const normalized: AnimationMarker = {
      ...marker,
      id: marker.id || marker.name
    };
    if (this.resolveMarkerTime(normalized) === null) {
      console.error('Animation marker must have either time or frame');
      return null;
    }
    this._markers.push(normalized);
    this._markers.sort((a, b) => (this.resolveMarkerTime(a) ?? 0) - (this.resolveMarkerTime(b) ?? 0));
    return normalized;
  }
  /**
   * Remove markers matching the marker id or name.
   */
  removeMarker(idOrName: string) {
    const oldLength = this._markers.length;
    this._markers = this._markers.filter((marker) => marker.id !== idOrName && marker.name !== idOrName);
    return this._markers.length !== oldLength;
  }
  /**
   * Get the first marker matching the marker id or name.
   */
  getMarker(idOrName: string) {
    return this._markers.find((marker) => marker.id === idOrName || marker.name === idOrName) ?? null;
  }
  /**
   * Resolve a marker to seconds on this clip's timeline.
   */
  resolveMarkerTime(marker: AnimationMarker): number | null {
    if (typeof marker.time === 'number' && Number.isFinite(marker.time)) {
      return marker.time;
    }
    if (typeof marker.frame === 'number' && Number.isFinite(marker.frame)) {
      const fps = marker.fps ?? this._frameRate;
      return fps > 0 ? marker.frame / fps : null;
    }
    return null;
  }
  /**
   * Resolve a time reference to seconds on this clip's timeline.
   */
  resolveTimeRef(ref: AnimationTimeRef | null | undefined): number | null {
    if (ref === null || ref === undefined) {
      return null;
    }
    if (typeof ref === 'number') {
      return Number.isFinite(ref) ? ref : null;
    }
    if ('time' in ref) {
      return Number.isFinite(ref.time) ? ref.time : null;
    }
    if ('frame' in ref) {
      const fps = ref.fps ?? this._frameRate;
      return Number.isFinite(ref.frame) && fps > 0 ? ref.frame / fps : null;
    }
    if ('marker' in ref) {
      const marker = this.getMarker(ref.marker);
      return marker ? this.resolveMarkerTime(marker) : null;
    }
    return null;
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
  deleteTrack(track: AnimationTrack) {
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
  addTrack(target: object, track: AnimationTrack) {
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
  /*
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
  */
}
