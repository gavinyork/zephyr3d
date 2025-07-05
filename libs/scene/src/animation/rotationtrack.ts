import type { InterpolationMode } from '@zephyr3d/base';
import { Interpolator, Quaternion } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

/**
 * Rotation animation track
 * @public
 */
export class NodeRotationTrack extends AnimationTrack<Quaternion> {
  private _state: Quaternion;
  private _interpolator: Interpolator;
  /**
   * Create an instance of RotationTrack from keyframe values
   * @param interpolator - Interpolator object that contains keyframe values
   * @param embedded - Whether this track be an embedded track
   */
  constructor(interpolator: Interpolator, embedded?: boolean);
  /**
   * Create an instance of RotationTrack from keyframe values
   * @param mode - The interpolation mode of keyframes
   * @param keyFrames - Keyframe values
   * @param embedded - Whether this track be an embedded track
   */
  constructor(mode: InterpolationMode, keyFrames: { time: number; value: Quaternion }[], embedded?: boolean);
  constructor(
    modeOrInterpolator: Interpolator | InterpolationMode,
    keyFramesOrEmbedded?: { time: number; value: Quaternion }[] | boolean,
    embedded?: boolean
  ) {
    if (modeOrInterpolator instanceof Interpolator) {
      if (modeOrInterpolator.target !== 'quat') {
        throw new Error(`RotationTrack(): interpolator target must be 'quat'`);
      }
      super((keyFramesOrEmbedded as boolean) ?? false);
      this._interpolator = modeOrInterpolator;
    } else {
      const keyFrames = keyFramesOrEmbedded as { time: number; value: Quaternion }[];
      const inputs = new Float32Array(keyFrames.map((val) => val.time));
      const outputs = new Float32Array(keyFrames.length * 4);
      for (let i = 0; i < keyFrames.length; i++) {
        outputs[i * 4 + 0] = keyFrames[i].value.x;
        outputs[i * 4 + 1] = keyFrames[i].value.y;
        outputs[i * 4 + 2] = keyFrames[i].value.z;
        outputs[i * 4 + 3] = keyFrames[i].value.w;
      }
      super(embedded ?? false);
      this._interpolator = new Interpolator(modeOrInterpolator, 'quat', inputs, outputs);
    }
    this._state = new Quaternion();
  }
  calculateState(target: unknown, currentTime: number): Quaternion {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
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
  getDuration(): number {
    return this._interpolator.maxTime;
  }
}
