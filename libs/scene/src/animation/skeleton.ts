import { DRef, randomUUID, DWeakRef } from '@zephyr3d/base';
import type { Nullable, TypedArray } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';
import { Disposable, Matrix4x4, Vector3, nextPowerOf2 } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneNode } from '../scene/scene_node';
import { BoundingBox } from '../utility/bounding_volume';
import { getDevice } from '../app/api';
import type { SkeletonModifier } from './skeleton_modifier';

/**
 * Standardized humanoid joint names for consistent skeleton mapping across models and animations.
 *
 * These names align with common conventions used in 3D modeling and animation tools, facilitating interoperability and reuse of assets.
 *
 * @public
 */
export enum HumanoidBodyRig {
  Hips = 'Hips',
  Spine = 'Spine',
  Chest = 'Chest',
  UpperChest = 'UpperChest',
  Neck = 'Neck',
  Head = 'Head',

  LeftShoulder = 'LeftShoulder',
  LeftUpperArm = 'LeftUpperArm',
  LeftLowerArm = 'LeftLowerArm',
  LeftHand = 'LeftHand',

  RightShoulder = 'RightShoulder',
  RightUpperArm = 'RightUpperArm',
  RightLowerArm = 'RightLowerArm',
  RightHand = 'RightHand',

  LeftUpperLeg = 'LeftUpperLeg',
  LeftLowerLeg = 'LeftLowerLeg',
  LeftFoot = 'LeftFoot',
  LeftToes = 'LeftToes',

  RightUpperLeg = 'RightUpperLeg',
  RightLowerLeg = 'RightLowerLeg',
  RightFoot = 'RightFoot',
  RightToes = 'RightToes'
}

/**
 * Standardized humanoid hand joint names for consistent skeleton mapping across models and animations.
 *
 * These names align with common conventions used in 3D modeling and animation tools, facilitating interoperability and reuse of assets.
 *
 * @public
 */
export enum HumanoidHandRig {
  ThumbProximal = 'ThumbProximal',
  ThumbIntermediate = 'ThumbIntermediate',
  ThumbDistal = 'ThumbDistal',
  IndexProximal = 'IndexProximal',
  IndexIntermediate = 'IndexIntermediate',
  IndexDistal = 'IndexDistal',
  MiddleProximal = 'MiddleProximal',
  MiddleIntermediate = 'MiddleIntermediate',
  MiddleDistal = 'MiddleDistal',
  RingProximal = 'RingProximal',
  RingIntermediate = 'RingIntermediate',
  RingDistal = 'RingDistal',
  PinkyProximal = 'PinkyProximal',
  PinkyIntermediate = 'PinkyIntermediate',
  PinkyDistal = 'PinkyDistal'
}

/**
 * Skinned bounding box information for a submesh.
 *
 * Used to compute animated AABB for skinned meshes.
 *
 * @public
 */
export interface SkinnedBoundingBox {
  /**
   * Number of influences stored per representative vertex.
   */
  influenceCount?: number;
  /**
   * Representative vertices used to bound a skinned mesh (extreme points along axes).
   */
  boundingVertices: Vector3[];
  /**
   * Joint indices for each representative vertex, flattened.
   */
  boundingVertexBlendIndices: Float32Array;
  /**
   * Corresponding joint weights for each representative vertex, flattened.
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

/**
 * Humanoid joint mapping
 * @public
 */
export type HumanoidJointMapping<T extends { name: string; parent: Nullable<T>; children: T[] }> = {
  body: Record<HumanoidBodyRig, T>;
  leftHand?: Record<HumanoidHandRig, T>;
  rightHand?: Record<HumanoidHandRig, T>;
};

/** @public */
export type SkeletonBindPose = { rotation: Quaternion; scale: Vector3; position: Vector3 };

/** @public */
export type SkeletonRigOptions = {
  rootJoint?: Nullable<SceneNode>;
  rootBindPose?: SkeletonBindPose;
  humanoidJointMapping?: Nullable<HumanoidJointMapping<SceneNode>>;
};

type HumanoidJointPattern = {
  all?: string[];
  any?: string[];
  none?: string[];
};

type HumanoidJointProfile<T extends string> = Record<T, HumanoidJointPattern[]>;

const humanoidHelperJointTokens = new Set(['end', 'nub', 'socket']);

type HumanoidJointNodeInfo<T extends { name: string; children: T[] }> = {
  node: T;
  depth: number;
  tokens: string[];
  tokenSet: Set<string>;
};

type HumanoidJointMatchCandidate<T extends { name: string; children: T[] }> = {
  node: T;
  score: number;
};

/**
 * Shared joint rig for skeletal animation.
 *
 * A rig owns the animated joint nodes, bind pose, humanoid mapping and procedural
 * modifiers. Multiple skin bindings may reference the same rig with different
 * inverse bind matrices.
 *
 * @public
 */
export class SkeletonRig extends Disposable {
  private static readonly _registry: Map<string, DWeakRef<SkeletonRig>> = new Map();
  protected _id: string;
  protected _joints: SceneNode[];
  protected _bindPoseByJoint: Map<SceneNode, SkeletonBindPose>;
  protected _bindPose: SkeletonBindPose[];
  protected _rootJoint: Nullable<SceneNode>;
  protected _rootBindPose: SkeletonBindPose;
  protected _playing: boolean;
  protected _modifiers: SkeletonModifier[];
  protected _humanoidJointMapping: Nullable<HumanoidJointMapping<SceneNode>>;
  protected _humanoidRootRotation: Quaternion;

  constructor(joints: SceneNode[], bindPose: SkeletonBindPose[], options?: SkeletonRigOptions) {
    super();
    this._id = randomUUID();
    this._joints = joints;
    this._bindPose = bindPose;
    this._bindPoseByJoint = new Map();
    for (let i = 0; i < joints.length; i++) {
      this._bindPoseByJoint.set(joints[i], bindPose[i]);
    }
    const skeletonRoot = this.findRootJoint(this._joints);
    this._rootJoint = options?.rootJoint ?? skeletonRoot;
    this._rootBindPose = options?.rootBindPose ?? this.getNodeBindPose(this._rootJoint);
    this._playing = false;
    this._modifiers = [];
    this.computeBindPose();
    this._humanoidJointMapping =
      options?.humanoidJointMapping !== undefined
        ? options.humanoidJointMapping
        : skeletonRoot
          ? Skeleton.tryExtractHumanoidJoints(skeletonRoot)
          : null;
    this._humanoidRootRotation = Quaternion.identity();
    const hips = this._humanoidJointMapping?.body[HumanoidBodyRig.Hips];
    if (hips) {
      let p = hips;
      while (this._joints.includes(p.parent!)) {
        Quaternion.multiply(p.parent!.rotation, this._humanoidRootRotation, this._humanoidRootRotation);
        p = p.parent!;
      }
    }
    SkeletonRig._registry.set(this._id, new DWeakRef(this));
  }

  static getRigKey(joints: SceneNode[], rootJoint?: Nullable<SceneNode>) {
    return [rootJoint?.persistentId ?? '', ...joints.map((joint) => joint.persistentId).sort()].join('|');
  }

  static findRigById(id: string) {
    const m = this._registry.get(id);
    if (m && !m.get()) {
      this._registry.delete(id);
      return null;
    }
    return m ? m.get() : null;
  }

  get persistentId() {
    return this._id;
  }

  set persistentId(val) {
    if (val !== this._id) {
      const m = SkeletonRig._registry.get(this._id);
      if (!m || m.get() !== this) {
        throw new Error('Registry skeleton rig mismatch');
      }
      SkeletonRig._registry.delete(this._id);
      this._id = val;
      SkeletonRig._registry.set(this._id, m);
    }
  }

  get joints() {
    return this._joints;
  }

  get bindPose() {
    return this._bindPose;
  }

  get rootJoint(): Nullable<SceneNode> {
    return this._rootJoint;
  }

  set rootJoint(joint: Nullable<SceneNode>) {
    this._rootJoint = joint;
    this._rootBindPose = this.getNodeBindPose(joint);
  }

  get rootBindPose(): SkeletonBindPose {
    return this._rootBindPose;
  }

  getBindPoseForJoint(joint: SceneNode) {
    return this._bindPoseByJoint.get(joint) ?? null;
  }

  get humanoidJointMapping(): Nullable<HumanoidJointMapping<SceneNode>> {
    return this._humanoidJointMapping;
  }

  get humanoidRootRotation(): Quaternion {
    return this._humanoidRootRotation;
  }

  get modifiers(): SkeletonModifier[] {
    return this._modifiers;
  }

  get playing() {
    return this._playing;
  }

  set playing(b: boolean) {
    this._playing = b;
  }

  getJointIndex(joint: SceneNode) {
    return this._joints.indexOf(joint);
  }

  getJointIndexByName(jointName: string) {
    return this._joints.findIndex((joint) => joint.name === jointName);
  }

  computeBindPose() {
    for (let i = 0; i < this._joints.length; i++) {
      const joint = this._joints[i];
      const bindpose = this._bindPose[i];
      joint.position.set(bindpose.position);
      joint.rotation.set(bindpose.rotation);
      joint.scale.set(bindpose.scale);
    }
    if (this._rootJoint && !this._bindPoseByJoint.has(this._rootJoint)) {
      this._rootJoint.position.set(this._rootBindPose.position);
      this._rootJoint.rotation.set(this._rootBindPose.rotation);
      this._rootJoint.scale.set(this._rootBindPose.scale);
    }
  }

  apply(deltaTime: number): void {
    for (const modifier of this._modifiers) {
      modifier.apply(this, deltaTime);
    }
  }

  reset() {
    this._playing = false;
  }

  protected onDispose() {
    super.onDispose();
    const m = SkeletonRig._registry.get(this._id);
    if (m?.get() === this) {
      SkeletonRig._registry.delete(this._id);
      m.dispose();
    }
  }

  private findRootJoint(joints: SceneNode[]) {
    let root: Nullable<SceneNode> = null;
    for (const joint of joints) {
      if (!root) {
        root = joint;
      }
      while (!root!.isParentOf(joint)) {
        root = root!.parent;
      }
      if (!root) {
        break;
      }
    }
    return root;
  }

  private getNodeBindPose(node: Nullable<SceneNode>): SkeletonBindPose {
    const bindPose = node ? this._bindPoseByJoint.get(node) : null;
    return bindPose
      ? {
          position: bindPose.position.clone(),
          rotation: bindPose.rotation.clone(),
          scale: bindPose.scale.clone()
        }
      : {
          position: node?.position.clone() ?? Vector3.zero(),
          rotation: node?.rotation.clone() ?? Quaternion.identity(),
          scale: node?.scale.clone() ?? Vector3.one()
        };
  }
}

function jointPattern(all: string[], none?: string[], any?: string[]): HumanoidJointPattern {
  return {
    all,
    any: any?.length ? any : undefined,
    none: none?.length ? none : undefined
  };
}

function sideJointPatterns(
  side: 'left' | 'right',
  patterns: Array<{ all: string[]; none?: string[]; any?: string[] }>
): HumanoidJointPattern[] {
  const sideTokens = side === 'left' ? ['left', 'l'] : ['right', 'r'];
  return sideTokens.flatMap((sideToken) =>
    patterns.map((pattern) => ({
      all: [sideToken, ...pattern.all],
      any: pattern.any?.length ? [...pattern.any] : undefined,
      none: pattern.none?.length ? [...pattern.none] : undefined
    }))
  );
}

/**
 * Skin binding for skinned animation.
 *
 * Responsibilities:
 * - References a shared SkeletonRig.
 * - Maintains inverse bind and current skinning matrices for one skin.
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
 * - Construct with a rig, bind data, meshes and submesh bounding info.
 * - Call `apply()` each frame to update joint texture, bind to meshes, and update bounds.
 * - Call `reset()` to clear skinning on meshes.
 *
 * @public
 */
export class SkinBinding extends Disposable {
  /** @internal Global weak registry keyed by persistentId for serialization/lookup. */
  private static readonly _registry: Map<string, DWeakRef<SkinBinding>> = new Map();
  /** @internal */
  protected _id: string;
  /** @internal */
  protected _rig: SkeletonRig;
  /** @internal */
  protected _joints: SceneNode[];
  /** @internal */
  protected _inverseBindMatrices: Matrix4x4[];
  /** @internal */
  protected _jointMatrices!: Matrix4x4[];
  /** @internal */
  protected _jointOffsets!: Float32Array<ArrayBuffer>;
  /** @internal */
  protected _jointMatrixArray!: Float32Array<ArrayBuffer>;
  /** @internal */
  protected _jointTexture: DRef<Texture2D>;
  /** @internal */
  protected _playing: boolean;
  /** @internal */
  protected _lastUpdateTime: number;
  /**
   * Create a skin binding instance.
   *
   * @param rig - Shared skeleton rig that owns animated joint transforms.
   * @param joints - Joint scene nodes (one per joint), ordered to match skin data.
   * @param inverseBindMatrices - Inverse bind matrices for each joint.
   * @param bindPoseMatrices - Bind pose matrices for each joint (model-space).
   */
  constructor(
    rig: SkeletonRig,
    inverseBindMatrices: Matrix4x4[],
    joints?: SceneNode[],
    bindPose?: SkeletonBindPose[]
  ) {
    super();
    this._id = randomUUID();
    this._rig = rig;
    this._joints = joints ?? rig.joints;
    this._inverseBindMatrices = inverseBindMatrices;
    this._jointTexture = new DRef();
    this._playing = false;
    this._lastUpdateTime = 0;
    if (bindPose && bindPose !== rig.bindPose) {
      // Legacy callers used Skeleton as both rig and binding. Keep the old bind
      // pose visible by replacing the rig pose only when explicitly supplied.
      this._rig = new SkeletonRig(rig.joints, bindPose, {
        rootJoint: rig.rootJoint,
        rootBindPose: rig.rootBindPose,
        humanoidJointMapping: rig.humanoidJointMapping
      });
    }
    this.updateJointMatrices();
    SkinBinding._registry.set(this._id, new DWeakRef(this));
  }
  /**
   * Lookup a skeleton from the global registry by persistent id.
   *
   * @param id - The persistent UUID to search for.
   * @returns The skeleton if alive, otherwise `null`.
   * @internal
   */
  static findSkinBindingById(id: string) {
    const m = this._registry.get(id);
    if (m && !m.get()) {
      this._registry.delete(id);
      return null;
    }
    return m ? m.get() : null;
  }
  static findSkeletonById(id: string) {
    return this.findSkinBindingById(id);
  }
  get rig() {
    return this._rig;
  }
  /** Gets joint nodes */
  get joints() {
    return this._joints;
  }
  /** Gets the humanoid joint mapping */
  get humanoidJointMapping(): Nullable<HumanoidJointMapping<SceneNode>> {
    return this._rig.humanoidJointMapping;
  }
  /** Root rotation of humanoid hips bone */
  get humanoidRootRotation(): Quaternion {
    return this._rig.humanoidRootRotation;
  }
  /** @internal */
  get inverseBindMatrices() {
    return this._inverseBindMatrices;
  }
  /** @internal */
  get bindPose() {
    return this._joints.map((joint) => this._rig.getBindPoseForJoint(joint)!);
  }
  get playing() {
    return this._playing;
  }
  set playing(b: boolean) {
    this._playing = b;
  }
  get persistentId() {
    return this._id;
  }
  set persistentId(val) {
    if (val !== this._id) {
      const m = SkinBinding._registry.get(this._id);
      if (!m || m.get() !== this) {
        throw new Error('Registry skin binding mismatch');
      }
      SkinBinding._registry.delete(this._id);
      this._id = val;
      SkinBinding._registry.set(this._id, m);
    }
  }
  /**
   * Texture containing joint matrices for GPU skinning.
   *
   * Each matrix is stored in 4 texels (one row per texel, RGBA = 4 floats).
   */
  get jointTexture() {
    return this._jointTexture.get()!;
  }
  /**
   * Get joint index by joint node
   * @param joint - joint node
   * @returns The index of the joint
   */
  getJointIndex(joint: SceneNode) {
    return this._joints.indexOf(joint);
  }
  /**
   * Get joint index by joint name
   * @param jointName - joint name
   * @returns The index of the joint
   */
  getJointIndexByName(jointName: string) {
    return this._joints.findIndex((joint) => joint.name === jointName);
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
  updateJointMatrices() {
    if (!this._jointTexture.get()) {
      this._createJointTexture();
    }
    if (this._jointOffsets[0] === 0) {
      this._jointOffsets[0] = 1;
      this._jointOffsets[1] = 1;
    } else {
      this._jointOffsets[1] = this._jointOffsets[0];
      this._jointOffsets[0] = this.joints.length - this._jointOffsets[0] + 2;
    }
    for (let i = 0; i < this.joints.length; i++) {
      Matrix4x4.multiply(
        this.joints[i].worldMatrix,
        this._inverseBindMatrices[i],
        this._jointMatrices[i + this._jointOffsets[0] - 1]
      );
    }
  }
  /**
   * Reset skeleton to bind pose
   *
   * @internal
   */
  computeBindPose() {
    this._rig.computeBindPose();
  }
  /**
   * Compute current joint matrices from the nodes and upload them to the joint texture.
   *
   * @internal
   */
  apply() {
    this.updateJointMatrices();
    const tex = this.jointTexture;
    this._syncJointMatrixArray();
    tex.update(this._jointMatrixArray, 0, 0, tex.width, tex.height);
  }
  /**
   * Apply all enabled modifiers.
   *
   * Modifiers are applied after the base animation/bind pose layer,
   * allowing procedural modifications like IK, spring physics, or manual overrides.
   *
   * @param deltaTime - Time elapsed since last frame (in seconds)
   * @internal
   */
  protected applyModifiers(deltaTime: number): void {
    this._rig.apply(deltaTime);
  }
  /**
   * Get all modifiers attached to this skeleton.
   *
   * @public
   */
  get modifiers(): SkeletonModifier[] {
    return this._rig.modifiers;
  }
  /**
   * Reset all meshes to an unskinned state and clear animated bounds.
   *
   * @internal
   */
  reset() {
    //this.updateJointMatrices(this._bindPoseMatrices);
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
    const influenceCount = Math.max(1, info.influenceCount ?? 4);
    for (let i = 0; i < info.boundingVertices.length; i++) {
      tmpV0.setXYZ(0, 0, 0);
      const base = i * influenceCount;
      for (let j = 0; j < influenceCount; j++) {
        const weight = Number(info.boundingVertexJointWeights[base + j]) || 0;
        if (weight <= 0) {
          continue;
        }
        const matrix =
          this._jointMatrices[
            (Number(info.boundingVertexBlendIndices[base + j]) || 0) + this._jointOffsets[0] - 1
          ];
        if (!matrix) {
          continue;
        }
        matrix.transformPointAffine(info.boundingVertices[i], tmpV1).scaleBy(weight);
        tmpV0.addBy(tmpV1);
      }
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
    const m = SkinBinding._registry.get(this._id);
    if (m?.get() === this) {
      SkinBinding._registry.delete(this._id);
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
    const textureWidth = nextPowerOf2(Math.max(4, Math.ceil(Math.sqrt((this.joints.length * 2 + 1) * 4))));
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
    this._jointOffsets = this._jointMatrixArray.subarray(0, 2) as Float32Array<ArrayBuffer>;
    this._jointOffsets[0] = 0;
    this._jointOffsets[1] = 0;
    this._jointMatrices = Array.from({ length: this.joints.length * 2 }).map(() => new Matrix4x4());
  }
  private _syncJointMatrixArray() {
    for (let i = 0; i < this._jointMatrices.length; i++) {
      this._jointMatrixArray.set(this._jointMatrices[i], (i + 1) * 16);
    }
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
   */
  getBoundingInfo(data: {
    positions: Float32Array;
    blendIndices: TypedArray;
    weights: TypedArray;
    influenceCount?: number;
  }) {
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
    const numVertices = Math.floor(v.length / 3);
    const influenceCount = Math.max(1, data.influenceCount ?? 4);
    for (let i = 0; i < numVertices; i++) {
      vert.setXYZ(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      tmpV0.setXYZ(0, 0, 0);
      const base = i * influenceCount;
      for (let j = 0; j < influenceCount; j++) {
        const weight = Number(data.weights[base + j]) || 0;
        if (weight <= 0) {
          continue;
        }
        const matrix =
          this._jointMatrices[(Number(data.blendIndices[base + j]) || 0) + this._jointOffsets[0] - 1];
        if (!matrix) {
          continue;
        }
        matrix.transformPointAffine(vert, tmpV1).scaleBy(weight);
        tmpV0.addBy(tmpV1);
      }
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
      influenceCount,
      boundingVertexBlendIndices: new Float32Array(
        Array.from({ length: 6 * influenceCount }).map(
          (val, index) =>
            data.blendIndices[
              indices[Math.floor(index / influenceCount)] * influenceCount + (index % influenceCount)
            ]
        )
      ),
      boundingVertexJointWeights: new Float32Array(
        Array.from({ length: 6 * influenceCount }).map(
          (val, index) =>
            data.weights[
              indices[Math.floor(index / influenceCount)] * influenceCount + (index % influenceCount)
            ]
        )
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
  /**
   * Skin all vertices into mesh-local space for the current skeleton pose.
   *
   * This is used by systems like cloth that need the animated mesh pose on CPU,
   * but render with GPU skinning disabled to avoid double deformation.
   *
   * @param positions - Bind-pose/object-space input positions, xyz packed.
   * @param blendIndices - 4 joint indices per vertex.
   * @param weights - 4 joint weights per vertex.
   * @param invWorldMatrix - Mesh inverse world matrix to convert skinned world positions back to mesh-local space.
   * @param out - Optional output array to reuse.
   * @returns The skinned mesh-local positions.
   * @internal
   */
  skinPositionsToLocal(
    positions: Float32Array<ArrayBuffer>,
    blendIndices: ArrayLike<number>,
    weights: ArrayLike<number>,
    invWorldMatrix: Matrix4x4,
    out?: Float32Array<ArrayBuffer>,
    influenceCount?: number
  ) {
    const result = out && out.length === positions.length ? out : new Float32Array(positions.length);
    const matrixOffset = this._jointOffsets[0] - 1;
    const effectiveInfluenceCount = Math.max(
      1,
      influenceCount ??
        Math.max(1, Math.floor(weights.length / Math.max(1, Math.floor(positions.length / 3))))
    );
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const vertexIndex = (i / 3) >> 0;
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      let skinnedX = 0;
      let skinnedY = 0;
      let skinnedZ = 0;
      let weightSum = 0;
      const base = vertexIndex * effectiveInfluenceCount;
      for (let j = 0; j < effectiveInfluenceCount; j++) {
        const weight = Number(weights[base + j]) || 0;
        if (weight <= 0) {
          continue;
        }
        const jointIndex = (Number(blendIndices[base + j]) || 0) + matrixOffset;
        const matrix = this._jointMatrices[jointIndex];
        if (!matrix) {
          continue;
        }
        skinnedX += (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * weight;
        skinnedY += (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * weight;
        skinnedZ += (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * weight;
        weightSum += weight;
      }
      if (weightSum <= 1e-6) {
        skinnedX = x;
        skinnedY = y;
        skinnedZ = z;
      }
      result[i] =
        invWorldMatrix[0] * skinnedX +
        invWorldMatrix[4] * skinnedY +
        invWorldMatrix[8] * skinnedZ +
        invWorldMatrix[12];
      result[i + 1] =
        invWorldMatrix[1] * skinnedX +
        invWorldMatrix[5] * skinnedY +
        invWorldMatrix[9] * skinnedZ +
        invWorldMatrix[13];
      result[i + 2] =
        invWorldMatrix[2] * skinnedX +
        invWorldMatrix[6] * skinnedY +
        invWorldMatrix[10] * skinnedZ +
        invWorldMatrix[14];
    }
    return result;
  }
  private static normalizeHumanoidJointName(name: string) {
    return name
      .slice(name.lastIndexOf(':') + 1)
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
      .replace(/(\d+)([a-zA-Z])/g, '$1 $2')
      .replace(/[_:\/\\.-]+/g, ' ')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase()
      .replace(/\bforearm\b/g, 'fore arm')
      .replace(/\bupperarm\b/g, 'upper arm')
      .replace(/\blowerarm\b/g, 'lower arm')
      .replace(/\bupleg\b/g, 'up leg')
      .replace(/\bupperleg\b/g, 'upper leg')
      .replace(/\blowerleg\b/g, 'lower leg')
      .replace(/\btoebase\b/g, 'toe base')
      .replace(/\bupperchest\b/g, 'upper chest')
      .replace(/\btoes\b/g, 'toe')
      .replace(/\blittle\b/g, 'pinky')
      .replace(/\bcollar\b/g, 'clavicle')
      .replace(/\s+/g, ' ')
      .trim();
  }
  private static getHumanoidJointNodeDepth<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    root: T,
    node: T
  ) {
    let depth = 0;
    let current: Nullable<T> = node;
    while (current && current !== root) {
      depth++;
      current = current.parent;
    }
    return depth;
  }
  private static collectHumanoidJointNodeInfos<
    T extends { name: string; parent: Nullable<T>; children: T[] }
  >(root: T): HumanoidJointNodeInfo<T>[] {
    const nodes: HumanoidJointNodeInfo<T>[] = [];
    this.iterateNode(root, (node) => {
      const normalizedName = this.normalizeHumanoidJointName(node.name || '');
      if (!normalizedName) {
        return false;
      }
      const tokens = normalizedName.split(' ').filter(Boolean);
      if (!tokens.length || tokens.some((token) => humanoidHelperJointTokens.has(token))) {
        return false;
      }
      nodes.push({
        node,
        depth: this.getHumanoidJointNodeDepth(root, node),
        tokens,
        tokenSet: new Set(tokens)
      });
      return false;
    });
    return nodes;
  }
  private static matchesHumanoidJointPattern<T extends { name: string; children: T[] }>(
    info: HumanoidJointNodeInfo<T>,
    pattern: HumanoidJointPattern
  ) {
    if (pattern.all?.some((token) => !info.tokenSet.has(token))) {
      return false;
    }
    if (pattern.any?.length && !pattern.any.some((token) => info.tokenSet.has(token))) {
      return false;
    }
    if (pattern.none?.some((token) => info.tokenSet.has(token))) {
      return false;
    }
    return true;
  }
  private static scoreHumanoidJointPattern<T extends { name: string; children: T[] }>(
    info: HumanoidJointNodeInfo<T>,
    pattern: HumanoidJointPattern,
    priority: number
  ) {
    const matchedTokens = new Set(pattern.all ?? []);
    for (const token of pattern.any ?? []) {
      if (info.tokenSet.has(token)) {
        matchedTokens.add(token);
      }
    }
    let extraTokenCount = 0;
    for (const token of info.tokens) {
      if (!matchedTokens.has(token)) {
        extraTokenCount++;
      }
    }
    return priority * 100000 + matchedTokens.size * 100 - extraTokenCount * 5 - info.depth;
  }
  private static collectHumanoidJointCandidates<T extends { name: string; children: T[] }>(
    nodes: HumanoidJointNodeInfo<T>[],
    patterns: HumanoidJointPattern[],
    used: Set<T>
  ): HumanoidJointMatchCandidate<T>[] {
    const candidates = new Map<T, number>();
    for (let index = 0; index < patterns.length; index++) {
      const pattern = patterns[index];
      const priority = patterns.length - index;
      for (const info of nodes) {
        if (used.has(info.node) || !this.matchesHumanoidJointPattern(info, pattern)) {
          continue;
        }
        const score = this.scoreHumanoidJointPattern(info, pattern, priority);
        const current = candidates.get(info.node);
        if (current === undefined || score > current) {
          candidates.set(info.node, score);
        }
      }
    }
    return Array.from(candidates, ([node, score]) => ({ node, score })).sort((a, b) => b.score - a.score);
  }
  private static findBestHumanoidJoint<T extends { name: string; children: T[] }>(
    nodes: HumanoidJointNodeInfo<T>[],
    patterns: HumanoidJointPattern[],
    used: Set<T>
  ) {
    return this.collectHumanoidJointCandidates(nodes, patterns, used)[0]?.node ?? null;
  }
  private static matchHumanoidJointProfile<T extends string, U extends { name: string; children: U[] }>(
    nodes: HumanoidJointNodeInfo<U>[],
    profile: HumanoidJointProfile<T>,
    used: Set<U>,
    optional?: Set<T>
  ): Partial<Record<T, U>> | null {
    const result = {} as Partial<Record<T, U>>;
    const reserved = new Set<U>();
    for (const joint of Object.keys(profile) as T[]) {
      const node = this.findBestHumanoidJoint(nodes, profile[joint], new Set<U>([...used, ...reserved]));
      if (!node) {
        if (optional?.has(joint)) {
          continue;
        }
        return null;
      }
      result[joint] = node;
      reserved.add(node);
    }
    for (const node of reserved) {
      used.add(node);
    }
    return result;
  }
  private static validateHumanoidBodyPartial<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    body: Partial<Record<HumanoidBodyRig, T>>
  ) {
    const validateAncestor = (ancestor: HumanoidBodyRig, descendant: HumanoidBodyRig) =>
      !body[ancestor] || !body[descendant] || this.isSameOrAncestor(body[ancestor]!, body[descendant]!);
    return (
      validateAncestor(HumanoidBodyRig.Hips, HumanoidBodyRig.Spine) &&
      validateAncestor(HumanoidBodyRig.Hips, HumanoidBodyRig.Neck) &&
      validateAncestor(HumanoidBodyRig.Hips, HumanoidBodyRig.LeftUpperLeg) &&
      validateAncestor(HumanoidBodyRig.Hips, HumanoidBodyRig.RightUpperLeg) &&
      validateAncestor(HumanoidBodyRig.Spine, HumanoidBodyRig.Chest) &&
      validateAncestor(HumanoidBodyRig.Spine, HumanoidBodyRig.UpperChest) &&
      validateAncestor(HumanoidBodyRig.Spine, HumanoidBodyRig.Neck) &&
      validateAncestor(HumanoidBodyRig.Spine, HumanoidBodyRig.Head) &&
      validateAncestor(HumanoidBodyRig.Spine, HumanoidBodyRig.LeftShoulder) &&
      validateAncestor(HumanoidBodyRig.Spine, HumanoidBodyRig.RightShoulder) &&
      validateAncestor(HumanoidBodyRig.Chest, HumanoidBodyRig.UpperChest) &&
      validateAncestor(HumanoidBodyRig.Chest, HumanoidBodyRig.Neck) &&
      validateAncestor(HumanoidBodyRig.Chest, HumanoidBodyRig.Head) &&
      validateAncestor(HumanoidBodyRig.Chest, HumanoidBodyRig.LeftShoulder) &&
      validateAncestor(HumanoidBodyRig.Chest, HumanoidBodyRig.RightShoulder) &&
      validateAncestor(HumanoidBodyRig.UpperChest, HumanoidBodyRig.Neck) &&
      validateAncestor(HumanoidBodyRig.UpperChest, HumanoidBodyRig.Head) &&
      validateAncestor(HumanoidBodyRig.UpperChest, HumanoidBodyRig.LeftShoulder) &&
      validateAncestor(HumanoidBodyRig.UpperChest, HumanoidBodyRig.RightShoulder) &&
      validateAncestor(HumanoidBodyRig.Neck, HumanoidBodyRig.Head) &&
      validateAncestor(HumanoidBodyRig.LeftShoulder, HumanoidBodyRig.LeftUpperArm) &&
      validateAncestor(HumanoidBodyRig.LeftUpperArm, HumanoidBodyRig.LeftLowerArm) &&
      validateAncestor(HumanoidBodyRig.LeftLowerArm, HumanoidBodyRig.LeftHand) &&
      validateAncestor(HumanoidBodyRig.RightShoulder, HumanoidBodyRig.RightUpperArm) &&
      validateAncestor(HumanoidBodyRig.RightUpperArm, HumanoidBodyRig.RightLowerArm) &&
      validateAncestor(HumanoidBodyRig.RightLowerArm, HumanoidBodyRig.RightHand) &&
      validateAncestor(HumanoidBodyRig.LeftUpperLeg, HumanoidBodyRig.LeftLowerLeg) &&
      validateAncestor(HumanoidBodyRig.LeftLowerLeg, HumanoidBodyRig.LeftFoot) &&
      validateAncestor(HumanoidBodyRig.LeftFoot, HumanoidBodyRig.LeftToes) &&
      validateAncestor(HumanoidBodyRig.RightUpperLeg, HumanoidBodyRig.RightLowerLeg) &&
      validateAncestor(HumanoidBodyRig.RightLowerLeg, HumanoidBodyRig.RightFoot) &&
      validateAncestor(HumanoidBodyRig.RightFoot, HumanoidBodyRig.RightToes)
    );
  }
  private static matchHumanoidBodyProfile<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    nodes: HumanoidJointNodeInfo<T>[],
    profile: HumanoidJointProfile<HumanoidBodyRig>,
    used: Set<T>,
    optional?: Set<HumanoidBodyRig>
  ): Partial<Record<HumanoidBodyRig, T>> | null {
    const joints = Object.keys(profile) as HumanoidBodyRig[];
    const candidates = new Map<HumanoidBodyRig, HumanoidJointMatchCandidate<T>[]>();
    for (const joint of joints) {
      candidates.set(joint, this.collectHumanoidJointCandidates(nodes, profile[joint], used));
    }
    const current = {} as Partial<Record<HumanoidBodyRig, T>>;
    const reserved = new Set<T>();
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestResult: Partial<Record<HumanoidBodyRig, T>> | null = null;
    const search = (index: number, score: number) => {
      if (index >= joints.length) {
        if (score > bestScore) {
          bestScore = score;
          bestResult = { ...current };
        }
        return;
      }
      const joint = joints[index];
      let matched = false;
      for (const candidate of candidates.get(joint) ?? []) {
        if (reserved.has(candidate.node)) {
          continue;
        }
        current[joint] = candidate.node;
        reserved.add(candidate.node);
        if (this.validateHumanoidBodyPartial(current)) {
          matched = true;
          search(index + 1, score + candidate.score);
        }
        reserved.delete(candidate.node);
        delete current[joint];
      }
      if (optional?.has(joint)) {
        search(index + 1, score);
      } else if (!matched) {
        return;
      }
    };
    search(0, 0);
    if (!bestResult) {
      return null;
    }
    for (const node of Object.values(bestResult) as T[]) {
      used.add(node);
    }
    return bestResult;
  }
  private static getHumanoidIntermediateChain<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    ancestor: T,
    descendant: T
  ) {
    if (!this.isSameOrAncestor(ancestor, descendant)) {
      return null;
    }
    const chain: T[] = [];
    let current = descendant.parent;
    while (current && current !== ancestor) {
      chain.unshift(current);
      current = current.parent;
    }
    return chain;
  }
  private static completeHumanoidBody<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    body: Partial<Record<HumanoidBodyRig, T>>
  ): Record<HumanoidBodyRig, T> | null {
    const requiredJoints = [
      HumanoidBodyRig.Hips,
      HumanoidBodyRig.Spine,
      HumanoidBodyRig.Neck,
      HumanoidBodyRig.Head,
      HumanoidBodyRig.LeftShoulder,
      HumanoidBodyRig.LeftUpperArm,
      HumanoidBodyRig.LeftLowerArm,
      HumanoidBodyRig.LeftHand,
      HumanoidBodyRig.RightShoulder,
      HumanoidBodyRig.RightUpperArm,
      HumanoidBodyRig.RightLowerArm,
      HumanoidBodyRig.RightHand,
      HumanoidBodyRig.LeftUpperLeg,
      HumanoidBodyRig.LeftLowerLeg,
      HumanoidBodyRig.LeftFoot,
      HumanoidBodyRig.LeftToes,
      HumanoidBodyRig.RightUpperLeg,
      HumanoidBodyRig.RightLowerLeg,
      HumanoidBodyRig.RightFoot,
      HumanoidBodyRig.RightToes
    ];
    for (const joint of requiredJoints) {
      if (!body[joint]) {
        return null;
      }
    }
    const spine = body[HumanoidBodyRig.Spine]!;
    const neck = body[HumanoidBodyRig.Neck]!;
    let chest = body[HumanoidBodyRig.Chest];
    let upperChest = body[HumanoidBodyRig.UpperChest];
    if (!chest || !upperChest) {
      const spineChain = this.getHumanoidIntermediateChain(spine, neck);
      if (!spineChain || spineChain.length === 0) {
        chest ||= spine;
        upperChest ||= chest;
      } else if (spineChain.length === 1) {
        chest ||= spineChain[0];
        upperChest ||= chest;
      } else {
        chest ||= spineChain[0];
        upperChest ||= spineChain[spineChain.length - 1];
      }
    }
    if (!chest || !upperChest) {
      return null;
    }
    return {
      [HumanoidBodyRig.Hips]: body[HumanoidBodyRig.Hips]!,
      [HumanoidBodyRig.Spine]: spine,
      [HumanoidBodyRig.Chest]: chest,
      [HumanoidBodyRig.UpperChest]: upperChest,
      [HumanoidBodyRig.Neck]: neck,
      [HumanoidBodyRig.Head]: body[HumanoidBodyRig.Head]!,
      [HumanoidBodyRig.LeftShoulder]: body[HumanoidBodyRig.LeftShoulder]!,
      [HumanoidBodyRig.LeftUpperArm]: body[HumanoidBodyRig.LeftUpperArm]!,
      [HumanoidBodyRig.LeftLowerArm]: body[HumanoidBodyRig.LeftLowerArm]!,
      [HumanoidBodyRig.LeftHand]: body[HumanoidBodyRig.LeftHand]!,
      [HumanoidBodyRig.RightShoulder]: body[HumanoidBodyRig.RightShoulder]!,
      [HumanoidBodyRig.RightUpperArm]: body[HumanoidBodyRig.RightUpperArm]!,
      [HumanoidBodyRig.RightLowerArm]: body[HumanoidBodyRig.RightLowerArm]!,
      [HumanoidBodyRig.RightHand]: body[HumanoidBodyRig.RightHand]!,
      [HumanoidBodyRig.LeftUpperLeg]: body[HumanoidBodyRig.LeftUpperLeg]!,
      [HumanoidBodyRig.LeftLowerLeg]: body[HumanoidBodyRig.LeftLowerLeg]!,
      [HumanoidBodyRig.LeftFoot]: body[HumanoidBodyRig.LeftFoot]!,
      [HumanoidBodyRig.LeftToes]: body[HumanoidBodyRig.LeftToes]!,
      [HumanoidBodyRig.RightUpperLeg]: body[HumanoidBodyRig.RightUpperLeg]!,
      [HumanoidBodyRig.RightLowerLeg]: body[HumanoidBodyRig.RightLowerLeg]!,
      [HumanoidBodyRig.RightFoot]: body[HumanoidBodyRig.RightFoot]!,
      [HumanoidBodyRig.RightToes]: body[HumanoidBodyRig.RightToes]!
    };
  }
  private static completeHumanoidHand<T extends { name: string; children: T[] }>(
    hand: Partial<Record<HumanoidHandRig, T>>
  ): Record<HumanoidHandRig, T> | null {
    for (const joint of Object.values(HumanoidHandRig)) {
      if (!hand[joint]) {
        return null;
      }
    }
    return {
      [HumanoidHandRig.ThumbProximal]: hand[HumanoidHandRig.ThumbProximal]!,
      [HumanoidHandRig.ThumbIntermediate]: hand[HumanoidHandRig.ThumbIntermediate]!,
      [HumanoidHandRig.ThumbDistal]: hand[HumanoidHandRig.ThumbDistal]!,
      [HumanoidHandRig.IndexProximal]: hand[HumanoidHandRig.IndexProximal]!,
      [HumanoidHandRig.IndexIntermediate]: hand[HumanoidHandRig.IndexIntermediate]!,
      [HumanoidHandRig.IndexDistal]: hand[HumanoidHandRig.IndexDistal]!,
      [HumanoidHandRig.MiddleProximal]: hand[HumanoidHandRig.MiddleProximal]!,
      [HumanoidHandRig.MiddleIntermediate]: hand[HumanoidHandRig.MiddleIntermediate]!,
      [HumanoidHandRig.MiddleDistal]: hand[HumanoidHandRig.MiddleDistal]!,
      [HumanoidHandRig.RingProximal]: hand[HumanoidHandRig.RingProximal]!,
      [HumanoidHandRig.RingIntermediate]: hand[HumanoidHandRig.RingIntermediate]!,
      [HumanoidHandRig.RingDistal]: hand[HumanoidHandRig.RingDistal]!,
      [HumanoidHandRig.PinkyProximal]: hand[HumanoidHandRig.PinkyProximal]!,
      [HumanoidHandRig.PinkyIntermediate]: hand[HumanoidHandRig.PinkyIntermediate]!,
      [HumanoidHandRig.PinkyDistal]: hand[HumanoidHandRig.PinkyDistal]!
    };
  }
  private static tryExtractOptionalHumanoidHand<T extends { name: string; children: T[] }>(
    nodes: HumanoidJointNodeInfo<T>[],
    side: 'left' | 'right',
    used: Set<T>
  ): Record<HumanoidHandRig, T> | undefined {
    const handCandidates = this.matchHumanoidJointProfile(
      nodes,
      this.createCommonHumanoidHandProfile(side),
      used
    );
    if (!handCandidates) {
      return undefined;
    }
    return this.completeHumanoidHand(handCandidates) ?? undefined;
  }
  private static isSameOrAncestor<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    parent: T,
    child: T
  ) {
    return parent === child || this.isParentOf(parent, child);
  }
  private static validateHumanoidHandHierarchy<
    T extends { name: string; parent: Nullable<T>; children: T[] }
  >(hand: T, joints: Record<HumanoidHandRig, T>) {
    const chains: [HumanoidHandRig, HumanoidHandRig, HumanoidHandRig][] = [
      [HumanoidHandRig.ThumbProximal, HumanoidHandRig.ThumbIntermediate, HumanoidHandRig.ThumbDistal],
      [HumanoidHandRig.IndexProximal, HumanoidHandRig.IndexIntermediate, HumanoidHandRig.IndexDistal],
      [HumanoidHandRig.MiddleProximal, HumanoidHandRig.MiddleIntermediate, HumanoidHandRig.MiddleDistal],
      [HumanoidHandRig.RingProximal, HumanoidHandRig.RingIntermediate, HumanoidHandRig.RingDistal],
      [HumanoidHandRig.PinkyProximal, HumanoidHandRig.PinkyIntermediate, HumanoidHandRig.PinkyDistal]
    ];
    return chains.every(
      ([proximal, intermediate, distal]) =>
        this.isSameOrAncestor(hand, joints[proximal]) &&
        this.isSameOrAncestor(joints[proximal], joints[intermediate]) &&
        this.isSameOrAncestor(joints[intermediate], joints[distal])
    );
  }
  private static validateHumanoidJointExtraction<
    T extends { name: string; parent: Nullable<T>; children: T[] }
  >(result: HumanoidJointMapping<T>) {
    const body = result.body;
    return (
      this.isSameOrAncestor(body[HumanoidBodyRig.Hips], body[HumanoidBodyRig.Spine]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.Spine], body[HumanoidBodyRig.Chest]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.Chest], body[HumanoidBodyRig.UpperChest]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.UpperChest], body[HumanoidBodyRig.Neck]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.Neck], body[HumanoidBodyRig.Head]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.UpperChest], body[HumanoidBodyRig.LeftShoulder]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.LeftShoulder], body[HumanoidBodyRig.LeftUpperArm]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.LeftUpperArm], body[HumanoidBodyRig.LeftLowerArm]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.LeftLowerArm], body[HumanoidBodyRig.LeftHand]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.UpperChest], body[HumanoidBodyRig.RightShoulder]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.RightShoulder], body[HumanoidBodyRig.RightUpperArm]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.RightUpperArm], body[HumanoidBodyRig.RightLowerArm]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.RightLowerArm], body[HumanoidBodyRig.RightHand]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.Hips], body[HumanoidBodyRig.LeftUpperLeg]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.LeftUpperLeg], body[HumanoidBodyRig.LeftLowerLeg]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.LeftLowerLeg], body[HumanoidBodyRig.LeftFoot]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.LeftFoot], body[HumanoidBodyRig.LeftToes]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.Hips], body[HumanoidBodyRig.RightUpperLeg]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.RightUpperLeg], body[HumanoidBodyRig.RightLowerLeg]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.RightLowerLeg], body[HumanoidBodyRig.RightFoot]) &&
      this.isSameOrAncestor(body[HumanoidBodyRig.RightFoot], body[HumanoidBodyRig.RightToes]) &&
      (!result.leftHand ||
        this.validateHumanoidHandHierarchy(body[HumanoidBodyRig.LeftHand], result.leftHand)) &&
      (!result.rightHand ||
        this.validateHumanoidHandHierarchy(body[HumanoidBodyRig.RightHand], result.rightHand))
    );
  }
  private static createCommonHumanoidHandProfile(
    side: 'left' | 'right'
  ): HumanoidJointProfile<HumanoidHandRig> {
    return {
      [HumanoidHandRig.ThumbProximal]: sideJointPatterns(side, [
        { all: ['thumb', 'proximal'] },
        { all: ['thumb', '1'] },
        { all: ['finger', '0'] }
      ]),
      [HumanoidHandRig.ThumbIntermediate]: sideJointPatterns(side, [
        { all: ['thumb', 'intermediate'] },
        { all: ['thumb', '2'] },
        { all: ['finger', '01'] }
      ]),
      [HumanoidHandRig.ThumbDistal]: sideJointPatterns(side, [
        { all: ['thumb', 'distal'] },
        { all: ['thumb', '3'] },
        { all: ['finger', '02'] }
      ]),
      [HumanoidHandRig.IndexProximal]: sideJointPatterns(side, [
        { all: ['index', 'proximal'] },
        { all: ['index', '1'] },
        { all: ['finger', '1'] }
      ]),
      [HumanoidHandRig.IndexIntermediate]: sideJointPatterns(side, [
        { all: ['index', 'intermediate'] },
        { all: ['index', '2'] },
        { all: ['finger', '11'] }
      ]),
      [HumanoidHandRig.IndexDistal]: sideJointPatterns(side, [
        { all: ['index', 'distal'] },
        { all: ['index', '3'] },
        { all: ['finger', '12'] }
      ]),
      [HumanoidHandRig.MiddleProximal]: sideJointPatterns(side, [
        { all: ['middle', 'proximal'] },
        { all: ['middle', '1'] },
        { all: ['finger', '2'] }
      ]),
      [HumanoidHandRig.MiddleIntermediate]: sideJointPatterns(side, [
        { all: ['middle', 'intermediate'] },
        { all: ['middle', '2'] },
        { all: ['finger', '21'] }
      ]),
      [HumanoidHandRig.MiddleDistal]: sideJointPatterns(side, [
        { all: ['middle', 'distal'] },
        { all: ['middle', '3'] },
        { all: ['finger', '22'] }
      ]),
      [HumanoidHandRig.RingProximal]: sideJointPatterns(side, [
        { all: ['ring', 'proximal'] },
        { all: ['ring', '1'] },
        { all: ['finger', '3'] }
      ]),
      [HumanoidHandRig.RingIntermediate]: sideJointPatterns(side, [
        { all: ['ring', 'intermediate'] },
        { all: ['ring', '2'] },
        { all: ['finger', '31'] }
      ]),
      [HumanoidHandRig.RingDistal]: sideJointPatterns(side, [
        { all: ['ring', 'distal'] },
        { all: ['ring', '3'] },
        { all: ['finger', '32'] }
      ]),
      [HumanoidHandRig.PinkyProximal]: sideJointPatterns(side, [
        { all: ['pinky', 'proximal'] },
        { all: ['pinky', '1'] },
        { all: ['finger', '4'] }
      ]),
      [HumanoidHandRig.PinkyIntermediate]: sideJointPatterns(side, [
        { all: ['pinky', 'intermediate'] },
        { all: ['pinky', '2'] },
        { all: ['finger', '41'] }
      ]),
      [HumanoidHandRig.PinkyDistal]: sideJointPatterns(side, [
        { all: ['pinky', 'distal'] },
        { all: ['pinky', '3'] },
        { all: ['finger', '42'] }
      ])
    };
  }
  private static createStandardHumanoidBodyProfile(): HumanoidJointProfile<HumanoidBodyRig> {
    return {
      [HumanoidBodyRig.Hips]: [jointPattern(['hips']), jointPattern(['pelvis'])],
      [HumanoidBodyRig.Spine]: [jointPattern(['spine'], ['1', '2', '3', 'chest', 'upper'])],
      [HumanoidBodyRig.Chest]: [jointPattern(['chest'], ['upper']), jointPattern(['spine', '1'])],
      [HumanoidBodyRig.UpperChest]: [
        jointPattern(['upper', 'chest']),
        jointPattern(['spine', '2']),
        jointPattern(['spine', '3'])
      ],
      [HumanoidBodyRig.Neck]: [jointPattern(['neck'], ['1', '2'])],
      [HumanoidBodyRig.Head]: [jointPattern(['head'], ['top', 'end', 'nub'])],
      [HumanoidBodyRig.LeftShoulder]: sideJointPatterns('left', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.LeftUpperArm]: sideJointPatterns('left', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder'] }
      ]),
      [HumanoidBodyRig.LeftLowerArm]: sideJointPatterns('left', [
        { all: ['lower', 'arm'], none: ['twist'] },
        { all: ['fore', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftHand]: sideJointPatterns('left', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.RightShoulder]: sideJointPatterns('right', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.RightUpperArm]: sideJointPatterns('right', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder'] }
      ]),
      [HumanoidBodyRig.RightLowerArm]: sideJointPatterns('right', [
        { all: ['lower', 'arm'], none: ['twist'] },
        { all: ['fore', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightHand]: sideJointPatterns('right', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.LeftUpperLeg]: sideJointPatterns('left', [
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.LeftLowerLeg]: sideJointPatterns('left', [
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.LeftFoot]: sideJointPatterns('left', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.LeftToes]: sideJointPatterns('left', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ]),
      [HumanoidBodyRig.RightUpperLeg]: sideJointPatterns('right', [
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.RightLowerLeg]: sideJointPatterns('right', [
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.RightFoot]: sideJointPatterns('right', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.RightToes]: sideJointPatterns('right', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ])
    };
  }
  private static createMixamoHumanoidBodyProfile(): HumanoidJointProfile<HumanoidBodyRig> {
    return {
      [HumanoidBodyRig.Hips]: [jointPattern(['hips'])],
      [HumanoidBodyRig.Spine]: [jointPattern(['spine'], ['1', '2', '3'])],
      [HumanoidBodyRig.Chest]: [jointPattern(['spine', '1']), jointPattern(['chest'], ['upper'])],
      [HumanoidBodyRig.UpperChest]: [
        jointPattern(['spine', '2']),
        jointPattern(['spine', '3']),
        jointPattern(['upper', 'chest'])
      ],
      [HumanoidBodyRig.Neck]: [jointPattern(['neck'], ['1', '2'])],
      [HumanoidBodyRig.Head]: [jointPattern(['head'], ['top', 'end', 'nub'])],
      [HumanoidBodyRig.LeftShoulder]: sideJointPatterns('left', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.LeftUpperArm]: sideJointPatterns('left', [
        { all: ['arm'], none: ['upper', 'fore', 'lower', 'hand', 'twist', 'shoulder'] },
        { all: ['upper', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftLowerArm]: sideJointPatterns('left', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftHand]: sideJointPatterns('left', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.RightShoulder]: sideJointPatterns('right', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.RightUpperArm]: sideJointPatterns('right', [
        { all: ['arm'], none: ['upper', 'fore', 'lower', 'hand', 'twist', 'shoulder'] },
        { all: ['upper', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightLowerArm]: sideJointPatterns('right', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightHand]: sideJointPatterns('right', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.LeftUpperLeg]: sideJointPatterns('left', [
        { all: ['up', 'leg'] },
        { all: ['upper', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.LeftLowerLeg]: sideJointPatterns('left', [
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['lower', 'leg'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.LeftFoot]: sideJointPatterns('left', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.LeftToes]: sideJointPatterns('left', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ]),
      [HumanoidBodyRig.RightUpperLeg]: sideJointPatterns('right', [
        { all: ['up', 'leg'] },
        { all: ['upper', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.RightLowerLeg]: sideJointPatterns('right', [
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['lower', 'leg'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.RightFoot]: sideJointPatterns('right', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.RightToes]: sideJointPatterns('right', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ])
    };
  }
  private static createBipedHumanoidBodyProfile(): HumanoidJointProfile<HumanoidBodyRig> {
    return {
      [HumanoidBodyRig.Hips]: [jointPattern(['pelvis']), jointPattern(['hips'])],
      [HumanoidBodyRig.Spine]: [jointPattern(['spine'], ['1', '2', '3'])],
      [HumanoidBodyRig.Chest]: [jointPattern(['spine', '1']), jointPattern(['chest'], ['upper'])],
      [HumanoidBodyRig.UpperChest]: [
        jointPattern(['spine', '2']),
        jointPattern(['spine', '3']),
        jointPattern(['upper', 'chest'])
      ],
      [HumanoidBodyRig.Neck]: [jointPattern(['neck'], ['1', '2'])],
      [HumanoidBodyRig.Head]: [jointPattern(['head'], ['top', 'end', 'nub'])],
      [HumanoidBodyRig.LeftShoulder]: sideJointPatterns('left', [
        { all: ['clavicle'] },
        { all: ['shoulder'] }
      ]),
      [HumanoidBodyRig.LeftUpperArm]: sideJointPatterns('left', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder', 'clavicle'] }
      ]),
      [HumanoidBodyRig.LeftLowerArm]: sideJointPatterns('left', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftHand]: sideJointPatterns('left', [
        { all: ['hand'], none: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.RightShoulder]: sideJointPatterns('right', [
        { all: ['clavicle'] },
        { all: ['shoulder'] }
      ]),
      [HumanoidBodyRig.RightUpperArm]: sideJointPatterns('right', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder', 'clavicle'] }
      ]),
      [HumanoidBodyRig.RightLowerArm]: sideJointPatterns('right', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightHand]: sideJointPatterns('right', [
        { all: ['hand'], none: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.LeftUpperLeg]: sideJointPatterns('left', [
        { all: ['thigh'] },
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] }
      ]),
      [HumanoidBodyRig.LeftLowerLeg]: sideJointPatterns('left', [
        { all: ['calf'] },
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] }
      ]),
      [HumanoidBodyRig.LeftFoot]: sideJointPatterns('left', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.LeftToes]: sideJointPatterns('left', [
        { all: ['toe', '0'] },
        { all: ['toe'], none: ['end'] },
        { all: ['ball'] }
      ]),
      [HumanoidBodyRig.RightUpperLeg]: sideJointPatterns('right', [
        { all: ['thigh'] },
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] }
      ]),
      [HumanoidBodyRig.RightLowerLeg]: sideJointPatterns('right', [
        { all: ['calf'] },
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] }
      ]),
      [HumanoidBodyRig.RightFoot]: sideJointPatterns('right', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.RightToes]: sideJointPatterns('right', [
        { all: ['toe', '0'] },
        { all: ['toe'], none: ['end'] },
        { all: ['ball'] }
      ])
    };
  }
  private static isParentOf<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    parent: T,
    child: Nullable<T>
  ) {
    while (child && child !== parent) {
      child = child.parent!;
    }
    return child === parent;
  }

  private static iterateNode<T extends { name: string; children: T[] }>(
    root: T,
    callback: (node: T) => boolean
  ) {
    if (callback(root)) {
      return true;
    }
    for (const child of root.children) {
      if (this.iterateNode(child, callback)) {
        return true;
      }
    }
    return false;
  }
  private static tryExtractHumanoidJointsByBodyProfile<
    T extends { name: string; parent: Nullable<T>; children: T[] }
  >(root: T, bodyProfile: HumanoidJointProfile<HumanoidBodyRig>): HumanoidJointMapping<T> | null {
    const nodes = this.collectHumanoidJointNodeInfos(root);
    const used = new Set<T>();
    const bodyCandidates = this.matchHumanoidBodyProfile(
      nodes,
      bodyProfile,
      used,
      new Set<HumanoidBodyRig>([HumanoidBodyRig.Chest, HumanoidBodyRig.UpperChest])
    );
    if (!bodyCandidates) {
      return null;
    }
    const body = this.completeHumanoidBody(bodyCandidates);
    if (!body) {
      return null;
    }
    const leftHand = this.tryExtractOptionalHumanoidHand(nodes, 'left', used);
    const rightHand = this.tryExtractOptionalHumanoidHand(nodes, 'right', used);
    const result: HumanoidJointMapping<T> = {
      body,
      leftHand,
      rightHand
    };
    return this.validateHumanoidJointExtraction(result) ? result : null;
  }
  /**
   * Attempt to extract humanoid joint mappings from the skeleton's joints based on their names.
   *
   * This method looks for joints with names matching the standardized `HumanoidBodyRig` and `HumanoidHandRig` enums.
   * If a complete mapping is found, it returns an object containing the mapped joints for the body and hands.
   * If any required joint is missing, it returns `null`.
   *
   * This method tries to find the best match for humanoid rigs, designed to work with Mixamo, VRoid, Unity Humanoid,
   * Biped, and similar skeletons. It is not guaranteed to work with all models, and may require manual adjustments or
   * custom modifiers for non-standard rigs.
   *
   * @param root - The root scene node to search for humanoid joints.
   * @returns An object containing the mapped body and hand joints if a complete humanoid rig is detected, otherwise `null`.
   */
  static tryExtractHumanoidJoints<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    root: T
  ): HumanoidJointMapping<T> | null {
    return (
      this.tryExtractHumanoidJointsMixamo(root) ??
      this.tryExtractHumanoidJointsVRM(root) ??
      this.tryExtractHumanoidJointsUnityHumanoid(root) ??
      this.tryExtractHumanoidJointsBiped(root)
    );
  }
  static tryExtractHumanoidJointsMixamo<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    root: T
  ): HumanoidJointMapping<T> | null {
    return this.tryExtractHumanoidJointsByBodyProfile(root, this.createMixamoHumanoidBodyProfile());
  }
  static tryExtractHumanoidJointsVRM<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    root: T
  ): HumanoidJointMapping<T> | null {
    return this.tryExtractHumanoidJointsByBodyProfile(root, this.createStandardHumanoidBodyProfile());
  }
  static tryExtractHumanoidJointsUnityHumanoid<
    T extends { name: string; parent: Nullable<T>; children: T[] }
  >(root: T): HumanoidJointMapping<T> | null {
    return this.tryExtractHumanoidJointsByBodyProfile(root, this.createStandardHumanoidBodyProfile());
  }
  static tryExtractHumanoidJointsBiped<T extends { name: string; parent: Nullable<T>; children: T[] }>(
    root: T
  ): HumanoidJointMapping<T> | null {
    return this.tryExtractHumanoidJointsByBodyProfile(root, this.createBipedHumanoidBodyProfile());
  }
}

/**
 * Legacy compatibility name for a skin binding.
 *
 * New code should use {@link SkeletonRig} for the shared animated rig and
 * {@link SkinBinding} for per-skin inverse bind matrices.
 *
 * @public
 */
export class Skeleton extends SkinBinding {
  constructor(joints: SceneNode[], inverseBindMatrices: Matrix4x4[], bindPose: SkeletonBindPose[]) {
    super(new SkeletonRig(joints, bindPose), inverseBindMatrices, joints);
  }

  static tryExtractHumanoidJoints = SkinBinding.tryExtractHumanoidJoints;
  static tryExtractHumanoidJointsMixamo = SkinBinding.tryExtractHumanoidJointsMixamo;
  static tryExtractHumanoidJointsVRM = SkinBinding.tryExtractHumanoidJointsVRM;
  static tryExtractHumanoidJointsUnityHumanoid = SkinBinding.tryExtractHumanoidJointsUnityHumanoid;
  static tryExtractHumanoidJointsBiped = SkinBinding.tryExtractHumanoidJointsBiped;
  static findSkeletonById(id: string) {
    return SkinBinding.findSkinBindingById(id);
  }
}
