import type {
  BindGroup,
  TextureFormat,
  PBShaderExp,
  PBInsideFunctionScope,
  PBGlobalScope,
  FrameBuffer
} from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import type { BlitType } from '../blitter';
import { Blitter } from '../blitter';
import { computeShadowMapDepth, filterShadowVSM } from '../shaders/shadow';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { decode2HalfFromRGBA, decodeNormalizedFloatFromRGBA, encode2HalfToRGBA } from '../shaders/misc';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';
import { ShaderHelper } from '../material/shader/helper';
import { computeShadowBias, computeShadowBiasCSM } from './shader';
import { getDevice } from '../app/api';
import { Nullable } from '@zephyr3d/base';

type VSMImplData = {
  blurFramebuffer: FrameBuffer;
  blurFramebuffer2: FrameBuffer;
};

class VSMBlitter extends Blitter {
  protected _phase: 'horizonal' | 'vertical';
  protected _packFloat: boolean;
  protected _blurSize: number;
  protected _kernelSize: number;
  constructor(phase: 'horizonal' | 'vertical', kernelSize: number, blurSize: number, packFloat: boolean) {
    super();
    this._phase = phase;
    this._blurSize = blurSize;
    this._kernelSize = kernelSize;
    this._packFloat = packFloat;
  }
  get blurSize(): number {
    return this._blurSize;
  }
  set blurSize(val: number) {
    this._blurSize = val;
  }
  get kernelSize(): number {
    return this._kernelSize;
  }
  set kernelSize(val: number) {
    if (val !== this._kernelSize) {
      this._kernelSize = val;
      this.invalidateHash();
    }
  }
  get packFloat(): boolean {
    return this._packFloat;
  }
  set packFloat(b: boolean) {
    if (this._packFloat !== !!b) {
      this._packFloat = !!b;
      this.invalidateHash();
    }
  }
  setup(scope: PBGlobalScope, type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.blurSize = pb.float().uniform(0);
      scope.blurMultiplyVec =
        type === 'cube'
          ? this._phase === 'horizonal'
            ? pb.vec3(1, 0, 0)
            : pb.vec3(0, 1, 0)
          : this._phase === 'horizonal'
            ? pb.vec2(1, 0)
            : pb.vec2(0, 1);
      scope.numBlurPixelsPerSide = pb.float((this._kernelSize + 1) / 2);
      scope.weight = pb.float(1 / (this._kernelSize * this._kernelSize));
    }
  }
  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('blurSize', this._blurSize);
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
    if (this._packFloat) {
      if (this._phase === 'horizonal') {
        return pb.vec4(decodeNormalizedFloatFromRGBA(scope, texel));
      } else {
        return pb.vec4(decode2HalfFromRGBA(scope, texel), 0, 0);
      }
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
    if (this._packFloat) {
      return encode2HalfToRGBA(scope, outTexel.x, outTexel.y);
    } else {
      return outTexel;
    }
  }
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'int' | 'float' | 'uint'
  ): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    scope.d0 = that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    scope.mean = pb.float(0);
    scope.squaredMean = pb.float(0);
    scope.$for(pb.float('i'), 1, scope.numBlurPixelsPerSide, function () {
      this.d1 = that.readTexel(
        this,
        type,
        srcTex,
        pb.sub(srcUV, pb.mul(this.blurMultiplyVec, this.blurSize, this.i)),
        srcLayer,
        sampleType
      );
      this.d2 = that.readTexel(
        this,
        type,
        srcTex,
        pb.add(srcUV, pb.mul(this.blurMultiplyVec, this.blurSize, this.i)),
        srcLayer,
        sampleType
      );
      this.mean = pb.add(this.mean, this.d1.x);
      this.mean = pb.add(this.mean, this.d2.x);
      if (that._phase === 'horizonal') {
        this.squaredMean = pb.add(this.squaredMean, pb.mul(this.d1.x, this.d1.x));
        this.squaredMean = pb.add(this.squaredMean, pb.mul(this.d2.x, this.d2.x));
      } else {
        this.squaredMean = pb.add(this.squaredMean, pb.dot(this.d1.xy, this.d1.xy));
        this.squaredMean = pb.add(this.squaredMean, pb.dot(this.d2.xy, this.d2.xy));
      }
    });
    scope.mean = pb.div(scope.mean, that._kernelSize);
    scope.squaredMean = pb.div(scope.squaredMean, that._kernelSize);
    scope.stdDev = pb.sqrt(pb.max(0, pb.sub(scope.squaredMean, pb.mul(scope.mean, scope.mean))));
    return pb.vec4(scope.mean, scope.stdDev, 0, 1);
  }
  protected calcHash(): string {
    return `${this._phase}-${this._kernelSize}-${Number(this._packFloat)}`;
  }
}

/** @internal */
export class VSM extends ShadowImpl {
  /** @internal */
  protected _blur: boolean;
  /** @internal */
  protected _kernelSize: number;
  /** @internal */
  protected _blurSize: number;
  /** @internal */
  protected _blitterH: VSMBlitter;
  /** @internal */
  protected _blitterV: VSMBlitter;
  /** @internal */
  protected _mipmap: boolean;
  /** @internal */
  protected _darkness: number;
  constructor(kernelSize?: number, blurSize?: number, darkness?: number) {
    super();
    this._blur = true;
    this._kernelSize = kernelSize ?? 5;
    this._blurSize = blurSize ?? 1;
    this._darkness = darkness ?? 0;
    this._mipmap = true;
    this._blitterH = new VSMBlitter('horizonal', this._kernelSize, 1 / 1024, false);
    this._blitterV = new VSMBlitter('vertical', this._kernelSize, 1 / 1024, false);
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
  getDepthScale(): number {
    return this._darkness;
  }
  setDepthScale(val: number) {
    this._darkness = val;
  }
  getType(): ShadowMode {
    return 'vsm';
  }
  getShadowMapBorder(_shadowMapParams: ShadowMapParams): number {
    return this._blur ? Math.ceil(((this._kernelSize + 1) / 2) * this._blurSize) : 0;
  }
  getShadowMap(shadowMapParams: ShadowMapParams): ShadowMapType {
    const implData = shadowMapParams.implData as VSMImplData;
    return (
      implData
        ? implData.blurFramebuffer2.getColorAttachments()[0]
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
    const colorFormat = this.getShadowMapColorFormat(shadowMapParams)!;
    //const target = shadowMapParams.shadowMapFramebuffer.getColorAttachments()[0].target;
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
          this._mipmap
        )
      };
    }
    shadowMapParams.shadowMap = this.getShadowMap(shadowMapParams);
    shadowMapParams.shadowMapSampler = shadowMapParams.shadowMap?.getDefaultSampler(false) ?? null;
  }
  postRenderShadowMap(shadowMapParams: ShadowMapParams) {
    if (this._blur) {
      const implData = shadowMapParams.implData as VSMImplData;
      this._blitterH.blurSize = this._blurSize / shadowMapParams.shadowMap!.width;
      this._blitterH.kernelSize = this._kernelSize;
      this._blitterH.packFloat = shadowMapParams.shadowMap!.format === 'rgba8unorm';
      this._blitterV.blurSize = this._blurSize / shadowMapParams.shadowMap!.height;
      this._blitterV.kernelSize = this._kernelSize;
      this._blitterV.packFloat = shadowMapParams.shadowMap!.format === 'rgba8unorm';
      this._blitterH.blit(
        shadowMapParams.shadowMapFramebuffer!.getColorAttachments()[0] as any,
        implData.blurFramebuffer
      );
      this._blitterV.blit(
        implData.blurFramebuffer.getColorAttachments()[0] as any,
        implData.blurFramebuffer2
      );
    }
  }
  getShaderHash(): string {
    return '';
  }
  getShadowMapColorFormat(_shadowMapParams: ShadowMapParams): TextureFormat {
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
  getShadowMapDepthFormat(_shadowMapParams: ShadowMapParams): TextureFormat {
    return 'd24s8';
  }
  computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp
  ): PBShaderExp {
    return computeShadowMapDepth(scope, worldPos, shadowMapParams.shadowMap!.format);
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
          this.$l.shadowBias = computeShadowBiasCSM(this, this.NdotL, this.split);
          this.shadowCoord.z = pb.sub(this.shadowCoord.z, this.shadowBias);
          this.shadow = filterShadowVSM(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
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
        this.$l.coord = pb.vec4(this.dir, pb.sub(this.distance, this.shadowBias));
        this.$return(
          filterShadowVSM(this, shadowMapParams.lightType, shadowMapParams.shadowMap!.format, this.coord)
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
          this.shadow = filterShadowVSM(
            this,
            shadowMapParams.lightType,
            shadowMapParams.shadowMap!.format,
            this.shadowCoord
          );
        });
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcNameComputeShadow](shadowVertex, NdotL);
  }
  useNativeShadowMap(_shadowMapParams: ShadowMapParams): boolean {
    return false;
  }
}
