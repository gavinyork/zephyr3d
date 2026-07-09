import type { TypedArray, Interpolator, Nullable, DeepPartial, VFS } from '@zephyr3d/base';
import {
  ASSERT,
  DRef,
  PathUtils,
  uint8ArrayToBase64,
  Vector4,
  Disposable,
  Matrix4x4,
  Quaternion,
  Vector3
} from '@zephyr3d/base';
import type {
  PrimitiveType,
  Texture2D,
  TextureAddressMode,
  TextureFilterMode,
  TextureSampler,
  VertexAttribFormat,
  VertexSemantic
} from '@zephyr3d/device';
import { getVertexFormatComponentCount } from '@zephyr3d/device';
import { Mesh, type MorphSourceDescriptor, type MorphTargetSourceData } from '../scene/mesh';
import { BoundingBox } from '../utility/bounding_volume';
import type { ColliderR } from '../animation/joint_dynamics/types';
import type { ControllerConfig } from '../animation/joint_dynamics/controller';
import type { ResourceManager } from '../utility/serialization/manager';
import type { Scene } from '../scene/scene';
import {
  SceneNode,
  setSceneMeshAssetBinding,
  type SceneMorphTargetBinding,
  type SceneMorphTargetGroup
} from '../scene/scene_node';
import { SkeletonRig, SkinBinding } from '../animation/skeleton';
import type { FixedGeometryCacheFrame } from '../animation/fixed_geometry_cache_track';
import type { PCAGeometryCacheTrackData } from '../animation';
import {
  FixedGeometryCacheTrack,
  createTransformAccess,
  JointDynamicsModifier,
  JointDynamicsSystem,
  MorphTargetTrack,
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack,
  PCAGeometryCacheTrack
} from '../animation';
import { getMorphTargetLimit, getSkinInfluenceLimit, MAX_MORPH_ATTRIBUTES, MAX_MORPH_TARGETS } from '../values';
import { getDevice } from '../app/api';
import { Primitive } from '../render/primitive';
import type { MeshMaterial } from '../material/meshmaterial';
import { UnlitMaterial } from '../material/unlit';
import { PBRSpecularGlossinessMaterial } from '../material/pbrsg';
import { PBRMetallicRoughnessMaterial } from '../material/pbrmr';

type ReimportResourcePools = Map<string, Set<string>>;

/**
 * Named object interface for model loading
 * @public
 */
export class NamedObject {
  name: string;
  /**
   * Creates an instance of NamedObject
   * @param name - Name of the object
   */
  constructor(name: string) {
    this.name = name;
  }
}

function normalizeAssetNodePath(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

function getSkinBindingKey(rig: SkeletonRig, joints: SceneNode[], inverseBindMatrices: Matrix4x4[]) {
  const matrixKey = inverseBindMatrices
    .map((matrix) => {
      const elements: number[] = [];
      for (let i = 0; i < 16; i++) {
        elements.push(matrix[i]);
      }
      return elements.join(',');
    })
    .join('|');
  return `${rig.persistentId}|${joints.map((joint) => joint.persistentId).join('|')}|${matrixKey}`;
}

function getAssetNodePath(node: Nullable<AssetHierarchyNode>) {
  const segments: string[] = [];
  let current = node;
  while (current) {
    if (current.name) {
      segments.push(current.name);
    }
    current = current.parent;
  }
  return normalizeAssetNodePath(segments.reverse().join('/'));
}

/**
 * Texture sampler settings for model loading.
 * @public
 */
export interface AssetSamplerInfo {
  wrapS: TextureAddressMode;
  wrapT: TextureAddressMode;
  magFilter: TextureFilterMode;
  mipFilter: TextureFilterMode;
  minFilter: TextureFilterMode;
}

/**
 * Image payload information for model loading.
 * @public
 */
export interface AssetImageInfo {
  name?: string;
  uri?: string;
  data?: Uint8Array<ArrayBuffer>;
  mimeType?: string;
}

/**
 * Vertex buffer payload information for model loading.
 * @public
 */
export interface AssetVertexBufferInfo {
  attrib: VertexAttribFormat;
  data: TypedArray;
}

/**
 * Primitive geometry information for model loading.
 * @public
 */
export interface AssetPrimitiveInfo {
  name?: string;
  vertices: Record<VertexSemantic, { format: VertexAttribFormat; data: TypedArray }>;
  indices: Nullable<Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>>;
  indexCount: number;
  type: PrimitiveType;
  boxMin: Vector3;
  boxMax: Vector3;
  path?: string;
}

/**
 * Texture information for model loading
 * @public
 */
export interface AssetTextureInfo {
  name?: string;
  image: Nullable<AssetImageInfo>;
  sRGB?: boolean;
  sampler: Nullable<AssetSamplerInfo>;
  texCoord: number;
  transform: Nullable<Matrix4x4>;
}

/**
 * Resolved material texture information.
 * @public
 */
export interface MaterialTextureInfo {
  texture: Texture2D;
  sampler: TextureSampler;
  texCoord: number;
  transform: Matrix4x4;
}

/**
 * Common properties of material for model loading
 * @public
 */
export interface AssetMaterialCommon {
  vertexColor?: boolean;
  vertexNormal?: boolean;
  useTangent?: boolean;
  alphaMode?: 'blend' | 'mask';
  alphaCutoff?: number;
  doubleSided?: boolean;
  normalMap?: AssetTextureInfo;
  bumpScale?: number;
  emissiveMap?: AssetTextureInfo;
  emissiveColor?: Vector3;
  emissiveStrength?: number;
  occlusionMap?: AssetTextureInfo;
  occlusionStrength?: number;
}

/**
 * Base material properties for model loading
 * @public
 */
export interface AssetMaterial {
  name?: string;
  type: string;
  common: AssetMaterialCommon;
  path?: string;
  material?: DRef<MeshMaterial>;
}

/**
 * Unlit related material properties for model loading
 * @public
 */
export interface AssetUnlitMaterial extends AssetMaterial {
  diffuseMap?: AssetTextureInfo;
  diffuse?: Vector4;
}

/**
 * Sheen related material properties for model loading
 * @public
 */
export interface AssetMaterialSheen {
  sheenColorFactor?: Vector3;
  sheenColorMap?: AssetTextureInfo;
  sheenRoughnessFactor?: number;
  sheenRoughnessMap?: AssetTextureInfo;
}

/**
 * Clearcoat related material properties for model loading
 * @public
 */
export interface AssetMaterialClearcoat {
  clearCoatFactor?: number;
  clearCoatIntensityMap?: AssetTextureInfo;
  clearCoatRoughnessFactor?: number;
  clearCoatRoughnessMap?: AssetTextureInfo;
  clearCoatNormalMap?: AssetTextureInfo;
}

/**
 * Transmission related material properties for model loading
 * @public
 */
export interface AssetMaterialTransmission {
  transmissionFactor?: number;
  transmissionMap?: AssetTextureInfo;
  thicknessFactor?: number;
  thicknessMap?: AssetTextureInfo;
  attenuationColor?: Vector3;
  attenuationDistance?: number;
}

/**
 * Iridescence related material properties for model loading
 * @public
 */
export interface AssetMaterialIridescence {
  iridescenceFactor?: number;
  iridescenceMap?: AssetTextureInfo;
  iridescenceIor?: number;
  iridescenceThicknessMinimum?: number;
  iridescenceThicknessMaximum?: number;
  iridescenceThicknessMap?: AssetTextureInfo;
}

/**
 * PBR related material properties for model loading
 * @public
 */
export interface AssetPBRMaterialCommon extends AssetUnlitMaterial {
  ior?: number;
}

/**
 * PBR of Metallic-Roughness workflow related material properties for model loading
 * @public
 */
export interface AssetPBRMaterialMR extends AssetPBRMaterialCommon {
  metallic?: number;
  roughness?: number;
  metallicMap?: AssetTextureInfo;
  metallicIndex?: number;
  roughnessIndex?: number;
  specularMap?: AssetTextureInfo;
  specularColorMap?: AssetTextureInfo;
  specularFactor?: Vector4;
  sheen?: AssetMaterialSheen;
  clearcoat?: AssetMaterialClearcoat;
  transmission?: AssetMaterialTransmission;
  iridescence?: AssetMaterialIridescence;
}

/**
 * PBR of Specular-Glossness workfow related material properties for model loading
 * @public
 */
export interface AssetPBRMaterialSG extends AssetPBRMaterialCommon {
  specular?: Vector3;
  glossness?: number;
  specularGlossnessMap?: AssetTextureInfo;
}

/**
 * Sub mesh data interface for model loading
 * @public
 */
export interface AssetSubMeshData {
  primitive: Nullable<AssetPrimitiveInfo>;
  material: Nullable<AssetMaterial>;
  rawPositions: Nullable<Float32Array>;
  rawBlendIndices: Nullable<TypedArray>;
  rawJointWeights: Nullable<TypedArray>;
  rawSkinInfluenceCount?: number;
  name: string;
  numTargets: number;
  targets?: Partial<Record<number, { numComponents: number; data: Float32Array[]; indices?: Uint32Array[] }>>;
  targetBox?: BoundingBox[];
  morphAttribCount?: number;
}

/**
 * Mesh data interface for model loading
 * @public
 */
export interface AssetMeshData {
  morphWeights?: number[];
  morphNames?: string[];
  subMeshes: AssetSubMeshData[];
}

/**
 * Morph target binding in a model-level expression/group.
 * @public
 */
export interface AssetMorphTargetBinding {
  /** Restrict this binding to runtime meshes created from this asset node. */
  node?: AssetHierarchyNode;
  /** Restrict this binding to runtime meshes created from this asset mesh. */
  mesh?: AssetMeshData;
  /** Morph target index in the source mesh. */
  targetIndex?: number;
  /** Morph target name in the source mesh. */
  targetName?: string;
  /** Weight contributed by this binding when the group weight is 1. */
  weight: number;
}

/**
 * Model-level morph target group, commonly used as a complete facial expression.
 * @public
 */
export interface AssetMorphTargetGroup {
  name: string;
  bindings: AssetMorphTargetBinding[];
  isBinary?: boolean;
}

/**
 * Animation track interface for model loading
 * @public
 */
export interface AssetAnimationTrack {
  node: AssetHierarchyNode;
  type: 'translation' | 'scale' | 'rotation' | 'weights';
  interpolator: Interpolator;
  defaultMorphWeights?: number[];
}

/**
 * A single geometry cache frame.
 * @public
 */
export interface AssetGeometryCacheFrame {
  positions: Float32Array;
  normals?: Nullable<Float32Array>;
  boundingBox: BoundingBox;
}

/**
 * Fixed-vertex geometry cache animation track information.
 * @public
 */
export interface AssetFixedGeometryCacheAnimationTrack {
  node: AssetHierarchyNode;
  type: 'geometry-cache';
  codec?: 'fixed';
  subMeshIndex: number;
  times: Float32Array;
  frames: AssetGeometryCacheFrame[];
}

/**
 * PCA-compressed geometry cache animation track information.
 * @public
 */
export interface AssetPCAGeometryCacheAnimationTrack {
  node: AssetHierarchyNode;
  type: 'geometry-cache';
  codec: 'pca';
  subMeshIndex: number;
  times: Float32Array;
  bounds: [number, number, number, number, number, number][];
  positionReference?: Nullable<Float32Array>;
  positionMean: Float32Array;
  positionBases: Float32Array[];
  positionCoefficients: Float32Array[];
  normalMean?: Nullable<Float32Array>;
  normalBases?: Nullable<Float32Array[]>;
  normalCoefficients?: Nullable<Float32Array[]>;
}

/**
 * Geometry cache animation track information.
 * @public
 */
export type AssetGeometryCacheAnimationTrack =
  | AssetFixedGeometryCacheAnimationTrack
  | AssetPCAGeometryCacheAnimationTrack;

/**
 * Animation data interface for model loading
 * @public
 */
export interface AssetAnimationData {
  name: string;
  tracks: (AssetAnimationTrack | AssetGeometryCacheAnimationTrack)[];
  skeletons: AssetSkeleton[];
  nodes: AssetHierarchyNode[];
}

/**
 * Skeletal animation track interface for model loading
 * @public
 */
export interface AssetSkeletalAnimationTrack extends AssetAnimationTrack {
  skeleton: AssetSkeleton;
  keyFrames: Record<number, { translation: Vector3; rotation: Quaternion; scale: Vector3 }[]>;
}

/**
 * Rotation track of key frame animation interface for model loading
 * @public
 */
export interface AssetRotationTrack extends AssetAnimationTrack {
  keyFrames: Record<number, Quaternion[]>;
  nodes: number[];
}

/**
 * Translation track of key frame animation interface for model loading
 * @public
 */
export interface AssetTranslationTrack extends AssetAnimationTrack {
  keyFrames: Record<number, Vector3[]>;
  nodes: number[];
}

/**
 * Scale track of key frame animation interface for model loading
 * @public
 */
export interface AssetScaleTrack extends AssetAnimationTrack {
  keyFrames: Record<number, Vector3[]>;
  nodes: number[];
}

/**
 * Heirarchical node interface for model loading
 * @public
 */
export class AssetHierarchyNode extends NamedObject {
  private _parent: Nullable<AssetHierarchyNode>;
  private _position: Vector3;
  private _rotation: Quaternion;
  private _scaling: Vector3;
  private _mesh: Nullable<AssetMeshData>;
  private _skeleton: Nullable<AssetSkeleton>;
  private _attachToSkeleton: Nullable<Set<AssetSkeleton>>;
  private _matrix: Nullable<Matrix4x4>;
  private _worldMatrix: Nullable<Matrix4x4>;
  private _weights: Nullable<number[]>;
  private readonly _children: AssetHierarchyNode[];
  private readonly _instances: { t: Vector3; s: Vector3; r: Quaternion }[];
  /**
   * Creates an instance of AssetHierarchyNode
   * @param name - Name of the node
   * @param parent - Parent of the node
   */
  constructor(name: string, model: SharedModel, parent?: AssetHierarchyNode) {
    super(name);
    model.nodes.push(this);
    this._parent = null;
    this._position = Vector3.zero();
    this._rotation = Quaternion.identity();
    this._scaling = Vector3.one();
    this._children = [];
    this._mesh = null;
    this._skeleton = null;
    this._attachToSkeleton = null;
    this._matrix = null;
    this._weights = null;
    this._worldMatrix = null;
    this._instances = [];
    parent?.addChild(this);
  }
  /** Parent of the node */
  get parent(): Nullable<AssetHierarchyNode> {
    return this._parent;
  }
  /** Local transformation matrix of the node */
  get matrix() {
    return this._matrix;
  }
  /** World transformation matrix of the node */
  get worldMatrix() {
    return this._worldMatrix;
  }
  /** Mesh data of the node, or null if this is not a mesh node */
  get mesh() {
    return this._mesh;
  }
  set mesh(data) {
    this._mesh = data;
  }
  /** instances */
  get instances() {
    return this._instances;
  }
  /** Default morph target weights */
  get weights() {
    return this._weights;
  }
  set weights(val) {
    this._weights = val;
  }
  /** The skeleton used to control the node */
  get skeleton() {
    return this._skeleton;
  }
  set skeleton(skeleton) {
    this._skeleton = skeleton;
  }
  /** The translation of the node */
  get position(): Vector3 {
    return this._position;
  }
  set position(val: Vector3) {
    this._position = val;
  }
  /** The rotation of the node */
  get rotation(): Quaternion {
    return this._rotation;
  }
  set rotation(val: Quaternion) {
    this._rotation = val;
  }
  /** The scale of the node */
  get scaling(): Vector3 {
    return this._scaling;
  }
  set scaling(val: Vector3) {
    this._scaling = val;
  }
  /** Children of the node */
  get children(): AssetHierarchyNode[] {
    return this._children;
  }
  /** The skeleton to which the node belongs if this is a joint node */
  get skeletonAttached() {
    return this._attachToSkeleton;
  }
  isParentOf(child: Nullable<AssetHierarchyNode>) {
    while (child && child !== this) {
      child = child.parent!;
    }
    return child === this;
  }
  getWorldPosition() {
    return new Vector3(this.worldMatrix!.m03, this.worldMatrix!.m13, this.worldMatrix!.m23);
  }
  computeTransforms(parentTransform: Nullable<Matrix4x4>) {
    this._matrix = Matrix4x4.scaling(this._scaling).rotateLeft(this._rotation).translateLeft(this._position);
    this._worldMatrix = parentTransform
      ? Matrix4x4.multiply(parentTransform, this._matrix)
      : new Matrix4x4(this._matrix);
    for (const child of this._children) {
      child.computeTransforms(this._worldMatrix);
    }
  }
  /**
   * Adds a child to this node
   * @param child - The child node to be added
   */
  addChild(child: AssetHierarchyNode) {
    if (!child || child.parent) {
      throw new Error('AssetHierarchyNode.addChild(): invalid child node');
    }
    this._children.push(child);
    child._parent = this;
  }
  /**
   * Removes a child of this node
   * @param child - The child node to be removed
   */
  removeChild(child: AssetHierarchyNode) {
    const index = this._children.indexOf(child);
    if (index < 0) {
      throw new Error('AssetHierarchyNode.removeChild(): invalid child node');
    }
    this._children[index]._parent = null;
    this._children.splice(index, 1);
  }
  /**
   * Attach this node to a skeleton
   * @param skeleton - The skeleton to which to node will attach
   * @param index - The joint index
   */
  attachToSkeleton(skeleton: AssetSkeleton) {
    if (!this._attachToSkeleton) {
      this._attachToSkeleton = new Set();
    }
    this._attachToSkeleton.add(skeleton);
  }
}

/**
 * Skeleton information for model loading
 * @public
 */
export class AssetSkeleton extends NamedObject {
  /** The pivot node */
  pivot: Nullable<AssetHierarchyNode>;
  /** Joints of the skeleton */
  joints: AssetHierarchyNode[];
  /** Inverse of the binding matrices of the joints */
  inverseBindMatrices: Matrix4x4[];
  /** Binding pose matrices of the joints */
  bindPose: { position: Vector3; rotation: Quaternion; scale: Vector3 }[];
  /**
   * Creates an instance of AssetSkeleton
   * @param name - Name of the skeleton
   */
  constructor(name: string) {
    super(name);
    this.name = name;
    this.pivot = null;
    this.joints = [];
    this.inverseBindMatrices = [];
    this.bindPose = [];
  }
  /**
   * Adds a joint to the skeleton
   * @param joint - The joint node
   * @param inverseBindMatrix - Inverse binding matrix of the joint
   */
  addJoint(joint: AssetHierarchyNode, inverseBindMatrix: Matrix4x4) {
    joint.attachToSkeleton(this);
    this.joints.push(joint);
    this.inverseBindMatrices.push(inverseBindMatrix);
    this.bindPose.push({
      position: joint.position.clone(),
      rotation: joint.rotation.clone(),
      scale: joint.scaling.clone()
    });
  }
  get root() {
    if (this.pivot) {
      return this.pivot;
    }
    let root = this.joints[0];
    for (let i = 1; i < this.joints.length; i++) {
      while (root && !root.isParentOf(this.joints[i])) {
        root = root.parent!;
      }
    }
    return root;
  }
}

/**
 * Scene for model loading
 * @public
 */
export class AssetScene extends NamedObject {
  /** Root nodes of the scene */
  rootNodes: AssetHierarchyNode[];
  /**
   * Creates an instance of AssetScene
   * @param name - Name of the scene
   */
  constructor(name: string) {
    super(name);
    this.rootNodes = [];
  }
}

/**
 * Spring bone collider shape information.
 * @public
 */
export type AssetSpringBoneColliderShape =
  | {
      type: 'sphere';
      offset: Vector3;
      radius: number;
      inside?: boolean;
    }
  | {
      type: 'capsule';
      offset: Vector3;
      tail: Vector3;
      radius: number;
      inside?: boolean;
    }
  | {
      type: 'plane';
      offset: Vector3;
      normal: Vector3;
    };

/**
 * Spring bone collider information.
 * @public
 */
export interface AssetSpringBoneCollider {
  name?: string;
  node: AssetHierarchyNode;
  shape: AssetSpringBoneColliderShape;
}

/**
 * Spring bone collider group information.
 * @public
 */
export interface AssetSpringBoneColliderGroup {
  name?: string;
  colliders: AssetSpringBoneCollider[];
}

/**
 * Spring bone joint information.
 * @public
 */
export interface AssetSpringBoneJoint {
  node: AssetHierarchyNode;
  hitRadius: number;
  stiffness: number;
  gravityPower: number;
  gravityDir: Vector3;
  dragForce: number;
}

/**
 * Spring bone chain information.
 * @public
 */
export interface AssetSpringBone {
  name?: string;
  center?: AssetHierarchyNode;
  joints: AssetSpringBoneJoint[];
  rootBones?: AssetHierarchyNode[];
  colliderGroups: AssetSpringBoneColliderGroup[];
}

/**
 * Joint dynamics collider information.
 * @public
 */
export interface AssetJointDynamicsCollider {
  name?: string;
  node: AssetHierarchyNode;
  localPosition: Vector3;
  localRotation: Quaternion;
  collider: ColliderR;
}

/**
 * Joint dynamics chain information.
 * @public
 */
export interface AssetJointDynamicsChain {
  start: AssetHierarchyNode;
  end: AssetHierarchyNode;
}

/**
 * Joint dynamics flat plane information.
 * @public
 */
export interface AssetJointDynamicsFlatPlane {
  node: AssetHierarchyNode;
  position: Vector3;
  up: Vector3;
}

/**
 * Joint dynamics spring bone information.
 * @public
 */
export interface AssetJointDynamicsSpringBone {
  name?: string;
  center?: AssetHierarchyNode;
  chains: AssetJointDynamicsChain[];
  controllerConfig: DeepPartial<ControllerConfig, 2>;
  colliders: AssetJointDynamicsCollider[];
  flatPlanes: AssetJointDynamicsFlatPlane[];
}

/**
 * Options controlling which model resources are persisted.
 * @public
 */
export type SaveOptions = {
  importMeshes: boolean;
  importSkeletons: boolean;
  importAnimations: boolean;
  rebuildMaterial?: boolean;
};

type PreprocessOptions = {
  rebuildMaterial?: boolean;
  sourceMorphReferenceAssetPath?: string;
};

type SharedModelWithPreprocessOptions = SharedModel & {
  _preprocessOptions?: PreprocessOptions;
};

/**
 * Model information that can be shared by multiple model nodes
 * @public
 */
export class SharedModel extends Disposable {
  /** @internal */
  private _nodes: AssetHierarchyNode[];
  /** @internal */
  private _skeletons: AssetSkeleton[];
  /** @internal */
  private _animations: AssetAnimationData[];
  /** @internal */
  private _scenes: AssetScene[];
  /** @internal */
  private _activeScene: number;
  /** @internal */
  private _imageList: AssetImageInfo[];
  /** @internal */
  private _primitiveList: AssetPrimitiveInfo[];
  /** @internal */
  private _materialList: Record<string, AssetMaterial>;
  /** @internal */
  private _springBoneColliders: AssetSpringBoneCollider[];
  /** @internal */
  private _springBoneColliderGroups: AssetSpringBoneColliderGroup[];
  /** @internal */
  private _springBones: AssetSpringBone[];
  /** @internal */
  private _jointDynamicsColliders: AssetJointDynamicsCollider[];
  /** @internal */
  private _jointDynamicsSpringBones: AssetJointDynamicsSpringBone[];
  /** @internal */
  private _morphTargetGroups: AssetMorphTargetGroup[];
  /** @internal */
  private _textureMap: Map<AssetTextureInfo, DRef<Texture2D>>;
  /** @internal */
  private _primitiveMap: Map<AssetPrimitiveInfo, DRef<Primitive>>;

  /**
   * Creates an instance of SharedModel
   */
  constructor() {
    super();
    this._nodes = [];
    this._skeletons = [];
    this._scenes = [];
    this._animations = [];
    this._imageList = [];
    this._primitiveList = [];
    this._materialList = {};
    this._springBoneColliders = [];
    this._springBoneColliderGroups = [];
    this._springBones = [];
    this._jointDynamicsColliders = [];
    this._jointDynamicsSpringBones = [];
    this._morphTargetGroups = [];
    this._activeScene = -1;
    this._textureMap = new Map();
    this._primitiveMap = new Map();
  }
  /** All scenes that the model contains */
  get scenes(): AssetScene[] {
    return this._scenes;
  }
  /** All Primitives that the model contains */
  get primitives(): AssetPrimitiveInfo[] {
    return this._primitiveList;
  }
  /** All nodes that the model contains */
  get nodes(): AssetHierarchyNode[] {
    return this._nodes;
  }
  /** All animations that the model contains */
  get animations(): AssetAnimationData[] {
    return this._animations;
  }
  /** All skeletons that the model contains */
  get skeletons(): AssetSkeleton[] {
    return this._skeletons;
  }
  /** All SpringBone colliders that the model contains */
  get springBoneColliders(): AssetSpringBoneCollider[] {
    return this._springBoneColliders;
  }
  /** All SpringBone collider groups that the model contains */
  get springBoneColliderGroups(): AssetSpringBoneColliderGroup[] {
    return this._springBoneColliderGroups;
  }
  /** All SpringBone springs that the model contains */
  get springBones(): AssetSpringBone[] {
    return this._springBones;
  }
  /** SpringBone colliders converted to Zephyr3D JointDynamics collider format */
  get jointDynamicsColliders(): AssetJointDynamicsCollider[] {
    return this._jointDynamicsColliders;
  }
  /** SpringBone springs converted to Zephyr3D JointDynamics system format */
  get jointDynamicsSpringBones(): AssetJointDynamicsSpringBone[] {
    return this._jointDynamicsSpringBones;
  }
  /** Model-level morph target groups, commonly facial expressions. */
  get morphTargetGroups(): AssetMorphTargetGroup[] {
    return this._morphTargetGroups;
  }
  /** The active scene of the model */
  get activeScene(): number {
    return this._activeScene;
  }
  set activeScene(val: number) {
    this._activeScene = val;
  }
  getImage(index: number) {
    return this._imageList[index];
  }
  setImage(index: number, img: AssetImageInfo) {
    this._imageList[index] = img;
  }
  getMaterial(hash: string) {
    return this._materialList[hash];
  }
  setMaterial(hash: string, material: AssetMaterial) {
    this._materialList[hash] = material;
  }
  addPrimitive(prim: AssetPrimitiveInfo) {
    this._primitiveList.push(prim);
  }
  private sanitizeResourceName(name: string, fallback: string) {
    let normalized = (name ?? '').trim();
    if (!normalized) {
      normalized = fallback;
    }
    normalized = normalized.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    normalized = normalized.replace(/[. ]+$/g, '');
    return normalized || fallback;
  }
  private getReimportPoolKey(baseName: string, ext: string) {
    return `${ext.toLowerCase()}|${baseName}`;
  }
  private getResourceBasename(path: string, ext: string) {
    return path ? PathUtils.basename(path, ext || PathUtils.extname(path)) : '';
  }
  private getResourceNumericSuffix(baseName: string, candidateBaseName: string) {
    if (candidateBaseName === baseName) {
      return 0;
    }
    const match = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_([0-9]+)$`).exec(
      candidateBaseName
    );
    return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  }
  private registerReusableResourcePath(pools: ReimportResourcePools, path: string) {
    const ext = PathUtils.extname(path).toLowerCase();
    const baseName = this.getResourceBasename(path, ext);
    const register = (keyBaseName: string) => {
      const key = this.getReimportPoolKey(keyBaseName, ext);
      let candidates = pools.get(key);
      if (!candidates) {
        candidates = new Set<string>();
        pools.set(key, candidates);
      }
      candidates.add(path);
    };
    register(baseName);
    const strippedBaseName = baseName.replace(/_[0-9]+$/u, '');
    if (strippedBaseName && strippedBaseName !== baseName) {
      register(strippedBaseName);
    }
  }
  private collectReferencedAssetPaths(
    value: unknown,
    destPath: string,
    extensions: Set<string>,
    out: Set<string>
  ) {
    if (typeof value === 'string') {
      const normalizedPath = PathUtils.normalize(value);
      const ext = PathUtils.extname(normalizedPath).toLowerCase();
      const normalizedDestPath = PathUtils.normalize(destPath);
      if (
        extensions.has(ext) &&
        (normalizedPath === normalizedDestPath ||
          normalizedPath.startsWith(
            normalizedDestPath.endsWith('/') ? normalizedDestPath : `${normalizedDestPath}/`
          ))
      ) {
        out.add(normalizedPath);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectReferencedAssetPaths(item, destPath, extensions, out);
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        this.collectReferencedAssetPaths(item, destPath, extensions, out);
      }
    }
  }
  private async collectReferencedAssetPathsFromJsonFile(
    destVFS: VFS,
    jsonPath: string,
    destPath: string,
    extensions: Set<string>
  ) {
    if (!(await destVFS.exists(jsonPath))) {
      return new Set<string>();
    }
    try {
      const content = (await destVFS.readFile(jsonPath, { encoding: 'utf8' })) as string;
      const json = JSON.parse(content) as unknown;
      const out = new Set<string>();
      this.collectReferencedAssetPaths(json, destPath, extensions, out);
      return out;
    } catch (err) {
      console.warn(`Read existing import manifest failed: ${jsonPath}: ${err}`);
      return new Set<string>();
    }
  }
  private async createReimportResourcePools(destVFS: VFS, destPath: string, prefabPath: string) {
    const pools: ReimportResourcePools = new Map();
    if (!(await destVFS.exists(prefabPath))) {
      return pools;
    }
    const materialAndMeshPaths = await this.collectReferencedAssetPathsFromJsonFile(
      destVFS,
      prefabPath,
      destPath,
      new Set(['.zmtl', '.zmsh'])
    );
    for (const path of materialAndMeshPaths) {
      this.registerReusableResourcePath(pools, path);
    }
    const materialPaths = Array.from(materialAndMeshPaths).filter(
      (path) => PathUtils.extname(path).toLowerCase() === '.zmtl'
    );
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tga', '.hdr', '.ktx', '.ktx2']);
    for (const materialPath of materialPaths) {
      const texturePaths = await this.collectReferencedAssetPathsFromJsonFile(
        destVFS,
        materialPath,
        destPath,
        imageExtensions
      );
      for (const texturePath of texturePaths) {
        this.registerReusableResourcePath(pools, texturePath);
      }
    }
    return pools;
  }
  private consumeReusableResourcePath(
    pools: ReimportResourcePools,
    baseName: string,
    ext: string,
    usedPaths: Set<string>
  ) {
    const candidates = pools.get(this.getReimportPoolKey(baseName, ext));
    if (!candidates || candidates.size === 0) {
      return null;
    }
    const sorted = Array.from(candidates)
      .filter((path) => !usedPaths.has(path))
      .sort((a, b) => {
        const aSuffix = this.getResourceNumericSuffix(baseName, this.getResourceBasename(a, ext));
        const bSuffix = this.getResourceNumericSuffix(baseName, this.getResourceBasename(b, ext));
        if (aSuffix !== bSuffix) {
          return aSuffix - bSuffix;
        }
        return a.localeCompare(b);
      });
    const selected = sorted[0] ?? null;
    if (selected) {
      usedPaths.add(selected);
    }
    return selected;
  }
  private async createUniqueResourcePath(
    destVFS: VFS,
    destPath: string,
    baseName: string,
    ext: string,
    usedPaths: Set<string>,
    fallback: string
  ) {
    const sanitizedBase = this.sanitizeResourceName(baseName, fallback);
    for (let suffix = 0; ; suffix++) {
      const candidateName = suffix > 0 ? `${sanitizedBase}_${suffix}` : sanitizedBase;
      const candidatePath = destVFS.join(destPath, `${candidateName}${ext}`);
      if (!usedPaths.has(candidatePath) && !(await destVFS.exists(candidatePath))) {
        usedPaths.add(candidatePath);
        return candidatePath;
      }
    }
  }
  private async tryReuseExactResourcePath(
    destVFS: VFS,
    destPath: string,
    baseName: string,
    ext: string,
    usedPaths: Set<string>,
    fallback: string
  ) {
    const sanitizedBase = this.sanitizeResourceName(baseName, fallback);
    const candidatePath = destVFS.join(destPath, `${sanitizedBase}${ext}`);
    if (!usedPaths.has(candidatePath) && (await destVFS.exists(candidatePath))) {
      usedPaths.add(candidatePath);
      return candidatePath;
    }
    return null;
  }
  private collapseCompositeTextureName(name: string) {
    const normalized = (name ?? '').trim();
    if (!normalized) {
      return normalized;
    }
    const separatorIndex = normalized.indexOf('-');
    if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
      return normalized;
    }
    const left = normalized.slice(0, separatorIndex).trim();
    const right = normalized.slice(separatorIndex + 1).trim();
    if (!left || !right) {
      return normalized;
    }
    const leftParts = left.split('_');
    const rightParts = right.split('_');
    let prefixLength = 0;
    while (
      prefixLength < leftParts.length - 1 &&
      prefixLength < rightParts.length - 1 &&
      leftParts[prefixLength] === rightParts[prefixLength]
    ) {
      prefixLength++;
    }
    if (prefixLength <= 0) {
      return normalized;
    }
    const prefix = leftParts.slice(0, prefixLength).join('_');
    const leftSuffix = leftParts.slice(prefixLength).join('_');
    const rightSuffix = rightParts.slice(prefixLength).join('_');
    if (!leftSuffix || !rightSuffix) {
      return normalized;
    }
    return `${prefix}_${leftSuffix}-${rightSuffix}`;
  }
  private getImageBaseName(img: AssetImageInfo, index: number, fallback: string) {
    if (img?.name?.trim()) {
      return this.collapseCompositeTextureName(img.name);
    }
    if (img?.uri) {
      return this.collapseCompositeTextureName(PathUtils.basename(img.uri, PathUtils.extname(img.uri)));
    }
    return `${fallback}_texture_${index}`;
  }
  private getMaterialBaseName(material: AssetMaterial, key: string, fallback: string) {
    return material?.name?.trim() || `${fallback}_material_${key}`;
  }
  private getPrimitiveBaseName(info: AssetPrimitiveInfo, index: number, fallback: string) {
    return info?.name?.trim() || `${fallback}_mesh_${index}`;
  }
  /**
   * Adds a model-level morph target group.
   * @param group - Morph target group to add
   */
  addMorphTargetGroup(group: AssetMorphTargetGroup) {
    if (group?.name && group.bindings?.length > 0) {
      this._morphTargetGroups.push(group);
    }
  }
  /**
   * Removes all model-level morph target groups.
   */
  clearMorphTargetGroups() {
    this._morphTargetGroups = [];
  }
  /**
   * Finds a model-level morph target group by name.
   * @param name - Group name
   * @returns The matching group, or null if not found
   */
  getMorphTargetGroup(name: string): Nullable<AssetMorphTargetGroup> {
    return this._morphTargetGroups.find((group) => group.name === name) ?? null;
  }
  /**
   * Builds morph target groups by collecting morph target names from every mesh.
   * @returns Generated morph target groups
   */
  buildMorphTargetGroupsByName(): AssetMorphTargetGroup[] {
    this.clearMorphTargetGroups();
    const groups = new Map<string, AssetMorphTargetGroup>();
    const meshes = new Set<AssetMeshData>();
    for (const node of this._nodes) {
      if (node.mesh) {
        meshes.add(node.mesh);
      }
    }
    for (const mesh of meshes) {
      const count = getAssetMeshMorphTargetCount(mesh);
      for (let i = 0; i < count; i++) {
        const targetName = getAssetMeshMorphTargetName(mesh, i);
        let group = groups.get(targetName);
        if (!group) {
          group = { name: targetName, bindings: [] };
          groups.set(targetName, group);
        }
        group.bindings.push({
          mesh,
          targetIndex: i,
          targetName,
          weight: 1
        });
      }
    }
    this._morphTargetGroups = Array.from(groups.values());
    return this._morphTargetGroups;
  }
  /**
   * Adds a skeleton to the scene
   * @param skeleton - The skeleton to be added
   */
  addSkeleton(skeleton: AssetSkeleton) {
    this._skeletons.push(skeleton);
  }
  /**
   * Adds an animation to the scene
   * @param animation - The animation to be added
   */
  addAnimation(animation: AssetAnimationData) {
    this._animations.push(animation);
  }
  static async writePrimitive(vfs: VFS, primitive: AssetPrimitiveInfo, path: string) {
    const data = {
      vertices: {} as Record<VertexSemantic, { format: VertexAttribFormat; data: string }>,
      indices: primitive.indices
        ? uint8ArrayToBase64(
            new Uint8Array(
              primitive.indices.buffer,
              primitive.indices.byteOffset,
              primitive.indices.byteLength
            )
          )
        : null,
      indexType: primitive.indices ? (primitive.indices instanceof Uint16Array ? 'u16' : 'u32') : '',
      indexCount: primitive.indexCount,
      type: primitive.type,
      boxMin: [primitive.boxMin.x, primitive.boxMin.y, primitive.boxMin.z],
      boxMax: [primitive.boxMax.x, primitive.boxMax.y, primitive.boxMax.z]
    };
    for (const k in primitive.vertices) {
      const v = primitive.vertices[k as VertexSemantic];
      data.vertices[k as VertexSemantic] = {
        format: v.format,
        data: uint8ArrayToBase64(new Uint8Array(v.data.buffer, v.data.byteOffset, v.data.byteLength))
      };
    }
    const content = JSON.stringify({ type: 'Primitive', data }, null, 2);
    await vfs.writeFile(path, content, { encoding: 'utf8', create: true });
  }
  /** preprocess */
  async preprocess(
    manager: ResourceManager,
    name: string,
    destPath: string,
    srcVFS: VFS,
    dstVFS: VFS
  ): Promise<void> {
    const destName = name;
    const usedPaths = new Set<string>();
    const rebuildMaterial =
      (this as SharedModelWithPreprocessOptions)._preprocessOptions?.rebuildMaterial ?? true;
    const prefabName = name.endsWith('.zprefab') ? name : `${name}.zprefab`;
    const prefabPath = dstVFS.join(destPath, prefabName);
    const reusableResourcePools = await this.createReimportResourcePools(dstVFS, destPath, prefabPath);
    if (this._imageList.length > 0) {
      console.info(`Importing ${this._imageList.length} textures`);
      for (let i = 0; i < this._imageList.length; i++) {
        const img = this._imageList[i];
        if (!img) {
          continue;
        }
        let ext: string = '';
        const mimeType = img.uri ? srcVFS.guessMIMEType(img.uri) : img.data ? img.mimeType : '';
        if (mimeType === 'image/jpeg') {
          ext = '.jpg';
        } else if (mimeType === 'image/png') {
          ext = '.png';
        } else if (mimeType === 'image/webp') {
          ext = '.webp';
        } else if (mimeType === 'image/tga') {
          ext = '.tga';
        } else if (mimeType === 'image/vnd.radiance') {
          ext = '.hdr';
        } else if (mimeType === 'image/ktx') {
          ext = '.ktx';
        } else if (mimeType === 'image/ktx2') {
          ext = '.ktx2';
        } else {
          continue;
        }
        ASSERT(!!ext, `Unknown image mime type: ${mimeType}`);
        const baseName = this.sanitizeResourceName(
          this.getImageBaseName(img, i, destName),
          `${destName}_texture_${i}`
        );
        const path =
          (await this.tryReuseExactResourcePath(
            dstVFS,
            destPath,
            baseName,
            ext,
            usedPaths,
            `${destName}_texture_${i}`
          )) ??
          this.consumeReusableResourcePath(reusableResourcePools, baseName, ext, usedPaths) ??
          (await this.createUniqueResourcePath(
            dstVFS,
            destPath,
            baseName,
            ext,
            usedPaths,
            `${destName}_texture_${i}`
          ));
        try {
          if (img.uri) {
            img.data = new Uint8Array((await srcVFS.readFile(img.uri, { encoding: 'binary' })) as ArrayBuffer);
          }
          await dstVFS.writeFile(
            path,
            img.data!.buffer.slice(img.data!.byteOffset, img.data!.byteOffset + img.data!.byteLength),
            { encoding: 'binary', create: true }
          );
          img.uri = path;
          img.data = undefined;
          img.mimeType = '';
        } catch (err) {
          console.warn(
            `Skip missing or unreadable texture during import: ${img.uri || img.name || `${destName}_texture_${i}`}: ${String(err)}`
          );
          img.uri = undefined;
          img.data = undefined;
          img.mimeType = '';
        }
      }
    }
    const materialKeys = Object.keys(this._materialList);
    if (materialKeys.length > 0) {
      console.info(`Importing ${materialKeys.length} materials`);
      for (const k of materialKeys) {
        const material = this._materialList[k];
        const baseName = this.sanitizeResourceName(
          this.getMaterialBaseName(material, k, destName),
          `${destName}_material_${k}`
        );
        const path =
          (await this.tryReuseExactResourcePath(
            dstVFS,
            destPath,
            baseName,
            '.zmtl',
            usedPaths,
            `${destName}_material_${k}`
          )) ??
          this.consumeReusableResourcePath(reusableResourcePools, baseName, '.zmtl', usedPaths) ??
          (await this.createUniqueResourcePath(
            dstVFS,
            destPath,
            baseName,
            '.zmtl',
            usedPaths,
            `${destName}_material_${k}`
          ));
        if (!rebuildMaterial && (await dstVFS.exists(path))) {
          material.path = path;
          continue;
        }
        material.path = '';
        const m = await this.createMaterial(manager, material, dstVFS);
        material.path = path;
        const data = await manager.serializeObject(m);
        const content = JSON.stringify({ type: 'Default', data }, null, 2);
        await dstVFS.writeFile(path, content, { encoding: 'utf8', create: true });
        m!.dispose();
      }
    }
    if (this._primitiveList.length > 0) {
      console.info(`Importing ${this._primitiveList.length} meshes`);
      for (let i = 0; i < this._primitiveList.length; i++) {
        const info = this._primitiveList[i];
        if (!info) {
          continue;
        }
        const baseName = this.sanitizeResourceName(
          this.getPrimitiveBaseName(info, i, destName),
          `${destName}_mesh_${i}`
        );
        const path =
          (await this.tryReuseExactResourcePath(
            dstVFS,
            destPath,
            baseName,
            '.zmsh',
            usedPaths,
            `${destName}_mesh_${i}`
          )) ??
          this.consumeReusableResourcePath(reusableResourcePools, baseName, '.zmsh', usedPaths) ??
          (await this.createUniqueResourcePath(
            dstVFS,
            destPath,
            baseName,
            '.zmsh',
            usedPaths,
            `${destName}_mesh_${i}`
          ));
        await SharedModel.writePrimitive(dstVFS, info, path);
        info.path = path;
      }
    }
  }
  createJointDynamics(rootNode: SceneNode, nodeMap: Map<AssetHierarchyNode, SceneNode>) {
    if (rootNode.animationSet.rigs.length === 0) {
      return;
    }
    for (const jd of this._jointDynamicsSpringBones) {
      const chains = jd.chains
        .map((chain) => {
          const start = nodeMap.get(chain.start)!;
          const end = nodeMap.get(chain.end)!;
          return { start, end };
        })
        .filter((chain) => {
          if (!chain.start || !chain.end) {
            return false;
          }
          return true;
        });
      const rigs = rootNode.animationSet.rigs.filter((ref) => {
        const joints = ref.get()!.joints;
        return chains.every((chain) => joints.includes(chain.start));
      });
      if (rigs.length === 0) {
        continue;
      }
      const colliders = jd.colliders
        .map((collider) => {
          const parent = nodeMap.get(collider.node);
          if (!parent) {
            return null;
          }
          const node = new SceneNode(parent.scene);
          node.name = collider.name ? `${collider.name}_JointDynamicsCollider` : 'JointDynamicsCollider';
          node.parent = parent;
          node.position.set(collider.localPosition);
          node.rotation.set(collider.localRotation);
          return {
            r: { ...collider.collider },
            transform: createTransformAccess(node)
          };
        })
        .filter(
          (collider): collider is { r: ColliderR; transform: ReturnType<typeof createTransformAccess> } => {
            return !!collider;
          }
        );
      const flatPlanes = jd.flatPlanes
        .map((flatPlane) => {
          const node = nodeMap.get(flatPlane.node);
          if (!node) {
            return null;
          }
          const up = node.worldMatrix.transformVectorAffine(flatPlane.up, new Vector3());
          if (up.magnitudeSq === 0) {
            return null;
          }
          return {
            up: up.inplaceNormalize(),
            position: node.worldMatrix.transformPointAffine(flatPlane.position, new Vector3())
          };
        })
        .filter((flatPlane): flatPlane is { up: Vector3; position: Vector3 } => {
          return !!flatPlane;
        });
      for (const rig of rigs) {
        const system = new JointDynamicsSystem(
          {
            chainConfig: {
              chains,
              systemRoot: rootNode
            },
            controllerConfig: jd.controllerConfig
          },
          colliders,
          [],
          flatPlanes
        );
        const modifier = new JointDynamicsModifier(system);
        rig.get()!.modifiers.push(modifier);
      }
    }
  }
  private createMorphTargetGroups(rootNode: SceneNode, meshMap: Map<AssetSubMeshData, Mesh>) {
    const runtimeGroups: SceneMorphTargetGroup[] = [];
    for (const group of this._morphTargetGroups) {
      const bindings: SceneMorphTargetBinding[] = [];
      for (const binding of group.bindings) {
        const assetMesh = binding.node?.mesh ?? binding.mesh ?? null;
        if (!assetMesh) {
          continue;
        }
        for (const subMesh of assetMesh.subMeshes) {
          const mesh = meshMap.get(subMesh);
          if (mesh) {
            bindings.push({
              mesh,
              targetIndex: binding.targetIndex,
              targetName: binding.targetName,
              weight: binding.weight
            });
          }
        }
      }
      if (bindings.length > 0) {
        runtimeGroups.push({
          name: group.name,
          bindings,
          isBinary: group.isBinary,
          weight: this.getInitialMorphTargetGroupWeight(bindings, group.isBinary)
        });
      }
    }
    rootNode.morphTargetGroups = runtimeGroups;
  }
  private getInitialMorphTargetGroupWeight(bindings: SceneMorphTargetBinding[], isBinary?: boolean): number {
    let result = 0;
    let found = false;
    for (const binding of bindings) {
      if (!binding.weight) {
        continue;
      }
      const targetWeight = this.getMorphTargetBindingWeight(binding);
      if (targetWeight === null) {
        continue;
      }
      const groupWeight = targetWeight / binding.weight;
      if (!found || Math.abs(groupWeight) > Math.abs(result)) {
        result = groupWeight;
        found = true;
      }
    }
    return isBinary ? (result > 0.5 ? 1 : 0) : result;
  }
  private getMorphTargetBindingWeight(binding: SceneMorphTargetBinding): Nullable<number> {
    const targetIndex = binding.targetIndex;
    if (
      typeof targetIndex === 'number' &&
      targetIndex >= 0 &&
      targetIndex < binding.mesh.getNumMorphTargets()
    ) {
      const targetName = binding.mesh.getMorphTargetName(targetIndex);
      if (targetName) {
        return binding.mesh.getMorphWeight(targetName);
      }
    }
    if (binding.targetName) {
      return binding.mesh.getMorphWeight(binding.targetName);
    }
    return null;
  }
  async createSceneNode(
    manager: ResourceManager,
    scene: Scene,
    instancing: boolean,
    saveMeshes: boolean,
    saveSkeletons: boolean,
    saveAnimations: boolean,
    saveJointDynamics: boolean,
    srcVFS: VFS
  ): Promise<SceneNode> {
    const group = new SceneNode(scene);
    const nodeMap: Map<AssetHierarchyNode, SceneNode> = new Map();
    const meshMap: Map<AssetSubMeshData, Mesh> = new Map();
    for (let i = 0; i < this.scenes.length; i++) {
      const assetScene = this.scenes[i];
      const skeletonMeshMap: Map<
        AssetSkeleton,
        { mesh: Mesh[]; bounding: AssetSubMeshData[]; binding?: SkinBinding }
      > = new Map();
      for (let k = 0; k < assetScene.rootNodes.length; k++) {
        await this.setAssetNodeToSceneNode(
          manager,
          scene,
          group,
          assetScene.rootNodes[k],
          skeletonMeshMap,
          nodeMap,
          meshMap,
          instancing,
          saveMeshes,
          saveSkeletons,
          saveAnimations,
          srcVFS
        );
      }
      if (saveSkeletons) {
        for (const sk of this.skeletons) {
          if (!skeletonMeshMap.has(sk)) {
            skeletonMeshMap.set(sk, {
              mesh: [],
              bounding: []
            });
          }
        }
        const rigMap = new Map<string, SkeletonRig>();
        const bindingMap = new Map<string, SkinBinding>();
        for (const v of skeletonMeshMap) {
          const sk = v[0];
          const joints = sk.joints.map((val) => {
            const node = nodeMap.get(val)!;
            node.jointTypeT = 'static';
            node.jointTypeS = 'static';
            node.jointTypeR = 'static';
            return node;
          });
          const rootJoint = sk.root ? (nodeMap.get(sk.root) ?? null) : null;
          const rigKey = SkeletonRig.getRigKey(joints, rootJoint);
          let rig = rigMap.get(rigKey);
          if (!rig) {
            rig = new SkeletonRig(joints, sk.bindPose, { rootJoint });
            rigMap.set(rigKey, rig);
            group.animationSet.rigs.push(new DRef(rig));
          }
          const bindingKey = getSkinBindingKey(rig, joints, sk.inverseBindMatrices);
          let binding = bindingMap.get(bindingKey);
          if (!binding) {
            binding = new SkinBinding(rig, sk.inverseBindMatrices, joints);
            bindingMap.set(bindingKey, binding);
            group.animationSet.skeletons.push(new DRef(binding));
          }
          const nodes = skeletonMeshMap.get(sk);
          if (nodes) {
            if (!nodes.binding) {
              nodes.binding = binding;
              for (let i = 0; i < nodes.mesh.length; i++) {
                const mesh = nodes.mesh[i];
                const v = {
                  positions: nodes.bounding[i].rawPositions!,
                  blendIndices: nodes.bounding[i].rawBlendIndices!,
                  weights: nodes.bounding[i].rawJointWeights!,
                  influenceCount: nodes.bounding[i].rawSkinInfluenceCount ?? 4
                };
                mesh.setSkinnedBoundingInfo(nodes.binding.getBoundingInfo(v));
                mesh.skeletonName = nodes.binding.persistentId;
              }
            }
          }
        }
      }
      if (saveAnimations) {
        for (const animationData of this.animations) {
          if (animationData.skeletons.length > 0 && !saveSkeletons) {
            continue;
          }
          let name = animationData.name ?? `_embbeded_animation`;
          if (group.animationSet.getAnimationClip(name)) {
            const baseName = name;
            for (let t = 1; ; t++) {
              name = `${baseName}_${t}`;
              if (!group.animationSet.getAnimationClip(name)) {
                break;
              }
            }
          }
          const animation = group.animationSet.createAnimation(name, true)!;
          for (const sk of animationData.skeletons) {
            const nodes = skeletonMeshMap.get(sk);
            if (nodes) {
              animation.addSkeleton(nodes.binding!.rig.persistentId);
            }
          }
          for (const track of animationData.tracks) {
            const target = nodeMap.get(track.node)!;
            if (track.type === 'translation') {
              animation.addTrack(target, new NodeTranslationTrack(track.interpolator, true));
              target.jointTypeT = 'animated';
            } else if (track.type === 'scale') {
              animation.addTrack(target, new NodeScaleTrack(track.interpolator, true));
              target.jointTypeS = 'animated';
            } else if (track.type === 'rotation') {
              animation.addTrack(target, new NodeRotationTrack(track.interpolator, true));
              target.jointTypeR = 'animated';
            } else if (track.type === 'weights') {
              for (const m of track.node.mesh!.subMeshes) {
                const mesh = meshMap.get(m)!;
                const morphTargetLimit = getMorphTargetLimit();
                if (track.interpolator.stride > morphTargetLimit) {
                  console.error(
                    `Morph target too large: ${track.interpolator.stride}, the project limit is ${morphTargetLimit}`
                  );
                } else {
                  const morphTrack = new MorphTargetTrack(
                    track.interpolator,
                    track.defaultMorphWeights,
                    m.targetBox,
                    mesh.getBoundingVolume()!.toAABB(),
                    true
                  );
                  animation.addTrack(mesh, morphTrack);
                }
              }
            } else if (track.type === 'geometry-cache') {
              const subMesh = track.node.mesh?.subMeshes[track.subMeshIndex];
              const mesh = subMesh ? meshMap.get(subMesh) : null;
              if (!subMesh || !mesh) {
                console.error(`Invalid geometry cache sub mesh: ${track.subMeshIndex}`);
              } else {
                if (track.codec === 'pca') {
                  const pcaData = this.remapPCAGeometryCacheData(subMesh, track);
                  animation.addTrack(mesh, new PCAGeometryCacheTrack(pcaData, true));
                } else {
                  const frames = this.remapGeometryCacheFrames(subMesh, track.frames);
                  animation.addTrack(mesh, new FixedGeometryCacheTrack(track.times, frames, true));
                }
              }
            } else {
              console.error(`Invalid animation track type: ${track.type}`);
            }
          }
        }
      }
    }
    if (saveJointDynamics && saveSkeletons) {
      this.createJointDynamics(group, nodeMap);
    }
    this.createMorphTargetGroups(group, meshMap);
    return group;
  }

  private remapGeometryCacheFrames(subMesh: AssetSubMeshData, frames: FixedGeometryCacheFrame[]) {
    if (!subMesh.rawPositions || frames.length === 0) {
      return frames;
    }
    const sourcePositions = frames[0].positions;
    const sourceVertexCount = (sourcePositions.length / 3) >> 0;
    const targetVertexCount = (subMesh.rawPositions.length / 3) >> 0;
    if (sourceVertexCount === targetVertexCount) {
      return frames;
    }
    const remap = this.buildGeometryCacheRemap(subMesh.rawPositions, sourcePositions);
    if (!remap) {
      console.error(
        `Geometry cache vertex layout mismatch: source=${sourceVertexCount}, target=${targetVertexCount}. ` +
          `Export the base glb and zabc from the same final mesh layout.`
      );
      return frames;
    }
    return frames.map((frame) => ({
      positions: this.expandGeometryCacheData(frame.positions, remap),
      normals:
        frame.normals && (frame.normals.length / 3) >> 0 === sourceVertexCount
          ? this.expandGeometryCacheData(frame.normals, remap)
          : null,
      boundingBox: frame.boundingBox
    }));
  }

  private remapPCAGeometryCacheData(
    subMesh: AssetSubMeshData,
    track: AssetPCAGeometryCacheAnimationTrack
  ): PCAGeometryCacheTrackData {
    const remapReference = track.positionReference ?? this.reconstructPCAGeometryCacheReference(track);
    if (!subMesh.rawPositions || remapReference.length === 0) {
      return {
        times: track.times,
        bounds: track.bounds,
        positionReference: track.positionReference ?? null,
        positionMean: track.positionMean,
        positionBases: track.positionBases,
        positionCoefficients: track.positionCoefficients,
        normalMean: track.normalMean ?? null,
        normalBases: track.normalBases ?? null,
        normalCoefficients: track.normalCoefficients ?? null
      };
    }
    const sourceVertexCount = (remapReference.length / 3) >> 0;
    const targetVertexCount = (subMesh.rawPositions.length / 3) >> 0;
    if (sourceVertexCount === targetVertexCount) {
      return {
        times: track.times,
        bounds: track.bounds,
        positionReference: track.positionReference ?? null,
        positionMean: track.positionMean,
        positionBases: track.positionBases,
        positionCoefficients: track.positionCoefficients,
        normalMean: track.normalMean ?? null,
        normalBases: track.normalBases ?? null,
        normalCoefficients: track.normalCoefficients ?? null
      };
    }
    const remap = this.buildGeometryCacheRemap(subMesh.rawPositions, remapReference);
    if (!remap) {
      console.error(
        `Geometry cache vertex layout mismatch: source=${sourceVertexCount}, target=${targetVertexCount}. ` +
          `Export the base glb and zabc from the same final mesh layout.`
      );
      return {
        times: track.times,
        bounds: track.bounds,
        positionReference: track.positionReference ?? null,
        positionMean: track.positionMean,
        positionBases: track.positionBases,
        positionCoefficients: track.positionCoefficients,
        normalMean: track.normalMean ?? null,
        normalBases: track.normalBases ?? null,
        normalCoefficients: track.normalCoefficients ?? null
      };
    }
    return {
      times: track.times,
      bounds: track.bounds,
      positionReference: this.expandGeometryCacheData(remapReference, remap),
      positionMean: this.expandGeometryCacheData(track.positionMean, remap),
      positionBases: track.positionBases.map((basis) => this.expandGeometryCacheData(basis, remap)),
      positionCoefficients: track.positionCoefficients,
      normalMean:
        track.normalMean && (track.normalMean.length / 3) >> 0 === sourceVertexCount
          ? this.expandGeometryCacheData(track.normalMean, remap)
          : null,
      normalBases:
        track.normalBases?.map((basis) =>
          (basis.length / 3) >> 0 === sourceVertexCount ? this.expandGeometryCacheData(basis, remap) : basis
        ) ?? null,
      normalCoefficients: track.normalCoefficients ?? null
    };
  }

  private reconstructPCAGeometryCacheReference(track: AssetPCAGeometryCacheAnimationTrack) {
    const reference = new Float32Array(track.positionMean);
    const coefficients = track.positionCoefficients[0];
    if (!coefficients) {
      return reference;
    }
    const componentCount = Math.min(track.positionBases.length, coefficients.length);
    for (let component = 0; component < componentCount; component++) {
      const basis = track.positionBases[component];
      const coefficient = coefficients[component];
      if (!basis || coefficient === 0) {
        continue;
      }
      const count = Math.min(reference.length, basis.length);
      for (let i = 0; i < count; i++) {
        reference[i] += basis[i] * coefficient;
      }
    }
    return reference;
  }

  private buildGeometryCacheRemap(targetPositions: Float32Array, sourcePositions: Float32Array) {
    const sourceCount = (sourcePositions.length / 3) >> 0;
    const targetCount = (targetPositions.length / 3) >> 0;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < sourceCount; i++) {
      const key = this.geometryCachePositionKey(
        sourcePositions[i * 3],
        sourcePositions[i * 3 + 1],
        sourcePositions[i * 3 + 2]
      );
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        buckets.set(key, [i]);
      }
    }
    const remap = new Uint32Array(targetCount);
    for (let i = 0; i < targetCount; i++) {
      const x = targetPositions[i * 3];
      const y = targetPositions[i * 3 + 1];
      const z = targetPositions[i * 3 + 2];
      let sourceIndex = this.findGeometryCacheSourceIndex(sourcePositions, buckets, x, y, z);
      if (sourceIndex < 0) {
        sourceIndex = this.findNearestGeometryCacheSourceIndex(sourcePositions, x, y, z);
      }
      if (sourceIndex < 0) {
        return null;
      }
      remap[i] = sourceIndex;
    }
    return remap;
  }

  private expandGeometryCacheData(source: Float32Array, remap: Uint32Array) {
    const expanded = new Float32Array(remap.length * 3);
    for (let i = 0; i < remap.length; i++) {
      const sourceOffset = remap[i] * 3;
      const targetOffset = i * 3;
      expanded[targetOffset] = source[sourceOffset];
      expanded[targetOffset + 1] = source[sourceOffset + 1];
      expanded[targetOffset + 2] = source[sourceOffset + 2];
    }
    return expanded;
  }

  private findGeometryCacheSourceIndex(
    sourcePositions: Float32Array,
    buckets: Map<string, number[]>,
    x: number,
    y: number,
    z: number
  ) {
    const bucket = buckets.get(this.geometryCachePositionKey(x, y, z));
    if (!bucket) {
      return -1;
    }
    const epsilon = 1e-5;
    for (const index of bucket) {
      const offset = index * 3;
      if (
        Math.abs(sourcePositions[offset] - x) <= epsilon &&
        Math.abs(sourcePositions[offset + 1] - y) <= epsilon &&
        Math.abs(sourcePositions[offset + 2] - z) <= epsilon
      ) {
        return index;
      }
    }
    return -1;
  }

  private findNearestGeometryCacheSourceIndex(
    sourcePositions: Float32Array,
    x: number,
    y: number,
    z: number
  ) {
    const epsilonSquared = 1e-8;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < sourcePositions.length; i += 3) {
      const dx = sourcePositions[i] - x;
      const dy = sourcePositions[i + 1] - y;
      const dz = sourcePositions[i + 2] - z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i / 3;
      }
    }
    return bestDistance <= epsilonSquared ? bestIndex : -1;
  }

  private geometryCachePositionKey(x: number, y: number, z: number) {
    return `${Math.round(x * 100000)}|${Math.round(y * 100000)}|${Math.round(z * 100000)}`;
  }

  protected onDispose() {
    super.onDispose();
    for (const prim of this._primitiveMap.values()) {
      prim.dispose();
    }
    for (const tex of this._textureMap.values()) {
      tex.dispose();
    }
    this._skeletons = [];
    this._scenes = [];
    this._animations = [];
  }
  private async setAssetNodeToSceneNode(
    manager: ResourceManager,
    scene: Scene,
    parent: SceneNode,
    assetNode: AssetHierarchyNode,
    skeletonMeshMap: Map<AssetSkeleton, { mesh: Mesh[]; bounding: AssetSubMeshData[] }>,
    nodeMap: Map<AssetHierarchyNode, SceneNode>,
    meshMap: Map<AssetSubMeshData, Mesh>,
    instancing: boolean,
    saveMeshes: boolean,
    saveSkeletons: boolean,
    saveAnimations: boolean,
    srcVFS: VFS
  ) {
    const node: SceneNode = new SceneNode(scene);
    nodeMap.set(assetNode, node);
    node.name = assetNode.name ?? '';
    node.position.set(assetNode.position);
    node.rotation.set(assetNode.rotation);
    node.scale.set(assetNode.scaling);
    if (saveMeshes && assetNode.mesh) {
      const sourceMorphReferenceAssetPath =
        (this as SharedModelWithPreprocessOptions)._preprocessOptions?.sourceMorphReferenceAssetPath ?? null;
      const meshData = assetNode.mesh;
      const skeleton = saveSkeletons ? assetNode.skeleton : null;
      for (const subMesh of meshData.subMeshes) {
        if (assetNode.instances.length === 0) {
          assetNode.instances.push({ t: Vector3.zero(), s: Vector3.one(), r: Quaternion.identity() });
        }
        for (const instance of assetNode.instances) {
          const meshNode = new Mesh(scene);
          meshNode.position = instance.t;
          meshNode.scale = instance.s;
          meshNode.rotation = instance.r;
          meshNode.name = subMesh.name;
          meshNode.clipTestEnabled = true;
          meshNode.showState = 'inherit';
          if (!this._primitiveMap.get(subMesh.primitive!)) {
            this._primitiveMap.set(
              subMesh.primitive!,
              new DRef((await this.createPrimitive(manager, subMesh.primitive!, srcVFS)) ?? undefined)
            );
          }
          meshNode.primitive = this._primitiveMap.get(subMesh.primitive!)!.get()!;
          if (!subMesh.material!.material) {
            subMesh.material!.material = new DRef(
              (await this.createMaterial(manager, subMesh.material!, srcVFS)) ?? undefined
            );
          }
          meshNode.material = subMesh.material!.material?.get() ?? null;
          if (instancing) {
            meshNode.material = meshNode.material!.createInstance();
          }
          meshNode.parent = node;
          meshMap.set(subMesh, meshNode);
          setSceneMeshAssetBinding(meshNode, { node: assetNode, mesh: meshData, subMesh });
          const morphSource: MorphSourceDescriptor | null =
            sourceMorphReferenceAssetPath && subMesh.numTargets > 0
              ? (() => {
                  const nodePath = getAssetNodePath(assetNode);
                  const subMeshName = subMesh.name;
                  if (!nodePath || !subMeshName) {
                    return null;
                  }
                  return {
                    sourcePath: sourceMorphReferenceAssetPath,
                    nodePath,
                    subMeshName
                  };
                })()
              : null;
          processMorphData(
            subMesh,
            meshNode,
            assetNode.weights ?? meshData.morphWeights,
            meshData.morphNames,
            morphSource
          );
          applyMeshSkinInfluenceData(subMesh, meshNode);
          if (skeleton) {
            if (!skeletonMeshMap.has(skeleton)) {
              skeletonMeshMap.set(skeleton, { mesh: [meshNode], bounding: [subMesh] });
            } else {
              skeletonMeshMap.get(skeleton)!.mesh.push(meshNode);
              skeletonMeshMap.get(skeleton)!.bounding.push(subMesh);
            }
          }
        }
      }
    }
    node.parent = parent;
    for (const child of assetNode.children) {
      await this.setAssetNodeToSceneNode(
        manager,
        scene,
        node,
        child,
        skeletonMeshMap,
        nodeMap,
        meshMap,
        instancing,
        saveMeshes,
        saveSkeletons,
        saveAnimations,
        srcVFS
      );
    }
    return node;
  }
  private async image2Texture(
    manager: ResourceManager,
    info: AssetTextureInfo,
    srcVFS: VFS
  ): Promise<Nullable<Texture2D>> {
    if (info.image!.uri) {
      const texture = await manager.fetchTexture<Texture2D>(info.image!.uri, {
        linearColorSpace: !info.sRGB,
        overrideVFS: srcVFS
      });
      texture.name = info.image!.uri;
      return texture;
    } else if (info.image!.data && info.image!.mimeType) {
      const texture = await manager.loadTextureFromBuffer<Texture2D>(
        info.image!.data,
        info.image!.mimeType,
        !!info.sRGB
      );
      return texture;
    }
    return null;
  }
  private async createTexture(
    manager: ResourceManager,
    info: AssetTextureInfo,
    srcVFS: VFS
  ): Promise<Nullable<MaterialTextureInfo>> {
    try {
      let textureRef = this._textureMap.get(info);
      if (!textureRef) {
        textureRef = new DRef(await this.image2Texture(manager, info, srcVFS));
        this._textureMap.set(info, textureRef);
      }
      const sampler = getDevice().createSampler({
        addressU: info.sampler!.wrapS,
        addressV: info.sampler!.wrapT,
        magFilter: info.sampler!.magFilter,
        minFilter: info.sampler!.minFilter,
        mipFilter: info.sampler!.mipFilter
      });
      const transform = info.transform!;
      const texCoord = info.texCoord;
      return {
        texture: textureRef.get()!,
        sampler,
        texCoord,
        transform
      };
    } catch (err) {
      console.error(`Load asset texture failed: ${err}`);
      return null;
    }
  }

  private async createPrimitive(
    manager: ResourceManager,
    info: AssetPrimitiveInfo,
    srcVFS: VFS
  ): Promise<Nullable<Primitive>> {
    if (info.path) {
      return manager.fetchPrimitive(info.path, { overrideVFS: srcVFS });
    }
    const primitive = new Primitive();
    for (const k in info.vertices) {
      const v = info.vertices[k as VertexSemantic];
      primitive.createAndSetVertexBuffer(v.format, v.data);
    }
    if (info.indices) {
      primitive.createAndSetIndexBuffer(info.indices);
    }
    primitive.primitiveType = info.type;
    primitive.indexCount = info.indexCount;
    primitive.setBoundingVolume(new BoundingBox(info.boxMin, info.boxMax));
    return primitive;
  }
  private async createMaterial(
    manager: ResourceManager,
    assetMaterial: AssetMaterial,
    srcVFS: VFS
  ): Promise<Nullable<MeshMaterial>> {
    if (assetMaterial.path) {
      return manager.fetchMaterial<MeshMaterial>(assetMaterial.path, { overrideVFS: srcVFS });
    }
    const infoMap: Map<AssetTextureInfo, Nullable<MaterialTextureInfo>> = new Map();
    const that = this;
    async function getTextureInfo(info: AssetTextureInfo): Promise<Nullable<MaterialTextureInfo>> {
      let t = infoMap.get(info);
      if (t === undefined) {
        t = await that.createTexture(manager, info, srcVFS);
        infoMap.set(info, t);
      }
      return t;
    }
    if (assetMaterial.type === 'unlit') {
      const unlitAssetMaterial = assetMaterial as AssetUnlitMaterial;
      const unlitMaterial = new UnlitMaterial();
      unlitMaterial.albedoColor = unlitAssetMaterial.diffuse ?? Vector4.one();
      if (unlitAssetMaterial.diffuseMap) {
        const info = await getTextureInfo(unlitAssetMaterial.diffuseMap);
        if (info) {
          unlitMaterial.albedoTexture = info.texture;
          unlitMaterial.albedoTextureSampler = info.sampler;
          unlitMaterial.albedoTexCoordIndex = info.texCoord;
          unlitMaterial.albedoTexCoordMatrix = info.transform;
        }
      }
      unlitMaterial.vertexColor = unlitAssetMaterial.common.vertexColor!;
      if (assetMaterial.common.alphaMode === 'blend') {
        unlitMaterial.blendMode = 'blend';
      } else if (assetMaterial.common.alphaMode === 'mask') {
        unlitMaterial.alphaCutoff = assetMaterial.common.alphaCutoff!;
      }
      if (assetMaterial.common.doubleSided) {
        unlitMaterial.cullMode = 'none';
      }
      return unlitMaterial;
    } else if (assetMaterial.type === 'pbrSpecularGlossiness') {
      const assetPBRMaterial = assetMaterial as AssetPBRMaterialSG;
      const pbrMaterial = new PBRSpecularGlossinessMaterial();
      pbrMaterial.ior = assetPBRMaterial.ior!;
      pbrMaterial.albedoColor = assetPBRMaterial.diffuse!;
      pbrMaterial.specularFactor = new Vector3(
        assetPBRMaterial.specular!.x,
        assetPBRMaterial.specular!.y,
        assetPBRMaterial.specular!.z
      );
      pbrMaterial.glossinessFactor = assetPBRMaterial.glossness!;
      if (assetPBRMaterial.diffuseMap) {
        const info = await getTextureInfo(assetPBRMaterial.diffuseMap);
        if (info) {
          pbrMaterial.albedoTexture = info.texture;
          pbrMaterial.albedoTextureSampler = info.sampler;
          pbrMaterial.albedoTexCoordIndex = info.texCoord;
          pbrMaterial.albedoTexCoordMatrix = info.transform;
        }
      }
      if (assetPBRMaterial.common.normalMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.normalMap);
        if (info) {
          pbrMaterial.normalTexture = info.texture;
          pbrMaterial.normalTextureSampler = info.sampler;
          pbrMaterial.normalTexCoordIndex = info.texCoord;
          pbrMaterial.normalTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.normalScale = assetPBRMaterial.common.bumpScale!;
      if (assetPBRMaterial.common.emissiveMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.emissiveMap);
        if (info) {
          pbrMaterial.emissiveTexture = info.texture;
          pbrMaterial.emissiveTextureSampler = info.sampler;
          pbrMaterial.emissiveTexCoordIndex = info.texCoord;
          pbrMaterial.emissiveTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.emissiveColor = assetPBRMaterial.common.emissiveColor!;
      pbrMaterial.emissiveStrength = assetPBRMaterial.common.emissiveStrength!;
      if (assetPBRMaterial.common.occlusionMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.occlusionMap);
        if (info) {
          pbrMaterial.occlusionTexture = info.texture;
          pbrMaterial.occlusionTextureSampler = info.sampler;
          pbrMaterial.occlusionTexCoordIndex = info.texCoord;
          pbrMaterial.occlusionTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.occlusionStrength = assetPBRMaterial.common.occlusionStrength!;
      if (assetPBRMaterial.specularGlossnessMap) {
        const info = await getTextureInfo(assetPBRMaterial.specularGlossnessMap);
        if (info) {
          pbrMaterial.specularTexture = info.texture;
          pbrMaterial.specularTextureSampler = info.sampler;
          pbrMaterial.specularTexCoordIndex = info.texCoord;
          pbrMaterial.specularTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.vertexTangent = assetPBRMaterial.common.useTangent!;
      pbrMaterial.vertexColor = assetPBRMaterial.common.vertexColor!;
      if (assetPBRMaterial.common.alphaMode === 'blend') {
        pbrMaterial.blendMode = 'blend';
      } else if (assetPBRMaterial.common.alphaMode === 'mask') {
        pbrMaterial.alphaCutoff = assetPBRMaterial.common.alphaCutoff!;
      }
      if (assetPBRMaterial.common.doubleSided) {
        pbrMaterial.cullMode = 'none';
      }
      pbrMaterial.vertexNormal = !!assetMaterial.common.vertexNormal;
      return pbrMaterial;
    } else if (assetMaterial.type === 'pbrMetallicRoughness') {
      const assetPBRMaterial = assetMaterial as AssetPBRMaterialMR;
      const pbrMaterial = new PBRMetallicRoughnessMaterial();
      pbrMaterial.ior = assetPBRMaterial.ior!;
      pbrMaterial.albedoColor = assetPBRMaterial.diffuse!;
      pbrMaterial.metallic = assetPBRMaterial.metallic!;
      pbrMaterial.roughness = assetPBRMaterial.roughness!;
      if (assetPBRMaterial.diffuseMap) {
        const info = await getTextureInfo(assetPBRMaterial.diffuseMap);
        if (info) {
          pbrMaterial.albedoTexture = info.texture;
          pbrMaterial.albedoTextureSampler = info.sampler;
          pbrMaterial.albedoTexCoordIndex = info.texCoord;
          pbrMaterial.albedoTexCoordMatrix = info.transform;
        }
      }
      if (assetPBRMaterial.common.normalMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.normalMap);
        if (info) {
          pbrMaterial.normalTexture = info.texture;
          pbrMaterial.normalTextureSampler = info.sampler;
          pbrMaterial.normalTexCoordIndex = info.texCoord;
          pbrMaterial.normalTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.normalScale = assetPBRMaterial.common.bumpScale!;
      if (assetPBRMaterial.common.emissiveMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.emissiveMap);
        if (info) {
          pbrMaterial.emissiveTexture = info.texture;
          pbrMaterial.emissiveTextureSampler = info.sampler;
          pbrMaterial.emissiveTexCoordIndex = info.texCoord;
          pbrMaterial.emissiveTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.emissiveColor = assetPBRMaterial.common.emissiveColor!;
      pbrMaterial.emissiveStrength = assetPBRMaterial.common.emissiveStrength!;
      if (assetPBRMaterial.common.occlusionMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.occlusionMap);
        if (info) {
          pbrMaterial.occlusionTexture = info.texture;
          pbrMaterial.occlusionTextureSampler = info.sampler;
          pbrMaterial.occlusionTexCoordIndex = info.texCoord;
          pbrMaterial.occlusionTexCoordMatrix = info.transform;
        }
        pbrMaterial.occlusionStrength = assetPBRMaterial.common.occlusionStrength!;
      }
      if (assetPBRMaterial.metallicMap) {
        const info = await getTextureInfo(assetPBRMaterial.metallicMap);
        if (info) {
          pbrMaterial.metallicRoughnessTexture = info.texture;
          pbrMaterial.metallicRoughnessTextureSampler = info.sampler;
          pbrMaterial.metallicRoughnessTexCoordIndex = info.texCoord;
          pbrMaterial.metallicRoughnessTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.specularFactor = assetPBRMaterial.specularFactor!;
      if (assetPBRMaterial.specularMap) {
        const info = await getTextureInfo(assetPBRMaterial.specularMap);
        if (info) {
          pbrMaterial.specularTexture = info.texture;
          pbrMaterial.specularTextureSampler = info.sampler;
          pbrMaterial.specularTexCoordIndex = info.texCoord;
          pbrMaterial.specularTexCoordMatrix = info.transform;
        }
      }
      if (assetPBRMaterial.specularColorMap) {
        const info = await getTextureInfo(assetPBRMaterial.specularColorMap);
        if (info) {
          pbrMaterial.specularColorTexture = info.texture;
          pbrMaterial.specularColorTextureSampler = info.sampler;
          pbrMaterial.specularColorTexCoordIndex = info.texCoord;
          pbrMaterial.specularColorTexCoordMatrix = info.transform;
        }
      }
      if (assetPBRMaterial.sheen) {
        const sheen = assetPBRMaterial.sheen;
        pbrMaterial.sheen = true;
        pbrMaterial.sheenColorFactor = sheen.sheenColorFactor!;
        pbrMaterial.sheenRoughnessFactor = sheen.sheenRoughnessFactor!;
        if (sheen.sheenColorMap) {
          const info = await getTextureInfo(sheen.sheenColorMap);
          if (info) {
            pbrMaterial.sheenColorTexture = info.texture;
            pbrMaterial.sheenColorTextureSampler = info.sampler;
            pbrMaterial.sheenColorTexCoordIndex = info.texCoord;
            pbrMaterial.sheenColorTexCoordMatrix = info.transform;
          }
        }
        if (sheen.sheenRoughnessMap) {
          const info = await getTextureInfo(sheen.sheenRoughnessMap);
          if (info) {
            pbrMaterial.sheenRoughnessTexture = info.texture;
            pbrMaterial.sheenRoughnessTextureSampler = info.sampler;
            pbrMaterial.sheenRoughnessTexCoordIndex = info.texCoord;
            pbrMaterial.sheenRoughnessTexCoordMatrix = info.transform;
          }
        }
      }
      if (assetPBRMaterial.iridescence) {
        const iridescence = assetPBRMaterial.iridescence;
        pbrMaterial.iridescence = true;
        pbrMaterial.iridescenceFactor = iridescence.iridescenceFactor!;
        pbrMaterial.iridescenceIor = iridescence.iridescenceIor!;
        if (iridescence.iridescenceMap) {
          const info = await getTextureInfo(iridescence.iridescenceMap);
          if (info) {
            pbrMaterial.iridescenceTexture = info.texture;
            pbrMaterial.iridescenceTextureSampler = info.sampler;
            pbrMaterial.iridescenceTexCoordIndex = info.texCoord;
            pbrMaterial.iridescenceTexCoordMatrix = info.transform;
          }
        }
        pbrMaterial.iridescenceThicknessMin = iridescence.iridescenceThicknessMinimum!;
        pbrMaterial.iridescenceThicknessMax = iridescence.iridescenceThicknessMaximum!;
        if (iridescence.iridescenceThicknessMap) {
          const info = await getTextureInfo(iridescence.iridescenceThicknessMap);
          if (info) {
            pbrMaterial.iridescenceThicknessTexture = info.texture;
            pbrMaterial.iridescenceThicknessTextureSampler = info.sampler;
            pbrMaterial.iridescenceThicknessTexCoordIndex = info.texCoord;
            pbrMaterial.iridescenceThicknessTexCoordMatrix = info.transform;
          }
        }
      }
      if (assetPBRMaterial.transmission) {
        const transmission = assetPBRMaterial.transmission;
        pbrMaterial.transmission = true;
        pbrMaterial.transmissionFactor = transmission.transmissionFactor!;
        if (transmission.transmissionMap) {
          const info = await getTextureInfo(transmission.transmissionMap);
          if (info) {
            pbrMaterial.transmissionTexture = info.texture;
            pbrMaterial.transmissionTextureSampler = info.sampler;
            pbrMaterial.transmissionTexCoordIndex = info.texCoord;
            pbrMaterial.transmissionTexCoordMatrix = info.transform;
          }
        }
        pbrMaterial.thicknessFactor = transmission.thicknessFactor!;
        if (transmission.thicknessMap) {
          const info = await getTextureInfo(transmission.thicknessMap);
          if (info) {
            pbrMaterial.thicknessTexture = info.texture;
            pbrMaterial.thicknessTextureSampler = info.sampler;
            pbrMaterial.thicknessTexCoordIndex = info.texCoord;
            pbrMaterial.thicknessTexCoordMatrix = info.transform;
          }
        }
        pbrMaterial.attenuationDistance = transmission.attenuationDistance!;
        pbrMaterial.attenuationColor = transmission.attenuationColor!;
      }
      if (assetPBRMaterial.clearcoat) {
        const cc = assetPBRMaterial.clearcoat;
        pbrMaterial.clearcoat = true;
        pbrMaterial.clearcoatIntensity = cc.clearCoatFactor!;
        pbrMaterial.clearcoatRoughnessFactor = cc.clearCoatRoughnessFactor!;
        if (cc.clearCoatIntensityMap) {
          const info = await getTextureInfo(cc.clearCoatIntensityMap);
          if (info) {
            pbrMaterial.clearcoatIntensityTexture = info.texture;
            pbrMaterial.clearcoatIntensityTextureSampler = info.sampler;
            pbrMaterial.clearcoatIntensityTexCoordIndex = info.texCoord;
            pbrMaterial.clearcoatIntensityTexCoordMatrix = info.transform;
          }
        }
        if (cc.clearCoatRoughnessMap) {
          const info = await getTextureInfo(cc.clearCoatRoughnessMap);
          if (info) {
            pbrMaterial.clearcoatRoughnessTexture = info.texture;
            pbrMaterial.clearcoatRoughnessTextureSampler = info.sampler;
            pbrMaterial.clearcoatRoughnessTexCoordIndex = info.texCoord;
            pbrMaterial.clearcoatRoughnessTexCoordMatrix = info.transform;
          }
        }
        if (cc.clearCoatNormalMap) {
          const info = await getTextureInfo(cc.clearCoatNormalMap);
          if (info) {
            pbrMaterial.clearcoatNormalTexture = info.texture;
            pbrMaterial.clearcoatNormalTextureSampler = info.sampler;
            pbrMaterial.clearcoatNormalTexCoordIndex = info.texCoord;
            pbrMaterial.clearcoatNormalTexCoordMatrix = info.transform;
          }
        }
      }
      pbrMaterial.vertexTangent = assetPBRMaterial.common.useTangent!;
      pbrMaterial.vertexColor = assetPBRMaterial.common.vertexColor!;
      if (assetPBRMaterial.common.alphaMode === 'blend') {
        pbrMaterial.blendMode = 'blend';
      } else if (assetPBRMaterial.common.alphaMode === 'mask') {
        pbrMaterial.alphaCutoff = assetPBRMaterial.common.alphaCutoff!;
      }
      if (assetPBRMaterial.common.doubleSided) {
        pbrMaterial.cullMode = 'none';
      }
      pbrMaterial.vertexNormal = !!assetMaterial.common.vertexNormal;
      return pbrMaterial;
    }
    return null;
  }
}

export function applyMeshMorphMetadata(
  subMesh: AssetSubMeshData,
  mesh: Mesh,
  morphWeights?: Nullable<number[]>,
  morphNames?: Nullable<string[]>
) {
  const numTargets = subMesh.numTargets;
  if (numTargets === 0 || !subMesh.targets || !subMesh.targetBox) {
    return;
  }
  const supportedNumTargets = Math.min(numTargets, getMorphTargetLimit());
  if (supportedNumTargets !== numTargets) {
    console.warn(
      `Morph target count truncated from ${numTargets} to ${supportedNumTargets} for mesh "${subMesh.name ?? mesh.name ?? ''}"`
    );
  }
  const attributes = Object.getOwnPropertyNames(subMesh.targets);
  const positionInfo = subMesh.primitive!.vertices['position'];
  const numVertices = positionInfo
    ? (positionInfo.data.length / getVertexFormatComponentCount(positionInfo.format)) >> 0
    : 0;
  const weightsAndOffsets = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
  for (let i = 0; i < supportedNumTargets; i++) {
    weightsAndOffsets[4 + i] = morphWeights?.[i] ?? 0;
  }
  const textureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * numTargets));
  weightsAndOffsets[0] = textureSize;
  weightsAndOffsets[1] = textureSize;
  weightsAndOffsets[2] = numVertices;
  weightsAndOffsets[3] = supportedNumTargets;
  let offset = 0;
  for (let attrib = 0; attrib < MAX_MORPH_ATTRIBUTES; attrib++) {
    const index = attributes.indexOf(String(attrib));
    if (index < 0) {
      weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = -1;
      continue;
    }
    weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = offset >> 2;
    const info = subMesh.targets![attrib]!;
    if (info.data.length !== numTargets) {
      console.error(`Invalid morph target data`);
      return;
    }
    offset += numVertices * 4 * numTargets;
  }

  const names: Record<string, number> = {};
  for (let i = 0; i < supportedNumTargets; i++) {
    const name = morphNames?.[i] ?? `Target${i}`;
    names[name] = i;
  }
  mesh.setMorphInfo({ data: weightsAndOffsets, names });
  mesh.setMorphBoundingInfo({
    targetBoxes: subMesh.targetBox!.slice(0, supportedNumTargets),
    originBox: new BoundingBox(mesh.getBoundingVolume()!.toAABB())
  });
}

export function createMorphSourceDataFromSubMesh(subMesh: AssetSubMeshData): Nullable<MorphTargetSourceData> {
  const numTargets = Math.min(subMesh.numTargets, getMorphTargetLimit());
  if (numTargets === 0 || !subMesh.targets) {
    return null;
  }
  const positionInfo = subMesh.primitive!.vertices['position'];
  const numVertices = positionInfo
    ? (positionInfo.data.length / getVertexFormatComponentCount(positionInfo.format)) >> 0
    : 0;
  const targets: MorphTargetSourceData['targets'] = {};
  for (const [attribKey, info] of Object.entries(subMesh.targets)) {
    const attrib = Number(attribKey);
    if (!info || !Number.isInteger(attrib) || attrib < 0) {
      continue;
    }
    if (info.data.length < numTargets) {
      console.error(`Invalid morph target data`);
      return null;
    }
    targets[attrib] = {
      numComponents: info.numComponents,
      data: info.data.slice(0, numTargets),
      indices: info.indices?.slice(0, numTargets)
    };
  }
  return {
    numTargets,
    numVertices,
    targets
  };
}

export function applyMeshMorphData(subMesh: AssetSubMeshData, mesh: Mesh) {
  const sourceData = createMorphSourceDataFromSubMesh(subMesh);
  if (!sourceData) {
    mesh.setMorphData(null);
    mesh.setMorphSourceData(null);
    return;
  }
  mesh.setMorphSourceData(sourceData);
}

function createSkinInfluenceDataFromSubMesh(subMesh: AssetSubMeshData) {
  const influenceCount = Math.max(
    0,
    Math.min(
      subMesh.rawSkinInfluenceCount ?? 4,
      getSkinInfluenceLimit(),
      Math.floor((subMesh.rawJointWeights?.length ?? 0) / Math.max(1, (subMesh.rawPositions?.length ?? 0) / 3))
    )
  );
  if (
    influenceCount <= 4 ||
    !subMesh.rawPositions ||
    !subMesh.rawBlendIndices ||
    !subMesh.rawJointWeights ||
    subMesh.rawPositions.length < 3
  ) {
    return null;
  }
  const numVertices = Math.floor(subMesh.rawPositions.length / 3);
  if (numVertices <= 0) {
    return null;
  }
  const extraInfluenceCount = influenceCount - 4;
  const pairCount = Math.ceil(extraInfluenceCount / 2);
  const textureSize = Math.ceil(Math.sqrt(numVertices * pairCount));
  const textureData = new Float32Array(textureSize * textureSize * 4);
  for (let vertexIndex = 0; vertexIndex < numVertices; vertexIndex++) {
    const baseOffset = vertexIndex * influenceCount + 4;
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
      const sourceIndex = baseOffset + pairIndex * 2;
      const texelOffset = (vertexIndex * pairCount + pairIndex) * 4;
      textureData[texelOffset] = Number(subMesh.rawBlendIndices[sourceIndex] ?? 0);
      textureData[texelOffset + 1] = Number(subMesh.rawJointWeights[sourceIndex] ?? 0);
      textureData[texelOffset + 2] = Number(subMesh.rawBlendIndices[sourceIndex + 1] ?? 0);
      textureData[texelOffset + 3] = Number(subMesh.rawJointWeights[sourceIndex + 1] ?? 0);
    }
  }
  return {
    width: textureSize,
    height: textureSize,
    influenceCount,
    data: textureData
  };
}

export function applyMeshSkinInfluenceData(subMesh: AssetSubMeshData, mesh: Mesh) {
  mesh.setSkinInfluenceData(createSkinInfluenceDataFromSubMesh(subMesh));
}

/** @internal */
function processMorphData(
  subMesh: AssetSubMeshData,
  mesh: Mesh,
  morphWeights?: Nullable<number[]>,
  morphNames?: Nullable<string[]>,
  morphSource?: Nullable<MorphSourceDescriptor>
) {
  if (subMesh.numTargets === 0) {
    return;
  }
  applyMeshMorphMetadata(subMesh, mesh, morphWeights, morphNames);
  mesh.setMorphSource(morphSource ?? null);
  if (morphSource) {
    mesh.setMorphSourceData(null);
    mesh.setMorphData(null);
  } else {
    applyMeshMorphData(subMesh, mesh);
  }
}

/** @internal */
function getAssetMeshMorphTargetCount(mesh: AssetMeshData): number {
  let count = 0;
  for (const subMesh of mesh.subMeshes) {
    count = Math.max(count, subMesh.numTargets);
  }
  return Math.min(count, getMorphTargetLimit());
}

/** @internal */
function getAssetMeshMorphTargetName(mesh: AssetMeshData, index: number): string {
  return mesh.morphNames?.[index] ?? `Target${index}`;
}
