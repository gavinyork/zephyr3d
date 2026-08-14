import type { Nullable } from '@zephyr3d/base';
import { applyMixins, castObservable, DRef } from '@zephyr3d/base';
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
  QUEUE_OPAQUE
} from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { SceneNode } from './scene_node';
import { getDevice } from '../app/api';
import type { SkinnedBoundingBox } from '../animation';
import { calculateMorphBoundingBox } from '../animation/morphtarget';

/**
 * Callback invoked after a mesh finishes its per-frame update.
 *
 * @public
 */
export type MeshUpdateCallback = (frameId: number, elapsedInSeconds: number, deltaInSeconds: number) => void;

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
  }
  /**
   * Returns the batch instance ID for the current render pass.
   */
  getInstanceId(_renderPass: RenderPass) {
    return `${this._instanceHash}:${this.worldMatrixDet >= 0}`;
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
    this._suspendSkinning = !!val;
  }
  /** Wether the mesh node casts shadows */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(b) {
    this._castShadow = b;
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
    const skinnedBoundingBox =
      this._boneMatrices.get() && this._skinnedBoundingInfo?.boundingBox?.isValid()
        ? this._skinnedBoundingInfo.boundingBox
        : null;
    if (skinnedBoundingBox && morphBoundingBox) {
      return skinnedBoundingBox.clone();
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
      !this._boneMatrices.get() &&
      !this._morphData &&
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
  private calculateMorphBoundingBox(): Nullable<BoundingBox> {
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
    bbox.minPoint.addBy(this._morphBoundingInfo.originBox.minPoint);
    bbox.maxPoint.addBy(this._morphBoundingInfo.originBox.maxPoint);
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
      this.setBoneMatrices(null);
      this.setAnimatedBoundingBox(null);
      return;
    }
    const binding = this._skinBindingName && this.findSkinBindingById(this._skinBindingName);
    if (binding) {
      this.setBoneMatrices(binding.jointTexture);
      binding.computeBoundingBox(this._skinnedBoundingInfo!, this.invWorldMatrix);
      this.refreshAnimatedBoundingBox();
    } else {
      this.setBoneMatrices(null);
      this.refreshAnimatedBoundingBox();
    }
    if (this._skinBindingName) {
      this.scene!.queueUpdateNode(this);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>, hash?: string) {
    const material = this.material;
    const primitive = this.primitive;
    if (material && primitive) {
      if (this._useRenderBundle && !ctx.instanceData && hash) {
        if (
          this._primitiveChangeTag !== primitive.changeTag ||
          this._materialChangeTag !== material.changeTag
        ) {
          this._renderBundle = {};
          this._primitiveChangeTag = primitive.changeTag;
          this._materialChangeTag = material.changeTag;
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
  /** @internal */
  private static _getDefaultMaterial() {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new LambertMaterial();
    }
    return this._defaultMaterial;
  }
}
