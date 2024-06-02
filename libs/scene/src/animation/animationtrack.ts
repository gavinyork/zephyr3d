import type { Interpolator } from '@zephyr3d/base';
import type { SceneNode } from '../scene';
import type { AnimationClip } from './animation';

/**
 * Base class for any kind of animation track
 * @public
 */
export abstract class AnimationTrack<StateType = unknown> {
  /** @internal */
  protected _interpolator: Interpolator;
  /** @internal */
  protected _animation: AnimationClip;
  /**
   * Creates a new animation track
   * @param interpolator - Interpolator for the track
   */
  constructor(interpolator: Interpolator) {
    this._interpolator = interpolator;
  }
  /** Gets the interpolator of the track */
  get interpolator(): Interpolator {
    return this._interpolator;
  }
  /** Animation this track belongs to */
  get animation(): AnimationClip {
    return this._animation;
  }
  set animation(ani: AnimationClip) {
    this._animation = ani;
  }
  /** Stops playing the track and rewind to the first frame */
  reset(node: SceneNode) {}
  /**
   * Calculates current animation state
   * @param currentTime - At which time the animation state should be calculated.
   * @returns State object
   */
  abstract calculateState(currentTime: number): StateType;
  /**
   * Applys animation state to node
   * @param node - The scene node to which the state will be applied
   * @param state - The animation state
   */
  abstract applyState(node: SceneNode, state: StateType);
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
}
