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
import { Vector3, Vector4 } from '@zephyr3d/base';
import { mixinLight } from './mixins/lit';
import { Application, DRef } from '../app';
import { fetchSampler } from '../utility/misc';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { CopyBlitter } from '../blitter';

type ClipmapTerrainDetailMapInfo = {
  detailMap: DRef<Texture2DArray>;
  detailNormalMap?: DRef<Texture2DArray>;
  detailMapList: DRef<Texture2D>[];
  detailNormalMapList: DRef<Texture2D>[];
  splatMap: DRef<Texture2DArray>;
  detailMapParams: Float32Array;
  numDetailMaps: number;
};

const MAX_DETAIL_MAPS = 8;

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
  private static FEATURE_DETAIL_MAP = this.defineFeature();
  private static FEATURE_DEBUG_MODE = this.defineFeature();
  private static _defaultDetailMap: DRef<Texture2D> = new DRef();
  private static _defaultNormalMap: DRef<Texture2D> = new DRef();
  private _region: Vector4;
  private _clipmapGridInfo: Vector4;
  private _heightMap: DRef<Texture2D>;
  private _terrainScale: Vector3;
  private _detailMapInfo: ClipmapTerrainDetailMapInfo;
  private _detailMapSize: number;
  private _splatMapSize: number;
  private _heightMapSize: Vector4;
  private _levelDataBuffer: DRef<GPUDataBuffer>;
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
    this._levelDataBuffer = new DRef(
      Application.instance.device.createBuffer(MAX_TERRAIN_MIPMAP_LEVELS * 4 * 2 * 4, { usage: 'uniform' })
    );
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
  }
  static get MAX_DETAIL_MAP_COUNT() {
    return MAX_DETAIL_MAPS;
  }
  get debugMode(): TerrainDebugMode {
    return this.featureUsed<TerrainDebugMode>(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE);
  }
  set debugMode(mode: TerrainDebugMode) {
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE, mode);
  }
  /** @internal */
  setLevelData(data: Float32Array, length: number) {
    this._levelDataBuffer.get().bufferSubData(0, data, 0, length);
  }
  /** @internal */
  get region() {
    return this._region;
  }
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
        this._detailMapInfo.detailMapList[i].dispose();
        this._detailMapInfo.detailNormalMapList[i].dispose();
      }
    } else if (val < n) {
      for (let i = val; i < n; i++) {
        this.setDetailMap(i, defaultDetailMap);
        this.setDetailNormalMap(i, defaultNormalMap);
        this.setDetailMapUVScale(i, 80);
        this.setDetailMapRoughness(i, 1);
        this._detailMapInfo.detailMapList[i].dispose();
        this._detailMapInfo.detailNormalMapList[i].dispose();
      }
      this._detailMapInfo.numDetailMaps = val;
    }
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP, this._detailMapInfo.numDetailMaps);
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
      this.uniformChanged();
    }
  }
  getDetailMapUVScale(index: number): number {
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
  getDetailMapRoughness(index: number): number {
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
  getDetailMap(index: number): Texture2D {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return null;
    }
    return this._detailMapInfo.detailMapList[index].get();
  }
  setDetailMap(index: number, albedoMap: Texture2D) {
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
    const blitter = new CopyBlitter();
    const fb = Application.instance.device.createFrameBuffer([this._detailMapInfo.detailMap.get()], null);
    blitter.blit(
      albedoMap,
      fb,
      index,
      albedoMap.width === this._detailMapSize && albedoMap.height === this._detailMapSize
        ? fetchSampler('clamp_nearest_nomip')
        : fetchSampler('clamp_linear_nomip')
    );
    fb.dispose();
  }
  getDetailNormalMap(index: number): Texture2D {
    if (index >= this._detailMapInfo.numDetailMaps || index < 0 || !Number.isInteger(index)) {
      console.error('Invalid detail map index');
      return null;
    }
    return this._detailMapInfo.detailNormalMapList[index].get();
  }
  setDetailNormalMap(index: number, normalMap: Texture2D) {
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
    const blitter = new CopyBlitter();
    const fb = Application.instance.device.createFrameBuffer(
      [this._detailMapInfo.detailNormalMap.get()],
      null
    );
    blitter.blit(
      normalMap,
      fb,
      index,
      normalMap.width === this._detailMapSize && normalMap.height === this._detailMapSize
        ? fetchSampler('clamp_nearest_nomip')
        : fetchSampler('clamp_linear_nomip')
    );
    fb.dispose();
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
    return this._heightMap.get();
  }
  set heightMap(val: Texture2D) {
    if (val !== this._heightMap.get()) {
      this._heightMap.set(val);
      this._heightMapSize.setXYZW(
        this.heightMap.width,
        this.heightMap.height,
        1 / this.heightMap.width,
        1 / this.heightMap.height
      );
      this.uniformChanged();
    }
  }
  needSceneColor(): boolean {
    return false;
  }
  needSceneDepth(): boolean {
    return false;
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return true;
  }
  getMetallicRoughnessTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.uv;
  };
  sampleDetailNormalMap(scope: PBInsideFunctionScope, index: number, texCoord: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const sample = pb.textureArraySample(scope.detailNormalMap, texCoord, index).rgb;
    const normal = pb.sub(pb.mul(sample, 2), pb.vec3(1));
    return pb.normalize(normal);
  }
  calculateDetailNormal(scope: PBInsideFunctionScope, TBN: PBShaderExp) {
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainNormal';
    pb.func(funcName, [pb.mat3('TBN')], function () {
      const numDetailMaps = that.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
      this.$l.detailNormal = pb.vec3(0);
      for (let i = 0; i < (numDetailMaps + 3) >> 2; i++) {
        this.$l[`mask${i}`] = pb.textureArraySample(this.splatMap, this.$inputs.uv, i);
      }
      for (let i = 0; i < numDetailMaps; i++) {
        const uv = pb.mul(this.$inputs.uv, this.detailParams[i].x);
        this.detailNormal = pb.add(
          this.detailNormal,
          pb.mul(that.sampleDetailNormalMap(this, i, uv), this[`mask${i >> 2}`][i & 3])
        );
      }
      this.$return(pb.normalize(pb.mul(this.TBN, this.detailNormal)));
    });
    return pb.getGlobalScope()[funcName](TBN);
  }
  getNormalTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.uv;
  };
  calculateAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainAlbedo';
    pb.func(funcName, [], function () {
      const numDetailMaps = that.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
      if (numDetailMaps === 0) {
        this.$l.checkerPos = pb.floor(pb.mul(this.$inputs.uv, pb.sub(this.region.zw, this.region.xy)));
        this.$l.checker = pb.mod(pb.add(this.checkerPos.x, this.checkerPos.y), 2);
        this.$l.checkerColor = pb.mix(pb.vec3(0.4), pb.vec3(1), this.checker);
        this.$return(pb.vec4(this.checkerColor, 1));
      } else {
        this.$l.color = pb.vec3(0);
        for (let i = 0; i < (numDetailMaps + 3) >> 2; i++) {
          this.$l[`mask${i}`] = pb.textureArraySample(this.splatMap, this.$inputs.uv, i);
        }
        for (let i = 0; i < numDetailMaps; i++) {
          const uv = pb.mul(this.$inputs.uv, this.detailParams[i].x);
          const sample = pb.textureArraySample(this.detailAlbedoMap, uv, i).rgb;
          this.color = pb.add(this.color, pb.mul(sample, this[`mask${i >> 2}`][i & 3]));
        }
        this.$return(pb.vec4(this.color, 1));
      }
    });
    return pb.getGlobalScope()[funcName]();
  }
  sampleHeightMap(
    scope: PBInsideFunctionScope,
    uv: PBShaderExp,
    pos: PBShaderExp,
    levelStart: PBShaderExp,
    levelDiff: PBShaderExp
  ) {
    const pb = scope.$builder;
    const morphRange = 0.5;
    pb.func(
      'sampleHeightMap',
      [pb.vec2('uv'), pb.vec2('pos'), pb.vec4('levelStart'), pb.vec4('levelDiff')],
      function () {
        this.$l.h1 = pb.textureSampleLevel(this.heightMap, this.uv, this.$inputs.miplevel).r;
        this.$l.ratio = pb.mul(pb.sub(this.pos.xyxy, this.levelStart), this.levelDiff);
        this.$l.maxVal = pb.clamp(
          pb.max(pb.max(this.ratio.x, this.ratio.y), pb.max(this.ratio.z, this.ratio.w)),
          0,
          1
        );
        this.$l.morphFactor = pb.float(0);
        this.$if(pb.greaterThan(this.maxVal, 1 - morphRange), function () {
          this.$l.h2 = pb.textureSampleLevel(this.heightMap, this.uv, pb.add(this.$inputs.miplevel, 1)).r;
          this.morphFactor = pb.div(pb.sub(this.maxVal, 1 - morphRange), morphRange * 2);
          this.h1 = pb.mix(this.h1, this.h2, this.morphFactor);
        });
        this.$if(pb.lessThan(this.maxVal, morphRange), function () {
          this.$l.h2 = pb.textureSampleLevel(
            this.heightMap,
            this.uv,
            pb.max(pb.sub(this.$inputs.miplevel, 1), 0)
          ).r;
          this.morphFactor = pb.mul(pb.add(pb.div(this.maxVal, morphRange), 1), 0.5);
          this.h1 = pb.mix(this.h1, this.h2, this.morphFactor);
        });
        this.$return(this.h1);
      }
    );
    return scope.sampleHeightMap(uv, pos, levelStart, levelDiff);
  }
  calculateTerrainTBN(
    scope: PBInsideFunctionScope,
    clipmapPos: PBShaderExp,
    uv: PBShaderExp,
    texSize: PBShaderExp,
    scale: PBShaderExp,
    levelStart: PBShaderExp,
    levelDiff: PBShaderExp,
    tangent: PBShaderExp,
    bitangent: PBShaderExp,
    normal: PBShaderExp
  ): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    pb.func(
      'calcTerrainTBN',
      [
        pb.vec2('clipmapPos'),
        pb.vec2('uv'),
        pb.vec4('texSize'),
        pb.vec3('scale'),
        pb.vec4('levelStart'),
        pb.vec4('levelDiff'),
        pb.vec3('t').out(),
        pb.vec3('b').out(),
        pb.vec3('n').out()
      ],
      function () {
        this.$l.texelSize = pb.mul(this.texSize.zw, pb.exp2(this.$inputs.miplevel));
        this.$l.delta = pb.exp2(pb.add(this.$inputs.miplevel, 1));
        this.$l.hL = that.sampleHeightMap(
          this,
          pb.sub(this.uv, pb.vec2(this.texelSize.x, 0)),
          this.clipmapPos,
          this.levelStart,
          this.levelDiff
        );
        this.$l.hR = that.sampleHeightMap(
          this,
          pb.add(this.uv, pb.vec2(this.texelSize.x, 0)),
          this.clipmapPos,
          this.levelStart,
          this.levelDiff
        );
        this.$l.hD = that.sampleHeightMap(
          this,
          pb.add(this.uv, pb.vec2(0, this.texelSize.y)),
          this.clipmapPos,
          this.levelStart,
          this.levelDiff
        );
        this.$l.hU = that.sampleHeightMap(
          this,
          pb.sub(this.uv, pb.vec2(0, this.texelSize.y)),
          this.clipmapPos,
          this.levelStart,
          this.levelDiff
        );
        this.$l.dHdU = pb.div(
          pb.mul(pb.sub(this.hR, this.hL), this.scale.y),
          pb.mul(this.scale.x, this.delta)
        );
        this.$l.dHdV = pb.div(
          pb.mul(pb.sub(this.hD, this.hU), this.scale.y),
          pb.mul(this.scale.z, this.delta)
        );
        this.t = pb.normalize(pb.vec3(1, this.dHdU, 0));
        this.b = pb.normalize(pb.vec3(0, this.dHdV, 1));
        this.n = pb.normalize(pb.cross(this.b, this.t));
      }
    );
    return scope.calcTerrainTBN(
      clipmapPos,
      uv,
      texSize,
      scale,
      levelStart,
      levelDiff,
      tangent,
      bitangent,
      normal
    );
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.$inputs.clipmapInfo = pb.vec4().attrib('texCoord0');
    scope.$inputs.miplevel = pb.float().attrib('texCoord1');
    scope.clipmapGridInfo = pb.vec4().uniform(2);
    scope.levelData = pb.vec4[MAX_TERRAIN_MIPMAP_LEVELS * 2]().uniformBuffer(2);
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

    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;

    scope.$l.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz;
    scope.$outputs.uv = pb.div(
      pb.sub(scope.clipmapWorldPos.xz, scope.region.xy),
      pb.sub(scope.region.zw, scope.region.xy)
    );

    scope.$l.levelStart = scope.levelData.at(pb.mul(pb.int(scope.$inputs.miplevel), 2));
    scope.$l.levelDiff = scope.levelData.at(pb.add(pb.mul(pb.int(scope.$inputs.miplevel), 2), 1));

    scope.$l.height = this.sampleHeightMap(
      scope,
      scope.$outputs.uv,
      scope.clipmapWorldPos.xz,
      scope.levelStart,
      scope.levelDiff
    );
    scope.$outputs.worldPos = pb.add(
      scope.clipmapWorldPos,
      pb.vec3(0, pb.mul(scope.height, scope.terrainScale.y), 0)
    );
    scope.$l.t = pb.vec3();
    scope.$l.b = pb.vec3();
    scope.$l.n = pb.vec3();
    this.calculateTerrainTBN(
      scope,
      scope.clipmapWorldPos.xz,
      scope.$outputs.uv,
      scope.heightMapSize,
      scope.terrainScale,
      scope.levelStart,
      scope.levelDiff,
      scope.t,
      scope.b,
      scope.n
    );
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    scope.$outputs.worldTangent = scope.t;
    scope.$outputs.worldBinormal = scope.b;
    scope.$outputs.worldNormal = scope.n;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    scope.region = pb.vec4().uniform(2);
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.uv, pb.vec2(0))),
      pb.any(pb.greaterThan(scope.$inputs.uv, pb.vec2(1)))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      scope.heightMap = pb.tex2D().uniform(2);
      const numDetailMaps = this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
      if (numDetailMaps > 0) {
        scope.detailParams = pb.vec4[numDetailMaps]().uniform(2);
        scope.splatMap = pb.tex2DArray().uniform(2);
        scope.detailAlbedoMap = pb.tex2DArray().uniform(2);
        scope.detailNormalMap = pb.tex2DArray().uniform(2);
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.worldNormal = pb.normalize(scope.$inputs.worldNormal);
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        scope.$inputs.worldNormal,
        scope.$inputs.worldTangent,
        scope.$inputs.worldBinormal
      );
      if (this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP) > 0) {
        scope.normalInfo.normal = this.calculateDetailNormal(scope, scope.normalInfo.TBN);
      }
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.$inputs.worldPos,
        scope.normalInfo.normal,
        scope.viewVec,
        scope.albedo,
        scope.normalInfo.TBN
      );
      switch (this.featureUsed<TerrainDebugMode>(ClipmapTerrainMaterial.FEATURE_DEBUG_MODE)) {
        case 'albedo':
          scope.$l.outColor = scope.albedo;
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
      //scope.$l.outColor = pb.vec4(scope.litColor, 1);
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(0, 0, 0, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          scope.outColor,
          scope.outRoughness,
          scope.outColor
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.outColor);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapGridInfo', this._clipmapGridInfo);
    bindGroup.setValue('region', this._region);
    bindGroup.setValue('terrainScale', this._terrainScale);
    bindGroup.setTexture('heightMap', this._heightMap.get(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('heightMapSize', this._heightMapSize);
    bindGroup.setBuffer('levelData', this._levelDataBuffer.get());
    if (this.needFragmentColor(ctx)) {
      if (this._detailMapInfo.numDetailMaps > 0) {
        bindGroup.setTexture('splatMap', this._detailMapInfo.splatMap.get());
        bindGroup.setTexture(
          'detailAlbedoMap',
          this._detailMapInfo.detailMap.get(),
          fetchSampler('repeat_linear')
        );
        bindGroup.setTexture(
          'detailNormalMap',
          this._detailMapInfo.detailNormalMap.get(),
          fetchSampler('repeat_linear')
        );
        bindGroup.setValue('detailParams', this._detailMapInfo.detailMapParams);
      }
    }
  }
  private createDetailMapInfo(): ClipmapTerrainDetailMapInfo {
    const device = Application.instance.device;
    const detailMap = device.createTexture2DArray(
      'rgba8unorm',
      this._detailMapSize,
      this._detailMapSize,
      MAX_DETAIL_MAPS
    );
    const detailNormalMap = device.createTexture2DArray(
      'rgba8unorm',
      this._detailMapSize,
      this._detailMapSize,
      MAX_DETAIL_MAPS
    );
    const splatMap = device.createTexture2DArray(
      'rgba8unorm',
      this._splatMapSize,
      this._splatMapSize,
      MAX_DETAIL_MAPS >> 2
    );
    const fbDetail = device.createFrameBuffer([detailMap], null);
    const fbNormal = device.createFrameBuffer([detailNormalMap], null);
    const fbSplat = device.createFrameBuffer([splatMap], null);
    device.pushDeviceStates();
    device.setFramebuffer(fbDetail);
    for (let i = 0; i < detailMap.depth; i++) {
      fbDetail.setColorAttachmentLayer(0, i);
      device.clearFrameBuffer(Vector4.zero(), 1, 0);
    }
    device.setFramebuffer(fbNormal);
    for (let i = 0; i < detailNormalMap.depth; i++) {
      fbNormal.setColorAttachmentLayer(0, i);
      device.clearFrameBuffer(new Vector4(0.5, 0.5, 1, 1), 1, 0);
    }
    device.setFramebuffer(fbSplat);
    for (let i = 0; i < splatMap.depth; i++) {
      fbSplat.setColorAttachmentLayer(0, i);
      device.clearFrameBuffer(i === 0 ? new Vector4(1, 0, 0, 0) : Vector4.zero(), 1, 0);
    }
    device.popDeviceStates();
    fbDetail.dispose();
    fbNormal.dispose();
    fbSplat.dispose();
    return {
      detailMap: new DRef(detailMap),
      detailNormalMap: new DRef(detailNormalMap),
      detailMapList: [],
      detailNormalMapList: [],
      splatMap: new DRef(splatMap),
      detailMapParams: new Float32Array(MAX_DETAIL_MAPS * 4),
      numDetailMaps: 0
    };
  }

  dispose(): void {
    super.dispose();
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
      this._detailMapInfo = null;
    }
  }
  static getDefaultDetailMap() {
    if (!ClipmapTerrainMaterial._defaultDetailMap.get()) {
      const device = Application.instance.device;
      const tex = device.createTexture2D('rgba8unorm', 1, 1);
      tex.update(new Uint8Array([0, 0, 0, 255]), 0, 0, 1, 1);
      ClipmapTerrainMaterial._defaultDetailMap.set(tex);
    }
    return ClipmapTerrainMaterial._defaultDetailMap.get();
  }
  static getDefaultNormalMap() {
    if (!ClipmapTerrainMaterial._defaultNormalMap.get()) {
      const device = Application.instance.device;
      const tex = device.createTexture2D('rgba8unorm', 1, 1);
      tex.update(new Uint8Array([128, 128, 255, 255]), 0, 0, 1, 1);
      ClipmapTerrainMaterial._defaultNormalMap.set(tex);
    }
    return ClipmapTerrainMaterial._defaultNormalMap.get();
  }
}
