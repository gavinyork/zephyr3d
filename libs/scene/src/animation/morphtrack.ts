import { AnimationTrack } from './animationtrack';
import type { Mesh, SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility';
import { MAX_MORPH_TARGETS } from '../values';
import { calculateMorphBoundingBox } from './morphtarget';

/**
 * Morph target track
 * @public
 */
export class MorphTargetTrack extends AnimationTrack {
  private _boundingBox: BoundingBox[];
  private _animatedBoundingBox: BoundingBox;
  private _numTargets: number;
  private _weights: Float32Array;
  private _defaultWeights: number[];
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor(assetTrack: AssetAnimationTrack, subMesh: AssetSubMeshData) {
    super(assetTrack.interpolator);
    this._numTargets = assetTrack.interpolator.stride;
    this._boundingBox = subMesh.targetBox;
    this._animatedBoundingBox = new BoundingBox();
    this._weights = new Float32Array(MAX_MORPH_TARGETS);
    this._defaultWeights =
      assetTrack.defaultMorphWeights ?? Array.from({ length: this._numTargets }).map(() => 0);
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number): boolean {
    // apply new weights
    this._interpolator.interpolate(currentTime, this._weights);
    (node as Mesh).getMorphInfo().bufferSubData(4 * 4, this._weights);
    calculateMorphBoundingBox(
      this._animatedBoundingBox,
      node.getBoundingVolume().toAABB(),
      this._boundingBox,
      this._weights,
      this._numTargets
    );
    (node as Mesh).setAnimatedBoundingBox(this._animatedBoundingBox);
    return true;
  }
  reset(node: SceneNode) {
    // apply default weights
    this._weights.set(this._defaultWeights);
    (node as Mesh).getMorphInfo().bufferSubData(4 * 4, this._weights);
    calculateMorphBoundingBox(
      this._animatedBoundingBox,
      node.getBoundingVolume().toAABB(),
      this._boundingBox,
      this._weights,
      this._numTargets
    );
    (node as Mesh).setAnimatedBoundingBox(this._animatedBoundingBox);
  }
}
