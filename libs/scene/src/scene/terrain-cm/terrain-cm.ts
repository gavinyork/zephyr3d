import { Vector4, applyMixins, Matrix4x4, Vector3 } from '@zephyr3d/base';
import type {
  GPUDataBuffer,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
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
import type { BlitType } from '../../blitter';
import { CopyBlitter } from '../../blitter';
import { fetchSampler } from '../../utility/misc';
import { RenderMipmap } from '../../utility/rendermipmap';
import type { GrassRenderer } from './grass';

class HeightMinMaxBlitter extends CopyBlitter {
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    return this.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType).xxxx;
  }
}

class HeightBoundingGenerator extends RenderMipmap {
  renderPixel(
    scope: PBInsideFunctionScope,
    leftTop: PBShaderExp,
    rightTop: PBShaderExp,
    leftBottom: PBShaderExp,
    rightBottom: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    scope.$l.maxHeight = pb.max(pb.max(leftTop.r, rightTop.r), pb.max(leftBottom.r, rightBottom.r));
    scope.$l.minHeight = pb.min(pb.min(leftTop.g, rightTop.g), pb.min(leftBottom.g, rightBottom.g));
    return pb.vec4(scope.maxHeight, scope.minHeight, leftTop.r, 1);
  }
}

export class ClipmapTerrain
  extends applyMixins(GraphNode, mixinDrawable)
  implements Drawable, NodeClonable<ClipmapTerrain>
{
  private static _heightBoundingGenerator = new HeightBoundingGenerator();
  private static _copyBlitter = new HeightMinMaxBlitter();
  private _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _gridScale: number;
  private _material: DRef<ClipmapTerrainMaterial>;
  private _grassRenderer: DRef<GrassRenderer>;
  private _castShadow: boolean;
  private _sizeX: number;
  private _sizeZ: number;
  private _heightMapAssetId: string;
  private _splatMapAssetId: string;
  private _minHeight: number;
  private _maxHeight: number;
  constructor(scene: Scene, sizeX = 256, sizeZ = 256, clipMapTileSize = 64) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(clipMapTileSize);
    this._grassRenderer = new DRef();
    this._gridScale = 1;
    this._castShadow = true;
    this._sizeX = sizeX;
    this._sizeZ = sizeZ;
    this._heightMapAssetId = '';
    this._splatMapAssetId = '';
    this._minHeight = 0;
    this._maxHeight = 0;
    this._material = new DRef(
      new ClipmapTerrainMaterial(this.createHeightMapTexture(this._sizeX, this._sizeZ), clipMapTileSize)
    );
    this.updateRegion();
  }
  get grassRenderer() {
    return this._grassRenderer.get();
  }
  get MAX_DETAIL_MAP_COUNT() {
    return ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT;
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
  get numDetailMaps(): number {
    return this.material.numDetailMaps;
  }
  set numDetailMaps(val: number) {
    this.material.numDetailMaps = val;
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
    const minHeight = this._minHeight * this.scale.y;
    const maxHeight = this._maxHeight * this.scale.y;
    return new BoundingBox(
      new Vector3(this.material.region.x, p.y + Math.min(minHeight, maxHeight), this.material.region.y),
      new Vector3(this.material.region.z, p.y + Math.max(minHeight, maxHeight), this.material.region.w)
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
  updateBoundingBox(tmpTexture?: Texture2D) {
    const heightMap = this.heightMap;
    const device = Application.instance.device;
    const tmp =
      tmpTexture && tmpTexture.width === heightMap.width && tmpTexture.height === heightMap.height
        ? tmpTexture
        : Application.instance.device.createTexture2D(
            device.type === 'webgl' ? 'rgba16f' : 'rg32f',
            heightMap.width,
            heightMap.height
          );
    ClipmapTerrain._copyBlitter.blit(heightMap, tmp, fetchSampler('clamp_nearest_nomip'));
    ClipmapTerrain._heightBoundingGenerator.render(tmp);
    const data = new Float32Array(2);
    tmp
      .readPixels(0, 0, 1, 1, 0, tmp.mipLevelCount - 1, data)
      .then(() => {
        console.log(data[0], data[1]);
        this._minHeight = data[0];
        this._maxHeight = data[1];
        this.invalidateWorldBoundingVolume(false);
      })
      .catch((err) => {
        console.error('Read pixels failed');
      })
      .finally(() => {
        if (tmp !== tmpTexture) {
          tmp.dispose();
        }
      });
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
      const px = this.position.x + (this.parent?.worldMatrix.m03 ?? 0);
      const pz = this.position.z + (this.parent?.worldMatrix.m23 ?? 0);
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
      ClipmapTerrain._copyBlitter.blit(oldHeightMap, newHeightMap, fetchSampler('clamp_linear_nomip'));
      this.heightMap = newHeightMap;
    }
  }
  /*
  private calcNormalHeightMap(): Texture2D {
    const device = Application.instance.device;
    if (!ClipmapTerrain._normalHeightMapProgram) {
      ClipmapTerrain._normalHeightMapProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.heightMap = pb.tex2D().uniform(0);
          this.texelSize = pb.vec2().uniform(0);
          this.terrainScale = pb.vec3().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.func('calcNormal', [pb.vec2('texCoord')], function () {
            this.$l.t = pb.textureSample(
              this.heightMap,
              pb.sub(this.texCoord, pb.vec2(0, this.texelSize.y))
            ).r;
            this.$l.l = pb.textureSample(
              this.heightMap,
              pb.sub(this.texCoord, pb.vec2(this.texelSize.x, 0))
            ).r;
            this.$l.r = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(this.texelSize.x, 0))
            ).r;
            this.$l.b = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(0, this.texelSize.y))
            ).r;
            this.$l.tx = pb.vec3(this.terrainScale.x, pb.mul(pb.sub(this.r, this.l), this.terrainScale.y), 0);
            this.$l.tz = pb.vec3(0, pb.mul(pb.sub(this.b, this.t), this.terrainScale.y), this.terrainScale.z);
            this.$l.normal = pb.normalize(pb.cross(this.tz, this.tx));
            this.$return(this.normal);
          });
          pb.main(function () {
            this.$l.normal = this.calcNormal(this.$inputs.uv);
            this.$outputs.outColor = pb.vec4(pb.add(pb.mul(this.normal, 0.5), pb.vec3(0.5)), 1);
          });
        }
      });
    }
  }
  */
  dispose(): void {
    super.dispose();
    this._clipmap?.dispose();
    this._clipmap = null;
    this._material?.dispose();
    this._material = null;
  }
}
