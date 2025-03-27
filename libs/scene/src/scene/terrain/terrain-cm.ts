import { Vector4, applyMixins, Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import type { NodeClonable, NodeCloneMethod } from '../scene_node';
import type { Scene } from '../scene';
import { GraphNode } from '../graph_node';
import { mixinDrawable } from '../../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, Primitive } from '../../render';
import { Clipmap } from '../../render';
import { ClipmapTerrainMaterial } from '../../material/terrain-cm';
import { Application, DRef } from '../../app';
import { MeshMaterial } from '../../material';
import type { BoundingVolume } from '../../utility/bounding_volume';
import { BoundingBox } from '../../utility/bounding_volume';

export class ClipmapTerrain
  extends applyMixins(GraphNode, mixinDrawable)
  implements Drawable, NodeClonable<ClipmapTerrain>
{
  private static _defaultHeightMap: DRef<Texture2D> = new DRef();
  private _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _gridScale: number;
  private _material: DRef<ClipmapTerrainMaterial>;
  private _castShadow: boolean;
  private _sizeX: number;
  private _sizeZ: number;
  constructor(scene: Scene, sizeX = 256, sizeZ = 256, clipMapTileSize = 128) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(clipMapTileSize);
    this._gridScale = 1;
    this._castShadow = true;
    this._sizeX = sizeX;
    this._sizeZ = sizeZ;
    this._material = new DRef(new ClipmapTerrainMaterial(ClipmapTerrain.getDefaultHeightMap()));
    this.updateRegion();
  }
  private static getDefaultHeightMap() {
    if (!this._defaultHeightMap.get()) {
      this._defaultHeightMap.set(
        Application.instance.device.createTexture2D('r16f', 1, 1, { samplerOptions: { mipFilter: 'none' } })
      );
    }
    return this._defaultHeightMap.get();
  }
  clone(method: NodeCloneMethod, recursive: boolean) {
    const other = new ClipmapTerrain(this.scene, this._sizeX, this._sizeZ);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.sizeX = other.sizeX;
    this.sizeZ = other.sizeZ;
    this.gridScale = other.gridScale;
    this.castShadow = other.castShadow;
  }
  setSize(sizeX: number, sizeZ: number) {
    if (sizeX !== this._sizeX || sizeZ !== this._sizeZ) {
      this._sizeX = sizeX;
      this._sizeZ = sizeZ;
      this.updateRegion();
    }
  }
  /** Wether the mesh node casts shadows */
  get castShadow(): boolean {
    return this._castShadow;
  }
  set castShadow(val: boolean) {
    this._castShadow = !!val;
  }
  get sizeX() {
    return this._sizeX;
  }
  set sizeX(val: number) {
    if (val !== this._sizeX) {
      this._sizeX = val;
      this.updateRegion();
    }
  }
  get sizeZ() {
    return this._sizeZ;
  }
  set sizeZ(val: number) {
    if (val !== this._sizeZ) {
      this._sizeZ = val;
      this.updateRegion();
    }
  }
  get heightMap(): Texture2D {
    return this.material.heightMap === ClipmapTerrain.getDefaultHeightMap() ? null : this.material.heightMap;
  }
  set heightMap(val: Texture2D) {
    this.material.heightMap = val ?? ClipmapTerrain.getDefaultHeightMap();
  }
  get material(): ClipmapTerrainMaterial {
    return this._material?.get() ?? null;
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
    return this.material.getQueueType();
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this.material.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor(): boolean {
    return this.material.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth(): boolean {
    return this.material.needSceneDepth();
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
  isClipmapTerrain(): this is ClipmapTerrain {
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
    return new BoundingBox(
      new Vector3(this.material.region.x, p.y - 9999, this.material.region.y),
      new Vector3(this.material.region.z, p.y + 9999, this.material.region.w)
    );
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
    this.updateRegion();
  }
  private updateRegion() {
    if (this.material) {
      const x = Math.abs(this.scale.x);
      const z = Math.abs(this.scale.z);
      const px = this.position.x;
      const pz = this.position.z;
      const gridScale = Math.max(
        (x * this._sizeX) / this.material.heightMap.width,
        (z * this._sizeZ) / this.material.heightMap.height
      );
      this.gridScale = Math.max(Math.min(gridScale, 1), 0.1);
      this.material.terrainScale = this.scale;
      this.material.region = new Vector4(px, pz, px + x * this._sizeX, pz + z * this._sizeZ);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    const mat = this._material?.get();
    const camera = ctx.camera;
    const cameraPos = camera.getWorldPosition();
    const position = new Vector3(cameraPos.x, cameraPos.z, 0);
    const distX = Math.max(Math.abs(position.x - mat.region.x), Math.abs(position.x - mat.region.z));
    const distY = Math.max(Math.abs(position.y - mat.region.y), Math.abs(position.y - mat.region.w));
    const maxDist = Math.min(Math.max(distX, distY), camera.getFarPlane());
    const gridScale = Math.max(0.01, this._gridScale);
    const mipLevels = Math.ceil(Math.log2(maxDist / (this._clipmap.tileResolution * gridScale))) + 1;
    const that = this;
    this.bind(ctx);
    this._clipmap.draw(
      {
        camera,
        position,
        minMaxWorldPos: mat.region,
        gridScale: gridScale,
        userData: this,
        calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
          const p = that.worldMatrix.transformPointAffine(Vector3.zero());
          outAABB.minPoint.setXYZ(minX, p.y - 9999, minZ);
          outAABB.maxPoint.setXYZ(maxX, p.y + 9999, maxZ);
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
      },
      mipLevels
    );
  }
}
