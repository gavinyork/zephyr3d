import { BindGroup, GPUProgram, PBInsideFunctionScope, PBShaderExp, ProgramBuilder, Texture2D, TextureSampler, VertexSemantic } from "@zephyr3d/device";
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT, RENDER_PASS_TYPE_DEPTH_ONLY, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP } from "../values";
import { Material } from "./material";
import { DrawContext, EnvironmentLighting, ShadowMapPass } from "../render";
import { ShaderFramework, encodeColorOutput, encodeNormalizedFloatToRGBA, nonLinearDepthToLinear, nonLinearDepthToLinearNormalized } from "../shaders";
import { Application } from "../app";
import { Matrix4x4, Vector4 } from "@zephyr3d/base";
import { UnlitMaterial } from "./unlit";

const allRenderPassTypes = [RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP, RENDER_PASS_TYPE_DEPTH_ONLY];

export type BlendMode = 'none'|'blend'|'additive'|'max'|'min'
export abstract class MeshMaterial extends Material {
  protected static readonly FEATURE_ALPHATEST = 'mm_alphatest';
  protected static readonly FEATURE_ALPHABLEND = 'mm_alphablend';
  protected static readonly FEATURE_ALPHATOCOVERAGE = 'mm_alphatocoverage';
  private _features: Map<string, number>;
  private _featureStates: unknown[][];
  private _featureIndex: number;
  private _alphaCutoff: number;
  private _blendMode: BlendMode;
  private _opacity: number;
  constructor(){
    super();
    this._features = new Map();
    this._featureStates = [];
    this._featureStates[RENDER_PASS_TYPE_FORWARD] = [];
    this._featureStates[RENDER_PASS_TYPE_SHADOWMAP] = [];
    this._featureStates[RENDER_PASS_TYPE_DEPTH_ONLY] = [];
    this._featureIndex = 0;
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
    }
  }
  get alphaToCoverage(): boolean {
    return this.featureUsed(MeshMaterial.FEATURE_ALPHATOCOVERAGE, RENDER_PASS_TYPE_FORWARD);
  }
  set alphaToCoverage(val: boolean) {
    this.useFeature(MeshMaterial.FEATURE_ALPHATOCOVERAGE, !!val, RENDER_PASS_TYPE_FORWARD);
  }
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1, RENDER_PASS_TYPE_FORWARD)
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
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._opacity < 1, RENDER_PASS_TYPE_FORWARD);
    }
  }
  /** @internal */
  private updateBlendingState(ctx: DrawContext) {
    const blending = this.featureUsed<boolean>(MeshMaterial.FEATURE_ALPHABLEND, ctx.renderPass.type);
    const a2c = this.featureUsed<boolean>(MeshMaterial.FEATURE_ALPHATOCOVERAGE, ctx.renderPass.type);
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
  /** true if the material is transparency */
  isTransparent(): boolean {
    return this._blendMode !== 'none' || this._opacity < 1;
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
   * @param feature - The feature name
   * @param renderPassType - Render pass type
   * @returns true if the feature is in use, otherwise false.
   */
  protected featureUsed<T = unknown>(feature: string, renderPassType: number): T {
    const index = this._features.get(feature);
    return this._featureStates[renderPassType][index] as T;
  }
  /**
   * Use or unuse a feature of the material, this will cause the shader to be rebuild.
   *
   * @param feature - Which feature will be used or unused
   * @param use - true if use the feature, otherwise false
   */
  protected useFeature(feature: string, use: unknown, renderPassType: number[]|number = allRenderPassTypes) {
    if (typeof renderPassType === 'number') {
      renderPassType = [renderPassType];
    }
    let index = this._features.get(feature);
    if (index === void 0) {
      index = this._featureIndex++;
      this._features.set(feature, index);
    }
    let changed = false;
    for (const type of renderPassType) {
      if (type !== RENDER_PASS_TYPE_FORWARD && type !== RENDER_PASS_TYPE_SHADOWMAP && type !== RENDER_PASS_TYPE_DEPTH_ONLY) {
        console.error(`useFeature(): invalid render pass type: ${type}`);
      }
      if (this._featureStates[type][index] !== use) {
        this._featureStates[type][index] = use;
        changed = true;
      }
    }
    if (changed) {
      this.optionChanged(true);
    }
  }
  /**
   * {@inheritDoc Material._createHash}
   * @override
   */
  protected _createHash(renderPassType: number): string {
    return this._featureStates[renderPassType].join('');
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    if (this.featureUsed(MeshMaterial.FEATURE_ALPHATEST, ctx.renderPass.type)) {
      bindGroup.setValue('kkAlphaCutoff', this._alphaCutoff);
    }
    if (this.featureUsed(MeshMaterial.FEATURE_ALPHABLEND, ctx.renderPass.type)) {
      bindGroup.setValue('kkOpacity', this._opacity);
    }
  }
  /**
   * Check if the color should be computed in fragment shader, this is required for forward render pass or alpha test is in use or alpha to coverage is in use.
   *
   * @param ctx - The drawing context
   * @returns - true if the color should be computed in fragment shader, otherwise false.
   */
  protected needFragmentColor(ctx: DrawContext) {
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
  protected transformVertexAndNormal(scope: PBInsideFunctionScope) {
    ShaderFramework.ftransform(scope);
  }
  /**
   * The vertex shader implementation framework, this should be called in the entry function.
   *
   * @param scope - Entry function scope
   * @param ctx - The drawing context
   * @param shader - Shader generation function
   */
  protected vertexShaderImpl(scope: PBInsideFunctionScope, ctx: DrawContext, shader: (this: PBInsideFunctionScope, ctx: DrawContext) => void) {
    const pb = scope.$builder;
    const g = scope.$builder.getGlobalScope();
    ShaderFramework.prepareVertexShader(pb, ctx);
    if (ctx.target.getBoneMatrices()) {
      g.$inputs.kkBlendIndices = pb.vec4().attrib('blendIndices');
      g.$inputs.kkBlendWeights = pb.vec4().attrib('blendWeights');
    }
    shader.call(scope, ctx);
  }
  /**
   * The fragment shader implementation framework, this should be called in the entry function.
   *
   * @param scope - Entry function scope
   * @param ctx - The drawing context
   * @param shader - Shader generation function
   */
  protected fragmentShaderImpl(scope: PBInsideFunctionScope, ctx: DrawContext, shader: (this: PBInsideFunctionScope, ctx: DrawContext) => PBShaderExp) {
    const pb = scope.$builder;
    ShaderFramework.prepareFragmentShader(pb, ctx);
    const g = scope.$builder.getGlobalScope();
    if (this._alphaCutoff > 0) {
      g.kkAlphaCutoff = pb.float().uniform(2);
    }
    g.$outputs.kkOutColor = pb.vec4();
    if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      if (this.isTransparent()) {
        g.kkOpacity = pb.float().uniform(2);
      }
      scope.$l.kkColor = shader.call(scope, ctx);
      ShaderFramework.discardIfClipped(scope);
      if (!this.isTransparent() && !g.kkAlphaCutoff && !this.alphaToCoverage) {
        scope.kkColor.a = 1;
      } else if (g.kkOpacity) {
        scope.kkColor.a = pb.mul(scope.kkColor.a, g.kkOpacity);
      }
      if (g.kkAlphaCutoff) {
        scope.$if(pb.lessThan(scope.kkColor.a, scope.kkAlphaCutoff), function () {
          pb.discard();
        });
      }
      if (this.isTransparent()) {
        scope.kkColor = pb.vec4(pb.mul(scope.kkColor.rgb, scope.kkColor.a), scope.kkColor.a);
      }
      ShaderFramework.applyFog(scope, scope.kkColor, ctx);
      g.$outputs.kkOutColor = encodeColorOutput(scope, scope.kkColor);
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
      if (g.kkAlphaCutoff || this.alphaToCoverage) {
        scope.$l.kkColor = shader.call(scope, ctx);
        scope.$if(pb.lessThan(scope.kkColor.a, scope.kkAlphaCutoff), function () {
          pb.discard();
        });
      }
      ShaderFramework.discardIfClipped(scope);
      scope.$l.kkDepth = nonLinearDepthToLinearNormalized(scope, scope.$builtins.fragCoord.z);
      if (Application.instance.device.type === 'webgl') {
        g.$outputs.kkOutColor = encodeNormalizedFloatToRGBA(scope, scope.kkDepth);
      } else {
        g.$outputs.kkOutColor = pb.vec4(scope.kkDepth, 0, 0, 1);
      }
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      if (g.kkAlphaCutoff) {
        scope.$l.kkColor = shader.call(scope, ctx);
        scope.$if(pb.lessThan(scope.kkColor.a, scope.kkAlphaCutoff), function () {
          pb.discard();
        });
      }
      ShaderFramework.discardIfClipped(scope);
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      g.$outputs.kkOutColor = shadowMapParams.impl.computeShadowMapDepth(shadowMapParams, scope);
    }
  }
}

