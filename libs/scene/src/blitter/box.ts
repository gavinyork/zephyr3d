import type { BindGroup, PBShaderExp, PBInsideFunctionScope, PBGlobalScope } from '@zephyr3d/device';
import type { BlitType } from './blitter';
import { Blitter } from './blitter';

/**
 * Box-filter blitter
 * @public
 */
export class BoxFilterBlitter extends Blitter {
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
  /**
   * Creates an instance of BoxFilterBlitter
   * @param phase - phase of the blit operation
   * @param kernelSize - kernel size
   * @param blurSize - blur size
   */
  constructor(phase: 'horizonal' | 'vertical', kernelSize: number, blurSize: number) {
    super();
    this._phase = phase;
    this._kernelSize = kernelSize;
    this._blurSize = blurSize;
    this._logSpace = false;
    this._logSpaceMultiplier = 1;
  }
  /**
   * true if the box filter will be applied in logarithmic space
   */
  get logSpace(): boolean {
    return this._logSpace;
  }
  set logSpace(val: boolean) {
    this._logSpace = !!val;
  }
  /**
   * Multiplier for logarithmic space blur
   */
  get logSpaceMultiplier(): number {
    return this._logSpaceMultiplier;
  }
  set logSpaceMultiplier(val: number) {
    this._logSpaceMultiplier = val;
  }
  /**
   * {@inheritDoc Blitter.setup}
   * @override
   */
  setup(scope: PBGlobalScope, type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
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
      scope.weight = pb.float(1 / this._kernelSize);
    }
  }
  /**
   * {@inheritDoc Blitter.setUniforms}
   * @override
   */
  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('blurSize', this._blurSize);
    if (this._logSpace && this._phase === 'horizonal') {
      bindGroup.setValue('multiplier', this._logSpaceMultiplier);
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
    sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    scope.d0 = that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    if (that._logSpace) {
      scope.avgValue = pb.vec4(scope.weight);
    } else {
      scope.avgValue = pb.mul(that.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType), scope.weight);
    }
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
      if (that._logSpace) {
        if (that._phase === 'horizonal') {
          this.avgValue = pb.add(
            this.avgValue,
            pb.mul(pb.exp(pb.mul(pb.sub(this.d1, this.d0), this.multiplier)), this.weight)
          );
          this.avgValue = pb.add(
            this.avgValue,
            pb.mul(pb.exp(pb.mul(pb.sub(this.d2, this.d0), this.multiplier)), this.weight)
          );
        } else {
          this.avgValue = pb.add(this.avgValue, pb.mul(pb.exp(pb.sub(this.d1, this.d0)), this.weight));
          this.avgValue = pb.add(this.avgValue, pb.mul(pb.exp(pb.sub(this.d2, this.d0)), this.weight));
        }
      } else {
        this.avgValue = pb.add(this.avgValue, pb.mul(this.d1, this.weight));
        this.avgValue = pb.add(this.avgValue, pb.mul(this.d2, this.weight));
      }
    });
    if (that._logSpace) {
      if (that._phase === 'horizonal') {
        scope.avgValue = pb.add(pb.mul(scope.multiplier, scope.d0), pb.log(scope.avgValue));
      } else {
        scope.avgValue = pb.add(scope.d0, pb.log(scope.avgValue));
      }
    }
    return scope.avgValue;
  }
  /**
   * {@inheritDoc Blitter.calcHash}
   * @override
   */
  protected calcHash(): string {
    return `${this._phase}-${this._kernelSize}-${Number(!!this._logSpace)}`;
  }
}
