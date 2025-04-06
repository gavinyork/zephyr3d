import type {
  BindGroup,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import type { DrawContext } from '../render';
import { MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import { Matrix4x4, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { mixinLight } from './mixins/lit';
import { Application, DRef } from '../app';
import { fetchSampler } from '../utility/misc';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { CopyBlitter } from '../blitter';

export type TerrainDetailMapInfo = {
  detailMap: DRef<Texture2DArray>;
  detailNormalMap?: DRef<Texture2DArray>;
  detailMapList: DRef<Texture2D>[];
  detailNormalMapList: DRef<Texture2D>[];
  splatMap: DRef<Texture2DArray>;
  detailMapParams: Float32Array;
  numDetailMaps: number;
};

const MAX_DETAIL_MAPS = 8;

export class ClipmapTerrainMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRMetallicRoughness
) {
  private static FEATURE_DETAIL_MAP = this.defineFeature();
  private static _normalMapProgram: GPUProgram = null;
  private static _normalMapBindGroup: BindGroup = null;
  private static _defaultDetailMap: DRef<Texture2D> = new DRef();
  private static _defaultNormalMap: DRef<Texture2D> = new DRef();
  private _region: Vector4;
  private _clipmapMatrix: Matrix4x4;
  private _heightMap: DRef<Texture2D>;
  private _normalMap: DRef<Texture2D>;
  private _terrainScale: Vector3;
  private _detailMapInfo: TerrainDetailMapInfo;
  private _detailMapSize: number;
  private _splatMapSize: number;
  constructor(heightMap: Texture2D) {
    super();
    this.metallic = 0;
    this.roughness = 1;
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapMatrix = new Matrix4x4();
    this._heightMap = new DRef(heightMap);
    this._normalMap = new DRef();
    this._detailMapSize = 256;
    this._splatMapSize = 512;
    this._detailMapInfo = this.createDetailMapInfo();
    this._terrainScale = Vector3.one();
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP, 0);
    this.calculateNormalMap();
  }
  /** @internal */
  get region() {
    return this._region;
  }
  /** @internal */
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.calculateNormalMap();
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
      this.calculateNormalMap();
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
    if (!albedoMap) {
      console.error('Detail map cannot be null');
      return;
    }
    if (!this._detailMapInfo.detailMapList[index]) {
      this._detailMapInfo.detailMapList[index] = new DRef();
    }
    this._detailMapInfo.detailMapList[index].set(
      albedoMap === ClipmapTerrainMaterial.getDefaultDetailMap() ? null : albedoMap
    );
    const blitter = new CopyBlitter();
    blitter.srgbOut = true;
    blitter.blit(
      albedoMap,
      this._detailMapInfo.detailMap.get(),
      index,
      albedoMap.width === this._detailMapSize && albedoMap.height === this._detailMapSize
        ? fetchSampler('clamp_nearest_nomip')
        : fetchSampler('clamp_linear_nomip')
    );
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
    blitter.srgbOut = false;
    blitter.blit(
      normalMap,
      this._detailMapInfo.detailNormalMap.get(),
      index,
      normalMap.width === this._detailMapSize && normalMap.height === this._detailMapSize
        ? fetchSampler('clamp_nearest_nomip')
        : fetchSampler('clamp_linear_nomip')
    );
  }
  /** @internal */
  update(region: Vector4, terrainScale: Vector3) {
    if (!region.equalsTo(this._region) || !terrainScale.equalsTo(this._terrainScale)) {
      this._region.set(region);
      this._terrainScale.set(terrainScale);
      this.calculateNormalMap();
      this.uniformChanged();
    }
  }
  get heightMap() {
    return this._heightMap.get();
  }
  set heightMap(val: Texture2D) {
    if (val !== this._heightMap.get()) {
      this._heightMap.set(val);
      this.calculateNormalMap();
      this.uniformChanged();
    }
  }
  get normalMap() {
    return this._normalMap.get();
  }
  set normalMap(val: Texture2D) {
    if (val !== this._normalMap.get()) {
      this._normalMap.set(val);
      this.uniformChanged();
    }
  }
  needSceneColor(): boolean {
    return false;
  }
  needSceneDepth(): boolean {
    return false;
  }
  setClipmapMatrix(mat: Matrix4x4) {
    this._clipmapMatrix.set(mat);
    this.uniformChanged();
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return true;
  }
  /** @ts-ignore */
  getMetallicRoughnessTexCoord(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$inputs.uv;
  }
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
          const uv = pb.mul(this.$inputs.uv, scope.detailParams[i].x);
          const sample = pb.textureArraySample(this.detailAlbedoMap, uv, i).rgb;
          this.color = pb.add(this.color, pb.mul(sample, this[`mask${i >> 2}`][i & 2]));
        }
        this.$return(pb.vec4(this.color, 1));
      }
    });
    return pb.getGlobalScope()[funcName]();
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.clipmapMatrix = pb.mat4().uniform(2);
    scope.heightMap = pb.tex2D().uniform(2);
    scope.region = pb.vec4().uniform(2);
    scope.scaleY = pb.float().uniform(2);
    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    scope.$l.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz;
    scope.$outputs.uv = pb.div(
      pb.sub(scope.clipmapWorldPos.xz, scope.region.xy),
      pb.sub(scope.region.zw, scope.region.xy)
    );
    scope.$l.height = pb.textureSampleLevel(scope.heightMap, scope.$outputs.uv, 0).r;
    scope.$outputs.worldPos = pb.add(
      scope.clipmapWorldPos,
      pb.vec3(0, pb.mul(scope.height, scope.scaleY), 0)
    );
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
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
      scope.normalMap = pb.tex2D().uniform(2);
      scope.heightMap = pb.tex2D().uniform(2);
      const numDetailMaps = this.featureUsed<number>(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP);
      if (numDetailMaps > 0) {
        scope.detailParams = pb.vec4[numDetailMaps]().uniform(2);
        scope.splatMap = pb.tex2DArray().uniform(2);
        scope.detailAlbedoMap = pb.tex2DArray().uniform(2);
        scope.detailNormalMap = pb.tex2DArray().uniform(2);
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.heightMapTexelSize = pb.div(pb.vec2(1), pb.vec2(pb.textureDimensions(scope.heightMap, 0)));
      scope.$l.worldNormal = pb.sub(
        pb.mul(
          pb.textureSampleLevel(
            scope.normalMap,
            pb.sub(scope.$inputs.uv, pb.mul(scope.heightMapTexelSize, 0.5)),
            0
          ).rgb,
          2
        ),
        pb.vec3(1)
      );
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        pb.normalize(scope.worldNormal)
      );
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.$inputs.worldPos,
        scope.normalInfo.normal,
        scope.viewVec,
        scope.albedo,
        scope.normalInfo.TBN
      );
      scope.$l.outColor = pb.vec4(scope.litColor, 1);
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(1, 1, 1, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          pb.vec4(1),
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
    bindGroup.setValue('clipmapMatrix', this._clipmapMatrix);
    bindGroup.setValue('region', this._region);
    bindGroup.setValue('scaleY', this._terrainScale.y);
    bindGroup.setTexture('heightMap', this._heightMap.get(), fetchSampler('clamp_linear_nomip'));
    if (this.needFragmentColor(ctx)) {
      bindGroup.setTexture('normalMap', this._normalMap.get(), fetchSampler('clamp_linear_nomip'));
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
  createDetailMapInfo(): TerrainDetailMapInfo {
    const device = Application.instance.device;
    const detailMap = device.createTexture2DArray(
      'rgba8unorm-srgb',
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

  calculateNormalMap() {
    const device = Application.instance.device;
    if (!ClipmapTerrainMaterial._normalMapProgram) {
      ClipmapTerrainMaterial._normalMapProgram = device.buildRenderProgram({
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
      ClipmapTerrainMaterial._normalMapBindGroup = device.createBindGroup(
        ClipmapTerrainMaterial._normalMapProgram.bindGroupLayouts[0]
      );
    }
    const heightMap = this.heightMap;
    let normalMap = this.normalMap;
    if (!normalMap) {
      normalMap = device.createTexture2D('rgba8unorm', 2048, 2048);
      normalMap.name = 'TerrainNormal';
    }
    const fb = device.createFrameBuffer([normalMap], null);
    ClipmapTerrainMaterial._normalMapBindGroup.setValue(
      'texelSize',
      new Vector2(1 / heightMap.width, 1 / heightMap.height)
    );
    ClipmapTerrainMaterial._normalMapBindGroup.setValue('terrainScale', this.terrainScale);
    ClipmapTerrainMaterial._normalMapBindGroup.setTexture('heightMap', heightMap);
    device.pushDeviceStates();
    device.setFramebuffer(fb);
    device.setProgram(ClipmapTerrainMaterial._normalMapProgram);
    device.setBindGroup(0, ClipmapTerrainMaterial._normalMapBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
    fb.dispose();

    this.normalMap = normalMap;
  }
  dispose(): void {
    super.dispose();
    this._heightMap?.dispose();
    this._heightMap = null;
    this._normalMap?.dispose();
    this._normalMap = null;
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
