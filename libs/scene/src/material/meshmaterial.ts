import { BindGroup, GPUProgram, PBInsideFunctionScope, PBShaderExp, ProgramBuilder, Texture2D, TextureSampler } from "@zephyr3d/device";
import { RENDER_PASS_TYPE_DEPTH_ONLY, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP } from "../values";
import { Material } from "./material";
import { DrawContext, ShadowMapPass } from "../render";
import { ShaderFramework, encodeColorOutput, encodeNormalizedFloatToRGBA, nonLinearDepthToLinearNormalized } from "../shaders";
import { Application } from "../app";
import { Matrix4x4, Vector4 } from "@zephyr3d/base";

export type BlendMode = 'none'|'blend'|'additive'|'max'|'min'
export abstract class MeshMaterial extends Material {
  private _alphaCutoff: number;
  private _blendMode: BlendMode;
  private _opacity: number;
  constructor(){
    super();
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
      this.optionChanged(this._alphaCutoff === 0 || val === 0);
      this._alphaCutoff = val;
    }
  }
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    const lastBlending = this._blendMode !== 'none' || this._opacity < 1;
    if (this._blendMode !== val) {
      this._blendMode = val;
      const blending = this._blendMode !== 'none' || this._opacity < 1;
      const hashChanged = lastBlending !== blending;
      this.updateBlendingState();
      this.optionChanged(hashChanged);
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
      this.updateBlendingState();
      this.optionChanged(this._opacity === 1 || val === 1);
    }
  }
  /** @internal */
  private updateBlendingState() {
    const blending = this._blendMode !== 'none' || this._opacity < 1;
    if (blending) {
      const blendingState = this.stateSet.useBlendingState();
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
    } else if (this.stateSet.blendingState?.enabled && !blending) {
      this.stateSet.defaultBlendingState();
    }
  }
  /** true if the material is transparency */
  isTransparent(): boolean {
    return this._blendMode !== 'none' || this._opacity < 1;
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
   * {@inheritDoc Material._createHash}
   * @override
   */
  protected _createHash(renderPassType: number): string {
    return renderPassType === RENDER_PASS_TYPE_FORWARD || this._alphaCutoff > 0
      ? `|${Number(this.isTransparent())}|${Number(this._alphaCutoff > 0)}`
      : '';
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    if (this._alphaCutoff > 0) {
      bindGroup.setValue('kkAlphaCutoff', this._alphaCutoff);
    }
    if (this.isTransparent() && ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      bindGroup.setValue('kkOpacity', this._opacity);
    }
  }
  protected needColor(ctx: DrawContext) {
    return ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD || this._alphaCutoff > 0;
  }
  protected vertexShaderImpl(scope: PBInsideFunctionScope, ctx: DrawContext, shader: (this: PBInsideFunctionScope, ctx: DrawContext) => void) {
    const pb = scope.$builder;
    const g = scope.$builder.getGlobalScope();
    ShaderFramework.prepareVertexShader(pb, ctx);
    if (ctx.target.getBoneMatrices()) {
      g.$inputs.kkBlendIndices = pb.vec4().attrib('blendIndices');
      g.$inputs.kkBlendWeights = pb.vec4().attrib('blendWeights');
    }
    ShaderFramework.ftransform(scope);
    shader.call(scope, ctx);
  }
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
      if (!this.isTransparent() && !g.kkAlphaCutoff) {
        scope.kkColor.a = 1;
      } else if (g.kkOpacity) {
        scope.kkColor.a = pb.mul(scope.kkColor.a, g.kkOpacity);
      }
      if (g.kkAlphaCutoff) {
        scope.$if(pb.lessThan(scope.kkColor.a, scope.kkAlphaCutoff), function () {
          pb.discard();
        });
      }
      scope.kkColor = pb.vec4(pb.mul(scope.kkColor.rgb, scope.kkColor.a), scope.kkColor.a);
      ShaderFramework.applyFog(scope, scope.kkColor, ctx);
      g.$outputs.kkOutColor = encodeColorOutput(scope, scope.kkColor);
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
      if (g.kkAlphaCutoff) {
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

export class NewUnlitMaterial extends MeshMaterial {
  private _vertexColor: boolean;
  private _albedoColor: Vector4;
  private _albedoTexture: Texture2D;
  private _albedoSampler: TextureSampler;
  private _albedoTexCoordIndex: number;
  private _albedoTexCoordMatrix: Matrix4x4;
  constructor() {
    super();
    this._vertexColor = false;
    this._albedoColor = Vector4.one();
    this._albedoTexture = null;
    this._albedoSampler = null;
    this._albedoTexCoordIndex = 0;
    this._albedoTexCoordMatrix = null;
  }
  /** true if vertex color attribute presents */
  get vertexColor(): boolean {
    return this._vertexColor;
  }
  set vertexColor(val: boolean) {
    if (this._vertexColor !== !!val) {
      this._vertexColor = !!val;
      this.optionChanged(true);
    }
  }
  /** Albedo color */
  get albedoColor(): Vector4 {
    return this._albedoColor;
  }
  set albedoColor(val: Vector4) {
    this._albedoColor.set(val);
    this.optionChanged(false);
  }
  /** Albedo texture */
  get albedoTexture(): Texture2D {
    return this._albedoTexture;
  }
  set albedoTexture(tex: Texture2D) {
    this.optionChanged(!!this._albedoTexture !== !!tex);
    this._albedoTexture = tex ?? null;
  }
  /** Albedo texture sampler */
  get albedoTextureSampler(): TextureSampler {
    return this._albedoSampler;
  }
  set albedoTextureSampler(sampler: TextureSampler) {
    this._albedoSampler = sampler ?? null;
  }
  /** Albedo texture coordinate index */
  get albedoTexCoordIndex(): number {
    return this._albedoTexCoordIndex;
  }
  set albedoTexCoordIndex(val: number) {
    if (val !== this._albedoTexCoordIndex) {
      this._albedoTexCoordIndex = val;
      if (this._albedoTexture) {
        this.optionChanged(true);
      }
    }
  }
  /** Albedo texture coordinate transform matrix */
  get albedoTexMatrix(): Matrix4x4 {
    return this._albedoTexCoordMatrix;
  }
  set albedoTexMatrix(val: Matrix4x4) {
    if (val !== this._albedoTexCoordMatrix) {
      this.optionChanged(this._albedoTexture && !!val !== !!this._albedoTexCoordMatrix);
      this._albedoTexCoordMatrix = val;
    }
  }
  /**
   * {@inheritDoc MeshMaterial._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    super._applyUniforms(bindGroup, ctx);
    if (this.needColor(ctx)) {
      bindGroup.setValue('albedo', this._albedoColor);
      if (this._albedoTexture) {
        bindGroup.setTexture('albedoTex', this._albedoTexture, this._albedoSampler);
        if (this._albedoTexCoordMatrix) {
          bindGroup.setValue('texMatrix', this._albedoTexCoordMatrix);
        }
      }
    }
  }
  /**
   * {@inheritDoc MeshMaterial._createHash}
   * @override
   */
  protected _createHash(renderPassType: number): string {
    const hash = renderPassType === RENDER_PASS_TYPE_FORWARD || this.alphaCutoff > 0
      ? `|${Number(this._vertexColor)}|${Number(!!this._albedoTexture)}`
      : '';
    return `${super._createHash}${hash}`;
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext): GPUProgram {
    const that = this;
    const program = pb.buildRenderProgram({
      vertex(pb) {
        pb.main(function(){
          this.$inputs.pos = pb.vec3().attrib('position');
          that.vertexShaderImpl(this, ctx, function(ctx){
            if (that.needColor(ctx)) {
              if (that.vertexColor) {
                this.$inputs.color = pb.vec4().attrib('diffuse');
                this.$outputs.color = this.color;
              }
              if (that.albedoTexture) {
                this.$inputs.texcoord = pb.vec2().attrib(`texCoord${that.albedoTexCoordIndex}` as any);
                if (that.albedoTexMatrix) {
                  this.$g.texMatrix = pb.mat4().uniform(2);
                  this.$outputs.texcoord = pb.mul(this.texMatrix, pb.vec4(this.texcoord, 0, 1)).xy;
                } else {
                  this.$outputs.texcoord = this.texcoord;
                }
              }
            }
          });
        });
      },
      fragment(pb) {
        pb.main(function(){
          that.fragmentShaderImpl(this, ctx, function(ctx){
            this.$g.albedo = pb.vec4().uniform(2);
            if (that.albedoTexture) {
              this.$g.albedoTex = pb.tex2D().uniform(2);
            }
            this.$l.color = this.albedo;
            if (that.vertexColor) {
              this.color = pb.mul(this.color, this.$inputs.color);
            }
            if (that.albedoTexture) {
              this.color = pb.mul(this.color, pb.textureSample(this.albedoTex, this.$inputs.texcoord));
            }
            return this.color;
          });
        });
      }
    });
    //console.log(program.getShaderSource('fragment'));
    return program;
  }
}