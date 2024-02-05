import { StandardMaterial } from './standard';
import { LambertLightModel } from './lightmodel';
import { LitMaterial } from './lit';
import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { DrawContext } from '../render';

/**
 * Lambert material
 * @public
 */
export class LambertMaterial extends StandardMaterial<LambertLightModel> {
  /**
   * Creates an instance of LambertMaterial
   */
  constructor() {
    super();
    this.lightModel = new LambertLightModel();
  }
}

export class NewLambertMaterial extends LitMaterial {
  constructor(){
    super();   
  }
  protected fragmentShader(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    super.fragmentShader(scope, ctx);
    return (function(this: PBInsideFunctionScope) {
      this.$l.albedo = that.calculateAlbedoColor(this, ctx);
      this.$l.color = pb.vec3(0);
      this.$l.normal = that.calculateNormal(scope, ctx);
      if (that.needCalculateEnvLight(ctx)) {
        this.color = pb.add(this.color, that.getEnvLightIrradiance(this, this.normal, ctx));
      }
      that.forEachLight(this, ctx, function(type, posRange, dirCutoff, colorIntensity, shadow){
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.lightContrib = pb.mul(colorIntensity.rgb, colorIntensity.a, this.NoL, this.lightAtten);
        if (shadow) {
          this.$l.shadow = pb.vec3(that.calculateShadow(this, this.NoL, ctx));
          this.lightContrib = pb.mul(this.lightContrib, this.shadow);
        }
        this.color = pb.add(this.color, this.lightContrib);
      });
      return pb.mul(this.albedo, pb.vec4(this.color, 1));
    }).call(scope);
  }
}