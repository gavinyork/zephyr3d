import { applyMixins, DRef } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import type { MeshMaterial } from '../material';
import type { RenderPass, BatchDrawable, DrawContext, PickTarget, MorphInfo } from '../render';
import { Primitive } from '../render';
import type { RenderBundle, Texture2D } from '@zephyr3d/device';
import type { Scene } from './scene';
import type { BoundingVolume } from '../utility/bounding_volume';
import { BoundingBox } from '../utility/bounding_volume';
import { QUEUE_OPAQUE } from '../values';
import { mixinDrawable } from '../render/drawable_mixin';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import type { SceneNode } from './scene_node';
import { getDevice } from '../app/api';
import { Sprite3DMaterial } from '../material/sprite3d';

/**
 * Mesh node
 * @public
 */
export class Sprite3D extends applyMixins(GraphNode, mixinDrawable) implements BatchDrawable {
  /** @internal */
  private static _primitive: DRef<Primitive> = new DRef();
  /** @internal */
  private readonly _material: DRef<MeshMaterial>;
  /** @internal */
  protected _instanceHash: string;
  /** @internal */
  protected _batchable: boolean;
  /** @internal */
  protected _pickTarget: PickTarget;
  /** @internal */
  protected _renderBundle: Record<string, RenderBundle>;
  /** @internal */
  protected _useRenderBundle: boolean;
  /** @internal */
  protected _materialChangeTag: number;
  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene, material?: Sprite3DMaterial) {
    super(scene);
    this._material = new DRef();
    this._instanceHash = null;
    this._pickTarget = { node: this };
    this._batchable = getDevice().type !== 'webgl';
    this.material = material ?? Sprite3D._getDefaultMaterial();
    this._renderBundle = {};
    this._useRenderBundle = true;
    this._materialChangeTag = null;
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
      this._instanceHash = m ? `${this.constructor.name}:${this._scene?.id ?? 0}:${m.instanceId}` : null;
      RenderBundleWrapper.drawableChanged(this);
      this._materialChangeTag = null;
    }
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
  getMorphInfo(): MorphInfo {
    return null;
  }
  /**
   * {@inheritDoc Drawable.isBatchable}
   */
  isBatchable(): this is BatchDrawable {
    return this._batchable && this._material.get()?.isBatchable();
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
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, hash?: string) {
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
    let primitive = Sprite3D._primitive.get();
    if (!primitive) {
      primitive = new Primitive();
      primitive.createAndSetVertexBuffer('position_f32', new Float32Array([1, 2, 3, 4]));
      primitive.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      primitive.primitiveType = 'triangle-strip';
      Sprite3D._primitive.set(primitive);
    }
    return primitive;
  }
  /**
   * {@inheritDoc Drawable.getBoneMatrices}
   */
  getBoneMatrices(): Texture2D {
    return null;
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
    return new BoundingBox();
  }
  /** Disposes the mesh node */
  protected onDispose() {
    super.onDispose();
    this._material.dispose();
    this._renderBundle = null;
    RenderBundleWrapper.drawableChanged(this);
  }
  /** @internal */
  private static _defaultMaterial: Sprite3DMaterial = null;
  /** @internal */
  private static _getDefaultMaterial(): Sprite3DMaterial {
    if (!this._defaultMaterial) {
      this._defaultMaterial = new Sprite3DMaterial();
    }
    return this._defaultMaterial;
  }
}
