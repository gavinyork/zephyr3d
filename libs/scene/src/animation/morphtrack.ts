import type { Texture2D } from '@zephyr3d/device';
import { AnimationTrack } from './animationtrack';
import type { SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility';
import { Application } from '../app';
import { allMorphTargets } from '../values';

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
    this.create(subMesh);
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
  private create(subMesh: AssetSubMeshData) {
    const attributes = Object.getOwnPropertyNames(subMesh.targets);
    const numVertices = subMesh.primitive.getNumVertices();
    const textureSize = Math.ceil(Math.sqrt(numVertices * this._numTargets));
    if (textureSize > Application.instance.device.getDeviceCaps().textureCaps.maxTextureSize) {
      // TODO: reduce morph attributes
      throw new Error(`Morph target data too large`);
    }
    let offset = 0;
    this._offsets.length = 0;
    const textureData = new Float32Array(textureSize * textureSize * 4);
    for (const attrib of allMorphTargets) {
      const index = attributes.indexOf(String(attrib));
      if (index >= 0) {
        this._offsets.push(offset);
      }
      const info = subMesh.targets[attrib];
      if (info.data.length !== this._numTargets) {
        console.error(`Invalid morph target data`);
        return null;
      }
      for (let t = 0; t < this._numTargets; t++) {
        const data = info.data[t];
        for (let i = 0; i < numVertices; i++) {
          for (let j = 0; j < 4; j++) {
            textureData[offset++] = j < info.numComponents ? data[i * info.numComponents + j] : 1;
          }
        }
      }
    }
    this._morphTexture = Application.instance.device.createTexture2D('rgba32f', textureSize, textureSize, {
      samplerOptions: { mipFilter: 'none' }
    });
    this._morphTexture.update(textureData, 0, 0, textureSize, textureSize);
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number, duration: number): boolean {
    this._interpolator.interpolate(currentTime, duration, this._weights);
    return true;
  }
}
