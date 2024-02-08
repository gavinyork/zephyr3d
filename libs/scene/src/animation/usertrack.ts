import type { InterpolationMode, InterpolationTarget } from '@zephyr3d/base';
import { Interpolator } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

/**
 * Track handler type for numeric or vector keyframe values
 * @public
 */
export type NumberTrackHandler = (node: SceneNode, value: Float32Array) => void;

const tmpValue = new Float32Array(4);

/**
 * User-defined animation track
 * @public
 */
export class UserTrack extends AnimationTrack {
  private _handler: NumberTrackHandler;
  /**
   * Create an instance of UserTrack
   * @param mode - Interpolation mode for keyframe values
   * @param target - Type of keyframe values
   * @param keyFrames - Keyframe values
   * @param handler - Handler to apply the keyframe values
   */
  constructor(
    mode: InterpolationMode,
    target: InterpolationTarget,
    keyFrames: { time: number; value: number | Float32Array }[],
    handler: NumberTrackHandler
  ) {
    const stride = Interpolator.getTargetStride(target);
    if (!stride) {
      throw new Error(`UserTrack(): invalid target: ${target}`);
    }
    const inputs = new Float32Array(keyFrames.map((val) => val.time));
    const outputs = new Float32Array(keyFrames.length * stride);
    for (let i = 0; i < keyFrames.length; i++) {
      for (let j = 0; j < stride; j++) {
        const value = keyFrames[i].value;
        if (typeof value === 'number') {
          outputs[i * stride + j] = value;
        } else if (value instanceof Float32Array) {
          outputs[i * stride + j] = value[j] ?? 0;
        } else {
          throw new Error(`UserTrack(): invalid keyframe value: ${value}`);
        }
      }
    }
    const interpolator = new Interpolator(mode, target, inputs, outputs);
    super(interpolator);
    this._handler = handler;
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number, duration: number): boolean {
    this._interpolator.interpolate(currentTime, duration, tmpValue);
    this._handler && this._handler(node, tmpValue);
    return true;
  }
}
