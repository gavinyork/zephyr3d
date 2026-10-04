import type {
  BindGroup,
  GPUDataBuffer,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import type { DrawContext } from '../render';
import { MaterialVaryingFlags, MAX_TERRAIN_MIPMAP_LEVELS } from '../values';
import { ShaderHelper } from './shader/helper';
import type { Nullable } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, DRef, Vector3, Vector4 } from '@zephyr3d/base';
import { mixinLight } from './mixins/lit';
import { fetchSampler } from '../utility/misc';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { CopyBlitter } from '../blitter';
import { getDevice } from '../app/api';
import type { VirtualTexture } from '../render/virtualtexture/virtual_texture';
import {
  blendTerrainAlbedo,
  blendTerrainDetailNormal,
  blendTerrainRoughness,
  terrainSplatMaskCount
} from './shader/terrain_blend';
import type { TerrainHexTiling, TerrainUVGrad } from './shader/terrain_blend';

type ClipmapTerrainDetailMapInfo = {
  detailMap: DRef<Texture2DArray>;
  detailNormalMap?: DRef<Texture2DArray>;
  detailMapList: DRef<Texture2D>[];
  detailNormalMapList: DRef<Texture2D>[];
  splatMap: DRef<Texture2DArray | Texture2D>;
  detailMapParams: Float32Array<ArrayBuffer>;
  /** Per layer hex tiling (rotation amount, scale amount, contrast, enabled) */
  detailHexParams: Float32Array<ArrayBuffer>;
  numDetailMaps: number;
};

const MAX_DETAIL_MAPS = 8;
/**
 * WebGL1 has no uniform buffers, so the per-level data goes through a plain uniform array,
 * sized to keep within the minimum vertex uniform budget: 16 levels, 2 vectors each.
 */
const WEBGL1_LEVEL_DATA_VECTORS = 32;

/**
 * Terrain debug rendering mode
 * @public
 */
export type TerrainDebugMode =
  | 'none'
  | 'vertex_normal'
  | 'detail_normal'
  | 'tangent'
  | 'uv'
  | 'bitangent'
  | 'albedo';

/**
 * Default material type of clipmap terrain
 * @public
 */
export class ClipmapTerrainMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRMetallicRoughness
) {
  private static readonly FEATURE_DETAIL_MAP = this.defineFeature();
  private static readonly FEATURE_DEBUG_MODE = this.defineFeature();
  private static readonly FEATURE_VIRTUAL_TEXTURE = this.defineFeature();
  /** Bit i: detail layer i uses hex tiling */
  private static readonly FEATURE_HEX_TILING = this.defineFeature();
  private static readonly _defaultDetailMap: DRef<Texture2D> = new DRef();
  private static readonly _defaultNormalMap: DRef<Texture2D> = new DRef();
  private readonly _region: Vector4;
  private readonly _clipmapGridInfo: Vector4;
  private readonly _heightMap: DRef<Texture2D>;
  private readonly _terrainScale: Vector3;
  private _detailMapInfo: ClipmapTerrainDetailMapInfo;
  private readonly _detailMapSize: number;
  private readonly _splatMapSize: number;
  private readonly _heightMapSize: Vector4;
  private readonly _levelDataBuffer: DRef<GPUDataBuffer>;
  /** WebGL1 only, see WEBGL1_LEVEL_DATA_VECTORS */
  private readonly _levelDataArray: Float32Array<ArrayBuffer>;
  private _virtualTexture: Nullable<VirtualTexture>;
  private _contentVersion: number;
  constructor(heightMap: Texture2D) {
    super();
    this.metallic = 0;
    this.roughness = 1;
    this.albedoTexCoordIndex = -1;
    this.normalTexCoordIndex = -1;
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapGridInfo = new Vector4();
    this._heightMap = new DRef(heightMap);
    this._detailMapSize = 256;
    this._splatMapSize = 512;
    const webgl1 = getDevice().type === 'webgl';
    this._levelDataBuffer = new DRef(
      webgl1 ? null : getDevice().createBuffer(MAX_TERRAIN_MIPMAP_LEVELS * 4 * 2 * 4, { usage: 'uniform' })
    );
    this._levelDataArray = new Float32Array(webgl1 ? WEBGL1_LEVEL_DATA_VECTORS * 4 : 0);
    this._detailMapInfo = this.createDetailMapInfo();
    this._terrainScale = Vector3.one();
    this._heightMapSize = new Vector4(
      this.heightMap.width,
      this.heightMap.height,
      1 / this.heightMap.width,
      1 / this.heightMap.height
    );
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP, 0);
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE, 'none');
    this.useFeature(ClipmapTerrainMaterial.FEATURE_VIRTUAL_TEXTURE, '');
    this.useFeature(ClipmapTerrainMaterial.FEATURE_HEX_TILING, 0);
    this._virtualTexture = null;
    this._contentVersion = 0;
  }
  static get MAX_DETAIL_MAP_COUNT() {
    return MAX_DETAIL_MAPS;
  }
  get debugMode() {
    return this.featureUsed<TerrainDebugMode>(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE);
  }
  set debugMode(mode) {
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE, mode);
  }
  /**
   * Bumped whenever a splat or detail texture is replaced. The detail parameters, the layer
   * count and the roughness are uniforms, compared directly by the virtual texture owner.
   * @internal
   */
  get contentVersion() {
    return this._contentVersion;
  }
  /**
   * The runtime virtual texture holding the blended layers, null to blend them per pixel.
   * Only used on WebGPU with at least one detail layer.
   * @internal
   */
  get virtualTexture() {
    return this._virtualTexture;
  }
  set virtualTexture(vt: Nullable<VirtualTexture>) {
    this._virtualTexture = vt;
    this.updateVirtualTextureFeature();
  }
  /** Whether shading reads the runtime virtual texture instead of blending the layers @internal */
  get virtualTextureUsed() {
    return !!this.featureUsed<string>(ClipmapTerrainMaterial.FEATURE_VIRTUAL_TEXTURE);
  }
  /**
   * The feature value is the layout of the virtual texture, which the shader bakes in (level
   * count and sizes, page and atlas geometry), so a rebuilt texture gets its own program.
   */
  private updateVirtualTextureFeature() {
    const vt = this._virtualTexture;
    const used = !!vt && getDevice().type === 'webgpu' && this._detailMapInfo.numDetailMaps > 0;
    this.useFeature(
      ClipmapTerrainMaterial.FEATURE_VIRTUAL_TEXTURE,
      used ? `${vt.levels[0].pagesX}x${vt.levels[0].pagesY}:${vt.pageSize}:${vt.border}:${vt.atlasSize}` : ''
    );
  }
  /** @internal */
  get detailMapParams() {
    return this._detailMapInfo.detailMapParams;
  }
  /** @internal */
  get detailHexParams() {
    return this._detailMapInfo.detailHexParams;
  }
  /** Bit i set: detail layer i is hex tiled. Always 0 on WebGL1 (no gradient sampling) @internal */
  get hexTilingMask() {
    return this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_HEX_TILING);
  }
  private updateHexTilingFeature() {
    let mask = 0;
    if (getDevice().type !== 'webgl') {
      for (let i = 0; i < this._detailMapInfo.numDetailMaps; i++) {
        if (this._detailMapInfo.detailHexParams[i * 4 + 3] !== 0) {
          mask |= 1 << i;
        }
      }
    }
    this.useFeature(ClipmapTerrainMaterial.FEATURE_HEX_TILING, mask);
  }
  /**
   * Whether a detail layer is hex tiled to break up its repetition (Mikkelsen, Practical
   * Real-Time Hex-Tiling, 2022). Costs three texture samples per layer instead of one, only
   * when the layers are blended: once per page with the runtime virtual texture. Not available
   * on WebGL1.
   */
  getDetailMapHexTiling(index: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return false;
    }
    return this._detailMapInfo.detailHexParams[index * 4 + 3] !== 0;
  }
  setDetailMapHexTiling(index: number, enabled: boolean) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return;
    }
    this._detailMapInfo.detailHexParams[index * 4 + 3] = enabled ? 1 : 0;
    this.updateHexTilingFeature();
  }
  /**
   * Hex tiling parameters of a detail layer as [rotation, scale, contrast], MaterialX
   * hextiledimage inputs:
   * - rotation: 0 to 1, how much each tile is turned at random, 1 for any angle
   * - scale: 0 to 1, how much each tile is resized at random, 1 for 0.5 to 2 times
   * - contrast: 0 to 1, how much brighter tiles win at the seams between tiles
   */
  getDetailMapHexParams(index: number): [number, number, number] {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return [1, 1, 0.5];
    }
    const p = this._detailMapInfo.detailHexParams;
    return [p[index * 4], p[index * 4 + 1], p[index * 4 + 2]];
  }
  setDetailMapHexParams(index: number, rotation: number, scale: number, contrast: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return;
    }
    const p = this._detailMapInfo.detailHexParams;
    p[index * 4] = rotation;
    p[index * 4 + 1] = scale;
    p[index * 4 + 2] = contrast;
    this.uniformChanged();
  }
  /** @internal */
  get detailMapArray() {
    return this._detailMapInfo.detailMap.get();
  }
  /** @internal */
  get detailNormalMapArray() {
    return this._detailMapInfo.detailNormalMap?.get() ?? null;
  }
  /** @internal */
  setLevelData(data: Float32Array<ArrayBuffer>, length: number) {
    const buffer = this._levelDataBuffer.get();
    if (buffer) {
      buffer.bufferSubData(0, data, 0, length);
    } else {
      this._levelDataArray.set(data.subarray(0, Math.min(length, this._levelDataArray.length)));
      this.uniformChanged();
    }
  }
  /** @internal */
  get region() {
    return this._region;
  }
  /** @internal */
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.uniformChanged();
    }
  }
  setClipmapGridInfo(gridScale: number, gridOffsetX: number, gridOffsetY: number) {
    if (
      this._clipmapGridInfo.x !== gridScale ||
      this._clipmapGridInfo.y !== gridOffsetX ||
      this._clipmapGridInfo.z !== gridOffsetY
    ) {
      this._clipmapGridInfo.setXYZW(gridScale, gridOffsetX, gridOffsetY, 0);
      this.uniformChanged();
    }
  }
  /** @internal */
  get terrainScale() {
    return this._terrainScale;
  }
  /** @internal */
  set terrainScale(val: Vector3) {
    if (!this._terrainScale.equalsTo(val)) {
      this._terrainScale.set(val);
      this.uniformChanged();
    }
  }
  get numDetailMaps() {
    return this._detailMapInfo.numDetailMaps;
  }
  set numDetailMaps(val: number) {
    if (val > MAX_DETAIL_MAPS || val < 0 || !Number.isInteger(val)) {
      console.error('Invalid number of detail maps');
      return;
    }
    if (getDevice().type === 'webgl' && val > 4) {
      console.error('Only 4 detail map layers is supported for WebGL1');
      return;
    }
    const n = this._detailMapInfo.numDetailMaps;
    const defaultDetailMap = ClipmapTerrainMaterial.getDefaultDetailMap();
    const defaultNormalMap = ClipmapTerrainMaterial.getDefaultNormalMap();
    if (val > n) {
      this._detailMapInfo.numDetailMaps = val;
      for (let i = n; i < val; i++) {
        this.setDetailMap(i, defaultDetailMap);
        this.setDetailNormalMap(i, defaultNormalMap);
        this.setDetailMapUVScale(i, 80);
        this.setDetailMapRoughness(i, 1);
        this._detailMapInfo.detailHexParams.set([1, 1, 0.5, 0], i * 4);
        this._detailMapInfo.detailMapList[i].dispose();
        this._detailMapInfo.detailNormalMapList[i].dispose();
      }
    } else if (val < n) {
      for (let i = val; i < n; i++) {
        this.setDetailMap(i, defaultDetailMap);
        this.setDetailNormalMap(i, defaultNormalMap);
        this.setDetailMapUVScale(i, 80);
        this.setDetailMapRoughness(i, 1);
        this._detailMapInfo.detailHexParams.set([1, 1, 0.5, 0], i * 4);
        this._detailMapInfo.detailMapList[i].dispose();
        this._detailMapInfo.detailNormalMapList[i].dispose();
      }
      this._detailMapInfo.numDetailMaps = val;
    }
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP, this._detailMapInfo.numDetailMaps);
    this.updateVirtualTextureFeature();
    this.updateHexTilingFeature();
  }
  getSplatMap() {
    return this._detailMapInfo.splatMap?.get() ?? null;
  }
  setSplatMap(tex: Texture2DArray) {
    if (tex !== this._detailMapInfo.splatMap.get()) {
      if (!tex || tex.depth !== MAX_DETAIL_MAPS >> 2) {
        console.error('Invalid splat map');
        return;
      }
      this._detailMapInfo.splatMap.set(tex);
      this._contentVersion++;
      this.uniformChanged();
    }
  }
  getDetailMapUVScale(index: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return 0;
    }
    return this._detailMapInfo.detailMapParams[index * 4];
  }
  setDetailMapUVScale(index: number, scale: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return;
    }
    if (this._detailMapInfo.detailMapParams[index * 4] !== scale) {
      this._detailMapInfo.detailMapParams[index * 4] = scale;
      this.uniformChanged();
    }
  }
  getDetailMapRoughness(index: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return 0;
    }
    return this._detailMapInfo.detailMapParams[index * 4 + 1];
  }
  setDetailMapRoughness(index: number, val: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return;
    }
    if (this._detailMapInfo.detailMapParams[index * 4 + 1] !== val) {
      this._detailMapInfo.detailMapParams[index * 4 + 1] = val;
      this.uniformChanged();
    }
  }
  getDetailMap(index: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return null;
    }
    return this._detailMapInfo.detailMapList[index].get();
  }
  setDetailMap(index: number, albedoMap: Nullable<Texture2D>) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return;
    }
    albedoMap = albedoMap ?? ClipmapTerrainMaterial.getDefaultDetailMap();
    if (!this._detailMapInfo.detailMapList[index]) {
      this._detailMapInfo.detailMapList[index] = new DRef();
    }
    this._detailMapInfo.detailMapList[index].set(
      albedoMap === ClipmapTerrainMaterial.getDefaultDetailMap() ? null : albedoMap
    );
    this._contentVersion++;
    if (getDevice().type !== 'webgl') {
      const blitter = new CopyBlitter();
      const fb = getDevice().createFrameBuffer([this._detailMapInfo.detailMap!.get()!], null);
      blitter.blit(
        albedoMap!,
        fb,
        index,
        albedoMap!.width === this._detailMapSize && albedoMap!.height === this._detailMapSize
          ? fetchSampler('clamp_nearest_nomip')
          : fetchSampler('clamp_linear_nomip')
      );
      fb.dispose();
    }
  }
  getDetailNormalMap(index: number) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return null;
    }
    return this._detailMapInfo.detailNormalMapList[index].get();
  }
  setDetailNormalMap(index: number, normalMap: Nullable<Texture2D>) {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return;
    }
    normalMap = normalMap ?? ClipmapTerrainMaterial.getDefaultNormalMap();
    if (!this._detailMapInfo.detailNormalMapList[index]) {
      this._detailMapInfo.detailNormalMapList[index] = new DRef();
    }
    this._detailMapInfo.detailNormalMapList[index].set(
      normalMap === ClipmapTerrainMaterial.getDefaultNormalMap() ? null : normalMap
    );
    this._contentVersion++;
    if (getDevice().type !== 'webgl') {
      const blitter = new CopyBlitter();
      const fb = getDevice().createFrameBuffer([this._detailMapInfo.detailNormalMap!.get()!], null);
      blitter.blit(
        normalMap!,
        fb,
        index,
        normalMap!.width === this._detailMapSize && normalMap!.height === this._detailMapSize
          ? fetchSampler('clamp_nearest_nomip')
          : fetchSampler('clamp_linear_nomip')
      );
      fb.dispose();
    }
  }
  /** @internal */
  update(region: Vector4, terrainScale: Vector3) {
    if (!region.equalsTo(this._region) || !terrainScale.equalsTo(this._terrainScale)) {
      this._region.set(region);
      this._terrainScale.set(terrainScale);
      this.uniformChanged();
    }
  }
  get heightMap() {
    return this._heightMap.get()!;
  }
  set heightMap(val: Texture2D) {
    if (val !== this._heightMap.get()) {
      this._heightMap.set(val);
      this._contentVersion++;
      this._heightMapSize.setXYZW(
        this.heightMap.width,
        this.heightMap.height,
        1 / this.heightMap.width,
        1 / this.heightMap.height
      );
      this.uniformChanged();
    }
  }
  needSceneColor() {
    return false;
  }
  needSceneDepth() {
    return false;
  }
  supportInstancing() {
    return false;
  }
  supportLighting() {
    return true;
  }
  getMetallicRoughnessTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.uv;
  };
  /** Raw rgb of a detail normal map, see blendTerrainDetailNormal */
  sampleDetailNormalMap(
    scope: PBInsideFunctionScope,
    index: number,
    texCoord: PBShaderExp,
    ddx: PBShaderExp | null = null,
    ddy: PBShaderExp | null = null
  ) {
    const pb = scope.$builder;
    return this.drawContext.device.type === 'webgl'
      ? pb.textureSample(scope[`detailNormalMap${index}`], texCoord).rgb
      : ddx && ddy
        ? pb.textureArraySampleGrad(scope.detailNormalMap, texCoord, index, ddx, ddy).rgb
        : pb.textureArraySample(scope.detailNormalMap, texCoord, index).rgb;
  }
  /**
   * Gradients of the terrain uv and the hex tiled layers, for the blend functions; null when no
   * layer is hex tiled, so the others keep sampling with implicit derivatives.
   */
  private hexTilingInputs(scope: PBInsideFunctionScope): [TerrainUVGrad | null, TerrainHexTiling | null] {
    const mask = this.hexTilingMask;
    if (!mask) {
      return [null, null];
    }
    const pb = scope.$builder;
    return [
      { ddx: pb.dpdx(scope.$inputs.uv), ddy: pb.dpdy(scope.$inputs.uv) },
      { mask, params: scope.detailHexParams }
    ];
  }
  calculateDetailNormal(scope: PBInsideFunctionScope, TBN: PBShaderExp) {
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainNormal';
    const numDetailMaps = that.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
    pb.func(funcName, [pb.mat3('TBN'), ...this.splatMaskParams(scope, numDetailMaps)], function () {
      this.$l.detailNormal = blendTerrainDetailNormal(
        this,
        numDetailMaps,
        that.splatMaskLocals(this, numDetailMaps),
        this.$inputs.uv,
        this.detailParams,
        (scope, i, uv, ddx, ddy) => that.sampleDetailNormalMap(scope, i, uv, ddx, ddy),
        ...that.hexTilingInputs(this)
      );
      this.$return(pb.normalize(pb.mul(this.TBN, this.detailNormal)));
    });
    return pb.getGlobalScope()[funcName](TBN, ...this.splatMaskArgs(scope, numDetailMaps));
  }
  /** Parameter declarations for passing the splat masks sampled in the main scope */
  private splatMaskParams(scope: PBInsideFunctionScope, numDetailMaps: number) {
    const pb = scope.$builder;
    return Array.from({ length: terrainSplatMaskCount(numDetailMaps) }, (_, i) => pb.vec4(`mask${i}`));
  }
  /** The splat mask parameters inside a function declared with splatMaskParams() */
  private splatMaskLocals(scope: PBInsideFunctionScope, numDetailMaps: number) {
    return Array.from(
      { length: terrainSplatMaskCount(numDetailMaps) },
      (_, i) => scope[`mask${i}`] as PBShaderExp
    );
  }
  /** The splat masks sampled once in the main scope, see fragmentShader() */
  private splatMaskArgs(scope: PBInsideFunctionScope, numDetailMaps: number) {
    return Array.from(
      { length: terrainSplatMaskCount(numDetailMaps) },
      (_, i) => scope[`terrainSplatMask${i}`] as PBShaderExp
    );
  }
  getNormalTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.uv;
  };
  /** Samples the splat weights of detail layers [4 * index, 4 * index + 3] */
  sampleSplatMask(scope: PBInsideFunctionScope, index: number) {
    const pb = scope.$builder;
    return this.drawContext.device.type === 'webgl'
      ? pb.textureSample(scope.splatMap, scope.$inputs.uv)
      : pb.textureArraySample(scope.splatMap, scope.$inputs.uv, index);
  }
  calculateRoughness(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp) {
    const base = super.calculateRoughness(scope, albedo, normal);
    const numDetailMaps = this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
    if (numDetailMaps === 0) {
      return base;
    }
    if (this.virtualTextureUsed) {
      // This runs inside PBRLight's own function, so the roughness read from the virtual texture
      // comes in through albedo.a (see sampleVirtualTexture); nothing reads the terrain albedo
      // alpha otherwise (opaque, no subsurface outputs). The page fill already blended in the
      // material roughness.
      return albedo.a;
    }
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainRoughness';
    pb.func(funcName, [pb.float('base')], function () {
      const masks: PBShaderExp[] = [];
      for (let i = 0; i < terrainSplatMaskCount(numDetailMaps); i++) {
        this.$l[`mask${i}`] = that.sampleSplatMask(this, i);
        masks.push(this[`mask${i}`]);
      }
      this.$return(blendTerrainRoughness(this, numDetailMaps, masks, this.detailParams, this.base));
    });
    return pb.getGlobalScope()[funcName](base) as PBShaderExp;
  }
  calculateAlbedoColor(scope: PBInsideFunctionScope) {
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainAlbedo';
    const numDetailMaps = that.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
    pb.func(funcName, this.splatMaskParams(scope, numDetailMaps), function () {
      if (numDetailMaps === 0) {
        this.$l.checkerPos = pb.mul(this.$inputs.uv, pb.sub(this.region.zw, this.region.xy));
        this.$l.ddx = pb.dpdx(this.checkerPos);
        this.$l.ddy = pb.dpdy(this.checkerPos);
        this.$l.w = pb.add(pb.max(pb.abs(this.ddx), pb.abs(this.ddy)), 0.01);
        this.$l.i = pb.div(
          pb.mul(
            2,
            pb.sub(
              pb.abs(pb.sub(pb.fract(pb.mul(pb.sub(this.checkerPos, pb.mul(this.w, 0.5)), 0.5)), 0.5)),
              pb.abs(pb.sub(pb.fract(pb.mul(pb.add(this.checkerPos, pb.mul(this.w, 0.5)), 0.5)), 0.5))
            )
          ),
          this.w
        );
        this.$l.changeRate = pb.add(pb.length(this.ddx), pb.length(this.ddy));
        this.$l.fadeStart = pb.float(0);
        this.$l.fadeEnd = pb.float(10);
        this.$l.fadeFactor = pb.sub(1, pb.smoothStep(this.fadeStart, this.fadeEnd, this.changeRate));
        this.$l.checker = pb.mix(0.5, pb.sub(0.5, pb.mul(0.5, this.i.x, this.i.y)), this.fadeFactor);
        this.$l.checkerColor = pb.mix(pb.vec3(0.4), pb.vec3(1), pb.vec3(this.checker));
        this.$return(pb.vec4(this.checkerColor, 1));
      } else {
        this.$l.color = blendTerrainAlbedo(
          this,
          numDetailMaps,
          that.splatMaskLocals(this, numDetailMaps),
          this.$inputs.uv,
          this.detailParams,
          (scope, i, uv, ddx, ddy) =>
            that.drawContext.device.type === 'webgl'
              ? pb.textureSample(scope[`detailAlbedoMap${i}`], uv)
              : ddx && ddy
                ? pb.textureArraySampleGrad(scope.detailAlbedoMap, uv, i, ddx, ddy)
                : pb.textureArraySample(scope.detailAlbedoMap, uv, i),
          ...that.hexTilingInputs(this)
        );
        this.$return(pb.vec4(this.color, 1));
      }
    });
    return pb.getGlobalScope()[funcName](...this.splatMaskArgs(scope, numDetailMaps)) as PBShaderExp;
  }
  /**
   * Reads the blended layers from the runtime virtual texture: (linear albedo, roughness) is
   * returned, the world space normal written to `normal`.
   */
  sampleVirtualTexture(scope: PBInsideFunctionScope, normal: PBShaderExp) {
    const pb = scope.$builder;
    const vt = this._virtualTexture!;
    const maxLevel = vt.levels.length - 1;
    pb.func('zTerrainSampleRVT', [pb.vec3('normal').out()], function () {
      this.$l.uv = this.$inputs.uv;
      this.$l.level = vt.computeLevel(this, this.uv);
      this.$l.level0 = pb.floor(this.level);
      this.$l.level1 = pb.min(pb.add(this.level0, 1), maxLevel);
      this.$l.loc0 = vt.resolve(this, pb.uint(this.level0), this.uv);
      this.$l.loc1 = vt.resolve(this, pb.uint(this.level1), this.uv);
      this.$l.t = pb.select(pb.float(0), pb.sub(this.level, this.level0), pb.equal(this.loc1.z, this.level1));
      this.$l.baseColor = pb.mix(
        pb.textureSampleLevel(this.zTerrainRVT0, this.loc0.xy, 0),
        pb.textureSampleLevel(this.zTerrainRVT0, this.loc1.xy, 0),
        this.t
      );
      this.$l.normalRoughness = pb.mix(
        pb.textureSampleLevel(this.zTerrainRVT1, this.loc0.xy, 0),
        pb.textureSampleLevel(this.zTerrainRVT1, this.loc1.xy, 0),
        this.t
      );
      // VirtualTextureUnpackNormal
      this.$l.nxz = pb.sub(pb.mul(this.normalRoughness.xz, 255 / 127), pb.vec2(1));
      this.normal = pb.normalize(
        pb.vec3(this.nxz.x, pb.sqrt(pb.clamp(pb.sub(1, pb.dot(this.nxz, this.nxz)), 0, 1)), this.nxz.y)
      );
      // sRGB decode
      this.$l.c = this.baseColor.rgb;
      this.$l.linear = pb.mix(
        pb.pow(pb.div(pb.add(this.c, pb.vec3(0.055)), 1.055), pb.vec3(2.4)),
        pb.div(this.c, 12.92),
        pb.vec3(pb.lessThanEqual(this.c, pb.vec3(0.04045)))
      );
      this.$return(pb.vec4(this.linear, this.normalRoughness.y));
    });
    return scope.zTerrainSampleRVT(normal) as PBShaderExp;
  }
  /**
   * Height of a clipmap vertex, blended towards the next coarser level across the outer part of
   * its ring (the transition regions of Hoppe's GPU geometry clipmaps).
   *
   * The outer boundary of level L lies on grid lines of level L + 1, so its vertices already sit
   * where the coarser ring's do; only their heights have to agree. hC is the height the coarser
   * mesh has at the vertex: its own height where a coarse vertex coincides, the mean of the two
   * coarse vertices around the edge midpoints, the mean of the four corners at cell centres
   * (never on a boundary, only has to be continuous). With alpha reaching 1 before the boundary,
   * boundary vertices lie exactly on the coarse edges and the rings meet without T-junction
   * cracks. The inner boundary needs no blend: it is the finer level's outer one.
   *
   * @param uv - Height map coordinate of the vertex
   * @param gridCoord - Global grid coordinate of the vertex, in grid cells
   * @param pos - World XZ of the vertex
   */
  sampleHeightMap(
    scope: PBInsideFunctionScope,
    uv: PBShaderExp,
    gridCoord: PBShaderExp,
    pos: PBShaderExp,
    levelStart: PBShaderExp,
    levelDiff: PBShaderExp
  ) {
    const pb = scope.$builder;
    // Blend over the outer 40% of the ring, fully coarse over its last 5% so boundary vertices
    // are unaffected by rounding in the ring ratio.
    const transitionStart = 0.6;
    const transitionEnd = 0.95;
    pb.func(
      'sampleHeightMap',
      [pb.vec2('uv'), pb.vec2('gridCoord'), pb.vec2('pos'), pb.vec4('levelStart'), pb.vec4('levelDiff')],
      function () {
        this.$l.h = pb.textureSampleLevel(this.heightMap, this.uv, this.$inputs.miplevel).r;
        this.$l.ratio = pb.mul(pb.sub(this.pos.xyxy, this.levelStart), this.levelDiff);
        this.$l.maxVal = pb.max(pb.max(this.ratio.x, this.ratio.y), pb.max(this.ratio.z, this.ratio.w));
        this.$l.alpha = pb.clamp(
          pb.div(pb.sub(this.maxVal, transitionStart), transitionEnd - transitionStart),
          0,
          1
        );
        this.$if(pb.greaterThan(this.alpha, 0), function () {
          this.$l.levelScale = pb.exp2(this.$inputs.miplevel);
          // Vertex index in this level; the coarser level's vertices are its even ones
          this.$l.index = pb.div(this.gridCoord, this.levelScale);
          this.$l.odd = pb.sub(this.index, pb.mul(pb.floor(pb.mul(this.index, 0.5)), 2));
          // Height map distance to the neighbouring coarse vertices along the odd axes
          this.$l.d = pb.div(
            pb.mul(this.odd, pb.mul(this.levelScale, this.clipmapGridInfo.x)),
            pb.sub(this.region.zw, this.region.xy)
          );
          this.$l.coarseLevel = pb.add(this.$inputs.miplevel, 1);
          this.$l.hc = pb.mul(
            pb.add(
              pb.add(
                pb.textureSampleLevel(this.heightMap, pb.sub(this.uv, this.d), this.coarseLevel).r,
                pb.textureSampleLevel(this.heightMap, pb.add(this.uv, this.d), this.coarseLevel).r
              ),
              pb.add(
                pb.textureSampleLevel(
                  this.heightMap,
                  pb.add(this.uv, pb.vec2(this.d.x, pb.neg(this.d.y))),
                  this.coarseLevel
                ).r,
                pb.textureSampleLevel(
                  this.heightMap,
                  pb.add(this.uv, pb.vec2(pb.neg(this.d.x), this.d.y)),
                  this.coarseLevel
                ).r
              )
            ),
            0.25
          );
          this.h = pb.mix(this.h, this.hc, this.alpha);
        });
        this.$return(this.h);
      }
    );
    return scope.sampleHeightMap(uv, gridCoord, pos, levelStart, levelDiff);
  }
  /**
   * Terrain tangent frame at the fragment, differentiated from the height map itself.
   *
   * Per-vertex normals only see the mesh resolution and blur slopes: a one-texel peak gets an
   * upward normal at its tip and half the real slope around it. Differentiating the bilinear
   * height field per pixel gives the slopes the geometry actually has, and keeps height map
   * detail on the coarse outer rings.
   */
  calculateTerrainTBN(
    scope: PBInsideFunctionScope,
    tangent: PBShaderExp,
    bitangent: PBShaderExp,
    normal: PBShaderExp
  ) {
    const pb = scope.$builder;
    const textureLod = this.drawContext.device.getDeviceCaps().shaderCaps.supportShaderTextureLod;
    pb.func('calcTerrainTBN', [pb.vec3('t').out(), pb.vec3('b').out(), pb.vec3('n').out()], function () {
      if (textureLod) {
        // Differentiate on the mip whose texels match the pixel footprint, so distant terrain
        // does not alias.
        this.$l.texCoord = pb.mul(this.$inputs.uv, this.heightMapSize.xy);
        this.$l.footprint = pb.max(pb.length(pb.dpdx(this.texCoord)), pb.length(pb.dpdy(this.texCoord)));
        this.$l.lod = pb.max(pb.log2(pb.max(this.footprint, 0.0001)), 0);
      } else {
        this.$l.lod = pb.float(0);
      }
      // Half a texel either way: on a bilinear field that yields the full slope of each cell
      // everywhere but within half a texel of a crest or foot.
      this.$l.offset = pb.mul(this.heightMapSize.zw, pb.mul(pb.exp2(this.lod), 0.5));
      const sample = (scope: PBInsideFunctionScope, uv: PBShaderExp) =>
        textureLod
          ? pb.textureSampleLevel(scope.heightMap, uv, scope.lod).r
          : pb.textureSample(scope.heightMap, uv).r;
      this.$l.hL = sample(this, pb.sub(this.$inputs.uv, pb.vec2(this.offset.x, 0)));
      this.$l.hR = sample(this, pb.add(this.$inputs.uv, pb.vec2(this.offset.x, 0)));
      this.$l.hU = sample(this, pb.sub(this.$inputs.uv, pb.vec2(0, this.offset.y)));
      this.$l.hD = sample(this, pb.add(this.$inputs.uv, pb.vec2(0, this.offset.y)));
      // World-space distance between the two samples of each difference
      this.$l.sampleDist = pb.mul(pb.sub(this.region.zw, this.region.xy), pb.mul(this.offset, 2));
      this.$l.dHdU = pb.div(pb.mul(pb.sub(this.hR, this.hL), this.terrainScale.y), this.sampleDist.x);
      this.$l.dHdV = pb.div(pb.mul(pb.sub(this.hD, this.hU), this.terrainScale.y), this.sampleDist.y);
      this.t = pb.normalize(pb.vec3(1, this.dHdU, 0));
      this.b = pb.normalize(pb.vec3(0, this.dHdV, 1));
      this.n = pb.normalize(pb.cross(this.b, this.t));
    });
    return scope.calcTerrainTBN(tangent, bitangent, normal) as PBShaderExp;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.$inputs.clipmapInfo = pb.vec4().attrib('texCoord0');
    scope.$inputs.miplevel = pb.float().attrib('texCoord1');
    scope.clipmapGridInfo = pb.vec4().uniform(2);
    scope.levelData =
      this.drawContext.device.type === 'webgl'
        ? pb.vec4[WEBGL1_LEVEL_DATA_VECTORS]().uniform(2)
        : pb.vec4[MAX_TERRAIN_MIPMAP_LEVELS * 2]().uniformBuffer(2);
    scope.heightMap = pb.tex2D().uniform(2);
    scope.heightMapSize = pb.vec4().uniform(2);
    scope.region = pb.vec4().uniform(2);
    scope.terrainScale = pb.vec3().uniform(2);

    scope.$l.s = pb.sin(scope.$inputs.clipmapInfo.x);
    scope.$l.c = pb.cos(scope.$inputs.clipmapInfo.x);
    scope.$l.scale2 = pb.mul(scope.$inputs.clipmapInfo.y, scope.clipmapGridInfo.x);
    scope.$l.clipmapMatrix = pb.mat4(
      pb.mul(scope.c, scope.scale2),
      pb.mul(scope.s, scope.scale2),
      0,
      0,
      pb.neg(pb.mul(scope.s, scope.scale2)),
      pb.mul(scope.c, scope.scale2),
      0,
      0,
      0,
      0,
      1,
      0,
      pb.sub(pb.mul(scope.$inputs.clipmapInfo.z, scope.clipmapGridInfo.x), scope.clipmapGridInfo.y),
      pb.sub(pb.mul(scope.$inputs.clipmapInfo.w, scope.clipmapGridInfo.x), scope.clipmapGridInfo.z),
      0,
      1
    );

    scope.$l.localPos = scope.$inputs.position.xy;
    // position.z = -side flags a seam midpoint (see Clipmap.generateSeamMesh). When the seam edge
    // lies outside the region, clamping would line its flaps up along the border as vertical
    // curtains, so the midpoint takes its neighbour's local position instead: both then run the
    // exact same math below, land on the same point, and the flap degenerates.
    scope.$l.seamSide = pb.neg(scope.$inputs.position.z);
    scope.$if(pb.greaterThan(scope.seamSide, 0.5), function () {
      this.$l.probeLocal = pb.mul(this.clipmapMatrix, pb.vec4(this.localPos, 0, 1)).xy;
      this.$l.probe = pb.mul(
        ShaderHelper.getWorldMatrix(this),
        pb.vec4(this.probeLocal.x, 0, this.probeLocal.y, 1)
      ).xz;
      // Sides 1 and 3 run along local x (world x, seams are never rotated), so the border they
      // can lie beyond is a z one; sides 2 and 4 run along z.
      this.$l.alongX = pb.greaterThan(pb.mod(this.seamSide, 2), 0.5);
      this.$l.outside = pb.or(
        pb.and(
          this.alongX,
          pb.or(pb.lessThan(this.probe.y, this.region.y), pb.greaterThan(this.probe.y, this.region.w))
        ),
        pb.and(
          pb.not(this.alongX),
          pb.or(pb.lessThan(this.probe.x, this.region.x), pb.greaterThan(this.probe.x, this.region.z))
        )
      );
      this.$if(this.outside, function () {
        // The previous seam vertex sits one unit back along the side: -x, -y, +x, +y for sides 1..4
        this.$l.dir = pb.sub(pb.mul(pb.float(pb.greaterThan(this.seamSide, 2.5)), 2), 1);
        this.localPos = pb.add(
          this.localPos,
          pb.mul(pb.vec2(pb.float(this.alongX), pb.float(pb.not(this.alongX))), this.dir)
        );
      });
    });
    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.localPos, 0, 1)).xy;

    scope.$l.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz;
    // Heights are evaluated at the unclamped grid point: every level computes the same function
    // of its own grid, which keeps the rings matching. Beyond the region the sampler clamps to
    // the edge texels, the same heights the clamped position would get.
    scope.$l.gridPos = scope.clipmapWorldPos.xz;
    scope.$l.gridUV = pb.div(
      pb.sub(scope.gridPos, scope.region.xy),
      pb.sub(scope.region.zw, scope.region.xy)
    );
    // Global grid coordinate in cells, see ClipmapGatherContext.gridOriginX
    scope.$l.gridCoord = pb.floor(
      pb.add(pb.div(pb.add(scope.clipmapPos, scope.clipmapGridInfo.yz), scope.clipmapGridInfo.x), 0.5)
    );
    // Keep the grid inside the terrain region instead of discarding fragments outside of it,
    // which would cost early-Z on the largest occluder in the scene. The clipmap grid is
    // axis-aligned, so clamping collapses triangles lying outside into zero-area ones and snaps
    // the ones crossing the border exactly onto it.
    scope.clipmapWorldPos = pb.vec3(
      pb.clamp(scope.clipmapWorldPos.x, scope.region.x, scope.region.z),
      scope.clipmapWorldPos.y,
      pb.clamp(scope.clipmapWorldPos.z, scope.region.y, scope.region.w)
    );
    scope.$outputs.uv = pb.div(
      pb.sub(scope.clipmapWorldPos.xz, scope.region.xy),
      pb.sub(scope.region.zw, scope.region.xy)
    );

    if (this.drawContext.device.type === 'webgl') {
      scope.$l.levelStart = pb.vec4();
      scope.$l.levelDiff = pb.vec4();
      scope.$l.index = pb.mul(pb.int(scope.$inputs.miplevel), 2);
      scope.$for(pb.int('i'), 0, WEBGL1_LEVEL_DATA_VECTORS, function () {
        this.$if(pb.equal(this.i, this.index), function () {
          this.levelStart = this.levelData.at(this.i);
          this.levelDiff = this.levelData.at(pb.add(this.i, 1));
          this.$break();
        });
      });
    } else {
      scope.$l.levelStart = scope.levelData.at(pb.mul(pb.int(scope.$inputs.miplevel), 2));
      scope.$l.levelDiff = scope.levelData.at(pb.add(pb.mul(pb.int(scope.$inputs.miplevel), 2), 1));
    }

    scope.$l.height = this.sampleHeightMap(
      scope,
      scope.gridUV,
      scope.gridCoord,
      scope.gridPos,
      scope.levelStart,
      scope.levelDiff
    );
    scope.$outputs.worldPos = pb.add(
      scope.clipmapWorldPos,
      pb.vec3(0, pb.mul(scope.height, scope.terrainScale.y), 0)
    );
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    scope.region = pb.vec4().uniform(2);
    if (this.needFragmentColor() && this.virtualTextureUsed) {
      const globals = pb.getGlobalScope();
      this._virtualTexture!.declareBindings(globals, 2, false);
      globals.zTerrainRVT0 = pb.tex2D().uniform(2);
      globals.zTerrainRVT1 = pb.tex2D().uniform(2);
      scope.$l.terrainN = pb.vec3();
      scope.$l.albedo = this.sampleVirtualTexture(scope, scope.terrainN);
      // The normal read back already carries the height map slopes and the detail layers; the
      // frame around it only orients anisotropic and clear coat terms
      scope.$l.terrainT = pb.normalize(pb.sub(pb.vec3(1, 0, 0), pb.mul(scope.terrainN, scope.terrainN.x)));
      scope.$l.terrainB = pb.cross(scope.terrainT, scope.terrainN);
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        scope.terrainN,
        scope.terrainT,
        scope.terrainB
      );
      this.shadeTerrain(scope);
    } else if (this.needFragmentColor()) {
      scope.heightMap = pb.tex2D().uniform(2);
      scope.heightMapSize = pb.vec4().uniform(2);
      scope.terrainScale = pb.vec3().uniform(2);
      const numDetailMaps = this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
      if (numDetailMaps > 0) {
        scope.detailParams = pb.vec4[numDetailMaps]().uniform(2);
        if (this.hexTilingMask) {
          scope.detailHexParams = pb.vec4[numDetailMaps]().uniform(2);
        }
        if (this.drawContext.device.type === 'webgl') {
          scope.splatMap = pb.tex2D().uniform(2);
          for (let i = 0; i < numDetailMaps; i++) {
            scope[`detailAlbedoMap${i}`] = pb.tex2D().uniform(2);
            scope[`detailNormalMap${i}`] = pb.tex2D().uniform(2);
          }
        } else {
          scope.splatMap = pb.tex2DArray().uniform(2);
          scope.detailAlbedoMap = pb.tex2DArray().uniform(2);
          scope.detailNormalMap = pb.tex2DArray().uniform(2);
        }
      }
      // Sampled once here and shared by the albedo and detail normal blends
      for (let i = 0; i < (numDetailMaps + 3) >> 2; i++) {
        scope.$l[`terrainSplatMask${i}`] = this.sampleSplatMask(scope, i);
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.terrainT = pb.vec3();
      scope.$l.terrainB = pb.vec3();
      scope.$l.terrainN = pb.vec3();
      this.calculateTerrainTBN(scope, scope.terrainT, scope.terrainB, scope.terrainN);
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        scope.terrainN,
        scope.terrainT,
        scope.terrainB
      );
      if (this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP) > 0) {
        scope.normalInfo.normal = this.calculateDetailNormal(scope, scope.normalInfo.TBN);
      }
      this.shadeTerrain(scope);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  /** Lights the terrain from the albedo and normalInfo locals of the fragment shader */
  private shadeTerrain(scope: PBFunctionScope) {
    const pb = scope.$builder;
    scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
    const storeSceneData = !!(
      this.drawContext.materialFlags &
      (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
    );
    if (storeSceneData) {
      // Filled by PBRLight with (specular color, roughness) for SSR/SSGI
      scope.$l.outRoughness = pb.vec4();
    }
    scope.$l.litColor = this.PBRLight(
      scope,
      scope.$inputs.worldPos,
      scope.normalInfo.normal,
      scope.viewVec,
      scope.albedo,
      scope.normalInfo.TBN,
      storeSceneData ? scope.outRoughness : undefined
    );
    switch (this.featureUsed<TerrainDebugMode>(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE)) {
      case 'albedo':
        scope.$l.outColor = pb.vec4(scope.albedo.rgb, 1);
        break;
      case 'vertex_normal':
        scope.$l.outColor = pb.vec4(pb.add(pb.mul(scope.normalInfo.TBN[2], 0.5), pb.vec3(0.5)), 1);
        break;
      case 'detail_normal':
        scope.$l.outColor = pb.vec4(pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)), 1);
        break;
      case 'tangent':
        scope.$l.outColor = pb.vec4(pb.add(pb.mul(scope.normalInfo.TBN[0], 0.5), pb.vec3(0.5)), 1);
        break;
      case 'bitangent':
        scope.$l.outColor = pb.vec4(pb.add(pb.mul(scope.normalInfo.TBN[1], 0.5), pb.vec3(0.5)), 1);
        break;
      case 'uv':
        scope.$l.outColor = pb.vec4(scope.$inputs.uv, 0, 1);
        break;
      default:
        scope.$l.outColor = pb.vec4(scope.litColor, 1);
        break;
    }
    if (storeSceneData) {
      this.outputFragmentColor(
        scope,
        scope.$inputs.worldPos,
        scope.outColor,
        scope.outRoughness,
        pb.vec4(pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)), 1)
      );
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.outColor);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapGridInfo', this._clipmapGridInfo);
    bindGroup.setValue('region', this._region);
    bindGroup.setValue('terrainScale', this._terrainScale);
    const heightMap = this._heightMap.get()!;
    // The vertex shader samples explicit mip levels per clipmap ring. WebGL ignores the LOD of
    // textureLod() under a non-mipmapped min filter, so the sampler has to be mipmapped whenever
    // the texture has a mip chain (WebGL1 NPOT height maps have none).
    bindGroup.setTexture(
      'heightMap',
      heightMap,
      fetchSampler(heightMap.mipLevelCount > 1 ? 'clamp_linear' : 'clamp_linear_nomip')
    );
    bindGroup.setValue('heightMapSize', this._heightMapSize);
    const levelDataBuffer = this._levelDataBuffer.get();
    if (levelDataBuffer) {
      bindGroup.setBuffer('levelData', levelDataBuffer);
    } else {
      bindGroup.setValue('levelData', this._levelDataArray);
    }
    if (this.needFragmentColor(ctx) && this.virtualTextureUsed) {
      const vt = this._virtualTexture!;
      vt.applyBindings(bindGroup, false);
      bindGroup.setTexture(
        'zTerrainRVT0',
        vt.getPlaneTexture('baseColor')!,
        fetchSampler('clamp_linear_nomip')
      );
      bindGroup.setTexture(
        'zTerrainRVT1',
        vt.getPlaneTexture('normalRoughness')!,
        fetchSampler('clamp_linear_nomip')
      );
    } else if (this.needFragmentColor(ctx)) {
      if (this._detailMapInfo.numDetailMaps > 0) {
        bindGroup.setTexture('splatMap', this._detailMapInfo.splatMap.get()!);
        if (ctx.device.type === 'webgl') {
          for (let i = 0; i < this._detailMapInfo.numDetailMaps; i++) {
            bindGroup.setTexture(
              `detailAlbedoMap${i}`,
              this._detailMapInfo.detailMapList[i]?.get() ?? ClipmapTerrainMaterial.getDefaultDetailMap()!,
              fetchSampler('repeat_linear')
            );
            bindGroup.setTexture(
              `detailNormalMap${i}`,
              this._detailMapInfo.detailNormalMapList[i]?.get() ??
                ClipmapTerrainMaterial.getDefaultNormalMap()!,
              fetchSampler('repeat_linear')
            );
          }
        } else {
          bindGroup.setTexture(
            'detailAlbedoMap',
            this._detailMapInfo.detailMap.get()!,
            fetchSampler('repeat_linear')
          );
          bindGroup.setTexture(
            'detailNormalMap',
            this._detailMapInfo.detailNormalMap!.get()!,
            fetchSampler('repeat_linear')
          );
        }
        bindGroup.setValue('detailParams', this._detailMapInfo.detailMapParams);
        if (this.hexTilingMask) {
          bindGroup.setValue('detailHexParams', this._detailMapInfo.detailHexParams);
        }
      }
    }
  }
  private createDetailMapInfo() {
    const device = getDevice();
    const isWebGL1 = device.type === 'webgl';
    const detailMap = isWebGL1
      ? null
      : device.createTexture2DArray('rgba8unorm', this._detailMapSize, this._detailMapSize, MAX_DETAIL_MAPS);
    const detailNormalMap = isWebGL1
      ? null
      : device.createTexture2DArray('rgba8unorm', this._detailMapSize, this._detailMapSize, MAX_DETAIL_MAPS);
    const splatMap = isWebGL1
      ? device.createTexture2D('rgba8unorm', this._splatMapSize, this._splatMapSize)
      : device.createTexture2DArray(
          'rgba8unorm',
          this._splatMapSize,
          this._splatMapSize,
          MAX_DETAIL_MAPS >> 2
        );
    device.pushDeviceStates();
    if (!isWebGL1) {
      const fbDetail = device.createFrameBuffer([detailMap!], null);
      device.setFramebuffer(fbDetail);
      for (let i = 0; i < detailMap!.depth; i++) {
        fbDetail.setColorAttachmentLayer(0, i);
        device.clearFrameBuffer(Vector4.zero(), DEPTH_CLEAR_VALUE, 0);
      }
      fbDetail.dispose();
      const fbNormal = device.createFrameBuffer([detailNormalMap!], null);
      device.setFramebuffer(fbNormal);
      for (let i = 0; i < detailNormalMap!.depth; i++) {
        fbNormal.setColorAttachmentLayer(0, i);
        device.clearFrameBuffer(new Vector4(0.5, 0.5, 1, 1), DEPTH_CLEAR_VALUE, 0);
      }
      fbNormal.dispose();
    }
    const fbSplat = device.createFrameBuffer([splatMap!], null);
    device.setFramebuffer(fbSplat);
    for (let i = 0; i < splatMap!.depth; i++) {
      fbSplat.setColorAttachmentLayer(0, i);
      device.clearFrameBuffer(i === 0 ? new Vector4(1, 0, 0, 0) : Vector4.zero(), DEPTH_CLEAR_VALUE, 0);
    }
    device.popDeviceStates();
    fbSplat.dispose();
    return {
      detailMap: new DRef(detailMap),
      detailNormalMap: new DRef(detailNormalMap),
      detailMapList: [],
      detailNormalMapList: [],
      splatMap: new DRef(splatMap),
      detailMapParams: new Float32Array(MAX_DETAIL_MAPS * 4),
      detailHexParams: new Float32Array(MAX_DETAIL_MAPS * 4),
      numDetailMaps: 0
    };
  }

  protected onDispose() {
    super.onDispose();
    this._heightMap.dispose();
    this._levelDataBuffer.dispose();
    if (this._detailMapInfo) {
      this._detailMapInfo.detailMap?.dispose();
      this._detailMapInfo.detailNormalMap?.dispose();
      this._detailMapInfo.splatMap?.dispose();
      for (const tex of this._detailMapInfo.detailMapList) {
        tex.dispose();
      }
      for (const tex of this._detailMapInfo.detailNormalMapList) {
        tex.dispose();
      }
    }
  }
  static getDefaultDetailMap() {
    if (!ClipmapTerrainMaterial._defaultDetailMap.get()) {
      const device = getDevice();
      const tex = device.createTexture2D('rgba8unorm', 1, 1)!;
      tex.update(new Uint8Array([0, 0, 0, 255]), 0, 0, 1, 1);
      ClipmapTerrainMaterial._defaultDetailMap.set(tex);
    }
    return ClipmapTerrainMaterial._defaultDetailMap.get();
  }
  static getDefaultNormalMap() {
    if (!ClipmapTerrainMaterial._defaultNormalMap.get()) {
      const device = getDevice();
      const tex = device.createTexture2D('rgba8unorm', 1, 1)!;
      tex.update(new Uint8Array([128, 128, 255, 255]), 0, 0, 1, 1);
      ClipmapTerrainMaterial._defaultNormalMap.set(tex);
    }
    return ClipmapTerrainMaterial._defaultNormalMap.get();
  }
}
