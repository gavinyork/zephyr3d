import { applyMixins, DRef } from '@zephyr3d/base';
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
  MorphInfo
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
import type { BoundingVolume } from '../utility/bounding_volume';
import { BoundingBox } from '../utility/bounding_volume';
import { MORPH_ATTRIBUTE_VECTOR_COUNT, MORPH_WEIGHTS_VECTOR_COUNT, QUEUE_OPAQUE } from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { NodeClonable, NodeCloneMethod, SceneNode } from './scene_node';
import { getDevice } from '../app/api';
import type { SkinnedBoundingBox } from '../animation';

/**
 * Mesh node
 * @public
 */
export class Mesh extends applyMixins(GraphNode, mixinDrawable) implements BatchDrawable, NodeClonable<Mesh> {
  /** @internal */
  private readonly _primitive: DRef<Primitive>;
  /** @internal */
  private readonly _material: DRef<MeshMaterial>;
  /** @internal */
  protected _castShadow: boolean;
  /** @internal */
  protected _skinnedBoundingInfo: SkinnedBoundingBox;
  /** @internal */
  protected _animatedBoundingBox: BoundingBox;
  /** @internal */
  protected _skeletonName: string;
  /** @internal */
  protected _boneMatrices: DRef<Texture2D>;
  /** @internal */
  protected _morphData: MorphData;
  /** @internal */
  protected _morphInfo: MorphInfo;
  /** @internal */
  protected _instanceHash: string;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _pickTarget: PickTarget;
  /** @internal */
  protected _skinAnimation: boolean;
  /** @internal */
  protected _morphAnimation: boolean;
  /** @internal */
  protected _renderBundle: Record<string, RenderBundle>;
  /** @internal */
  protected _useRenderBundle: boolean;
  /** @internal */
  protected _materialChangeTag: number;
  /** @internal */
  protected _primitiveChangeTag: number;
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
    this._morphData = null;
    this._morphInfo = null;
    this._instanceHash = null;
    this._pickTarget = { node: this };
    this._batchable = getDevice().type !== 'webgl';
    this.primitive = primitive ?? null;
    this.material = material ?? Mesh._getDefaultMaterial();
    this._skinAnimation = false;
    this._skeletonName = '';
    this._morphAnimation = false;
    this._renderBundle = {};
    this._useRenderBundle = true;
    this._materialChangeTag = null;
    this._primitiveChangeTag = null;
  }
  /** {@inheritDoc SceneNode.clone} */
  clone(method: NodeCloneMethod, recursive: boolean): Mesh {
    const other = new Mesh(this.scene);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  /** {@inheritDoc SceneNode.copyFrom} */
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.castShadow = other.castShadow;
    this.primitive = other.primitive;
    this.material = other.material?.$isInstance ? other.material.createInstance() : other.material;
    if (other.material.$isInstance) {
      this.material.$instanceUniforms.set(other.material.$instanceUniforms);
    }
    this._skinnedBoundingInfo = other._skinnedBoundingInfo
      ? {
          boundingVertices: other._skinnedBoundingInfo.boundingVertices,
          boundingVertexBlendIndices: other._skinnedBoundingInfo.boundingVertexBlendIndices,
          boundingVertexJointWeights: other._skinnedBoundingInfo.boundingVertexJointWeights,
          boundingBox: new BoundingBox(other._skinnedBoundingInfo.boundingBox)
        }
      : null;
    this.skeletonName = other.skeletonName;
    this.setMorphData(other.getMorphData());
    this.setMorphInfo(other.getMorphInfo());
  }
  /**
   * {@inheritDoc Drawable.getName}
   */
  getName(): string {
    return this._name;
  }
  /**
   * {@inheritDoc BatchDrawable.getInstanceId}
   */
  getInstanceId(_renderPass: RenderPass): string {
    return `${this._instanceHash}:${this.worldMatrixDet >= 0}`;
  }
  /**
   * {@inheritDoc BatchDrawable.getInstanceUniforms}
   */
  getInstanceUniforms(): Float32Array<ArrayBuffer> {
    return this._material.get().$instanceUniforms;
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget(): PickTarget {
    return this._pickTarget;
  }
  setPickTarget(node: SceneNode, label?: string) {
    this._pickTarget = { node, label };
  }
  get skeletonName() {
    return this._skeletonName;
  }
  set skeletonName(name: string) {
    if (name !== this._skeletonName) {
      this._skeletonName = name;
      this.updateSkeletonState();
    }
  }
  /** @internal */
  get skinnedBoundingInfo() {
    return this._skinnedBoundingInfo;
  }
  /** @internal */
  get skinAnimation() {
    return this._skinAnimation;
  }
  set skinAnimation(val: boolean) {
    this._skinAnimation = val;
  }
  /** @internal */
  get morphAnimation() {
    return this._morphAnimation;
  }
  set morphAnimation(val: boolean) {
    this._morphAnimation = val;
  }
  /** Wether the mesh node casts shadows */
  get castShadow(): boolean {
    return this._castShadow;
  }
  set castShadow(b: boolean) {
    this._castShadow = b;
  }
  /** Primitive of the mesh */
  get primitive(): Primitive {
    return this._primitive.get();
  }
  set primitive(prim: Primitive) {
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
          ? `${this.constructor.name}:${this._scene.id}:${prim.id}:${this._material.get().instanceId}`
          : null;
      this.invalidateBoundingVolume();
      RenderBundleWrapper.drawableChanged(this);
      this._primitiveChangeTag = null;
    }
  }
  /** Material of the mesh */
  get material(): MeshMaterial {
    return this._material.get();
  }
  set material(m: MeshMaterial) {
    if (this._material.get() !== m) {
      this._material.set(m);
      if (m) {
        RenderBundleWrapper.materialAttached(m.coreMaterial, this);
      }
      this._instanceHash =
        this._primitive.get() && m
          ? `${this.constructor.name}:${this._scene?.id ?? 0}:${this._primitive.get().id}:${m.instanceId}`
          : null;
      RenderBundleWrapper.drawableChanged(this);
      this._materialChangeTag = null;
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
  setAnimatedBoundingBox(bbox: BoundingBox) {
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
   * Sets the texture that contains the bone matrices for skeletal animation
   * @param matrices - The texture that contains the bone matrices
   */
  setBoneMatrices(matrices: Texture2D) {
    if (this._boneMatrices.get() !== matrices) {
      this._boneMatrices.set(matrices);
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * Sets the texture that contains the morph target data
   * @param data - The texture that contains the morph target data
   */
  setMorphData(data: MorphData) {
    if (!data) {
      if (this._morphData) {
        this._morphData?.texture.dispose();
        this._morphData = null;
        this._renderBundle = {};
        RenderBundleWrapper.drawableChanged(this);
      }
    } else {
      if (!this._morphData) {
        this._morphData = {
          width: 0,
          height: 0,
          data: null,
          texture: new DRef()
        };
      }
      this._morphData.width = data.width;
      this._morphData.height = data.height;
      this._morphData.data = data.data.slice();
      if (data.texture?.get()) {
        this._morphData.texture.set(data.texture.get());
      } else {
        const tex = getDevice().createTexture2D('rgba32f', data.width, data.height, {
          mipmapping: false,
          samplerOptions: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipFilter: 'none'
          }
        });
        tex.update(data.data, 0, 0, data.width, data.height);
        this._morphData.texture.set(tex);
      }
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /** @internal */
  setSkinnedBoundingInfo(info: SkinnedBoundingBox) {
    this._skinnedBoundingInfo = info;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData() {
    return this._morphData;
  }
  /**
   * Sets the buffer that contains the morph target information
   * @param info - The buffer that contains the morph target information
   */
  setMorphInfo(info: MorphInfo) {
    if (!info) {
      if (this._morphInfo) {
        this._morphInfo.buffer.dispose();
        this._morphInfo = null;
        this._renderBundle = {};
        RenderBundleWrapper.drawableChanged(this);
      }
    } else {
      if (!this._morphInfo) {
        this._morphInfo = {
          data: null,
          buffer: new DRef()
        };
      }
      this._morphInfo.data = info.data.slice();
      if (info.buffer?.get()) {
        this._morphInfo.buffer.set(info.buffer.get());
      } else {
        const bufferType = new PBStructTypeInfo('dummy', 'std140', [
          {
            name: ShaderHelper.getMorphInfoUniformName(),
            type: new PBArrayTypeInfo(
              new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
              1 + MORPH_WEIGHTS_VECTOR_COUNT + MORPH_ATTRIBUTE_VECTOR_COUNT
            )
          }
        ]);
        const morphUniformBuffer = getDevice().createStructuredBuffer(
          bufferType,
          {
            usage: 'uniform'
          },
          info.data
        );
        this._morphInfo.buffer.set(morphUniformBuffer);
      }
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo(): MorphInfo {
    return this._morphInfo;
  }
  /** {@inheritDoc SceneNode.update} */
  update(frameId: number, elapsedInSeconds: number, deltaInSeconds: number) {
    super.update(frameId, elapsedInSeconds, deltaInSeconds);
    this.updateSkeletonState();
  }
  /**
   * {@inheritDoc Drawable.isBatchable}
   */
  isBatchable(): this is BatchDrawable {
    return (
      this._batchable && !this._boneMatrices.get() && !this._morphData && this._material.get()?.isBatchable()
    );
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType(): number {
    return this.material?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this.material?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor(): boolean {
    return this.material?.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth(): boolean {
    return this.material?.needSceneDepth();
  }
  /** @internal */
  private updateSkeletonState() {
    if (this._skeletonName) {
      const skeleton = this.findSkeletonById(this._skeletonName);
      if (skeleton?.playing) {
        this.setBoneMatrices(skeleton.jointTexture);
        skeleton.computeBoundingBox(this._skinnedBoundingInfo, this.invWorldMatrix);
        this.setAnimatedBoundingBox(this._skinnedBoundingInfo.boundingBox);
      } else {
        this.setBoneMatrices(null);
        this.setAnimatedBoundingBox(null);
      }
      this.scene.queueUpdateNode(this);
    } else {
      this.setBoneMatrices(null);
      this.setAnimatedBoundingBox(null);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, hash?: string) {
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
        const renderBundle = this._renderBundle[hash];
        if (!renderBundle) {
          ctx.device.beginCapture();
          this.bind(ctx);
          material.draw(primitive, ctx);
          this._renderBundle[hash] = ctx.device.endCapture();
        } else {
          ctx.device.executeRenderBundle(renderBundle);
        }
      } else {
        this.bind(ctx);
        material.draw(primitive, ctx);
      }
    }
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial(): MeshMaterial {
    return this.material;
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive(): Primitive {
    return this.primitive;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices(): Texture2D {
    return this._boneMatrices.get();
  }
  /**
   * {@inheritDoc Drawable.getNode}
   */
  getNode(): SceneNode {
    // mesh transform should be ignored when skinned
    return this;
  }
  /** @internal */
  computeBoundingVolume(): BoundingVolume {
    let bbox: BoundingVolume;
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
    this.skeletonName = null;
    this._primitive.get()?.off('bv_changed', this._onBoundingboxChange, this);
    this._primitive.dispose();
    this._material.dispose();
    this._boneMatrices.dispose();
    this.setMorphData(null);
    this.setMorphInfo(null);
    this._renderBundle = null;
    RenderBundleWrapper.drawableChanged(this);
  }
  /** @internal */
  private _onBoundingboxChange() {
    this.invalidateBoundingVolume();
  }
  /** @internal */
  private static _defaultMaterial: MeshMaterial = null;
  /** @internal */
  private static _getDefaultMaterial(): MeshMaterial {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new LambertMaterial();
    }
    return this._defaultMaterial;
  }
}
