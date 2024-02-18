import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { TextureMixinInstanceTypes } from '../texture';
import { mixinTextureProps } from '../texture';
import type { IMixinPBRCommon } from './common';
import { mixinPBRCommon } from './common';
import type { DrawContext } from '../../../render';
import { Vector4 } from '@zephyr3d/base';

export type IMixinPBRSpecularGlossiness = {
  specularFactor: Vector4;
  glossinessFactor: number;
} & IMixinPBRCommon &
  TextureMixinInstanceTypes<['specular']>;

export function mixinPBRSpecularGlossness<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrSpecularGlossnessMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRSpecularGlossiness };
  }
  const S = applyMaterialMixins(BaseCls, mixinPBRCommon, mixinTextureProps('specular'));
  return class extends S {
    static readonly pbrSpecularGlossnessMixed = true;
    private _specularFactor: Vector4;
    private _glossinessFactor: number;
    constructor() {
      super();
      this._specularFactor = Vector4.one();
      this._glossinessFactor = 1;
    }
    get specularFactor(): Vector4 {
      return this._specularFactor;
    }
    set specularFactor(val: Vector4) {
      if (!val.equalsTo(this._specularFactor)) {
        this._specularFactor.set(val);
        this.optionChanged(true);
      }
    }
    get glossinessFactor(): number {
      return this._glossinessFactor;
    }
    set glossinessFactor(val: number) {
      if (val !== this._glossinessFactor) {
        this._glossinessFactor = val;
        this.optionChanged(false);
      }
    }
    fragmentShader(scope: PBFunctionScope): void {
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        const pb = scope.$builder;
        scope.kkSpecularFactor = pb.vec4().uniform(2);
        scope.kkGlossinessFactor = pb.float().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('kkSpecularFactor', this._specularFactor);
        bindGroup.setValue('kkGlossinessFactor', this._glossinessFactor);
      }
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      albedo: PBShaderExp,
      viewVec: PBShaderExp,
      TBN: PBShaderExp,
      data: PBShaderExp
    ): void {
      super.calculateCommonData(scope, albedo, viewVec, TBN, data);
      const pb = scope.$builder;
      if (this.specularTexture) {
        scope.$l.specularTextureSample = this.sampleSpecularTexture(scope);
        data.roughness = pb.sub(1, pb.mul(scope.kkGlossinessFactor, scope.specularTextureSample.a));
        data.f0 = pb.vec4(
          pb.mul(scope.specularTextureSample.rgb, scope.kkSpecularFactor.rgb),
          this.getF0(scope).a
        );
      } else {
        data.roughness = pb.sub(1, scope.kkGlossinessFactor);
        data.f0 = pb.vec4(scope.kkSpecularFactor.rgb, this.getF0(scope).a);
      }
      data.metallic = pb.max(pb.max(data.f0.r, data.f0.g), data.f0.b);
      data.diffuse = pb.vec4(pb.mul(albedo.rgb, pb.sub(1, data.metallic)), albedo.a);
      data.specularWeight = 1;
      data.f90 = pb.vec3(1);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRSpecularGlossiness };
}
