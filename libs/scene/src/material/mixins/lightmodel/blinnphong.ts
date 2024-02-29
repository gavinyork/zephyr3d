import { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from "@zephyr3d/device";
import { MeshMaterial, applyMaterialMixins } from "../../meshmaterial";
import { IMixinLight, mixinLight } from "../lit";
import { DrawContext } from "../../../render";

export type IMixinBlinnPhong = {
  shininess: number;
  blinnPhongLight(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp, albedo: PBShaderExp): PBShaderExp;
} & IMixinLight;

export function mixinBlinnPhong<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).blinnPhongMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinBlinnPhong };
  }
  const S = applyMaterialMixins(BaseCls, mixinLight);
  return class extends S {
    protected static blinnPhongMixed = true;
    private _shininess: number;
    constructor() {
      super();
      this._shininess = 32;
    }
    /** Shininess */
    get shininess(): number {
      return this._shininess;
    }
    set shininess(val: number) {
      if (val !== this._shininess) {
        this._shininess = val;
        this.optionChanged(false);
      }
    }
    fragmentShader(scope: PBFunctionScope): void {
      super.fragmentShader(scope);
      const pb = scope.$builder;
      if (this.needFragmentColor()) {
        scope.zShininess = pb.float().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor()){
        bindGroup.setValue('zShininess', this._shininess);
      }
    }
    blinnPhongLight(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp, albedo: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_BlinnPhongLight';
      const that = this;
      pb.func(funcName, [pb.vec3('normal'), pb.vec3('viewVec'), pb.vec4('albedo')], function(){
        if (!that.needFragmentColor()){
          this.$return(this.albedo.rgb);
        } else {
          if (that.needCalculateEnvLight()) {
            this.diffuseColor = that.getEnvLightIrradiance(this, this.normal);
          } else {
            this.diffuseColor = pb.vec3(0);
          }
          this.$l.specularColor = pb.vec3(0);
          that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, shadow) {
            this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
            this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
            this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
            this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
            this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
            this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
            this.$l.diffuse = pb.mul(this.lightColor, this.NoL);
            this.$l.specular = pb.mul(this.lightColor, pb.pow(this.NoH, this.zShininess));
            if (shadow) {
              this.$l.shadow = pb.vec3(that.calculateShadow(this, this.NoL));
              this.diffuse = pb.mul(this.diffuse, this.shadow);
              this.specular = pb.mul(this.specular, this.shadow);
            }
            this.diffuseColor = pb.add(this.diffuseColor, this.diffuse);
            this.specularColor = pb.add(this.specularColor, this.specular);
          });
          this.$l.litColor = pb.add(pb.mul(this.albedo.rgb, this.diffuseColor), this.specularColor);
          this.$return(this.litColor);
        }
      });
      return pb.getGlobalScope()[funcName](normal, viewVec, albedo);
    }
  } as unknown as T & { new (...args: any[]): IMixinBlinnPhong }
}
