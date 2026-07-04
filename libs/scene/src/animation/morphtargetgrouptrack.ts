import { InterpolatorScalar } from '@zephyr3d/base';
import type { Interpolator } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Animates a model-level morph target group by name.
 * @public
 */
export class MorphTargetGroupTrack extends AnimationTrack<number> {
  private _groupName: string;
  private _interpolator: Interpolator;
  private readonly _state: number[];
  /**
   * Create a morph target group animation track.
   * @param groupName - Morph target group name
   * @param interpolator - Scalar interpolator for the group weight
   * @param embedded - Whether this track is embedded
   */
  constructor(groupName?: string, interpolator?: Interpolator, embedded?: boolean) {
    super(embedded ?? false);
    this._groupName = groupName ?? '';
    this._interpolator = interpolator ?? InterpolatorScalar.constant(0);
    this._state = [0];
  }
  /** Morph target group name controlled by this track. */
  get groupName() {
    return this._groupName;
  }
  set groupName(value: string) {
    this._groupName = value ?? '';
  }
  /** Scalar interpolator for this track. */
  get interpolator() {
    return this._interpolator;
  }
  set interpolator(value: Interpolator) {
    if (value && value.target !== 'number') {
      throw new Error(`MorphTargetGroupTrack(): interpolator target must be 'number'`);
    }
    this._interpolator = value ?? InterpolatorScalar.constant(0);
  }
  /** {@inheritDoc AnimationTrack.clone} */
  clone(): this {
    return new MorphTargetGroupTrack(this._groupName, this._interpolator.clone(), false) as this;
  }
  /** {@inheritDoc AnimationTrack.calculateState} */
  calculateState(target: object, currentTime: number) {
    this._interpolator.interpolate(currentTime, this._state);
    return clamp01(this._state[0]);
  }
  /** {@inheritDoc AnimationTrack.applyState} */
  applyState(node: SceneNode, weight: number) {
    if (this._groupName) {
      node.setMorphTargetGroupWeight(this._groupName, clamp01(weight));
    }
  }
  /** {@inheritDoc AnimationTrack.mixState} */
  mixState(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }
  /** {@inheritDoc AnimationTrack.getBlendId} */
  getBlendId() {
    return `morph-target-group:${this._groupName}`;
  }
  /** {@inheritDoc AnimationTrack.getDuration} */
  getDuration() {
    return this._interpolator.maxTime;
  }
}
