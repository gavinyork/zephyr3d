import type { Nullable } from '@zephyr3d/base';
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
import type { BoundingBox } from '../utility/bounding_volume';
import { MORPH_ATTRIBUTE_VECTOR_COUNT, MORPH_WEIGHTS_VECTOR_COUNT, QUEUE_OPAQUE } from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { SceneNode } from './scene_node';
import { getDevice } from '../app/api';
import type { SkinnedBoundingBox } from '../animation';

/**
 * Mesh node
 * @public
 */
export class Mesh extends applyMixins(GraphNode, mixinDrawable) implements BatchDrawable {
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
  protected _skeletonName: string;
  /** @internal */
  protected _boneMatrices: DRef<Texture2D>;
  /** @internal */
  protected _morphData: Nullable<MorphData>;
  /** @internal */
  protected _morphInfo: Nullable<MorphInfo>;
  /** @internal */
  protected _instanceHash: Nullable<string>;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _pickTarget: PickTarget;
  /** @internal */
  protected _skinAnimation: boolean;
  /** @internal */
  protected _morphAnimation: boolean;
  /** @internal */
  protected _renderBundle: Nullable<Record<string, RenderBundle>>;
  /** @internal */
  protected _useRenderBundle: boolean;
  /** @internal */
  protected _materialChangeTag: Nullable<number>;
  /** @internal */
  protected _primitiveChangeTag: Nullable<number>;
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
  /**
   * {@inheritDoc Drawable.getName}
   */
  getName() {
    return this._name;
  }
  /**
   * {@inheritDoc BatchDrawable.getInstanceId}
   */
  getInstanceId(_renderPass: RenderPass) {
    return `${this._instanceHash}:${this.worldMatrixDet >= 0}`;
  }
  /**
   * {@inheritDoc BatchDrawable.getInstanceUniforms}
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
  get skeletonName() {
    return this._skeletonName;
  }
  set skeletonName(name) {
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
  set skinAnimation(val) {
    this._skinAnimation = val;
  }
  /** @internal */
  get morphAnimation() {
    return this._morphAnimation;
  }
  set morphAnimation(val) {
    this._morphAnimation = val;
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
    return this._primitive.get();
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
    }
  }
  /** Material of the mesh */
  get material() {
    return this._material.get();
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
   * Sets the texture that contains the morph target data
   * @param data - The texture that contains the morph target data
   */
  setMorphData(data: Nullable<MorphData>) {
    if (!data) {
      if (this._morphData) {
        this._morphData?.texture?.dispose();
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
        const tex = getDevice().createTexture2D('rgba32f', data.width, data.height, {
          mipmapping: false,
          samplerOptions: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipFilter: 'none'
          }
        })!;
        tex.update(data.data, 0, 0, data.width, data.height);
        this._morphData.texture!.set(tex);
      }
      this._renderBundle = {};
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /** @internal */
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
   * Sets the buffer that contains the morph target information
   * @param info - The buffer that contains the morph target information
   */
  setMorphInfo(info: Nullable<MorphInfo>) {
    if (!info) {
      if (this._morphInfo) {
        this._morphInfo.buffer?.dispose();
        this._morphInfo = null;
        this._renderBundle = {};
        RenderBundleWrapper.drawableChanged(this);
      }
    } else {
      if (!this._morphInfo) {
        this._morphInfo = {
          buffer: new DRef()
        } as MorphInfo;
      }
      this._morphInfo.data = info.data.slice();
      if (info.buffer?.get()) {
        this._morphInfo.buffer!.set(info.buffer.get());
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
        this._morphInfo.buffer!.set(morphUniformBuffer);
      }
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
  private updateSkeletonState() {
    if (this._skeletonName) {
      const skeleton = this.findSkeletonById(this._skeletonName);
      if (skeleton?.playing) {
        this.setBoneMatrices(skeleton.jointTexture);
        skeleton.computeBoundingBox(this._skinnedBoundingInfo!, this.invWorldMatrix);
        this.setAnimatedBoundingBox(this._skinnedBoundingInfo!.boundingBox);
      } else {
        this.setBoneMatrices(null);
        this.setAnimatedBoundingBox(null);
      }
      this.scene!.queueUpdateNode(this);
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
        const renderBundle = this._renderBundle![hash];
        if (!renderBundle) {
          ctx.device.beginCapture();
          this.bind(ctx);
          material.draw(primitive, ctx);
          this._renderBundle![hash] = ctx.device.endCapture();
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
  private static _defaultMaterial: Nullable<MeshMaterial> = null;
  /** @internal */
  private static _getDefaultMaterial() {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new LambertMaterial();
    }
    return this._defaultMaterial;
  }
}
