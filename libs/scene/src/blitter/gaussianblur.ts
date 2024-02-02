import { ShaderType, BindGroup, PBShaderExp, PBInsideFunctionScope, PBGlobalScope, Texture2D } from '@zephyr3d/device';
import { Blitter, BlitType } from './blitter';
import { decodeNormalizedFloatFromRGBA } from '../shaders';

/**
 * Gaussian blur blitter
 * @public
 */
export class GaussianBlurBlitter extends Blitter {
  /** @internal */
  protected _phase: 'horizonal' | 'vertical';
  /** @internal */
  protected _kernelSize: number;
  /** @internal */
  protected _sigma: number;
  /** @internal */
  protected _blurSize: number;
  /** @internal */
  protected _logSpace: boolean;
  /** @internal */
  protected _logSpaceMultiplier: number;
  /** @internal */
  protected _depthTex: Texture2D;
  /** @internal */
  protected _depthCutoff: number;
  /**
   * Creates an instance of GaussianBlurBlitter
   * @param phase - Blitter phase
   * @param kernalSize - kernel size
   * @param sigma - Gaussian standard deviation
   * @param blurSize - Blur radius
   */
  constructor(phase: 'horizonal' | 'vertical', kernalSize: number, sigma: number, blurSize: number) {
    super();
    this._phase = phase;
    this._kernelSize = kernalSize;
    this._sigma = sigma;
    this._blurSize = blurSize;
    this._logSpace = false;
    this._logSpaceMultiplier = 1;
    this._depthTex = null;
    this._depthCutoff = 0.7;
  }
  /** Blur radius */
  get blurSize(): number {
    return this._blurSize;
  }
  set blurSize(val: number) {
    this._blurSize = val;
  }
  /** Kernel size */
  get kernelSize(): number {
    return this._kernelSize;
  }
  set kernelSize(val: number) {
    if (this._kernelSize !== val) {
      this._kernelSize = val;
      this.invalidateHash();
    }
  }
  /** true if the box filter will be applied in logarithmic space */
  get logSpace(): boolean {
    return this._logSpace;
  }
  set logSpace(val: boolean) {
    if (this._logSpace !== !!val) {
      this._logSpace = !!val;
      this.invalidateHash();
    }
  }
  /** Multiplier for logarithmic space blur */
  get logSpaceMultiplier(): number {
    return this._logSpaceMultiplier;
  }
  set logSpaceMultiplier(val: number) {
    this._logSpaceMultiplier = val;
  }
  /** Linear depth texture */
  get depthTexture(): Texture2D {
    return this._depthTex;
  }
  set depthTexture(tex: Texture2D) {
    if (this._depthTex !== tex) {
      if (!tex || !this._depthTex) {
        this.invalidateHash();
      }
      this._depthTex = tex;
    }
  }
  /** Depth cutoff */
  get depthCutoff(): number {
    return this._depthCutoff;
  }
  set depthCutoff(val: number) {
    this._depthCutoff = val;
  }
  /**
   * {@inheritDoc Blitter.setup}
   * @override
   */
  setup(scope: PBGlobalScope, type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      if (this._depthTex) {
        scope.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        scope.depthCutoff = pb.float().uniform(0);
      }
      scope.sigma = pb.float().uniform(0);
      scope.blurSize = pb.float().uniform(0);
      if (this._logSpace && this._phase === 'horizonal') {
        scope.multiplier = pb.float().uniform(0);
      }
      if (this._phase !== 'horizonal' && this._phase !== 'vertical') {
        throw new Error(`GaussianBlurFilter.setupFilter() failed: invalid phase: ${this._phase}`);
      }
      if (!Number.isInteger(this._kernelSize) || this._kernelSize < 0 || (this._kernelSize & 1) === 0) {
        throw new Error(`GaussianBlurFilter.setupFilter() failed: invalid kernel size: ${this._kernelSize}`);
      }
      scope.blurMultiplyVec =
        type === 'cube'
          ? this._phase === 'horizonal'
            ? pb.vec3(1, 0, 0)
            : pb.vec3(0, 1, 0)
          : this._phase === 'horizonal'
          ? pb.vec2(1, 0)
          : pb.vec2(0, 1);
      scope.numBlurPixelsPerSide = pb.float((this._kernelSize + 1) / 2);
    }
  }
  /**
   * {@inheritDoc Blitter.setUniforms}
   * @override
   */
  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('sigma', this._sigma);
    bindGroup.setValue('blurSize', this._blurSize);
    if (this._logSpace && this._phase === 'horizonal') {
      bindGroup.setValue('multiplier', this._logSpaceMultiplier);
    }
    if (this._depthTex) {
      bindGroup.setTexture('depthTex', this._depthTex);
      bindGroup.setValue('depthCutoff', this._depthCutoff);
    }
  }
  /**
   * {@inheritDoc Blitter.filter}
   * @override
   */
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
    if (that._depthTex) {
      pb.func('getLinearDepth', [pb.vec2('uv')], function(){
        this.$l.depthValue = pb.textureSample(this.depthTex, this.uv);
        if (pb.getDevice().type === 'webgl') {
          this.$return(decodeNormalizedFloatFromRGBA(this, this.depthValue));
        } else {
          this.$return(this.depthValue.r);
        }
      });
    }
    scope.incrementalGaussian = pb.vec3();
    scope.incrementalGaussian.x = pb.div(1, pb.mul(scope.sigma, Math.sqrt(2 * Math.PI)));
    scope.incrementalGaussian.y = pb.exp(pb.div(-0.5, pb.mul(scope.sigma, scope.sigma)));
    scope.incrementalGaussian.z = pb.mul(scope.incrementalGaussian.y, scope.incrementalGaussian.y);
    scope.coefficientSum = pb.float(0);
    scope.minExpValue = pb.vec4(87, 87, 87, 87);
    scope.d0 = that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    if (that._logSpace) {
      scope.avgValue = pb.vec4(scope.incrementalGaussian.x);
    } else {
      scope.avgValue = pb.mul(
        that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType),
        scope.incrementalGaussian.x
      );
    }
    if (that._depthTex) {
      scope.centerDepth = scope.getLinearDepth(srcUV);
    }
    scope.coefficientSum = pb.add(scope.coefficientSum, scope.incrementalGaussian.x);
    scope.incrementalGaussian = pb.vec3(
      pb.mul(scope.incrementalGaussian.xy, scope.incrementalGaussian.yz),
      scope.incrementalGaussian.z
    );
    scope.$for(pb.float('i'), 1, scope.numBlurPixelsPerSide, function () {
      this.$l.uv1 = pb.sub(srcUV, pb.mul(this.blurMultiplyVec, this.blurSize, this.i));
      this.$l.d1 = pb.vec4();
      if (that._depthTex) {
        this.$l.depth1 = this.getLinearDepth(this.uv1);
        this.$l.test1 = pb.lessThan(pb.abs(pb.sub(this.depth1, this.centerDepth)), this.depthCutoff);
      } else {
        this.$l.test1 = true;
      }
      this.$if(this.test1, function() {
        this.d1 = that.readTexel(
          scope,
          type,
          srcTex,
          this.uv1,
          srcLayer,
          sampleType
        );
      });
      this.$l.uv2 = pb.add(srcUV, pb.mul(this.blurMultiplyVec, this.blurSize, this.i)),
      this.$l.d2 = pb.vec4();
      if (that._depthTex) {
        this.$l.depth2 = this.getLinearDepth(this.uv2);
        this.$l.test2 = pb.lessThan(pb.abs(pb.sub(this.depth2, this.centerDepth)), this.depthCutoff);
      } else {
        this.$l.test2 = true;
      }
      this.$if(this.test2, function() {
        this.d2 = that.readTexel(
          scope,
          type,
          srcTex,
          pb.add(srcUV, pb.mul(this.blurMultiplyVec, this.blurSize, this.i)),
          srcLayer,
          sampleType
        );
      });
      if (that._logSpace) {
        if (that._phase === 'horizonal') {
          this.$if(this.test1, function(){
            this.avgValue = pb.add(
              this.avgValue,
              pb.mul(pb.exp(pb.min(this.minExpValue, pb.mul(pb.sub(this.d1, this.d0), this.multiplier))), this.incrementalGaussian.x)
            );
            this.coefficientSum = pb.add(this.coefficientSum, this.incrementalGaussian.x);
          });
          this.$if(this.test2, function(){
            this.avgValue = pb.add(
              this.avgValue,
              pb.mul(pb.exp(pb.min(this.minExpValue, pb.mul(pb.sub(this.d2, this.d0), this.multiplier))), this.incrementalGaussian.x)
            );
            this.coefficientSum = pb.add(this.coefficientSum, this.incrementalGaussian.x);
          });
        } else {
          this.$if(this.test1, function(){
            this.avgValue = pb.add(
              this.avgValue,
              pb.mul(pb.exp(pb.min(this.minExpValue, pb.sub(this.d1, this.d0))), this.incrementalGaussian.x)
            );
            this.coefficientSum = pb.add(this.coefficientSum, this.incrementalGaussian.x);
          });
          this.$if(this.test2, function(){
            this.avgValue = pb.add(
              this.avgValue,
              pb.mul(pb.exp(pb.min(this.minExpValue, pb.sub(this.d2, this.d0))), this.incrementalGaussian.x)
            );
            this.coefficientSum = pb.add(this.coefficientSum, this.incrementalGaussian.x);
          });
        }
      } else {
        this.$if(this.test1, function(){
          this.avgValue = pb.add(this.avgValue, pb.mul(this.d1, this.incrementalGaussian.x));
          this.coefficientSum = pb.add(this.coefficientSum, this.incrementalGaussian.x);
        });
        this.$if(this.test2, function(){
          this.avgValue = pb.add(this.avgValue, pb.mul(this.d2, this.incrementalGaussian.x));
          this.coefficientSum = pb.add(this.coefficientSum, this.incrementalGaussian.x);
        });
      }
      this.incrementalGaussian = pb.vec3(
        pb.mul(this.incrementalGaussian.xy, this.incrementalGaussian.yz),
        this.incrementalGaussian.z
      );
    });
    scope.$l.outColor = pb.div(scope.avgValue, scope.coefficientSum);
    if (that._logSpace) {
      if (that._phase === 'horizonal') {
        scope.outColor = pb.add(pb.mul(scope.multiplier, scope.d0), pb.log(scope.outColor));
      } else {
        scope.outColor = pb.add(scope.d0, pb.log(scope.outColor));
      }
    }
    return scope.outColor;
  }
  /**
   * {@inheritDoc Blitter.calcHash}
   * @override
   */
  protected calcHash(): string {
    return `${this._depthTex ? 1 : 0}-${this._phase}-${this._kernelSize}-${Number(!!this._logSpace)}`;
  }
}
