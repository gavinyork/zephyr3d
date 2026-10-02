import type { Nullable } from '@zephyr3d/base';
import { applyMixins, castObservable, DRef, DWeakRef, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import type { MeshMaterial } from '../material';
import { LambertMaterial, ShaderHelper } from '../material';
import type {
  RenderPass,
  Primitive,
  BatchDrawable,
  DrawContext,
  PickTarget,
  MorphData,
  MorphInfo,
  SkinInfluenceData,
  RenderQueue
} from '../render';
import {
  PBArrayTypeInfo,
  PBPrimitiveType,
  PBPrimitiveTypeInfo,
  PBStructTypeInfo,
  type RenderBundle,
  type Texture2D
} from '@zephyr3d/device';
import type { Scene } from './scene';
import { BoundingBox, type BoundingVolume } from '../utility/bounding_volume';
import {
  getActiveMorphTargetLimit,
  getMorphTargetLimit,
  MORPH_ATTRIBUTE_VECTOR_COUNT,
  MORPH_WEIGHTS_VECTOR_COUNT,
  QUEUE_OPAQUE,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_OBJECT_COLOR,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { SceneNode } from './scene_node';
import { getDevice } from '../app/api';
import type { SkinBinding, SkinnedBoundingBox } from '../animation';
import { calculateMorphBoundingBox } from '../animation/morphtarget';
import type { Camera } from '../camera/camera';
import { computeAABBScreenRadiusSquared, selectLod } from '../render/lod';

const tmpLodCenter = new Vector3();

/** UE BaseEngine.ini LODColorationColors, levels 0 to 7 */
const LOD_COLORATION_COLORS: [number, number, number][] = [
  [1, 1, 1],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [0.5, 0, 0.5]
];

/**
 * Callback invoked after a mesh finishes its per-frame update.
 *
 * @public
 */
export type MeshUpdateCallback = (frameId: number, elapsedInSeconds: number, deltaInSeconds: number) => void;

/**
 * A skinning palette that skins a mesh in place of its skin binding's.
 *
 * @internal
 */
export interface SkinPaletteOverride {
  /** Slot index of the palette header in the skin palette atlas */
  readonly paletteBase: number;
  /** Bounds of the skinned mesh in its local space, or null to use the primitive's */
  readonly boundingBox: Nullable<BoundingBox>;
  /** Writer of the palette, told when another palette replaces it on the mesh */
  readonly owner?: { detachMesh(mesh: Mesh): void };
}

/**
 * Bounding data used to update a mesh's local bounding box after morph target weights change.
 *
 * @public
 */
export interface MorphBoundingInfo {
  targetBoxes: BoundingBox[];
  originBox: BoundingBox;
}

/**
 * External source descriptor used to rebuild morph target data on demand.
 *
 * @public
 */
export interface MorphSourceDescriptor {
  sourcePath: string;
  nodePath: string;
  subMeshName: string;
}

/**
 * CPU-side morph target source data used to rebuild GPU morph textures on demand.
 *
 * @public
 */
export interface MorphTargetSourceData {
  numTargets: number;
  numVertices: number;
  targets: Partial<Record<number, { numComponents: number; data: Float32Array[]; indices?: Uint32Array[] }>>;
}

const MORPH_WEIGHT_CAPACITY = MORPH_WEIGHTS_VECTOR_COUNT * 4;
const MORPH_ATTRIBUTE_CAPACITY = MORPH_ATTRIBUTE_VECTOR_COUNT * 4;
const MORPH_INFO_DATA_LENGTH = 4 + MORPH_WEIGHT_CAPACITY + MORPH_ATTRIBUTE_CAPACITY;
const MORPH_RENDER_INDEX_OFFSET = 4 + MORPH_WEIGHT_CAPACITY;
const MORPH_RENDER_ATTRIBUTE_OFFSET = MORPH_RENDER_INDEX_OFFSET + MORPH_WEIGHT_CAPACITY;
const MORPH_RENDER_INFO_DATA_LENGTH = MORPH_RENDER_ATTRIBUTE_OFFSET + MORPH_ATTRIBUTE_CAPACITY;
const ACTIVE_MORPH_WEIGHT_EPSILON = 1e-5;

function normalizeMorphInfoData(data: MorphInfo['data']) {
  const normalized = new Float32Array(MORPH_INFO_DATA_LENGTH);
  for (let i = 0; i < MORPH_ATTRIBUTE_CAPACITY; i++) {
    normalized[4 + MORPH_WEIGHT_CAPACITY + i] = -1;
  }
  normalized.set(data.subarray(0, Math.min(data.length, normalized.length)));
  const declaredCount = Math.max(0, Math.floor(Number(normalized[3]) || 0));
  const supportedCount = Math.min(
    declaredCount,
    getMorphTargetLimit(),
    MORPH_WEIGHT_CAPACITY,
    Math.max(0, data.length - 4)
  );
  normalized[3] = supportedCount;
  return {
    data: normalized,
    declaredCount,
    supportedCount
  };
}

function createMorphInfoBuffer(data: Float32Array) {
  const bufferData = new Float32Array(data);
  const bufferType = new PBStructTypeInfo('dummy', 'std140', [
    {
      name: ShaderHelper.getMorphInfoUniformName(),
      type: new PBArrayTypeInfo(
        new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
        1 + MORPH_WEIGHTS_VECTOR_COUNT * 2 + MORPH_ATTRIBUTE_VECTOR_COUNT
      )
    }
  ]);
  return getDevice().createStructuredBuffer(
    bufferType,
    {
      usage: 'uniform'
    },
    bufferData
  );
}

const MeshBase = castObservable(applyMixins(GraphNode, mixinDrawable))<{
  primitive_changed: [primitive: Nullable<Primitive>];
  material_changed: [material: Nullable<MeshMaterial>];
}>();

/**
 * Mesh node
 * @public
 */
export class Mesh extends MeshBase implements BatchDrawable {
  /** @internal */
  private readonly _primitive: DRef<Primitive>;
  /** @internal */
  private readonly _material: DRef<MeshMaterial>;
  /** @internal */
  protected _castShadow: boolean;
  /** @internal */
  protected _skinnedBoundingInfo: Nullable<SkinnedBoundingBox>;
  /** @internal */
  protected _animatedBoundingBox: Nullable<BoundingBox>;
  /** @internal */
  protected _skinBindingName: string;
  /** @internal */
  protected _boneMatrices: DRef<Texture2D>;
  /** @internal Skin binding resolved from _skinBindingName at the last skeleton state update */
  protected _skinBinding: DWeakRef<SkinBinding>;
  /** @internal */
  protected readonly _skinSpaceMatrix: Matrix4x4;
  /** @internal Skin binding and palette version the skinned bounds were last computed for */
  protected _skinnedBoundsVersion: { binding: Nullable<SkinBinding>; version: number };
  /** @internal Palette written by an animation bank track in place of the skin binding's */
  protected _skinPaletteOverride: Nullable<SkinPaletteOverride>;
  /** @internal */
  protected _skinInfluenceData: Nullable<SkinInfluenceData>;
  /** @internal */
  protected _morphData: Nullable<MorphData>;
  /** @internal */
  protected _morphInfo: Nullable<MorphInfo>;
  /** @internal */
  protected _renderMorphInfo: Nullable<MorphInfo>;
  /** @internal */
  protected _morphBoundingInfo: Nullable<MorphBoundingInfo>;
  /** @internal */
  protected _morphSource: Nullable<MorphSourceDescriptor>;
  /** @internal */
  protected _morphSourceData: Nullable<MorphTargetSourceData>;
  /** @internal */
  protected _activeMorphTargetIndices: Uint32Array<ArrayBuffer>;
  /** @internal */
  protected _compactMorphData: boolean;
  /** @internal */
  protected _activeMorphCandidates: { index: number; weight: number }[];
  /** @internal */
  protected _morphDirty: boolean;
  /** @internal */
  protected _instanceHash: Nullable<string>;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _pickTarget: PickTarget;
  /** @internal */
  protected _suspendSkinning: boolean;
  /** @internal */
  protected _renderBundle: Nullable<Record<string, RenderBundle>>;
  /** @internal */
  protected _useRenderBundle: boolean;
  /** @internal */
  protected _materialChangeTag: Nullable<number>;
  /** @internal */
  protected _primitiveChangeTag: Nullable<number>;
  /** @internal */
  protected _postUpdateCallbacks: Set<MeshUpdateCallback>;
  /** @internal */
  protected _forcedLod: number;
  /** @internal */
  protected _minLod: number;
  /** @internal Level of detail last selected for each camera, for the hysteresis */
  protected _lodByCamera: Nullable<WeakMap<Camera, number>>;
  /** @internal */
  protected _wireframe: boolean;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene, primitive?: Primitive, material?: MeshMaterial) {
    super(scene);
    this._primitive = new DRef();
    this._material = new DRef();
    this._castShadow = true;
    this._skinnedBoundingInfo = null;
    this._animatedBoundingBox = null;
    this._boneMatrices = new DRef();
    this._skinBinding = new DWeakRef();
    this._skinSpaceMatrix = new Matrix4x4();
    this._skinPaletteOverride = null;
    this._skinnedBoundsVersion = { binding: null, version: -1 };
    this._skinInfluenceData = null;
    this._morphData = null;
    this._morphInfo = null;
    this._renderMorphInfo = null;
    this._morphBoundingInfo = null;
    this._morphSource = null;
    this._morphSourceData = null;
    this._activeMorphTargetIndices = new Uint32Array(0);
    this._compactMorphData = false;
    this._activeMorphCandidates = [];
    this._morphDirty = false;
    this._instanceHash = null;
    this._pickTarget = { node: this };
    this._batchable = getDevice().type !== 'webgl';
    this.primitive = primitive ?? null;
    this.material = material ?? Mesh._getDefaultMaterial();
    this._suspendSkinning = false;
    this._skinBindingName = '';
    this._renderBundle = {};
    this._useRenderBundle = true;
    this._materialChangeTag = null;
    this._primitiveChangeTag = null;
    this._postUpdateCallbacks = new Set();
    this._forcedLod = -1;
    this._minLod = 0;
    this._lodByCamera = null;
    this._wireframe = false;
  }
  /**
   * Returns the batch instance ID for the current render pass.
   */
  getInstanceId(_renderPass: RenderPass) {
    // A wireframe mesh draws another primitive, so it cannot share a batch with solid ones
    const id = `${this._instanceHash}:${this.worldMatrixDet >= 0}${this._wireframe ? ':wire' : ''}`;
    return this._boneMatrices.get() ? `${id}:skin:${this.getSkinSpaceKey()}` : id;
  }
  /**
   * Key of the skin space matrix, equal for meshes that may share one in a batch.
   *
   * @remarks
   * A batch transforms the palettes of all its instances by the skin space matrix of its first
   * mesh. Instances of one model share it up to rounding, so the key is quantized.
   */
  private getSkinSpaceKey() {
    const m = this.getSkinSpaceMatrix();
    let key = '';
    for (let i = 0; i < 16; i++) {
      key += `${Math.round(m[i] * 1e4)},`;
    }
    return key;
  }
  /**
   * Returns the packed instance-uniform buffer used for batching.
   */
  getInstanceUniforms() {
    return this._material.get()!.$instanceUniforms;
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget() {
    return this._pickTarget;
  }
  setPickTarget(node: SceneNode, label?: string) {
    this._pickTarget = { node, label };
  }
  get useRenderBundle() {
    return this._useRenderBundle;
  }
  set useRenderBundle(val) {
    this._useRenderBundle = val;
  }
  get skeletonName() {
    return this._skinBindingName;
  }
  set skeletonName(name) {
    this.skinBindingName = name;
  }
  get skinBindingName() {
    return this._skinBindingName;
  }
  set skinBindingName(name) {
    if (name !== this._skinBindingName) {
      this._skinBindingName = name;
      this.updateSkeletonState();
    }
  }
  /** @internal */
  get skinnedBoundingInfo() {
    return this._skinnedBoundingInfo;
  }
  /** @internal */
  get suspendSkinning() {
    return this._suspendSkinning;
  }
  /** @internal */
  set suspendSkinning(val) {
    if (val && !this._suspendSkinning) {
      this.setAnimatedBoundingBox(null);
    } else if (!val && this._suspendSkinning) {
      // Skinned meshes sleep until their pose changes, so wake this one to pick skinning up again
      this.scene?.queueUpdateNode(this);
    }
    this._suspendSkinning = !!val;
  }
  /** Wether the mesh node casts shadows */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(b) {
    this._castShadow = b;
  }
  /**
   * Whether the mesh is drawn as the edges of its triangles, at the level of detail in use, to
   * inspect its geometry. Shadows and picking still use the triangles. {@link Camera.wireframe}
   * shows every mesh of a view this way. The edges appear a few frames after the primitive is
   * set or changed, as they are read back from the GPU.
   */
  get wireframe() {
    return this._wireframe;
  }
  set wireframe(val: boolean) {
    this._wireframe = !!val;
  }
  /**
   * Level of detail to always draw, or -1 to select it by the projected size (UE ForcedLodModel,
   * counted from 0 here). Clamped to the levels of the primitive.
   */
  get forcedLod() {
    return this._forcedLod;
  }
  set forcedLod(val: number) {
    this._forcedLod = Math.max(-1, Math.floor(val));
  }
  /**
   * Finest level of detail drawn when selecting by the projected size (UE MinLOD). Clamped to the
   * levels of the primitive.
   */
  get minLod() {
    return this._minLod;
  }
  set minLod(val: number) {
    this._minLod = Math.max(0, Math.floor(val));
  }
  /**
   * Selects the level of detail of the primitive for a view: forced, or picked from the projected
   * size of the world bounds (UE ComputeStaticMeshLOD with skeletal mesh hysteresis, see
   * {@link selectLod}). Always 0 for a primitive without levels.
   *
   * @param camera - The view's camera
   * @returns The level of detail, 0 being the finest
   */
  selectLod(camera: Camera) {
    const lods = this._primitive.get()?.lods;
    if (!lods || lods.length === 0) {
      return 0;
    }
    if (this._forcedLod >= 0) {
      return Math.min(this._forcedLod, lods.length);
    }
    const bv = this.getWorldBoundingVolume();
    if (!bv) {
      return Math.min(this._minLod, lods.length);
    }
    const screenRadiusSquared = computeAABBScreenRadiusSquared(bv.toAABB(), camera, tmpLodCenter);
    if (!this._lodByCamera) {
      this._lodByCamera = new WeakMap();
    }
    const lod = selectLod(
      lods,
      screenRadiusSquared,
      camera.lodDistanceScale,
      this._lodByCamera.get(camera) ?? 0,
      this._minLod
    );
    this._lodByCamera.set(camera, lod);
    return lod;
  }
  /** Primitive of the mesh */
  get primitive() {
    return this._primitive?.get() ?? null;
  }
  set primitive(prim) {
    const currentPrimitive = this._primitive.get();
    if (prim !== currentPrimitive) {
      if (currentPrimitive) {
        currentPrimitive.off('bv_changed', this._onBoundingboxChange, this);
      }
      this._primitive.set(prim);
      if (prim) {
        prim.on('bv_changed', this._onBoundingboxChange, this);
      }
      this._instanceHash =
        prim && this._material.get()
          ? `${this.constructor.name}:${this._scene!.id}:${prim.id}:${this._material.get()!.instanceId}`
          : null;
      this.invalidateBoundingVolume();
      RenderBundleWrapper.drawableChanged(this);
      this._primitiveChangeTag = null;
      if (this._morphData) {
        this._ensureWebGLVertexIndexAttribute('morphing');
      }
      if (this._skinInfluenceData && this._skinInfluenceData.influenceCount > 4) {
        this._ensureWebGLVertexIndexAttribute('skinning');
      }
      this.dispatchEvent('primitive_changed', prim);
    }
  }
  /** Material of the mesh */
  get material() {
    return this._material?.get() ?? null;
  }
  set material(m) {
    if (this._material.get() !== m) {
      this._material.set(m);
      if (m) {
        RenderBundleWrapper.materialAttached(m.coreMaterial, this);
      }
      this._instanceHash =
        this._primitive.get() && m
          ? `${this.constructor.name}:${this._scene?.id ?? 0}:${this._primitive.get()!.id}:${m.instanceId}`
          : null;
      RenderBundleWrapper.drawableChanged(this);
      this._materialChangeTag = null;
      this.dispatchEvent('material_changed', m);
    }
  }
  /**
   * {@inheritDoc SceneNode.isMesh}
   */
  isMesh(): this is Mesh {
    return true;
  }
  /**
   * Sets the bounding box for animation
   * @param bbox - The bounding box for animation
   */
  setAnimatedBoundingBox(bbox: Nullable<BoundingBox>) {
    this._animatedBoundingBox = bbox;
    this.invalidateBoundingVolume();
  }
  /**
   * Gets the bounding box for animation
   */
  getAnimatedBoundingBox() {
    return this._animatedBoundingBox ?? null;
  }
  /**
   * Sets morph target bounding data used to update the animated bounding box when weights change.
   * @param info - Morph target bounding data
   */
  setMorphBoundingInfo(info: Nullable<MorphBoundingInfo>) {
    this._morphBoundingInfo = info
      ? {
          targetBoxes: info.targetBoxes.map((box) => box.clone()),
          originBox: info.originBox.clone()
        }
      : null;
    this.refreshAnimatedBoundingBox();
  }
  /**
   * Gets morph target bounding data.
   */
  getMorphBoundingInfo() {
    return this._morphBoundingInfo;
  }
  /**
   * Sets the texture that contains the bone matrices for skeletal animation
   * @param matrices - The texture that contains the bone matrices
   */
  setBoneMatrices(matrices: Nullable<Texture2D>) {
    if (this._boneMatrices.get() !== matrices) {
      this._boneMatrices.set(matrices);
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * Sets additional per-vertex skinning influences packed in a texture.
   * The first 4 influences remain in the vertex attributes; this payload stores the remainder.
   * @param data - Extra influence texture payload, or null to clear it
   */
  setSkinInfluenceData(data: Nullable<SkinInfluenceData>) {
    if (!data) {
      if (this._skinInfluenceData) {
        this._skinInfluenceData.texture?.get()?.dispose();
        this._skinInfluenceData = null;
        this._renderBundle = {};
        RenderBundleWrapper.drawableChanged(this);
      }
      return;
    }
    if (!this._skinInfluenceData) {
      this._skinInfluenceData = {
        texture: new DRef(),
        width: 0,
        height: 0,
        influenceCount: 4,
        data: new Float32Array(0)
      };
    }
    this._skinInfluenceData.width = data.width;
    this._skinInfluenceData.height = data.height;
    this._skinInfluenceData.influenceCount = data.influenceCount;
    this._skinInfluenceData.data = data.data.slice();
    if (data.texture?.get()) {
      this._skinInfluenceData.texture!.set(data.texture.get());
    } else {
      let tex = this._skinInfluenceData.texture?.get() ?? null;
      if (!tex || tex.width !== data.width || tex.height !== data.height) {
        tex?.dispose();
        tex = getDevice().createTexture2D('rgba32f', data.width, data.height, {
          mipmapping: false,
          samplerOptions: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipFilter: 'none'
          }
        })!;
        this._skinInfluenceData.texture!.set(tex);
      }
      tex.update(data.data, 0, 0, data.width, data.height);
    }
    this._ensureWebGLVertexIndexAttribute('skinning');
    this._renderBundle = {};
    RenderBundleWrapper.drawableChanged(this);
  }
  /**
   * Sets the texture that contains the morph target data
   * @param data - The texture that contains the morph target data
   */
  setMorphData(data: Nullable<MorphData>) {
    if (!data) {
      if (this._morphData) {
        this._morphData.texture?.get()?.dispose();
        this._morphData = null;
        this._renderBundle = {};
        RenderBundleWrapper.drawableChanged(this);
      }
    } else {
      if (!this._morphData) {
        this._morphData = {
          texture: new DRef()
        } as MorphData;
      }
      this._morphData.width = data.width;
      this._morphData.height = data.height;
      this._morphData.data = data.data.slice();
      if (data.texture?.get()) {
        this._morphData.texture!.set(data.texture.get());
      } else {
        let tex = this._morphData.texture?.get() ?? null;
        if (!tex || tex.width !== data.width || tex.height !== data.height) {
          tex?.dispose();
          tex = getDevice().createTexture2D('rgba32f', data.width, data.height, {
            mipmapping: false,
            samplerOptions: {
              minFilter: 'nearest',
              magFilter: 'nearest',
              mipFilter: 'none'
            }
          })!;
          this._morphData.texture!.set(tex);
        }
        tex.update(data.data, 0, 0, data.width, data.height);
      }
      this._ensureWebGLVertexIndexAttribute('morphing');
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
      if (this._morphInfo && !this._morphSourceData) {
        this.updateRenderMorphInfo(this.collectActiveMorphTargetIndices(), false);
      }
    }
  }
  /**
   * Sets the skinned bounding info
   * @param info - The skinned bounding info
   */
  setSkinnedBoundingInfo(info: Nullable<SkinnedBoundingBox>) {
    this._skinnedBoundingInfo = info;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData() {
    return this._morphData;
  }
  /**
   * {@inheritDoc Drawable.getSkinInfluenceData}
   */
  getSkinInfluenceData() {
    return this._skinInfluenceData;
  }
  /**
   * Gets the slot index of the skinning palette header in the bone matrix texture.
   *
   * @internal
   */
  getSkinPaletteBase() {
    return this._skinPaletteOverride?.paletteBase ?? this._skinBinding.get()?.paletteBase ?? 0;
  }
  /**
   * Gets the palette that skins this mesh in place of its skin binding's, if any.
   *
   * @internal
   */
  getSkinPaletteOverride() {
    return this._skinPaletteOverride;
  }
  /**
   * Skins this mesh by a palette written elsewhere instead of by its skin binding.
   *
   * @remarks
   * The palette must be laid out like the binding's: same joints, relative to the same
   * reference node. The mesh then neither reads the binding's palette nor computes its bounds
   * from the binding's joints each frame; the override supplies its animated bounds.
   *
   * @param override - The palette and bounds, or null to skin by the binding again
   * @internal
   */
  setSkinPaletteOverride(override: Nullable<SkinPaletteOverride>) {
    this._skinPaletteOverride = override;
    this.updateSkeletonState();
  }
  /**
   * Gets the matrix transforming skinning palette output to the local space of this mesh.
   *
   * @remarks
   * Palette matrices are relative to the reference node of the skin binding, so this is
   * `inverse(worldMatrix) * referenceNode.worldMatrix`.
   *
   * @internal
   */
  getSkinSpaceMatrix(): Matrix4x4 {
    const reference = this._skinBinding.get()?.referenceNode;
    if (reference) {
      Matrix4x4.multiplyAffine(this.invWorldMatrix, reference.worldMatrix, this._skinSpaceMatrix);
    } else {
      this._skinSpaceMatrix.set(this.invWorldMatrix);
    }
    return this._skinSpaceMatrix;
  }
  /**
   * Gets the external morph source descriptor.
   */
  getMorphSource() {
    return this._morphSource;
  }
  /**
   * Sets the external morph source descriptor.
   * @param source - The morph source descriptor
   */
  setMorphSource(source: Nullable<MorphSourceDescriptor>) {
    this._morphSource = source ? { ...source } : null;
  }
  /**
   * Gets the CPU-side morph source data.
   */
  getMorphSourceData() {
    return this._morphSourceData;
  }
  /**
   * Sets the CPU-side morph source data used to rebuild GPU morph textures on demand.
   */
  setMorphSourceData(data: Nullable<MorphTargetSourceData>) {
    this._morphSourceData = data ?? null;
    this._activeMorphTargetIndices = new Uint32Array(0);
    this._compactMorphData = false;
    this._morphDirty = true;
    if (!data) {
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
    } else if (this._morphInfo) {
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
      this.rebuildActiveMorphData();
      this._morphDirty = false;
    }
  }
  /**
   * Sets the buffer that contains the morph target information
   * @param info - The buffer that contains the morph target information
   */
  setMorphInfo(info: Nullable<MorphInfo>) {
    if (!info) {
      if (this._morphInfo) {
        this._morphInfo = null;
      }
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
      this._activeMorphTargetIndices = new Uint32Array(0);
      this._compactMorphData = false;
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    } else {
      if (!this._morphInfo) {
        this._morphInfo = {} as MorphInfo;
      }
      const { data, declaredCount, supportedCount } = normalizeMorphInfoData(info.data);
      if (declaredCount !== supportedCount) {
        console.warn(
          `Morph target count truncated from ${declaredCount} to ${supportedCount} to fit the runtime buffer layout`
        );
      }
      const names: Record<string, number> = {};
      for (const [name, index] of Object.entries(info.names ?? {})) {
        if (Number.isInteger(index) && index >= 0 && index < supportedCount) {
          names[name] = index;
        }
      }
      this._morphInfo.data = data;
      this._morphInfo.names = names;
      this._morphDirty = true;
      if (this._morphSourceData) {
        this.setMorphData(null);
        this.setRenderMorphInfo(null);
        this.rebuildActiveMorphData();
        this._morphDirty = false;
      } else if (this._morphData) {
        this.setRenderMorphInfo(null);
        this.updateRenderMorphInfo(this.collectActiveMorphTargetIndices(), false);
        this._morphDirty = false;
      }
      this.refreshAnimatedBoundingBox();
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo() {
    return this._morphInfo;
  }
  /** @internal */
  getRenderMorphInfo() {
    return this._renderMorphInfo;
  }
  /** @internal */
  private setRenderMorphInfo(info: Nullable<MorphInfo>) {
    if (!info) {
      if (this._renderMorphInfo) {
        this._renderMorphInfo.buffer?.dispose();
        this._renderMorphInfo = null;
      }
      return;
    }
    if (!this._renderMorphInfo) {
      this._renderMorphInfo = {
        buffer: new DRef()
      } as MorphInfo;
    }
    this._renderMorphInfo.data = info.data;
    this._renderMorphInfo.names = info.names;
    if (!this._renderMorphInfo.buffer?.get()) {
      this._renderMorphInfo.buffer!.set(createMorphInfoBuffer(info.data as Float32Array));
    } else {
      this._renderMorphInfo.buffer!.get()!.bufferSubData(0, info.data);
    }
  }
  /** @internal */
  private collectActiveMorphTargetIndices(): Uint32Array<ArrayBuffer> {
    if (!this._morphInfo) {
      return new Uint32Array(0);
    }
    const count = this.getNumMorphTargets();
    const activeLimit = Math.min(getActiveMorphTargetLimit(), count);
    if (activeLimit <= 0) {
      return new Uint32Array(0);
    }
    const weighted = this._activeMorphCandidates;
    let weightedCount = 0;
    for (let i = 0; i < count; i++) {
      const weight = this._morphInfo.data[4 + i];
      if (Math.abs(weight) > ACTIVE_MORPH_WEIGHT_EPSILON) {
        const candidate = weighted[weightedCount] ?? { index: i, weight: 0 };
        candidate.index = i;
        candidate.weight = Math.abs(weight);
        weighted[weightedCount] = candidate;
        weightedCount++;
      }
    }
    weighted.length = weightedCount;
    let selectedCount = weightedCount;
    if (weightedCount > activeLimit) {
      weighted.sort((a, b) => b.weight - a.weight);
      selectedCount = activeLimit;
    }
    for (let i = 1; i < selectedCount; i++) {
      const candidate = weighted[i];
      let targetIndex = i;
      while (targetIndex > 0 && weighted[targetIndex - 1].index > candidate.index) {
        weighted[targetIndex] = weighted[targetIndex - 1];
        targetIndex--;
      }
      weighted[targetIndex] = candidate;
    }
    const activeIndices = new Uint32Array(selectedCount);
    for (let i = 0; i < selectedCount; i++) {
      activeIndices[i] = weighted[i].index;
    }
    return activeIndices;
  }
  /** @internal */
  private rebuildActiveMorphData() {
    if (!this._morphInfo || !this._morphSourceData) {
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
      this._activeMorphTargetIndices = new Uint32Array(0);
      this._compactMorphData = false;
      return;
    }
    const activeIndices = this.collectActiveMorphTargetIndices();
    const sameActiveSet =
      this._activeMorphTargetIndices.length === activeIndices.length &&
      this._activeMorphTargetIndices.every((value, index) => value === activeIndices[index]);
    if (this._morphData && (!this._compactMorphData || sameActiveSet)) {
      this.updateRenderMorphInfo(activeIndices, this._compactMorphData);
      this._activeMorphTargetIndices = activeIndices;
      return;
    }
    const attributes = Object.keys(this._morphSourceData.targets)
      .map((key) => Number(key))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < MORPH_ATTRIBUTE_CAPACITY)
      .sort((a, b) => a - b);
    const numVertices = this._morphSourceData.numVertices;
    const textureTargetCount = Math.min(this.getNumMorphTargets(), this._morphSourceData.numTargets);
    if (numVertices <= 0 || attributes.length === 0 || textureTargetCount <= 0) {
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
      this._activeMorphTargetIndices = new Uint32Array(0);
      this._compactMorphData = false;
      return;
    }
    const maxTextureSize = getDevice().getDeviceCaps().textureCaps.maxTextureSize;
    const fullTextureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * textureTargetCount));
    let textureTargetIndices: Uint32Array<ArrayBuffer>;
    if (fullTextureSize <= maxTextureSize) {
      textureTargetIndices = new Uint32Array(textureTargetCount);
      for (let i = 0; i < textureTargetCount; i++) {
        textureTargetIndices[i] = i;
      }
      this._compactMorphData = false;
    } else if (activeIndices.length > 0) {
      textureTargetIndices = activeIndices;
      this._compactMorphData = true;
    } else {
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
      this._activeMorphTargetIndices = activeIndices;
      this._compactMorphData = true;
      return;
    }
    const textureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * textureTargetIndices.length));
    if (textureSize > maxTextureSize) {
      console.warn(
        `Active morph target texture too large for mesh "${this.name ?? ''}": ${textureSize} exceeds device limit`
      );
      this.setMorphData(null);
      this.setRenderMorphInfo(null);
      this._activeMorphTargetIndices = new Uint32Array(0);
      return;
    }
    const textureData = new Float32Array(textureSize * textureSize * 4);
    const attributeOffsets = new Float32Array(MORPH_ATTRIBUTE_CAPACITY);
    for (let i = 0; i < MORPH_ATTRIBUTE_CAPACITY; i++) {
      attributeOffsets[i] = -1;
    }
    let offset = 0;
    for (const attrib of attributes) {
      const source = this._morphSourceData.targets[attrib];
      if (!source) {
        continue;
      }
      attributeOffsets[attrib] = offset >> 2;
      for (let slot = 0; slot < textureTargetIndices.length; slot++) {
        const targetIndex = textureTargetIndices[slot];
        const targetData = source.data[targetIndex];
        const sparseIndices = source.indices?.[targetIndex];
        const baseOffset = offset + slot * numVertices * 4;
        if (sparseIndices && targetData) {
          for (let i = 0; i < sparseIndices.length; i++) {
            const vertexOffset = baseOffset + sparseIndices[i] * 4;
            for (let j = 0; j < source.numComponents; j++) {
              textureData[vertexOffset + j] = targetData[i * source.numComponents + j];
            }
          }
        } else if (targetData) {
          for (let vertex = 0; vertex < numVertices; vertex++) {
            const vertexOffset = baseOffset + vertex * 4;
            for (let j = 0; j < source.numComponents; j++) {
              textureData[vertexOffset + j] = targetData[vertex * source.numComponents + j];
            }
          }
        }
      }
      offset += numVertices * 4 * textureTargetIndices.length;
    }
    this.setMorphData({ width: textureSize, height: textureSize, data: textureData });
    this.updateRenderMorphInfo(activeIndices, this._compactMorphData, attributeOffsets);
    this._activeMorphTargetIndices = activeIndices;
  }
  /** @internal */
  private updateRenderMorphInfo(
    activeIndices: Uint32Array<ArrayBuffer>,
    useCompactSlots: boolean,
    attributeOffsets?: Float32Array<ArrayBuffer>
  ) {
    if (!this._morphInfo || !this._morphData) {
      this.setRenderMorphInfo(null);
      return;
    }
    const infoData =
      this._renderMorphInfo?.data instanceof Float32Array &&
      this._renderMorphInfo.data.length === MORPH_RENDER_INFO_DATA_LENGTH
        ? this._renderMorphInfo.data
        : new Float32Array(MORPH_RENDER_INFO_DATA_LENGTH);
    infoData[0] = this._morphData.width;
    infoData[1] = this._morphData.height;
    infoData[2] = this._morphSourceData?.numVertices ?? (Number(this._morphInfo.data[2]) || 0);
    infoData[3] = activeIndices.length;
    infoData.fill(0, 4, MORPH_RENDER_ATTRIBUTE_OFFSET);
    for (let slot = 0; slot < activeIndices.length; slot++) {
      const targetIndex = activeIndices[slot];
      infoData[4 + slot] = this._morphInfo.data[4 + targetIndex];
      infoData[MORPH_RENDER_INDEX_OFFSET + slot] = useCompactSlots ? slot : targetIndex;
    }
    if (attributeOffsets) {
      infoData.fill(-1, MORPH_RENDER_ATTRIBUTE_OFFSET);
      infoData.set(attributeOffsets, MORPH_RENDER_ATTRIBUTE_OFFSET);
    } else if (!this._renderMorphInfo) {
      infoData.fill(-1, MORPH_RENDER_ATTRIBUTE_OFFSET);
      for (let attrib = 0; attrib < MORPH_ATTRIBUTE_CAPACITY; attrib++) {
        infoData[MORPH_RENDER_ATTRIBUTE_OFFSET + attrib] =
          this._morphInfo.data[4 + MORPH_WEIGHT_CAPACITY + attrib] ?? -1;
      }
    }
    this.setRenderMorphInfo({ data: infoData, names: this._renderMorphInfo?.names ?? {} });
  }
  /** @internal */
  resolveAnimatedBoundingBox(morphBoundingBox?: Nullable<BoundingBox>) {
    const skinnedBoundingBox = !this._boneMatrices.get()
      ? null
      : this._skinPaletteOverride
        ? this._skinPaletteOverride.boundingBox
        : this._skinnedBoundingInfo?.boundingBox?.isValid()
          ? this._skinnedBoundingInfo.boundingBox
          : null;
    if (skinnedBoundingBox && morphBoundingBox) {
      // Skinning and morphing both active. The two boxes live in different
      // frames: the skinned box already reflects where the geometry actually
      // ended up, while the morph box is still expressed around the rest pose.
      // Unioning them therefore spans the gap between rest and posed positions
      // and produces a wildly oversized box - which is why that union was
      // removed. But dropping the morph side entirely loses the displacement,
      // since the skinned box is built from rest-pose representative vertices
      // (SkinBinding.computeBoundingBox) and never sees morph offsets - so a
      // large facial expression could reach outside its own bounds and be
      // culled.
      //
      // Transfer only what is frame-independent: the displacement. Clamped so
      // it can only grow the box, because a morph that pushes geometry one way
      // must not be allowed to shrink the opposite side.
      const box = skinnedBoundingBox.clone();
      const displacement = this.calculateMorphDisplacement();
      if (displacement) {
        const min = box.minPoint;
        const max = box.maxPoint;
        const dmin = displacement.minPoint;
        const dmax = displacement.maxPoint;
        min.setXYZ(min.x + Math.min(0, dmin.x), min.y + Math.min(0, dmin.y), min.z + Math.min(0, dmin.z));
        max.setXYZ(max.x + Math.max(0, dmax.x), max.y + Math.max(0, dmax.y), max.z + Math.max(0, dmax.z));
      }
      return box;
    }
    return skinnedBoundingBox?.clone() ?? morphBoundingBox ?? null;
  }
  /**
   * Get the number of morph targets
   *
   * @returns The number of morph targets
   */
  getNumMorphTargets(): number {
    return this._morphInfo ? Math.min(this._morphInfo.data[3], MORPH_WEIGHT_CAPACITY) : 0;
  }
  /**
   * Get the name of the morph target by index
   *
   * @param index - The index of the morph target
   * @returns The name of the morph target, or null if not found
   */
  getMorphTargetName(index: number): Nullable<string> {
    if (this._morphInfo && index >= 0 && index < this.getNumMorphTargets()) {
      const name = Object.keys(this._morphInfo.names).find((key) => this._morphInfo!.names![key] === index);
      return name ?? null;
    }
    return null;
  }
  /**
   * Get the index of the morph target by name
   * @param name - The name of the morph target
   * @returns The index of the morph target, or -1 if not found
   */
  getMorphTargetIndexByName(name: string): number {
    return this._morphInfo?.names?.[name] ?? -1;
  }
  /**
   * Update morph target weight
   *
   * @param name - The name of the morph target
   * @param weight - The weight of the morph target
   */
  setMorphWeight(name: string, weight: number) {
    const index = this.getMorphTargetIndexByName(name);
    if (index >= 0) {
      this.setMorphWeightByIndex(index, weight);
    }
  }
  /**
   * Update morph target weight by index
   *
   * @param index - The index of the morph target
   * @param weight - The weight of the morph target
   */
  setMorphWeightByIndex(index: number, weight: number) {
    if (index >= 0 && index < this.getNumMorphTargets()) {
      const normalizedWeight = Math.fround(weight);
      if (this._morphInfo!.data[4 + index] !== normalizedWeight) {
        this._morphInfo!.data[4 + index] = normalizedWeight;
        this._morphDirty = true;
        this.refreshAnimatedBoundingBox();
        this.scene!.queueUpdateNode(this);
      }
    } else {
      console.warn(`Morph target index out of range: ${index}`);
    }
  }
  /**
   * Get morph target weight
   *
   * @param name - The name of the morph target
   * @returns The weight of the morph target, or 0 if not found
   */
  getMorphWeight(name: string): number {
    const index = this._morphInfo?.names?.[name];
    if (index !== undefined && index >= 0 && index < this.getNumMorphTargets()) {
      return this._morphInfo!.data[4 + index];
    }
    return 0;
  }
  /**
   * Update morph target weights
   *
   * @param weight - The morph target weights. The length must not exceed the mesh's morph target count.
   */
  updateMorphWeights(weight: ArrayLike<number>) {
    if (this._morphInfo && weight && weight.length <= this.getNumMorphTargets()) {
      let changed = false;
      for (let i = 0; i < weight.length; i++) {
        const normalizedWeight = Math.fround(weight[i] ?? 0);
        if (this._morphInfo.data[4 + i] !== normalizedWeight) {
          this._morphInfo.data[4 + i] = normalizedWeight;
          changed = true;
        }
      }
      if (!changed) {
        return;
      }
      this._morphDirty = true;
      this.refreshAnimatedBoundingBox();
      this.scene!.queueUpdateNode(this);
    }
  }
  /** {@inheritDoc SceneNode.update} */
  update(frameId: number, elapsedInSeconds: number, deltaInSeconds: number) {
    super.update(frameId, elapsedInSeconds, deltaInSeconds);
    this.updateSkeletonState();
    this.updateMorphState();
    if (this._postUpdateCallbacks.size > 0) {
      for (const callback of this._postUpdateCallbacks) {
        callback(frameId, elapsedInSeconds, deltaInSeconds);
      }
    }
  }
  /** @internal */
  addPostUpdateCallback(callback: MeshUpdateCallback) {
    if (callback) {
      this._postUpdateCallbacks.add(callback);
      this.scene?.queueUpdateNode(this);
    }
  }
  /** @internal */
  removePostUpdateCallback(callback: MeshUpdateCallback) {
    if (callback) {
      this._postUpdateCallbacks.delete(callback);
    }
  }
  /**
   * {@inheritDoc Drawable.isBatchable}
   */
  isBatchable(): this is BatchDrawable {
    return (
      this._batchable &&
      !this._morphData &&
      // Extra skin influences are read from a texture of each mesh, which a batch cannot vary
      !(this._boneMatrices.get() && (this._skinInfluenceData?.influenceCount ?? 4) > 4) &&
      (this._material.get()?.isBatchable() ?? false)
    );
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType() {
    return this.material?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit() {
    return !this.material?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor() {
    return this.material?.needSceneColor() ?? false;
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth() {
    return this.material?.needSceneDepth() ?? false;
  }
  /** @internal */
  /**
   * Weighted morph displacement, relative to the rest pose - i.e. how far the
   * active morph targets push geometry beyond `originBox`, not where that
   * geometry ends up.
   *
   * Kept separate from {@link calculateMorphBoundingBox} because the two are
   * useful in different frames of reference: the absolute box is meaningful for
   * an unskinned mesh, while for a skinned one only the displacement transfers -
   * the rest-space position is superseded by the skinning result.
   *
   * @internal
   */
  private calculateMorphDisplacement(): Nullable<BoundingBox> {
    if (!this._morphInfo || !this._morphBoundingInfo) {
      return null;
    }
    const numTargets = Math.min(this.getNumMorphTargets(), this._morphBoundingInfo.targetBoxes.length);
    if (numTargets <= 0) {
      return null;
    }
    const weights =
      this._morphInfo.data instanceof Float32Array
        ? this._morphInfo.data.subarray(4, 4 + numTargets)
        : new Float32Array(Array.from(this._morphInfo.data.subarray(4, 4 + numTargets)));
    const bbox = new BoundingBox();
    calculateMorphBoundingBox(bbox, this._morphBoundingInfo.targetBoxes, weights, numTargets);
    return bbox;
  }
  /** @internal */
  private calculateMorphBoundingBox(): Nullable<BoundingBox> {
    const bbox = this.calculateMorphDisplacement();
    if (!bbox) {
      return null;
    }
    bbox.minPoint.addBy(this._morphBoundingInfo!.originBox.minPoint);
    bbox.maxPoint.addBy(this._morphBoundingInfo!.originBox.maxPoint);
    return bbox;
  }
  /** @internal */
  private refreshAnimatedBoundingBox() {
    this.setAnimatedBoundingBox(this.resolveAnimatedBoundingBox(this.calculateMorphBoundingBox()));
  }
  /** @internal */
  private updateMorphState() {
    if (this._morphInfo && this._morphDirty) {
      if (this._morphSourceData) {
        this.rebuildActiveMorphData();
      } else if (this._morphData) {
        const activeIndices = this.collectActiveMorphTargetIndices();
        this.updateRenderMorphInfo(activeIndices, false);
        this._activeMorphTargetIndices = activeIndices;
      }
      this.refreshAnimatedBoundingBox();
      this._morphDirty = false;
    }
  }
  /** @internal */
  private updateSkeletonState() {
    if (this._suspendSkinning) {
      if (this._skinnedBoundsVersion) {
        this._skinnedBoundsVersion.binding = null;
      }
      this.setBoneMatrices(null);
      return;
    }
    // Looking a binding up walks the model, so the one found last time is kept while it matches
    const cached = this._skinBinding.get();
    const binding =
      this._skinBindingName &&
      (cached && !cached.disposed && cached.persistentId === this._skinBindingName
        ? cached
        : this.findSkinBindingById(this._skinBindingName));
    const paletteBase = this.getSkinPaletteBase();
    this._skinBinding.set(binding || null);
    if (this.getSkinPaletteBase() !== paletteBase) {
      // Instance data and drawable uniforms hold the palette base and are not rewritten every frame
      this.applyTransformUniformsAll();
      RenderBundleWrapper.drawableChanged(this);
    }
    if (binding) {
      this.setBoneMatrices(binding.jointTexture);
      const bounds = this._skinnedBoundsVersion;
      if (this._skinPaletteOverride) {
        bounds.binding = null;
        this.refreshAnimatedBoundingBox();
      } else if (bounds.binding !== binding || bounds.version !== binding.paletteVersion) {
        // Bounds follow the pose, which only changes with the joint matrices
        bounds.binding = binding;
        bounds.version = binding.paletteVersion;
        binding.computeBoundingBox(this._skinnedBoundingInfo!, this.invWorldMatrix);
        this.refreshAnimatedBoundingBox();
      }
    } else {
      this._skinnedBoundsVersion.binding = null;
      this.setBoneMatrices(null);
      this.refreshAnimatedBoundingBox();
    }
    // Bounds of an overriding palette only change when the override is set again, and bounds
    // of the binding's palette when its pose does, which wakes the mesh up
    if (this._postUpdateCallbacks.size > 0 || (this._skinBindingName && !binding)) {
      // Post update callbacks (GPU cloth) run every frame, and the binding may not be loaded yet
      this.scene?.queueUpdateNode(this);
    } else if (binding && !this._skinPaletteOverride) {
      binding.sleepUntilPoseChanges(this);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>, hash?: string) {
    const ownMaterial = this.material;
    const solid = this.primitive;
    if (ownMaterial && solid) {
      const coloration = this.getLodColorationMaterial(ctx);
      // Render passes apply the materials of their item lists before drawing, which the
      // coloration material is not part of
      if (coloration && !coloration.apply(ctx)) {
        return;
      }
      const material = coloration ?? ownMaterial;
      const wireframe = this.getWireframe(ctx, solid);
      const primitive = wireframe ?? solid;
      if (this._useRenderBundle && !ctx.instanceData && hash) {
        // Each level of detail records its own draw range
        const lod = ctx.primitiveLod ?? 0;
        if (lod > 0) {
          hash = `${hash}:lod${lod}`;
        }
        if (wireframe) {
          hash = `${hash}:wire${wireframe.id}`;
        }
        if (coloration) {
          hash = `${hash}:lodcolor`;
        }
        if (
          this._primitiveChangeTag !== solid.changeTag ||
          this._materialChangeTag !== ownMaterial.changeTag
        ) {
          this._renderBundle = {};
          this._primitiveChangeTag = solid.changeTag;
          this._materialChangeTag = ownMaterial.changeTag;
        }
        const renderBundle = this._renderBundle![hash];
        if (!renderBundle) {
          ctx.device.beginCapture();
          this.bind(ctx, renderQueue);
          material.draw(primitive, ctx);
          this._renderBundle![hash] = ctx.device.endCapture();
        } else {
          ctx.device.executeRenderBundle(renderBundle);
        }
      } else {
        this.bind(ctx, renderQueue);
        material.draw(primitive, ctx);
      }
    }
  }
  /**
   * @internal The material shading the level of detail in its color (UE LOD Coloration, drawn with
   * a colored default material) in the light pass of a camera showing it, null otherwise. Depth,
   * shadow and picking passes keep the mesh's own material.
   */
  private getLodColorationMaterial(ctx: DrawContext) {
    if (!ctx.camera?.lodColoration || ctx.renderPass?.type !== RENDER_PASS_TYPE_LIGHT) {
      return null;
    }
    const lod = Math.min(ctx.primitiveLod ?? 0, LOD_COLORATION_COLORS.length - 1);
    let material = Mesh._lodColorationMaterials[lod];
    if (!material) {
      material = new LambertMaterial();
      const [r, g, b] = LOD_COLORATION_COLORS[lod];
      material.albedoColor = new Vector4(r, g, b, 1);
      Mesh._lodColorationMaterials[lod] = material;
    }
    return material;
  }
  /** @internal The edge primitive to draw instead of the triangles, null to draw them */
  private getWireframe(ctx: DrawContext, primitive: Primitive) {
    const passType = ctx.renderPass?.type;
    if (
      (this._wireframe || ctx.camera?.wireframe) &&
      passType !== RENDER_PASS_TYPE_SHADOWMAP &&
      passType !== RENDER_PASS_TYPE_OBJECT_COLOR
    ) {
      return primitive.getWireframe();
    }
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial() {
    return this.material;
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive() {
    return this.primitive;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices() {
    return this._boneMatrices.get();
  }
  /**
   * {@inheritDoc Drawable.getNode}
   */
  getNode() {
    // mesh transform should be ignored when skinned
    return this;
  }
  /** @internal */
  computeBoundingVolume() {
    let bbox: Nullable<BoundingVolume>;
    if (this._animatedBoundingBox) {
      bbox = this._animatedBoundingBox;
    } else {
      bbox = this._primitive.get()?.getBoundingVolume() ?? null;
    }
    return bbox;
  }
  /** Disposes the mesh node */
  protected onDispose() {
    super.onDispose();
    this._primitive.get()?.off('bv_changed', this._onBoundingboxChange, this);
    this._primitive.dispose();
    this._material.dispose();
    this._boneMatrices.dispose();
    this._skinBinding.dispose();
    this.setSkinInfluenceData(null);
    this.setMorphData(null);
    this.setRenderMorphInfo(null);
    this.setMorphInfo(null);
    this.setMorphSourceData(null);
    this.setMorphBoundingInfo(null);
    this._renderBundle = null;
    RenderBundleWrapper.drawableChanged(this);
  }
  /** @internal */
  private _onBoundingboxChange() {
    this.invalidateBoundingVolume();
  }
  /** @internal */
  private _ensureWebGLVertexIndexAttribute(feature: 'morphing' | 'skinning') {
    const primitive = this._primitive.get();
    if (!primitive || getDevice().type !== 'webgl') {
      return;
    }
    if (primitive.getVertexBuffer('texCoord7')) {
      return;
    }
    const numVertices = primitive.getNumVertices();
    if (numVertices <= 0) {
      return;
    }
    const vertexIndices = new Float32Array(numVertices);
    for (let i = 0; i < numVertices; i++) {
      vertexIndices[i] = i;
    }
    primitive.createAndSetVertexBuffer('tex7_f32', vertexIndices);
    console.info(`Injected texCoord7 vertex indices for WebGL ${feature} on mesh "${this.name ?? ''}"`);
  }
  /** @internal */
  private static _defaultMaterial: Nullable<MeshMaterial> = null;
  /** @internal Materials of the LOD coloration view, by level */
  private static readonly _lodColorationMaterials: LambertMaterial[] = [];
  /** @internal */
  private static _getDefaultMaterial() {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new LambertMaterial();
    }
    return this._defaultMaterial;
  }
}
