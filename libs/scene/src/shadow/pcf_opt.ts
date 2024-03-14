import type { PBInsideFunctionScope, PBShaderExp, TextureFormat, TextureSampler } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import { decodeNormalizedFloatFromRGBA } from '../shaders/misc';
import { computeShadowMapDepth, computeReceiverPlaneDepthBias, filterShadowPCF } from '../shaders/shadow';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { ShadowMapper } from './shadowmapper';
import { Application } from '../app';
import { LIGHT_TYPE_POINT } from '../values';
import { ShaderHelper } from '../material/shader/helper';

/** @internal */
export class PCFOPT extends ShadowImpl {
  protected _kernelSize: number;
  protected _shadowSampler: TextureSampler;
  constructor(kernelSize?: number) {
    super();
    this._kernelSize = kernelSize ?? 5;
    this._shadowSampler = null;
  }
  get kernelSize(): number {
    return this._kernelSize;
  }
  set kernelSize(val: number) {
    val = val !== 3 && val !== 5 && val !== 7 ? 5 : val;
    this._kernelSize = val;
  }
  getType(): ShadowMode {
    return 'pcf-opt';
  }
  dispose(): void {
    this._shadowSampler = null;
  }
  resourceDirty(): boolean {
    return false;
  }
  getShadowMapBorder(shadowMapParams: ShadowMapParams): number {
    return this._kernelSize;
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
  releaseTemporalResources(shadowMapParams: ShadowMapParams) {}
  getDepthScale(): number {
    return 1;
  }
  setDepthScale(val: number) {}
  getShaderHash(): string {
    return `${this._kernelSize}`;
  }
  getShadowMapColorFormat(shadowMapParams: ShadowMapParams): TextureFormat {
    return this.useNativeShadowMap(shadowMapParams) ? null : 'rgba8unorm';
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
          this.$l.shadowBias = ShadowMapper.computeShadowBiasCSM(
            shadowMapParams,
            this,
            this.NdotL,
            this.split
          );
          this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
          this.shadow = filterShadowPCF(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap.format,
            that._kernelSize,
            this.shadowCoord,
            this.receiverPlaneDepthBias,
            this.split
          );
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
      if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
        this.$l.dir = pb.sub(this.shadowVertex.xyz, ShaderHelper.getLightPositionAndRangeForShadow(this).xyz);
        if (that.useNativeShadowMap(shadowMapParams)) {
          this.$l.nearFar = ShaderHelper.getShadowCameraParams(this).xy;
          this.$l.maxZ = pb.max(pb.max(pb.abs(this.dir.x), pb.abs(this.dir.y)), pb.abs(this.dir.z));
          this.$l.distance = ShaderHelper.linearDepthToNonLinear(this, this.maxZ, this.nearFar);
          this.$l.shadowBias = ShadowMapper.computeShadowBias(
            shadowMapParams,
            this,
            pb.div(this.maxZ, ShaderHelper.getLightPositionAndRangeForShadow(this).w),
            this.NdotL,
            true
          );
          this.$return(that.sampleShadowMap(shadowMapParams, this, this.dir, this.distance, this.shadowBias));
        } else {
          this.$l.distance = pb.div(
            pb.length(this.dir),
            ShaderHelper.getLightPositionAndRangeForShadow(this).w
          );
          this.$l.shadowBias = ShadowMapper.computeShadowBias(
            shadowMapParams,
            this,
            this.distance,
            this.NdotL,
            true
          );
          this.$return(that.sampleShadowMap(shadowMapParams, this, this.dir, this.distance, this.shadowBias));
        }
      } else {
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
          this.$l.shadowBias = ShadowMapper.computeShadowBias(
            shadowMapParams,
            this,
            this.shadowCoord.z,
            this.NdotL,
            false
          );
          this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
          this.shadow = filterShadowPCF(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap.format,
            that._kernelSize,
            this.shadowCoord,
            this.receiverPlaneDepthBias
          );
        });
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL);
  }
  useNativeShadowMap(shadowMapParams: ShadowMapParams): boolean {
    return Application.instance.device.type !== 'webgl';
  }
  /** @internal */
  sampleShadowMap(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    coords: PBShaderExp,
    z: PBShaderExp,
    bias: PBShaderExp
  ): PBShaderExp {
    const funcNameSampleShadowMap = `lib_sampleShadowMap`;
    const pb = scope.$builder;
    const that = this;
    pb.func(funcNameSampleShadowMap, [pb.vec3('coords'), pb.float('z'), pb.float('bias')], function () {
      const floatDepthTexture = shadowMapParams.shadowMap.format !== 'rgba8unorm';
      if (that.useNativeShadowMap(shadowMapParams)) {
        this.$return(
          pb.clamp(
            pb.textureSampleCompareLevel(
              ShaderHelper.getShadowMap(this),
              this.coords,
              pb.sub(this.z, this.bias)
            ),
            0,
            1
          )
        );
      } else {
        this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.coords, 0);
        if (!floatDepthTexture) {
          this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
        }
        this.$l.distance = pb.sub(this.z, this.bias);
        this.$return(pb.step(this.distance, this.shadowTex.x));
      }
    });
    return pb.getGlobalScope()[funcNameSampleShadowMap](coords, z, bias);
  }
  /** @internal */
  sampleShadowMapCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    coords: PBShaderExp,
    split: PBShaderExp,
    z: PBShaderExp,
    bias: PBShaderExp
  ): PBShaderExp {
    const funcNameSampleShadowMapCSM = 'lib_sampleShadowMapCSM';
    const pb = scope.$builder;
    const that = this;
    pb.func(
      funcNameSampleShadowMapCSM,
      [pb.vec4('coords'), pb.int('split'), pb.float('z'), pb.float('bias')],
      function () {
        const floatDepthTexture = shadowMapParams.shadowMap.format !== 'rgba8unorm';
        this.$l.distance = pb.sub(this.z, this.bias);
        if (that.useNativeShadowMap(shadowMapParams)) {
          if (shadowMapParams.shadowMap.isTexture2DArray()) {
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
        } else {
          if (shadowMapParams.shadowMap.isTexture2DArray()) {
            this.$l.shadowTex = pb.textureArraySampleLevel(
              ShaderHelper.getShadowMap(this),
              this.coords.xy,
              this.split,
              0
            );
          } else {
            this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.coords.xy, 0);
          }
          if (!floatDepthTexture) {
            this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
          }
          this.$return(pb.step(this.distance, this.shadowTex.x));
        }
      }
    );
    return pb.getGlobalScope()[funcNameSampleShadowMapCSM](coords, split, z, bias);
  }
}
