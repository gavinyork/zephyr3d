import { AnimationTrack } from './animationtrack';
import type { Mesh, SceneNode } from '../scene';
import { BoundingBox } from '../utility/bounding_volume';
import { MAX_MORPH_TARGETS } from '../values';
import { calculateMorphBoundingBox } from './morphtarget';
import type { AABB, Interpolator } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';

/**
 * Morph animation state
 *
 * @public
 **/
export type MorphState = {
  numTargets: number;
  weights: Float32Array<ArrayBuffer>;
  boundingBox: BoundingBox;
};

/**
 * Morph target track
 * @public
 */
export class MorphTargetTrack extends AnimationTrack<MorphState> {
  private _state: MorphState;
  private _originBox: AABB;
  private _boundingBox: BoundingBox[];
  private _defaultWeights: number[];
  private _interpolator: Interpolator;
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor();
  /**
   * Create an instance of MorphTargetTrack from morph parameters
   */
  constructor(
    interpolator?: Interpolator,
    defaultMorphWeights?: number[],
    targetBox?: BoundingBox[],
    originBox?: AABB,
    embedded?: boolean
  );
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor(
    interpolator?: Interpolator,
    defaultMorphWeights?: number[],
    targetBox?: BoundingBox[],
    originBox?: AABB,
    embedded?: boolean
  ) {
    super(embedded);
    if (interpolator === undefined) {
      this._interpolator = null;
      this._state = null;
      this._boundingBox = null;
      this._originBox = null;
      this._defaultWeights = null;
    } else {
      this._interpolator = interpolator;
      this._state = {
        numTargets: interpolator.stride,
        boundingBox: new BoundingBox(),
        weights: new Float32Array(MAX_MORPH_TARGETS)
      };
      this._boundingBox = targetBox;
      this._originBox = originBox;
      this._defaultWeights =
        defaultMorphWeights ?? Array.from({ length: this._state.numTargets }).map(() => 0);
    }
  }
  get interpolator() {
    return this._interpolator;
  }
  set interpolator(interp: Interpolator) {
    this._interpolator = interp ?? null;
    this._state = this._interpolator
      ? {
          numTargets: this._interpolator.stride,
          boundingBox: new BoundingBox(),
          weights: new Float32Array(MAX_MORPH_TARGETS)
        }
      : null;
  }
  get boundingBox() {
    return this._boundingBox;
  }
  set boundingBox(box: BoundingBox[]) {
    this._boundingBox = box;
  }
  get defaultWeights() {
    return this._defaultWeights;
  }
  set defaultWeights(value: number[]) {
    this._defaultWeights = value;
  }
  get originBoundingBox() {
    return this._originBox;
  }
  set originBoundingBox(box: AABB) {
    this._originBox = box;
  }
  /** {@inheritDoc AnimationTrack.calculateState} */

  calculateState(target: object, currentTime: number): MorphState {
    this._interpolator.interpolate(currentTime, this._state.weights);
    calculateMorphBoundingBox(
      this._state.boundingBox,
      this._boundingBox,
      this._state.weights,
      this._state.numTargets
    );
    return this._state;
  }
  /** {@inheritDoc AnimationTrack.applyState} */
  applyState(node: SceneNode, state: MorphState) {
    (node as Mesh)
      .getMorphInfo()
      .buffer.get()
      .bufferSubData(4 * 4, state.weights);
    state.boundingBox.minPoint.addBy(this._originBox.minPoint);
    state.boundingBox.maxPoint.addBy(this._originBox.maxPoint);
    (node as Mesh).setAnimatedBoundingBox(state.boundingBox);
  }
  /** {@inheritDoc AnimationTrack.mixState} */
  mixState(a: MorphState, b: MorphState, t: number): MorphState {
    const state: MorphState = {
      weights: new Float32Array(a.numTargets),
      boundingBox: new BoundingBox(),
      numTargets: a.numTargets
    };
    for (let i = 0; i < a.numTargets; i++) {
      state.weights[i] = a.weights[i] + (b.weights[i] - a.weights[i]) * t;
      state.boundingBox.minPoint = Vector3.min(a.boundingBox.minPoint, b.boundingBox.minPoint);
      state.boundingBox.maxPoint = Vector3.max(a.boundingBox.maxPoint, b.boundingBox.maxPoint);
    }
    return state;
  }
  /** {@inheritDoc AnimationTrack.getBlendId} */
  getBlendId(): unknown {
    return 'node-morph';
  }
  /** {@inheritDoc AnimationTrack.getDuration} */
  getDuration(): number {
    return this._interpolator.maxTime;
  }
  /** {@inheritDoc AnimationTrack.reset} */
  reset(node: SceneNode) {
    // apply default weights
    this._state.weights.set(this._defaultWeights);
    this.applyState(node, this._state);
  }
}
