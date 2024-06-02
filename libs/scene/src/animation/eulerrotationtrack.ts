import type { InterpolationMode } from '@zephyr3d/base';
import { Interpolator, Quaternion, Vector3 } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

const tmpVec3 = new Vector3();

/**
 * Euler angle rotation animation track
 * @public
 */
export class EulerRotationTrack extends AnimationTrack<Quaternion> {
  /**
   * Create an instance of EulerRotationTrack from keyframe values
   * @param mode - The interpolation mode of keyframes
   * @param keyFrames - Keyframe values
   */
  constructor(mode: InterpolationMode, keyFrames: { time: number; value: Vector3 }[]) {
    const inputs = new Float32Array(keyFrames.map((val) => val.time));
    const outputs = new Float32Array(keyFrames.length * 3);
    for (let i = 0; i < keyFrames.length; i++) {
      outputs[i * 3 + 0] = keyFrames[i].value.x;
      outputs[i * 3 + 1] = keyFrames[i].value.y;
      outputs[i * 3 + 2] = keyFrames[i].value.z;
    }
    const interpolator = new Interpolator(mode, 'vec3', inputs, outputs);
    super(interpolator);
  }
  calculateState(currentTime: number): Quaternion {
    this._interpolator.interpolate(currentTime, tmpVec3);
    return Quaternion.fromEulerAngle(tmpVec3.x, tmpVec3.y, tmpVec3.z, 'ZYX');
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
