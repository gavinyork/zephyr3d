import { applyMixins } from '@zephyr3d/base';
import type { NodeClonable, NodeCloneMethod, Scene } from '.';
import { GraphNode } from '.';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, Primitive } from '../render';
import { WaterMaterial } from '../material/water';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import { Ref } from '../app';
import { QUEUE_OPAQUE } from '../values';
import type { MeshMaterial } from '../material';

export class Water extends applyMixins(GraphNode, mixinDrawable) implements Drawable, NodeClonable<Water> {
  private _pickTarget: PickTarget;
  private _material: Ref<WaterMaterial>;
  constructor(scene: Scene) {
    super(scene);
    this._pickTarget = { node: this };
    this._material = new Ref(new WaterMaterial());
  }
  clone(method: NodeCloneMethod, recursive: boolean) {
    const other = new Water(this.scene);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget(): PickTarget {
    return this._pickTarget;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData(): Texture2D {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo(): GPUDataBuffer<unknown> {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType(): number {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this._material.get()?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor(): boolean {
    return this._material.get()?.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth(): boolean {
    return this._material.get()?.needSceneDepth();
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial(): MeshMaterial {
    return this._material.get();
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive(): Primitive {
    return null;
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    return;
  }
}
