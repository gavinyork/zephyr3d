import { AnimationTrack } from './animationtrack';
import type { PropertyAccessor, PropertyValue } from '../utility';
import { Interpolator } from '@zephyr3d/base';

/**
 * Translate animation track
 * @public
 */
export class PropertyTrack extends AnimationTrack<PropertyValue> {
  private _state: PropertyValue;
  private _prop: PropertyAccessor;
  private _count: number;
  /**
   * Create an instance of TranslationTrack from keyframe values
   * @param prop - Property to be animated
   */
  constructor(prop: PropertyAccessor, value?: number[], embedded?: boolean) {
    super(undefined, embedded);
    this._prop = prop;
    this._state = { num: [0, 0, 0, 0] };
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
      case 'rgba':
      case 'vec4':
        this._count = 4;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec4',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.num.slice(0, 4), ...this._state.num.slice(0, 4)])
        );
        break;
      default:
        throw new Error(`Property '${this._prop.name}' cannot be animated`);
    }
  }
  calculateState(target: unknown, currentTime: number): PropertyValue {
    if (this._interpolator) {
      this._interpolator.interpolate(currentTime, this._state.num);
    } else {
      this._prop.get.call(target, this._state);
    }
    return this._state;
  }
  applyState(target: unknown, state: PropertyValue) {
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
  getProp(): PropertyAccessor {
    return this._prop;
  }
}
