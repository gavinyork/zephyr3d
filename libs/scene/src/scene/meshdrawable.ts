import type { Nullable } from '@zephyr3d/base';
import { DWeakRef } from '@zephyr3d/base';
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
import type { Mesh, SceneNode } from '.';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Texture2D } from '@zephyr3d/device';
import type { Camera } from '../camera';
import { QUEUE_OPAQUE } from '../values';

export class ProxyDrawableBase<T extends Disposable & Drawable = Mesh> extends Disposable {
  protected _host: DWeakRef<T>;
  protected _node: DWeakRef<SceneNode>;
  protected _material: DRef<MeshMaterial>;
  /**
   * Creates a proxy for a host drawable.
   *
   * @param host - Drawable that supplies the shared geometry, animation, and transform state.
   * @param overrideMaterial - Optional material used instead of the host drawable's material.
   */
  constructor(host: T, node?: SceneNode, overrideMaterial?: MeshMaterial) {
    super();
    this._host = new DWeakRef(host);
    this._node = new DWeakRef(node);
    this._material = new DRef(overrideMaterial);
  }
  getName(): string {
    return this._host.get()?.getName() ?? '';
  }
  getNode(): SceneNode {
    return this._node.get()!;
  }
  getPickTarget(): PickTarget {
    return this._host.get()!.getPickTarget();
  }
  getBoneMatrices(): Nullable<Texture2D> {
    return this._host.get()?.getBoneMatrices() ?? null;
  }
  getMorphData(): Nullable<MorphData> {
    return this._host.get()?.getMorphData() ?? null;
  }
  getMorphInfo(): Nullable<MorphInfo> {
    return this._host.get()?.getMorphInfo() ?? null;
  }
  getSortDistance(camera: Camera): number {
    return this._host.get()?.getSortDistance(camera) ?? 0;
  }
  getQueueType(): number {
    return this.getMaterial()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  needSceneColor(): boolean {
    return this.getMaterial()?.needSceneColor() ?? false;
  }
  needSceneDepth(): boolean {
    return this.getMaterial()?.needSceneDepth() ?? false;
  }
  isUnlit(): boolean {
    return !this.getMaterial()?.supportLighting();
  }
  getMaterial(): Nullable<MeshMaterial> {
    return this._material.get() ?? this._host.get()?.getMaterial() ?? null;
  }
  getPrimitive(): Nullable<Primitive> {
    return this._host.get()?.getPrimitive() ?? null;
  }
  isBatchable(): this is BatchDrawable {
    if (!this._host.get()?.isBatchable()) {
      return false;
    }
    if (this._material.get() && !this._material.get()!.isBatchable()) {
      return false;
    }
    return true;
  }
}

/**
 * Drawable proxy that renders an existing drawable with an optional material override.
 *
 * The proxy delegates geometry, picking, sorting, skinning, morph targets, and transform-related
 * state to the host drawable, so it can be submitted as a separate drawable while sharing the
 * host's animated and spatial state.
 *
 * If no override material is provided, the proxy uses the host drawable's material.
 *
 * @public
 */
export class ProxyDrawable extends applyMixins(ProxyDrawableBase<Disposable & Drawable>, mixinDrawable) {
  constructor(host: Disposable & Drawable, node?: SceneNode, overrideMaterial?: MeshMaterial) {
    super(host, node, overrideMaterial);
  }
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>): void {
    const material = this.getMaterial();
    const primitive = this.getPrimitive();
    if (material && primitive) {
      this.bind(ctx, renderQueue);
      material.draw(primitive, ctx);
    }
  }
}

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
