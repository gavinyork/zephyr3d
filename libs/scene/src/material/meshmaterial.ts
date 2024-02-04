import { BindGroup, GPUProgram, PBInsideFunctionScope, PBShaderExp, ProgramBuilder, Texture2D, TextureSampler, VertexSemantic } from "@zephyr3d/device";
import { RENDER_PASS_TYPE_DEPTH_ONLY, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP } from "../values";
import { Material } from "./material";
import { DrawContext, EnvironmentLighting, ShadowMapPass } from "../render";
import { ShaderFramework, encodeColorOutput, encodeNormalizedFloatToRGBA, nonLinearDepthToLinearNormalized } from "../shaders";
import { Application } from "../app";
import { Matrix4x4, Vector4 } from "@zephyr3d/base";

const allRenderPassTypes = [RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP, RENDER_PASS_TYPE_DEPTH_ONLY];

export type BlendMode = 'none'|'blend'|'additive'|'max'|'min'
export abstract class MeshMaterial extends Material {
  protected static readonly FEATURE_ALPHATEST = 'mm_alphatest';
  protected static readonly FEATURE_ALPHABLEND = 'mm_alphablend';
  private _features: Map<string, number>;
  private _featureStates: number[][];
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
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.updateBlendingState();
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
      this.updateBlendingState();
      this.useFeature(MeshMaterial.FEATURE_ALPHABLEND, this._opacity < 1, RENDER_PASS_TYPE_FORWARD);
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
   * Check if a feature is in use for given render pass type.
   * 
   * @param feature - The feature name
   * @param renderPassType - Render pass type
   * @returns true if the feature is in use, otherwise false.
   */
  protected featureUsed(feature: string, renderPassType: number[]|number = allRenderPassTypes) {
    if (typeof renderPassType === 'number') {
      renderPassType = [renderPassType];
    }
    const index = this._features.get(feature);
    if (index >= 0) {
      for (const type of renderPassType) {
        if (!!this._featureStates[type][index]) {
          return true;
        }
      }
    }
    return false;
  }
  /**
   * Use or unuse a feature of the material, this will cause the shader to be rebuild.
   * 
   * @param feature - Which feature will be used or unused
   * @param use - true if use the feature, otherwise false
   */
  protected useFeature(feature: string, use: number|boolean, renderPassType: number[]|number = allRenderPassTypes) {
    if (typeof renderPassType === 'number') {
      renderPassType = [renderPassType];
    }
    let index = this._features.get(feature);
    if (index === void 0) {
      index = this._featureStates.length;
      this._features.set(feature, index);
    }
    let changed = false;
    for (const type of renderPassType) {
      if (type !== RENDER_PASS_TYPE_FORWARD && type !== RENDER_PASS_TYPE_SHADOWMAP && type !== RENDER_PASS_TYPE_DEPTH_ONLY) {
        console.error(`useFeature(): invalid render pass type: ${type}`);
      }
      const val = Number(use);
      if (this._featureStates[type][index] !== val) {
        this._featureStates[type][index] = val;
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
   * Check if the color should be computed in fragment shader, this is required for forward render pass or alpha test is in use.
   * 
   * @param ctx - The drawing context
   * @returns - true if the color should be computed in fragment shader, otherwise false.
   */
  protected needColor(ctx: DrawContext) {
    return ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD || this._alphaCutoff > 0;
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
  protected static readonly FEATURE_VERTEX_COLOR = 'um_vertexcolor';
  protected static readonly FEATURE_ALBEDO_TEXTURE = 'um_albedo_map';
  protected static readonly FEATURE_ALBEDO_TEXTURE_MATRIX = 'um_albedo_map_matrix';
  protected static readonly FEATURE_ALBEDO_TEXCOORD_INDEX = 'um_albedo_texcoord';
  private _albedoColor: Vector4;
  private _albedoTexture: Texture2D;
  private _albedoSampler: TextureSampler;
  private _albedoTexCoordIndex: number;
  private _albedoTexCoordMatrix: Matrix4x4;
  constructor() {
    super();
    this._albedoColor = Vector4.one();
    this._albedoTexture = null;
    this._albedoSampler = null;
    this._albedoTexCoordIndex = 0;
    this._albedoTexCoordMatrix = null;
  }
  /** true if vertex color attribute presents */
  get vertexColor(): boolean {
    return this.featureUsed(NewUnlitMaterial.FEATURE_VERTEX_COLOR)
  }
  set vertexColor(val: boolean) {
    this.useFeature(NewUnlitMaterial.FEATURE_VERTEX_COLOR, !!val);
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
    this.useFeature(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE, !!tex);
    if (tex) {
      this.useFeature(NewUnlitMaterial.FEATURE_ALBEDO_TEXCOORD_INDEX, this._albedoTexCoordIndex);
    }
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
        this.useFeature(NewUnlitMaterial.FEATURE_ALBEDO_TEXCOORD_INDEX, this._albedoTexCoordIndex);
      }
    }
  }
  /** Albedo texture coordinate transform matrix */
  get albedoTexMatrix(): Matrix4x4 {
    return this._albedoTexCoordMatrix;
  }
  set albedoTexMatrix(val: Matrix4x4) {
    if (val !== this._albedoTexCoordMatrix) {
      this._albedoTexCoordMatrix = val;
      if (this._albedoTexture) {
        this.useFeature(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE_MATRIX, !!this._albedoTexCoordMatrix);
      }
    }
  }
  /**
   * {@inheritDoc MeshMaterial._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    super._applyUniforms(bindGroup, ctx);
    if (this.needColor(ctx)) {
      bindGroup.setValue('kkAlbedo', this._albedoColor);
      if (this.featureUsed(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
        bindGroup.setTexture('kkAlbedoTex', this._albedoTexture, this._albedoSampler);
        if (this.featureUsed(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE_MATRIX, ctx.renderPass.type)) {
          bindGroup.setValue('kkAlbedoTextureMatrix', this._albedoTexCoordMatrix);
        }
      }
    }
  }
  protected vertexShader(scope: PBInsideFunctionScope, ctx: DrawContext) {
    const that = this;
    const pb = scope.$builder;
    (function(this: PBInsideFunctionScope) {
      this.$inputs.pos = pb.vec3().attrib('position');
      if (that.needColor(ctx)) {
        if (that.featureUsed(NewUnlitMaterial.FEATURE_VERTEX_COLOR, ctx.renderPass.type)) {
          this.$inputs.kkVertexColor = pb.vec4().attrib('diffuse');
          this.$outputs.kkVertexColor = this.kkVertexColor;
        }
        if (that.featureUsed(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
          const semantic = `texCoord${that.albedoTexCoordIndex}` as VertexSemantic;
          if (!this.$getVertexAttrib(semantic)) {
            this.$inputs[semantic] = pb.vec2().attrib(semantic);
          }
          if (that.featureUsed(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE_MATRIX, ctx.renderPass.type)) {
            this.$g.kkAlbedoTextureMatrix = pb.mat4().uniform(2);
            this.$outputs.kkAlbedoTexCoord = pb.mul(this.kkAlbedoTextureMatrix, pb.vec4(this.$inputs[semantic], 0, 1)).xy;
          } else {
            this.$outputs.kkAlbedoTexCoord = this.$inputs[semantic];
          }
        }
      }
      ShaderFramework.ftransform(this);
    }).call(scope);
  }
  protected fragmentShader(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    return (function(this: PBInsideFunctionScope) {
      this.$g.kkAlbedo = pb.vec4().uniform(2);
      if (that.featureUsed(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
        this.$g.kkAlbedoTex = pb.tex2D().uniform(2);
      }
      this.$l.kkColor = this.kkAlbedo;
      if (that.featureUsed(NewUnlitMaterial.FEATURE_VERTEX_COLOR, ctx.renderPass.type)) {
        this.kkColor = pb.mul(this.kkColor, this.$getVertexAttrib('diffuse'));
      }
      if (that.featureUsed(NewUnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
        this.kkColor = pb.mul(this.kkColor, pb.textureSample(this.kkAlbedoTex, this.$inputs.kkAlbedoTexCoord));
      }
      return this.kkColor;
    }).call(scope);
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
          that.vertexShaderImpl(this, ctx, function(ctx){
            that.vertexShader(this, ctx);
          });
        });
      },
      fragment(pb) {
        pb.main(function(){
          that.fragmentShaderImpl(this, ctx, function(ctx){
            return that.fragmentShader(this, ctx);
          });
        });
      }
    });
    //console.log(program.getShaderSource('fragment'));
    return program;
  }
}

export class LitMaterial extends NewUnlitMaterial {
  protected static readonly FEATURE_DOUBLE_SIDED_LIGHTING = 'lm_doublesided_lighting';
  protected static readonly FEATURE_VERTEX_NORMAL = 'lm_vertexnormal';
  protected static readonly FEATURE_VERTEX_TANGENT = 'lm_vertextangent';
  protected static readonly FEATURE_NORMAL_TEXTURE = 'lm_normaltexture';
  protected static readonly FEATURE_NORMAL_TEXCOORD_INDEX = 'lm_normaltexcoord';
  protected static readonly FEATURE_NORMAL_TEXTURE_MATRIX = 'lm_normal_texture_matrix';
  protected static readonly FEATURE_OBJECT_SPACE_NORMALMAP = 'lm_objectspace_normalmap';
  private _normalTexture: Texture2D;
  private _normalSampler: TextureSampler;
  private _normalTexCoordIndex: number;
  private _normalTexCoordMatrix: Matrix4x4;
  private _normalScale: number;
  private _normalMapMode: 'tangent-space'|'object-space';
  constructor() {
    super();
    this._normalTexture = null;
    this._normalSampler = null;
    this._normalTexCoordIndex = 0;
    this._normalTexCoordMatrix = null;
    this._normalScale = 1;
    this._normalMapMode = 'tangent-space';
  }
  get normalScale(): number {
    return this._normalScale;
  }
  set normalScale(val: number) {
    this._normalScale = val;
  }
  get normalMapMode(): 'tangent-space'|'object-space' {
    return this._normalMapMode;
  }
  set normalMapMode(val: 'tangent-space'|'object-space') {
    this._normalMapMode = val;
    if (this._normalTexture) {
      this.useFeature(LitMaterial.FEATURE_OBJECT_SPACE_NORMALMAP, this._normalMapMode === 'object-space', RENDER_PASS_TYPE_FORWARD);
    }
  }
  /** true if double sided lighting is used */
  get doubleSidedLighting(): boolean {
    return this.featureUsed(LitMaterial.FEATURE_DOUBLE_SIDED_LIGHTING, RENDER_PASS_TYPE_FORWARD)
  }
  set doubleSidedLighting(val: boolean) {
    this.useFeature(LitMaterial.FEATURE_DOUBLE_SIDED_LIGHTING, !!val, RENDER_PASS_TYPE_FORWARD);
  }
  /** true if vertex normal attribute presents */
  get vertexNormal(): boolean {
    return this.featureUsed(LitMaterial.FEATURE_VERTEX_NORMAL)
  }
  set vertexNormal(val: boolean) {
    this.useFeature(LitMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex normal attribute presents */
  get vertexTangent(): boolean {
    return this.featureUsed(LitMaterial.FEATURE_VERTEX_TANGENT)
  }
  set vertexTangent(val: boolean) {
    this.useFeature(LitMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  /** Normal texture */
  get normalTexture(): Texture2D {
    return this._normalTexture;
  }
  set normalTexture(tex: Texture2D) {
    this.useFeature(LitMaterial.FEATURE_NORMAL_TEXTURE, !!tex);
    if (tex) {
      this.useFeature(LitMaterial.FEATURE_NORMAL_TEXCOORD_INDEX, this._normalTexCoordIndex);
    }
    this._normalTexture = tex ?? null;
  }
  /** Normal texture sampler */
  get normalTextureSampler(): TextureSampler {
    return this._normalSampler;
  }
  set normalTextureSampler(sampler: TextureSampler) {
    this._normalSampler = sampler ?? null;
  }
  /** Normal texture coordinate index */
  get normalTexCoordIndex(): number {
    return this._normalTexCoordIndex;
  }
  set normalTexCoordIndex(val: number) {
    if (val !== this._normalTexCoordIndex) {
      this._normalTexCoordIndex = val;
      if (this._normalTexture) {
        this.useFeature(LitMaterial.FEATURE_NORMAL_TEXCOORD_INDEX, this._normalTexCoordIndex);
      }
    }
  }
  /** Normal texture coordinate transform matrix */
  get normalTexMatrix(): Matrix4x4 {
    return this._normalTexCoordMatrix;
  }
  set normalTexMatrix(val: Matrix4x4) {
    if (val !== this._normalTexCoordMatrix) {
      this._normalTexCoordMatrix = val;
      if (this._normalTexture) {
        this.useFeature(LitMaterial.FEATURE_NORMAL_TEXTURE_MATRIX, !!this._normalTexCoordMatrix);
      }
    }
  }
  /**
   * Calculate the normal vector for current fragment
   * @param scope - The shader scope
   * @returns Normal vector for current fragment
   */
  calculateNormal(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const args: PBShaderExp[] = [];
    const params: PBShaderExp[] = [];
    const worldNormal = ShaderFramework.getWorldNormal(scope);
    const worldTangent = ShaderFramework.getWorldTangent(scope);
    const worldBinormal = ShaderFramework.getWorldBinormal(scope);
    if (worldNormal) {
      params.push(pb.vec3('worldNormal'));
      args.push(worldNormal);
      if (worldTangent) {
        params.push(pb.vec3('worldTangent'), pb.vec3('worldBinormal'));
        args.push(worldTangent, worldBinormal);
      }
    }
    pb.func('kkCalculateNormal', params, function(){
      const posW = ShaderFramework.getWorldPosition(this).xyz;
      this.$l.uv = that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE)
        ? scope.$inputs.kkNormalTexCoord ?? pb.vec2(0)
        : that.featureUsed(LitMaterial.FEATURE_ALBEDO_TEXTURE)
          ? scope.$inputs.kkAlbedoTexCoord ?? pb.vec2(0)
          : pb.vec2(0);
      this.$l.TBN = pb.mat3();
      if (!worldNormal) {
        this.$l.uv_dx = pb.dpdx(pb.vec3(this.uv, 0));
        this.$l.uv_dy = pb.dpdy(pb.vec3(this.uv, 0));
        this.$if(
          pb.lessThanEqual(pb.add(pb.length(this.uv_dx), pb.length(this.uv_dy)), 0.000001),
          function () {
            this.uv_dx = pb.vec3(1, 0, 0);
            this.uv_dy = pb.vec3(0, 1, 0);
          }
        );
        this.$l.t_ = pb.div(
          pb.sub(pb.mul(pb.dpdx(posW), this.uv_dy.y), pb.mul(pb.dpdy(posW), this.uv_dx.y)),
          pb.sub(pb.mul(this.uv_dx.x, this.uv_dy.y), pb.mul(this.uv_dx.y, this.uv_dy.x))
        );
        this.$l.ng = pb.normalize(pb.cross(pb.dpdx(posW), pb.dpdy(posW)));
        this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
        this.$l.b = pb.cross(this.ng, this.t);
        if (that.doubleSidedLighting) {
          this.$if(pb.not(this.$builtins.frontFacing), function () {
            this.t = pb.mul(this.t, -1);
            this.b = pb.mul(this.b, -1);
            this.ng = pb.mul(this.ng, -1);
          });
        }
        this.TBN = pb.mat3(this.t, this.b, this.ng);
      } else if (!worldTangent) {
        this.$l.uv_dx = pb.dpdx(pb.vec3(this.uv, 0));
        this.$l.uv_dy = pb.dpdy(pb.vec3(this.uv, 0));
        this.$if(
          pb.lessThanEqual(pb.add(pb.length(this.uv_dx), pb.length(this.uv_dy)), 0.000001),
          function () {
            this.uv_dx = pb.vec3(1, 0, 0);
            this.uv_dy = pb.vec3(0, 1, 0);
          }
        );
        this.$l.t_ = pb.div(
          pb.sub(pb.mul(pb.dpdx(posW), this.uv_dy.y), pb.mul(pb.dpdy(posW), this.uv_dx.y)),
          pb.sub(pb.mul(this.uv_dx.x, this.uv_dy.y), pb.mul(this.uv_dx.y, this.uv_dy.x))
        );
        this.$l.ng = pb.normalize(this.worldNormal);
        this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
        this.$l.b = pb.cross(this.ng, this.t);
        if (that.doubleSidedLighting) {
          this.$if(pb.not(this.$builtins.frontFacing), function () {
            this.t = pb.mul(this.t, -1);
            this.b = pb.mul(this.b, -1);
            this.ng = pb.mul(this.ng, -1);
          });
        }
        this.TBN = pb.mat3(this.t, this.b, this.ng);
      } else {
        this.TBN = pb.mat3(pb.normalize(this.worldTangent), pb.normalize(this.worldBinormal), pb.normalize(this.worldNormal));
      }
      if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE)) {
        if (that.featureUsed(LitMaterial.FEATURE_OBJECT_SPACE_NORMALMAP)) {
          const pixel = pb.sub(pb.mul(pb.textureSample(this.kkNormalTexture, this.uv).rgb, 2), pb.vec3(1));
          const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.kkNormalScale).xx, 1));
          this.$return(pb.normalize(normalTex));        
        } else {
          const pixel = pb.sub(pb.mul(pb.textureSample(this.kkNormalTexture, this.uv).rgb, 2), pb.vec3(1));
          const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.kkNormalScale).xx, 1));
          this.$return(pb.normalize(pb.mul(this.TBN, normalTex)));
        }
      } else {
        this.$return(this.TBN[2]);
      }
    });
    return pb.getGlobalScope().kkCalculateNormal(...args);
  }
  /**
   * {@inheritDoc NewUnlitMaterial._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    super._applyUniforms(bindGroup, ctx);
    if (this.needColor(ctx)) {
      if (this.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE, ctx.renderPass.type)) {
        bindGroup.setValue('kkNormalScale', this._normalScale);
        bindGroup.setTexture('kkNormalTexture', this._normalTexture, this._normalSampler);
        if (this.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE_MATRIX, ctx.renderPass.type)) {
          bindGroup.setValue('kkNormalTextureMatrix', this._normalTexCoordMatrix);
        }
      }
    }
  }
  protected vertexShader(scope: PBInsideFunctionScope, ctx: DrawContext): void {
    const that = this;
    const pb = scope.$builder;
    (function(this: PBInsideFunctionScope) {
      if (that.needColor(ctx)) {
        if (that.vertexNormal) {
          this.$inputs.normal = pb.vec3().attrib('normal');
        }
        if (that.vertexTangent) {
          this.$inputs.tangent = pb.vec4().attrib('tangent');
        }
        if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE)) {
          const semantic = `texCoord${that.normalTexCoordIndex}` as VertexSemantic;
          if (!this.$getVertexAttrib(semantic)) {
            this.$inputs[semantic] = pb.vec2().attrib(semantic);
          }
          if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE_MATRIX, ctx.renderPass.type)) {
            this.$g.kkNormalTextureMatrix = pb.mat4().uniform(2);
            this.$outputs.kkNormalTexCoord = pb.mul(this.kkNormalTextureMatrix, pb.vec4(this.$inputs[semantic], 0, 1)).xy;
          } else {
            this.$outputs.kkNormalTexCoord = this.$inputs[semantic];
          }
        }
      }
    }).call(scope);
    super.vertexShader(scope, ctx);
  }
  protected fragmentShader(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    const albedoColor = super.fragmentShader(scope, ctx);
    return (function(this: PBInsideFunctionScope) {
      if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE)) {
        this.$g.kkNormalTexture = pb.tex2D().uniform(2);
        this.$g.kkNormalScale = pb.float().uniform(2);
      }
      this.$l.albedoColor = albedoColor;
      this.$l.normal = that.calculateNormal(this);
      return pb.vec4(pb.mul(this.albedoColor.rgb, pb.add(pb.mul(this.normal, 0.5), pb.vec3(0.5))), 1);
    }).call(scope);
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;    
  }
}
