import type { InterpolationMode } from '@zephyr3d/base';
import { Interpolator, Quaternion, Vector3 } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

const tmpVec3 = new Vector3();

/**
 * Euler angle rotation animation track
 * @public
 */
export class NodeEulerRotationTrack extends AnimationTrack<Quaternion> {
  private readonly _state: Quaternion;
  private _interpolator!: Interpolator;
  /**
   * Create an instance of EulerRotationTrack
   */
  constructor();
  /**
   * Create an instance of EulerRotationTrack from keyframe values
   * @param interpolator - Interpolator object that contains the keyframe values
   * @param embedded - Whether this track be an embedded track
   */
  constructor(interpolator: Interpolator, embedded?: boolean);
  /**
   * Create an instance of EulerRotationTrack from keyframe values
   * @param mode - The interpolation mode of keyframes
   * @param keyFrames - Keyframe values
   * @param embedded - Whether this track be an embedded track
   */
  constructor(mode: InterpolationMode, keyFrames: { time: number; value: Vector3 }[], embedded?: boolean);
  constructor(
    modeOrInterpolator?: Interpolator | InterpolationMode,
    keyFramesOrEmbedded?: { time: number; value: Vector3 }[] | boolean,
    embedded?: boolean
  ) {
    if (modeOrInterpolator === undefined) {
      super(false);
    } else if (modeOrInterpolator instanceof Interpolator) {
      if (modeOrInterpolator.target !== 'vec3') {
        throw new Error(`EulerRotationTrack(): interpolator target must be 'vec3'`);
      }
      super((keyFramesOrEmbedded as boolean) ?? false);
      this._interpolator = modeOrInterpolator;
    } else {
      const keyFrames = keyFramesOrEmbedded as { time: number; value: Vector3 }[];
      const inputs = new Float32Array(keyFrames.map((val) => val.time));
      const outputs = new Float32Array(keyFrames.length * 3);
      for (let i = 0; i < keyFrames.length; i++) {
        outputs[i * 3 + 0] = keyFrames[i].value.x;
        outputs[i * 3 + 1] = keyFrames[i].value.y;
        outputs[i * 3 + 2] = keyFrames[i].value.z;
      }
      super(embedded ?? false);
      this._interpolator = new Interpolator(modeOrInterpolator, 'vec3', inputs, outputs);
    }
    this._state = new Quaternion();
  }
  get interpolator() {
    return this._interpolator;
  }
  set interpolator(interp: Interpolator) {
    if (interp && interp.target !== 'vec3') {
      throw new Error(`EulerRotationTrack(): interpolator target must be 'vec3'`);
    }
    this._interpolator = interp ?? null;
  }
  /** {@inheritDoc AnimationTrack.calculateState} */
  calculateState(target: object, currentTime: number) {
    this._interpolator.interpolate(currentTime, tmpVec3);
    this._state.fromEulerAngle(tmpVec3.x, tmpVec3.y, tmpVec3.z);
    return this._state;
  }
  /** {@inheritDoc AnimationTrack.applyState} */
  applyState(node: SceneNode, state: Quaternion) {
    node.rotation.set(state);
  }
  /** {@inheritDoc AnimationTrack.mixState} */
  mixState(a: Quaternion, b: Quaternion, t: number) {
    return Quaternion.slerp(a, b, t);
  }
  /** {@inheritDoc AnimationTrack.getBlendId} */
  getBlendId() {
    return 'node-rotation';
  }
  /** {@inheritDoc AnimationTrack.getDuration} */
  getDuration() {
    return this._interpolator.maxTime;
  }
}
