import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { PBInsideFunctionScope, PBShaderExp, TextureFormat } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import type { ShadowMapParams, ShadowMapType } from './shadowmapper';
import { computeReceiverPlaneDepthBias, computeShadowMapDepth, filterShadowPCSS } from '../shaders/shadow';
import { decodeNormalizedFloatFromRGBA } from '../shaders/misc';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';
import { ShaderHelper } from '../material/shader/helper';
import { computeShadowBias, computeShadowBiasCSM } from './shader';
import { getDevice } from '../app/api';

/** @internal */
export class PCSS extends ShadowImpl {
  protected _lightRadius: number;
  protected _blockerSampleCount: number;
  protected _filterSampleCount: number;
  protected _maxFilterRadius: number;
  protected _temporalJitter: boolean;
  constructor(
    lightRadius?: number,
    blockerSampleCount?: number,
    filterSampleCount?: number,
    maxFilterRadius?: number,
    temporalJitter?: boolean
  ) {
    super();
    this._lightRadius = lightRadius ?? 8;
    this._blockerSampleCount = blockerSampleCount ?? 24;
    this._filterSampleCount = filterSampleCount ?? 32;
    this._maxFilterRadius = maxFilterRadius ?? 32;
    this._temporalJitter = temporalJitter ?? true;
  }
  get lightRadius() {
    return this._lightRadius;
  }
  set lightRadius(val) {
    this._lightRadius = Math.max(0, Number(val) || 0);
  }
  get blockerSampleCount() {
    return this._blockerSampleCount;
  }
  set blockerSampleCount(val) {
    this._blockerSampleCount = Math.min(Math.max(1, Number(val) >> 0), 64);
  }
  get filterSampleCount() {
    return this._filterSampleCount;
  }
  set filterSampleCount(val) {
    this._filterSampleCount = Math.min(Math.max(1, Number(val) >> 0), 64);
  }
  get maxFilterRadius() {
    return this._maxFilterRadius;
  }
  set maxFilterRadius(val) {
    this._maxFilterRadius = Math.max(1, Number(val) || 1);
  }
  get temporalJitter() {
    return this._temporalJitter;
  }
  set temporalJitter(val) {
    this._temporalJitter = !!val;
  }
  getType() {
    return 'pcss' as const;
  }
  dispose() {}
  resourceDirty() {
    return false;
  }
  getShadowMapBorder(_shadowMapParams: ShadowMapParams) {
    return this._lightRadius > 0 ? Math.ceil(Math.max(this._lightRadius, this._maxFilterRadius) + 2) : 0;
  }
  getShadowMapClearColor(_shadowMapParams: ShadowMapParams) {
    return new Vector4(1, 1, 1, 1);
  }
  getShadowMap(shadowMapParams: ShadowMapParams) {
    return shadowMapParams.shadowMapFramebuffer!.getColorAttachments()[0] as ShadowMapType;
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler = shadowMapParams.shadowMap?.getDefaultSampler(false) ?? null;
  }
  postRenderShadowMap() {}
  getDepthScale() {
    return 1;
  }
  setDepthScale(_val: number) {}
  getShaderHash() {
    return `${Number(this._temporalJitter)}`;
  }
  getShadowMapColorFormat(_shadowMapParams: ShadowMapParams): Nullable<TextureFormat> {
    const device = getDevice();
    if (device.type === 'webgl') {
      return device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
        ? 'rgba16f'
        : device.getDeviceCaps().textureCaps.supportFloatColorBuffer
          ? 'rgba32f'
          : 'rgba8unorm';
    }
    return device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
      ? 'r16f'
      : device.getDeviceCaps().textureCaps.supportFloatColorBuffer
        ? 'r32f'
        : 'rgba8unorm';
  }
  getParams(out: Vector4) {
    out.setXYZW(this._lightRadius, this._blockerSampleCount, this._filterSampleCount, this._maxFilterRadius);
  }
  getShadowMapDepthFormat(_shadowMapParams: ShadowMapParams): TextureFormat {
    return getDevice().type === 'webgl' ? 'd24s8' : 'd32f';
  }
  computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp
  ) {
    return computeShadowMapDepth(scope, worldPos, shadowMapParams.shadowMap!.format);
  }
  computeShadowCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp,
    split: PBShaderExp
  ) {
    const funcNameComputeShadowCSM = 'lib_computeShadowCSM';
    const pb = scope.$builder;
    const that = this;
    pb.func(
      funcNameComputeShadowCSM,
      [pb.vec4('shadowVertex'), pb.float('NdotL'), pb.int('split')],
      function () {
        this.$l.shadowCoord = pb.div(this.shadowVertex, this.shadowVertex.w);
        this.$l.shadowCoord = pb.add(pb.mul(this.shadowCoord, 0.5), 0.5);
        this.$l.inShadow = pb.all(
          pb.bvec2(
            pb.all(
              pb.bvec4(
                pb.greaterThanEqual(this.shadowCoord.x, 0),
                pb.lessThanEqual(this.shadowCoord.x, 1),
                pb.greaterThanEqual(this.shadowCoord.y, 0),
                pb.lessThanEqual(this.shadowCoord.y, 1)
              )
            ),
            pb.lessThanEqual(this.shadowCoord.z, 1)
          )
        );
        this.$l.shadow = pb.float(1);
        this.$l.receiverPlaneDepthBias = computeReceiverPlaneDepthBias(this, this.shadowCoord);
        this.$if(this.inShadow, function () {
          this.$l.shadowBias = computeShadowBiasCSM(this, this.NdotL, this.split);
          this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
          this.shadow = filterShadowPCSS(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            this.shadowCoord,
            this.receiverPlaneDepthBias,
            this.split,
            that._temporalJitter,
            shadowMapParams.numShadowCascades
          );
        });
        this.$return(this.shadow);
      }
    );
    return pb.getGlobalScope()[funcNameComputeShadowCSM](shadowVertex, NdotL, split) as PBShaderExp;
  }
  computeShadow(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp
  ) {
    const funcNameComputeShadow = 'lib_computeShadow';
    const pb = scope.$builder;
    const that = this;
    pb.func(funcNameComputeShadow, [pb.vec4('shadowVertex'), pb.float('NdotL')], function () {
      if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
        this.$l.dir = pb.sub(this.shadowVertex.xyz, ShaderHelper.getLightPositionAndRangeForShadow(this).xyz);
        this.$l.distance = pb.div(
          pb.length(this.dir),
          ShaderHelper.getLightPositionAndRangeForShadow(this).w
        );
        this.$l.shadowBias = computeShadowBias(
          shadowMapParams.lightType,
          this,
          this.distance,
          this.NdotL,
          true
        );
        this.$l.shadowCoord = pb.vec4(this.dir, pb.sub(this.distance, this.shadowBias));
        this.$return(
          filterShadowPCSS(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            this.shadowCoord,
            undefined,
            undefined,
            that._temporalJitter
          )
        );
      }
      this.$l.shadowCoord = pb.div(this.shadowVertex, this.shadowVertex.w);
      this.$l.shadowCoord = pb.add(pb.mul(this.shadowCoord, 0.5), 0.5);
      this.$l.inShadow = pb.all(
        pb.bvec2(
          pb.all(
            pb.bvec4(
              pb.greaterThanEqual(this.shadowCoord.x, 0),
              pb.lessThanEqual(this.shadowCoord.x, 1),
              pb.greaterThanEqual(this.shadowCoord.y, 0),
              pb.lessThanEqual(this.shadowCoord.y, 1)
            )
          ),
          pb.lessThanEqual(this.shadowCoord.z, 1)
        )
      );
      this.$l.shadow = pb.float(1);
      if (shadowMapParams.lightType === LIGHT_TYPE_SPOT) {
        this.$l.nearFar = ShaderHelper.getShadowCameraParams(this).xy;
        this.shadowCoord.z = ShaderHelper.nonLinearDepthToLinearNormalized(
          this,
          this.shadowCoord.z,
          this.nearFar
        );
      }
      this.$l.receiverPlaneDepthBias = computeReceiverPlaneDepthBias(this, this.shadowCoord);
      this.$if(this.inShadow, function () {
        if (shadowMapParams.lightType === LIGHT_TYPE_SPOT) {
          this.$l.shadowBias = computeShadowBias(
            shadowMapParams.lightType,
            this,
            this.shadowCoord.z,
            this.NdotL,
            true
          );
        } else {
          this.$l.shadowBias = computeShadowBias(
            shadowMapParams.lightType,
            this,
            this.shadowCoord.z,
            this.NdotL,
            false
          );
        }
        this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
        this.shadow = filterShadowPCSS(
          this,
          shadowMapParams.lightType,
          shadowMapParams.shadowMap!.format,
          this.shadowCoord,
          this.receiverPlaneDepthBias,
          undefined,
          that._temporalJitter
        );
      });
      this.$return(this.shadow);
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL) as PBShaderExp;
  }
  useNativeShadowMap(_shadowMapParams: ShadowMapParams) {
    return false;
  }
  /** @internal */
  samplePointShadowMap(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    coords: PBShaderExp,
    z: PBShaderExp,
    bias: PBShaderExp
  ) {
    const funcNameSampleShadowMap = 'lib_samplePointShadowMapPCSS';
    const pb = scope.$builder;
    pb.func(funcNameSampleShadowMap, [pb.vec3('coords'), pb.float('z'), pb.float('bias')], function () {
      const floatDepthTexture = shadowMapParams.shadowMap!.format !== 'rgba8unorm';
      this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.coords, 0);
      if (!floatDepthTexture) {
        this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
      }
      this.$l.distance = pb.sub(this.z, this.bias);
      this.$return(pb.step(this.distance, this.shadowTex.x));
    });
    return pb.getGlobalScope()[funcNameSampleShadowMap](coords, z, bias) as PBShaderExp;
  }
}
