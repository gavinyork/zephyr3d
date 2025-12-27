import type {
  BindGroup,
  PBShaderExp,
  PBInsideFunctionScope,
  PBGlobalScope,
  Texture2D,
  TextureSampler,
  BaseTexture
} from '@zephyr3d/device';
import type { BlitType } from './blitter';
import { Blitter } from './blitter';
import { decodeNormalizedFloatFromRGBA } from '../shaders/misc';
import type { Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { fetchSampler } from '../utility/misc';

/**
 * Bilateral blur blitter
 * @public
 */
export class BilateralBlurBlitter extends Blitter {
  protected _depthTex: Nullable<Texture2D>;
  protected _sampler: Nullable<TextureSampler>;
  protected _blurSizeTex: Nullable<Texture2D>;
  protected _blurSizeScale: number;
  protected _blurSizeIndex: number;
  protected _kernelRadius: number;
  protected _cameraNearFar: Vector2;
  protected _depthCutoff: number;
  protected _stepSize: number;
  protected _uvStep: Vector2;
  protected _size: Vector2;
  protected _stdDev: number;
  protected _offsetsAndWeights: Float32Array<ArrayBuffer>;
  protected _finalPhase: boolean;
  constructor(finalPhase: boolean) {
    super();
    this._depthTex = null;
    this._depthCutoff = 2;
    this._blurSizeTex = null;
    this._blurSizeScale = 1;
    this._blurSizeIndex = 0;
    this._sampler = null;
    this._blurSizeTex = null;
    this._kernelRadius = 8;
    this._cameraNearFar = Vector2.zero();
    this._size = Vector2.zero();
    this._stdDev = 2;
    this._offsetsAndWeights = new Float32Array(4 * (this._kernelRadius + 1));
    this._finalPhase = !!finalPhase;
    this._stepSize = 1;
    this._uvStep = this._finalPhase ? new Vector2(1, 0) : new Vector2(0, 1);
    this.calcGaussion();
  }
  get depthTex() {
    return this._depthTex;
  }
  set depthTex(tex) {
    this._depthTex = tex;
  }
  get blurSizeTex() {
    return this._blurSizeTex;
  }
  set blurSizeTex(tex) {
    this._blurSizeTex = tex;
  }
  get blurSizeIndex(): number {
    return this._blurSizeIndex;
  }
  set blurSizeIndex(val: number) {
    this._blurSizeIndex = val;
  }
  get blurSizeScale(): number {
    return this._blurSizeScale;
  }
  set blurSizeScale(val: number) {
    this._blurSizeScale = val;
  }
  get sampler() {
    return this._sampler;
  }
  set sampler(sampler) {
    this._sampler = sampler;
  }
  get cameraNearFar(): Vector2 {
    return this._cameraNearFar;
  }
  set cameraNearFar(v: Vector2) {
    this._cameraNearFar.set(v);
  }
  get depthCutoff(): number {
    return this._depthCutoff;
  }
  set depthCutoff(val: number) {
    this._depthCutoff = val;
  }
  get size(): Vector2 {
    return this._size;
  }
  set size(val: Vector2) {
    this._size.set(val);
  }
  get stepSize(): number {
    return this._stepSize;
  }
  set stepSize(val: number) {
    if (val !== this._stepSize) {
      this._stepSize = val;
      this.calcGaussion();
    }
  }
  get stdDev(): number {
    return this._stdDev;
  }
  set stdDev(val: number) {
    if (val !== this._stdDev) {
      this._stdDev = val;
      this.calcGaussion();
    }
  }
  get kernelRadius(): number {
    return this._kernelRadius;
  }
  set kernelRadius(val: number) {
    val = Math.max(val, 0) >> 0;
    if (val !== this._kernelRadius) {
      this._kernelRadius = val;
      this._offsetsAndWeights = new Float32Array(4 * (this._kernelRadius + 1));
      this.calcGaussion();
      this.invalidateHash();
    }
  }
  protected calcHash(): string {
    return `${Number(!!this._blurSizeTex)}:${this._blurSizeIndex}:${this._kernelRadius}:${this._finalPhase}`;
  }
  private calcGaussion() {
    const kernel: number[] = [];
    const size = this.kernelRadius * 2 + 1;
    let sum = 0;
    for (let x = 0; x < size; x++) {
      const value =
        (1 / (Math.sqrt(2 * Math.PI) * this._stdDev)) *
        Math.exp(-((x - this.kernelRadius) ** 2) / (2 * this._stdDev ** 2));
      kernel.push(value);
      sum += value;
    }
    for (let i = 0; i <= this.kernelRadius; i++) {
      this._offsetsAndWeights[i * 4] = this._uvStep.x * i;
      this._offsetsAndWeights[i * 4 + 1] = this._uvStep.y * i;
      this._offsetsAndWeights[i * 4 + 2] = kernel[this.kernelRadius - i] / sum;
      this._offsetsAndWeights[i * 4 + 3] = this._stepSize;
    }
  }
  setup(scope: PBGlobalScope, type: BlitType) {
    super.setup(scope, type);
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.depthTex = pb.tex2D().uniform(0);
      if (this._blurSizeTex) {
        scope.blurSizeTex = pb.tex2D().uniform(0);
        scope.blurSizeScale = pb.float().uniform(0);
      }
      scope.depthCutoff = pb.float().uniform(0);
      scope.offsetsAndWeights = pb.vec4[this._kernelRadius + 1]().uniform(0);
      scope.cameraNearFar = pb.vec2().uniform(0);
      scope.size = pb.vec2().uniform(0);
    }
  }
  setUniforms(bindGroup: BindGroup, sourceTex: BaseTexture) {
    super.setUniforms(bindGroup, sourceTex);
    bindGroup.setTexture('depthTex', this._depthTex!, this._sampler ?? fetchSampler('clamp_nearest_nomip'));
    if (this._blurSizeTex) {
      bindGroup.setTexture('blurSizeTex', this._blurSizeTex, fetchSampler('clamp_linear_nomip'));
      bindGroup.setValue('blurSizeScale', this._blurSizeScale);
    }
    bindGroup.setValue('depthCutoff', this._depthCutoff);
    bindGroup.setValue('offsetsAndWeights', this._offsetsAndWeights);
    bindGroup.setValue('cameraNearFar', this._cameraNearFar);
    bindGroup.setValue('size', this._size);
  }
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    pb.func('getLinearDepth', [pb.vec2('uv')], function () {
      this.$l.depthValue = pb.textureSample(this.depthTex, this.uv);
      this.$l.depth01 =
        pb.getDevice().type === 'webgl'
          ? decodeNormalizedFloatFromRGBA(this, this.depthValue)
          : this.depthValue.r;
      this.$return(pb.mul(this.depth01, this.cameraNearFar.y));
    });
    pb.func('getLogDepth', [pb.float('linearDepth')], function () {
      this.$return(pb.log(pb.add(this.linearDepth, 1)));
    });
    scope.centerDepth = scope.getLogDepth(scope.getLinearDepth(srcUV));
    scope.depthDiff = pb.div(
      scope.depthCutoff,
      pb.sub(scope.getLogDepth(scope.cameraNearFar.y), scope.getLogDepth(scope.cameraNearFar.x))
    );
    scope.weightSum = scope.offsetsAndWeights[0].z;
    scope.srcTexel = that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    scope.colorSum = pb.mul(scope.srcTexel, scope.weightSum);
    if (that._blurSizeTex) {
      scope.blurSize = pb.textureSample(scope.blurSizeTex, srcUV)['rgba'[this._blurSizeIndex]];
    }
    scope.$for(pb.int('i'), 0, that._kernelRadius, function () {
      this.$l.offsetAndWeight = this.offsetsAndWeights.at(pb.add(this.i, 1));
      this.$l.weight = this.offsetAndWeight.z;
      this.$l.offset = this.offsetAndWeight.xy;
      if (that._blurSizeTex) {
        this.offset = pb.mul(this.offset, this.blurSize, this.blurSizeScale);
      }
      this.$l.offset = pb.div(this.offset, this.size);
      this.$l.uvRight = pb.add(srcUV, this.offset);
      this.$l.depthRight = this.getLogDepth(this.getLinearDepth(this.uvRight));
      this.$if(pb.lessThan(pb.abs(pb.sub(this.depthRight, this.centerDepth)), this.depthDiff), function () {
        this.$l.srcTexelRight = that.readTexel(this, type, srcTex, this.uvRight, srcLayer, sampleType);
        this.$l.colorWeight = pb.mul(
          this.weight,
          pb.exp(pb.neg(pb.distance(this.srcTexelRight.rgb, this.srcTexel.rgb)))
        );
        this.colorSum = pb.add(this.colorSum, pb.mul(this.srcTexelRight, this.colorWeight));
        this.weightSum = pb.add(this.weightSum, this.colorWeight);
      });
      this.$l.uvLeft = pb.sub(srcUV, this.offset);
      this.$l.depthLeft = this.getLogDepth(this.getLinearDepth(this.uvLeft));
      this.$if(pb.lessThan(pb.abs(pb.sub(this.depthLeft, this.centerDepth)), this.depthDiff), function () {
        this.$l.srcTexelLeft = that.readTexel(this, type, srcTex, this.uvLeft, srcLayer, sampleType);
        this.$l.colorWeight = pb.mul(
          this.weight,
          pb.exp(pb.neg(pb.distance(this.srcTexelLeft.rgb, this.srcTexel.rgb)))
        );
        this.colorSum = pb.add(this.colorSum, pb.mul(this.srcTexelLeft, this.colorWeight));
        this.weightSum = pb.add(this.weightSum, this.colorWeight);
      });
    });
    scope.colorSum = pb.div(scope.colorSum, scope.weightSum);
    return scope.colorSum;
  }
}
