import type {
  BindGroup,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import {
  QUEUE_OPAQUE,
  QUEUE_TRANSPARENT,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../values';
import { Material } from './material';
import type { DrawContext, ShadowMapPass } from '../render';
import { encodeNormalizedFloatToRGBA } from '../shaders';
import { Application } from '../app';
import { ShaderHelper } from './shader/helper';

export type BlendMode = 'none' | 'blend' | 'additive';

export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

export type ExtractMixinReturnType<M> = M extends (target: infer A) => infer R ? R : never;

export type ExtractMixinType<M> = M extends [infer First]
  ? ExtractMixinReturnType<First>
  : M extends [infer First, ...infer Rest]
  ? ExtractMixinReturnType<First> & ExtractMixinType<[...Rest]>
  : never;

export function applyMaterialMixins<M extends ((target: any) => any)[], T>(
  target: T,
  ...mixins: M
): ExtractMixinType<M> {
  let r: any = target;
  for (const m of mixins) {
    r = m(r);
  }
  return r;
}

let FEATURE_ALPHATEST: number;
let FEATURE_ALPHABLEND: number;
let FEATURE_ALPHATOCOVERAGE: number;
export class MeshMaterial extends Material {
  static NEXT_FEATURE_INDEX: number = 3;
  private _featureStates: unknown[];
  private _alphaCutoff: number;
  private _blendMode: BlendMode;
  private _opacity: number;
  private _ctx: DrawContext;
  private _helper: typeof ShaderHelper;
  private _materialPass: number;
  constructor(...args: any[]) {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._opacity = 1;
    this._ctx = null;
    this._materialPass = -1;
    this._helper = ShaderHelper;
  }
  /** Define feature index */
  static defineFeature(): number {
    const val = this.NEXT_FEATURE_INDEX;
    this.NEXT_FEATURE_INDEX++;
    return val;
  }
  /** Shader helper */
  get helper(): typeof ShaderHelper {
    return this._helper;
  }
  /** Draw context for shader creation */
  get drawContext(): DrawContext {
    return this._ctx;
  }
  /** Current material pass */
  get pass(): number {
    return this._materialPass;
  }
  /** A value between 0 and 1, presents the cutoff for alpha testing */
  get alphaCutoff(): number {
    return this._alphaCutoff;
  }
  set alphaCutoff(val: number) {
    if (this._alphaCutoff !== val) {
      this.useFeature(FEATURE_ALPHATEST, val > 0);
      this._alphaCutoff = val;
      this.optionChanged(false);
    }
  }
  get alphaToCoverage(): boolean {
    return this.featureUsed(FEATURE_ALPHATOCOVERAGE);
  }
  set alphaToCoverage(val: boolean) {
    this.useFeature(FEATURE_ALPHATOCOVERAGE, !!val);
  }
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.useFeature(FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
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
      this.useFeature(FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
      this.optionChanged(false);
    }
  }
  /**
   * Update blending state according to draw context and current material pass
   * @param pass - Current material pass
   * @param ctx - Draw context
   */
  protected updateBlendingAndDepthState(pass: number, ctx: DrawContext): void {
    const blending = this.featureUsed<boolean>(FEATURE_ALPHABLEND) || ctx.lightBlending;
    const a2c = this.featureUsed<boolean>(FEATURE_ALPHATOCOVERAGE);
    if (blending || a2c) {
      const blendingState = this.stateSet.useBlendingState();
      if (blending) {
        blendingState.enable(true);
        blendingState.setBlendFuncAlpha('zero', 'one');
        blendingState.setBlendEquation('add', 'add');
        if (this._blendMode === 'additive' || ctx.lightBlending) {
          blendingState.setBlendFuncRGB('one', 'one');
        } else {
          blendingState.setBlendFuncRGB('one', 'inv-src-alpha');
        }
      } else {
        blendingState.enable(false);
      }
      blendingState.enableAlphaToCoverage(a2c);
      if (blendingState.enabled) {
        this.stateSet.useDepthState().enableTest(true).enableWrite(false);
      } else {
        this.stateSet.defaultDepthState();
      }
    } else if (this.stateSet.blendingState?.enabled && !blending) {
      this.stateSet.defaultBlendingState();
      this.stateSet.defaultDepthState();
    }
  }
  /**
   * Update Depth state according to draw context and current material pass
   * @param pass - Current material pass
   * @param ctx - Draw context
   */
  protected updateDepthState(pass: number, ctx: DrawContext): void {
    const blending = this.featureUsed<boolean>(FEATURE_ALPHABLEND);
    const a2c = this.featureUsed<boolean>(FEATURE_ALPHATOCOVERAGE);
    if (blending || a2c) {
      const blendingState = this.stateSet.useBlendingState();
      if (blending) {
        blendingState.enable(true);
        blendingState.setBlendFuncAlpha('zero', 'one');
        blendingState.setBlendEquation('add', 'add');
        if (this._blendMode === 'additive' || ctx.lightBlending) {
          blendingState.setBlendFuncRGB('one', 'one');
        } else {
          blendingState.setBlendFuncRGB('one', 'inv-src-alpha');
        }
      } else {
        blendingState.enable(false);
      }
      blendingState.enableAlphaToCoverage(a2c);
    } else if (this.stateSet.blendingState?.enabled && !blending) {
      this.stateSet.defaultBlendingState();
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    if (this.featureUsed(FEATURE_ALPHATEST)) {
      bindGroup.setValue('zAlphaCutoff', this._alphaCutoff);
    }
    if (this.featureUsed(FEATURE_ALPHABLEND)) {
      bindGroup.setValue('zOpacity', this._opacity);
    }
  }
  getQueueType(): number {
    return this.isTransparent(0) ? QUEUE_TRANSPARENT : QUEUE_OPAQUE;
  }
  /** true if the material is transparency */
  isTransparent(pass: number): boolean {
    return this.featureUsed(FEATURE_ALPHABLEND);
  }
  beginDraw(pass: number, ctx: DrawContext): boolean {
    this.updateBlendingAndDepthState(pass, ctx);
    return super.beginDraw(pass, ctx);
  }
  /** @internal */
  protected createProgram(ctx: DrawContext, pass: number): GPUProgram {
    const pb = new ProgramBuilder(Application.instance.device);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    return this._createProgram(pb, ctx, pass);
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
    return this._featureStates.map((val) => (val === undefined ? '' : val)).join('|');
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    this.applyUniformValues(bindGroup, ctx, pass);
  }
  /**
   * Check if the color should be computed in fragment shader, this is required for forward render pass or alpha test is in use or alpha to coverage is in use.
   *
   * @returns - true if the color should be computed in fragment shader, otherwise false.
   */
  needFragmentColor(ctx?: DrawContext): boolean {
    return (
      (ctx ?? this.drawContext).renderPass.type === RENDER_PASS_TYPE_LIGHT ||
      this._alphaCutoff > 0 ||
      this.alphaToCoverage
    );
  }
  /**
   * Vertex shader implementation of this material
   * @param scope - Shader scope
   */
  vertexShader(scope: PBFunctionScope): void {
    const pb = scope.$builder;
    this.helper.prepareVertexShader(pb, this.drawContext);
    if (this.drawContext.target.getBoneMatrices()) {
      scope.$inputs.zBlendIndices = pb.vec4().attrib('blendIndices');
      scope.$inputs.zBlendWeights = pb.vec4().attrib('blendWeights');
    }
  }
  /**
   * Fragment shader implementation of this material
   * @param scope - Shader scope
   */
  fragmentShader(scope: PBFunctionScope): void {
    const pb = scope.$builder;
    this.helper.prepareFragmentShader(pb, this.drawContext);
    if (this._alphaCutoff > 0) {
      scope.zAlphaCutoff = pb.float().uniform(2);
    }
    if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
      if (this.isTransparent(this.pass)) {
        scope.zOpacity = pb.float().uniform(2);
      }
    }
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext, pass: number): GPUProgram {
    const that = this;
    this._ctx = ctx;
    this._materialPass = pass;
    const program = pb.buildRenderProgram({
      vertex(pb) {
        pb.main(function () {
          that.vertexShader(this);
        });
      },
      fragment(pb) {
        this.$outputs.zFragmentOutput = pb.vec4();
        pb.main(function () {
          that.fragmentShader(this);
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
   *
   * @returns The final fragment color
   */
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_outputFragmentColor';
    pb.func(funcName, color ? [pb.vec4('color')] : [], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        that.helper.discardIfClipped(this);
        if (!that.isTransparent(that.pass) && !this.zAlphaCutoff && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (this.zOpacity) {
          this.outColor.a = pb.mul(this.outColor.a, this.zOpacity);
        }
        if (this.zAlphaCutoff) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        if (that.isTransparent(that.pass)) {
          this.outColor = pb.vec4(pb.mul(this.outColor.rgb, this.outColor.a), this.outColor.a);
        }
        that.helper.applyFog(this, this.outColor, that.drawContext);
        this.$outputs.zFragmentOutput = that.helper.encodeColorOutput(this, this.outColor);
      } else if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_DEPTH) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        that.helper.discardIfClipped(this);
        this.$l.depth = that.helper.nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
        if (Application.instance.device.type === 'webgl') {
          this.$outputs.zFragmentOutput = encodeNormalizedFloatToRGBA(this, this.depth);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4(this.depth, 0, 0, 1);
        }
      } /*if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP)*/ else {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        that.helper.discardIfClipped(this);
        const shadowMapParams = that.drawContext.shadowMapInfo.get(
          (that.drawContext.renderPass as ShadowMapPass).light
        );
        this.$outputs.zFragmentOutput = shadowMapParams.impl.computeShadowMapDepth(shadowMapParams, this);
      }
    });
    color ? pb.getGlobalScope()[funcName](color) : pb.getGlobalScope()[funcName]();
  }
}
FEATURE_ALPHATEST = MeshMaterial.defineFeature();
FEATURE_ALPHABLEND = MeshMaterial.defineFeature();
FEATURE_ALPHATOCOVERAGE = MeshMaterial.defineFeature();
