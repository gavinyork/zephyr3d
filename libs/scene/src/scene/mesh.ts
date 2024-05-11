import type { Matrix4x4 } from '@zephyr3d/base';
import { Vector4, applyMixins } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import { BoxFrameShape } from '../shapes';
import type { Material } from '../material';
import { LambertMaterial } from '../material';
import type { RenderPass, Primitive, BatchDrawable, DrawContext } from '../render';
import { Application } from '../app';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import type { XForm } from './xform';
import type { Scene } from './scene';
import type { BoundingBox, BoundingVolume } from '../utility/bounding_volume';
import { QUEUE_OPAQUE } from '../values';
import { mixinDrawable } from '../render/drawable_mixin';

/**
 * Mesh node
 * @public
 */
export class Mesh extends applyMixins(GraphNode, mixinDrawable) implements BatchDrawable {
  /** @internal */
  private _primitive: Primitive;
  /** @internal */
  private _material: Material;
  /** @internal */
  protected _castShadow: boolean;
  /** @internal */
  protected _bboxChangeCallback: () => void;
  /** @internal */
  protected _animatedBoundingBox: BoundingBox;
  /** @internal */
  protected _boneMatrices: Texture2D;
  /** @internal */
  protected _invBindMatrix: Matrix4x4;
  /** @internal */
  protected _morphData: Texture2D;
  /** @internal */
  protected _morphInfo: GPUDataBuffer;
  /** @internal */
  protected _instanceHash: string;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _boundingBoxNode: Mesh;
  /** @internal */
  protected _instanceColor: Vector4;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene, primitive?: Primitive, material?: Material) {
    super(scene);
    this._primitive = null;
    this._material = null;
    this._castShadow = true;
    this._animatedBoundingBox = null;
    this._boneMatrices = null;
    this._invBindMatrix = null;
    this._morphData = null;
    this._morphInfo = null;
    this._instanceHash = null;
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
    return this.material.$instanceUniforms;
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
  getPickTarget(): GraphNode {
    return this;
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
    return this._primitive;
  }
  set primitive(prim: Primitive) {
    if (prim !== this._primitive) {
      if (this._primitive) {
        this._primitive.removeBoundingboxChangeCallback(this._bboxChangeCallback);
      }
      this._primitive = prim || null;
      if (this._primitive) {
        this._primitive.addBoundingboxChangeCallback(this._bboxChangeCallback);
      }
      this._instanceHash =
        this._primitive && this._material
          ? `${this.constructor.name}:${this._scene.id}:${this._primitive.id}:${this._material.instanceId}`
          : null;
      this.invalidateBoundingVolume();
    }
  }
  /** Material of the mesh */
  get material(): Material {
    return this._material;
  }
  set material(m: Material) {
    if (this._material !== m) {
      this._material = m;
      this._instanceHash =
        this._primitive && this._material
          ? `${this.constructor.name}:${this._scene.id}:${this._primitive.id}:${this._material.instanceId}`
          : null;
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
        this._boundingBoxNode = new Mesh(this._scene, Mesh._defaultBoxFrame).reparent(this);
        this._boundingBoxNode.scale.set(this.getBoundingVolume().toAABB().size);
        this._boundingBoxNode.position.set(this.getBoundingVolume().toAABB().minPoint);
      }
    }
  }
  /**
   * {@inheritDoc SceneNode.isMesh}
   */
  isMesh(): boolean {
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
    this._boneMatrices = matrices;
  }
  /**
   * Sets the inverse bind matrix for skeletal animation
   * @param matrix - The matrix to set
   */
  setInvBindMatrix(matrix: Matrix4x4) {
    this._invBindMatrix = matrix;
  }
  /**
   * Sets the texture that contains the morph target data
   * @param data - The texture that contains the morph target data
   */
  setMorphData(data: Texture2D) {
    this._morphData = data;
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
    this._morphInfo = info;
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
    return this._batchable && !this._boneMatrices && !this._morphData && this._material?.isBatchable();
  }
  /** Disposes the mesh node */
  dispose() {
    this._primitive = null;
    this._material = null;
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
    this.bind(ctx);
    this.material.draw(this.primitive, ctx);
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial(): Material {
    return this.material;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices(): Texture2D {
    return this._boneMatrices;
  }
  /**
   * {@inheritDoc Drawable.getInvBindMatrix}
   */
  getInvBindMatrix(): Matrix4x4 {
    return this._invBindMatrix;
  }
  /**
   * {@inheritDoc Drawable.getXForm}
   */
  getXForm(): XForm {
    // mesh transform should be ignored when skinned
    return this;
  }
  /** @internal */
  computeBoundingVolume(bv: BoundingVolume): BoundingVolume {
    let bbox: BoundingVolume;
    if (this._animatedBoundingBox) {
      bbox = this._animatedBoundingBox;
    } else {
      const primitive = this.primitive;
      bbox = primitive ? primitive.getBoundingVolume() : null;
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
  private static _defaultMaterial: Material = null;
  /** @internal */
  private static _defaultBoxFrame: Primitive = null;
  /** @internal */
  private static _getDefaultMaterial(): Material {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new LambertMaterial();
    }
    return this._defaultMaterial;
  }
}
