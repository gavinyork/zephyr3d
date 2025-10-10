import { DRef, randomUUID, DWeakRef } from '@zephyr3d/base';
import type { Quaternion, TypedArray } from '@zephyr3d/base';
import { Disposable, Matrix4x4, Vector3, nextPowerOf2 } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneNode } from '../scene/scene_node';
import { BoundingBox } from '../utility/bounding_volume';
import { getDevice } from '../app/api';

/** @internal */
export interface SkinnedBoundingBox {
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
  /** @internal Global weak registry keyed by persistentId for serialization/lookup. */
  private static readonly _registry: Map<string, DWeakRef<Skeleton>> = new Map();
  /** @internal */
  protected _id: string;
  /** @internal */
  protected _joints: SceneNode[];
  /** @internal */
  protected _inverseBindMatrices: Matrix4x4[];
  /** @internal */
  protected _bindPoseMatrices: Matrix4x4[];
  /** @internal */
  protected _jointMatrices: Matrix4x4[];
  /** @internal */
  protected _jointTransforms: { scale: Vector3; rotation: Quaternion; position: Vector3 }[];
  /** @internal */
  protected _jointOffsets: Float32Array<ArrayBuffer>;
  /** @internal */
  protected _jointMatrixArray: Float32Array<ArrayBuffer>;
  /** @internal */
  protected _jointTexture: DRef<Texture2D>;
  /** @internal */
  protected _playing: boolean;
  /**
   * Create a skeleton instance.
   *
   * @param joints - Joint scene nodes (one per joint), ordered to match skin data.
   * @param inverseBindMatrices - Inverse bind matrices for each joint.
   * @param bindPoseMatrices - Bind pose matrices for each joint (model-space).
   */
  constructor(
    joints: SceneNode[],
    inverseBindMatrices: Matrix4x4[],
    bindPoseMatrices: Matrix4x4[],
    jointTransforms?: { scale: Vector3; rotation: Quaternion; position: Vector3 }[]
  ) {
    super();
    this._id = randomUUID();
    this._joints = joints;
    this._inverseBindMatrices = inverseBindMatrices;
    this._bindPoseMatrices = bindPoseMatrices;
    this._jointMatrixArray = null;
    this._jointMatrices = null;
    this._jointOffsets = null;
    this._jointTexture = new DRef();
    this._playing = false;
    if (jointTransforms) {
      this._jointTransforms = jointTransforms;
      for (let i = 0; i < jointTransforms.length; i++) {
        this._joints[i].scale = jointTransforms[i].scale;
        this._joints[i].rotation = jointTransforms[i].rotation;
        this._joints[i].position = jointTransforms[i].position;
      }
    } else {
      this._jointTransforms = this._joints.map((joint) => ({
        scale: joint.scale.clone(),
        rotation: joint.rotation.clone(),
        position: joint.position.clone()
      }));
    }
    this.updateJointMatrices(this._bindPoseMatrices);
    Skeleton._registry.set(this._id, new DWeakRef(this));
  }
  /**
   * Lookup a skeleton from the global registry by persistent id.
   *
   * @param id - The persistent UUID to search for.
   * @returns The skeleton if alive, otherwise `null`.
   * @internal
   */
  static findSkeletonById(id: string) {
    const m = this._registry.get(id);
    if (m && !m.get()) {
      this._registry.delete(id);
      return null;
    }
    return m ? m.get() : null;
  }
  /** @internal */
  get joints() {
    return this._joints;
  }
  /** @internal */
  get jointTransforms() {
    return this._jointTransforms;
  }
  /** @internal */
  get inverseBindMatrices() {
    return this._inverseBindMatrices;
  }
  /** @internal */
  get bindPoseMatrices() {
    return this._bindPoseMatrices;
  }
  /** @internal */
  get playing() {
    return this._playing;
  }
  set playing(b: boolean) {
    this._playing = b;
  }
  /** @internal */
  get persistentId() {
    return this._id;
  }
  set persistentId(val) {
    if (val !== this._id) {
      const m = Skeleton._registry.get(this._id);
      if (!m || m.get() !== this) {
        throw new Error('Registry skeleton mismatch');
      }
      Skeleton._registry.delete(this._id);
      this._id = val;
      Skeleton._registry.set(this._id, m);
    }
  }
  /**
   * Texture containing joint matrices for GPU skinning.
   *
   * Each matrix is stored in 4 texels (one row per texel, RGBA = 4 floats).
   */
  get jointTexture(): Texture2D {
    return this._jointTexture.get();
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
    if (!this._jointTexture.get()) {
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
    const tex = this._jointTexture.get();
    tex.update(this._jointMatrixArray, 0, 0, tex.width, tex.height);
  }
  /**
   * Compute current joint matrices from the nodes and upload them to the joint texture.
   *
   * @internal
   */
  computeJoints() {
    this.updateJointMatrices();
    const tex = this._jointTexture.get();
    tex.update(this._jointMatrixArray, 0, 0, tex.width, tex.height);
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
  }
  /**
   * Reset all meshes to an unskinned state and clear animated bounds.
   *
   * @internal
   */
  reset() {
    this.updateJointMatrices(this._bindPoseMatrices);
    this._playing = false;
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
    this._jointTexture.dispose();
    this._joints = null;
    this._inverseBindMatrices = null;
    this._bindPoseMatrices = null;
    this._jointMatrices = null;
    this._jointMatrixArray = null;
    const m = Skeleton._registry.get(this._id);
    if (m?.get() === this) {
      Skeleton._registry.delete(this._id);
      m.dispose();
    }
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
    this._jointTexture.set(
      device.createTexture2D('rgba32f', textureWidth, textureWidth, {
        mipmapping: false,
        samplerOptions: {
          magFilter: 'nearest',
          minFilter: 'nearest'
        }
      })
    );
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
  getBoundingInfo(data: {
    positions: Float32Array;
    blendIndices: TypedArray;
    weights: TypedArray;
  }): SkinnedBoundingBox {
    const indices = [0, 0, 0, 0, 0, 0];
    let minx = Number.MAX_VALUE;
    let maxx = -Number.MAX_VALUE;
    let miny = Number.MAX_VALUE;
    let maxy = -Number.MAX_VALUE;
    let minz = Number.MAX_VALUE;
    let maxz = -Number.MAX_VALUE;
    const v = data.positions;
    const vert = new Vector3();
    const tmpV0 = new Vector3();
    const tmpV1 = new Vector3();
    const tmpV2 = new Vector3();
    const tmpV3 = new Vector3();
    const numVertices = Math.floor(v.length / 3);
    for (let i = 0; i < numVertices; i++) {
      vert.setXYZ(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      this._jointMatrices[data.blendIndices[i * 4 + 0] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV0)
        .scaleBy(data.weights[i * 4 + 0]);
      this._jointMatrices[data.blendIndices[i * 4 + 1] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV1)
        .scaleBy(data.weights[i * 4 + 1]);
      this._jointMatrices[data.blendIndices[i * 4 + 2] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV2)
        .scaleBy(data.weights[i * 4 + 2]);
      this._jointMatrices[data.blendIndices[i * 4 + 3] + this._jointOffsets[0] - 1]
        .transformPointAffine(vert, tmpV3)
        .scaleBy(data.weights[i * 4 + 3]);
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
          (val, index) => data.blendIndices[indices[index >> 2] * 4 + (index % 4)]
        )
      ),
      boundingVertexJointWeights: new Float32Array(
        Array.from({ length: 6 * 4 }).map((val, index) => data.weights[indices[index >> 2] * 4 + (index % 4)])
      ),
      boundingVertices: Array.from({ length: 6 }).map(
        (val, index) =>
          new Vector3(
            data.positions[indices[index] * 3],
            data.positions[indices[index] * 3 + 1],
            data.positions[indices[index] * 3 + 2]
          )
      ),
      boundingBox: new BoundingBox()
    };
    return info;
  }
}
