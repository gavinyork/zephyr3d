import type {
  BindGroup,
  FaceMode,
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

/**
 * Blending mode for mesh material
 * @public
 */
export type BlendMode = 'none' | 'blend' | 'additive';

/**
 * Convert union type to intersection
 * @public
 */
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

/**
 * Extract mixin return type
 * @public
 */
export type ExtractMixinReturnType<M> = M extends (target: infer A) => infer R ? R : never;

/**
 * Extract mixin type
 * @public
 */
export type ExtractMixinType<M> = M extends [infer First]
  ? ExtractMixinReturnType<First>
  : M extends [infer First, ...infer Rest]
  ? ExtractMixinReturnType<First> & ExtractMixinType<[...Rest]>
  : never;

/**
 * Apply material mixins to specific material class
 * @param target - Material class
 * @param mixins - mixins
 * @returns Mixed mesh material class
 *
 * @public
 */
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

let FEATURE_ALPHATEST = 0;
let FEATURE_ALPHABLEND = 0;
let FEATURE_ALPHATOCOVERAGE = 0;

/**
 * Base class for any kind of mesh materials
 *
 * @public
 */
export class MeshMaterial extends Material {
  /** @internal */
  static NEXT_FEATURE_INDEX = 3;
  /** @internal */
  private _featureStates: unknown[];
  /** @internal */
  private _alphaCutoff: number;
  /** @internal */
  private _blendMode: BlendMode;
  /** @internal */
  private _cullMode: FaceMode;
  /** @internal */
  private _opacity: number;
  /** @internal */
  private _ctx: DrawContext;
  /** @internal */
  private _materialPass: number;
  /**
   * Creates an instance of MeshMaterial class
   * @param args - constructor arguments
   */
  constructor(...args: any[]) {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._cullMode = 'back';
    this._opacity = 1;
    this._ctx = null;
    this._materialPass = -1;
  }
  /** Indicate that the uniform has changed and needs to be resubmitted. */
  uniformChanged() {
    this.optionChanged(false);
  }
  /** Define feature index */
  static defineFeature(): number {
    const val = this.NEXT_FEATURE_INDEX;
    this.NEXT_FEATURE_INDEX++;
    return val;
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
      this.uniformChanged();
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
  /** Cull mode */
  get cullMode(): FaceMode {
    return this._cullMode;
  }
  set cullMode(val: FaceMode) {
    this._cullMode = val;
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
      this.uniformChanged();
    }
  }
  /** Returns true if shading of the material will be affected by lights  */
  supportLighting(): boolean {
    return true;
  }
  /**
   * Update render states according to draw context and current material pass
   * @param pass - Current material pass
   * @param ctx - Draw context
   */
  protected updateRenderStates(pass: number, ctx: DrawContext): void {
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
    if (this._cullMode !== 'back') {
      this.stateSet.useRasterizerState().cullMode = this._cullMode;
    } else {
      this.stateSet.defaultRasterizerState();
    }
  }
  /**
   * Submit Uniform values before rendering with this material.
   *
   * @param bindGroup - Bind group for this material
   * @param ctx - Draw context
   * @param pass - Current pass of the material
   */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    if (this.featureUsed(FEATURE_ALPHATEST)) {
      bindGroup.setValue('zAlphaCutoff', this._alphaCutoff);
    }
    if (this.featureUsed(FEATURE_ALPHABLEND)) {
      bindGroup.setValue('zOpacity', this._opacity);
    }
  }
  /**
   * Determine which queue should be used to render this material.
   * @returns QUEUE_TRANSPARENT or QUEUE_OPAQUE
   */
  getQueueType(): number {
    return this.isTransparentPass(0) ? QUEUE_TRANSPARENT : QUEUE_OPAQUE;
  }
  /**
   * Determine if a certain pass of this material is translucent.
   * @param pass - Pass of the material
   * @returns True if it is translucent, otherwise false.
   */
  isTransparentPass(pass: number): boolean {
    return this.featureUsed(FEATURE_ALPHABLEND);
  }
  /**
   * {@inheritdoc Material.beginDraw}
   */
  beginDraw(pass: number, ctx: DrawContext): boolean {
    this.updateRenderStates(pass, ctx);
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
   *
   * @internal
   */
  protected _createHash(renderPassType: number): string {
    return this._featureStates.map((val) => (val === undefined ? '' : val)).join('|');
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   *
   * @internal
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
    ShaderHelper.prepareVertexShader(pb, this.drawContext);
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
    ShaderHelper.prepareFragmentShader(pb, this.drawContext);
    if (this._alphaCutoff > 0) {
      scope.zAlphaCutoff = pb.float().uniform(2);
    }
    if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
      if (this.isTransparentPass(this.pass)) {
        scope.zOpacity = pb.float().uniform(2);
      }
    }
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   *
   * @internal
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
    /*
    if (program) {
      console.log(program.getShaderSource('vertex'));
      console.log(program.getShaderSource('fragment'));
    }
    */
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
  outputFragmentColor(scope: PBInsideFunctionScope, worldPos: PBShaderExp, color: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_outputFragmentColor';
    pb.func(funcName, color ? [pb.vec3('worldPos'), pb.vec4('color')] : [pb.vec3('worldPos')], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        ShaderHelper.discardIfClipped(this, this.worldPos);
        if (!that.isTransparentPass(that.pass) && !this.zAlphaCutoff && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (this.zOpacity) {
          this.outColor.a = pb.mul(this.outColor.a, this.zOpacity);
        }
        if (this.zAlphaCutoff) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        if (that.isTransparentPass(that.pass)) {
          this.outColor = pb.vec4(pb.mul(this.outColor.rgb, this.outColor.a), this.outColor.a);
        }
        ShaderHelper.applyFog(this, this.worldPos, this.outColor, that.drawContext);
        this.$outputs.zFragmentOutput = ShaderHelper.encodeColorOutput(this, this.outColor);
      } else if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_DEPTH) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderHelper.discardIfClipped(this, this.worldPos);
        this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
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
        ShaderHelper.discardIfClipped(this, this.worldPos);
        const shadowMapParams = that.drawContext.shadowMapInfo.get(
          (that.drawContext.renderPass as ShadowMapPass).light
        );
        this.$outputs.zFragmentOutput = shadowMapParams.impl.computeShadowMapDepth(
          shadowMapParams,
          this,
          this.worldPos
        );
      }
    });
    color ? pb.getGlobalScope()[funcName](worldPos, color) : pb.getGlobalScope()[funcName](worldPos);
  }
}
FEATURE_ALPHATEST = MeshMaterial.defineFeature();
FEATURE_ALPHABLEND = MeshMaterial.defineFeature();
FEATURE_ALPHATOCOVERAGE = MeshMaterial.defineFeature();
