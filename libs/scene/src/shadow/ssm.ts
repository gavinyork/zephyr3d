import type { TextureFormat, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import { decodeNormalizedFloatFromRGBA } from '../shaders/misc';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { Application } from '../app';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';
import { computeShadowMapDepth } from '../shaders/shadow';
import { ShaderHelper } from '../material/shader/helper';
import { computeShadowBias, computeShadowBiasCSM } from './shader';

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
    return (
      this.useNativeShadowMap(shadowMapParams)
        ? shadowMapParams.shadowMapFramebuffer.getDepthAttachment()
        : shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0]
    ) as ShadowMapType;
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler =
      shadowMapParams.shadowMap?.getDefaultSampler(this.useNativeShadowMap(shadowMapParams)) || null;
  }
  postRenderShadowMap() {}
  getDepthScale(): number {
    return 1;
  }
  setDepthScale(val: number) {}
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
          : 'rgba8unorm';
      } else {
        return 'r32f';
      }
    }
  }
  getShadowMapDepthFormat(shadowMapParams: ShadowMapParams): TextureFormat {
    return Application.instance.device.type === 'webgl' ? 'd24s8' : 'd32f';
  }
  computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp
  ): PBShaderExp {
    return computeShadowMapDepth(scope, worldPos, shadowMapParams.shadowMap.format);
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
          this.$l.shadowBias = computeShadowBiasCSM(this, this.NdotL, this.split);
          this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
          if (that.useNativeShadowMap(shadowMapParams)) {
            if (shadowMapParams.shadowMap.isTexture2DArray()) {
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
          } else {
            if (shadowMapParams.shadowMap.isTexture2DArray()) {
              this.$l.shadowTex = pb.textureArraySampleLevel(
                ShaderHelper.getShadowMap(this),
                this.shadowCoord.xy,
                this.split,
                0
              );
            } else {
              this.$l.shadowTex = pb.textureSampleLevel(
                ShaderHelper.getShadowMap(this),
                this.shadowCoord.xy,
                0
              );
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
    pb.func(funcNameComputeShadow, [pb.vec4('shadowVertex'), pb.float('NdotL')], function () {
      const floatDepthTexture = shadowMapParams.shadowMap.format !== 'rgba8unorm';
      if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
        this.$l.dir = pb.sub(this.shadowVertex.xyz, ShaderHelper.getLightPositionAndRangeForShadow(this).xyz);
        if (that.useNativeShadowMap(shadowMapParams)) {
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
              pb.sub(this.distance, this.shadowBias)
            )
          );
        } else {
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
          this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.dir, 0);
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
            this.$l.shadowBias = computeShadowBias(
              shadowMapParams.lightType,
              this,
              this.shadowCoord.z,
              this.NdotL,
              false
            );
            this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
            this.shadow = pb.textureSampleCompareLevel(
              ShaderHelper.getShadowMap(this),
              this.shadowCoord.xy,
              this.shadowCoord.z
            );
          } else {
            if (shadowMapParams.lightType === LIGHT_TYPE_SPOT) {
              this.$l.nearFar = ShaderHelper.getShadowCameraParams(this).xy;
              this.shadowCoord.z = ShaderHelper.nonLinearDepthToLinearNormalized(
                this,
                this.shadowCoord.z,
                this.nearFar
              );
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
            this.$l.shadowTex = pb.textureSampleLevel(
              ShaderHelper.getShadowMap(this),
              this.shadowCoord.xy,
              0
            );
            if (!floatDepthTexture) {
              this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
            }
            this.shadow = pb.step(this.shadowCoord.z, this.shadowTex.x);
          }
        });
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL);
  }
  useNativeShadowMap(shadowMapParams: ShadowMapParams): boolean {
    return Application.instance.device.type !== 'webgl';
  }
}
