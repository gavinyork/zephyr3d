import { Matrix4x4, Vector3, nextPowerOf2 } from '@zephyr3d/base';
import { Application } from '../app';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneNode } from '../scene/scene_node';
import type { Mesh } from '../scene';
import { BoundingBox } from '../utility';
import type { AssetSubMeshData } from '../asset';

interface SkinnedBoundingBox {
  boundingVertices: Vector3[];
  boundingVertexBlendIndices: Float32Array;
  boundingVertexJointWeights: Float32Array;
  boundingBox: BoundingBox;
}

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
  protected _meshes: { mesh: Mesh; bounding: SkinnedBoundingBox; box: BoundingBox }[];
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
  constructor(
    joints: SceneNode[],
    inverseBindMatrices: Matrix4x4[],
    bindPoseMatrices: Matrix4x4[],
    meshes: Mesh[],
    bounding: AssetSubMeshData[]
  ) {
    this._joints = joints;
    this._inverseBindMatrices = inverseBindMatrices;
    this._bindPoseMatrices = bindPoseMatrices;
    this._jointMatrixArray = null;
    this._jointMatrices = null;
    this._jointTexture = null;
    this.updateJointMatrices();
    this._meshes = meshes.map((mesh, index) => {
      return {
        mesh,
        bounding: this.getBoundingInfo(bounding[index]),
        box: new BoundingBox()
      };
    });
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
  updateJointMatrices(jointTransforms?: Matrix4x4[], worldMatrix?: Matrix4x4) {
    if (!this._jointTexture) {
      this._createJointTexture();
    }
    for (let i = 0; i < this._joints.length; i++) {
      const mat = this._jointMatrices[i];
      const jointTransform = jointTransforms ? jointTransforms[i] : this._joints[i].worldMatrix;
      if (worldMatrix) {
        Matrix4x4.multiplyAffine(worldMatrix, jointTransform, jointTransform);
      }
      Matrix4x4.multiply(jointTransform, this._inverseBindMatrices[i], mat);
    }
  }
  /** @internal */
  computeBindPose(model: SceneNode) {
    this.updateJointMatrices(this._bindPoseMatrices, model.worldMatrix);
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
  apply() {
    this.computeJoints();
    for (const mesh of this._meshes) {
      this.computeBoundingBox(mesh.bounding, mesh.mesh.invWorldMatrix);
      mesh.mesh.setBoneMatrices(this.jointTexture);
      mesh.mesh.setAnimatedBoundingBox(mesh.bounding.boundingBox);
    }
  }
  /** @internal */
  reset(model: SceneNode) {
    this.computeBindPose(model);
    for (const mesh of this._meshes) {
      this.computeBoundingBox(mesh.bounding, mesh.mesh.invWorldMatrix);
      mesh.mesh.setBoneMatrices(this.jointTexture);
      mesh.mesh.setAnimatedBoundingBox(mesh.bounding.boundingBox);
    }
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
  /** @internal */
  private getBoundingInfo(meshData: AssetSubMeshData): SkinnedBoundingBox {
    const indices = [0, 0, 0, 0, 0, 0];
    let minx = Number.MAX_VALUE;
    let maxx = -Number.MAX_VALUE;
    let miny = Number.MAX_VALUE;
    let maxy = -Number.MAX_VALUE;
    let minz = Number.MAX_VALUE;
    let maxz = -Number.MAX_VALUE;
    const v = meshData.rawPositions;
    const vert = new Vector3();
    const tmpV0 = new Vector3();
    const tmpV1 = new Vector3();
    const tmpV2 = new Vector3();
    const tmpV3 = new Vector3();
    const numVertices = Math.floor(v.length / 3);
    for (let i = 0; i < numVertices; i++) {
      vert.setXYZ(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      this.jointMatrices[meshData.rawBlendIndices[i * 4 + 0]]
        .transformPointAffine(vert, tmpV0)
        .scaleBy(meshData.rawJointWeights[i * 4 + 0]);
      this.jointMatrices[meshData.rawBlendIndices[i * 4 + 1]]
        .transformPointAffine(vert, tmpV1)
        .scaleBy(meshData.rawJointWeights[i * 4 + 1]);
      this.jointMatrices[meshData.rawBlendIndices[i * 4 + 2]]
        .transformPointAffine(vert, tmpV2)
        .scaleBy(meshData.rawJointWeights[i * 4 + 2]);
      this.jointMatrices[meshData.rawBlendIndices[i * 4 + 3]]
        .transformPointAffine(vert, tmpV3)
        .scaleBy(meshData.rawJointWeights[i * 4 + 3]);
      tmpV0.addBy(tmpV1).addBy(tmpV2).addBy(tmpV3);
      if (tmpV0.x < minx) {
        minx = tmpV0.x;
        indices[0] = i;
      }
      if (tmpV0.x > maxx) {
        maxx = tmpV0.x;
        indices[1] = i;
      }
      if (tmpV0.y < miny) {
        miny = tmpV0.y;
        indices[2] = i;
      }
      if (tmpV0.y > maxy) {
        maxy = tmpV0.y;
        indices[3] = i;
      }
      if (tmpV0.z < minz) {
        minz = tmpV0.z;
        indices[4] = i;
      }
      if (tmpV0.z > maxz) {
        maxz = tmpV0.z;
        indices[5] = i;
      }
    }
    const info: SkinnedBoundingBox = {
      boundingVertexBlendIndices: new Float32Array(
        Array.from({ length: 6 * 4 }).map(
          (val, index) => meshData.rawBlendIndices[indices[index >> 2] * 4 + (index % 4)]
        )
      ),
      boundingVertexJointWeights: new Float32Array(
        Array.from({ length: 6 * 4 }).map(
          (val, index) => meshData.rawJointWeights[indices[index >> 2] * 4 + (index % 4)]
        )
      ),
      boundingVertices: Array.from({ length: 6 }).map(
        (val, index) =>
          new Vector3(
            meshData.rawPositions[indices[index] * 3],
            meshData.rawPositions[indices[index] * 3 + 1],
            meshData.rawPositions[indices[index] * 3 + 2]
          )
      ),
      boundingBox: new BoundingBox()
    };
    return info;
  }
}
