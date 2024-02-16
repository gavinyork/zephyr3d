import type {
  BindGroup,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { RENDER_PASS_TYPE_DEPTH_ONLY, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP } from '../values';
import { Material } from './material';
import type { DrawContext, ShadowMapPass } from '../render';
import {
  ShaderFramework,
  encodeColorOutput,
  encodeNormalizedFloatToRGBA,
  nonLinearDepthToLinearNormalized
} from '../shaders';
import { Application } from '../app';

export type BlendMode = 'none' | 'blend' | 'additive' | 'max' | 'min';

export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

export type ExtractMixinReturnType<M, T> = M extends (target: infer A) => infer R
  ? R
  : never;

/*
export type ExtractMixinType<M extends any[], T> = UnionToIntersection<
  M extends (infer K)[] ? ExtractMixinReturnType<K, T> : never
> &
  T;
*/
export type ExtractMixinType<M, T> =
  M extends [infer First]
    ? ExtractMixinReturnType<First, T>
    : M extends [infer First, ...infer Rest]
      ? ExtractMixinReturnType<First, T> & ExtractMixinType<[...Rest], T>
      : never

export function applyMaterialMixins<M extends ((target: any) => any)[], T>(
  target: T,
  ...mixins: M
): ExtractMixinType<M, T> {
  let r: any = target;
  for (const m of mixins) {
    r = m(r);
  }
  return r;
}

export class MeshMaterial extends Material {
  static readonly FEATURE_ALPHATEST = 0;
  static readonly FEATURE_ALPHABLEND = 1;
  static readonly FEATURE_ALPHATOCOVERAGE = 2;
  static readonly NEXT_FEATURE_INDEX: number = 3;
  private _featureStates: unknown[];
  private _alphaCutoff: number;
  private _blendMode: BlendMode;
  private _opacity: number;
  constructor(...args: any[]) {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._opacity = 1;
  }
  /** A value between 0 and 1, presents the cutoff for alpha testing */
  get alphaCutoff(): number {
    return this._alphaCutoff;
  }
  set alphaCutoff(val: number) {
    if (this._alphaCutoff !== val) {
      this.useFeature(MeshMaterial.FEATURE_ALPHATEST, val > 0);
      this._alphaCutoff = val;
      this.optionChanged(false);
    }
  }
  get alphaToCoverage(): boolean {
    return this.featureUsed(MeshMaterial.FEATURE_ALPHATOCOVERAGE);
  }
  set alphaToCoverage(val: boolean) {
    this.useFeature(MeshMaterial.FEATURE_ALPHATOCOVERAGE, !!val);
  }
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
    }
  }
  /** A value between 0 and 1, presents the opacity */
  get opacity(): number {
    return this._opacity;
  }
  set opacity(val: number) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (this._opacity !== val) {
      this._opacity = val;
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
      this.optionChanged(false);
    }
  }
  /** @internal */
  private updateBlendingState(ctx: DrawContext) {
    const blending = this.featureUsed<boolean>(MeshMaterial.FEATURE_ALPHABLEND);
    const a2c = this.featureUsed<boolean>(MeshMaterial.FEATURE_ALPHATOCOVERAGE);
    if (blending || a2c) {
      const blendingState = this.stateSet.useBlendingState();
      if (blending) {
        blendingState.enable(true);
        if (this._blendMode === 'additive') {
          blendingState.setBlendEquation('add', 'add');
          blendingState.setBlendFunc('one', 'one');
        } else if (this._blendMode === 'max') {
          blendingState.setBlendEquation('max', 'add');
          blendingState.setBlendFuncRGB('one', 'one');
          blendingState.setBlendFuncAlpha('zero', 'one');
        } else if (this._blendMode === 'min') {
          blendingState.setBlendEquation('min', 'add');
          blendingState.setBlendFuncRGB('one', 'one');
          blendingState.setBlendFuncAlpha('zero', 'one');
        } else {
          blendingState.setBlendEquation('add', 'add');
          blendingState.setBlendFunc('one', 'inv-src-alpha');
        }
      } else {
        blendingState.enable(false);
      }
      blendingState.enableAlphaToCoverage(a2c);
    } else if (this.stateSet.blendingState?.enabled && !blending) {
      this.stateSet.defaultBlendingState();
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
    if (this.featureUsed(MeshMaterial.FEATURE_ALPHATEST)) {
      bindGroup.setValue('kkAlphaCutoff', this._alphaCutoff);
    }
    if (this.featureUsed(MeshMaterial.FEATURE_ALPHABLEND)) {
      bindGroup.setValue('kkOpacity', this._opacity);
    }
  }
  /** true if the material is transparency */
  isTransparent(): boolean {
    return this.featureUsed(MeshMaterial.FEATURE_ALPHABLEND);
  }
  beginDraw(ctx: DrawContext): boolean {
    this.updateBlendingState(ctx);
    return super.beginDraw(ctx);
  }
  /** @internal */
  protected createProgram(ctx: DrawContext): GPUProgram {
    const pb = new ProgramBuilder(Application.instance.device);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    return this._createProgram(pb, ctx);
  }
  /**
   * Check if a feature is in use for given render pass type.
   *
   * @param feature - The feature index
   * @returns true if the feature is in use, otherwise false.
   */
  featureUsed<T = unknown>(feature: number): T {
    return this._featureStates[feature] as T;
  }
  /**
   * Use or unuse a feature of the material, this will cause the shader to be rebuild.
   *
   * @param feature - Which feature will be used or unused
   * @param use - true if use the feature, otherwise false
   */
  useFeature(feature: number, use: unknown) {
    if (this._featureStates[feature] !== use) {
      this._featureStates[feature] = use;
      this.optionChanged(true);
    }
  }
  /**
   * {@inheritDoc Material._createHash}
   * @override
   */
  protected _createHash(renderPassType: number): string {
    return this._featureStates.map(val => val === undefined ? '' : val).join('|');
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    this.applyUniformValues(bindGroup, ctx);
  }
  /**
   * Check if the color should be computed in fragment shader, this is required for forward render pass or alpha test is in use or alpha to coverage is in use.
   *
   * @param ctx - The drawing context
   * @returns - true if the color should be computed in fragment shader, otherwise false.
   */
  needFragmentColor(ctx: DrawContext): boolean {
    return ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD || this._alphaCutoff > 0 || this.alphaToCoverage;
  }
  /**
   * Transform vertex position to the clip space and calcuate the world position, world normal and tangent frame if needed
   *
   * @remarks
   * This function handles skin animation and geometry instancing if needed
   *
   * @param scope - Current shader scope
   */
  transformVertexAndNormal(scope: PBInsideFunctionScope) {
    ShaderFramework.ftransform(scope);
  }
  /**
   * Vertex shader implementation of this material
   * @param scope - Shader scope
   * @param ctx - The drawing context
   */
  vertexShader(scope: PBFunctionScope, ctx: DrawContext): void {
    const pb = scope.$builder;
    ShaderFramework.prepareVertexShader(pb, ctx);
    if (ctx.target.getBoneMatrices()) {
      scope.$inputs.kkBlendIndices = pb.vec4().attrib('blendIndices');
      scope.$inputs.kkBlendWeights = pb.vec4().attrib('blendWeights');
    }
  }
  /**
   * Fragment shader implementation of this material
   * @param scope - Shader scope
   * @param ctx - The drawing context
   */
  fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
    const pb = scope.$builder;
    ShaderFramework.prepareFragmentShader(pb, ctx);
    if (this._alphaCutoff > 0) {
      scope.$g.kkAlphaCutoff = pb.float().uniform(2);
    }
    if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      if (this.isTransparent()) {
        scope.$g.kkOpacity = pb.float().uniform(2);
      }
    }
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext): GPUProgram {
    const that = this;
    const program = pb.buildRenderProgram({
      vertex(pb) {
        pb.main(function () {
          that.vertexShader(this, ctx);
        });
      },
      fragment(pb) {
        this.$outputs.zFragmentOutput = pb.vec4();
        pb.main(function () {
          that.fragmentShader(this, ctx);
        });
      }
    });
    return program;
  }
  /**
   * Calculate final fragment color for output.
   *
   * @param scope - Shader scope
   * @param color - Lit fragment color
   * @param ctx - The drawing context
   *
   * @returns The final fragment color
   */
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp, ctx: DrawContext) {
    const pb = scope.$builder;
    const that = this;
    pb.func('zOutputFragmentColor', color ? [pb.vec4('color')] : [], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
        ShaderFramework.discardIfClipped(this);
        if (!that.isTransparent() && !this.kkAlphaCutoff && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (this.kkOpacity) {
          this.outColor.a = pb.mul(this.outColor.a, this.kkOpacity);
        }
        if (this.kkAlphaCutoff) {
          this.$if(pb.lessThan(this.outColor.a, this.kkAlphaCutoff), function () {
            pb.discard();
          });
        }
        if (that.isTransparent()) {
          this.outColor = pb.vec4(pb.mul(this.outColor.rgb, this.outColor.a), this.outColor.a);
        }
        ShaderFramework.applyFog(this, this.outColor, ctx);
        this.$outputs.zFragmentOutput = encodeColorOutput(this, this.outColor);
      } else if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.kkAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderFramework.discardIfClipped(this);
        this.$l.kkDepth = nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
        if (Application.instance.device.type === 'webgl') {
          this.$outputs.zFragmentOutput = encodeNormalizedFloatToRGBA(this, this.kkDepth);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4(this.kkDepth, 0, 0, 1);
        }
      } /*if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP)*/ else {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.kkAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderFramework.discardIfClipped(this);
        const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
        this.$outputs.zFragmentOutput = shadowMapParams.impl.computeShadowMapDepth(shadowMapParams, this);
      }
    });
    color ? pb.getGlobalScope().zOutputFragmentColor(color) : pb.getGlobalScope().zOutputFragmentColor();
  }
}
