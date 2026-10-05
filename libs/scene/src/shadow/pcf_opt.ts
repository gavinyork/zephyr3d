import type { PBInsideFunctionScope, PBShaderExp, TextureFormat, TextureSampler } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import {
  applyShadowDepthBias,
  computeShadowMapDepth,
  filterShadowPCF,
  ndcToShadowCoord,
  shadowCoordDepthInRange
} from '../shaders/shadow';
import type { ShadowMapParams, ShadowMapType } from './shadowmapper';
import { LIGHT_TYPE_POINT } from '../values';
import { ShaderHelper } from '../material/shader/helper';
import { computeShadowBias, computeShadowBiasCSM } from './shader';
import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';

/** @internal */
export class PCFOPT extends ShadowImpl {
  protected _kernelSize: number;
  protected _shadowSampler: Nullable<TextureSampler>;
  constructor(kernelSize?: number) {
    super();
    this._kernelSize = kernelSize ?? 5;
    this._shadowSampler = null;
  }
  get kernelSize() {
    return this._kernelSize;
  }
  set kernelSize(val) {
    val = val !== 3 && val !== 5 && val !== 7 ? 5 : val;
    this._kernelSize = val;
  }
  getType() {
    return 'pcf-opt' as const;
  }
  dispose() {
    this._shadowSampler = null;
  }
  resourceDirty() {
    return false;
  }
  getShadowMapBorder(_shadowMapParams: ShadowMapParams) {
    return this._kernelSize;
  }
  getParams(out?: Vector4) {
    return out ?? Vector4.zero();
  }
  getShadowMap(shadowMapParams: ShadowMapParams) {
    return shadowMapParams.shadowMapFramebuffer!.getDepthAttachment() as ShadowMapType;
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler = shadowMapParams.shadowMap?.getDefaultSampler(true) || null;
  }
  postRenderShadowMap() {}
  getDepthScale() {
    return 1;
  }
  setDepthScale(_val: number) {}
  getShaderHash() {
    return `${this._kernelSize}`;
  }
  getShadowMapColorFormat(_shadowMapParams: ShadowMapParams): Nullable<TextureFormat> {
    return null;
  }
  getShadowMapDepthFormat(_shadowMapParams: ShadowMapParams): TextureFormat {
    return this.preferredShadowMapDepthFormat();
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
        this.$l.shadowCoord = ndcToShadowCoord(this, this.shadowCoord);
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
            shadowCoordDepthInRange(this, this.shadowCoord.z)
          )
        );
        this.$l.shadow = pb.float(1);
        this.$if(this.inShadow, function () {
          this.$l.shadowBias = computeShadowBiasCSM(this, this.NdotL, this.split);
          this.shadowCoord.z = applyShadowDepthBias(this, this.shadowCoord.z, this.shadowBias, true);
          this.shadow = filterShadowPCF(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            that._kernelSize,
            this.shadowCoord,
            this.split
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
        this.$l.nearFar = ShaderHelper.getShadowCameraParams(this).xy;
        this.$l.maxZ = pb.max(pb.max(pb.abs(this.dir.x), pb.abs(this.dir.y)), pb.abs(this.dir.z));
        this.$l.distance = ShaderHelper.linearDepthToNonLinear(this, this.maxZ, this.nearFar);
        this.$l.shadowBias = computeShadowBias(
          shadowMapParams.lightType,
          this,
          pb.div(this.maxZ, ShaderHelper.getLightPositionAndRangeForShadow(this).w),
          this.NdotL,
          true
        );
        this.$return(that.sampleShadowMap(shadowMapParams, this, this.dir, this.distance, this.shadowBias));
      } else {
        this.$l.shadowCoord = pb.div(this.shadowVertex, this.shadowVertex.w);
        this.$l.shadowCoord = ndcToShadowCoord(this, this.shadowCoord);
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
            shadowCoordDepthInRange(this, this.shadowCoord.z)
          )
        );
        this.$l.shadow = pb.float(1);
        this.$if(this.inShadow, function () {
          this.$l.shadowBias = computeShadowBias(
            shadowMapParams.lightType,
            this,
            this.shadowCoord.z,
            this.NdotL,
            false
          );
          this.shadowCoord.z = applyShadowDepthBias(this, this.shadowCoord.z, this.shadowBias, true);
          this.shadow = filterShadowPCF(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            that._kernelSize,
            this.shadowCoord
          );
        });
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL) as PBShaderExp;
  }
  useNativeShadowMap(_shadowMapParams: ShadowMapParams) {
    return true;
  }
  /** @internal */
  sampleShadowMap(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    coords: PBShaderExp,
    z: PBShaderExp,
    bias: PBShaderExp
  ) {
    const funcNameSampleShadowMap = `lib_sampleShadowMapOPT`;
    const pb = scope.$builder;
    pb.func(funcNameSampleShadowMap, [pb.vec3('coords'), pb.float('z'), pb.float('bias')], function () {
      this.$return(
        pb.clamp(
          pb.textureSampleCompareLevel(
            ShaderHelper.getShadowMap(this),
            this.coords,
            applyShadowDepthBias(this, this.z, this.bias, true)
          ),
          0,
          1
        )
      );
    });
    return pb.getGlobalScope()[funcNameSampleShadowMap](coords, z, bias) as PBShaderExp;
  }
  /** @internal */
  sampleShadowMapCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    coords: PBShaderExp,
    split: PBShaderExp,
    z: PBShaderExp,
    bias: PBShaderExp
  ) {
    const funcNameSampleShadowMapCSM = 'lib_sampleShadowMapCSMOPT';
    const pb = scope.$builder;
    pb.func(
      funcNameSampleShadowMapCSM,
      [pb.vec4('coords'), pb.int('split'), pb.float('z'), pb.float('bias')],
      function () {
        this.$l.distance = applyShadowDepthBias(this, this.z, this.bias, true);
        if (shadowMapParams.shadowMap!.isTexture2DArray()) {
          this.$return(
            pb.clamp(
              pb.textureArraySampleCompareLevel(
                ShaderHelper.getShadowMap(this),
                this.coords.xy,
                this.split,
                this.distance
              ),
              0,
              1
            )
          );
        } else {
          this.$return(
            pb.clamp(
              pb.textureSampleCompareLevel(ShaderHelper.getShadowMap(this), this.coords.xy, this.distance),
              0,
              1
            )
          );
        }
      }
    );
    return pb.getGlobalScope()[funcNameSampleShadowMapCSM](coords, split, z, bias) as PBShaderExp;
  }
}
