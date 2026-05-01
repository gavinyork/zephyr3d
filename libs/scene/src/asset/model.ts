import type { Vector4, TypedArray, Interpolator, Nullable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { Disposable, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import { type Texture2D, type TextureSampler } from '@zephyr3d/device';
import type { Primitive } from '../render/primitive';
import type { MeshMaterial } from '../material/meshmaterial';
import { Mesh } from '../scene/mesh';
import type { BoundingBox } from '../utility';
import type { Scene } from '../scene';
import { SceneNode } from '../scene/scene_node';
import { NodeRotationTrack, NodeScaleTrack, Skeleton, NodeTranslationTrack } from '../animation';
import { processMorphData } from '../animation/morphtarget';
import { MAX_MORPH_TARGETS } from '../values';
import { MorphTargetTrack } from '../animation/morphtrack';
import {
  FixedGeometryCacheTrack,
  type FixedGeometryCacheFrame
} from '../animation/fixed_geometry_cache_track';
import { PCAGeometryCacheTrack, type PCAGeometryCacheTrackData } from '../animation/pca_geometry_cache_track';

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
  texture: Nullable<Texture2D>;
  sampler: Nullable<TextureSampler>;
  texCoord: number;
  transform: Nullable<Matrix4x4>;
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
  normalMap?: Nullable<MaterialTextureInfo>;
  bumpScale?: number;
  emissiveMap?: Nullable<MaterialTextureInfo>;
  emissiveColor?: Vector3;
  emissiveStrength?: number;
  occlusionMap?: Nullable<MaterialTextureInfo>;
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
  diffuseMap?: Nullable<MaterialTextureInfo>;
  diffuse?: Vector4;
}

/**
 * Sheen related material properties for model loading
 * @public
 */
export interface AssetMaterialSheen {
  sheenColorFactor?: Vector3;
  sheenColorMap?: Nullable<MaterialTextureInfo>;
  sheenRoughnessFactor?: number;
  sheenRoughnessMap?: Nullable<MaterialTextureInfo>;
}

/**
 * Clearcoat related material properties for model loading
 * @public
 */
export interface AssetMaterialClearcoat {
  clearCoatFactor?: number;
  clearCoatIntensityMap?: Nullable<MaterialTextureInfo>;
  clearCoatRoughnessFactor?: number;
  clearCoatRoughnessMap?: Nullable<MaterialTextureInfo>;
  clearCoatNormalMap?: Nullable<MaterialTextureInfo>;
}

/**
 * Transmission related material properties for model loading
 * @public
 */
export interface AssetMaterialTransmission {
  transmissionFactor?: number;
  transmissionMap?: Nullable<MaterialTextureInfo>;
  thicknessFactor?: number;
  thicknessMap?: Nullable<MaterialTextureInfo>;
  attenuationColor?: Vector3;
  attenuationDistance?: number;
}

/**
 * Iridescence related material properties for model loading
 * @public
 */
export interface AssetMaterialIridescence {
  iridescenceFactor?: number;
  iridescenceMap?: Nullable<MaterialTextureInfo>;
  iridescenceIor?: number;
  iridescenceThicknessMinimum?: number;
  iridescenceThicknessMaximum?: number;
  iridescenceThicknessMap?: Nullable<MaterialTextureInfo>;
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
  metallicMap?: Nullable<MaterialTextureInfo>;
  metallicIndex?: number;
  roughnessIndex?: number;
  specularMap?: Nullable<MaterialTextureInfo>;
  specularColorMap?: Nullable<MaterialTextureInfo>;
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
  specularGlossnessMap?: Nullable<MaterialTextureInfo>;
}

/**
 * Sub mesh data interface for model loading
 * @public
 */
export interface AssetSubMeshData {
  primitive: DRef<Primitive>;
  material: DRef<MeshMaterial>;
  mesh?: Mesh;
  rawPositions: Nullable<Float32Array>;
  rawBlendIndices: Nullable<TypedArray>;
  rawJointWeights: Nullable<TypedArray>;
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
  morphWeights?: Nullable<number[]>;
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
 * Fixed-frame geometry cache animation track data.
 *
 * @public
 */
export interface AssetFixedGeometryCacheAnimationTrack {
  node: AssetHierarchyNode;
  type: 'geometry-cache';
  codec?: 'fixed';
  subMeshIndex: number;
  times: Float32Array;
  frames: FixedGeometryCacheFrame[];
}

/**
 * PCA-compressed geometry cache animation track data.
 *
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
 * Geometry cache animation track data.
 *
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
  private _meshAttached: boolean;
  private _matrix: Nullable<Matrix4x4>;
  private _worldMatrix: Nullable<Matrix4x4>;
  private _weights: Nullable<number[]>;
  private readonly _children: AssetHierarchyNode[];
  private readonly _instances?: { t: Vector3; s: Vector3; r: Quaternion }[];
  /**
   * Creates an instance of AssetHierarchyNode
   * @param name - Name of the node
   * @param parent - Parent of the node
   */
  constructor(name: string, parent?: Nullable<AssetHierarchyNode>) {
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
  get parent() {
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
    this.setMeshAttached();
  }
  /** instances */
  get instances() {
    return this._instances ?? null;
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
  get position() {
    return this._position;
  }
  set position(val) {
    this._position = val;
  }
  /** The rotation of the node */
  get rotation() {
    return this._rotation;
  }
  set rotation(val) {
    this._rotation = val;
  }
  /** The scale of the node */
  get scaling() {
    return this._scaling;
  }
  set scaling(val) {
    this._scaling = val;
  }
  /** true if the node is parent of a mesh node */
  get meshAttached() {
    return this._meshAttached;
  }
  /** Children of the node */
  get children() {
    return this._children;
  }
  /** The skeleton to which the node belongs if this is a joint node */
  get skeletonAttached() {
    return this._attachToSkeleton;
  }
  /** @internal */
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
  attachToSkeleton(skeleton: AssetSkeleton) {
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
export class SharedModel extends Disposable {
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
    super();
    this._name = name || '';
    this._skeletons = [];
    this._nodes = [];
    this._scenes = [];
    this._animations = [];
    this._activeScene = -1;
  }
  /** Name of the model */
  get name() {
    return this._name;
  }
  set name(val) {
    this._name = val;
  }
  /** All scenes that the model contains */
  get scenes() {
    return this._scenes;
  }
  /** All animations that the model contains */
  get animations() {
    return this._animations;
  }
  /** All skeletons that the model contains */
  get skeletons() {
    return this._skeletons;
  }
  /** All nodes that the model contains */
  get nodes() {
    return this._nodes;
  }
  /** The active scene of the model */
  get activeScene() {
    return this._activeScene;
  }
  set activeScene(val) {
    this._activeScene = val;
  }
  /**
   * Adds a node to the scene
   * @param parent - Under which node the node should be added
   * @param index - Index of the node
   * @param name - Name of the node
   * @returns The added node
   */
  addNode(parent: Nullable<AssetHierarchyNode>, index: number, name: string) {
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
  createSceneNode(scene: Scene, instancing: boolean) {
    const group = new SceneNode(scene);
    group.name = this.name;
    const animationSet = group.animationSet;
    for (let i = 0; i < this.scenes.length; i++) {
      const assetScene = this.scenes[i];
      const skeletonMeshMap: Map<
        AssetSkeleton,
        { mesh: Mesh[]; bounding: AssetSubMeshData[]; skeleton?: Skeleton }
      > = new Map();
      const nodeMap: Map<AssetHierarchyNode, SceneNode> = new Map();
      for (let k = 0; k < assetScene.rootNodes.length; k++) {
        this.setAssetNodeToSceneNode(
          scene,
          group,
          assetScene.rootNodes[k],
          skeletonMeshMap,
          nodeMap,
          instancing
        );
      }
      for (const animationData of this.animations) {
        let name = animationData.name ?? `_embbeded_animation`;
        if (animationSet.getAnimationClip(name)) {
          const baseName = name;
          for (let t = 1; ; t++) {
            name = `${baseName}_${t}`;
            if (!animationSet.getAnimationClip(name)) {
              break;
            }
          }
        }
        const animation = animationSet.createAnimation(name, true)!;
        for (const track of animationData.tracks) {
          if (track.type === 'translation') {
            animation.addTrack(nodeMap.get(track.node)!, new NodeTranslationTrack(track.interpolator, true));
          } else if (track.type === 'scale') {
            animation.addTrack(nodeMap.get(track.node)!, new NodeScaleTrack(track.interpolator, true));
          } else if (track.type === 'rotation') {
            animation.addTrack(nodeMap.get(track.node)!, new NodeRotationTrack(track.interpolator, true));
          } else if (track.type === 'weights') {
            for (const m of track.node.mesh!.subMeshes) {
              if (track.interpolator.stride > MAX_MORPH_TARGETS) {
                console.error(
                  `Morph target too large: ${track.interpolator.stride}, the maximum is ${MAX_MORPH_TARGETS}`
                );
              } else {
                const morphTrack = new MorphTargetTrack(
                  track.interpolator,
                  track.defaultMorphWeights,
                  m.targetBox,
                  m.mesh!.getBoundingVolume()!.toAABB(),
                  true
                );
                animation.addTrack(m.mesh!, morphTrack);
              }
            }
          } else if (track.type === 'geometry-cache') {
            const subMesh = track.node.mesh?.subMeshes[track.subMeshIndex];
            if (!subMesh?.mesh) {
              console.error(`Invalid geometry cache sub mesh: ${track.subMeshIndex}`);
            } else {
              if (track.codec === 'pca') {
                const pcaData = this.remapPCAGeometryCacheData(subMesh, track);
                animation.addTrack(subMesh.mesh, new PCAGeometryCacheTrack(pcaData, true));
              } else {
                const frames = this.remapGeometryCacheFrames(subMesh, track.frames);
                animation.addTrack(subMesh.mesh, new FixedGeometryCacheTrack(track.times, frames, true));
              }
            }
          } else {
            console.error(`Invalid animation track type: ${track.type}`);
          }
        }
        for (const sk of animationData.skeletons) {
          const nodes = skeletonMeshMap.get(sk);
          if (nodes) {
            if (!nodes.skeleton) {
              nodes.skeleton = new Skeleton(
                sk.joints.map((val) => nodeMap.get(val)!),
                sk.inverseBindMatrices,
                sk.bindPose
              );
              for (let i = 0; i < nodes.mesh.length; i++) {
                const mesh = nodes.mesh[i];
                const v = {
                  positions: nodes.bounding[i].rawPositions!,
                  blendIndices: nodes.bounding[i].rawBlendIndices!,
                  weights: nodes.bounding[i].rawJointWeights!
                };
                mesh.setSkinnedBoundingInfo(nodes.skeleton.getBoundingInfo(v));
                mesh.skeletonName = nodes.skeleton.persistentId;
              }
              animationSet.skeletons.push(new DRef(nodes.skeleton));
            }
            animation.addSkeleton(nodes.skeleton.persistentId);
          }
        }
      }
    }
    group.iterate((child) => {
      if (child !== group) {
        child.sealed = true;
      }
    });
    group.sharedModel = this;
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
    const nodes = [...this._nodes];
    while (nodes.length > 0) {
      const node = nodes.shift();
      nodes.push(...node!.children);
      const mesh = node!.mesh;
      if (mesh) {
        for (const subMesh of mesh.subMeshes) {
          subMesh.primitive?.dispose();
          subMesh.material?.dispose();
        }
      }
    }
    this._nodes = [];
    this._skeletons = [];
    this._scenes = [];
    this._animations = [];
  }
  private setAssetNodeToSceneNode(
    scene: Scene,
    parent: SceneNode,
    assetNode: AssetHierarchyNode,
    skeletonMeshMap: Map<AssetSkeleton, { mesh: Mesh[]; bounding: AssetSubMeshData[] }>,
    nodeMap: Map<AssetHierarchyNode, SceneNode>,
    instancing: boolean
  ) {
    const node: SceneNode = new SceneNode(scene);
    nodeMap.set(assetNode, node);
    node.name = assetNode.name ?? '';
    node.position.set(assetNode.position);
    node.rotation.set(assetNode.rotation);
    node.scale.set(assetNode.scaling);
    if (assetNode.mesh) {
      const meshData = assetNode.mesh;
      const skeleton = assetNode.skeleton;
      for (const subMesh of meshData.subMeshes) {
        for (const instance of assetNode.instances!) {
          const meshNode = new Mesh(scene);
          const skinAnimation = !!skeleton;
          const morphAnimation = subMesh.numTargets > 0;
          meshNode.position = instance.t;
          meshNode.scale = instance.s;
          meshNode.rotation = instance.r;
          meshNode.name = subMesh.name;
          meshNode.clipTestEnabled = true;
          meshNode.showState = 'inherit';
          meshNode.primitive = subMesh.primitive.get()!;
          meshNode.material =
            instancing && !skinAnimation && !morphAnimation
              ? subMesh.material.get()!.createInstance()
              : subMesh.material.get()!.clone();
          meshNode.parent = node;
          subMesh.mesh = meshNode;
          processMorphData(subMesh, meshData.morphWeights!);
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
      this.setAssetNodeToSceneNode(scene, node, child, skeletonMeshMap, nodeMap, instancing);
    }
  }
}
