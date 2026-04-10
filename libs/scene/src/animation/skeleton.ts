import { DRef, randomUUID, DWeakRef } from '@zephyr3d/base';
import type { Nullable, Quaternion, TypedArray } from '@zephyr3d/base';
import { Disposable, Matrix4x4, Vector3, nextPowerOf2 } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneNode } from '../scene/scene_node';
import { BoundingBox } from '../utility/bounding_volume';
import { getDevice } from '../app/api';
import type { SkeletonModifier } from './skeleton_modifier';

/**
 * Standardized humanoid bone names for consistent skeleton mapping across models and animations.
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
 * Standardized humanoid hand bone names for consistent skeleton mapping across models and animations.
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

type HumanoidBoneExtraction = {
  body: Record<HumanoidBodyRig, SceneNode>;
  leftHand?: Record<HumanoidHandRig, SceneNode>;
  rightHand?: Record<HumanoidHandRig, SceneNode>;
};

type HumanoidBonePattern = {
  all?: string[];
  any?: string[];
  none?: string[];
};

type HumanoidBoneProfile<T extends string> = Record<T, HumanoidBonePattern[]>;

type HumanoidBoneNodeInfo = {
  node: SceneNode;
  depth: number;
  tokens: string[];
  tokenSet: Set<string>;
};

function bonePattern(all: string[], none?: string[], any?: string[]): HumanoidBonePattern {
  return {
    all,
    any: any?.length ? any : undefined,
    none: none?.length ? none : undefined
  };
}

function sideBonePatterns(
  side: 'left' | 'right',
  patterns: Array<{ all: string[]; none?: string[]; any?: string[] }>
): HumanoidBonePattern[] {
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
  protected _bindPoseModelSpace: Matrix4x4[];
  /** @internal */
  protected _bindPose: { rotation: Quaternion; scale: Vector3; position: Vector3 }[];
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
  protected _modifiers: SkeletonModifier[];
  /** @internal */
  protected _lastUpdateTime: number;
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
    bindPose: { rotation: Quaternion; scale: Vector3; position: Vector3 }[]
  ) {
    super();
    this._id = randomUUID();
    this._joints = joints;
    this._inverseBindMatrices = inverseBindMatrices;
    this._bindPose = bindPose;
    this._jointTexture = new DRef();
    this._playing = false;
    this._modifiers = [];
    this._lastUpdateTime = 0;
    this._bindPoseModelSpace = [];
    this.computeBindPose();
    this.updateJointMatrices(0);
    let skeletonRoot = this.findRootJoint(this._joints);
    if (!skeletonRoot || !this._joints.includes(skeletonRoot)) {
      throw new Error('Skeleton root must be included in the joint list');
    }
    const humanoid = Skeleton.tryExtractHumanoidBones(skeletonRoot);
    console.log(humanoid);
    while (skeletonRoot.parent && this._joints.includes(skeletonRoot.parent)) {
      skeletonRoot = skeletonRoot.parent;
    }
    const im = skeletonRoot.parent!.invWorldMatrix;
    for (const joint of this._joints) {
      const m = Matrix4x4.multiplyAffine(im, joint.worldMatrix);
      this._bindPoseModelSpace.push(m);
    }
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
  get inverseBindMatrices() {
    return this._inverseBindMatrices;
  }
  /** @internal */
  get bindPose() {
    return this._bindPose;
  }
  get bindPoseModelSpace() {
    return this._bindPoseModelSpace;
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
  updateJointMatrices(deltaTime: number) {
    this.applyModifiers(deltaTime);
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
      Matrix4x4.multiply(
        this._joints[i].worldMatrix,
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
    for (let i = 0; i < this._joints.length; i++) {
      const joint = this._joints[i];
      const bindpose = this._bindPose[i];
      joint.position.set(bindpose.position);
      joint.rotation.set(bindpose.rotation);
      joint.scale.set(bindpose.scale);
    }
  }
  /**
   * Compute current joint matrices from the nodes and upload them to the joint texture.
   *
   * @internal
   */
  apply(deltaTime: number) {
    this.updateJointMatrices(deltaTime);
    const tex = this.jointTexture;
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
    for (const modifier of this._modifiers) {
      modifier.apply(this, deltaTime);
    }
  }
  /**
   * Get all modifiers attached to this skeleton.
   *
   * @public
   */
  get modifiers(): SkeletonModifier[] {
    return this._modifiers;
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
   */
  getBoundingInfo(data: { positions: Float32Array; blendIndices: TypedArray; weights: TypedArray }) {
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
  private static normalizeHumanoidBoneName(name: string) {
    return name
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
  private static getHumanoidBoneNodeDepth(root: SceneNode, node: SceneNode) {
    let depth = 0;
    let current: Nullable<SceneNode> = node;
    while (current && current !== root) {
      depth++;
      current = current.parent;
    }
    return depth;
  }
  private static collectHumanoidBoneNodeInfos(root: SceneNode): HumanoidBoneNodeInfo[] {
    const nodes: HumanoidBoneNodeInfo[] = [];
    root.iterate((node) => {
      const normalizedName = this.normalizeHumanoidBoneName(node.name || '');
      if (!normalizedName) {
        return false;
      }
      const tokens = normalizedName.split(' ').filter(Boolean);
      if (!tokens.length) {
        return false;
      }
      nodes.push({
        node,
        depth: this.getHumanoidBoneNodeDepth(root, node),
        tokens,
        tokenSet: new Set(tokens)
      });
      return false;
    });
    return nodes;
  }
  private static matchesHumanoidBonePattern(info: HumanoidBoneNodeInfo, pattern: HumanoidBonePattern) {
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
  private static scoreHumanoidBonePattern(
    info: HumanoidBoneNodeInfo,
    pattern: HumanoidBonePattern,
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
  private static findBestHumanoidBone(
    nodes: HumanoidBoneNodeInfo[],
    patterns: HumanoidBonePattern[],
    used: Set<SceneNode>
  ) {
    let bestNode: Nullable<SceneNode> = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < patterns.length; index++) {
      const pattern = patterns[index];
      const priority = patterns.length - index;
      for (const info of nodes) {
        if (used.has(info.node) || !this.matchesHumanoidBonePattern(info, pattern)) {
          continue;
        }
        const score = this.scoreHumanoidBonePattern(info, pattern, priority);
        if (score > bestScore) {
          bestScore = score;
          bestNode = info.node;
        }
      }
    }
    return bestNode;
  }
  private static matchHumanoidBoneProfile<T extends string>(
    nodes: HumanoidBoneNodeInfo[],
    profile: HumanoidBoneProfile<T>,
    used: Set<SceneNode>,
    optional?: Set<T>
  ): Partial<Record<T, SceneNode>> | null {
    const result = {} as Partial<Record<T, SceneNode>>;
    const reserved = new Set<SceneNode>();
    for (const bone of Object.keys(profile) as T[]) {
      const node = this.findBestHumanoidBone(
        nodes,
        profile[bone],
        new Set<SceneNode>([...used, ...reserved])
      );
      if (!node) {
        if (optional?.has(bone)) {
          continue;
        }
        return null;
      }
      result[bone] = node;
      reserved.add(node);
    }
    for (const node of reserved) {
      used.add(node);
    }
    return result;
  }
  private static getHumanoidIntermediateChain(ancestor: SceneNode, descendant: SceneNode) {
    if (!this.isSameOrAncestor(ancestor, descendant)) {
      return null;
    }
    const chain: SceneNode[] = [];
    let current = descendant.parent;
    while (current && current !== ancestor) {
      chain.unshift(current);
      current = current.parent;
    }
    return chain;
  }
  private static completeHumanoidBody(
    body: Partial<Record<HumanoidBodyRig, SceneNode>>
  ): Record<HumanoidBodyRig, SceneNode> | null {
    const requiredBones = [
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
    for (const bone of requiredBones) {
      if (!body[bone]) {
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
  private static completeHumanoidHand(
    hand: Partial<Record<HumanoidHandRig, SceneNode>>
  ): Record<HumanoidHandRig, SceneNode> | null {
    for (const bone of Object.values(HumanoidHandRig)) {
      if (!hand[bone]) {
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
  private static tryExtractOptionalHumanoidHand(
    nodes: HumanoidBoneNodeInfo[],
    side: 'left' | 'right',
    used: Set<SceneNode>
  ): Record<HumanoidHandRig, SceneNode> | undefined {
    const handCandidates = this.matchHumanoidBoneProfile(
      nodes,
      this.createCommonHumanoidHandProfile(side),
      used
    );
    if (!handCandidates) {
      return undefined;
    }
    return this.completeHumanoidHand(handCandidates) ?? undefined;
  }
  private static isSameOrAncestor(parent: SceneNode, child: SceneNode) {
    return parent === child || parent.isParentOf(child);
  }
  private static validateHumanoidHandHierarchy(hand: SceneNode, bones: Record<HumanoidHandRig, SceneNode>) {
    const chains: [HumanoidHandRig, HumanoidHandRig, HumanoidHandRig][] = [
      [HumanoidHandRig.ThumbProximal, HumanoidHandRig.ThumbIntermediate, HumanoidHandRig.ThumbDistal],
      [HumanoidHandRig.IndexProximal, HumanoidHandRig.IndexIntermediate, HumanoidHandRig.IndexDistal],
      [HumanoidHandRig.MiddleProximal, HumanoidHandRig.MiddleIntermediate, HumanoidHandRig.MiddleDistal],
      [HumanoidHandRig.RingProximal, HumanoidHandRig.RingIntermediate, HumanoidHandRig.RingDistal],
      [HumanoidHandRig.PinkyProximal, HumanoidHandRig.PinkyIntermediate, HumanoidHandRig.PinkyDistal]
    ];
    return chains.every(
      ([proximal, intermediate, distal]) =>
        this.isSameOrAncestor(hand, bones[proximal]) &&
        this.isSameOrAncestor(bones[proximal], bones[intermediate]) &&
        this.isSameOrAncestor(bones[intermediate], bones[distal])
    );
  }
  private static validateHumanoidBoneExtraction(result: HumanoidBoneExtraction) {
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
  ): HumanoidBoneProfile<HumanoidHandRig> {
    return {
      [HumanoidHandRig.ThumbProximal]: sideBonePatterns(side, [
        { all: ['thumb', 'proximal'] },
        { all: ['thumb', '1'] },
        { all: ['finger', '0'] }
      ]),
      [HumanoidHandRig.ThumbIntermediate]: sideBonePatterns(side, [
        { all: ['thumb', 'intermediate'] },
        { all: ['thumb', '2'] },
        { all: ['finger', '01'] }
      ]),
      [HumanoidHandRig.ThumbDistal]: sideBonePatterns(side, [
        { all: ['thumb', 'distal'] },
        { all: ['thumb', '3'] },
        { all: ['finger', '02'] }
      ]),
      [HumanoidHandRig.IndexProximal]: sideBonePatterns(side, [
        { all: ['index', 'proximal'] },
        { all: ['index', '1'] },
        { all: ['finger', '1'] }
      ]),
      [HumanoidHandRig.IndexIntermediate]: sideBonePatterns(side, [
        { all: ['index', 'intermediate'] },
        { all: ['index', '2'] },
        { all: ['finger', '11'] }
      ]),
      [HumanoidHandRig.IndexDistal]: sideBonePatterns(side, [
        { all: ['index', 'distal'] },
        { all: ['index', '3'] },
        { all: ['finger', '12'] }
      ]),
      [HumanoidHandRig.MiddleProximal]: sideBonePatterns(side, [
        { all: ['middle', 'proximal'] },
        { all: ['middle', '1'] },
        { all: ['finger', '2'] }
      ]),
      [HumanoidHandRig.MiddleIntermediate]: sideBonePatterns(side, [
        { all: ['middle', 'intermediate'] },
        { all: ['middle', '2'] },
        { all: ['finger', '21'] }
      ]),
      [HumanoidHandRig.MiddleDistal]: sideBonePatterns(side, [
        { all: ['middle', 'distal'] },
        { all: ['middle', '3'] },
        { all: ['finger', '22'] }
      ]),
      [HumanoidHandRig.RingProximal]: sideBonePatterns(side, [
        { all: ['ring', 'proximal'] },
        { all: ['ring', '1'] },
        { all: ['finger', '3'] }
      ]),
      [HumanoidHandRig.RingIntermediate]: sideBonePatterns(side, [
        { all: ['ring', 'intermediate'] },
        { all: ['ring', '2'] },
        { all: ['finger', '31'] }
      ]),
      [HumanoidHandRig.RingDistal]: sideBonePatterns(side, [
        { all: ['ring', 'distal'] },
        { all: ['ring', '3'] },
        { all: ['finger', '32'] }
      ]),
      [HumanoidHandRig.PinkyProximal]: sideBonePatterns(side, [
        { all: ['pinky', 'proximal'] },
        { all: ['pinky', '1'] },
        { all: ['finger', '4'] }
      ]),
      [HumanoidHandRig.PinkyIntermediate]: sideBonePatterns(side, [
        { all: ['pinky', 'intermediate'] },
        { all: ['pinky', '2'] },
        { all: ['finger', '41'] }
      ]),
      [HumanoidHandRig.PinkyDistal]: sideBonePatterns(side, [
        { all: ['pinky', 'distal'] },
        { all: ['pinky', '3'] },
        { all: ['finger', '42'] }
      ])
    };
  }
  private static createStandardHumanoidBodyProfile(): HumanoidBoneProfile<HumanoidBodyRig> {
    return {
      [HumanoidBodyRig.Hips]: [bonePattern(['hips']), bonePattern(['pelvis'])],
      [HumanoidBodyRig.Spine]: [bonePattern(['spine'], ['1', '2', '3', 'chest', 'upper'])],
      [HumanoidBodyRig.Chest]: [bonePattern(['chest'], ['upper']), bonePattern(['spine', '1'])],
      [HumanoidBodyRig.UpperChest]: [
        bonePattern(['upper', 'chest']),
        bonePattern(['spine', '2']),
        bonePattern(['spine', '3'])
      ],
      [HumanoidBodyRig.Neck]: [bonePattern(['neck'], ['1', '2'])],
      [HumanoidBodyRig.Head]: [bonePattern(['head'], ['top', 'end', 'nub'])],
      [HumanoidBodyRig.LeftShoulder]: sideBonePatterns('left', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.LeftUpperArm]: sideBonePatterns('left', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder'] }
      ]),
      [HumanoidBodyRig.LeftLowerArm]: sideBonePatterns('left', [
        { all: ['lower', 'arm'], none: ['twist'] },
        { all: ['fore', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftHand]: sideBonePatterns('left', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.RightShoulder]: sideBonePatterns('right', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.RightUpperArm]: sideBonePatterns('right', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder'] }
      ]),
      [HumanoidBodyRig.RightLowerArm]: sideBonePatterns('right', [
        { all: ['lower', 'arm'], none: ['twist'] },
        { all: ['fore', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightHand]: sideBonePatterns('right', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.LeftUpperLeg]: sideBonePatterns('left', [
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.LeftLowerLeg]: sideBonePatterns('left', [
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.LeftFoot]: sideBonePatterns('left', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.LeftToes]: sideBonePatterns('left', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ]),
      [HumanoidBodyRig.RightUpperLeg]: sideBonePatterns('right', [
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.RightLowerLeg]: sideBonePatterns('right', [
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.RightFoot]: sideBonePatterns('right', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.RightToes]: sideBonePatterns('right', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ])
    };
  }
  private static createMixamoHumanoidBodyProfile(): HumanoidBoneProfile<HumanoidBodyRig> {
    return {
      [HumanoidBodyRig.Hips]: [bonePattern(['hips'])],
      [HumanoidBodyRig.Spine]: [bonePattern(['spine'], ['1', '2', '3'])],
      [HumanoidBodyRig.Chest]: [bonePattern(['spine', '1']), bonePattern(['chest'], ['upper'])],
      [HumanoidBodyRig.UpperChest]: [
        bonePattern(['spine', '2']),
        bonePattern(['spine', '3']),
        bonePattern(['upper', 'chest'])
      ],
      [HumanoidBodyRig.Neck]: [bonePattern(['neck'], ['1', '2'])],
      [HumanoidBodyRig.Head]: [bonePattern(['head'], ['top', 'end', 'nub'])],
      [HumanoidBodyRig.LeftShoulder]: sideBonePatterns('left', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.LeftUpperArm]: sideBonePatterns('left', [
        { all: ['arm'], none: ['upper', 'fore', 'lower', 'hand', 'twist', 'shoulder'] },
        { all: ['upper', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftLowerArm]: sideBonePatterns('left', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftHand]: sideBonePatterns('left', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.RightShoulder]: sideBonePatterns('right', [
        { all: ['shoulder'] },
        { all: ['clavicle'] }
      ]),
      [HumanoidBodyRig.RightUpperArm]: sideBonePatterns('right', [
        { all: ['arm'], none: ['upper', 'fore', 'lower', 'hand', 'twist', 'shoulder'] },
        { all: ['upper', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightLowerArm]: sideBonePatterns('right', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightHand]: sideBonePatterns('right', [
        { all: ['hand'], none: ['thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.LeftUpperLeg]: sideBonePatterns('left', [
        { all: ['up', 'leg'] },
        { all: ['upper', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.LeftLowerLeg]: sideBonePatterns('left', [
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['lower', 'leg'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.LeftFoot]: sideBonePatterns('left', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.LeftToes]: sideBonePatterns('left', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ]),
      [HumanoidBodyRig.RightUpperLeg]: sideBonePatterns('right', [
        { all: ['up', 'leg'] },
        { all: ['upper', 'leg'] },
        { all: ['thigh'] }
      ]),
      [HumanoidBodyRig.RightLowerLeg]: sideBonePatterns('right', [
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] },
        { all: ['lower', 'leg'] },
        { all: ['calf'] },
        { all: ['shin'] }
      ]),
      [HumanoidBodyRig.RightFoot]: sideBonePatterns('right', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.RightToes]: sideBonePatterns('right', [
        { all: ['toe', 'base'] },
        { all: ['toe'], none: ['end'] }
      ])
    };
  }
  private static createBipedHumanoidBodyProfile(): HumanoidBoneProfile<HumanoidBodyRig> {
    return {
      [HumanoidBodyRig.Hips]: [bonePattern(['pelvis']), bonePattern(['hips'])],
      [HumanoidBodyRig.Spine]: [bonePattern(['spine'], ['1', '2', '3'])],
      [HumanoidBodyRig.Chest]: [bonePattern(['spine', '1']), bonePattern(['chest'], ['upper'])],
      [HumanoidBodyRig.UpperChest]: [
        bonePattern(['spine', '2']),
        bonePattern(['spine', '3']),
        bonePattern(['upper', 'chest'])
      ],
      [HumanoidBodyRig.Neck]: [bonePattern(['neck'], ['1', '2'])],
      [HumanoidBodyRig.Head]: [bonePattern(['head'], ['top', 'end', 'nub'])],
      [HumanoidBodyRig.LeftShoulder]: sideBonePatterns('left', [
        { all: ['clavicle'] },
        { all: ['shoulder'] }
      ]),
      [HumanoidBodyRig.LeftUpperArm]: sideBonePatterns('left', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder', 'clavicle'] }
      ]),
      [HumanoidBodyRig.LeftLowerArm]: sideBonePatterns('left', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.LeftHand]: sideBonePatterns('left', [
        { all: ['hand'], none: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.RightShoulder]: sideBonePatterns('right', [
        { all: ['clavicle'] },
        { all: ['shoulder'] }
      ]),
      [HumanoidBodyRig.RightUpperArm]: sideBonePatterns('right', [
        { all: ['upper', 'arm'], none: ['twist'] },
        { all: ['arm'], none: ['fore', 'lower', 'hand', 'twist', 'shoulder', 'clavicle'] }
      ]),
      [HumanoidBodyRig.RightLowerArm]: sideBonePatterns('right', [
        { all: ['fore', 'arm'], none: ['twist'] },
        { all: ['lower', 'arm'], none: ['twist'] }
      ]),
      [HumanoidBodyRig.RightHand]: sideBonePatterns('right', [
        { all: ['hand'], none: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky'] }
      ]),
      [HumanoidBodyRig.LeftUpperLeg]: sideBonePatterns('left', [
        { all: ['thigh'] },
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] }
      ]),
      [HumanoidBodyRig.LeftLowerLeg]: sideBonePatterns('left', [
        { all: ['calf'] },
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] }
      ]),
      [HumanoidBodyRig.LeftFoot]: sideBonePatterns('left', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.LeftToes]: sideBonePatterns('left', [
        { all: ['toe', '0'] },
        { all: ['toe'], none: ['end'] }
      ]),
      [HumanoidBodyRig.RightUpperLeg]: sideBonePatterns('right', [
        { all: ['thigh'] },
        { all: ['upper', 'leg'] },
        { all: ['up', 'leg'] }
      ]),
      [HumanoidBodyRig.RightLowerLeg]: sideBonePatterns('right', [
        { all: ['calf'] },
        { all: ['lower', 'leg'] },
        { all: ['leg'], none: ['upper', 'up', 'thigh', 'foot', 'toe'] }
      ]),
      [HumanoidBodyRig.RightFoot]: sideBonePatterns('right', [{ all: ['foot'], none: ['toe'] }]),
      [HumanoidBodyRig.RightToes]: sideBonePatterns('right', [
        { all: ['toe', '0'] },
        { all: ['toe'], none: ['end'] }
      ])
    };
  }
  private static tryExtractHumanoidBonesByBodyProfile(
    root: SceneNode,
    bodyProfile: HumanoidBoneProfile<HumanoidBodyRig>
  ): HumanoidBoneExtraction | null {
    const nodes = this.collectHumanoidBoneNodeInfos(root);
    const used = new Set<SceneNode>();
    const bodyCandidates = this.matchHumanoidBoneProfile(
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
    const result: HumanoidBoneExtraction = {
      body,
      leftHand,
      rightHand
    };
    return this.validateHumanoidBoneExtraction(result) ? result : null;
  }
  /**
   * Attempt to extract humanoid bone mappings from the skeleton's joints based on their names.
   *
   * This method looks for joints with names matching the standardized `HumanoidBodyRig` and `HumanoidHandRig` enums.
   * If a complete mapping is found, it returns an object containing the mapped joints for the body and hands.
   * If any required joint is missing, it returns `null`.
   *
   * This method tries to find the best match for humanoid rigs, designed to work with Mixamo, VRoid, Unity Humanoid,
   * Biped, and similar skeletons. It is not guaranteed to work with all models, and may require manual adjustments or
   * custom modifiers for non-standard rigs.
   *
   * @param root - The root scene node to search for humanoid bones.
   * @returns An object containing the mapped body and hand joints if a complete humanoid rig is detected, otherwise `null`.
   */
  static tryExtractHumanoidBones(root: SceneNode): HumanoidBoneExtraction | null {
    return (
      this.tryExtractHumanoidBonesMixamo(root) ??
      this.tryExtractHumanoidBonesVRM(root) ??
      this.tryExtractHumanoidBonesUnityHumanoid(root) ??
      this.tryExtractHumanoidBonesBiped(root)
    );
  }
  static tryExtractHumanoidBonesMixamo(root: SceneNode): HumanoidBoneExtraction | null {
    return this.tryExtractHumanoidBonesByBodyProfile(root, this.createMixamoHumanoidBodyProfile());
  }
  static tryExtractHumanoidBonesVRM(root: SceneNode): HumanoidBoneExtraction | null {
    return this.tryExtractHumanoidBonesByBodyProfile(root, this.createStandardHumanoidBodyProfile());
  }
  static tryExtractHumanoidBonesUnityHumanoid(root: SceneNode): HumanoidBoneExtraction | null {
    return this.tryExtractHumanoidBonesByBodyProfile(root, this.createStandardHumanoidBodyProfile());
  }
  static tryExtractHumanoidBonesBiped(root: SceneNode): HumanoidBoneExtraction | null {
    return this.tryExtractHumanoidBonesByBodyProfile(root, this.createBipedHumanoidBodyProfile());
  }
}
