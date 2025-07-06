import type { AnimationClip } from './animation';

/**
 * Base class for any kind of animation track
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
   * Creates a new animation track
   * @param embedded - Whether this track is an embedded track
   */
  constructor(embedded?: boolean) {
    this._name = 'noname';
    this._embedded = !!embedded;
  }
  /** Name of the track */
  get name() {
    return this._name;
  }
  set name(val: string) {
    this._name = val;
  }
  /** Wether this is an embedded track */
  get embedded(): boolean {
    return this._embedded;
  }
  /** Animation this track belongs to */
  get animation(): AnimationClip {
    return this._animation;
  }
  set animation(ani: AnimationClip) {
    this._animation = ani;
  }
  /** Stops playing the track and rewind to the first frame */
  reset(target: object) {}
  /**
   * Calculates current animation state
   * @param target - The animated object
   * @param currentTime - At which time the animation state should be calculated.
   * @returns State object
   */
  abstract calculateState(target: object, currentTime: number): StateType;
  /**
   * Applys animation state to node
   * @param target - The animated object to which the state will be applied
   * @param state - The animation state
   */
  abstract applyState(target: object, state: StateType);
  /**
   * Mixes two animation state according to specific weight value
   * @param a - The first state object
   * @param b - The second state object
   * @param t - The weight value
   * @returns The mixed state object
   */
  abstract mixState(a: StateType, b: StateType, t: number): StateType;
  /**
   * Get the blend ID
   * @returns Blend ID
   *
   * @remarks
   * Two tracks which have same blend ID can be blended together
   */
  abstract getBlendId(): unknown;
  /**
   * Get the duration of the track
   * @returns Duration of the track
   */
  abstract getDuration(): number;
}
