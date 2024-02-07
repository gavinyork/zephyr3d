import type { BindGroup, PBShaderExp, PBInsideFunctionScope, PBGlobalScope, Texture2D, TextureSampler, BaseTexture } from '@zephyr3d/device';
import type { BlitType } from './blitter';
import { Blitter } from './blitter';
import { decodeNormalizedFloatFromRGBA, encodeNormalizedFloatToRGBA } from '../shaders';
import { Vector2 } from '@zephyr3d/base';

/**
 * Bilateral blur blitter horizonal stage for ambient occlusion calculation
 * @public
 */
export class AOBilateralBlurBlitter extends Blitter {
  private _depthTex: Texture2D;
  private _sampler: TextureSampler;
  private _kernelRadius: number;
  private _cameraNearFar: Vector2;
  private _depthCutoff: number;
  private _packed: boolean;
  private _uvStep: Vector2;
  private _size: Vector2;
  private _stdDev: number;
  private _offsetsAndWeights: Float32Array;
  private _finalPhase: boolean;
  constructor(finalPhase: boolean) {
    super();
    this._depthTex = null;
    this._depthCutoff = 0.001;
    this._sampler = null;
    this._packed = false;
    this._kernelRadius = 8;
    this._cameraNearFar = Vector2.zero();
    this._size = Vector2.zero();
    this._stdDev = 10;
    this._offsetsAndWeights = new Float32Array(4 * (this._kernelRadius + 1));
    this._finalPhase = !!finalPhase;
    this._uvStep = this._finalPhase ? new Vector2(1, 0) : new Vector2(0, 1);
    this.calcGaussion();
  }
  get depthTex(): Texture2D {
    return this._depthTex;
  }
  set depthTex(tex: Texture2D) {
    this._depthTex = tex;
  }
  get packed(): boolean {
    return this._packed;
  }
  set packed(val: boolean) {
    if (this._packed !== !!val) {
      this._packed = !!val;
      this.invalidateHash();
    }
  }
  get nearestSampler(): TextureSampler {
    return this._sampler;
  }
  set nearestSampler(sampler: TextureSampler) {
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
    if (val !== this._kernelRadius) {
      this._kernelRadius = val;
      this._offsetsAndWeights = new Float32Array(4 * (this._kernelRadius + 1));
      this.calcGaussion();
      this.invalidateHash();
    }
  }
  protected calcHash(): string {
    return `${this._kernelRadius}:${this._packed}:${this._finalPhase}`;
  }
  private calcGaussion() {
    for (let i = 0; i <= this.kernelRadius; i++) {
      this._offsetsAndWeights[i * 4] = this._uvStep.x * i;
      this._offsetsAndWeights[i * 4 + 1] = this._uvStep.y * i;
      this._offsetsAndWeights[i * 4 + 2] = Math.exp( - (i * i) / (2 * (this._stdDev * this._stdDev))) / (Math.sqrt(2.0 * Math.PI) * this._stdDev);
    }
  }
  setup(scope: PBGlobalScope, type: BlitType) {
    super.setup(scope, type);
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      scope.depthCutoff = pb.float().uniform(0);
      scope.offsetsAndWeights = pb.vec4[this._kernelRadius + 1]().uniform(0);
      scope.cameraNearFar = pb.vec2().uniform(0);
      scope.size = pb.vec2().uniform(0);
    }
  }
  setUniforms(bindGroup: BindGroup, sourceTex: BaseTexture) {
    super.setUniforms(bindGroup, sourceTex);
    bindGroup.setTexture('depthTex', this._depthTex, this._sampler);
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
    sampleType: 'float'|'int'|'uint'
  ): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    pb.func('getLinearDepth', [pb.vec2('uv')], function(){
      this.$l.depthValue = pb.textureSample(this.depthTex, this.uv);
      this.$return(pb.getDevice().type === 'webgl' ? decodeNormalizedFloatFromRGBA(this, this.depthValue) : this.depthValue.r);
    });
    scope.depth = scope.getLinearDepth(srcUV);
    scope.weightSum = scope.offsetsAndWeights[0].z;
    scope.srcTexel = that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    scope.ao = that._packed ? decodeNormalizedFloatFromRGBA(scope, scope.srcTexel) : scope.srcTexel.r;
    scope.colorSum = pb.mul(scope.ao, scope.weightSum);
    scope.$for(pb.int('i'), 0, that._kernelRadius, function(){
      this.$l.offsetAndWeight = this.offsetsAndWeights.at(pb.add(this.i, 1));
      this.$l.weight = this.offsetAndWeight.z;
      this.$l.offset = pb.div(this.offsetAndWeight.xy, this.size);
      this.$l.uvRight = pb.add(srcUV, this.offset);
      this.$l.depthRight = this.getLinearDepth(this.uvRight);
      this.$if(pb.lessThan(pb.abs(pb.sub(this.depthRight, this.depth)), this.depthCutoff), function(){
        this.$l.srcTexelRight = that.readTexel(this, type, srcTex, this.uvRight, srcLayer, sampleType);
        this.$l.aoRight = that._packed ? decodeNormalizedFloatFromRGBA(this, this.srcTexelRight) : this.srcTexelRight.r;
        this.colorSum = pb.add(this.colorSum, pb.mul(this.aoRight, this.weight));
        this.weightSum = pb.add(this.weightSum, this.weight);
      });
      this.$l.uvLeft = pb.sub(srcUV, this.offset);
      this.$l.depthLeft = this.getLinearDepth(this.uvLeft);
      this.$if(pb.lessThan(pb.abs(pb.sub(this.depthLeft, this.depth)), this.depthCutoff), function(){
        this.$l.srcTexelLeft = that.readTexel(this, type, srcTex, this.uvLeft, srcLayer, sampleType);
        this.$l.aoLeft = that._packed ? decodeNormalizedFloatFromRGBA(this, this.srcTexelLeft) : this.srcTexelLeft.r;
        this.colorSum = pb.add(this.colorSum, pb.mul(this.aoLeft, this.weight));
        this.weightSum = pb.add(this.weightSum, this.weight);
      });
    });
    scope.colorSum = pb.div(scope.colorSum, scope.weightSum);
    return that._finalPhase || !that._packed
      ? pb.vec4(scope.colorSum, scope.colorSum, scope.colorSum, 1)
      : encodeNormalizedFloatToRGBA(scope, scope.colorSum);
  }
}

