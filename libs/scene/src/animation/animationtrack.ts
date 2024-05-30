import type { Interpolator } from '@zephyr3d/base';
import type { SceneNode } from '../scene';

/**
 * Base class for any kind of animation track
 * @public
 */
export abstract class AnimationTrack {
  /** @internal */
  protected _interpolator: Interpolator;
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
  /** Stops playing the track and rewind to the first frame */
  reset(node: SceneNode) {}
  /**
   * Apply animation to node
   *
   * @param node - To which node the track will apply
   * @param currentTime - Current animation time
   * @param duration - Total animation duration
   * @returns true if applied, otherwise false
   */
  abstract apply(node: SceneNode, currentTime: number): boolean;
}
