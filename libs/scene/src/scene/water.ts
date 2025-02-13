import type { Vector4 } from '@zephyr3d/base';
import { applyMixins, Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { NodeClonable, NodeCloneMethod } from './scene_node';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, Primitive } from '../render';
import { Clipmap } from '../render';
import { WaterMaterial } from '../material/water';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import { Ref } from '../app';
import { QUEUE_OPAQUE } from '../values';
import type { MeshMaterial } from '../material';
import type { BoundingVolume } from '../utility/bounding_volume';
import { BoundingBox } from '../utility/bounding_volume';

export class Water extends applyMixins(GraphNode, mixinDrawable) implements Drawable, NodeClonable<Water> {
  private _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _gridScale: number;
  private _material: Ref<WaterMaterial>;
  constructor(scene: Scene) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(32);
    this._gridScale = 1;
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
   * {@inheritDoc GraphNode.isWater}
   */
  isWater(): this is Water {
    return true;
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   */
  computeBoundingVolume(): BoundingVolume {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.computeWorldBoundingVolume}
   */
  computeWorldBoundingVolume(localBV: BoundingVolume): BoundingVolume {
    const p = this.worldMatrix.transformPointAffine(Vector3.zero());
    return new BoundingBox(
      new Vector3(this.region.x, p.y, this.region.y),
      new Vector3(this.region.z, p.y, this.region.w)
    );
  }
  /**
   * Water region
   */
  get region() {
    return this._material.get().region;
  }
  set region(val: Vector4) {
    this._material.get().region = val;
    this.invalidateWorldBoundingVolume(false);
  }
  /**
   * Grid scale
   */
  get gridScale() {
    return this._gridScale;
  }
  set gridScale(val: number) {
    this._gridScale = val;
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    const camera = ctx.camera;
    const cameraPos = camera.getWorldPosition();
    const position = new Vector3(cameraPos.x, cameraPos.z, 0);
    const distX = Math.max(Math.abs(position.x - this.region.x), Math.abs(position.x - this.region.z));
    const distY = Math.max(Math.abs(position.y - this.region.y), Math.abs(position.y - this.region.w));
    const maxDist = Math.min(Math.max(distX, distY), camera.getFarPlane());
    const gridScale = Math.max(0.01, this._gridScale);
    const mipLevels = Math.ceil(Math.log2(maxDist / (this._clipmap.tileResolution * gridScale))) + 1;
    const that = this;
    this.bind(ctx);
    this._clipmap.draw(
      {
        camera,
        position,
        minMaxWorldPos: this.region,
        gridScale: gridScale,
        userData: this,
        calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
          const p = that.worldMatrix.transformPointAffine(Vector3.zero());
          outAABB.minPoint.setXYZ(minX, p.y, minZ);
          outAABB.maxPoint.setXYZ(maxX, p.y + 1, maxZ);
        },
        drawPrimitive(prim, modelMatrix, offset, scale, gridScale) {
          const worldMatrix = new Matrix4x4(modelMatrix)
            .scaleLeft(new Vector3(scale, scale, 1))
            .translateLeft(new Vector3(offset.x, offset.y, 0))
            .scaleLeft(new Vector3(gridScale, gridScale, 1));
          that._material.get().setClipmapMatrix(worldMatrix);
          that._material.get().apply(ctx);
          that._material.get().draw(prim, ctx);
        }
      },
      mipLevels
    );
  }
}
