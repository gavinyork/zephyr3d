import type { TypedArray, Interpolator, VFS } from '@zephyr3d/base';
import { ASSERT, DRef, uint8ArrayToBase64, Vector4 } from '@zephyr3d/base';
import { Disposable, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type {
  PrimitiveType,
  Texture2D,
  TextureAddressMode,
  TextureFilterMode,
  TextureSampler,
  VertexAttribFormat,
  VertexSemantic
} from '@zephyr3d/device';
import {
  getVertexFormatComponentCount,
  PBArrayTypeInfo,
  PBPrimitiveType,
  PBPrimitiveTypeInfo,
  PBStructTypeInfo
} from '@zephyr3d/device';
import type { MeshMaterial, SerializationManager } from '@zephyr3d/scene';
import { Scene } from '@zephyr3d/scene';
import {
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  Primitive,
  UnlitMaterial
} from '@zephyr3d/scene';
import {
  Mesh,
  SceneNode,
  NodeRotationTrack,
  NodeScaleTrack,
  Skeleton,
  NodeTranslationTrack,
  getDevice,
  MAX_MORPH_ATTRIBUTES,
  ShaderHelper,
  MORPH_WEIGHTS_VECTOR_COUNT,
  MORPH_ATTRIBUTE_VECTOR_COUNT,
  BoundingBox,
  MAX_MORPH_TARGETS,
  MorphTargetTrack
} from '@zephyr3d/scene';

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

export interface AssetSamplerInfo {
  wrapS: TextureAddressMode;
  wrapT: TextureAddressMode;
  magFilter: TextureFilterMode;
  mipFilter: TextureFilterMode;
  minFilter: TextureFilterMode;
}

export interface AssetImageInfo {
  uri?: string;
  data?: Uint8Array<ArrayBuffer>;
  mimeType?: string;
}

export interface AssetVertexBufferInfo {
  attrib: VertexAttribFormat;
  data: TypedArray;
}

export interface AssetPrimitiveInfo {
  vertices: Record<VertexSemantic, { format: VertexAttribFormat; data: TypedArray }>;
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
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
  image: AssetImageInfo;
  sRGB?: boolean;
  sampler: AssetSamplerInfo;
  texCoord: number;
  transform: Matrix4x4;
}

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
  type: string;
  common: AssetMaterialCommon;
  path?: string;
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
  primitive: AssetPrimitiveInfo;
  material: AssetMaterial;
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
  private readonly _children: AssetHierarchyNode[];
  private readonly _instances?: { t: Vector3; s: Vector3; r: Quaternion }[];
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
    joint.attachToSkeleton(this);
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
export class SharedModel extends Disposable {
  /** @internal */
  private _vfs: VFS;
  /** @internal */
  private _name: string;
  /** @internal */
  private _pathname: string;
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
  /**
   * Creates an instance of SharedModel
   * @param name - Name of the model
   */
  constructor(VFS: VFS, path: string) {
    super();
    this._vfs = VFS;
    this._name = VFS.basename(path, VFS.extname(path));
    this._pathname = VFS.dirname(path);
    this._skeletons = [];
    this._scenes = [];
    this._animations = [];
    this._imageList = [];
    this._primitiveList = [];
    this._materialList = {};
    this._activeScene = -1;
  }
  /** VFS */
  get VFS() {
    return this._vfs;
  }
  /** Path */
  get pathName(): string {
    return this._pathname;
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
  /** save as prefab */
  async savePrefab(manager: SerializationManager, path: string): Promise<void> {
    await this.preprocess(manager, this._name, path);
    const tmpScene = new Scene();
    const node = await this.createSceneNode(manager, tmpScene, false);
    const data = await manager.serializeObject(node);
    const numSkeletons = node.animationSet?.skeletons?.length ?? 0;
    const numAnimations = node.animationSet?.getAnimationNames().length ?? 0;
    tmpScene.dispose();
    const content = JSON.stringify({ type: 'SceneNode', data }, null, '  ');
    await manager.VFS.writeFile(manager.VFS.join(path, `${this._name}.zprefab`), content, {
      encoding: 'utf8',
      create: true
    });
    console.info(
      `Successfully created prefab with ${numSkeletons} skeletons and ${numAnimations} animations: ${path}`
    );
  }
  /** preprocess */
  async preprocess(manager: SerializationManager, destName: string, destPath: string): Promise<void> {
    const srcVFS = this._vfs ?? manager.VFS;
    if (this._imageList.length > 0) {
      console.info(`Importing ${this._imageList.length} textures`);
      for (let i = 0; i < this._imageList.length; i++) {
        const img = this._imageList[i];
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
        const path = manager.VFS.join(destPath, `${destName}_texture${i}${ext}`);
        if (img.uri) {
          img.data = new Uint8Array((await srcVFS.readFile(img.uri, { encoding: 'binary' })) as ArrayBuffer);
        }
        await manager.VFS.writeFile(
          path,
          img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength),
          { encoding: 'binary', create: true }
        );
        img.uri = path;
        img.data = null;
        img.mimeType = '';
      }
    }
    const materialKeys = Object.keys(this._materialList);
    if (materialKeys.length > 0) {
      console.info(`Importing ${materialKeys.length} materials`);
      for (const k of materialKeys) {
        const path = manager.VFS.join(destPath, `${destName}_material${k}.zmtl`);
        const m = await this.createMaterial(manager, this._materialList[k]);
        const data = await manager.serializeObject(m);
        const content = JSON.stringify({ type: 'Default', data }, null, '  ');
        await manager.VFS.writeFile(path, content, { encoding: 'utf8', create: true });
        this._materialList[k].path = path;
        m.dispose();
      }
    }
    if (this._primitiveList.length > 0) {
      console.info(`Importing ${this._primitiveList.length} meshes`);
      for (let i = 0; i < this._primitiveList.length; i++) {
        const info = this._primitiveList[i];
        const path = manager.VFS.join(destPath, `${destName}_mesh${i}.zmsh`);
        const data = {
          vertices: {} as Record<VertexSemantic, { format: VertexAttribFormat; data: string }>,
          indices: info.indices
            ? uint8ArrayToBase64(
                new Uint8Array(info.indices.buffer, info.indices.byteOffset, info.indices.byteLength)
              )
            : null,
          indexType: info.indices ? (info.indices instanceof Uint16Array ? 'u16' : 'u32') : '',
          indexCount: info.indexCount,
          type: info.type,
          boxMin: [info.boxMin.x, info.boxMin.y, info.boxMin.z],
          boxMax: [info.boxMax.x, info.boxMax.y, info.boxMax.z]
        };
        for (const k in info.vertices) {
          const v = info.vertices[k as VertexSemantic];
          data.vertices[k] = {
            format: v.format,
            data: uint8ArrayToBase64(new Uint8Array(v.data.buffer, v.data.byteOffset, v.data.byteLength))
          };
        }
        const content = JSON.stringify({ type: 'Primitive', data }, null, '  ');
        await manager.VFS.writeFile(path, content, { encoding: 'utf8', create: true });
        info.path = path;
      }
    }
  }
  async createSceneNode(
    manager: SerializationManager,
    scene: Scene,
    instancing: boolean
  ): Promise<SceneNode> {
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
        await this.setAssetNodeToSceneNode(
          manager,
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
        const animation = animationSet.createAnimation(name, true);
        for (const sk of animationData.skeletons) {
          const nodes = skeletonMeshMap.get(sk);
          if (nodes) {
            if (!nodes.skeleton) {
              nodes.skeleton = new Skeleton(
                sk.joints.map((val) => {
                  const node = nodeMap.get(val);
                  node.jointTypeT = 'static';
                  node.jointTypeS = 'static';
                  node.jointTypeR = 'static';
                  return node;
                }),
                sk.inverseBindMatrices,
                sk.bindPoseMatrices
              );
              for (let i = 0; i < nodes.mesh.length; i++) {
                const mesh = nodes.mesh[i];
                const v = {
                  positions: nodes.bounding[i].rawPositions,
                  blendIndices: nodes.bounding[i].rawBlendIndices,
                  weights: nodes.bounding[i].rawJointWeights
                };
                mesh.setSkinnedBoundingInfo(nodes.skeleton.getBoundingInfo(v));
                mesh.skeletonName = nodes.skeleton.persistentId;
              }
              animationSet.skeletons.push(new DRef(nodes.skeleton));
            }
            animation.addSkeleton(nodes.skeleton.persistentId);
          }
        }
        for (const track of animationData.tracks) {
          const target = nodeMap.get(track.node);
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
            for (const m of track.node.mesh.subMeshes) {
              if (track.interpolator.stride > MAX_MORPH_TARGETS) {
                console.error(
                  `Morph target too large: ${track.interpolator.stride}, the maximum is ${MAX_MORPH_TARGETS}`
                );
              } else {
                const morphTrack = new MorphTargetTrack(
                  track.interpolator,
                  track.defaultMorphWeights,
                  m.targetBox,
                  m.mesh.getBoundingVolume().toAABB(),
                  true
                );
                animation.addTrack(m.mesh, morphTrack);
              }
            }
          } else {
            console.error(`Invalid animation track type: ${track.type}`);
          }
        }
      }
    }
    return group;
  }
  protected onDispose() {
    super.onDispose();
    this._skeletons = [];
    this._scenes = [];
    this._animations = [];
  }
  private async setAssetNodeToSceneNode(
    manager: SerializationManager,
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
        for (const instance of assetNode.instances) {
          const meshNode = new Mesh(scene);
          meshNode.position = instance.t;
          meshNode.scale = instance.s;
          meshNode.rotation = instance.r;
          meshNode.name = subMesh.name;
          meshNode.clipTestEnabled = true;
          meshNode.showState = 'inherit';
          meshNode.skinAnimation = !!skeleton;
          meshNode.morphAnimation = subMesh.numTargets > 0;
          meshNode.primitive = await this.createPrimitive(manager, subMesh.primitive);
          meshNode.material = await this.createMaterial(manager, subMesh.material);
          meshNode.parent = node;
          subMesh.mesh = meshNode;
          processMorphData(subMesh, meshData.morphWeights);
          if (skeleton) {
            if (!skeletonMeshMap.has(skeleton)) {
              skeletonMeshMap.set(skeleton, { mesh: [meshNode], bounding: [subMesh] });
            } else {
              skeletonMeshMap.get(skeleton).mesh.push(meshNode);
              skeletonMeshMap.get(skeleton).bounding.push(subMesh);
            }
          }
        }
      }
    }
    node.parent = parent;
    for (const child of assetNode.children) {
      await this.setAssetNodeToSceneNode(manager, scene, node, child, skeletonMeshMap, nodeMap, instancing);
    }
  }
  private async image2Texture(manager: SerializationManager, info: AssetTextureInfo): Promise<Texture2D> {
    if (info.image.uri) {
      const texture = await manager.fetchTexture<Texture2D>(info.image.uri, {
        linearColorSpace: !info.sRGB
      });
      texture.name = info.image.uri;
      return texture;
    } else if (info.image.data && info.image.mimeType) {
      const texture = await manager.loadTextureFromBuffer<Texture2D>(
        info.image.data,
        info.image.mimeType,
        !!info.sRGB
      );
      return texture;
    }
  }
  private async createTexture(
    manager: SerializationManager,
    info: AssetTextureInfo
  ): Promise<MaterialTextureInfo> {
    const texture = await this.image2Texture(manager, info);
    const sampler = getDevice().createSampler({
      addressU: info.sampler.wrapS,
      addressV: info.sampler.wrapT,
      magFilter: info.sampler.magFilter,
      minFilter: info.sampler.minFilter,
      mipFilter: info.sampler.mipFilter
    });
    const transform = info.transform;
    const texCoord = info.texCoord;
    return {
      texture,
      sampler,
      texCoord,
      transform
    };
  }

  private async createPrimitive(manager: SerializationManager, info: AssetPrimitiveInfo): Promise<Primitive> {
    if (info.path) {
      return manager.fetchPrimitive(info.path);
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
    manager: SerializationManager,
    assetMaterial: AssetMaterial
  ): Promise<MeshMaterial> {
    if (assetMaterial.path) {
      return manager.fetchMaterial<MeshMaterial>(assetMaterial.path);
    }
    const infoMap: Map<AssetTextureInfo, MaterialTextureInfo> = new Map();
    const that = this;
    async function getTextureInfo(info: AssetTextureInfo): Promise<MaterialTextureInfo> {
      let t = infoMap.get(info);
      if (!t) {
        t = await that.createTexture(manager, info);
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
        unlitMaterial.albedoTexture = info.texture;
        unlitMaterial.albedoTextureSampler = info.sampler;
        unlitMaterial.albedoTexCoordIndex = info.texCoord;
        unlitMaterial.albedoTexCoordMatrix = info.transform;
      }
      unlitMaterial.vertexColor = unlitAssetMaterial.common.vertexColor;
      if (assetMaterial.common.alphaMode === 'blend') {
        unlitMaterial.blendMode = 'blend';
      } else if (assetMaterial.common.alphaMode === 'mask') {
        unlitMaterial.alphaCutoff = assetMaterial.common.alphaCutoff;
      }
      if (assetMaterial.common.doubleSided) {
        unlitMaterial.cullMode = 'none';
      }
      return unlitMaterial;
    } else if (assetMaterial.type === 'pbrSpecularGlossiness') {
      const assetPBRMaterial = assetMaterial as AssetPBRMaterialSG;
      const pbrMaterial = new PBRSpecularGlossinessMaterial();
      pbrMaterial.ior = assetPBRMaterial.ior;
      pbrMaterial.albedoColor = assetPBRMaterial.diffuse;
      pbrMaterial.specularFactor = new Vector3(
        assetPBRMaterial.specular.x,
        assetPBRMaterial.specular.y,
        assetPBRMaterial.specular.z
      );
      pbrMaterial.glossinessFactor = assetPBRMaterial.glossness;
      if (assetPBRMaterial.diffuseMap) {
        const info = await getTextureInfo(assetPBRMaterial.diffuseMap);
        pbrMaterial.albedoTexture = info.texture;
        pbrMaterial.albedoTextureSampler = info.sampler;
        pbrMaterial.albedoTexCoordIndex = info.texCoord;
        pbrMaterial.albedoTexCoordMatrix = info.transform;
      }
      if (assetPBRMaterial.common.normalMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.normalMap);
        pbrMaterial.normalTexture = info.texture;
        pbrMaterial.normalTextureSampler = info.sampler;
        pbrMaterial.normalTexCoordIndex = info.texCoord;
        pbrMaterial.normalTexCoordMatrix = info.transform;
      }
      pbrMaterial.normalScale = assetPBRMaterial.common.bumpScale;
      if (assetPBRMaterial.common.emissiveMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.emissiveMap);
        pbrMaterial.emissiveTexture = info.texture;
        pbrMaterial.emissiveTextureSampler = info.sampler;
        pbrMaterial.emissiveTexCoordIndex = info.texCoord;
        pbrMaterial.emissiveTexCoordMatrix = info.transform;
      }
      pbrMaterial.emissiveColor = assetPBRMaterial.common.emissiveColor;
      pbrMaterial.emissiveStrength = assetPBRMaterial.common.emissiveStrength;
      if (assetPBRMaterial.common.occlusionMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.occlusionMap);
        pbrMaterial.occlusionTexture = info.texture;
        pbrMaterial.occlusionTextureSampler = info.sampler;
        pbrMaterial.occlusionTexCoordIndex = info.texCoord;
        pbrMaterial.occlusionTexCoordMatrix = info.transform;
      }
      pbrMaterial.occlusionStrength = assetPBRMaterial.common.occlusionStrength;
      if (assetPBRMaterial.specularGlossnessMap) {
        const info = await getTextureInfo(assetPBRMaterial.specularGlossnessMap);
        pbrMaterial.specularTexture = info.texture;
        pbrMaterial.specularTextureSampler = info.sampler;
        pbrMaterial.specularTexCoordIndex = info.texCoord;
        pbrMaterial.specularTexCoordMatrix = info.transform;
      }
      pbrMaterial.vertexTangent = assetPBRMaterial.common.useTangent;
      pbrMaterial.vertexColor = assetPBRMaterial.common.vertexColor;
      if (assetPBRMaterial.common.alphaMode === 'blend') {
        pbrMaterial.blendMode = 'blend';
      } else if (assetPBRMaterial.common.alphaMode === 'mask') {
        pbrMaterial.alphaCutoff = assetPBRMaterial.common.alphaCutoff;
      }
      if (assetPBRMaterial.common.doubleSided) {
        pbrMaterial.cullMode = 'none';
      }
      pbrMaterial.vertexNormal = !!assetMaterial.common.vertexNormal;
      return pbrMaterial;
    } else if (assetMaterial.type === 'pbrMetallicRoughness') {
      const assetPBRMaterial = assetMaterial as AssetPBRMaterialMR;
      const pbrMaterial = new PBRMetallicRoughnessMaterial();
      pbrMaterial.ior = assetPBRMaterial.ior;
      pbrMaterial.albedoColor = assetPBRMaterial.diffuse;
      pbrMaterial.metallic = assetPBRMaterial.metallic;
      pbrMaterial.roughness = assetPBRMaterial.roughness;
      if (assetPBRMaterial.diffuseMap) {
        const info = await getTextureInfo(assetPBRMaterial.diffuseMap);
        pbrMaterial.albedoTexture = info.texture;
        pbrMaterial.albedoTextureSampler = info.sampler;
        pbrMaterial.albedoTexCoordIndex = info.texCoord;
        pbrMaterial.albedoTexCoordMatrix = info.transform;
      }
      if (assetPBRMaterial.common.normalMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.normalMap);
        pbrMaterial.normalTexture = info.texture;
        pbrMaterial.normalTextureSampler = info.sampler;
        pbrMaterial.normalTexCoordIndex = info.texCoord;
        pbrMaterial.normalTexCoordMatrix = info.transform;
      }
      pbrMaterial.normalScale = assetPBRMaterial.common.bumpScale;
      if (assetPBRMaterial.common.emissiveMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.emissiveMap);
        pbrMaterial.emissiveTexture = info.texture;
        pbrMaterial.emissiveTextureSampler = info.sampler;
        pbrMaterial.emissiveTexCoordIndex = info.texCoord;
        pbrMaterial.emissiveTexCoordMatrix = info.transform;
      }
      pbrMaterial.emissiveColor = assetPBRMaterial.common.emissiveColor;
      pbrMaterial.emissiveStrength = assetPBRMaterial.common.emissiveStrength;
      if (assetPBRMaterial.common.occlusionMap) {
        const info = await getTextureInfo(assetPBRMaterial.common.occlusionMap);
        pbrMaterial.occlusionTexture = info.texture;
        pbrMaterial.occlusionTextureSampler = info.sampler;
        pbrMaterial.occlusionTexCoordIndex = info.texCoord;
        pbrMaterial.occlusionTexCoordMatrix = info.transform;
        pbrMaterial.occlusionStrength = assetPBRMaterial.common.occlusionStrength;
      }
      if (assetPBRMaterial.metallicMap) {
        const info = await getTextureInfo(assetPBRMaterial.metallicMap);
        pbrMaterial.metallicRoughnessTexture = info.texture;
        pbrMaterial.metallicRoughnessTextureSampler = info.sampler;
        pbrMaterial.metallicRoughnessTexCoordIndex = info.texCoord;
        pbrMaterial.metallicRoughnessTexCoordMatrix = info.transform;
      }
      pbrMaterial.specularFactor = assetPBRMaterial.specularFactor;
      if (assetPBRMaterial.specularMap) {
        const info = await getTextureInfo(assetPBRMaterial.specularMap);
        pbrMaterial.specularTexture = info.texture;
        pbrMaterial.specularTextureSampler = info.sampler;
        pbrMaterial.specularTexCoordIndex = info.texCoord;
        pbrMaterial.specularTexCoordMatrix = info.transform;
      }
      if (assetPBRMaterial.specularColorMap) {
        const info = await getTextureInfo(assetPBRMaterial.specularColorMap);
        pbrMaterial.specularColorTexture = info.texture;
        pbrMaterial.specularColorTextureSampler = info.sampler;
        pbrMaterial.specularColorTexCoordIndex = info.texCoord;
        pbrMaterial.specularColorTexCoordMatrix = info.transform;
      }
      if (assetPBRMaterial.sheen) {
        const sheen = assetPBRMaterial.sheen;
        pbrMaterial.sheen = true;
        pbrMaterial.sheenColorFactor = sheen.sheenColorFactor;
        pbrMaterial.sheenRoughnessFactor = sheen.sheenRoughnessFactor;
        if (sheen.sheenColorMap) {
          const info = await getTextureInfo(sheen.sheenColorMap);
          pbrMaterial.sheenColorTexture = info.texture;
          pbrMaterial.sheenColorTextureSampler = info.sampler;
          pbrMaterial.sheenColorTexCoordIndex = info.texCoord;
          pbrMaterial.sheenColorTexCoordMatrix = info.transform;
        }
        if (sheen.sheenRoughnessMap) {
          const info = await getTextureInfo(sheen.sheenRoughnessMap);
          pbrMaterial.sheenRoughnessTexture = info.texture;
          pbrMaterial.sheenRoughnessTextureSampler = info.sampler;
          pbrMaterial.sheenRoughnessTexCoordIndex = info.texCoord;
          pbrMaterial.sheenRoughnessTexCoordMatrix = info.transform;
        }
      }
      if (assetPBRMaterial.iridescence) {
        const iridescence = assetPBRMaterial.iridescence;
        pbrMaterial.iridescence = true;
        pbrMaterial.iridescenceFactor = iridescence.iridescenceFactor;
        pbrMaterial.iridescenceIor = iridescence.iridescenceIor;
        if (iridescence.iridescenceMap) {
          const info = await getTextureInfo(iridescence.iridescenceMap);
          pbrMaterial.iridescenceTexture = info.texture;
          pbrMaterial.iridescenceTextureSampler = info.sampler;
          pbrMaterial.iridescenceTexCoordIndex = info.texCoord;
          pbrMaterial.iridescenceTexCoordMatrix = info.transform;
        }
        pbrMaterial.iridescenceThicknessMin = iridescence.iridescenceThicknessMinimum;
        pbrMaterial.iridescenceThicknessMax = iridescence.iridescenceThicknessMaximum;
        if (iridescence.iridescenceThicknessMap) {
          const info = await getTextureInfo(iridescence.iridescenceThicknessMap);
          pbrMaterial.iridescenceThicknessTexture = info.texture;
          pbrMaterial.iridescenceThicknessTextureSampler = info.sampler;
          pbrMaterial.iridescenceThicknessTexCoordIndex = info.texCoord;
          pbrMaterial.iridescenceThicknessTexCoordMatrix = info.transform;
        }
      }
      if (assetPBRMaterial.transmission) {
        const transmission = assetPBRMaterial.transmission;
        pbrMaterial.transmission = true;
        pbrMaterial.transmissionFactor = transmission.transmissionFactor;
        if (transmission.transmissionMap) {
          const info = await getTextureInfo(transmission.transmissionMap);
          pbrMaterial.transmissionTexture = info.texture;
          pbrMaterial.transmissionTextureSampler = info.sampler;
          pbrMaterial.transmissionTexCoordIndex = info.texCoord;
          pbrMaterial.transmissionTexCoordMatrix = info.transform;
        }
        pbrMaterial.thicknessFactor = transmission.thicknessFactor;
        if (transmission.thicknessMap) {
          const info = await getTextureInfo(transmission.thicknessMap);
          pbrMaterial.thicknessTexture = info.texture;
          pbrMaterial.thicknessTextureSampler = info.sampler;
          pbrMaterial.thicknessTexCoordIndex = info.texCoord;
          pbrMaterial.thicknessTexCoordMatrix = info.transform;
        }
        pbrMaterial.attenuationDistance = transmission.attenuationDistance;
        pbrMaterial.attenuationColor = transmission.attenuationColor;
      }
      if (assetPBRMaterial.clearcoat) {
        const cc = assetPBRMaterial.clearcoat;
        pbrMaterial.clearcoat = true;
        pbrMaterial.clearcoatIntensity = cc.clearCoatFactor;
        pbrMaterial.clearcoatRoughnessFactor = cc.clearCoatRoughnessFactor;
        if (cc.clearCoatIntensityMap) {
          const info = await getTextureInfo(cc.clearCoatIntensityMap);
          pbrMaterial.clearcoatIntensityTexture = info.texture;
          pbrMaterial.clearcoatIntensityTextureSampler = info.sampler;
          pbrMaterial.clearcoatIntensityTexCoordIndex = info.texCoord;
          pbrMaterial.clearcoatIntensityTexCoordMatrix = info.transform;
        }
        if (cc.clearCoatRoughnessMap) {
          const info = await getTextureInfo(cc.clearCoatRoughnessMap);
          pbrMaterial.clearcoatRoughnessTexture = info.texture;
          pbrMaterial.clearcoatRoughnessTextureSampler = info.sampler;
          pbrMaterial.clearcoatRoughnessTexCoordIndex = info.texCoord;
          pbrMaterial.clearcoatRoughnessTexCoordMatrix = info.transform;
        }
        if (cc.clearCoatNormalMap) {
          const info = await getTextureInfo(cc.clearCoatNormalMap);
          pbrMaterial.clearcoatNormalTexture = info.texture;
          pbrMaterial.clearcoatNormalTextureSampler = info.sampler;
          pbrMaterial.clearcoatNormalTexCoordIndex = info.texCoord;
          pbrMaterial.clearcoatNormalTexCoordMatrix = info.transform;
        }
      }
      pbrMaterial.vertexTangent = assetPBRMaterial.common.useTangent;
      pbrMaterial.vertexColor = assetPBRMaterial.common.vertexColor;
      if (assetPBRMaterial.common.alphaMode === 'blend') {
        pbrMaterial.blendMode = 'blend';
      } else if (assetPBRMaterial.common.alphaMode === 'mask') {
        pbrMaterial.alphaCutoff = assetPBRMaterial.common.alphaCutoff;
      }
      if (assetPBRMaterial.common.doubleSided) {
        pbrMaterial.cullMode = 'none';
      }
      pbrMaterial.vertexNormal = !!assetMaterial.common.vertexNormal;
      return pbrMaterial;
    }
  }
}

/** @internal */
function processMorphData(subMesh: AssetSubMeshData, morphWeights: number[]) {
  const device = getDevice();
  const numTargets = subMesh.numTargets;
  if (numTargets === 0) {
    return;
  }
  const attributes = Object.getOwnPropertyNames(subMesh.targets);
  const positionInfo = subMesh.primitive.vertices['position'];
  const numVertices = positionInfo
    ? (positionInfo.data.length / getVertexFormatComponentCount(positionInfo.format)) >> 0
    : 0;
  const weightsAndOffsets = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
  for (let i = 0; i < numTargets; i++) {
    weightsAndOffsets[4 + i] = morphWeights?.[i] ?? 0;
  }
  const textureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * numTargets));
  if (textureSize > device.getDeviceCaps().textureCaps.maxTextureSize) {
    // TODO: reduce morph attributes
    throw new Error(`Morph target data too large`);
  }
  weightsAndOffsets[0] = textureSize;
  weightsAndOffsets[1] = textureSize;
  weightsAndOffsets[2] = numVertices;
  weightsAndOffsets[3] = numTargets;
  let offset = 0;
  const textureData = new Float32Array(textureSize * textureSize * 4);
  for (let attrib = 0; attrib < MAX_MORPH_ATTRIBUTES; attrib++) {
    const index = attributes.indexOf(String(attrib));
    if (index < 0) {
      weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = -1;
      continue;
    }
    weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = offset >> 2;
    const info = subMesh.targets[attrib];
    if (info.data.length !== numTargets) {
      console.error(`Invalid morph target data`);
      return;
    }
    for (let t = 0; t < numTargets; t++) {
      const data = info.data[t];
      for (let i = 0; i < numVertices; i++) {
        for (let j = 0; j < 4; j++) {
          textureData[offset++] = j < info.numComponents ? data[i * info.numComponents + j] : 1;
        }
      }
    }
  }
  const morphTexture = device.createTexture2D('rgba32f', textureSize, textureSize, {
    mipmapping: false,
    samplerOptions: {
      minFilter: 'nearest',
      magFilter: 'nearest'
    }
  });
  morphTexture.update(textureData, 0, 0, textureSize, textureSize);
  const bufferType = new PBStructTypeInfo('dummy', 'std140', [
    {
      name: ShaderHelper.getMorphInfoUniformName(),
      type: new PBArrayTypeInfo(
        new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
        1 + MORPH_WEIGHTS_VECTOR_COUNT + MORPH_ATTRIBUTE_VECTOR_COUNT
      )
    }
  ]);
  const morphUniformBuffer = device.createStructuredBuffer(
    bufferType,
    {
      usage: 'uniform'
    },
    weightsAndOffsets
  );
  const morphBoundingBox = new BoundingBox();
  calculateMorphBoundingBox(
    morphBoundingBox,
    subMesh.targetBox,
    weightsAndOffsets.subarray(4, 4 + MAX_MORPH_TARGETS),
    numTargets
  );
  const meshAABB = subMesh.mesh.getBoundingVolume().toAABB();
  morphBoundingBox.minPoint.addBy(meshAABB.minPoint);
  morphBoundingBox.maxPoint.addBy(meshAABB.maxPoint);

  subMesh.mesh.setMorphData(morphTexture);
  subMesh.mesh.setMorphInfo(morphUniformBuffer);
  subMesh.mesh.setAnimatedBoundingBox(morphBoundingBox);
}

/** @internal */
function calculateMorphBoundingBox(
  morphBoundingBox: BoundingBox,
  keyframeBoundingBox: BoundingBox[],
  weights: Float32Array,
  numTargets: number
) {
  morphBoundingBox.minPoint.setXYZ(0, 0, 0);
  morphBoundingBox.maxPoint.setXYZ(0, 0, 0);
  for (let i = 0; i < numTargets; i++) {
    const weight = weights[i];
    const keyframeBox = keyframeBoundingBox[i];
    morphBoundingBox.minPoint.x += keyframeBox.minPoint.x * weight;
    morphBoundingBox.minPoint.y += keyframeBox.minPoint.y * weight;
    morphBoundingBox.minPoint.y += keyframeBox.minPoint.z * weight;
    morphBoundingBox.maxPoint.x += keyframeBox.maxPoint.x * weight;
    morphBoundingBox.maxPoint.y += keyframeBox.maxPoint.y * weight;
    morphBoundingBox.maxPoint.y += keyframeBox.maxPoint.z * weight;
  }
}
