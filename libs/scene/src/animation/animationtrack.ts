import type { AnimationClip } from './animation';

/**
 * Base class for animation tracks.
 *
 * A track produces time-varying state for a specific target and defines how to:
 * - Compute state at a given time (`calculateState`)
 * - Apply that state to a target (`applyState`)
 * - Blend between two states (`mixState`)
 * - Report its blend compatibility (`getBlendId`)
 * - Report its intrinsic duration (`getDuration`)
 *
 * Generic:
 * - `StateType` is the shape of the computed/applied state (e.g., number, vector, pose).
 *
 * @public
 */
export abstract class AnimationTrack<StateType = unknown> {
  /** @internal */
  protected _name: string;
  /** @internal */
  protected _embedded: boolean;
  /** @internal */
  protected _animation: AnimationClip;
  /**
   * Construct a new animation track.
   *
   * @param embedded - Whether this track is embedded/owned inline by its container. Default false.
   */
  constructor(embedded?: boolean) {
    this._name = 'noname';
    this._embedded = !!embedded;
  }
  /**
   * Human-readable name of the track.
   */
  get name() {
    return this._name;
  }
  set name(val: string) {
    this._name = val;
  }
  /**
   * Whether this track is embedded (owned inline by a resource/container).
   */
  get embedded(): boolean {
    return this._embedded;
  }
  /**
   * The `AnimationClip` that owns this track.
   */
  get animation(): AnimationClip {
    return this._animation;
  }
  set animation(ani: AnimationClip) {
    this._animation = ani;
  }
  /**
   * Reset the track to its initial state for the given target.
   *
   * Intended to stop playback and rewind the target to the first frame or default state.
   *
   * @param _target - The animated object to reset.
   */
  reset(_target: object) {}
  /**
   * Compute the animation state at the specified time.
   *
   * Implementations should be pure with respect to inputs: given the same `target` and
   * `currentTime`, return the same `StateType`.
   *
   * @param target - The animated object (used to resolve current baseline if needed).
   * @param currentTime - Time cursor in seconds within the track's timeline.
   * @returns The computed state at `currentTime`.
   */
  abstract calculateState(target: object, currentTime: number): StateType;
  /**
   * Apply a previously computed animation state to the target.
   *
   * @param target - The animated object to modify.
   * @param state - The state to apply.
   */
  abstract applyState(target: object, state: StateType);
  /**
   * Blend two states into a new state using a weight.
   *
   * @param a - First state.
   * @param b - Second state.
   * @param t - Blend weight in \[0, 1\], where 0 yields `a` and 1 yields `b`.
   * @returns The blended state.
   */
  abstract mixState(a: StateType, b: StateType, t: number): StateType;
  /**
   * Get the blend identifier for this track.
   *
   * Tracks with the same blend ID are considered compatible for blending on the
   * same target channel/property.
   *
   * @returns An identifier used to group compatible tracks for blending.
   */
  abstract getBlendId(): unknown;
  /**
   * Get the intrinsic duration of this track in seconds.
   *
   * Used by clips to determine overall clip duration and looping behavior.
   *
   * @returns Track duration (seconds).
   */
  abstract getDuration(): number;
}
