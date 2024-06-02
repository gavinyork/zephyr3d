import type { InterpolationMode } from '@zephyr3d/base';
import { Interpolator, Quaternion } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

/**
 * Rotation animation track
 * @public
 */
export class RotationTrack extends AnimationTrack<Quaternion> {
  /**
   * Create an instance of RotationTrack from keyframe values
   * @param interpolator - Interpolator object that contains keyframe values
   */
  constructor(interpolator: Interpolator);
  /**
   * Create an instance of RotationTrack from keyframe values
   * @param mode - The interpolation mode of keyframes
   * @param keyFrames - Keyframe values
   */
  constructor(mode: InterpolationMode, keyFrames: { time: number; value: Quaternion }[]);
  constructor(
    modeOrInterpolator: Interpolator | InterpolationMode,
    keyFrames?: { time: number; value: Quaternion }[]
  ) {
    if (modeOrInterpolator instanceof Interpolator) {
      if (modeOrInterpolator.target !== 'quat') {
        throw new Error(`RotationTrack(): interpolator target must be 'quat'`);
      }
      super(modeOrInterpolator);
    } else {
      const inputs = new Float32Array(keyFrames.map((val) => val.time));
      const outputs = new Float32Array(keyFrames.length * 4);
      for (let i = 0; i < keyFrames.length; i++) {
        outputs[i * 4 + 0] = keyFrames[i].value.x;
        outputs[i * 4 + 1] = keyFrames[i].value.y;
        outputs[i * 4 + 2] = keyFrames[i].value.z;
        outputs[i * 4 + 3] = keyFrames[i].value.w;
      }
      const interpolator = new Interpolator(modeOrInterpolator, 'quat', inputs, outputs);
      super(interpolator);
    }
  }
  calculateState(currentTime: number): Quaternion {
    const q = new Quaternion();
    this._interpolator.interpolate(currentTime, q);
    return q;
  }
  applyState(node: SceneNode, state: Quaternion) {
    node.rotation.set(state);
  }
  mixState(a: Quaternion, b: Quaternion, t: number): Quaternion {
    return Quaternion.slerp(a, b, t);
  }
  getBlendId(): unknown {
    return 'node-rotation';
  }
}
