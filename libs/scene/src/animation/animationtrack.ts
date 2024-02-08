import type { Interpolator } from '@zephyr3d/base';
import type { SceneNode } from '../scene';

/**
 * Base class for any kind of animation track
 * @public
 */
export abstract class AnimationTrack {
  /** @internal */
  protected _interpolator: Interpolator;
  /** @internal */
  protected _currentPlayTime: number;
  /** @internal */
  protected _playing: boolean;
  /**
   * Creates a new animation track
   * @param interpolator - Interpolator for the track
   */
  constructor(interpolator: Interpolator) {
    this._currentPlayTime = 0;
    this._playing = false;
    this._interpolator = interpolator;
  }
  /** Gets the interpolator of the track */
  get interpolator(): Interpolator {
    return this._interpolator;
  }
  /** Return true if the track is playing, otherwise false */
  get playing(): boolean {
    return this._playing;
  }
  /** Starts playing the track */
  start() {
    this._playing = true;
  }
  /** Stops playing the track */
  stop() {
    this._playing = false;
  }
  /** Rewinds the track to the first frame */
  rewind() {
    this._currentPlayTime = 0;
  }
  /** Stops playing the track and rewind to the first frame */
  reset() {
    this.stop();
    this._currentPlayTime = 0;
  }
  /**
   * Apply animation to node
   *
   * @param node - To which node the track will apply
   * @param currentTime - Current animation time
   * @param duration - Total animation duration
   * @returns true if applied, otherwise false
   */
  abstract apply(node: SceneNode, currentTime: number, duration: number): boolean;
}
