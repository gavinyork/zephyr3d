import type { AABB, Immutable, Matrix4x4, Nullable } from '@zephyr3d/base';
import { Vector4, applyMixins, Vector3, DRef, randomUUID, half2float, nextPowerOf2 } from '@zephyr3d/base';
import type {
  BaseTexture,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import type { Scene } from '../scene';
import { GraphNode } from '../graph_node';
import { mixinDrawable } from '../../render/drawable_mixin';
import type {
  ClipmapGatherContext,
  Drawable,
  DrawContext,
  PickTarget,
  PrimitiveInstanceInfo,
  RenderQueue
} from '../../render';
import { Clipmap } from '../../render';
import { ClipmapTerrainMaterial } from '../../material/terrain-cm';
import { BoundingBox } from '../../utility/bounding_volume';
import {
  MAX_TERRAIN_MIPMAP_LEVELS,
  QUEUE_OPAQUE,
  RENDER_PASS_TYPE_OBJECT_COLOR,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../../values';
import type { BlitType } from '../../blitter';
import { CopyBlitter } from '../../blitter';
import { fetchSampler } from '../../utility/misc';
import { RenderMipmap } from '../../utility/rendermipmap';
import { GrassRenderer } from './grass';
import type { Camera } from '../../camera';
import { getDevice } from '../../app/api';
import type { TerrainVirtualTextureOptions } from './terrain_rvt';
import type { VirtualTexture } from '../../render/virtualtexture/virtual_texture';
import { TerrainVirtualTexture } from './terrain_rvt';
import { warnUnsupported } from '../../utility/unsupported';

class HeightMinMaxBlitter extends CopyBlitter {
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ) {
    return this.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType).xxxx as PBShaderExp;
  }
}

/**
 * Copies the height map into the top-left of a power-of-two target, repeating the last row and
 * column into the padding. The min/max reduction halves each level with a 2x2 footprint, which
 * drops the last row or column of an odd sized level; padding with edge copies avoids that
 * without affecting either extreme.
 */
class HeightPadBlitter extends CopyBlitter {
  /** (dest width, dest height, source width, source height) */
  readonly sizes = new Vector4();
  setup(scope: PBGlobalScope, _type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.padSizes = pb.vec4().uniform(0);
    }
  }
  setUniforms(bindGroup: BindGroup, _sourceTex: BaseTexture) {
    bindGroup.setValue('padSizes', this.sizes);
  }
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ) {
    const pb = scope.$builder;
    const sizes = scope.padSizes as PBShaderExp;
    const texel = pb.min(pb.floor(pb.mul(srcUV, sizes.xy)), pb.sub(sizes.zw, pb.vec2(1)));
    const uv = pb.div(pb.add(texel, pb.vec2(0.5)), sizes.zw);
    return this.readTexel(scope, type, srcTex, uv, srcLayer, sampleType).xxxx as PBShaderExp;
  }
}

class HeightBoundingGenerator extends RenderMipmap {
  renderPixel(
    scope: PBInsideFunctionScope,
    leftTop: PBShaderExp,
    rightTop: PBShaderExp,
    leftBottom: PBShaderExp,
    rightBottom: PBShaderExp
  ) {
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
export class ClipmapTerrain extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  private static readonly _heightBoundingGenerator = new HeightBoundingGenerator();
  private static readonly _copyBlitter = new HeightMinMaxBlitter();
  private static readonly _padBlitter = new HeightPadBlitter();
  private static readonly _tmpBuffer = new Float32Array(MAX_TERRAIN_MIPMAP_LEVELS * 2 * 4);
  private readonly _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _shadowClipmap: Clipmap;
  private _renderData: Nullable<PrimitiveInstanceInfo[]>;
  private _shadowRenderData: Nullable<PrimitiveInstanceInfo[]>;
  private _shadowGatherContext: Nullable<ClipmapGatherContext>;
  private _gridScale: number;
  /**
   * World position of clipmap grid point (0, 0): the centre of the first height map texel.
   * Texel i holds the height at the centre of cell i (the convention the height sampling,
   * brushes and grass placement all share), so this is what puts the finest level's vertices
   * on the samples instead of halfway between them.
   */
  private _gridOriginX: number;
  private _gridOriginZ: number;
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
  /** Bumped by every height range update, so a read back overtaken by a newer one is dropped */
  private _heightRangeSerial: number;
  private _heightData: Nullable<{ data: Uint16Array; width: number; height: number }>;
  private _heightVersion: number;
  private _tmpTexture: DRef<Texture2D>;
  private _virtualTexture: Nullable<TerrainVirtualTexture>;
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
    this._shadowClipmap = new Clipmap(clipMapTileSize, ['tex1_f32'], MAX_TERRAIN_MIPMAP_LEVELS);
    this._renderData = null;
    this._shadowRenderData = null;
    this._shadowGatherContext = null;
    this._grassRenderer = new DRef(new GrassRenderer(this));
    this._gridScale = 1;
    this._gridOriginX = 0;
    this._gridOriginZ = 0;
    this._castShadow = true;
    this._sizeX = sizeX;
    this._sizeZ = sizeZ;
    this._heightMapAssetId = `assets/.embedded.dir/${this.persistentId}-heightmap.bin`;
    this._grassAssetId = `assets/.embedded.dir/${this.persistentId}-grass.bin`;
    this._splatMapAssetId = `assets/.embedded.dir/${this.persistentId}-splatmap.bin`;
    this._minHeight = 0;
    this._maxHeight = 0;
    this._heightRangeSerial = 0;
    this._heightData = null;
    this._heightVersion = 0;
    this._material = new DRef(
      new ClipmapTerrainMaterial(this.createHeightMapTexture(this._sizeX, this._sizeZ))
    );
    this._tmpTexture = new DRef();
    this._virtualTexture = null;
    this.updateRegion();
    this.updateHeightPyramid();
    scene.queuePerCameraUpdateNode(this);
  }
  /**
   * Gets the integrated grass renderer for this terrain.
   * The grass renderer handles vegetation rendering on the terrain surface.
   *
   * @returns The grass renderer instance
   */
  get grassRenderer() {
    return this._grassRenderer.get()!;
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
      this._heightMapAssetId = randomUUID();
    }
    return this._heightMapAssetId;
  }
  /** @internal */
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
      this._splatMapAssetId = randomUUID();
    }
    return this._splatMapAssetId;
  }
  /** @internal */
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
      this._grassAssetId = randomUUID();
    }
    return this._grassAssetId;
  }
  /** @internal */
  set grassAssetId(val: string) {
    this._grassAssetId = val;
  }
  /**
   * The current number of active detail maps.
   * Detail maps define different surface materials (grass, rock, etc.).
   *
   * @returns Number of active detail maps
   */
  get numDetailMaps() {
    return this.material?.numDetailMaps ?? 0;
  }
  set numDetailMaps(val) {
    if (this.material) {
      this.material.numDetailMaps = val;
    }
  }
  /** {@inheritDoc SceneNode.clone} */
  async clone(): Promise<this> {
    throw new Error('Cloning clipmap terrain not implemented');
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
  /**
   * Whether the detail layers are blended into a runtime virtual texture instead of per pixel.
   * Pages are blended once, as the camera needs them, so shading costs the same whatever the
   * number of layers. WebGPU only, ignored elsewhere; has no effect without detail layers.
   *
   * Code writing into the splat map or the height map directly must call
   * {@link ClipmapTerrain.invalidateRuntimeVirtualTexture} for the area it changed.
   */
  get runtimeVirtualTexture() {
    return !!this._virtualTexture;
  }
  set runtimeVirtualTexture(val: boolean) {
    if (!!val !== this.runtimeVirtualTexture) {
      this.setRuntimeVirtualTexture(val ? {} : null);
    }
  }
  /**
   * Enables the runtime virtual texture with the given options, or disables it with null.
   * See {@link ClipmapTerrain.runtimeVirtualTexture}.
   */
  setRuntimeVirtualTexture(options: Nullable<TerrainVirtualTextureOptions>) {
    if (options && getDevice().type !== 'webgpu') {
      warnUnsupported(
        'Terrain runtime virtual texture (ClipmapTerrain.runtimeVirtualTexture)',
        'WebGPU',
        'the terrain is shaded directly every frame'
      );
      return;
    }
    if (options && !this.scene) {
      return;
    }
    if (this._virtualTexture && options) {
      this._virtualTexture.setOptions(options);
      return;
    }
    if (this._virtualTexture) {
      this.scene?.removeVirtualTextureClient(this._virtualTexture);
      this._virtualTexture.dispose();
      this._virtualTexture = null;
      if (this.material) {
        this.material.virtualTexture = null;
      }
    }
    if (options && this.material) {
      this._virtualTexture = new TerrainVirtualTexture(this, options);
      this.material.virtualTexture = this._virtualTexture.virtualTexture;
      this.scene!.addVirtualTextureClient(this._virtualTexture);
    }
  }
  /**
   * Refills the runtime virtual texture over a world XZ rectangle, or everywhere without
   * arguments. Needed after writing into the splat map or the height map directly (brushes);
   * replacing textures or changing layer parameters through the material is picked up
   * automatically.
   */
  invalidateRuntimeVirtualTexture(x0?: number, z0?: number, x1?: number, z1?: number) {
    if (!this._virtualTexture) {
      return;
    }
    if (x0 === undefined || z0 === undefined || x1 === undefined || z1 === undefined) {
      this._virtualTexture.invalidate();
    } else {
      this._virtualTexture.invalidateWorldRegion(x0, z0, x1, z1);
    }
  }
  /**
   * The virtual texture behind {@link ClipmapTerrain.runtimeVirtualTexture}, null when disabled.
   * For inspection: {@link VirtualTexture.stats}, {@link VirtualTexture.renderDebugTexture}.
   * It is recreated when the terrain aspect or the options change.
   */
  get runtimeVirtualTextureData(): Nullable<VirtualTexture> {
    return this._virtualTexture?.virtualTexture ?? null;
  }
  /** Wether the mesh node casts shadows */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(val) {
    this._castShadow = !!val;
  }
  /** The terrain width. */
  get sizeX() {
    return this._sizeX;
  }
  set sizeX(val) {
    if (val !== this._sizeX) {
      this._sizeX = val;
      this.resizeHeightMap(this._sizeX, this._sizeZ);
    }
  }
  /** The terrain depth. */
  get sizeZ() {
    return this._sizeZ;
  }
  set sizeZ(val) {
    if (val !== this._sizeZ) {
      this._sizeZ = val;
      this.resizeHeightMap(this._sizeX, this._sizeZ);
    }
  }
  /** The current height map texture. */
  get heightMap() {
    return this.material?.heightMap ?? null;
  }
  set heightMap(val) {
    if (this.material && val) {
      this.material.heightMap = val;
      this._heightData = null;
      this.updateRegion();
      this.updateHeightPyramid();
      this._heightVersion++;
    }
  }
  /**
   * Goes up whenever the heights change: a new height map, or edits to the
   * current one once {@link ClipmapTerrain.updateBoundingBox} is called after
   * them. Lets CPU-side users such as physics notice they are out of date.
   */
  get heightVersion() {
    return this._heightVersion;
  }
  /**
   * The heights as loaded from the height map asset, half floats row by row,
   * while the height map is unchanged since loading; null otherwise.
   *
   * @remarks
   * Lets CPU-side users such as physics read heights without a GPU read back.
   * Dropped when the height map is replaced or edited.
   */
  get heightData(): Nullable<{
    readonly data: Uint16Array;
    readonly width: number;
    readonly height: number;
  }> {
    return this._heightData;
  }
  /**
   * Records the CPU copy of the heights just uploaded to the height map.
   * @internal
   */
  setHeightData(data: Uint16Array, width: number, height: number) {
    this._heightData = { data, width, height };
    this._heightVersion++;
  }
  /** The splat map texture */
  get splatMap() {
    return this.material?.getSplatMap() ?? null;
  }
  /** Material instance of the terrain */
  get material() {
    return this._material?.get() ?? null;
  }
  /** whether wireframe rendering is enabled */
  get wireframe() {
    return this._clipmap.wireframe;
  }
  set wireframe(val) {
    this._clipmap.wireframe = val;
    this._shadowClipmap.wireframe = val;
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget() {
    return this._pickTarget;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData() {
    return null;
  }
  getSkinInfluenceData() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType() {
    return this.material?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit() {
    return this.material ? !this.material.supportLighting() : false;
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor() {
    return this.material?.needSceneColor() ?? false;
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth() {
    return this.material?.needSceneDepth() ?? false;
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial() {
    return this._material.get();
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive() {
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
  computeBoundingVolume() {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.computeWorldBoundingVolume}
   */
  computeWorldBoundingVolume() {
    if (this.material) {
      const p = this.worldMatrix.transformPointAffine(Vector3.zero());
      const minHeight = this._minHeight * this.scale.y;
      const maxHeight = this._maxHeight * this.scale.y;
      return new BoundingBox(
        new Vector3(this.material.region.x, p.y + Math.min(minHeight, maxHeight), this.material.region.y),
        new Vector3(this.material.region.z, p.y + Math.max(minHeight, maxHeight), this.material.region.w)
      );
    } else {
      return null;
    }
  }
  /**
   * the actual world-space region covered by this terrain (After applying world transform).
   */
  get worldRegion(): Immutable<Vector4> {
    return this.material?.region ?? Vector4.zero();
  }
  /**
   * Calculates the local transformation matrix.
   * For terrains, this only includes translation.
   *
   * @param outMatrix - Output matrix to store the result
   */
  calculateLocalTransform(outMatrix: Matrix4x4) {
    outMatrix.translation(this._position);
  }
  /**
   * Calculates the world transformation matrix.
   * Terrains inherit only translation from parent nodes.
   *
   * @param outMatrix - Output matrix to store the result
   */
  calculateWorldTransform(outMatrix: Matrix4x4) {
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
    // Called after the heights changed on the GPU: a CPU copy is stale now.
    this._heightData = null;
    this._heightVersion++;
    const tmp = this.updateHeightPyramid();
    if (!tmp) {
      return;
    }
    const data = new Float32Array(4);
    const serial = ++this._heightRangeSerial;
    tmp
      .readPixels(0, 0, 1, 1, 0, tmp.mipLevelCount - 1, data)
      .then(() => {
        // Loading sets the range synchronously right after a resize has started a read back of
        // the empty height map; that stale result must not land on top of it.
        if (serial !== this._heightRangeSerial) {
          return;
        }
        // The reduction stores (max, min) in (r, g)
        this._maxHeight = data[0];
        this._minHeight = data[1];
        this.invalidateWorldBoundingVolume(false);
      })
      .catch((_err) => {
        console.error('Read pixels failed');
      });
  }
  /**
   * Replaces every height of an r16f height map with heights from the CPU.
   *
   * Unlike writing into {@link ClipmapTerrain.heightMap} and calling
   * {@link ClipmapTerrain.updateBoundingBox}, the bounds are right at once and the heights stay
   * available as {@link ClipmapTerrain.heightData}, so physics colliders need no GPU read back.
   *
   * @param data - Half float heights, one per height map texel, row by row
   */
  setHeights(data: Uint16Array<ArrayBuffer>) {
    const heightMap = this.heightMap;
    if (!heightMap || heightMap.format !== 'r16f' || data.length !== heightMap.width * heightMap.height) {
      console.error('setHeights() needs one half float per texel of an r16f height map');
      return;
    }
    heightMap.update(data, 0, 0, heightMap.width, heightMap.height);
    this.updateHeightPyramid();
    this.setHeightRangeFromHalfData(data);
    this.setHeightData(data, heightMap.width, heightMap.height);
    this.invalidateRuntimeVirtualTexture();
  }
  /**
   * The min/max height pyramid of the height map: (max, min) in (r, g), mip 0 padded to a power
   * of two by repeating the last row and column, so texel j of mip m covers height map texels
   * [j * 2^m, (j + 1) * 2^m). Null until built.
   * @internal
   */
  get heightPyramid() {
    return this._tmpTexture.get() ?? null;
  }
  /**
   * Tile resolution of the clipmap, in grid cells
   * @internal
   */
  get clipmapTileResolution() {
    return this._clipmap.tileResolution;
  }
  /**
   * Rebuilds the min/max height pyramid from the current height map.
   * Called when the height map is replaced and by {@link ClipmapTerrain.updateBoundingBox}; code
   * that writes into the height map directly must call one of them afterwards.
   * @internal
   */
  updateHeightPyramid() {
    const heightMap = this.heightMap;
    if (!heightMap) {
      return null;
    }
    const device = getDevice();
    const width = nextPowerOf2(heightMap.width);
    const height = nextPowerOf2(heightMap.height);
    let tmp = this._tmpTexture.get();
    if (tmp && (tmp.width !== width || tmp.height !== height)) {
      this._tmpTexture.dispose();
    }
    if (!this._tmpTexture.get()) {
      tmp = getDevice().createTexture2D('rg32f', width, height)!;
      tmp.name = 'TerrainBoundingBoxTexture';
      this._tmpTexture.set(tmp);
    }
    const tmpFB = device.createFrameBuffer([tmp!], null);
    ClipmapTerrain._padBlitter.sizes.setXYZW(width, height, heightMap.width, heightMap.height);
    ClipmapTerrain._padBlitter.blit(heightMap, tmpFB, fetchSampler('clamp_nearest_nomip'));
    tmpFB.dispose();
    ClipmapTerrain._heightBoundingGenerator.render(tmp!);
    return tmp!;
  }
  /**
   * Sets the height range from height map data already on the CPU, e.g. when loading.
   *
   * {@link ClipmapTerrain.updateBoundingBox} reads the range back from the GPU, which lands a
   * few frames later; until then the bounds would stay flat and cull the terrain wrongly.
   *
   * @param data - Half float heights, one per texel
   * @param stride - Number of half floats per texel, the height being the first
   * @internal
   */
  setHeightRangeFromHalfData(data: Uint16Array, stride = 1) {
    let minHeight = Number.POSITIVE_INFINITY;
    let maxHeight = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.length; i += stride) {
      const h = half2float(data[i]);
      if (h < minHeight) {
        minHeight = h;
      }
      if (h > maxHeight) {
        maxHeight = h;
      }
    }
    if (minHeight <= maxHeight) {
      this._heightRangeSerial++;
      this._minHeight = minHeight;
      this._maxHeight = maxHeight;
      this.invalidateWorldBoundingVolume(false);
    }
  }
  /** @internal */
  createHeightMapTexture(width: number, height: number) {
    return getDevice().createTexture2D('r16f', width, height)!;
  }
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean) {
    super._onTransformChanged(invalidateLocal);
    this.updateRegion();
  }
  /** {@inheritDoc SceneNode.updatePerCamera} */
  updatePerCamera(camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number) {
    const mat = this._material.get();
    if (!mat) {
      return;
    }
    const bv = this.getWorldBoundingVolume()?.toAABB() ?? null;
    const originY = this.worldMatrix.m13;
    const calcAABB = (
      _userData: unknown,
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
      outAABB: AABB
    ) => {
      outAABB.minPoint.setXYZ(minX, bv ? bv.minPoint.y : originY - 9999, minZ);
      outAABB.maxPoint.setXYZ(maxX, bv ? bv.maxPoint.y : originY + 9999, maxZ);
    };
    // Passes rendered from this camera only need the tiles inside its frustum. Shadow passes
    // render from the light and need casters outside of it too, so they get an unculled set
    // built around the same camera (same levels, so the level data below serves both).
    this._renderData = this._clipmap.gather({
      camera: camera,
      minMaxWorldPos: mat.region,
      gridScale: this._gridScale,
      gridOriginX: this._gridOriginX,
      gridOriginZ: this._gridOriginZ,
      userData: this,
      frustumCulling: true,
      calcAABB
    });
    // Each shadow map camera (cascade, cube face) culls this set again in draw()
    this._shadowGatherContext = this.castShadow
      ? {
          camera: camera,
          minMaxWorldPos: mat.region,
          gridScale: this._gridScale,
          gridOriginX: this._gridOriginX,
          gridOriginZ: this._gridOriginZ,
          userData: this,
          frustumCulling: false,
          calcAABB
        }
      : null;
    this._shadowRenderData = this._shadowGatherContext
      ? this._shadowClipmap.gather(this._shadowGatherContext)
      : null;
    let maxMipLevel = 0;
    for (const renderData of [this._renderData, this._shadowRenderData]) {
      for (const info of renderData ?? []) {
        const buffer = info.primitive.getVertexBuffer('texCoord1')!;
        buffer.bufferSubData(0, info.mipLevels, 0, info.numInstances);
        if (info.maxMiplevel > maxMipLevel) {
          maxMipLevel = info.maxMiplevel;
        }
      }
    }
    const levelAABB = this._clipmap.calcLevelAABB(
      camera,
      mat.region,
      this._gridScale,
      this._gridOriginX,
      this._gridOriginZ
    );
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
    // Grass placed on the GPU is generated around this camera, outside of any render pass
    this.grassRenderer.updatePerCamera(camera);

    this.scene?.queuePerCameraUpdateNode(this);
  }
  /**
   * Updates the terrain material region based on current position and scale.
   * Should be called after changing position, scale, or height map.
   */
  updateRegion() {
    if (this.material) {
      const x = Math.abs(this.scale.x);
      const z = Math.abs(this.scale.z);
      const px = this.position.x + (this.parent?.worldMatrix.m03 ?? 0);
      const pz = this.position.z + (this.parent?.worldMatrix.m23 ?? 0);
      const cellX = (x * this._sizeX) / this.material.heightMap.width;
      const cellZ = (z * this._sizeZ) / this.material.heightMap.height;
      this._gridScale = Math.max(cellX, cellZ);
      this._gridOriginX = px + cellX * 0.5;
      this._gridOriginZ = pz + cellZ * 0.5;
      this.material.update(new Vector4(px, pz, px + x * this._sizeX, pz + z * this._sizeZ), this.scale);
      this.grassRenderer.updateMaterial();
    }
  }
  /** {@inheritDoc Drawable.draw} */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>) {
    const mat = this._material?.get();
    if (mat) {
      this.bind(ctx, renderQueue);
      // The shader places vertices at grid * gridScale - offset, then adds the world translation
      mat.setClipmapGridInfo(
        this._gridScale,
        this.worldMatrix.m03 - this._gridOriginX,
        this.worldMatrix.m23 - this._gridOriginZ
      );
      mat.apply(ctx);
      const isShadowPass = ctx.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP;
      let renderData = isShadowPass ? this._shadowRenderData : this._renderData;
      const cullCamera = renderQueue?.cullCamera;
      if (isShadowPass && renderData && cullCamera && this._shadowGatherContext) {
        this._shadowGatherContext.camera = cullCamera;
        renderData = this._shadowClipmap.cullInstances(renderData, this._shadowGatherContext);
        for (const info of renderData) {
          info.primitive.getVertexBuffer('texCoord1')!.bufferSubData(0, info.mipLevels, 0, info.numInstances);
        }
      }
      for (const info of renderData ?? []) {
        mat.draw(info.primitive, ctx, info.numInstances);
      }
      // In shadow map passes the grass renderer draws the blades that cast shadows only
      if (ctx.renderPass!.type !== RENDER_PASS_TYPE_OBJECT_COLOR) {
        this.grassRenderer.draw(ctx);
      }
    }
  }
  /** @internal */
  private resizeHeightMap(sizeX: number, sizeZ: number) {
    if (this.material) {
      const oldHeightMap = this.material.heightMap;
      const device = getDevice();
      const maxTextureSize = device.getDeviceCaps().textureCaps.maxTextureSize;
      sizeX = Math.min(Math.max(sizeX, 1), maxTextureSize) >> 0;
      sizeZ = Math.min(Math.max(sizeZ, 1), maxTextureSize) >> 0;
      if (sizeX !== oldHeightMap.width || sizeZ !== oldHeightMap.height) {
        const newHeightMap = device.createTexture2D('r16f', sizeX, sizeZ)!;
        const fb = device.createFrameBuffer([newHeightMap], null);
        ClipmapTerrain._copyBlitter.blit(oldHeightMap, fb, fetchSampler('clamp_linear_nomip'));
        fb.dispose();
        this.heightMap = newHeightMap;
        this.updateBoundingBox();
      }
    }
  }
  /*
  private calcNormalHeightMap(): Texture2D {
    const device = getDevice();
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
  protected onDispose() {
    super.onDispose();
    this.setRuntimeVirtualTexture(null);
    this._clipmap?.dispose();
    this._shadowClipmap?.dispose();
    this._material?.dispose();
    this._grassRenderer?.dispose();
    this._tmpTexture.dispose();
  }
}
