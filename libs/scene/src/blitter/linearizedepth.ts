import { Vector2 } from '@zephyr3d/base';
import type { BlitType } from './blitter';
import { Blitter } from './blitter';
import type { PBShaderExp, PBInsideFunctionScope, BindGroup, PBGlobalScope } from '@zephyr3d/device';
import { ShaderHelper } from '../material';

/**
 * Linearize depth blitter
 * @public
 */
export class LinearizeDepthBlitter extends Blitter {
  private _nearFar: Vector2;
  constructor() {
    super();
    this._nearFar = new Vector2();
  }
  setCameraNearFar(n: number, f: number): this {
    this._nearFar.setXY(n, f);
    return this;
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
    scope.$l.nonLinearDepth = this.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType).r;
    return ShaderHelper.nonLinearDepthToLinearNormalized(scope, scope.nonLinearDepth, scope.cameraNearFar);
  }
  /**
   * {@inheritDoc Blitter.calcHash}
   * @override
   */
  protected calcHash(): string {
    return '';
  }
  /**
   * {@inheritDoc Blitter.setUniforms}
   * @override
   */
  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('cameraNearFar', this._nearFar);
  }
  /**
   * {@inheritDoc Blitter.setup}
   * @override
   */
  setup(scope: PBGlobalScope, _type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.cameraNearFar = pb.vec2().uniform(0);
    }
  }
}
