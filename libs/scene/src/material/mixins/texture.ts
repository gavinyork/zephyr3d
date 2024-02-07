import type { PBFunctionScope, PBInsideFunctionScope, PBShaderExp, Texture2D, TextureSampler } from "@zephyr3d/device";
import type { IMeshMaterial } from "../meshmaterial";
import type { Matrix4x4 } from "@zephyr3d/base";
import type { DrawContext } from "../../render";

export type TextureProp<U extends string> = {
  [P in 'Texture'|'TextureSampler'|'TexCoordIndex'|'TexCoordMatrix' as `${U}${P}`]:
    P extends 'Texture' ? Texture2D :
    P extends 'TextureSampler' ? TextureSampler :
    P extends 'TexCoordIndex' ? number :
    P extends 'TexCoordMatrix' ? Matrix4x4 : never;
}

export type TexturePropUniforms<U extends string> = {
  [P in 'TextureUniform'|'TexCoord' as `get${Capitalize<U>}${P}`]: (scope: PBInsideFunctionScope) => PBShaderExp;
}

export function mixinTextureProps<U extends string>(name: U) {
  return function<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }){
    const capName = `${name[0].toUpperCase()}${name.slice(1)}`;
    const upperName = name.toUpperCase();
    const id = `mixinTexture${capName}`;
    const feature = `FEATURE_TEXTURE_${upperName}`;
    const featureTexIndex = `FEATURE_TEXTURE_TEXCOORD_INDEX_${upperName}`;
    const featureTexMatrix = `FEATURE_TEXTURE_TEXCOORD_MATRIX_${upperName}`;
    type FeatureType<U extends string> = { [P in `FEATURE_TEXTURE_${Uppercase<U>}`]: string };
    if ((BaseCls as any)[id]) {
      return BaseCls as { new (...args: any[]): T & TextureProp<U> & FeatureType<U> & TexturePropUniforms<U> };
    }
    const cls = class extends (BaseCls as ({ new (...args: any[]): IMeshMaterial })) {
      constructor(...args: any[]) {
        super(...args);
        let textureValue: Texture2D = null;
        let textureSampler: TextureSampler = null;
        let textureCoordIndex = 0;
        let textureCoordMatrix: Matrix4x4 = null;
        (this as any)[`get${capName}TextureUniform`] = function(scope: PBInsideFunctionScope){
          return scope.$builder.shaderKind === 'fragment' ? scope[`kk${capName}Tex`] : null;
        };
        (this as any)[`get${capName}TexCoord`] = function(scope: PBInsideFunctionScope){
          return scope.$builder.shaderKind === 'fragment' ? scope[`kk${capName}TexCoord`] : scope.$outputs[`kk${capName}TexCoord`];
        };
        Object.defineProperty(this, `${name}Texture`, {
          get: () => textureValue,
          set: newValue => {
            if (textureValue !== newValue) {
              textureValue = newValue ?? null;
              this.useFeature(feature, !!textureValue);
              if (textureValue) {
                this.useFeature(featureTexIndex, textureCoordIndex);
                this.useFeature(featureTexMatrix, !!textureCoordMatrix);
                this.optionChanged(false);
              }
            }
            textureValue = newValue;
          },
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(this, `${name}TextureSampler`, {
          get: () => textureSampler,
          set: newValue => textureSampler = newValue,
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(this, `${name}TexCoordIndex`, {
          get: () => textureCoordMatrix,
          set: newValue => {
            if (textureCoordMatrix !== newValue) {
              textureCoordMatrix = newValue;
              if (textureValue) {
                this.useFeature(featureTexMatrix, !!textureCoordMatrix);
              }
            }
          },
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(this, `${name}TexCoordMatrix`, {
          get: () => textureCoordIndex,
          set: newValue => {
            if (textureCoordIndex !== newValue) {
              textureCoordIndex = newValue;
              if (textureValue) {
                this.useFeature(featureTexIndex, textureCoordIndex);
              }
            }
          },
          enumerable: true,
          configurable: true
        });
      }
      vertexShader(scope: PBFunctionScope, ctx: DrawContext): void {
        super.vertexShader(scope, ctx);
        if (this.needFragmentColor(ctx)) {
          const pb = scope.$builder;
          if (this.featureUsed(feature, ctx.renderPass.type)) {
            const semantic = `texCoord${(this as any)[`${name}TexCoordIndex`]}` as any;
            if (!scope.$getVertexAttrib(semantic)) {
              scope.$inputs[semantic] = pb.vec2().attrib(semantic);
            }
            if (this.featureUsed(featureTexMatrix, ctx.renderPass.type)) {
              scope.$g[`kk${capName}TextureMatrix`] = pb.mat4().uniform(2);
              scope.$outputs[`kk${capName}TexCoord`] = pb.mul(scope[`kk${capName}TextureMatrix`], pb.vec4(scope.$inputs[semantic], 0, 1)).xy;
            } else {
              scope.$outputs[`kk${capName}TexCoord`] = scope.$inputs[semantic];
            }
          }
        }
      }
      fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
        super.fragmentShader(scope, ctx);
        if (this.needFragmentColor(ctx)) {
          const pb = scope.$builder;
          if (this.featureUsed(feature, ctx.renderPass.type)) {
            scope.$g[`kk${capName}Tex`] = pb.tex2D().uniform(2);
          }
        }
      }
    };
    cls[id] = true;
    cls[`FEATURE_TEXTURE_${upperName}`] = feature;
    return cls as unknown as { new (...args: any[]): T & TextureProp<U> & FeatureType<U> & TexturePropUniforms<U> };
  }
}
