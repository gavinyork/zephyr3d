import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import type { ShadowMapParams, ShadowMapType } from './shadowmapper';
import { LIGHT_TYPE_POINT } from '../values';
import {
  applyShadowDepthBias,
  computeShadowMapDepth,
  ndcToShadowCoord3,
  shadowCoordDepthInRange
} from '../shaders/shadow';
import { ShaderHelper } from '../material/shader/helper';
import { computeShadowBias, computeShadowBiasCSM } from './shader';
import { Vector4 } from '@zephyr3d/base';

/** @internal */
export class SSM extends ShadowImpl {
  static instance = new SSM();
  constructor() {
    super();
  }
  resourceDirty() {
    return false;
  }
  getType() {
    return 'hard' as const;
  }
  getShadowMapBorder(_shadowMapParams: ShadowMapParams) {
    return 0;
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
    return '';
  }
  getShadowMapColorFormat(_shadowMapParams: ShadowMapParams) {
    return null;
  }
  getShadowMapDepthFormat(_shadowMapParams: ShadowMapParams) {
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
    pb.func(
      funcNameComputeShadowCSM,
      [pb.vec4('shadowVertex'), pb.float('NdotL'), pb.int('split')],
      function () {
        this.$l.shadowCoord = pb.div(this.shadowVertex.xyz, this.shadowVertex.w);
        this.$l.shadowCoord = ndcToShadowCoord3(this, this.shadowCoord.xyz);
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
          if (shadowMapParams.shadowMap!.isTexture2DArray()) {
            this.shadow = pb.textureArraySampleCompareLevel(
              ShaderHelper.getShadowMap(this),
              this.shadowCoord.xy,
              this.split,
              this.shadowCoord.z
            );
          } else {
            this.shadow = pb.textureSampleCompareLevel(
              ShaderHelper.getShadowMap(this),
              this.shadowCoord.xy,
              this.shadowCoord.z
            );
          }
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
        this.$return(
          pb.textureSampleCompareLevel(
            ShaderHelper.getShadowMap(this),
            this.dir,
            applyShadowDepthBias(this, this.distance, this.shadowBias, true)
          )
        );
      } else {
        this.$l.shadowCoord = pb.div(this.shadowVertex.xyz, this.shadowVertex.w);
        this.$l.shadowCoord = ndcToShadowCoord3(this, this.shadowCoord.xyz);
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
          this.shadow = pb.textureSampleCompareLevel(
            ShaderHelper.getShadowMap(this),
            this.shadowCoord.xy,
            this.shadowCoord.z
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
}
