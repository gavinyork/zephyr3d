import type { BindGroup, GPUProgram, PBFunctionScope, Texture2D, Texture2DArray } from '@zephyr3d/device';
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
  addDetailMap(albedoMap: Texture2D, normalMap: Texture2D, scale: number, roughness: number) {
    if (this._detailMapInfo.numDetailMaps === MAX_DETAIL_MAPS) {
      console.error('Max detail maps reached');
      return;
    }
    this._detailMapInfo.detailMapList.push(new DRef(albedoMap));
    this._detailMapInfo.detailNormalMapList.push(new DRef(normalMap ?? null));
    const blitter = new CopyBlitter();
    blitter.srgbOut = true;
    blitter.blit(
      albedoMap,
      this._detailMapInfo.detailMap.get(),
      this._detailMapInfo.numDetailMaps,
      albedoMap.width === this._detailMapSize && albedoMap.height === this._detailMapSize
        ? fetchSampler('clamp_nearest_nomip')
        : fetchSampler('clamp_linear_nomip')
    );
    if (normalMap) {
      blitter.srgbOut = false;
      blitter.blit(
        normalMap,
        this._detailMapInfo.detailNormalMap.get(),
        this._detailMapInfo.numDetailMaps,
        normalMap.width === this._detailMapSize && normalMap.height === this._detailMapSize
          ? fetchSampler('clamp_nearest_nomip')
          : fetchSampler('clamp_linear_nomip')
      );
    }
    this._detailMapInfo.detailMapParams[this._detailMapInfo.numDetailMaps * 4] = scale;
    this._detailMapInfo.detailMapParams[this._detailMapInfo.numDetailMaps * 4 + 1] = roughness;
    this._detailMapInfo.numDetailMaps++;
    this.useFeature(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP, true);
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
      if (this.featureUsed(ClipmapTerrainMaterial.FEATURE_DETAIL_MAP)) {
        scope.$l.albedo = pb.vec4(1);
      } else {
        scope.$l.checkerPos = pb.floor(pb.mul(scope.$inputs.uv, pb.sub(scope.region.zw, scope.region.xy)));
        scope.$l.checker = pb.mod(pb.add(scope.checkerPos.x, scope.checkerPos.y), 2);
        scope.$l.checkerColor = pb.mix(pb.vec3(0.4), pb.vec3(1), scope.checker);
        scope.$l.albedo = pb.vec4(scope.checkerColor, 1);
      }
      scope.$l.worldNormal = pb.sub(
        pb.mul(pb.textureSample(scope.normalMap, scope.$inputs.uv).rgb, 2),
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
      bindGroup.setTexture('normalMap', this._normalMap.get());
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
          pb.func('sobel', [pb.vec2('texCoord')], function () {
            this.$l.tl = pb.textureSample(this.heightMap, pb.sub(this.texCoord, this.texelSize)).r;
            this.$l.t = pb.textureSample(
              this.heightMap,
              pb.sub(this.texCoord, pb.vec2(0, this.texelSize.y))
            ).r;
            this.$l.tr = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(this.texelSize.x, pb.neg(this.texelSize.y)))
            ).r;
            this.$l.l = pb.textureSample(
              this.heightMap,
              pb.sub(this.texCoord, pb.vec2(this.texelSize.x, 0))
            ).r;
            this.$l.r = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(this.texelSize.x, 0))
            ).r;
            this.$l.bl = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(pb.neg(this.texelSize.x), this.texelSize.y))
            ).r;
            this.$l.b = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(0, this.texelSize.y))
            ).r;
            this.$l.br = pb.textureSample(this.heightMap, pb.add(this.texCoord, this.texelSize)).r;
            this.$l.dx = pb.sub(
              pb.add(this.tr, pb.mul(this.r, 2), this.br),
              pb.add(this.tl, pb.mul(this.l, 2), this.bl)
            );
            this.$l.dz = pb.sub(
              pb.add(this.bl, pb.mul(this.b, 2), this.br),
              pb.add(this.tl, pb.mul(this.t, 2), this.tr)
            );
            this.$return(pb.vec2(this.dx, this.dz));
          });
          pb.main(function () {
            this.$l.dxdz = this.sobel(this.$inputs.uv);
            this.$l.dhdxdz = pb.div(pb.mul(this.dxdz, this.terrainScale.y), this.terrainScale.xz);
            this.$l.normal = pb.normalize(pb.vec3(pb.neg(this.dhdxdz.x), 1, pb.neg(this.dhdxdz.y)));
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
      normalMap = device.createTexture2D('rgba8unorm', 1024, 1024);
      normalMap.name = 'TerrainNormal';
    }
    const fb = device.createFrameBuffer([normalMap], null);
    ClipmapTerrainMaterial._normalMapBindGroup.setValue(
      'texelSize',
      new Vector2(1 / heightMap.width / this._terrainScale.x, 1 / heightMap.height / this._terrainScale.z)
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
}
