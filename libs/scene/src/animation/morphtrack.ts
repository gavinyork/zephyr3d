import { AnimationTrack } from './animationtrack';
import type { Mesh, SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility/bounding_volume';
import { MAX_MORPH_TARGETS } from '../values';
import { calculateMorphBoundingBox } from './morphtarget';
import type { AABB, Interpolator } from '@zephyr3d/base';
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
  private readonly _state: MorphState;
  private readonly _originBox: AABB;
  private readonly _boundingBox: BoundingBox[];
  private readonly _defaultWeights: number[];
  private readonly _interpolator: Interpolator;
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor(assetTrack: AssetAnimationTrack, subMesh: AssetSubMeshData, embedded?: boolean) {
    super(embedded);
    this._interpolator = assetTrack.interpolator;
    this._state = {
      numTargets: assetTrack.interpolator.stride,
      boundingBox: new BoundingBox(),
      weights: new Float32Array(MAX_MORPH_TARGETS)
    };
    this._boundingBox = subMesh.targetBox;
    this._originBox = subMesh.mesh.getBoundingVolume().toAABB();
    this._defaultWeights =
      assetTrack.defaultMorphWeights ?? Array.from({ length: this._state.numTargets }).map(() => 0);
  }
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
  applyState(node: SceneNode, state: MorphState) {
    (node as Mesh).getMorphInfo().bufferSubData(4 * 4, state.weights);
    state.boundingBox.minPoint.addBy(this._originBox.minPoint);
    state.boundingBox.maxPoint.addBy(this._originBox.maxPoint);
    (node as Mesh).setAnimatedBoundingBox(state.boundingBox);
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
  getBlendId(): unknown {
    return 'node-morph';
  }
  getDuration(): number {
    return this._interpolator.maxTime;
  }
  reset(node: SceneNode) {
    // apply default weights
    this._state.weights.set(this._defaultWeights);
    this.applyState(node, this._state);
  }
}
