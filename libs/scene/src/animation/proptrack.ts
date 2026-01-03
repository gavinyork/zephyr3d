import { AnimationTrack } from './animationtrack';
import type { PropertyAccessor } from '../utility';
import type { Nullable } from '@zephyr3d/base';
import { Interpolator } from '@zephyr3d/base';

/**
 * Property animation track
 *
 * Animates a single property (scalar, vector, or color) on a target object using
 * time-based interpolation. Supports:
 * - float, vec2, vec3/rgb, vec4, rgba property types
 * - Separate interpolation for RGB and Alpha in RGBA mode
 * - Linear and cubic spline (natural) interpolation presets
 *
 * The track reads a `PropertyAccessor` which encapsulates how to get/set the property
 * on the target object. Internally, the current state is represented as a numeric array.
 *
 * Notes:
 * - `calculateState` samples interpolators into an internal reusable state instance
 *   for performance; consumers should treat returned states as ephemeral.
 * - `mixState` performs component-wise linear interpolation for blending.
 *
 * @public
 */
export class PropertyTrack extends AnimationTrack<number[]> {
  private readonly _state: number[];
  private _stateAlpha: number[];
  private readonly _prop: PropertyAccessor;
  private readonly _count: number;
  private _interpolator: Nullable<Interpolator>;
  private _interpolatorAlpha: Nullable<Interpolator>;
  /**
   * Construct a PropertyTrack for a specific property.
   *
   * Initializes interpolators and internal state based on the property type.
   * If an initial `value` is provided, it seeds the starting state and default key values.
   *
   * @param prop - The property accessor describing what and how to animate.
   * @param value - Optional initial numeric values (length must match the property type).
   * @param embedded - Whether this track is embedded/owned inline. Default false.
   *
   * @throws Error if the property type is unsupported for animation.
   */
  constructor(prop: PropertyAccessor, value?: number[], embedded?: boolean) {
    super(embedded);
    this._prop = prop;
    this._state = [0, 0, 0, 0];
    this._stateAlpha = [0];
    this._interpolator = null;
    this._interpolatorAlpha = null;
    if (value) {
      this._state = value.slice();
    }
    switch (this._prop.type) {
      case 'float':
        this._count = 1;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'number',
          new Float32Array([0, 1]),
          new Float32Array([this._state[0], this._state[0]])
        );
        break;
      case 'vec2':
        this._count = 2;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec2',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.slice(0, 2), ...this._state.slice(0, 2)])
        );
        break;
      case 'rgb':
      case 'vec3':
        this._count = 3;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec3',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.slice(0, 3), ...this._state.slice(0, 3)])
        );
        break;
      case 'vec4':
        this._count = 4;
        this._interpolator = new Interpolator(
          'cubicspline-natural',
          'vec4',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.slice(0, 4), ...this._state.slice(0, 4)])
        );
        break;
      case 'rgba':
        this._count = 4;
        this._interpolator = new Interpolator(
          'linear',
          'vec3',
          new Float32Array([0, 1]),
          new Float32Array([...this._state.slice(0, 3), ...this._state.slice(0, 3)])
        );
        this._interpolatorAlpha = new Interpolator(
          'linear',
          'number',
          new Float32Array([0, 1]),
          new Float32Array([this._state[3], this._state[3]])
        );
        this._stateAlpha = [this._state[3]];
        break;
      default:
        throw new Error(`Property '${this._prop.name}' cannot be animated`);
    }
  }
  /**
   * The primary interpolator for the property components.
   *
   * - For float/vec2/vec3/vec4/rgb: handles all channels.
   * - For rgba: handles RGB channels only; alpha is handled by `interpolatorAlpha`.
   */
  get interpolator() {
    return this._interpolator;
  }
  set interpolator(interpolator: Nullable<Interpolator>) {
    this._interpolator = interpolator;
  }
  /**
   * The alpha-channel interpolator for RGBA properties.
   *
   * - Only used when the property type is `rgba`.
   * - Setting a non-null interpolator ensures alpha state storage is allocated.
   */
  get interpolatorAlpha() {
    return this._interpolatorAlpha;
  }
  set interpolatorAlpha(interpolator: Nullable<Interpolator>) {
    this._interpolatorAlpha = interpolator ?? null;
    if (!this._stateAlpha && this._interpolatorAlpha) {
      this._stateAlpha = [0];
    }
  }
  /** {@inheritDoc AnimationTrack.calculateState} */
  calculateState(target: unknown, currentTime: number) {
    this._interpolator!.interpolate(currentTime, this._state);
    if (this._interpolatorAlpha) {
      this._interpolatorAlpha.interpolate(currentTime, this._stateAlpha);
      this._state[3] = this._stateAlpha[0];
    }
    return this._state;
  }
  /** {@inheritDoc AnimationTrack.applyState} */
  applyState(target: object, state: number[]) {
    this._prop.set!.call(target, { num: state } as any);
  }
  /** {@inheritDoc AnimationTrack.mixState} */
  mixState(a: number[], b: number[], t: number) {
    const v: number[] = [];
    for (let i = 0; i < this._count; i++) {
      v[i] = a[i] + t * (b[i] - a[i]);
    }
    return v;
  }
  /** {@inheritDoc AnimationTrack.getBlendId} */
  getBlendId() {
    return this._prop;
  }
  /** {@inheritDoc AnimationTrack.getDuration} */
  getDuration() {
    return this._interpolator?.maxTime ?? 0;
  }
  /**
   * Access the underlying property accessor.
   *
   * @returns The `PropertyAccessor` used by this track.
   */
  getProp() {
    return this._prop;
  }
}
