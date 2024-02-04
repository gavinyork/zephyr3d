import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import { MeshMaterial } from './meshmaterial';
import { ShaderFramework } from '../shaders';
import type { BindGroup, GPUProgram, PBInsideFunctionScope, PBShaderExp, ProgramBuilder, Texture2D, TextureSampler } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { RENDER_PASS_TYPE_FORWARD } from '../values';

/**
 * Unlit material
 * @public
 */
export class UnlitMaterial extends MeshMaterial {
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
    return this.featureUsed(UnlitMaterial.FEATURE_VERTEX_COLOR, RENDER_PASS_TYPE_FORWARD)
  }
  set vertexColor(val: boolean) {
    this.useFeature(UnlitMaterial.FEATURE_VERTEX_COLOR, !!val);
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
    this.useFeature(UnlitMaterial.FEATURE_ALBEDO_TEXTURE, !!tex);
    if (tex) {
      this.useFeature(UnlitMaterial.FEATURE_ALBEDO_TEXCOORD_INDEX, this._albedoTexCoordIndex);
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
        this.useFeature(UnlitMaterial.FEATURE_ALBEDO_TEXCOORD_INDEX, this._albedoTexCoordIndex);
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
        this.useFeature(UnlitMaterial.FEATURE_ALBEDO_TEXTURE_MATRIX, !!this._albedoTexCoordMatrix);
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
      if (this.featureUsed(UnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
        bindGroup.setTexture('kkAlbedoTex', this._albedoTexture, this._albedoSampler);
        if (this.featureUsed(UnlitMaterial.FEATURE_ALBEDO_TEXTURE_MATRIX, ctx.renderPass.type)) {
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
        if (that.featureUsed(UnlitMaterial.FEATURE_VERTEX_COLOR, ctx.renderPass.type)) {
          this.$inputs.kkVertexColor = pb.vec4().attrib('diffuse');
          this.$outputs.kkVertexColor = this.kkVertexColor;
        }
        if (that.featureUsed(UnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
          const semantic = `texCoord${that.albedoTexCoordIndex}` as any;
          if (!this.$getVertexAttrib(semantic)) {
            this.$inputs[semantic] = pb.vec2().attrib(semantic);
          }
          if (that.featureUsed(UnlitMaterial.FEATURE_ALBEDO_TEXTURE_MATRIX, ctx.renderPass.type)) {
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
      if (that.featureUsed(UnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
        this.$g.kkAlbedoTex = pb.tex2D().uniform(2);
      }
      this.$l.kkColor = this.kkAlbedo;
      if (that.featureUsed(UnlitMaterial.FEATURE_VERTEX_COLOR, ctx.renderPass.type)) {
        this.kkColor = pb.mul(this.kkColor, this.$getVertexAttrib('diffuse'));
      }
      if (that.featureUsed(UnlitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)) {
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
    return program;
  }
}

