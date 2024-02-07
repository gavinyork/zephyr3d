import type { InterpolationMode} from "@zephyr3d/base";
import { Interpolator, Vector3 } from "@zephyr3d/base";
import { AnimationTrack } from "./animationtrack";
import type { SceneNode } from "../scene";

// Reduce gc
const tmpVec3 = new Vector3();

/**
 * Scale animation track
 * @public
 */
export class ScaleTrack extends AnimationTrack {
  /**
   * Create an instance of ScaleTrack from keyframe values
   * @param interpolator - Interpolator object that contains keyframe values
   */
  constructor(interpolator: Interpolator);
  /**
   * Create an instance of ScaleTrack from keyframe values
   * @param mode - The interpolation mode of keyframes
   * @param keyFrames - Keyframe values
   */
  constructor(mode: InterpolationMode, keyFrames: { time: number, value: Vector3 }[]);
  constructor(modeOrInterpolator?: Interpolator|InterpolationMode, keyFrames?: { time: number, value: Vector3 }[]) {
    if (modeOrInterpolator instanceof Interpolator) {
      if (modeOrInterpolator.target !== 'vec3') {
        throw new Error(`ScaleTrack(): interpolator target must be 'vec3'`);
      }
      super(modeOrInterpolator);
    } else {
      const inputs = new Float32Array(keyFrames.map(val => val.time));
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
  apply(node: SceneNode, currentTime: number, duration: number): boolean {
    this._interpolator.interpolate(currentTime, duration, tmpVec3);
    node.scale.set(tmpVec3);
    return true;
  }
}
