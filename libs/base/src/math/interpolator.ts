import { Quaternion, Vector3 } from './vector';
import { TypedArray } from '../utils';

/**
 * The interpolation mode
 * @public
 */
export type InterpolationMode = 'unknown'|'step'|'linear'|'cubicspline';

/**
 * Target of interpolation
 * @public
 */
export type InterpolationTarget = 'number'|'vec2'|'vec3'|'vec4'|'quat';

const tmpQuat1 = new Quaternion();
const tmpQuat2 = new Quaternion();
const tmpQuat3 = new Quaternion();
const strideMap: Record<InterpolationTarget, number> = {
  number: 1,
  vec2: 2,
  vec3: 3,
  vec4: 4,
  quat: 4
};

function numberClamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

/**
 * The interpolator class
 * @public
 */
export class Interpolator {
  /** @internal */
  private _prevKey: number;
  /** @internal */
  private _prevT: number;
  /** @internal */
  private _inputs: TypedArray;
  /** @internal */
  private _outputs: TypedArray;
  /** @internal */
  private _mode: InterpolationMode;
  /** @internal */
  private _target: InterpolationTarget;
  /** @internal */
  private _stride: number;
  /** @internal */
  private _maxTime: number;
  /**
   * Interpolation target to stride
   * @param target - The interpolation target
   * @returns Stride of the target
   */
  static getTargetStride(target: InterpolationTarget): number {
    return strideMap[target] ?? 0;
  }
  /**
   * Creates a interpolator instance
   * @param mode - The interpolation mode
   * @param target - The interpolation target
   * @param inputs - Linear time in seconds
   * @param outputs - Vector or scalars representing the properties to be interpolated
   * @param stride - Stride of outputs
   */
  constructor(
    mode: InterpolationMode,
    target: InterpolationTarget,
    inputs: TypedArray,
    outputs: TypedArray,
  ) {
    this._prevKey = 0;
    this._prevT = 0;
    this._inputs = inputs;
    this._outputs = outputs;
    this._mode = mode;
    this._target = target;
    this._stride = strideMap[target] ?? 0;
    this._maxTime = inputs[inputs.length - 1];
  }
  /** Gets the interpolation mode */
  get mode(): InterpolationMode {
    return this._mode;
  }
  /** Gets the interpolation target */
  get target(): InterpolationTarget {
    return this._target;
  }
  get maxTime(): number {
    return this._maxTime;
  }
  /** @internal */
  private slerpQuat(q1: Quaternion, q2: Quaternion, t: number, result: Quaternion): Quaternion {
    return Quaternion.slerp(Quaternion.normalize(q1), Quaternion.normalize(q2), t, result)
      .inplaceNormalize();
  }
  /**
   * Calculates the interpolated value at a given time
   * @param t - The time to calcuate interpolation
   * @param maxTime - The maxmium time duration
   * @param result - The calculated interpolation value
   * @returns The calcuated interpolation value
   */
  interpolate(t: number, maxTime: number, result: Float32Array): Float32Array {
    if (t === undefined) {
      return undefined;
    }
    const input = this._inputs;
    const output = this._outputs;
    if (output.length === this._stride) {
      for (let i = 0; i < this._stride; i++) {
        result[i] = output[i];
      }
      return result;
    }
    t = numberClamp(t % maxTime, input[0], input[input.length - 1]);
    if (this._prevT > t) {
      this._prevKey = 0;
    }
    this._prevT = t;
    let nextKey: number;
    for (let i = this._prevKey; i < input.length; ++i) {
      if (t <= input[i]) {
        nextKey = numberClamp(i, 1, input.length - 1);
        break;
      }
    }
    this._prevKey = numberClamp(nextKey - 1, 0, nextKey);
    const keyDelta = input[nextKey] - input[this._prevKey];
    const tn = (t - input[this._prevKey]) / keyDelta;
    if (this._target === 'quat') {
      if (this._mode === 'cubicspline') {
        this.cubicSpline(this._prevKey, nextKey, keyDelta, tn, tmpQuat3);
        result.set(tmpQuat3);
        return result;
      } else if (this._mode === 'linear') {
        this.getQuat(this._prevKey, tmpQuat1);
        this.getQuat(nextKey, tmpQuat2);
        this.slerpQuat(tmpQuat1, tmpQuat2, tn, tmpQuat3);
        result.set(tmpQuat3);
        return result;
      } /* if (this._mode === 'step) */ else {
        return this.getQuat(this._prevKey, result);
      }
    }
    switch (this._mode) {
      case 'step':
        return this.step(this._prevKey, result);
      case 'cubicspline':
        return this.cubicSpline(this._prevKey, nextKey, keyDelta, tn, result);
      case 'linear':
      default:
        return this.linear(this._prevKey, nextKey, tn, result);
    }
  }
  /** @internal */
  private getQuat(index: number, result: Float32Array): Float32Array {
    result[0] = this._outputs[4 * index];
    result[1] = this._outputs[4 * index + 1];
    result[2] = this._outputs[4 * index + 2];
    result[3] = this._outputs[4 * index + 3];
    return result;
  }
  /** @internal */
  private step(prevKey: number, result: Float32Array): Float32Array {
    for (let i = 0; i < this._stride; i++) {
      result[i] = this._outputs[prevKey * this._stride + i];
    }
    return result;
  }
  /** @internal */
  private linear(prevKey: number, nextKey: number, t: number, result: Float32Array): Float32Array {
    for (let i = 0; i < this._stride; i++) {
      result[i] =
        this._outputs[prevKey * this._stride + i] * (1 - t) + this._outputs[nextKey * this._stride + i] * t;
    }
    return result;
  }
  /** @internal */
  private cubicSpline(prevKey: number, nextKey: number, keyDelta: number, t: number, result: Float32Array): Float32Array {
    const prevIndex = prevKey * this._stride * 3;
    const nextIndex = nextKey * this._stride * 3;
    const A = 0;
    const V = this._stride;
    const B = 2 * this._stride;
    const tSq = t * t;
    const tCub = tSq * t;
    for (let i = 0; i < this._stride; i++) {
      const v0 = this._outputs[prevIndex + i + V];
      const a = keyDelta * this._outputs[nextIndex + i + A];
      const b = keyDelta * this._outputs[prevIndex + i + B];
      const v1 = this._outputs[nextIndex + i + V];
      result[i] =
        (2 * tCub - 3 * tSq + 1) * v0 +
        (tCub - 2 * tSq + t) * b +
        (-2 * tCub + 3 * tSq) * v1 +
        (tCub - tSq) * a;
    }
    return result;
  }
}
