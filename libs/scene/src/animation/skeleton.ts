import { Matrix4x4, Vector3, nextPowerOf2 } from '@zephyr3d/base';
import { SkinnedBoundingBox } from './animation';
import { Application } from '../app';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneNode } from '../scene/scene_node';

const tmpV0 = new Vector3();
const tmpV1 = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();

/**
 * Skeleton for skinned animation
 * @public
 */
export class Skeleton {
  /** @internal */
  protected _joints: SceneNode[];
  /** @internal */
  protected _inverseBindMatrices: Matrix4x4[];
  /** @internal */
  protected _bindPoseMatrices: Matrix4x4[];
  /** @internal */
  protected _jointMatrices: Matrix4x4[];
  /** @internal */
  protected _jointMatrixArray: Float32Array;
  /** @internal */
  protected _jointTexture: Texture2D;
  /**
   * Creates an instance of skeleton
   * @param joints - The joint nodes
   * @param inverseBindMatrices - The inverse binding matrices of the joints
   * @param bindPoseMatrices - The binding pose matrices of the joints
   */
  constructor(joints: SceneNode[], inverseBindMatrices: Matrix4x4[], bindPoseMatrices: Matrix4x4[]) {
    this._joints = joints;
    this._inverseBindMatrices = inverseBindMatrices;
    this._bindPoseMatrices = bindPoseMatrices;
    this._jointMatrixArray = null;
    this._jointMatrices = null;
    this._jointTexture = null;
  }
  /**
   * Disposes self
   */
  dispose() {
    this._jointTexture?.dispose();
    this._jointTexture = null;
    this._joints = null;
    this._inverseBindMatrices = null;
    this._bindPoseMatrices = null;
    this._jointMatrices = null;
    this._jointMatrixArray = null;
  }
  /**
   * The joint transform matrices
   */
  get jointMatrices(): Matrix4x4[] {
    return this._jointMatrices;
  }
  /**
   * The texture that contains the transform matrices of all the joints
   */
  get jointTexture(): Texture2D {
    return this._jointTexture;
  }
  /** @internal */
  updateJointMatrices(jointTransforms?: Matrix4x4[]) {
    if (!this._jointTexture) {
      this._createJointTexture();
    }
    for (let i = 0; i < this._joints.length; i++) {
      const mat = this._jointMatrices[i];
      Matrix4x4.multiply(
        jointTransforms ? jointTransforms[i] : this._joints[i].worldMatrix,
        this._inverseBindMatrices[i],
        mat
      );
    }
  }
  /** @internal */
  computeBindPose() {
    this.updateJointMatrices(this._bindPoseMatrices);
    this._jointTexture.update(
      this._jointMatrixArray,
      0,
      0,
      this._jointTexture.width,
      this._jointTexture.height
    );
  }
  /** @internal */
  computeJoints() {
    this.updateJointMatrices();
    this._jointTexture.update(
      this._jointMatrixArray,
      0,
      0,
      this._jointTexture.width,
      this._jointTexture.height
    );
  }
  /** @internal */
  computeBoundingBox(info: SkinnedBoundingBox, invWorldMatrix: Matrix4x4) {
    info.boundingBox.beginExtend();
    for (let i = 0; i < info.boundingVertices.length; i++) {
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 0]]
        .transformPointAffine(info.boundingVertices[i], tmpV0)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 0]);
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 1]]
        .transformPointAffine(info.boundingVertices[i], tmpV1)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 1]);
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 2]]
        .transformPointAffine(info.boundingVertices[i], tmpV2)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 2]);
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 3]]
        .transformPointAffine(info.boundingVertices[i], tmpV3)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 3]);
      tmpV0.addBy(tmpV1).addBy(tmpV2).addBy(tmpV3);
      invWorldMatrix.transformPointAffine(tmpV0, tmpV0);
      info.boundingBox.extend(tmpV0);
    }
  }
  /** @internal */
  private _createJointTexture() {
    const textureWidth = nextPowerOf2(Math.max(4, Math.ceil(Math.sqrt(this._joints.length * 4))));
    this._jointTexture = Application.instance.device.createTexture2D('rgba32f', textureWidth, textureWidth, {
      noMipmap: true,
      samplerOptions: {
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none'
      }
    });
    this._jointMatrixArray = new Float32Array(textureWidth * textureWidth * 4);
    const buffer = this._jointMatrixArray.buffer;
    this._jointMatrices = this._joints.map(
      (val, index) => new Matrix4x4(buffer, index * 16 * Float32Array.BYTES_PER_ELEMENT)
    );
  }
}
