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

export type PBRTextureNames = [
  'occlusion',
  'cheenColor',
  'sheenRoughness',
  'clearcoatIntensity',
  'clearcoatNormal',
  'clearcoatRoughness'
];
export type PBRToMixedTextureType<T> = T extends [infer First, ...infer Rest]
  ? [
      First extends string ? ReturnType<typeof mixinTextureProps<First>> : never,
      ...PBRToMixedTextureType<Rest>
    ]
  : [];

export type TextureMixinTypes<T> = ReturnType<
  typeof applyMaterialMixins<PBRToMixedTextureType<T>, typeof MeshMaterial>
>;

export type TextureMixinInstanceTypes<T> = TextureMixinTypes<T> extends { new (...args: any[]): infer U }
  ? U
  : never;

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

export type TexturePropUniforms<U extends string> = {
  [P in 'TextureUniform' | 'TexCoord' as `get${Capitalize<U>}${P}`]: (
    scope: PBInsideFunctionScope
  ) => PBShaderExp;
} & {
  [P in 'Texture' as `sample${Capitalize<U>}${P}`]: (scope: PBInsideFunctionScope, texCoord?: PBShaderExp) => PBShaderExp;
};

export function mixinTextureProps<U extends string>(name: U) {
  return function <T extends typeof MeshMaterial>(BaseCls: T, vertex = false) {
    const capName = `${name[0].toUpperCase()}${name.slice(1)}`;
    const id = `mixinTexture${capName}`;
    const feature = BaseCls.NEXT_FEATURE_INDEX;
    const featureTexIndex = BaseCls.NEXT_FEATURE_INDEX + 1;
    const featureTexMatrix = BaseCls.NEXT_FEATURE_INDEX + 2;
    if ((BaseCls as any)[id]) {
      return BaseCls as unknown as T & {
        new (...args: any[]): TextureProp<U> & TexturePropUniforms<U>;
      };
    }
    const cls = class extends BaseCls {
      static readonly NEXT_FEATURE_INDEX = BaseCls.NEXT_FEATURE_INDEX + 3;
      constructor(...args: any[]) {
        super(...args);
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
    };
    const proto: any = cls.prototype;
    const propTexture = `__${name}Texture`;
    const propSampler = `__${name}Sampler`;
    const propTexCoord = `__${name}TexCoordIndex`;
    const propMatrix = `__${name}TexMatrix`;
    proto[propTexture] = null;
    proto[propSampler] = null;
    proto[propTexCoord] = 0;
    proto[propMatrix] = null;
    proto[`sample${capName}Texture`] = function (scope: PBInsideFunctionScope, texCoord?: PBShaderExp): PBShaderExp {
      const tex = this[`get${capName}TextureUniform`](scope);
      const coord = texCoord ?? this[`get${capName}TexCoord`](scope);
      return scope.$builder.textureSample(tex, coord);
    };
    proto[`get${capName}TextureUniform`] = function (scope: PBInsideFunctionScope): PBShaderExp {
      return scope.$builder.shaderKind === 'fragment' ? scope[`z${capName}Tex`] : null;
    };
    proto[`get${capName}TexCoord`] = function (scope: PBInsideFunctionScope): PBShaderExp {
      if (proto[propTexCoord] < 0) {
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
        ? pb.mul(
            scope[`z${capName}TextureMatrix`],
            pb.vec4(scope.$inputs[`texCoord${proto[propTexCoord]}`], 0, 1)
          ).xy
        : scope.$inputs[`texCoord${proto[propTexCoord]}`];
    };
    Object.defineProperty(proto, `${name}Texture`, {
      get: function (): Texture2D {
        return this[propTexture];
      },
      set: function (newValue: Texture2D) {
        if (this[propTexture] !== newValue) {
          this[propTexture] = newValue ?? null;
          this.useFeature(feature, !!this[propTexture]);
          if (this[propTexture]) {
            this.useFeature(featureTexIndex, this[propTexCoord]);
            this.useFeature(featureTexMatrix, !!this[propMatrix]);
            this.optionChanged(false);
          }
        }
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(proto, `${name}TextureSampler`, {
      get: function (): TextureSampler {
        return this[propSampler];
      },
      set: function (newValue: TextureSampler) {
        this[propSampler] = newValue;
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(proto, `${name}TexCoordMatrix`, {
      get: function (): Matrix4x4 {
        return this[propMatrix];
      },
      set: function (newValue: Matrix4x4) {
        if (this[propMatrix] !== newValue) {
          this[propMatrix] = newValue;
          this.useFeature(featureTexMatrix, !!this[propMatrix]);
        }
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(proto, `${name}TexCoordIndex`, {
      get: function (): number {
        return this[propTexCoord];
      },
      set: function (newValue: number) {
        if (this[propTexCoord] !== newValue) {
          this[propTexCoord] = newValue;
          this.useFeature(featureTexIndex, this[propTexCoord]);
        }
      },
      enumerable: true,
      configurable: true
    });
    cls[id] = true;
    return cls as unknown as T & {
      new (...args: any[]): TextureProp<U> & TexturePropUniforms<U>;
    };
  };
}
