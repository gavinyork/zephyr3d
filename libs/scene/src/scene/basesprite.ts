import type { Matrix4x4, Nullable } from '@zephyr3d/base';
import { applyMixins, DRef, Quaternion, Vector2, Vector3 } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import type { RenderPass, BatchDrawable, DrawContext, PickTarget, RenderQueue } from '../render';
import { Primitive } from '../render';
import type { RenderBundle } from '@zephyr3d/device';
import type { Scene } from './scene';
import { BoundingBox } from '../utility/bounding_volume';
import { QUEUE_OPAQUE } from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { SceneNode } from './scene_node';
import { getDevice } from '../app/api';
import { SpriteMaterial } from '../material/sprite';

/**
 * Mesh node
 * @public
 */
export class BaseSprite<M extends SpriteMaterial>
  extends applyMixins(GraphNode, mixinDrawable)
  implements BatchDrawable
{
  /** @internal */
  private static _primitive: DRef<Primitive> = new DRef();
  /** @internal */
  private readonly _material: DRef<M>;
  /** @internal */
  protected _instanceHash: Nullable<string>;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _pickTarget: PickTarget;
  /** @internal */
  protected _renderBundle: Record<string, RenderBundle>;
  /** @internal */
  protected _useRenderBundle: boolean;
  /** @internal */
  protected _materialChangeTag: Nullable<number>;
  /** @internal */
  protected _anchor: Vector2;
  /** @internal */
  protected _rotateAngle: number;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._material = new DRef();
    this._instanceHash = null;
    this._pickTarget = { node: this };
    this._batchable = getDevice().type !== 'webgl';
    this._anchor = new Vector2(0.5, 0.5);
    this._rotateAngle = 0;
    this._renderBundle = {};
    this._useRenderBundle = true;
    this._materialChangeTag = null;
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
  /** Material of the mesh */
  get material() {
    return this._material.get()!;
  }
  set material(m) {
    if (this._material.get() !== m && m instanceof SpriteMaterial) {
      this._material.set(m);
      if (m) {
        this.onSetMaterial(m);
        RenderBundleWrapper.materialAttached(m.coreMaterial, this);
      }
      this._instanceHash = m ? `${this.constructor.name}:${this._scene?.id ?? 0}:${m.instanceId}` : null;
      RenderBundleWrapper.drawableChanged(this);
      this._materialChangeTag = null;
    }
  }
  get anchorX() {
    return this._anchor.x;
  }
  set anchorX(value) {
    if (this._anchor.x !== value) {
      this._anchor.x = value;
      this.invalidateWorldBoundingVolume(false);
      const material = this._material.get();
      if (material) {
        material.anchorX = this._anchor.x;
      }
    }
  }
  get anchorY() {
    return this._anchor.y;
  }
  set anchorY(value) {
    if (this._anchor.y !== value) {
      this._anchor.y = value;
      this.invalidateWorldBoundingVolume(false);
      const material = this._material.get();
      if (material) {
        material.anchorY = this._anchor.y;
      }
    }
  }
  get uvTopLeft() {
    const uvinfo = this._material.get()!.uvinfo;
    return new Vector2(uvinfo.x, uvinfo.y);
  }
  set uvTopLeft(value) {
    const uvinfo = this._material.get()!.uvinfo;
    this._material.get()!.setUVInfo(value.x, value.y, uvinfo.z, uvinfo.w);
  }
  get uvBottomRight() {
    const uvinfo = this._material.get()!.uvinfo;
    return new Vector2(uvinfo.z, uvinfo.w);
  }
  set uvBottomRight(value) {
    const uvinfo = this._material.get()!.uvinfo;
    this._material.get()!.setUVInfo(uvinfo.x, uvinfo.y, value.x, value.y);
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.isBatchable}
   */
  isBatchable(): this is BatchDrawable {
    return this._batchable && !!this._material.get() && this._material.get()!.isBatchable();
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
    return this.material?.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth() {
    return this.material?.needSceneDepth();
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>, hash?: string) {
    const material = this.material;
    const primitive = this.getPrimitive();
    if (material && primitive) {
      if (this._useRenderBundle && !ctx.instanceData && hash) {
        if (this._materialChangeTag !== material.changeTag) {
          this._renderBundle = {};
          this._materialChangeTag = material.changeTag;
        }
        const renderBundle = this._renderBundle[hash];
        if (!renderBundle) {
          ctx.device.beginCapture();
          this.bind(ctx, renderQueue);
          material.draw(primitive, ctx);
          this._renderBundle[hash] = ctx.device.endCapture();
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
    let primitive = BaseSprite._primitive.get();
    if (!primitive) {
      primitive = new Primitive();
      primitive.createAndSetVertexBuffer('position_f32', new Float32Array([0, 1, 2, 3]));
      primitive.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      primitive.primitiveType = 'triangle-strip';
      BaseSprite._primitive.set(primitive);
    }
    return primitive;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getNode}
   */
  getNode() {
    // mesh transform should be ignored when skinned
    return this;
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   */
  computeBoundingVolume() {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.computeWorldBoundingVolume}
   */
  computeWorldBoundingVolume() {
    const p = this.worldMatrix.transformPointAffine(Vector3.zero());
    const mat = this._material?.get();
    if (mat) {
      const boundingBox = new BoundingBox();
      const cx = Math.max(Math.abs(this._anchor.x), Math.abs(1 - this._anchor.x)) * Math.abs(this.scale.x);
      const cy = Math.max(Math.abs(this._anchor.y), Math.abs(1 - this._anchor.y)) * Math.abs(this.scale.y);
      const size = Math.max(cx, cy);
      boundingBox.minPoint.setXYZ(p.x - size, p.y - size, p.z - size);
      boundingBox.maxPoint.setXYZ(p.x + size, p.y + size, p.z + size);
      return boundingBox;
    }
    return null;
  }
  calculateLocalTransform(outMatrix: Matrix4x4) {
    const rot = this.rotation.toEulerAngles().z;
    const rotationZ = Quaternion.fromAxisAngle(Vector3.axisPZ(), rot);
    outMatrix.compose(this._scaling, rotationZ, this._position);
    if (this._material?.get()) {
      this._rotateAngle = -rot;
      this._material.get()!.rotation = this._rotateAngle;
    }

    //outMatrix.scaling(this.scale).translateLeft(this._position);
  }
  calculateWorldTransform(outMatrix: Matrix4x4) {
    outMatrix.set(this.localMatrix);
    if (this.parent) {
      outMatrix.m03 += this.parent.worldMatrix.m03;
      outMatrix.m13 += this.parent.worldMatrix.m13;
      outMatrix.m23 += this.parent.worldMatrix.m23;
    }
  }
  /** Called when new material is set */
  protected onSetMaterial(material: M) {
    material.anchor = this._anchor;
    material.rotation = this._rotateAngle;
  }
  /** Disposes the mesh node */
  protected onDispose() {
    super.onDispose();
    this._material.dispose();
    RenderBundleWrapper.drawableChanged(this);
  }
}
