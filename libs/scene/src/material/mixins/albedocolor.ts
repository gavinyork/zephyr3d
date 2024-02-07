import { Matrix4x4, Vector4 } from "@zephyr3d/base";
import type { IMeshMaterial } from "../meshmaterial";
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp, Texture2D, TextureSampler } from "@zephyr3d/device";
import type { DrawContext } from "../../render";

export interface IMixinAlbedoColor {
  albedoColor: Vector4;
  albedoTexture: Texture2D;
  albedoTextureSampler: TextureSampler;
  albedoTexCoordIndex: number;
  albedoTexMatrix: Matrix4x4;
  calculateAlbedoColor(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp;
}

function mixinAlbedoColor<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).albedoColorMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinAlbedoColor };
  }
  const FEATURE_ALBEDO_MAP = 'z-feature-albedo-map';
  const FEATURE_ALBEDO_TEXCOORD_INDEX = 'z-feature-albedo-texcoord-index';
  const FEATURE_ALBEDO_TEXCOORD_MATRIX = 'z-feature-albedo-texcoord-matrix';
  return class extends (BaseCls as { new (...args: any[]): IMeshMaterial }) {
    static albedoColorMixed = true;
    private _albedoColor: Vector4;
    private _albedoTexture: Texture2D;
    private _albedoSampler: TextureSampler;
    private _albedoTexCoordIndex: number;
    private _albedoTexCoordMatrix: Matrix4x4;
    constructor(...args: any[]) {
      super(...args);
      this._albedoColor = Vector4.one();
      this._albedoTexture = null;
      this._albedoSampler = null;
      this._albedoTexCoordIndex = 0;
      this._albedoTexCoordMatrix = null;
    }
    /** Albedo color */
    get albedoColor(): Vector4 {
      return this._albedoColor;
    }
    set albedoColor(val: Vector4) {
      this._albedoColor.set(val);
      this.optionChanged(false);
    }
    /** Albedo texture coordinate index */
    get albedoTexCoordIndex(): number {
      return this._albedoTexCoordIndex;
    }
    set albedoTexCoordIndex(val: number) {
      if (val !== this._albedoTexCoordIndex) {
        this._albedoTexCoordIndex = val;
        if (this._albedoTexture) {
          this.useFeature(FEATURE_ALBEDO_TEXCOORD_INDEX, this._albedoTexCoordIndex);
        }
      }
    }
    /** Albedo texture */
    get albedoTexture(): Texture2D {
      return this._albedoTexture;
    }
    set albedoTexture(tex: Texture2D) {
      if (this._albedoTexture !== tex) {
        this.useFeature(FEATURE_ALBEDO_MAP, !!tex);
        if (tex) {
          this.useFeature(FEATURE_ALBEDO_TEXCOORD_INDEX, this._albedoTexCoordIndex);
          this.useFeature(FEATURE_ALBEDO_TEXCOORD_MATRIX, !!this._albedoTexCoordMatrix);
        }
        this._albedoTexture = tex ?? null;
        this.optionChanged(false);
      }
    }
    /** Albedo texture sampler */
    get albedoTextureSampler(): TextureSampler {
      return this._albedoSampler;
    }
    set albedoTextureSampler(sampler: TextureSampler) {
      this._albedoSampler = sampler ?? null;
    }
    /** Albedo texture coordinate transform matrix */
    get albedoTexMatrix(): Matrix4x4 {
      return this._albedoTexCoordMatrix;
    }
    set albedoTexMatrix(val: Matrix4x4) {
      if (val !== this._albedoTexCoordMatrix) {
        this._albedoTexCoordMatrix = val;
        if (this._albedoTexture) {
          this.useFeature(FEATURE_ALBEDO_TEXCOORD_MATRIX, !!this._albedoTexCoordMatrix);
        }
        this.optionChanged(false);
      }
    }
    calculateAlbedoColor(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
      if (!this.needFragmentColor(ctx)) {
        throw new Error('mixinAlbedoColor.calculateAlbedoColor(): No need to calculate albedo color, make sure needFragmentColor() returns true');
      }
      const pb = scope.$builder;
      let color = scope.kkAlbedo;
      if (this.featureUsed(FEATURE_ALBEDO_MAP, ctx.renderPass.type)) {
        color = pb.mul(color, pb.textureSample(scope.kkAlbedoTex, scope.$inputs.kkAlbedoTexCoord));
      }
      return color;
    }
    vertexShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.vertexShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
        if (this.featureUsed(FEATURE_ALBEDO_MAP, ctx.renderPass.type)) {
          const semantic = `texCoord${this.albedoTexCoordIndex}` as any;
          if (!scope.$getVertexAttrib(semantic)) {
            scope.$inputs[semantic] = pb.vec2().attrib(semantic);
          }
          if (this.featureUsed(FEATURE_ALBEDO_TEXCOORD_MATRIX, ctx.renderPass.type)) {
            scope.$g.kkAlbedoTextureMatrix = pb.mat4().uniform(2);
            scope.$outputs.kkAlbedoTexCoord = pb.mul(scope.kkAlbedoTextureMatrix, pb.vec4(scope.$inputs[semantic], 0, 1)).xy;
          } else {
            scope.$outputs.kkAlbedoTexCoord = scope.$inputs[semantic];
          }
        }
      }
    }
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
        scope.$g.kkAlbedo = pb.vec4().uniform(2);
        if (this.featureUsed(FEATURE_ALBEDO_MAP, ctx.renderPass.type)) {
          scope.$g.kkAlbedoTex = pb.tex2D().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('kkAlbedo', this._albedoColor);
        if (this.featureUsed(FEATURE_ALBEDO_MAP, ctx.renderPass.type)) {
          bindGroup.setTexture('kkAlbedoTex', this._albedoTexture, this._albedoSampler);
          if (this.featureUsed(FEATURE_ALBEDO_TEXCOORD_MATRIX, ctx.renderPass.type)) {
            bindGroup.setValue('kkAlbedoTextureMatrix', this._albedoTexCoordMatrix);
          }
        }
      }
    }
  } as unknown as { new (...args: any[]): T & IMixinAlbedoColor };
}

export { mixinAlbedoColor };
