import type { FrameBuffer, TextureFormat, PBShaderExp, PBInsideFunctionScope } from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import type { BlitType } from '../blitter';
import { GaussianBlurBlitter } from '../blitter';
import { computeShadowMapDepth, filterShadowESM } from '../shaders/shadow';
import { decodeNormalizedFloatFromRGBA, encodeNormalizedFloatToRGBA } from '../shaders/misc';
import { LIGHT_TYPE_POINT } from '../values';
import type { ShadowMapParams, ShadowMapType } from './shadowmapper';
import { ShaderHelper } from '../material/shader/helper';
import { getDevice } from '../app/api';
import { Vector4, type Nullable } from '@zephyr3d/base';
import { computeShadowBias, computeShadowBiasCSM } from './shader';

type ESMImplData = {
  blurFramebuffer: Nullable<FrameBuffer>;
  blurFramebuffer2: Nullable<FrameBuffer>;
};

class BlurBlitter extends GaussianBlurBlitter {
  protected _packFloat = false;
  get packFloat() {
    return this._packFloat;
  }
  set packFloat(b) {
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
  ) {
    const pb = scope.$builder;
    const texel = super.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    if (this.packFloat) {
      return pb.vec4(decodeNormalizedFloatFromRGBA(scope, texel), 1, 0, 1);
    } else {
      return texel;
    }
  }
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ) {
    const that = this;
    const pb = scope.$builder;
    scope.incrementalGaussian = pb.vec3();
    scope.incrementalGaussian.x = pb.div(1, pb.mul(scope.sigma, Math.sqrt(2 * Math.PI)));
    scope.incrementalGaussian.y = pb.exp(pb.div(-0.5, pb.mul(scope.sigma, scope.sigma)));
    scope.incrementalGaussian.z = pb.mul(scope.incrementalGaussian.y, scope.incrementalGaussian.y);
    scope.coefficientSum = pb.float(0);
    scope.coverageSum = pb.float(0);
    scope.d0 = that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    scope.coverage0 = pb.clamp(scope.d0.y, 0, 1);
    scope.coefficientSum = pb.add(scope.coefficientSum, scope.incrementalGaussian.x);
    scope.coverageSum = pb.add(scope.coverageSum, pb.mul(scope.incrementalGaussian.x, scope.coverage0));

    if (that.logSpace) {
      scope.maxLogValue = pb.float(-1e20);
      scope.logValue0 = that._phase === 'horizonal' ? pb.mul(scope.d0.x, scope.multiplier) : scope.d0.x;
      scope.$if(pb.greaterThan(scope.coverage0, 0.000001), function () {
        this.maxLogValue = this.logValue0;
      });
    } else {
      scope.depthSum = pb.mul(scope.incrementalGaussian.x, scope.coverage0, scope.d0.x);
    }

    scope.incrementalGaussian = pb.vec3(
      pb.mul(scope.incrementalGaussian.xy, scope.incrementalGaussian.yz),
      scope.incrementalGaussian.z
    );
    scope.$for(pb.float('i'), 1, scope.numBlurPixelsPerSide, function () {
      this.$l.blurOffset = pb.mul(this.blurMultiplyVec, this.blurSize, this.i);
      this.$l.d1 = that.readTexel(scope, type, srcTex, pb.sub(srcUV, this.blurOffset), srcLayer, sampleType);
      this.$l.d2 = that.readTexel(scope, type, srcTex, pb.add(srcUV, this.blurOffset), srcLayer, sampleType);
      this.$l.coverage1 = pb.clamp(this.d1.y, 0, 1);
      this.$l.coverage2 = pb.clamp(this.d2.y, 0, 1);
      this.coefficientSum = pb.add(this.coefficientSum, pb.mul(this.incrementalGaussian.x, 2));
      this.coverageSum = pb.add(
        this.coverageSum,
        pb.mul(this.incrementalGaussian.x, pb.add(this.coverage1, this.coverage2))
      );
      if (that.logSpace) {
        this.$l.logValue1 = that._phase === 'horizonal' ? pb.mul(this.d1.x, this.multiplier) : this.d1.x;
        this.$l.logValue2 = that._phase === 'horizonal' ? pb.mul(this.d2.x, this.multiplier) : this.d2.x;
        this.$if(pb.greaterThan(this.coverage1, 0.000001), function () {
          this.maxLogValue = pb.max(this.maxLogValue, this.logValue1);
        });
        this.$if(pb.greaterThan(this.coverage2, 0.000001), function () {
          this.maxLogValue = pb.max(this.maxLogValue, this.logValue2);
        });
      } else {
        this.depthSum = pb.add(
          this.depthSum,
          pb.mul(
            this.incrementalGaussian.x,
            pb.add(pb.mul(this.coverage1, this.d1.x), pb.mul(this.coverage2, this.d2.x))
          )
        );
      }
      this.incrementalGaussian = pb.vec3(
        pb.mul(this.incrementalGaussian.xy, this.incrementalGaussian.yz),
        this.incrementalGaussian.z
      );
    });

    if (that.logSpace) {
      scope.incrementalGaussian.x = pb.div(1, pb.mul(scope.sigma, Math.sqrt(2 * Math.PI)));
      scope.incrementalGaussian.y = pb.exp(pb.div(-0.5, pb.mul(scope.sigma, scope.sigma)));
      scope.incrementalGaussian.z = pb.mul(scope.incrementalGaussian.y, scope.incrementalGaussian.y);
      scope.momentSum = pb.float(0);
      scope.$if(pb.greaterThan(scope.coverage0, 0.000001), function () {
        this.momentSum = pb.add(
          this.momentSum,
          pb.mul(
            this.incrementalGaussian.x,
            this.coverage0,
            pb.exp(pb.min(87, pb.sub(this.logValue0, this.maxLogValue)))
          )
        );
      });
      scope.incrementalGaussian = pb.vec3(
        pb.mul(scope.incrementalGaussian.xy, scope.incrementalGaussian.yz),
        scope.incrementalGaussian.z
      );
      scope.$for(pb.float('i'), 1, scope.numBlurPixelsPerSide, function () {
        this.$l.blurOffset = pb.mul(this.blurMultiplyVec, this.blurSize, this.i);
        this.$l.d1 = that.readTexel(
          scope,
          type,
          srcTex,
          pb.sub(srcUV, this.blurOffset),
          srcLayer,
          sampleType
        );
        this.$l.d2 = that.readTexel(
          scope,
          type,
          srcTex,
          pb.add(srcUV, this.blurOffset),
          srcLayer,
          sampleType
        );
        this.$l.coverage1 = pb.clamp(this.d1.y, 0, 1);
        this.$l.coverage2 = pb.clamp(this.d2.y, 0, 1);
        this.$l.logValue1 = that._phase === 'horizonal' ? pb.mul(this.d1.x, this.multiplier) : this.d1.x;
        this.$l.logValue2 = that._phase === 'horizonal' ? pb.mul(this.d2.x, this.multiplier) : this.d2.x;
        this.$if(pb.greaterThan(this.coverage1, 0.000001), function () {
          this.momentSum = pb.add(
            this.momentSum,
            pb.mul(
              this.incrementalGaussian.x,
              this.coverage1,
              pb.exp(pb.min(87, pb.sub(this.logValue1, this.maxLogValue)))
            )
          );
        });
        this.$if(pb.greaterThan(this.coverage2, 0.000001), function () {
          this.momentSum = pb.add(
            this.momentSum,
            pb.mul(
              this.incrementalGaussian.x,
              this.coverage2,
              pb.exp(pb.min(87, pb.sub(this.logValue2, this.maxLogValue)))
            )
          );
        });
        this.incrementalGaussian = pb.vec3(
          pb.mul(this.incrementalGaussian.xy, this.incrementalGaussian.yz),
          this.incrementalGaussian.z
        );
      });
      scope.$l.moment = pb.float(0);
      scope.$if(pb.greaterThan(scope.coverageSum, 0.000001), function () {
        this.moment = pb.add(this.maxLogValue, pb.log(pb.div(this.momentSum, this.coverageSum)));
      });
      return pb.vec4(scope.moment, pb.div(scope.coverageSum, scope.coefficientSum), 0, 1);
    } else {
      scope.$l.depth = pb.float(1);
      scope.$if(pb.greaterThan(scope.coverageSum, 0.000001), function () {
        this.depth = pb.div(this.depthSum, this.coverageSum);
      });
      return pb.vec4(scope.depth, pb.div(scope.coverageSum, scope.coefficientSum), 0, 1);
    }
  }
  writeTexel(scope: PBInsideFunctionScope, type: BlitType, srcUV: PBShaderExp, texel: PBShaderExp) {
    const outTexel = super.writeTexel(scope, type, srcUV, texel);
    if (this.packFloat) {
      return encodeNormalizedFloatToRGBA(scope, outTexel.r);
    } else {
      return outTexel;
    }
  }
  protected calcHash() {
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
  resourceDirty() {
    return this._resourceDirty;
  }
  get blur() {
    return this._blur;
  }
  set blur(val) {
    if (this._blur !== !!val) {
      this._blur = !!val;
      this._resourceDirty = true;
    }
  }
  get mipmap() {
    return this._mipmap;
  }
  set mipmap(b) {
    if (this._mipmap !== !!b) {
      this._mipmap = !!b;
      if (this._blur) {
        this._resourceDirty = true;
      }
    }
  }
  get kernelSize() {
    return this._kernelSize;
  }
  set kernelSize(val) {
    this._kernelSize = val;
  }
  get blurSize() {
    return this._blurSize;
  }
  set blurSize(val) {
    this._blurSize = val;
  }
  get logSpace() {
    return this._logSpace;
  }
  set logSpace(val) {
    this._logSpace = !!val;
  }
  getType() {
    return 'esm' as const;
  }
  getShadowMapBorder(_shadowMapParams: ShadowMapParams) {
    return this._blur ? Math.ceil(((this._kernelSize + 1) / 2) * this._blurSize) : 0;
  }
  getShadowMapClearColor(shadowMapParams: ShadowMapParams) {
    const colorAttachment = shadowMapParams.shadowMapFramebuffer?.getColorAttachments()[0];
    return colorAttachment
      ? colorAttachment.format === 'rgba8unorm'
        ? new Vector4(0, 0, 0, 1)
        : new Vector4(1, 0, 0, 1)
      : null;
  }
  getShadowMap(shadowMapParams: ShadowMapParams) {
    const implData = shadowMapParams.implData as ESMImplData;
    return (
      implData
        ? implData.blurFramebuffer2!.getColorAttachments()[0]
        : shadowMapParams.shadowMapFramebuffer!.getColorAttachments()[0]
    ) as ShadowMapType;
  }
  /** @internal */
  fetchTemporalFramebuffer(
    autoRelease: boolean,
    lightType: number,
    numCascades: number,
    width: number,
    height: number,
    colorFormat: TextureFormat,
    depthFormat: Nullable<TextureFormat>,
    mipmapping?: boolean
  ) {
    const device = getDevice();
    const useTextureArray = numCascades > 1 && device.type !== 'webgl';
    const colorAttachments = colorFormat
      ? useTextureArray
        ? [
            device.pool.fetchTemporalTexture2DArray(
              false,
              colorFormat,
              width,
              height,
              numCascades,
              mipmapping
            )
          ]
        : lightType === LIGHT_TYPE_POINT
          ? [device.pool.fetchTemporalTextureCube(false, colorFormat, width, mipmapping)]
          : [device.pool.fetchTemporalTexture2D(false, colorFormat, width, height, mipmapping)]
      : null;
    const depthAttachment = depthFormat
      ? useTextureArray
        ? device.pool.fetchTemporalTexture2DArray(false, depthFormat, width, height, numCascades, false)
        : device.type !== 'webgl' && lightType === LIGHT_TYPE_POINT
          ? device.pool.fetchTemporalTextureCube(false, depthFormat, width, false)
          : device.pool.fetchTemporalTexture2D(false, depthFormat, width, height, false)
      : null;
    const fb = device.pool.createTemporalFramebuffer(autoRelease, colorAttachments!, depthAttachment);
    if (colorAttachments) {
      device.pool.releaseTexture(colorAttachments[0]);
    }
    if (depthAttachment) {
      device.pool.releaseTexture(depthAttachment);
    }
    return fb;
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    const implData: ESMImplData = {
      blurFramebuffer: null,
      blurFramebuffer2: null
    };
    shadowMapParams.implData = implData;
    const colorFormat = this.getShadowMapColorFormat(shadowMapParams)!;
    const shadowMapWidth = shadowMapParams.shadowMapFramebuffer!.getColorAttachments()[0].width;
    const shadowMapHeight = shadowMapParams.shadowMapFramebuffer!.getColorAttachments()[0].height;
    if (this._blur) {
      shadowMapParams.implData = {
        blurFramebuffer: this.fetchTemporalFramebuffer(
          true,
          shadowMapParams.lightType,
          shadowMapParams.numShadowCascades,
          shadowMapWidth,
          shadowMapHeight,
          colorFormat,
          null,
          false
        ),
        blurFramebuffer2: this.fetchTemporalFramebuffer(
          true,
          shadowMapParams.lightType,
          shadowMapParams.numShadowCascades,
          shadowMapWidth,
          shadowMapHeight,
          colorFormat,
          null,
          true
        )
      };
    } else {
      shadowMapParams.implData = null;
    }
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler = shadowMapParams.shadowMap?.getDefaultSampler(false) ?? null;
  }
  postRenderShadowMap(shadowMapParams: ShadowMapParams) {
    if (shadowMapParams.implData) {
      const implData = shadowMapParams.implData as ESMImplData;
      const colorAttachment = shadowMapParams.shadowMapFramebuffer!.getColorAttachments()[0];
      const packFloat = colorAttachment.format === 'rgba8unorm';
      const logSpace = this._logSpace && !packFloat;
      this._blitterH.blurSize = this._blurSize / colorAttachment.width;
      this._blitterH.kernelSize = this._kernelSize;
      this._blitterH.logSpace = logSpace;
      this._blitterH.logSpaceMultiplier = this._depthScale;
      this._blitterH.packFloat = packFloat;
      this._blitterV.blurSize = this._blurSize / colorAttachment.height;
      this._blitterV.kernelSize = this._kernelSize;
      this._blitterV.logSpace = logSpace;
      this._blitterV.logSpaceMultiplier = this._depthScale;
      this._blitterV.packFloat = packFloat;
      this._blitterH.blit(colorAttachment as any, implData.blurFramebuffer!);
      this._blitterV.blit(
        implData.blurFramebuffer!.getColorAttachments()[0] as any,
        implData.blurFramebuffer2!
      );
    }
  }
  getDepthScale() {
    return this._depthScale;
  }
  setDepthScale(val: number) {
    this._depthScale = val;
  }
  getShaderHash() {
    return `${this._blur ? 1 : 0}${this._logSpace ? 1 : 0}`;
  }
  getParams() {}
  getShadowMapColorFormat(_shadowMapParams: ShadowMapParams) {
    const device = getDevice();
    return device.getDeviceCaps().textureCaps.supportFloatColorBuffer &&
      device.getDeviceCaps().textureCaps.supportLinearFloatTexture
      ? device.type === 'webgl'
        ? 'rgba32f'
        : 'rg32f'
      : device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer &&
          device.getDeviceCaps().textureCaps.supportLinearHalfFloatTexture
        ? device.type === 'webgl'
          ? 'rgba16f'
          : 'rg16f'
        : 'rgba8unorm';
  }
  getShadowMapDepthFormat(_shadowMapParams: ShadowMapParams) {
    return 'd24s8' as const;
  }
  computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp
  ) {
    const pb = scope.$builder;
    const depth = computeShadowMapDepth(scope, worldPos, shadowMapParams.shadowMap!.format);
    return shadowMapParams.shadowMap!.format === 'rgba8unorm' ? depth : pb.vec4(depth.x, 1, 0, 1);
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
    const logSpace = this._blur && this._logSpace && shadowMapParams.shadowMap!.format !== 'rgba8unorm';
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
          this.$l.shadowBias = computeShadowBiasCSM(this, this.NdotL, this.split);
          this.shadow = filterShadowESM(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            logSpace,
            this.shadowCoord,
            this.split,
            this.shadowBias
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
    const logSpace = this._blur && this._logSpace && shadowMapParams.shadowMap!.format !== 'rgba8unorm';
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
        this.$return(
          filterShadowESM(
            this,
            LIGHT_TYPE_POINT,
            shadowMapParams.shadowMap!.format,
            logSpace,
            this.dir,
            undefined,
            this.shadowBias
          )
        );
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
          this.$l.shadowBias = computeShadowBias(
            shadowMapParams.lightType,
            this,
            this.shadowCoord.z,
            this.NdotL,
            false
          );
          this.shadow = filterShadowESM(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            logSpace,
            this.shadowCoord,
            undefined,
            this.shadowBias
          );
        });
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL) as PBShaderExp;
  }
  useNativeShadowMap(_shadowMapParams: ShadowMapParams) {
    return false;
  }
}
