import type { Matrix4x4 } from '@zephyr3d/base';
import { Vector4, applyMixins, Vector3, DRef } from '@zephyr3d/base';
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
import type { Drawable, DrawContext, PickTarget, Primitive, PrimitiveInstanceInfo } from '../../render';
import { Clipmap } from '../../render';
import { ClipmapTerrainMaterial } from '../../material/terrain-cm';
import { Application } from '../../app';
import type { MeshMaterial } from '../../material';
import type { BoundingVolume } from '../../utility/bounding_volume';
import { BoundingBox } from '../../utility/bounding_volume';
import {
  MAX_TERRAIN_MIPMAP_LEVELS,
  RENDER_PASS_TYPE_OBJECT_COLOR,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../../values';
import type { BlitType } from '../../blitter';
import { CopyBlitter } from '../../blitter';
import { fetchSampler } from '../../utility/misc';
import { RenderMipmap } from '../../utility/rendermipmap';
import { GrassRenderer } from './grass';
import type { Camera } from '../../camera';

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

/**
 * ClipmapTerrain implements an efficient terrain rendering system using clipmaps.
 *
 * Clipmaps provide level-of-detail (LOD) rendering for large terrains by using
 * multiple nested grids at different resolutions. The terrain automatically
 * adjusts detail levels based on camera distance, providing high detail near
 * the camera and lower detail in the distance.
 *
 * Key features:
 * - Automatic LOD management based on camera position
 * - Support for height maps, splat maps, and detail textures
 * - Integrated grass rendering system
 *
 * @public
 */
export class ClipmapTerrain
  extends applyMixins(GraphNode, mixinDrawable)
  implements Drawable, NodeClonable<ClipmapTerrain>
{
  private static readonly _heightBoundingGenerator = new HeightBoundingGenerator();
  private static readonly _copyBlitter = new HeightMinMaxBlitter();
  private static readonly _tmpBuffer = new Float32Array(MAX_TERRAIN_MIPMAP_LEVELS * 2 * 4);
  private readonly _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _renderData: PrimitiveInstanceInfo[];
  private _gridScale: number;
  private _material: DRef<ClipmapTerrainMaterial>;
  private _grassRenderer: DRef<GrassRenderer>;
  private _castShadow: boolean;
  private _sizeX: number;
  private _sizeZ: number;
  private _heightMapAssetId: string;
  private _splatMapAssetId: string;
  private _grassAssetId: string;
  private _minHeight: number;
  private _maxHeight: number;
  private _tmpTexture: DRef<Texture2D>;
  /**
   * Creates a new clipmap terrain instance.
   *
   * @param scene - Scene to add the terrain to
   * @param sizeX - Terrain width in world units (default: 256)
   * @param sizeZ - Terrain depth in world units (default: 256)
   * @param clipMapTileSize - Size of each clipmap tile in vertices (default: 64)
   *                         Larger values use more memory but reduce draw calls
   *
   */
  constructor(scene: Scene, sizeX = 256, sizeZ = 256, clipMapTileSize = 64) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(clipMapTileSize, ['tex1_f32'], MAX_TERRAIN_MIPMAP_LEVELS);
    this._renderData = null;
    this._grassRenderer = new DRef(new GrassRenderer(this));
    this._gridScale = 1;
    this._castShadow = true;
    this._sizeX = sizeX;
    this._sizeZ = sizeZ;
    this._heightMapAssetId = `.embedded.dir/${this.persistentId}-heightmap.bin`;
    this._grassAssetId = `.embedded.dir/${this.persistentId}-grass.bin`;
    this._splatMapAssetId = `.embedded.dir/${this.persistentId}-splatmap.bin`;
    this._minHeight = 0;
    this._maxHeight = 0;
    this._material = new DRef(
      new ClipmapTerrainMaterial(this.createHeightMapTexture(this._sizeX, this._sizeZ))
    );
    this._tmpTexture = new DRef();
    this.updateRegion();
    scene.queuePerCameraUpdateNode(this);
  }
  /**
   * Gets the integrated grass renderer for this terrain.
   * The grass renderer handles vegetation rendering on the terrain surface.
   *
   * @returns The grass renderer instance
   */
  get grassRenderer() {
    return this._grassRenderer.get();
  }
  /**
   * Gets the maximum number of detail maps supported by the terrain material.
   * Detail maps provide surface texturing (grass, rock, sand, etc.).
   *
   * @returns Maximum number of detail maps
   */
  get MAX_DETAIL_MAP_COUNT() {
    return ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT;
  }
  /**
   * Gets the asset ID for the height map texture.
   * Generates a random UUID if not previously set.
   *
   * @returns Height map asset ID
   * @internal
   */
  get heightMapAssetId() {
    if (!this._heightMapAssetId) {
      this._heightMapAssetId = crypto.randomUUID();
    }
    return this._heightMapAssetId;
  }
  set heightMapAssetId(val: string) {
    this._heightMapAssetId = val;
  }
  /**
   * Gets the asset ID for the splat map texture.
   * Generates a random UUID if not previously set.
   *
   * @returns Splat map asset ID
   * @internal
   */
  get splatMapAssetId() {
    if (!this._splatMapAssetId) {
      this._splatMapAssetId = crypto.randomUUID();
    }
    return this._splatMapAssetId;
  }
  set splatMapAssetId(val: string) {
    this._splatMapAssetId = val;
  }
  /**
   * Gets the asset ID for grass configuration.
   * Generates a random UUID if not previously set.
   *
   * @returns Grass asset ID
   * @internal
   */
  get grassAssetId() {
    if (!this._grassAssetId) {
      this._grassAssetId = crypto.randomUUID();
    }
    return this._grassAssetId;
  }
  set grassAssetId(val: string) {
    this._grassAssetId = val;
  }
  /**
   * The current number of active detail maps.
   * Detail maps define different surface materials (grass, rock, etc.).
   *
   * @returns Number of active detail maps
   */
  get numDetailMaps(): number {
    return this.material.numDetailMaps;
  }
  set numDetailMaps(val: number) {
    this.material.numDetailMaps = val;
  }
  /** {@inheritDoc SceneNode.clone} */
  clone(method: NodeCloneMethod, recursive: boolean) {
    const other = new ClipmapTerrain(this.scene, this._sizeX, this._sizeZ);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  /** {@inheritDoc SceneNode.copyFrom} */
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.setSize(other.sizeX, other.sizeZ);
    this.wireframe = other.wireframe;
    this.castShadow = other.castShadow;
  }
  /**
   * Sets the terrain size.
   * Triggers height map resize if dimensions change.
   *
   * @param sizeX - New width
   * @param sizeZ - New depth
   */
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
  /** The terrain width. */
  get sizeX() {
    return this._sizeX;
  }
  set sizeX(val: number) {
    if (val !== this._sizeX) {
      this._sizeX = val;
      this.resizeHeightMap(this._sizeX, this._sizeZ);
    }
  }
  /** The terrain depth. */
  get sizeZ() {
    return this._sizeZ;
  }
  set sizeZ(val: number) {
    if (val !== this._sizeZ) {
      this._sizeZ = val;
      this.resizeHeightMap(this._sizeX, this._sizeZ);
    }
  }
  /** The current height map texture. */
  get heightMap(): Texture2D {
    return this.material.heightMap;
  }
  set heightMap(val: Texture2D) {
    if (val) {
      this.material.heightMap = val;
      this.updateRegion();
    }
  }
  /** The splat map texture */
  get splatMap(): Texture2DArray | Texture2D {
    return this.material.getSplatMap();
  }
  /** Material instance of the terrain */
  get material(): ClipmapTerrainMaterial {
    return this._material?.get() ?? null;
  }
  /** whether wireframe rendering is enabled */
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
   * {@inheritDoc SceneNode.isClipmapTerrain}
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
   * the actual world-space region covered by this terrain (After applying world transform).
   */
  get worldRegion(): Vector4 {
    return this.material.region;
  }
  /**
   * Calculates the local transformation matrix.
   * For terrains, this only includes translation.
   *
   * @param outMatrix - Output matrix to store the result
   */
  calculateLocalTransform(outMatrix: Matrix4x4): void {
    outMatrix.translation(this._position);
  }
  /**
   * Calculates the world transformation matrix.
   * Terrains inherit only translation from parent nodes.
   *
   * @param outMatrix - Output matrix to store the result
   */
  calculateWorldTransform(outMatrix: Matrix4x4): void {
    outMatrix.set(this.localMatrix);
    if (this.parent) {
      outMatrix.m03 += this.parent.worldMatrix.m03;
      outMatrix.m13 += this.parent.worldMatrix.m13;
      outMatrix.m23 += this.parent.worldMatrix.m23;
    }
  }
  /**
   * Updates the terrain's bounding box by analyzing the height map.
   * This is an asynchronous operation that reads back GPU data.
   *
   * @param tmpTexture - Optional temporary texture to reuse (optimization)
   *
   * @example
   * ```typescript
   * // Update bounding box after changing height map
   * terrain.heightMap = newHeightMap;
   * terrain.updateBoundingBox();
   * ```
   */
  updateBoundingBox() {
    const heightMap = this.heightMap;
    const device = Application.instance.device;
    let tmp = this._tmpTexture.get();
    if (tmp && (tmp.width !== heightMap.width || tmp.height !== heightMap.height)) {
      this._tmpTexture.dispose();
    }
    if (!this._tmpTexture.get()) {
      tmp = Application.instance.device.createTexture2D(
        device.type === 'webgl' ? 'rgba32f' : 'rg32f',
        heightMap.width,
        heightMap.height
      );
      tmp.name = 'TerrainBoundingBoxTexture';
      this._tmpTexture.set(tmp);
    }
    const tmpFB = device.createFrameBuffer([tmp], null);
    ClipmapTerrain._copyBlitter.blit(heightMap, tmpFB, fetchSampler('clamp_nearest_nomip'));
    tmpFB.dispose();
    ClipmapTerrain._heightBoundingGenerator.render(tmp);
    const data = new Float32Array(4);
    tmp
      .readPixels(0, 0, 1, 1, 0, tmp.mipLevelCount - 1, data)
      .then(() => {
        this._minHeight = data[0];
        this._maxHeight = data[1];
        this.invalidateWorldBoundingVolume(false);
      })
      .catch((_err) => {
        console.error('Read pixels failed');
      });
  }
  /** @internal */
  createHeightMapTexture(width: number, height: number) {
    return Application.instance.device.createTexture2D(
      Application.instance.device.type === 'webgl' ? 'rgba16f' : 'r16f',
      width,
      height
    );
  }
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean): void {
    super._onTransformChanged(invalidateLocal);
    this.updateRegion();
  }
  /** {@inheritDoc SceneNode.updatePerCamera} */
  updatePerCamera(camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number): void {
    const mat = this._material.get();
    const that = this;
    const bv = this.getWorldBoundingVolume().toAABB();
    this._renderData = this._clipmap.gather({
      camera: camera,
      minMaxWorldPos: mat.region,
      gridScale: this._gridScale,
      userData: this,
      calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
        const p = that.worldMatrix.transformPointAffine(Vector3.zero());
        outAABB.minPoint.setXYZ(minX, bv ? bv.minPoint.y : p.y - 9999, minZ);
        outAABB.maxPoint.setXYZ(maxX, bv ? bv.maxPoint.y : p.y + 9999, maxZ);
      }
    });
    let maxMipLevel = 0;
    for (const info of this._renderData) {
      const buffer = info.primitive.getVertexBuffer('texCoord1');
      buffer.bufferSubData(0, info.mipLevels, 0, info.numInstances);
      if (info.maxMiplevel > maxMipLevel) {
        maxMipLevel = info.maxMiplevel;
      }
    }
    const levelAABB = this._clipmap.calcLevelAABB(camera, mat.region, this._gridScale);
    const cameraPos = camera.getWorldPosition();
    const tmpBuffer = ClipmapTerrain._tmpBuffer;

    for (let i = 0; i <= maxMipLevel; i++) {
      if (i === 0) {
        tmpBuffer[i * 8 + 0] = cameraPos.x;
        tmpBuffer[i * 8 + 1] = cameraPos.z;
        tmpBuffer[i * 8 + 2] = cameraPos.x;
        tmpBuffer[i * 8 + 3] = cameraPos.z;
      } else {
        const prevAABB = levelAABB[i - 1];
        tmpBuffer[i * 8 + 0] = prevAABB.minPoint.x;
        tmpBuffer[i * 8 + 1] = prevAABB.minPoint.z;
        tmpBuffer[i * 8 + 2] = prevAABB.maxPoint.x;
        tmpBuffer[i * 8 + 3] = prevAABB.maxPoint.z;
      }
      const currentAABB = levelAABB[i];
      tmpBuffer[i * 8 + 4] = 1 / (currentAABB.minPoint.x - tmpBuffer[i * 8 + 0]);
      tmpBuffer[i * 8 + 5] = 1 / (currentAABB.minPoint.z - tmpBuffer[i * 8 + 1]);
      tmpBuffer[i * 8 + 6] = 1 / (currentAABB.maxPoint.x - tmpBuffer[i * 8 + 2]);
      tmpBuffer[i * 8 + 7] = 1 / (currentAABB.maxPoint.z - tmpBuffer[i * 8 + 3]);
    }
    mat.setLevelData(tmpBuffer, 8 * (maxMipLevel + 1));

    this.scene.queuePerCameraUpdateNode(this);
  }
  /** @internal */
  updateRegion() {
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
    this._grassRenderer?.get().updateMaterial();
  }
  /** {@inheritDoc Drawable.draw} */
  draw(ctx: DrawContext) {
    const mat = this._material?.get();
    this.bind(ctx);
    mat.setClipmapGridInfo(this._gridScale, this.worldMatrix.m03, this.worldMatrix.m23);
    mat.apply(ctx);
    for (const info of this._renderData) {
      mat.draw(info.primitive, ctx, info.numInstances);
    }
    if (
      ctx.renderPass.type !== RENDER_PASS_TYPE_OBJECT_COLOR &&
      ctx.renderPass.type !== RENDER_PASS_TYPE_SHADOWMAP
    ) {
      this._grassRenderer.get().draw(ctx);
    }
  }
  /** @internal */
  private resizeHeightMap(sizeX: number, sizeZ: number) {
    const oldHeightMap = this.material.heightMap;
    const device = Application.instance.device;
    const maxTextureSize = device.getDeviceCaps().textureCaps.maxTextureSize;
    sizeX = Math.min(Math.max(sizeX, 1), maxTextureSize) >> 0;
    sizeZ = Math.min(Math.max(sizeZ, 1), maxTextureSize) >> 0;
    if (sizeX !== oldHeightMap.width || sizeZ !== oldHeightMap.height) {
      const newHeightMap = device.createTexture2D(device.type === 'webgl' ? 'rgba16f' : 'r16f', sizeX, sizeZ);
      const fb = device.createFrameBuffer([newHeightMap], null);
      ClipmapTerrain._copyBlitter.blit(oldHeightMap, fb, fetchSampler('clamp_linear_nomip'));
      fb.dispose();
      this.heightMap = newHeightMap;
      this.updateBoundingBox();
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
  /**
   * Disposes of all resources used by this terrain.
   * Should be called when the terrain is no longer needed.
   */
  dispose(): void {
    super.dispose();
    this._clipmap?.dispose();
    this._clipmap = null;
    this._material?.dispose();
    this._material = null;
    this._grassRenderer?.dispose();
    this._grassRenderer = null;
  }
}
