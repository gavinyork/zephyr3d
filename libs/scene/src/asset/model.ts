import type { Vector4, TypedArray, Interpolator } from '@zephyr3d/base';
import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { Texture2D, TextureSampler } from '@zephyr3d/device';
import type { Primitive } from '../render/primitive';
import type { MeshMaterial } from '../material/meshmaterial';
import type { Mesh } from '../scene/mesh';
import type { BoundingBox } from '../utility';

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

/**
 * Texture information for model loading
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
  normalMap?: MaterialTextureInfo;
  bumpScale?: number;
  emissiveMap?: MaterialTextureInfo;
  emissiveColor?: Vector3;
  emissiveStrength?: number;
  occlusionMap?: MaterialTextureInfo;
  occlusionStrength?: number;
}

/**
 * Base material properties for model loading
 * @public
 */
export interface AssetMaterial {
  type: string;
  common: AssetMaterialCommon;
}

/**
 * Unlit related material properties for model loading
 * @public
 */
export interface AssetUnlitMaterial extends AssetMaterial {
  diffuseMap?: MaterialTextureInfo;
  diffuse?: Vector4;
}

/**
 * Sheen related material properties for model loading
 * @public
 */
export interface AssetMaterialSheen {
  sheenColorFactor?: Vector3;
  sheenColorMap?: MaterialTextureInfo;
  sheenRoughnessFactor?: number;
  sheenRoughnessMap?: MaterialTextureInfo;
}

/**
 * Clearcoat related material properties for model loading
 * @public
 */
export interface AssetMaterialClearcoat {
  clearCoatFactor?: number;
  clearCoatIntensityMap?: MaterialTextureInfo;
  clearCoatRoughnessFactor?: number;
  clearCoatRoughnessMap?: MaterialTextureInfo;
  clearCoatNormalMap?: MaterialTextureInfo;
}

/**
 * Transmission related material properties for model loading
 * @public
 */
export interface AssetMaterialTransmission {
  transmissionFactor?: number;
  transmissionMap?: MaterialTextureInfo;
  thicknessFactor?: number;
  thicknessMap?: MaterialTextureInfo;
  attenuationColor?: Vector3;
  attenuationDistance?: number;
}

/**
 * Iridescence related material properties for model loading
 * @public
 */
export interface AssetMaterialIridescence {
  iridescenceFactor?: number;
  iridescenceMap?: MaterialTextureInfo;
  iridescenceIor?: number;
  iridescenceThicknessMinimum?: number;
  iridescenceThicknessMaximum?: number;
  iridescenceThicknessMap?: MaterialTextureInfo;
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
  metallicMap?: MaterialTextureInfo;
  metallicIndex?: number;
  roughnessIndex?: number;
  specularMap?: MaterialTextureInfo;
  specularColorMap?: MaterialTextureInfo;
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
  specularGlossnessMap?: MaterialTextureInfo;
}

/**
 * Sub mesh data interface for model loading
 * @public
 */
export interface AssetSubMeshData {
  primitive: Primitive;
  material: MeshMaterial;
  mesh?: Mesh;
  rawPositions: Float32Array;
  rawBlendIndices: TypedArray;
  rawJointWeights: TypedArray;
  name: string;
  numTargets: number;
  targets?: Partial<Record<number, { numComponents: number; data: Float32Array[] }>>;
  targetBox?: BoundingBox[];
  morphAttribCount?: number;
}

/**
 * Mesh data interface for model loading
 * @public
 */
export interface AssetMeshData {
  morphWeights?: number[];
  subMeshes: AssetSubMeshData[];
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
 * Animation data interface for model loading
 * @public
 */
export interface AssetAnimationData {
  name: string;
  tracks: AssetAnimationTrack[];
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
  private _parent: AssetHierarchyNode;
  private _position: Vector3;
  private _rotation: Quaternion;
  private _scaling: Vector3;
  private _mesh: AssetMeshData;
  private _skeleton: AssetSkeleton;
  private _attachToSkeleton: Set<AssetSkeleton>;
  private _meshAttached: boolean;
  private _matrix: Matrix4x4;
  private _worldMatrix: Matrix4x4;
  private _weights: number[];
  private _children: AssetHierarchyNode[];
  private _instances?: { t: Vector3; s: Vector3; r: Quaternion }[];
  /**
   * Creates an instance of AssetHierarchyNode
   * @param name - Name of the node
   * @param parent - Parent of the node
   */
  constructor(name: string, parent?: AssetHierarchyNode) {
    super(name);
    this._parent = null;
    this._position = Vector3.zero();
    this._rotation = Quaternion.identity();
    this._scaling = Vector3.one();
    this._children = [];
    this._mesh = null;
    this._skeleton = null;
    this._attachToSkeleton = null;
    this._meshAttached = false;
    this._matrix = null;
    this._weights = null;
    this._worldMatrix = null;
    this._instances = [];
    parent?.addChild(this);
  }
  /** Parent of the node */
  get parent(): AssetHierarchyNode {
    return this._parent;
  }
  /** Local transformation matrix of the node */
  get matrix(): Matrix4x4 {
    return this._matrix;
  }
  /** World transformation matrix of the node */
  get worldMatrix(): Matrix4x4 {
    return this._worldMatrix;
  }
  /** Mesh data of the node, or null if this is not a mesh node */
  get mesh(): AssetMeshData {
    return this._mesh;
  }
  set mesh(data: AssetMeshData) {
    this._mesh = data;
    this.setMeshAttached();
  }
  /** instances */
  get instances(): { t: Vector3; s: Vector3; r: Quaternion }[] {
    return this._instances;
  }
  /** Default morph target weights */
  get weights(): number[] {
    return this._weights;
  }
  set weights(val: number[]) {
    this._weights = val;
  }
  /** The skeleton used to control the node */
  get skeleton(): AssetSkeleton {
    return this._skeleton;
  }
  set skeleton(skeleton: AssetSkeleton) {
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
  /** true if the node is parent of a mesh node */
  get meshAttached(): boolean {
    return this._meshAttached;
  }
  /** Children of the node */
  get children(): AssetHierarchyNode[] {
    return this._children;
  }
  /** The skeleton to which the node belongs if this is a joint node */
  get skeletonAttached(): Set<AssetSkeleton> {
    return this._attachToSkeleton;
  }
  /** @internal */
  computeTransforms(parentTransform: Matrix4x4) {
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
    if (child.meshAttached) {
      this.setMeshAttached();
    }
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
  attachToSkeleton(skeleton: AssetSkeleton, index: number) {
    if (!this._attachToSkeleton) {
      this._attachToSkeleton = new Set();
    }
    this._attachToSkeleton.add(skeleton);
  }
  /** @internal */
  private setMeshAttached() {
    this._meshAttached = true;
    this._parent?.setMeshAttached();
  }
}

/**
 * Skeleton information for model loading
 * @public
 */
export class AssetSkeleton extends NamedObject {
  /** The pivot node */
  pivot: AssetHierarchyNode;
  /** Joints of the skeleton */
  joints: AssetHierarchyNode[];
  /** Inverse of the binding matrices of the joints */
  inverseBindMatrices: Matrix4x4[];
  /** Binding pose matrices of the joints */
  bindPoseMatrices: Matrix4x4[];
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
    this.bindPoseMatrices = [];
  }
  /**
   * Adds a joint to the skeleton
   * @param joint - The joint node
   * @param inverseBindMatrix - Inverse binding matrix of the joint
   */
  addJoint(joint: AssetHierarchyNode, inverseBindMatrix: Matrix4x4) {
    joint.attachToSkeleton(this, this.joints.length);
    this.joints.push(joint);
    this.inverseBindMatrices.push(inverseBindMatrix);
    this.bindPoseMatrices.push(joint.worldMatrix);
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
 * Model information that can be shared by multiple model nodes
 * @public
 */
export class SharedModel {
  /** @internal */
  private _name: string;
  /** @internal */
  private _skeletons: AssetSkeleton[];
  /** @internal */
  private _nodes: AssetHierarchyNode[];
  /** @internal */
  private _animations: AssetAnimationData[];
  /** @internal */
  private _scenes: AssetScene[];
  /** @internal */
  private _activeScene: number;
  /**
   * Creates an instance of SharedModel
   * @param name - Name of the model
   */
  constructor(name?: string) {
    this._name = name || '';
    this._skeletons = [];
    this._nodes = [];
    this._scenes = [];
    this._animations = [];
    this._activeScene = -1;
  }
  /** Name of the model */
  get name(): string {
    return this._name;
  }
  set name(val: string) {
    this._name = val;
  }
  /** All scenes that the model contains */
  get scenes(): AssetScene[] {
    return this._scenes;
  }
  /** All animations that the model contains */
  get animations(): AssetAnimationData[] {
    return this._animations;
  }
  /** All skeletons that the model contains */
  get skeletons(): AssetSkeleton[] {
    return this._skeletons;
  }
  /** All nodes that the model contains */
  get nodes(): AssetHierarchyNode[] {
    return this._nodes;
  }
  /** The active scene of the model */
  get activeScene(): number {
    return this._activeScene;
  }
  set activeScene(val: number) {
    this._activeScene = val;
  }
  /**
   * Adds a node to the scene
   * @param parent - Under which node the node should be added
   * @param index - Index of the node
   * @param name - Name of the node
   * @returns The added node
   */
  addNode(parent: AssetHierarchyNode, index: number, name: string): AssetHierarchyNode {
    const childNode = new AssetHierarchyNode(name, parent);
    this._nodes[index] = childNode;
    return childNode;
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
}
