import { Vector4, applyMixins, Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { GPUDataBuffer, Texture2D, Texture2DArray } from '@zephyr3d/device';
import type { NodeClonable, NodeCloneMethod } from '../scene_node';
import type { Scene } from '../scene';
import { GraphNode } from '../graph_node';
import { mixinDrawable } from '../../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, Primitive } from '../../render';
import { Clipmap } from '../../render';
import { ClipmapTerrainMaterial } from '../../material/terrain-cm';
import { Application, DRef } from '../../app';
import type { MeshMaterial } from '../../material';
import type { BoundingVolume } from '../../utility/bounding_volume';
import { BoundingBox } from '../../utility/bounding_volume';
import { RENDER_PASS_TYPE_OBJECT_COLOR } from '../../values';
import { CopyBlitter } from '../../blitter';
import { fetchSampler } from '../../utility/misc';

export class ClipmapTerrain
  extends applyMixins(GraphNode, mixinDrawable)
  implements Drawable, NodeClonable<ClipmapTerrain>
{
  private _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _gridScale: number;
  private _material: DRef<ClipmapTerrainMaterial>;
  private _castShadow: boolean;
  private _sizeX: number;
  private _sizeZ: number;
  private _heightMapAssetId: string;
  private _splatMapAssetId: string;
  constructor(scene: Scene, sizeX = 256, sizeZ = 256, clipMapTileSize = 64) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(clipMapTileSize);
    this._gridScale = 1;
    this._castShadow = true;
    this._sizeX = sizeX;
    this._sizeZ = sizeZ;
    this._heightMapAssetId = '';
    this._splatMapAssetId = '';
    this._material = new DRef(
      new ClipmapTerrainMaterial(this.createHeightMapTexture(this._sizeX, this._sizeZ), clipMapTileSize)
    );
    this.updateRegion();
  }
  get heightMapAssetId() {
    if (!this._heightMapAssetId) {
      this._heightMapAssetId = crypto.randomUUID();
    }
    return this._heightMapAssetId;
  }
  set heightMapAssetId(val: string) {
    this._heightMapAssetId = val;
  }
  get splatMapAssetId() {
    if (!this._splatMapAssetId) {
      this._splatMapAssetId = crypto.randomUUID();
    }
    return this._splatMapAssetId;
  }
  set splatMapAssetId(val: string) {
    this._splatMapAssetId = val;
  }
  clone(method: NodeCloneMethod, recursive: boolean) {
    const other = new ClipmapTerrain(this.scene, this._sizeX, this._sizeZ);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.setSize(other.sizeX, other.sizeZ);
    this.wireframe = other.wireframe;
    this.castShadow = other.castShadow;
  }
  setSize(sizeX: number, sizeZ: number) {
    if (sizeX !== this._sizeX || sizeZ !== this._sizeZ) {
      this._sizeX = sizeX;
      this._sizeZ = sizeZ;
      this.resizeHeightMap(this._sizeX, this._sizeZ);
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
      this.resizeHeightMap(this._sizeX, this._sizeZ);
    }
  }
  get sizeZ() {
    return this._sizeZ;
  }
  set sizeZ(val: number) {
    if (val !== this._sizeZ) {
      this._sizeZ = val;
      this.resizeHeightMap(this._sizeX, this._sizeZ);
    }
  }
  get heightMap(): Texture2D {
    return this.material.heightMap;
  }
  set heightMap(val: Texture2D) {
    if (val) {
      this.material.heightMap = val;
      this.updateRegion();
    }
  }
  get splatMap(): Texture2DArray {
    return this.material.getSplatMap();
  }
  get material(): ClipmapTerrainMaterial {
    return this._material?.get() ?? null;
  }
  get wireframe() {
    return this._clipmap.wireframe;
  }
  set wireframe(val: boolean) {
    this._clipmap.wireframe = val;
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
   * World region
   */
  get worldRegion(): Vector4 {
    return this.material.region;
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
  createHeightMapTexture(width: number, height: number) {
    return Application.instance.device.createTexture2D('r16f', width, height);
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
      this._gridScale = Math.max(
        (x * this._sizeX) / this.material.heightMap.width,
        (z * this._sizeZ) / this.material.heightMap.height
      );
      this.material.update(new Vector4(px, pz, px + x * this._sizeX, pz + z * this._sizeZ), this.scale);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    const mat = this._material?.get();
    const that = this;
    this.bind(ctx);
    const wireframe = this._clipmap.wireframe;
    if (ctx.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
      this._clipmap.wireframe = false;
    }
    const levelAABB = this._clipmap.calcLevelAABB(ctx.camera, mat.region, this._gridScale);
    const cameraPos = ctx.camera.getWorldPosition();
    //console.log(levelAABB);
    this._clipmap.draw({
      camera: ctx.camera,
      minMaxWorldPos: mat.region,
      gridScale: this._gridScale,
      userData: this,
      calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
        const p = that.worldMatrix.transformPointAffine(Vector3.zero());
        outAABB.minPoint.setXYZ(minX, p.y - 9999, minZ);
        outAABB.maxPoint.setXYZ(maxX, p.y + 9999, maxZ);
      },
      drawPrimitive(prim, modelMatrix, offset, scale, gridScale, mipLevel) {
        const clipmapMatrix = new Matrix4x4(modelMatrix)
          .scaleLeft(new Vector3(scale, scale, 1))
          .translateLeft(new Vector3(offset.x, offset.y, 0))
          .scaleLeft(new Vector3(gridScale, gridScale, 1));
        clipmapMatrix.m03 -= that.worldMatrix.m03;
        clipmapMatrix.m13 -= that.worldMatrix.m23;
        mat.setClipmapMatrix(clipmapMatrix);
        mat.setHeightMapMipLevel(mipLevel);
        if (mipLevel === 0) {
          mat.setLevelStart(cameraPos.x, cameraPos.z, cameraPos.x, cameraPos.z);
        } else {
          const prevAABB = levelAABB[mipLevel - 1];
          mat.setLevelStart(
            prevAABB.minPoint.x,
            prevAABB.minPoint.z,
            prevAABB.maxPoint.x,
            prevAABB.maxPoint.z
          );
        }
        const currentAABB = levelAABB[mipLevel];
        mat.setLevelRange(
          currentAABB.minPoint.x,
          currentAABB.minPoint.z,
          currentAABB.maxPoint.x,
          currentAABB.maxPoint.z
        );
        mat.apply(ctx);
        mat.draw(prim, ctx);
      }
    });
    this._clipmap.wireframe = wireframe;
  }
  private resizeHeightMap(sizeX: number, sizeZ: number) {
    const oldHeightMap = this.material.heightMap;
    const device = Application.instance.device;
    const maxTextureSize = device.getDeviceCaps().textureCaps.maxTextureSize;
    sizeX = Math.min(Math.max(sizeX, 1), maxTextureSize) >> 0;
    sizeZ = Math.min(Math.max(sizeZ, 1), maxTextureSize) >> 0;
    if (sizeX !== oldHeightMap.width || sizeZ !== oldHeightMap.height) {
      const newHeightMap = device.createTexture2D('r16f', sizeX, sizeZ);
      new CopyBlitter().blit(oldHeightMap, newHeightMap, fetchSampler('clamp_linear_nomip'));
      this.heightMap = newHeightMap;
    }
  }
  dispose(): void {
    super.dispose();
    this._clipmap?.dispose();
    this._clipmap = null;
    this._material?.dispose();
    this._material = null;
  }
}
