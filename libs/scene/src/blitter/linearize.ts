import type { BindGroup, PBShaderExp, PBInsideFunctionScope, PBGlobalScope } from '@zephyr3d/device';
import type { BlitType } from './blitter';
import { Blitter } from './blitter';
import { encodeNormalizedFloatToRGBA } from '../shaders/misc';
import { Vector2 } from '@zephyr3d/base';
import { ShaderHelper } from '../material';

/**
 * Depth linearize blitter
 * @public
 */
export class DepthLinearizeBlitter extends Blitter {
  /** @internal */
  protected _cameraNearFar: Vector2;
  /** @internal */
  protected _rgbaEncode: boolean;
  /** @internal */
  protected _outputComponent: number;
  /**
   * Creates an instance of GaussianBlurBlitter
   * @param phase - Blitter phase
   * @param kernalSize - kernel size
   * @param sigma - Gaussian standard deviation
   * @param blurSize - Blur radius
   */
  constructor() {
    super();
    this._cameraNearFar = new Vector2(0, 1);
    this._rgbaEncode = false;
    this._outputComponent = 0;
  }
  /** Camera near plane */
  get near() {
    return this._cameraNearFar.x;
  }
  set near(val) {
    this._cameraNearFar.x = val;
  }
  /** Camera far plane */
  get far() {
    return this._cameraNearFar.y;
  }
  set far(val) {
    this._cameraNearFar.y = val;
  }
  /** RGBA encode */
  get rgbaEncode() {
    return this._rgbaEncode;
  }
  set rgbaEncode(val) {
    if (this._rgbaEncode === !!val) {
      this._rgbaEncode = !!val;
      this.invalidateHash();
    }
  }
  /** Output component */
  get outputComponent() {
    return this._outputComponent;
  }
  set outputComponent(val) {
    if (this._outputComponent !== val) {
      this._outputComponent = val;
      this.invalidateHash();
    }
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
  /**
   * {@inheritDoc Blitter.setUniforms}
   * @override
   */
  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('cameraNearFar', this._cameraNearFar);
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
  ) {
    const that = this;
    const pb = scope.$builder;
    const srcTexel = this.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    scope.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(scope, srcTexel.r);
    if (that._rgbaEncode) {
      return encodeNormalizedFloatToRGBA(scope, scope.depth);
    } else {
      if (that._outputComponent === 0) {
        return pb.vec4(scope.depth, 0, 0, 1);
      } else if (that._outputComponent === 1) {
        return pb.vec4(0, scope.depth, 0, 1);
      } else {
        throw new Error('Invalid output component for depth linearization blitter');
      }
    }
  }
  /**
   * {@inheritDoc Blitter.calcHash}
   * @override
   */
  protected calcHash() {
    return `${this._rgbaEncode ? 1 : 0}-${this._outputComponent}`;
  }
}
