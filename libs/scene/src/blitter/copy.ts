import type { BlitType } from './blitter';
import { Blitter } from './blitter';
import type { PBShaderExp, PBInsideFunctionScope } from '@zephyr3d/device';

/**
 * Copy blitter
 * @public
 */
export class CopyBlitter extends Blitter {
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
    return this.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
  }
  /**
   * {@inheritDoc Blitter.calcHash}
   * @override
   */
  protected calcHash(): string {
    return '';
  }
}
