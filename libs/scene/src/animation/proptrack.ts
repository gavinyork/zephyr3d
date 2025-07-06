import { AnimationTrack } from './animationtrack';
import type { PropertyAccessor, PropertyValue } from '../utility';
import { Interpolator } from '@zephyr3d/base';

/**
 * Translate animation track
 * @public
 */
export class PropertyTrack extends AnimationTrack<PropertyValue> {
  private _state: PropertyValue;
  private _stateAlpha: PropertyValue;
  private _target: string;
  private _prop: PropertyAccessor;
  private _count: number;
  private _interpolator: Interpolator;
  private _interpolatorAlpha: Interpolator;
  /**
   * Create an instance of TranslationTrack from keyframe values
   * @param prop - Property to be animated
   */
  constructor(prop: PropertyAccessor, value?: number[], embedded?: boolean) {
    super(embedded);
    this._prop = prop;
    this._target = '';
    this._state = { num: [0, 0, 0, 0] };
    this._stateAlpha = null;
    this._interpolator = null;
    this._interpolatorAlpha = null;
    if (value) {
      this._state.num = value.slice();
    }
    switch (this._prop.type) {
      case 'float':
        this._count = 1;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'number',
          new Float32Array([0, 1]),
          new Float32Array([this._state.num[0], this._state.num[0]])
        );
        break;
      case 'vec2':
        this._count = 2;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec2',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.num.slice(0, 2), ...this._state.num.slice(0, 2)])
        );
        break;
      case 'rgb':
      case 'vec3':
        this._count = 3;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec3',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.num.slice(0, 3), ...this._state.num.slice(0, 3)])
        );
        break;
      case 'vec4':
        this._count = 4;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec4',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.num.slice(0, 4), ...this._state.num.slice(0, 4)])
        );
        break;
      case 'rgba':
        this._count = 4;
        this._interpolator = new Interpolator(
          'linear',
          'vec3',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.num.slice(0, 3), ...this._state.num.slice(0, 3)])
        );
        this._interpolatorAlpha = new Interpolator(
          'linear',
          'number',
          new Float32Array([0, 1]),
          new Float32Array([this._state.num[3], this._state.num[3]])
        );
        this._stateAlpha = { num: [this._state.num[3]] };
        break;
      default:
        throw new Error(`Property '${this._prop.name}' cannot be animated`);
    }
  }
  get target() {
    return this._target;
  }
  set target(val: string) {
    this._target = val;
  }
  get interpolator() {
    return this._interpolator;
  }
  set interpolator(interpolator: Interpolator) {
    this._interpolator = interpolator;
  }
  get interpolatorAlpha() {
    return this._interpolatorAlpha;
  }
  set interpolatorAlpha(interpolator: Interpolator) {
    this._interpolatorAlpha = interpolator ?? null;
    if (!this._stateAlpha && this._interpolatorAlpha) {
      this._stateAlpha = { num: [0] };
    }
  }
  calculateState(target: unknown, currentTime: number): PropertyValue {
    this._interpolator.interpolate(currentTime, this._state.num);
    if (this._interpolatorAlpha) {
      this._interpolatorAlpha.interpolate(currentTime, this._stateAlpha.num);
      this._state.num[3] = this._stateAlpha.num[0];
    }
    return this._state;
  }
  applyState(target: object, state: PropertyValue) {
    this._prop.set.call(target, state);
  }
  mixState(a: PropertyValue, b: PropertyValue, t: number): PropertyValue {
    const v: number[] = [];
    for (let i = 0; i < this._count; i++) {
      v[i] = a.num[i] + t * (b.num[i] - a.num[i]);
    }
    return { num: v };
  }
  getBlendId(): unknown {
    return this._prop;
  }
  getDuration(): number {
    return this._interpolator.maxTime;
  }
  getProp(): PropertyAccessor {
    return this._prop;
  }
}
