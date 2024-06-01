import type { InterpolationMode } from '@zephyr3d/base';
import { Interpolator, Vector3 } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

/**
 * Translate animation track
 * @public
 */
export class TranslationTrack extends AnimationTrack<Vector3> {
  /**
   * Create an instance of TranslationTrack from keyframe values
   * @param interpolator - Interpolator object that contains the keyframe values
   */
  constructor(interpolator: Interpolator);
  /**
   * Create an instance of TranslationTrack from keyframe values
   * @param mode - The interpolation mode of keyframes
   * @param keyFrames - Keyframe values
   */
  constructor(mode: InterpolationMode, keyFrames: { time: number; value: Vector3 }[]);
  constructor(
    modeOrInterpolator?: Interpolator | InterpolationMode,
    keyFrames?: { time: number; value: Vector3 }[]
  ) {
    if (modeOrInterpolator instanceof Interpolator) {
      if (modeOrInterpolator.target !== 'vec3') {
        throw new Error(`TranslationTrack(): interpolator target must be 'vec3'`);
      }
      super(modeOrInterpolator);
    } else {
      const inputs = new Float32Array(keyFrames.map((val) => val.time));
      const outputs = new Float32Array(keyFrames.length * 3);
      for (let i = 0; i < keyFrames.length; i++) {
        outputs[i * 3 + 0] = keyFrames[i].value.x;
        outputs[i * 3 + 1] = keyFrames[i].value.y;
        outputs[i * 3 + 2] = keyFrames[i].value.z;
      }
      const interpolator = new Interpolator(modeOrInterpolator, 'vec3', inputs, outputs);
      super(interpolator);
    }
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number): boolean {
    const state = this.calculateState(currentTime);
    this.applyState(node, state);
    // this._interpolator.interpolate(currentTime, tmpVec3);
    // node.position.set(tmpVec3);
    return true;
  }
  calculateState(currentTime: number): Vector3 {
    const v = new Vector3();
    this._interpolator.interpolate(currentTime, v);
    return v;
  }
  applyState(node: SceneNode, state: Vector3) {
    node.position.set(state);
  }
  mixState(a: Vector3, b: Vector3, t: number): Vector3 {
    return new Vector3(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), a.z + t * (b.z - a.z));
  }
  getState(node: SceneNode): Vector3 {
    return node.position;
  }
  getBlendId(): unknown {
    return 'node-translation';
  }
}
