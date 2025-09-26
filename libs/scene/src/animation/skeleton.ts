import { Disposable, Matrix4x4, Vector3, nextPowerOf2 } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneNode } from '../scene/scene_node';
import type { Mesh } from '../scene';
import { BoundingBox } from '../utility/bounding_volume';
import type { AssetSubMeshData } from '../asset';
import { getDevice } from '../app/api';

interface SkinnedBoundingBox {
  /**
   * Representative vertices used to bound a skinned mesh (extreme points along axes).
   */
  boundingVertices: Vector3[];
  /**
   * Joint indices (up to 4 per vertex) for each representative vertex, flattened.
   * Layout: [i0_0, i0_1, i0_2, i0_3, i1_0, ...] for 6 vertices.
   */
  boundingVertexBlendIndices: Float32Array;
  /**
   * Corresponding joint weights (up to 4 per vertex) for each representative vertex, flattened.
   * Layout matches `boundingVertexBlendIndices`.
   */
  boundingVertexJointWeights: Float32Array;
  /**
   * Computed axis-aligned bounding box in model space for the current pose.
   */
  boundingBox: BoundingBox;
}

const tmpV0 = new Vector3();
const tmpV1 = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();

/**
 * Skeleton for skinned animation.
 *
 * Responsibilities:
 * - Maintains joint transforms: inverse bind, bind pose, and current skinning matrices.
 * - Provides a texture containing joint matrices for GPU skinning.
 * - Applies skinning state to associated meshes each frame.
 * - Computes animated axis-aligned bounding boxes using representative skinned vertices.
 *
 * Joint matrix texture layout:
 * - Texture format: `rgba32f`.
 * - Stored as a 2-layered ring buffer: current and previous joint transforms to support
 *   temporal addressing if needed. Offsets are tracked in `_jointOffsets[0]` (current)
 *   and `_jointOffsets[1]` (previous).
 *
 * Usage:
 * - Construct with joints, bind data, meshes and submesh bounding info.
 * - Call `apply()` each frame to update joint texture, bind to meshes, and update bounds.
 * - Call `reset()` to clear skinning on meshes.
 *
 * @public
 */
export class Skeleton extends Disposable {
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
  protected _jointOffsets: Float32Array<ArrayBuffer>;
  /** @internal */
  protected _jointMatrixArray: Float32Array<ArrayBuffer>;
  /** @internal */
  protected _jointTexture: Texture2D;
  /**
   * Create a skeleton instance.
   *
   * @param joints - Joint scene nodes (one per joint), ordered to match skin data.
   * @param inverseBindMatrices - Inverse bind matrices for each joint.
   * @param bindPoseMatrices - Bind pose matrices for each joint (model-space).
   * @param meshes - Mesh instances influenced by this skeleton.
   * @param bounding - Sub-mesh raw data used to derive representative bounding vertices.
   */
  constructor(
    joints: SceneNode[],
    inverseBindMatrices: Matrix4x4[],
    bindPoseMatrices: Matrix4x4[],
    meshes: Mesh[],
    bounding: AssetSubMeshData[]
  ) {
    super();
    this._joints = joints;
    this._inverseBindMatrices = inverseBindMatrices;
    this._bindPoseMatrices = bindPoseMatrices;
    this._jointMatrixArray = null;
    this._jointMatrices = null;
    this._jointOffsets = null;
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
   * Texture containing joint matrices for GPU skinning.
   *
   * Each matrix is stored in 4 texels (one row per texel, RGBA = 4 floats).
   */
  get jointTexture(): Texture2D {
    return this._jointTexture;
  }
  /**
   * Update joint matrices from either provided transforms or the joints' world matrices.
   *
   * - Lazily creates the joint texture and its backing arrays on first call.
   * - Advances the ring buffer offset in `_jointOffsets` to write a new "current" set.
   * - For each joint:
   *   - Optionally premultiplies by `worldMatrix` (to transform into model space).
   *   - Computes skinning matrix: ( M_\{skin\} = M_\{joint\} \\times M_\{inverseBind\} ).
   *
   * Note: This method only writes into the CPU-side array; callers like `computeJoints()`
   * update the GPU texture.
   *
   * @param jointTransforms - Optional per-joint transforms to use instead of node world matrices.
   * @param worldMatrix - Optional world-to-model transform applied before inverse bind.
   * @internal
   */
  updateJointMatrices(jointTransforms?: Matrix4x4[], worldMatrix?: Matrix4x4) {
    if (!this._jointTexture) {
      this._createJointTexture();
    }
    if (this._jointOffsets[0] === 0) {
      this._jointOffsets[0] = 1;
      this._jointOffsets[1] = 1;
    } else {
      this._jointOffsets[1] = this._jointOffsets[0];
      this._jointOffsets[0] = this._joints.length - this._jointOffsets[0] + 2;
    }
    for (let i = 0; i < this._joints.length; i++) {
      const mat = this._jointMatrices[i + this._jointOffsets[0] - 1];
      const jointTransform = jointTransforms ? jointTransforms[i] : this._joints[i].worldMatrix;
      if (worldMatrix) {
        Matrix4x4.multiplyAffine(worldMatrix, jointTransform, jointTransform);
      }
      Matrix4x4.multiply(jointTransform, this._inverseBindMatrices[i], mat);
    }
  }
  /**
   * Compute and upload the bind pose matrices to the joint texture for a given model.
   *
   * - Fills the "current" ring buffer slot with bind pose transforms.
   * - Uploads the entire matrix array to the GPU texture.
   *
   * @param model - The model node whose world matrix provides the reference space.
   * @internal
   */
  computeBindPose(model: SceneNode) {
    this.updateJointMatrices(this._bindPoseMatrices, model.worldMatrix);
    this._jointOffsets[1] = this._jointOffsets[0];
    this._jointTexture.update(
      this._jointMatrixArray,
      0,
      0,
      this._jointTexture.width,
      this._jointTexture.height
    );
  }
  /**
   * Compute current joint matrices from the nodes and upload them to the joint texture.
   *
   * @internal
   */
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
  /**
   * Apply current skeleton state to all meshes:
   * - Updates joint matrices and uploads to the texture.
   * - Computes animated bounding boxes per mesh in model space.
   * - Binds the joint texture to each mesh for GPU skinning.
   *
   * @internal
   */
  apply() {
    this.computeJoints();
    for (const mesh of this._meshes) {
      this.computeBoundingBox(mesh.bounding, mesh.mesh.invWorldMatrix);
      mesh.mesh.setBoneMatrices(this.jointTexture);
      mesh.mesh.setAnimatedBoundingBox(mesh.bounding.boundingBox);
    }
  }
  /**
   * Reset all meshes to an unskinned state and clear animated bounds.
   *
   * @internal
   */
  reset() {
    for (const mesh of this._meshes) {
      mesh.mesh.setBoneMatrices(null);
      mesh.mesh.setAnimatedBoundingBox(null);
    }
  }
  /**
   * Compute the animated bounding box for a single mesh using its representative vertices.
   *
   * For each representative vertex:
   * - Blends the vertex by up to 4 joint matrices using provided weights.
   * - Transforms to the mesh's local space using `invWorldMatrix`.
   * - Expands the bounding box.
   *
   * @param info - Precomputed bounding data (representative vertices, indices, weights).
   * @param invWorldMatrix - Mesh inverse world matrix to convert to model/local space.
   * @internal
   */
  computeBoundingBox(info: SkinnedBoundingBox, invWorldMatrix: Matrix4x4) {
    info.boundingBox.beginExtend();
    for (let i = 0; i < info.boundingVertices.length; i++) {
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 0] + this._jointOffsets[0] - 1]
        .transformPointAffine(info.boundingVertices[i], tmpV0)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 0]);
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 1] + this._jointOffsets[0] - 1]
        .transformPointAffine(info.boundingVertices[i], tmpV1)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 1]);
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 2] + this._jointOffsets[0] - 1]
        .transformPointAffine(info.boundingVertices[i], tmpV2)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 2]);
      this._jointMatrices[info.boundingVertexBlendIndices[i * 4 + 3] + this._jointOffsets[0] - 1]
        .transformPointAffine(info.boundingVertices[i], tmpV3)
        .scaleBy(info.boundingVertexJointWeights[i * 4 + 3]);
      tmpV0.addBy(tmpV1).addBy(tmpV2).addBy(tmpV3);
      invWorldMatrix.transformPointAffine(tmpV0, tmpV0);
      info.boundingBox.extend(tmpV0);
    }
  }
  /**
   * Dispose GPU resources and references held by the skeleton.
   *
   * - Disposes the joint texture.
   * - Clears matrix arrays and joint references.
   */
  protected onDispose() {
    super.onDispose();
    this._jointTexture?.dispose();
    this._jointTexture = null;
    this._joints = null;
    this._inverseBindMatrices = null;
    this._bindPoseMatrices = null;
    this._jointMatrices = null;
    this._jointMatrixArray = null;
  }
  /**
   * Initialize joint texture and CPU-side matrix storage.
   *
   * Layout details:
   * - Texture size is the next power-of-two able to contain all matrices plus two offset texels.
   * - `_jointMatrixArray` holds:
   *   - First 2 vec4s: ring buffer offsets `[current, previous, 0, 0]`.
   *   - Followed by 2×N matrices (current and previous), each as 16 floats.
   * - `_jointMatrices` is a view into `_jointMatrixArray` providing Matrix4x4 objects per slot.
   *
   * @internal
   */
  private _createJointTexture() {
    const textureWidth = nextPowerOf2(Math.max(4, Math.ceil(Math.sqrt((this._joints.length * 2 + 1) * 4))));
    const device = getDevice();
    this._jointTexture = device.createTexture2D('rgba32f', textureWidth, textureWidth, {
      mipmapping: false,
      samplerOptions: {
        magFilter: 'nearest',
        minFilter: 'nearest'
      }
    });
    this._jointMatrixArray = new Float32Array(textureWidth * textureWidth * 4);
    const buffer = this._jointMatrixArray.buffer;
    this._jointOffsets = new Float32Array(buffer);
    this._jointOffsets[0] = 0;
    this._jointOffsets[1] = 0;
    this._jointMatrices = Array.from({ length: this._joints.length * 2 }).map(
      (val, index) => new Matrix4x4(buffer, (index + 1) * 16 * Float32Array.BYTES_PER_ELEMENT)
    );
  }
  /**
   * Build representative skinned bounding data for a submesh.
   *
   * Strategy:
   * - For all vertices, compute their skinned position (using current ring buffer slot).
   * - Track the indices of the min/max extents along x, y, z (6 indices total).
   * - Store:
   *   - The 6 representative positions in object space.
   *   - Their 4 joint indices and weights (flattened).
   *   - An empty BoundingBox to be filled during animation.
   *
   * @param meshData - Raw submesh attributes (positions, blend indices, weights).
   * @returns Skinned bounding box info used during per-frame updates.
   * @internal
   */
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
      this._jointMatrices[meshData.rawBlendIndices[i * 4 + 0] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV0)
        .scaleBy(meshData.rawJointWeights[i * 4 + 0]);
      this._jointMatrices[meshData.rawBlendIndices[i * 4 + 1] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV1)
        .scaleBy(meshData.rawJointWeights[i * 4 + 1]);
      this._jointMatrices[meshData.rawBlendIndices[i * 4 + 2] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV2)
        .scaleBy(meshData.rawJointWeights[i * 4 + 2]);
      this._jointMatrices[meshData.rawBlendIndices[i * 4 + 3] + this._jointOffsets[0] - 1]
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
