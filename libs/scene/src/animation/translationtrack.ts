import type { InterpolationMode } from '@zephyr3d/base';
import { Interpolator, Vector3 } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

/**
 * Translate animation track
 * @public
 */
export class NodeTranslationTrack extends AnimationTrack<Vector3> {
  private readonly _state: Vector3;
  private _interpolator: Interpolator;
  /**
   * Create an instance of TranslationTrack
   */
  constructor();
  /**
   * Create an instance of TranslationTrack from keyframe values
   * @param interpolator - Interpolator object that contains the keyframe values
   * @param embedded - Whether this track be an embedded track
   */
  constructor(interpolator: Interpolator, embedded?: boolean);
  /**
   * Create an instance of TranslationTrack from keyframe values
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
      this._interpolator = null;
    } else if (modeOrInterpolator instanceof Interpolator) {
      if (modeOrInterpolator.target !== 'vec3') {
        throw new Error(`TranslationTrack(): interpolator target must be 'vec3'`);
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
    this._state = new Vector3();
    this._jointIndex = -1;
  }
  get interpolator() {
    return this._interpolator;
  }
  set interpolator(interp: Interpolator) {
    if (interp && interp.target !== 'vec3') {
      throw new Error(`TranslationTrack(): interpolator target must be 'vec3'`);
    }
    this._interpolator = interp ?? null;
  }
  /** {@inheritDoc AnimationTrack.calculateState} */
  calculateState(target: object, currentTime: number): Vector3 {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }
  /** {@inheritDoc AnimationTrack.applyState} */
  applyState(node: SceneNode, state: Vector3) {
    node.position.set(state);
  }
  /** {@inheritDoc AnimationTrack.mixState} */
  mixState(a: Vector3, b: Vector3, t: number): Vector3 {
    return new Vector3(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), a.z + t * (b.z - a.z));
  }
  /** {@inheritDoc AnimationTrack.getBlendId} */
  getBlendId(): unknown {
    return 'node-translation';
  }
  /** {@inheritDoc AnimationTrack.getDuration} */
  getDuration(): number {
    return this._interpolator.maxTime;
  }
}
