import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import { AnimationTrack } from './animationtrack';
import type { Mesh, SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility';
import { Application } from '../app';
import { MAX_MORPH_ATTRIBUTES, MAX_MORPH_TARGETS, allMorphTargets } from '../values';

/**
 * Morph target track
 * @public
 */
export class MorphTargetTrack extends AnimationTrack {
  private _boundingBox: BoundingBox;
  private _morphTexture: Texture2D;
  private _numTargets: number;
  private _defaultWeights: number[];
  private _weightsAndOffsets: Float32Array;
  private _weights: Float32Array;
  private _morphUniformBuffer: GPUDataBuffer;
  /**
   * Create an instance of MorphTargetTrack
   */
  constructor(assetTrack: AssetAnimationTrack, subMesh: AssetSubMeshData) {
    super(assetTrack.interpolator);
    this._numTargets = assetTrack.interpolator.stride;
    this._boundingBox = new BoundingBox(subMesh.targetMax, subMesh.targetMax);
    this._morphTexture = null;
    this._weightsAndOffsets = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
    this._weights = this._weightsAndOffsets.subarray(4, 4 + MAX_MORPH_TARGETS);
    this._defaultWeights =
      assetTrack.defaultMorphWeights ?? Array.from({ length: this._numTargets }).map(() => 0);
    this._morphUniformBuffer = null;
    this.create(subMesh);
  }
  get boundingBox(): BoundingBox {
    return this._boundingBox;
  }
  get morphTexture(): Texture2D {
    return this._morphTexture;
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
    this._weightsAndOffsets[0] = textureSize;
    this._weightsAndOffsets[1] = numVertices;
    let morphMask = 0;
    let offset = 0;
    let offsetIndex = 4 + MAX_MORPH_TARGETS;
    const textureData = new Float32Array(textureSize * textureSize * 4);
    for (const attrib of allMorphTargets) {
      const index = attributes.indexOf(String(attrib));
      if (index < 0) {
        continue;
      }
      morphMask |= attrib;
      this._weightsAndOffsets[offsetIndex++] = offset;
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
    this._weightsAndOffsets[2] = morphMask;
    this._morphTexture = Application.instance.device.createTexture2D('rgba32f', textureSize, textureSize, {
      samplerOptions: { mipFilter: 'none' }
    });
    this._morphTexture.update(textureData, 0, 0, textureSize, textureSize);
    this._morphUniformBuffer = Application.instance.device.createBuffer(this._weightsAndOffsets.byteLength, {
      usage: 'uniform'
    });
    this._morphUniformBuffer.bufferSubData(0, this._weightsAndOffsets);
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number, duration: number): boolean {
    // apply new weights
    this._interpolator.interpolate(currentTime, duration, this._weights);
    this._morphUniformBuffer.bufferSubData(4 * 4, this._weights);
    (node as Mesh).setMorphData(this._morphTexture);
    (node as Mesh).setMorphInfo(this._morphUniformBuffer);
    (node as Mesh).setAnimatedBoundingBox(this._boundingBox);
    return true;
  }
  reset(node: SceneNode) {
    // apply default weights
    this._weights.set(this._defaultWeights);
    this._morphUniformBuffer.bufferSubData(4 * 4, this._weights);
    (node as Mesh).setMorphData(this._morphTexture);
    (node as Mesh).setMorphInfo(this._morphUniformBuffer);
    (node as Mesh).setAnimatedBoundingBox(this._boundingBox);
  }
}
