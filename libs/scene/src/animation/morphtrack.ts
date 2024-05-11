import {
  PBArrayTypeInfo,
  PBPrimitiveType,
  PBPrimitiveTypeInfo,
  PBStructTypeInfo,
  type GPUDataBuffer,
  type Texture2D
} from '@zephyr3d/device';
import { AnimationTrack } from './animationtrack';
import type { Mesh, SceneNode } from '../scene';
import type { AssetAnimationTrack, AssetSubMeshData } from '../asset';
import { BoundingBox } from '../utility';
import { Application } from '../app';
import {
  MAX_MORPH_ATTRIBUTES,
  MAX_MORPH_TARGETS,
  MORPH_ATTRIBUTE_VECTOR_COUNT,
  MORPH_WEIGHTS_VECTOR_COUNT
} from '../values';
import { ShaderHelper } from '../material';

/**
 * Morph target track
 * @public
 */
export class MorphTargetTrack extends AnimationTrack {
  private _boundingBox: BoundingBox[];
  private _animatedBoundingBox: BoundingBox;
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
    this._boundingBox = subMesh.targetBox;
    this._animatedBoundingBox = new BoundingBox();
    this._morphTexture = null;
    this._weightsAndOffsets = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
    this._weights = this._weightsAndOffsets.subarray(4, 4 + MAX_MORPH_TARGETS);
    this._defaultWeights =
      assetTrack.defaultMorphWeights ?? Array.from({ length: this._numTargets }).map(() => 0);
    this._morphUniformBuffer = null;
    this.create(subMesh);
  }
  /** @internal */
  private create(subMesh: AssetSubMeshData) {
    const attributes = Object.getOwnPropertyNames(subMesh.targets);
    const numVertices = subMesh.primitive.getNumVertices();
    const textureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * this._numTargets));
    if (textureSize > Application.instance.device.getDeviceCaps().textureCaps.maxTextureSize) {
      // TODO: reduce morph attributes
      throw new Error(`Morph target data too large`);
    }
    this._weightsAndOffsets[0] = textureSize;
    this._weightsAndOffsets[1] = textureSize;
    this._weightsAndOffsets[2] = numVertices;
    this._weightsAndOffsets[3] = this._numTargets;
    let offset = 0;
    const textureData = new Float32Array(textureSize * textureSize * 4);
    for (let attrib = 0; attrib < MAX_MORPH_ATTRIBUTES; attrib++) {
      const index = attributes.indexOf(String(attrib));
      if (index < 0) {
        this._weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = -1;
        continue;
      }
      this._weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = offset >> 2;
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
      samplerOptions: {
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipFilter: 'none'
      }
    });
    this._morphTexture.update(textureData, 0, 0, textureSize, textureSize);
    const bufferType = new PBStructTypeInfo('dummy', 'std140', [
      {
        name: ShaderHelper.getMorphInfoUniformName(),
        type: new PBArrayTypeInfo(
          new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
          1 + MORPH_WEIGHTS_VECTOR_COUNT + MORPH_ATTRIBUTE_VECTOR_COUNT
        )
      }
    ]);
    this._morphUniformBuffer = Application.instance.device.createStructuredBuffer(
      bufferType,
      {
        usage: 'uniform'
      },
      this._weightsAndOffsets
    );
  }
  /** @internal */
  private calculateBoundingBox(node: Mesh) {
    const originBoundingBox = node.getBoundingVolume().toAABB();
    this._animatedBoundingBox.minPoint.set(originBoundingBox.minPoint);
    this._animatedBoundingBox.maxPoint.set(originBoundingBox.maxPoint);
    for (let i = 0; i < this._numTargets; i++) {
      const weight = this._weights[i];
      this._animatedBoundingBox.minPoint.x += this._boundingBox[i].minPoint.x * weight;
      this._animatedBoundingBox.minPoint.y += this._boundingBox[i].minPoint.y * weight;
      this._animatedBoundingBox.minPoint.y += this._boundingBox[i].minPoint.z * weight;
      this._animatedBoundingBox.maxPoint.x += this._boundingBox[i].maxPoint.x * weight;
      this._animatedBoundingBox.maxPoint.y += this._boundingBox[i].maxPoint.y * weight;
      this._animatedBoundingBox.maxPoint.y += this._boundingBox[i].maxPoint.z * weight;
    }
  }
  /** {@inheritDoc AnimationTrack.apply} */
  apply(node: SceneNode, currentTime: number, duration: number): boolean {
    // apply new weights
    this._interpolator.interpolate(currentTime, duration, this._weights);
    this._morphUniformBuffer.bufferSubData(4 * 4, this._weights);
    this.calculateBoundingBox(node as Mesh);
    (node as Mesh).setMorphData(this._morphTexture);
    (node as Mesh).setMorphInfo(this._morphUniformBuffer);
    (node as Mesh).setAnimatedBoundingBox(this._animatedBoundingBox);
    return true;
  }
  reset(node: SceneNode) {
    // apply default weights
    this._weights.set(this._defaultWeights);
    this._morphUniformBuffer.bufferSubData(4 * 4, this._weights);
    this.calculateBoundingBox(node as Mesh);
    (node as Mesh).setMorphData(this._morphTexture);
    (node as Mesh).setMorphInfo(this._morphUniformBuffer);
    (node as Mesh).setAnimatedBoundingBox(this._animatedBoundingBox);
  }
}
