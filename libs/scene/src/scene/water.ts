import { Vector4 } from '@zephyr3d/base';
import { applyMixins, Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { NodeClonable, NodeCloneMethod } from './scene_node';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, Primitive, WaveGenerator } from '../render';
import { Clipmap } from '../render';
import { WaterMaterial } from '../material/water';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import { DRef } from '../app';
import { QUEUE_OPAQUE } from '../values';
import type { MeshMaterial } from '../material';
import type { BoundingVolume } from '../utility/bounding_volume';
import { BoundingBox } from '../utility/bounding_volume';

export class Water extends applyMixins(GraphNode, mixinDrawable) implements Drawable, NodeClonable<Water> {
  private _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _gridScale: number;
  private _animationSpeed: number;
  private _timeStart: number;
  private _material: DRef<WaterMaterial>;
  constructor(scene: Scene) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(32);
    this._gridScale = 1;
    this._animationSpeed = 1;
    this._timeStart = 0;
    this._material = new DRef(new WaterMaterial());
    this._material.get().region = new Vector4(-1, -1, 1, 1);
    this._material.get().TAAStrength = 0.4;
  }
  clone(method: NodeCloneMethod, recursive: boolean) {
    const other = new Water(this.scene);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.waveGenerator = other.waveGenerator;
    this.gridScale = other.gridScale;
    this.wireframe = other.wireframe;
  }
  get wireframe() {
    return this._clipmap.wireframe;
  }
  set wireframe(val: boolean) {
    this._clipmap.wireframe = !!val;
  }
  get material(): WaterMaterial {
    return this._material.get();
  }
  get waveGenerator(): WaveGenerator {
    return this.material.waveGenerator;
  }
  get animationSpeed() {
    return this._animationSpeed;
  }
  set animationSpeed(val: number) {
    this._animationSpeed = val;
  }
  set waveGenerator(waveGenerator: WaveGenerator) {
    this.material.waveGenerator = waveGenerator;
    if (this.material.needUpdate()) {
      this.scene.queueUpdateNode(this);
    }
  }
  get TAAStrength() {
    return this.material.TAAStrength;
  }
  set TAAStrength(val: number) {
    this.material.TAAStrength = val;
  }
  update(frameId: number, elapsedInSeconds: number) {
    if (this.material.needUpdate()) {
      this.scene.queueUpdateNode(this);
      if (this._timeStart === 0) {
        this._timeStart = elapsedInSeconds;
      }
      this.material.update(frameId, (elapsedInSeconds - this._timeStart) * this._animationSpeed);
    }
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
  computeWorldBoundingVolume(): BoundingVolume {
    const p = this.worldMatrix.transformPointAffine(Vector3.zero());
    const mat = this._material?.get();
    return mat
      ? new BoundingBox(
          new Vector3(mat.region.x, p.y, mat.region.y),
          new Vector3(mat.region.z, p.y, mat.region.w)
        )
      : null;
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
  calculateLocalTransform(outMatrix: Matrix4x4): void {
    outMatrix.translation(this._position);
  }
  calculateWorldTransform(outMatrix: Matrix4x4): void {
    outMatrix.set(this.localMatrix);
    if (this.parent) {
      outMatrix.m03 += this.parent.worldMatrix.m03;
      outMatrix.m13 += this.parent.worldMatrix.m13;
      outMatrix.m23 += this.parent.worldMatrix.m23;
    }
  }
  protected _onTransformChanged(invalidateLocal: boolean): void {
    super._onTransformChanged(invalidateLocal);
    const material = this._material?.get();
    if (material) {
      const x = Math.abs(this.scale.x);
      const z = Math.abs(this.scale.z);
      const px = this.position.x;
      const pz = this.position.z;
      material.region = new Vector4(px - x, pz - z, px + x, pz + z);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    const mat = this._material?.get();
    const that = this;
    this.bind(ctx);
    this._clipmap.draw({
      camera: ctx.camera,
      minMaxWorldPos: mat.region,
      gridScale: Math.max(0.01, this._gridScale),
      userData: this,
      calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
        const p = that.worldMatrix.transformPointAffine(Vector3.zero());
        if (that.waveGenerator) {
          that.waveGenerator.calcClipmapTileAABB(minX, maxX, minZ, maxZ, p.y, outAABB);
        } else {
          outAABB.minPoint.setXYZ(minX, p.y, minZ);
          outAABB.maxPoint.setXYZ(maxX, p.y + 1, maxZ);
        }
      },
      drawPrimitive(prim, modelMatrix, offset, scale, gridScale) {
        const clipmapMatrix = new Matrix4x4(modelMatrix)
          .scaleLeft(new Vector3(scale, scale, 1))
          .translateLeft(new Vector3(offset.x, offset.y, 0))
          .scaleLeft(new Vector3(gridScale, gridScale, 1));
        clipmapMatrix.m03 -= that.worldMatrix.m03;
        clipmapMatrix.m13 -= that.worldMatrix.m23;
        mat.setClipmapMatrix(clipmapMatrix);
        mat.apply(ctx);
        mat.draw(prim, ctx);
      }
    });
  }
}
