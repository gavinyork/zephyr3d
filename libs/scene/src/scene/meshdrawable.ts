import type { Nullable } from '@zephyr3d/base';
import { applyMixins, Disposable, DRef } from '@zephyr3d/base';
import type { MeshMaterial } from '../material';
import type {
  BatchDrawable,
  Drawable,
  DrawContext,
  MorphData,
  MorphInfo,
  PickTarget,
  Primitive,
  RenderQueue
} from '../render';
import type { SkinInfluenceData } from '../render';
import type { SceneNode } from '.';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Texture2D } from '@zephyr3d/device';
import type { Camera } from '../camera';
import { QUEUE_OPAQUE } from '../values';

export class MeshDrawableBase extends Disposable {
  private _node: SceneNode;
  constructor(node: SceneNode) {
    super();
    this._node = node;
  }
  getName() {
    return this._node.name;
  }
  getNode() {
    return this._node;
  }
}

export class MeshDrawable<M extends MeshMaterial>
  extends applyMixins(MeshDrawableBase, mixinDrawable)
  implements Drawable
{
  private _material: DRef<M>;
  private _primitive: DRef<Primitive>;
  constructor(node: SceneNode, material: M, primitive: Primitive) {
    super(node);
    this._material = new DRef(material);
    this._primitive = new DRef(primitive);
  }
  get material() {
    return this._material.get();
  }
  set material(mat) {
    this._material.set(mat);
  }
  getMaterial(): Nullable<MeshMaterial> {
    return this.material;
  }
  get primitive() {
    return this._primitive.get();
  }
  set primitive(prim) {
    this._primitive.set(prim);
  }
  getPrimitive(): Nullable<Primitive> {
    return this.primitive;
  }
  getPickTarget(): PickTarget {
    return { node: this.getNode() };
  }
  getBoneMatrices(): Nullable<Texture2D> {
    return null;
  }
  getSkinInfluenceData(): Nullable<SkinInfluenceData> {
    return null;
  }
  getMorphData(): Nullable<MorphData> {
    return null;
  }
  getMorphInfo(): Nullable<MorphInfo> {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getSortDistance}
   */
  getSortDistance(camera: Camera) {
    const cameraWorldMatrix = camera.worldMatrix;
    const objectWorldMatrix = this.getNode().worldMatrix;
    const dx = cameraWorldMatrix.m03 - objectWorldMatrix.m03;
    const dy = cameraWorldMatrix.m13 - objectWorldMatrix.m13;
    const dz = cameraWorldMatrix.m23 - objectWorldMatrix.m23;
    return dx * dx + dy * dy * dz * dz;
  }
  getQueueType(): number {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  needSceneColor(): boolean {
    return this._material.get()?.needSceneColor() ?? false;
  }
  needSceneDepth(): boolean {
    return this._material.get()?.needSceneDepth() ?? false;
  }
  isUnlit(): boolean {
    return !this._material.get()?.supportLighting();
  }
  isBatchable(): this is BatchDrawable {
    return !!this._material.get() && this._material.get()!.isBatchable();
  }
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>): void {
    const material = this.material;
    const primitive = this.primitive;
    if (material && primitive) {
      this.bind(ctx, renderQueue);
      material.draw(primitive, ctx);
    }
  }
  protected onDispose() {
    super.onDispose();
    this._material.dispose();
    this._primitive.dispose();
  }

  getName() {
    return this.getNode().name;
  }
}
