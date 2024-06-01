import { AnimationTrack } from './animationtrack';
import type { Mesh, SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility';
import { MAX_MORPH_TARGETS } from '../values';
import { calculateMorphBoundingBox } from './morphtarget';
import { Vector3 } from '@zephyr3d/base';

/** Morph animation state */
export type MorphState = {
  numTargets: number;
  weights: Float32Array;
  boundingBox: BoundingBox;
};

/**
 * Morph target track
 * @public
 */
export class MorphTargetTrack extends AnimationTrack<MorphState> {
  private _state: MorphState;
  private _boundingBox: BoundingBox[];
  private _defaultWeights: number[];
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor(assetTrack: AssetAnimationTrack, subMesh: AssetSubMeshData) {
    super(assetTrack.interpolator);
    this._state = {
      numTargets: assetTrack.interpolator.stride,
      boundingBox: new BoundingBox(),
      weights: new Float32Array(MAX_MORPH_TARGETS)
    };
    this._boundingBox = subMesh.targetBox;
    this._defaultWeights =
      assetTrack.defaultMorphWeights ?? Array.from({ length: this._state.numTargets }).map(() => 0);
  }
  calculateState(currentTime: number): MorphState {
    this._interpolator.interpolate(currentTime, this._state.weights);
    calculateMorphBoundingBox(
      this._state.boundingBox,
      this._boundingBox,
      this._state.weights,
      this._state.numTargets
    );
    return this._state;
  }
  applyState(node: SceneNode, state: MorphState) {
    (node as Mesh).getMorphInfo().bufferSubData(4 * 4, state.weights);
    const animatedBoundingBox = new BoundingBox();
    const originBoundingBox = (node as Mesh).getBoundingVolume().toAABB();
    animatedBoundingBox.minPoint = Vector3.add(originBoundingBox.minPoint, state.boundingBox.minPoint);
    animatedBoundingBox.maxPoint = Vector3.add(originBoundingBox.maxPoint, state.boundingBox.maxPoint);
    (node as Mesh).setAnimatedBoundingBox(animatedBoundingBox);
  }
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
  getState(node: SceneNode): MorphState {
    return null;
  }
  getBlendId(): unknown {
    return 'node-morph';
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number): boolean {
    // apply new weights
    const state = this.calculateState(currentTime);
    this.applyState(node, state);
    return true;
  }
  reset(node: SceneNode) {
    // apply default weights
    this._state.weights.set(this._defaultWeights);
    this.applyState(node, this._state);
  }
}
