import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  TextureSampler
} from '@zephyr3d/device';
import type { MeshMaterial, applyMaterialMixins } from '../meshmaterial';
import type { Matrix4x4 } from '@zephyr3d/base';
import type { DrawContext } from '../../render';
import { Ref } from '../../app';

/**
 * ToMixedTextureType
 *
 * @public
 */
export type ToMixedTextureType<T> = T extends [infer First, ...infer Rest]
  ? [First extends string ? ReturnType<typeof mixinTextureProps<First>> : never, ...ToMixedTextureType<Rest>]
  : [];

/**
 * TextureMixinTypes
 *
 * @public
 */
export type TextureMixinTypes<T> = ReturnType<
  typeof applyMaterialMixins<ToMixedTextureType<T>, typeof MeshMaterial>
>;

/**
 * TextureMixinInstanceTypes
 *
 * @public
 */
export type TextureMixinInstanceTypes<T> = TextureMixinTypes<T> extends { new (...args: any[]): infer U }
  ? U
  : never;

/**
 * TextureProp
 *
 * @public
 */
export type TextureProp<U extends string> = {
  [P in 'Texture' | 'TextureSampler' | 'TexCoordIndex' | 'TexCoordMatrix' as `${U}${P}`]: P extends 'Texture'
    ? Texture2D
    : P extends 'TextureSampler'
    ? TextureSampler
    : P extends 'TexCoordIndex'
    ? number
    : P extends 'TexCoordMatrix'
    ? Matrix4x4
    : never;
};

/**
 * TexturePropUniforms
 *
 * @public
 */
export type TexturePropUniforms<U extends string> = {
  [P in 'TextureUniform' | 'TexCoord' as `get${Capitalize<U>}${P}`]: (
    scope: PBInsideFunctionScope
  ) => PBShaderExp;
} & {
  [P in 'Texture' as `sample${Capitalize<U>}${P}`]: (
    scope: PBInsideFunctionScope,
    texCoord?: PBShaderExp
  ) => PBShaderExp;
};

/**
 * Texture property mixin
 * @param name - Texture name
 * @returns Texture mixin
 *
 * @public
 */
export function mixinTextureProps<U extends string>(name: U) {
  return function <T extends typeof MeshMaterial>(BaseCls: T, vertex = false) {
    const capName = `${name[0].toUpperCase()}${name.slice(1)}`;
    const id = `mixinTexture${capName}`;
    let feature = 0;
    let featureTexIndex = 0;
    let featureTexMatrix = 0;
    if ((BaseCls as any)[id]) {
      return BaseCls as unknown as T & {
        new (...args: any[]): TextureProp<U> & TexturePropUniforms<U>;
      };
    }
    const cls = class extends (BaseCls as typeof MeshMaterial) {
      constructor() {
        super();
        const texture = new Ref<Texture2D>();
        let sampler: TextureSampler = null;
        let texCoord = 0;
        let matrix: Matrix4x4 = null;
        Object.defineProperty(this, `sample${capName}Texture`, {
          value: function (scope: PBInsideFunctionScope, texCoord?: PBShaderExp): PBShaderExp {
            const tex = this[`get${capName}TextureUniform`](scope);
            const coord = texCoord ?? this[`get${capName}TexCoord`](scope);
            return scope.$builder.textureSample(tex, coord);
          },
          writable: false,
          enumerable: false,
          configurable: false
        });
        Object.defineProperty(this, `get${capName}TextureUniform`, {
          value: function (scope: PBInsideFunctionScope): PBShaderExp {
            return scope.$builder.shaderKind === 'fragment' ? scope[`z${capName}Tex`] : null;
          },
          writable: false,
          enumerable: false,
          configurable: false
        });
        Object.defineProperty(this, `get${capName}TexCoord`, {
          value: function (scope: PBInsideFunctionScope): PBShaderExp {
            if (texCoord < 0) {
              return null;
            }
            const pb = scope.$builder;
            if ((pb.shaderKind === 'vertex') !== !!vertex) {
              throw new Error(
                `mixinTextureProps.get${capName}TexCoord(): must be called in ${
                  vertex ? 'vertex' : 'fragment'
                } stage`
              );
            }
            return scope.$builder.shaderKind === 'fragment'
              ? scope.$inputs[`z${capName}TexCoord`]
              : this.featureUsed(featureTexMatrix)
              ? pb.mul(scope[`z${capName}TextureMatrix`], pb.vec4(scope.$inputs[`texCoord${texCoord}`], 0, 1))
                  .xy
              : scope.$inputs[`texCoord${texCoord}`];
          },
          writable: false,
          enumerable: false,
          configurable: false
        });
        Object.defineProperty(this, `${name}Texture`, {
          get: function (): Texture2D {
            return texture.get();
          },
          set: function (newValue: Texture2D) {
            if (texture.get() !== newValue) {
              texture.set(newValue);
              this.useFeature(feature, !!newValue);
              if (newValue) {
                this.useFeature(featureTexIndex, texCoord);
                this.useFeature(featureTexMatrix, !!matrix);
                this.uniformChanged();
              }
            }
          },
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(this, `${name}TextureSampler`, {
          get: function (): TextureSampler {
            return sampler;
          },
          set: function (newValue: TextureSampler) {
            sampler = newValue;
          },
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(this, `${name}TexCoordMatrix`, {
          get: function (): Matrix4x4 {
            return matrix;
          },
          set: function (newValue: Matrix4x4) {
            if (matrix !== newValue) {
              matrix = newValue;
              this.useFeature(featureTexMatrix, !!matrix);
            }
          },
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(this, `${name}TexCoordIndex`, {
          get: function (): number {
            return texCoord;
          },
          set: function (newValue: number) {
            if (texCoord !== newValue) {
              texCoord = newValue;
              this.useFeature(featureTexIndex, texCoord);
            }
          },
          enumerable: true,
          configurable: true
        });
      }
      copyFrom(other: any): void {
        super.copyFrom(other);
        const that = this as any;
        that[`${name}Texture`] = other[`${name}Texture`];
        that[`${name}TextureSampler`] = other[`${name}TextureSampler`];
        that[`${name}TexCoordMatrix`] = other[`${name}TexCoordMatrix`];
        that[`${name}TexCoordIndex`] = other[`${name}TexCoordIndex`];
      }
      vertexShader(scope: PBFunctionScope): void {
        super.vertexShader(scope);
        if (vertex || this.needFragmentColor()) {
          const pb = scope.$builder;
          const that = this as any;
          if (this.featureUsed(feature)) {
            const texCoordIndex: number = that[`${name}TexCoordIndex`];
            if (texCoordIndex >= 0) {
              const semantic = `texCoord${that[`${name}TexCoordIndex`]}` as any;
              if (!scope.$getVertexAttrib(semantic)) {
                scope.$inputs[semantic] = pb.vec2().attrib(semantic);
              }
              if (this.featureUsed(featureTexMatrix)) {
                scope[`z${capName}TextureMatrix`] = pb.mat4().uniform(2);
                if (!vertex) {
                  scope.$outputs[`z${capName}TexCoord`] = pb.mul(
                    scope[`z${capName}TextureMatrix`],
                    pb.vec4(scope.$inputs[semantic], 0, 1)
                  ).xy;
                }
              } else if (!vertex) {
                scope.$outputs[`z${capName}TexCoord`] = scope.$inputs[semantic];
              }
            }
          }
        }
      }
      fragmentShader(scope: PBFunctionScope): void {
        super.fragmentShader(scope);
        if (this.needFragmentColor()) {
          const pb = scope.$builder;
          if (this.featureUsed(feature)) {
            scope[`z${capName}Tex`] = pb.tex2D().uniform(2);
          }
        }
      }
      applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
        super.applyUniformValues(bindGroup, ctx, pass);
        if (this.needFragmentColor(ctx)) {
          if (this.featureUsed(feature)) {
            const that = this as any;
            bindGroup.setTexture(`z${capName}Tex`, that[`${name}Texture`], that[`${name}TextureSampler`]);
            if (this.featureUsed(featureTexMatrix)) {
              bindGroup.setValue(`z${capName}TextureMatrix`, that[`${name}TexCoordMatrix`]);
            }
          }
        }
      }
      dispose() {
        super.dispose();
        (this as any)[`${name}Texture`] = null;
      }
    };
    feature = cls.defineFeature();
    featureTexIndex = cls.defineFeature();
    featureTexMatrix = cls.defineFeature();
    cls[id] = true;
    return cls as unknown as T & {
      new (...args: any[]): TextureProp<U> & TexturePropUniforms<U>;
    };
  };
}
