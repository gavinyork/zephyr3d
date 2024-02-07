import type { TextureFormat, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import { ShaderFramework } from '../shaders';
import { decodeNormalizedFloatFromRGBA, linearDepthToNonLinear, nonLinearDepthToLinearNormalized } from '../shaders/misc';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { ShadowMapper } from './shadowmapper';
import { Application } from '../app';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';
import { computeShadowMapDepth } from '../shaders/shadow';

/** @internal */
export class SSM extends ShadowImpl {
  static instance = new SSM();
  constructor() {
    super();
  }
  resourceDirty(): boolean {
    return false;
  }
  getType(): ShadowMode {
    return 'hard';
  }
  getShadowMapBorder(shadowMapParams: ShadowMapParams): number {
    return 0;
  }
  getShadowMap(shadowMapParams: ShadowMapParams): ShadowMapType {
    return (this.useNativeShadowMap(shadowMapParams)
      ? shadowMapParams.shadowMapFramebuffer.getDepthAttachment()
      : shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0]) as ShadowMapType;
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler = shadowMapParams.shadowMap?.getDefaultSampler(this.useNativeShadowMap(shadowMapParams)) || null;
  }
  postRenderShadowMap() {

  }
  releaseTemporalResources(shadowMapParams: ShadowMapParams) {
  }
  getDepthScale(): number {
    return 1;
  }
  setDepthScale(val: number) {

  }
  getShaderHash(): string {
    return '';
  }
  getShadowMapColorFormat(shadowMapParams: ShadowMapParams): TextureFormat {
    if (this.useNativeShadowMap(shadowMapParams)) {
      return null;
    } else {
      const device = Application.instance.device;
      if (device.type === 'webgl') {
        return device.getDeviceCaps().textureCaps.supportFloatColorBuffer
          ? 'rgba32f'
          : device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
            ? 'rgba16f'
            : 'rgba8unorm'
      } else {
        return 'r32f';
      }
    }
  }
  getShadowMapDepthFormat(shadowMapParams: ShadowMapParams): TextureFormat {
    return Application.instance.device.type === 'webgl'
      ? 'd24s8'
      : 'd32f';
  }
  computeShadowMapDepth(shadowMapParams: ShadowMapParams, scope: PBInsideFunctionScope): PBShaderExp {
    return computeShadowMapDepth(scope, shadowMapParams.shadowMap.format);
    /*
    if (this.useNativeShadowMap(shadowMapParams)) {
      return scope.$builder.vec4(
        scope.$builder.emulateDepthClamp
          ? scope.$builder.clamp(scope.$inputs.clamppedDepth, 0, 1)
          : scope.$builtins.fragCoord.z,
        0,
        0,
        1
      );
    } else {
      const pb = scope.$builder;
      let depth: PBShaderExp = null;
      if (shadowMapParams.lightType === LIGHT_TYPE_DIRECTIONAL) {
        depth = pb.emulateDepthClamp
          ? pb.clamp(scope.$inputs.clamppedDepth, 0, 1)
          : scope.$builtins.fragCoord.z;
      } else if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
        const lightSpacePos = pb.mul(
          ShaderFramework.getLightViewMatrixForShadow(scope),
          ShaderFramework.getWorldPosition(scope)
        );
        depth = pb.div(pb.length(lightSpacePos.xyz), ShaderFramework.getLightPositionAndRangeForShadow(scope).w);
      } else if (shadowMapParams.lightType === LIGHT_TYPE_SPOT) {
        const lightSpacePos = pb.mul(
          ShaderFramework.getLightViewMatrixForShadow(scope),
          ShaderFramework.getWorldPosition(scope)
        );
        depth = pb.min(pb.div(pb.neg(lightSpacePos.z), ShaderFramework.getLightPositionAndRangeForShadow(scope).w), 1);
      }
      return shadowMapParams.shadowMap.format === 'rgba8unorm'
        ? encodeNormalizedFloatToRGBA(scope, depth)
        : pb.vec4(depth, 0, 0, 1);
    }
    */
  }
  computeShadowCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp,
    split: PBShaderExp
  ): PBShaderExp {
    const funcNameComputeShadowCSM = 'lib_computeShadowCSM';
    const pb = scope.$builder;
    const that = this;
    pb.func(
      funcNameComputeShadowCSM,
      [pb.vec4('shadowVertex'), pb.float('NdotL'), pb.int('split')],
      function () {
        const floatDepthTexture = shadowMapParams.shadowMap.format !== 'rgba8unorm';
        this.$l.shadowCoord = pb.div(this.shadowVertex.xyz, this.shadowVertex.w);
        this.$l.shadowCoord = pb.add(pb.mul(this.shadowCoord.xyz, 0.5), 0.5);
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
        this.$if(this.inShadow, function () {
          this.$l.shadowBias = ShadowMapper.computeShadowBiasCSM(shadowMapParams, this, this.NdotL, this.split);
          this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
          if (that.useNativeShadowMap(shadowMapParams)) {
            if (shadowMapParams.shadowMap.isTexture2DArray()) {
              this.shadow = pb.textureArraySampleCompareLevel(
                this.shadowMap,
                this.shadowCoord.xy,
                this.split,
                this.shadowCoord.z
              );
            } else {
              this.shadow = pb.textureSampleCompareLevel(
                this.shadowMap,
                this.shadowCoord.xy,
                this.shadowCoord.z
              );
            }
          } else {
            if (shadowMapParams.shadowMap.isTexture2DArray()) {
              this.$l.shadowTex = pb.textureArraySampleLevel(
                this.shadowMap,
                this.shadowCoord.xy,
                this.split,
                0
              );
            } else {
              this.$l.shadowTex = pb.textureSampleLevel(this.shadowMap, this.shadowCoord.xy, 0);
            }
            if (!floatDepthTexture) {
              this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
            }
            this.shadow = pb.step(this.shadowCoord.z, this.shadowTex.x);
          }
        });
        this.$return(this.shadow);
      }
    );
    return pb.getGlobalScope()[funcNameComputeShadowCSM](shadowVertex, NdotL, split);
  }
  computeShadow(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp
  ): PBShaderExp {
    const funcNameComputeShadow = 'lib_computeShadow';
    const pb = scope.$builder;
    const that = this;
    pb.func(
      funcNameComputeShadow,
      [pb.vec4('shadowVertex'), pb.float('NdotL')],
      function () {
        const floatDepthTexture = shadowMapParams.shadowMap.format !== 'rgba8unorm';
        if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
          this.$l.dir = pb.sub(this.shadowVertex.xyz, ShaderFramework.getLightPositionAndRangeForShadow(this).xyz);
          if (that.useNativeShadowMap(shadowMapParams)) {
            this.$l.nearFar = ShaderFramework.getShadowCameraParams(this).xy;
            this.$l.maxZ = pb.max(
              pb.max(pb.abs(this.dir.x), pb.abs(this.dir.y)),
              pb.abs(this.dir.z)
            );
            this.$l.distance = linearDepthToNonLinear(this, this.maxZ, this.nearFar);
            this.$l.shadowBias = ShadowMapper.computeShadowBias(shadowMapParams, this, pb.div(this.maxZ, ShaderFramework.getLightPositionAndRangeForShadow(this).w), this.NdotL, true);
            this.$return(
              pb.textureSampleCompareLevel(
                this.shadowMap,
                this.dir,
                pb.sub(this.distance, this.shadowBias)
              )
            );
          } else {
            this.$l.distance = pb.div(pb.length(this.dir), ShaderFramework.getLightPositionAndRangeForShadow(this).w);
            this.$l.shadowBias = ShadowMapper.computeShadowBias(shadowMapParams, this, this.distance, this.NdotL, true);
            this.$l.shadowTex = pb.textureSampleLevel(this.shadowMap, this.dir, 0);
            if (!floatDepthTexture) {
              this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
            }
            this.distance = pb.sub(this.distance, this.shadowBias);
            this.$return(pb.step(this.distance, this.shadowTex.x));
          }
        } else {
          this.$l.shadowCoord = pb.div(this.shadowVertex.xyz, this.shadowVertex.w);
          this.$l.shadowCoord = pb.add(pb.mul(this.shadowCoord.xyz, 0.5), 0.5);
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
          this.$if(this.inShadow, function () {
            if (that.useNativeShadowMap(shadowMapParams)) {
              this.$l.shadowBias = ShadowMapper.computeShadowBias(shadowMapParams, this, this.shadowCoord.z, this.NdotL, false);
              this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
              this.shadow = pb.textureSampleCompareLevel(
                this.shadowMap,
                this.shadowCoord.xy,
                this.shadowCoord.z
              );
            } else {
              if (shadowMapParams.lightType === LIGHT_TYPE_SPOT) {
                this.$l.nearFar = ShaderFramework.getShadowCameraParams(this).xy;
                this.shadowCoord.z = nonLinearDepthToLinearNormalized(this, this.shadowCoord.z, this.nearFar);
                this.$l.shadowBias = ShadowMapper.computeShadowBias(shadowMapParams, this, this.shadowCoord.z, this.NdotL, true);
              } else {
                this.$l.shadowBias = ShadowMapper.computeShadowBias(shadowMapParams, this, this.shadowCoord.z, this.NdotL, false);
              }
              this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
              this.$l.shadowTex = pb.textureSampleLevel(this.shadowMap, this.shadowCoord.xy, 0);
              if (!floatDepthTexture) {
                this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
              }
              this.shadow = pb.step(this.shadowCoord.z, this.shadowTex.x);
            }
          });
          this.$return(this.shadow);
        }
      }
    );
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL);
  }
  useNativeShadowMap(shadowMapParams: ShadowMapParams): boolean {
    return Application.instance.device.type !== 'webgl';
  }
}
