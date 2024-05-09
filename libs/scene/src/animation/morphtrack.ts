import type { InterpolationMode, InterpolationTarget } from '@zephyr3d/base';
import { Interpolator } from '@zephyr3d/base';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility';
import { getVertexFormatComponentCount, type Texture2D, type VertexAttribFormat } from '@zephyr3d/device';

/**
 * Morph target track
 * @public
 */
export class MorphTargetTrack extends AnimationTrack {
  private _boundingBox: BoundingBox;
  private _morphTexture: Texture2D;
  private _numTargets: number;
  private _weights: Float32Array;
  private _offsets: number[];
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor(assetTrack: AssetAnimationTrack, subMesh: AssetSubMeshData) {
    super(assetTrack.interpolator);
    this._numTargets = assetTrack.interpolator.stride;
    this._boundingBox = new BoundingBox(subMesh.targetMax, subMesh.targetMax);
    this._morphTexture = null;
    this._weights = new Float32Array(this._numTargets);
    if (assetTrack.defaultMorphWeights) {
      this._weights.set(assetTrack.defaultMorphWeights);
    }
    this._offsets = [];
  }
  get boundingBox(): BoundingBox {
    return this._boundingBox;
  }
  get morphTexture(): Texture2D {
    return this._morphTexture;
  }
  get weights(): Float32Array {
    return this._weights;
  }
  /** @internal */
  private createMorphTexture(subMesh: AssetSubMeshData): Texture2D {
    const attributes = Object.getOwnPropertyNames(subMesh.targets) as VertexAttribFormat[];
    let numVertices = 0;
    let totalFloats = 0;
    for (const k of attributes) {
      const keyframes = subMesh.targets[k as keyof typeof subMesh.targets];
      if (keyframes.length !== this._numTargets) {
        console.error(`Invalid morph target data`);
        return null;
      }
      for (const data of keyframes) {
        const v = Math.floor(data.length / getVertexFormatComponentCount(k));
        if (numVertices === 0) {
          numVertices = v;
        } else if (numVertices !== v) {
          console.error(`Invalid morph target data`);
          return null;
        }
        totalFloats += data.length;
      }
    }
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number, duration: number): boolean {
    this._interpolator.interpolate(currentTime, duration, this._weights);
    return true;
  }
}
