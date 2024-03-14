import type { FrameBuffer, TextureFormat, PBShaderExp, PBInsideFunctionScope } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import type { BlitType } from '../blitter';
import { GaussianBlurBlitter } from '../blitter';
import { computeShadowMapDepth, filterShadowESM } from '../shaders/shadow';
import { decodeNormalizedFloatFromRGBA, encodeNormalizedFloatToRGBA } from '../shaders/misc';
import { Application } from '../app';
import { TemporalCache } from '../render';
import { LIGHT_TYPE_POINT } from '../values';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { ShaderHelper } from '../material/shader/helper';

type ESMImplData = {
  blurFramebuffer: FrameBuffer;
  blurFramebuffer2: FrameBuffer;
};

class BlurBlitter extends GaussianBlurBlitter {
  protected _packFloat: boolean;
  get packFloat(): boolean {
    return this._packFloat;
  }
  set packFloat(b: boolean) {
    if (this._packFloat !== !!b) {
      this._packFloat = !!b;
      this.invalidateHash();
    }
  }
  readTexel(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    const pb = scope.$builder;
    const texel = super.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    if (this.packFloat) {
      return pb.vec4(decodeNormalizedFloatFromRGBA(scope, texel), 0, 0, 1);
    } else {
      return texel;
    }
  }
  writeTexel(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcUV: PBShaderExp,
    texel: PBShaderExp
  ): PBShaderExp {
    const outTexel = super.writeTexel(scope, type, srcUV, texel);
    if (this.packFloat) {
      return encodeNormalizedFloatToRGBA(scope, outTexel.r);
    } else {
      return outTexel;
    }
  }
  protected calcHash(): string {
    return `${super.calcHash()}-${Number(this.packFloat)}`;
  }
}

/** @internal */
export class ESM extends ShadowImpl {
  /** @internal */
  protected _depthScale: number;
  /** @internal */
  protected _blur: boolean;
  /** @internal */
  protected _kernelSize: number;
  /** @internal */
  protected _blurSize: number;
  /** @internal */
  protected _logSpace: boolean;
  /** @internal */
  protected _blitterH: BlurBlitter;
  /** @internal */
  protected _blitterV: BlurBlitter;
  /** @internal */
  protected _mipmap: boolean;
  constructor(kernelSize?: number, blurSize?: number, depthScale?: number) {
    super();
    this._blur = true;
    this._depthScale = depthScale ?? 500;
    this._kernelSize = kernelSize ?? 5;
    this._blurSize = blurSize ?? 1;
    this._logSpace = true;
    this._mipmap = true;
    this._blitterH = new BlurBlitter('horizonal', this._kernelSize, 4, 1 / 1024);
    this._blitterV = new BlurBlitter('vertical', this._kernelSize, 4, 1 / 1024);
  }
  resourceDirty(): boolean {
    return this._resourceDirty;
  }
  get blur(): boolean {
    return this._blur;
  }
  set blur(val: boolean) {
    if (this._blur !== !!val) {
      this._blur = !!val;
      this._resourceDirty = true;
    }
  }
  get mipmap(): boolean {
    return this._mipmap;
  }
  set mipmap(b: boolean) {
    if (this._mipmap !== !!b) {
      this._mipmap = !!b;
      if (this._blur) {
        this._resourceDirty = true;
      }
    }
  }
  get kernelSize(): number {
    return this._kernelSize;
  }
  set kernelSize(val: number) {
    this._kernelSize = val;
  }
  get blurSize(): number {
    return this._blurSize;
  }
  set blurSize(val: number) {
    this._blurSize = val;
  }
  get logSpace(): boolean {
    return this._logSpace;
  }
  set logSpace(val: boolean) {
    this._logSpace = !!val;
  }
  getType(): ShadowMode {
    return 'esm';
  }
  getShadowMapBorder(shadowMapParams: ShadowMapParams): number {
    return this._blur ? Math.ceil(((this._kernelSize + 1) / 2) * this._blurSize) : 0;
  }
  getShadowMap(shadowMapParams: ShadowMapParams): ShadowMapType {
    const implData = shadowMapParams.implData as ESMImplData;
    return (
      implData
        ? implData.blurFramebuffer2.getColorAttachments()[0]
        : shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0]
    ) as ShadowMapType;
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    const implData: ESMImplData = {
      blurFramebuffer: null,
      blurFramebuffer2: null
    };
    shadowMapParams.implData = implData;
    const colorFormat = this.getShadowMapColorFormat(shadowMapParams);
    const target = shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0].target;
    const shadowMapWidth = shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0].width;
    const shadowMapHeight = shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0].height;
    if (this._blur) {
      shadowMapParams.implData = {
        blurFramebuffer: TemporalCache.getFramebufferFixedSize(
          shadowMapWidth,
          shadowMapHeight,
          shadowMapParams.numShadowCascades,
          colorFormat,
          null,
          target,
          null,
          false
        ),
        blurFramebuffer2: TemporalCache.getFramebufferFixedSize(
          shadowMapWidth,
          shadowMapHeight,
          shadowMapParams.numShadowCascades,
          colorFormat,
          null,
          target,
          null,
          this._mipmap
        )
      };
    }
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler = shadowMapParams.shadowMap?.getDefaultSampler(false) ?? null;
  }
  postRenderShadowMap(shadowMapParams: ShadowMapParams) {
    if (shadowMapParams.implData) {
      const implData = shadowMapParams.implData as ESMImplData;
      const colorAttachment = shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0];
      this._blitterH.blurSize = this._blurSize / colorAttachment.width;
      this._blitterH.kernelSize = this._kernelSize;
      this._blitterH.logSpace = this._logSpace;
      this._blitterH.packFloat = colorAttachment.format === 'rgba8unorm';
      this._blitterV.blurSize = this._blurSize / colorAttachment.height;
      this._blitterV.kernelSize = this._kernelSize;
      this._blitterV.logSpace = this._logSpace;
      this._blitterV.packFloat = colorAttachment.format === 'rgba8unorm';
      this._blitterH.blit(colorAttachment as any, implData.blurFramebuffer);
      this._blitterV.blit(
        implData.blurFramebuffer.getColorAttachments()[0] as any,
        implData.blurFramebuffer2
      );
    }
  }
  releaseTemporalResources(shadowMapParams: ShadowMapParams) {
    const implData = shadowMapParams.implData as ESMImplData;
    if (implData) {
      TemporalCache.releaseFramebuffer(implData.blurFramebuffer);
      TemporalCache.releaseFramebuffer(implData.blurFramebuffer2);
    }
  }
  getDepthScale(): number {
    return this._depthScale;
  }
  setDepthScale(val: number) {
    this._depthScale = val;
  }
  getShaderHash(): string {
    return '';
  }
  getShadowMapColorFormat(shadowMapParams: ShadowMapParams): TextureFormat {
    const device = Application.instance.device;
    return device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
      ? device.type === 'webgl'
        ? 'rgba16f'
        : 'r16f'
      : device.getDeviceCaps().textureCaps.supportFloatColorBuffer
      ? device.type === 'webgl'
        ? 'rgba32f'
        : 'r32f'
      : 'rgba8unorm';
  }
  getShadowMapDepthFormat(shadowMapParams: ShadowMapParams): TextureFormat {
    return 'd24s8';
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
        this.$if(this.inShadow, function () {
          this.shadow = filterShadowESM(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap.format,
            this.shadowCoord,
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
    pb.func(funcNameComputeShadow, [pb.vec4('shadowVertex'), pb.float('NdotL')], function () {
      if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
        this.$l.dir = pb.sub(this.shadowVertex.xyz, ShaderHelper.getLightPositionAndRangeForShadow(this).xyz);
        this.$return(filterShadowESM(this, LIGHT_TYPE_POINT, shadowMapParams.shadowMap.format, this.dir));
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
        this.$if(this.inShadow, function () {
          this.shadow = filterShadowESM(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap.format,
            this.shadowCoord
          );
        });
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL);
  }
  useNativeShadowMap(shadowMapParams: ShadowMapParams): boolean {
    return false;
  }
}
