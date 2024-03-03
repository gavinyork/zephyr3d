import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';

export type IMixinLambert = {
  lambertLight(scope: PBInsideFunctionScope, normal: PBShaderExp, albedo: PBShaderExp): PBShaderExp;
} & IMixinLight;

export function mixinLambert<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).lambertMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinLambert };
  }
  const S = applyMaterialMixins(BaseCls, mixinLight);
  return class extends S {
    protected static lambertMixed = true;
    constructor() {
      super();
    }
    lambertLight(scope: PBInsideFunctionScope, normal: PBShaderExp, albedo: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_lambertLight';
      const that = this;
      pb.func(funcName, [pb.vec3('normal'), pb.vec4('albedo')], function () {
        if (!that.needFragmentColor()) {
          this.$return(this.albedo.rgb);
        } else {
          if (that.needCalculateEnvLight()) {
            this.diffuseColor = that.getEnvLightIrradiance(this, this.normal);
          } else {
            this.diffuseColor = pb.vec3(0);
          }
          that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, shadow) {
            this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
            this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
            this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
            this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
            this.$l.diffuse = pb.mul(this.lightColor, this.NoL);
            if (shadow) {
              this.$l.shadow = pb.vec3(that.calculateShadow(this, this.NoL));
              this.diffuse = pb.mul(this.diffuse, this.shadow);
            }
            this.diffuseColor = pb.add(this.diffuseColor, this.diffuse);
          });
          this.$l.litColor = pb.mul(this.albedo.rgb, this.diffuseColor);
          this.$return(this.litColor);
        }
      });
      return pb.getGlobalScope()[funcName](normal, albedo);
    }
  } as unknown as T & { new (...args: any[]): IMixinLambert };
}
