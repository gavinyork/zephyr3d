import { Vector4, applyMixins } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import { BoxFrameShape } from '../shapes';
import { MeshMaterial } from '../material';
import { LambertMaterial } from '../material';
import { RenderPass, Primitive, BatchDrawable, DrawContext, PickTarget } from '../render';
import { Application } from '../app/app';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import type { Scene } from './scene';
import type { BoundingBox, BoundingVolume } from '../utility/bounding_volume';
import { QUEUE_OPAQUE } from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { SceneNode } from './scene_node';
import { Ref } from '../app/gc/ref';

/**
 * Mesh node
 * @public
 */
export class Mesh extends applyMixins(GraphNode, mixinDrawable) implements BatchDrawable {
  /** @internal */
  private _primitive: Ref<Primitive>;
  /** @internal */
  private _material: Ref<MeshMaterial>;
  /** @internal */
  protected _castShadow: boolean;
  /** @internal */
  protected _bboxChangeCallback: () => void;
  /** @internal */
  protected _animatedBoundingBox: BoundingBox;
  /** @internal */
  protected _boneMatrices: Texture2D;
  /** @internal */
  protected _morphData: Texture2D;
  /** @internal */
  protected _morphInfo: GPUDataBuffer;
  /** @internal */
  protected _instanceHash: string;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _pickTarget: PickTarget;
  /** @internal */
  protected _boundingBoxNode: Mesh;
  /** @internal */
  protected _instanceColor: Vector4;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene, primitive?: Primitive, material?: MeshMaterial) {
    super(scene);
    this._primitive = new Ref<Primitive>();
    this._material = new Ref<MeshMaterial>();
    this._castShadow = true;
    this._animatedBoundingBox = null;
    this._boneMatrices = null;
    this._morphData = null;
    this._morphInfo = null;
    this._instanceHash = null;
    this._pickTarget = { node: this };
    this._boundingBoxNode = null;
    this._instanceColor = Vector4.zero();
    this._batchable = Application.instance.deviceType !== 'webgl';
    this._bboxChangeCallback = this._onBoundingboxChange.bind(this);
    // use setter
    this.primitive = primitive ?? null;
    this.material = material ?? Mesh._getDefaultMaterial();
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
  getInstanceId(renderPass: RenderPass): string {
    return `${this._instanceHash}:${this.worldMatrixDet >= 0}`;
  }
  /**
   * {@inheritDoc BatchDrawable.getInstanceUniforms}
   */
  getInstanceUniforms(): Float32Array {
    return this._material.get().$instanceUniforms;
  }
  /**
   * {@inheritDoc Drawable.getInstanceColor}
   */
  getInstanceColor(): Vector4 {
    return this._instanceColor;
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
  /** Wether the mesh node casts shadows */
  get castShadow(): boolean {
    return this._castShadow;
  }
  set castShadow(b: boolean) {
    this._castShadow = b;
  }
  /** Primitive of the mesh */
  get primitive(): Ref<Primitive> {
    return this._primitive;
  }
  set primitive(prim: Primitive) {
    if (prim !== this._primitive.get()) {
      this._primitive.set(prim);
      this._instanceHash =
        this._primitive.get() && this._material.get()
          ? `${this.constructor.name}:${this._scene.id}:${this._primitive.get().id}:${
              this._material.get().instanceId
            }`
          : null;
      this.invalidateBoundingVolume();
      RenderBundleWrapper.drawableChanged(this);
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
    }
  }
  /** Wether to draw the bounding box of the mesh node */
  get drawBoundingBox(): boolean {
    return !!this._boundingBoxNode;
  }
  set drawBoundingBox(val: boolean) {
    if (!!this._boundingBoxNode !== !!val) {
      if (!val) {
        this._boundingBoxNode.remove();
        this._boundingBoxNode = null;
      } else {
        if (!Mesh._defaultBoxFrame) {
          Mesh._defaultBoxFrame = new BoxFrameShape({ size: 1 });
        }
        this._boundingBoxNode = new Mesh(this._scene, Mesh._defaultBoxFrame);
        this._boundingBoxNode.parent = this;
        this._boundingBoxNode.scale.set(this.getBoundingVolume().toAABB().size);
        this._boundingBoxNode.position.set(this.getBoundingVolume().toAABB().minPoint);
      }
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
   * Sets the texture that contains the bone matrices for skeletal animation
   * @param matrices - The texture that contains the bone matrices
   */
  setBoneMatrices(matrices: Texture2D) {
    if (this._boneMatrices !== matrices) {
      this._boneMatrices = matrices;
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * Sets the texture that contains the morph target data
   * @param data - The texture that contains the morph target data
   */
  setMorphData(data: Texture2D) {
    if (this._morphData !== data) {
      this._morphData = data;
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData(): Texture2D {
    return this._morphData;
  }
  /**
   * Sets the buffer that contains the morph target information
   * @param info - The buffer that contains the morph target information
   */
  setMorphInfo(info: GPUDataBuffer) {
    if (this._morphInfo !== info) {
      this._morphInfo = info;
      RenderBundleWrapper.drawableChanged(this);
    }
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo(): GPUDataBuffer<unknown> {
    return this._morphInfo;
  }
  /**
   * {@inheritDoc Drawable.isBatchable}
   */
  isBatchable(): this is BatchDrawable {
    return this._batchable && !this._boneMatrices && !this._morphData && this._material.get()?.isBatchable();
  }
  /** Disposes the mesh node */
  dispose() {
    this._primitive.dispose();
    this._material.dispose();
    RenderBundleWrapper.drawableChanged(this);
    super.dispose();
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
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    if (this._material.get() && this._primitive.get()) {
      this.bind(ctx);
      this._material.get().draw(this._primitive.get(), ctx);
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
    return this.primitive.get();
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices(): Texture2D {
    return this._boneMatrices;
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
    if (bbox && this._boundingBoxNode) {
      this._boundingBoxNode.scale.set(bbox.toAABB().size);
      this._boundingBoxNode.position.set(bbox.toAABB().minPoint);
    }
    return bbox;
  }
  /** @internal */
  private _onBoundingboxChange() {
    this.invalidateBoundingVolume();
  }
  /** @internal */
  private static _defaultMaterial: MeshMaterial = null;
  /** @internal */
  private static _defaultBoxFrame: Primitive = null;
  /** @internal */
  private static _getDefaultMaterial(): MeshMaterial {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new LambertMaterial();
    }
    return this._defaultMaterial;
  }
}
