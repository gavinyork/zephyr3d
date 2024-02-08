import { applyMaterialMixins } from './meshmaterial';
import { LitMaterial } from './lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinAlbedoColor } from './mixins/albedocolor';
import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import type { DrawContext } from '../render';

export class BlinnMaterial extends applyMaterialMixins(LitMaterial, mixinVertexColor, mixinAlbedoColor) {
  private _shininess: number;
  constructor(){
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
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
    super.applyUniformValues(bindGroup, ctx);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('kkShininess', this._shininess);
    }
  }
  vertexShader(scope: PBFunctionScope, ctx: DrawContext) {
    super.vertexShader(scope, ctx);
    scope.$inputs.zPos = scope.$builder.vec3().attrib('position');
    this.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope, ctx: DrawContext) {
    super.fragmentShader(scope, ctx);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor(ctx)) {
      scope.$g.kkShininess = scope.$builder.float().uniform(2);
      scope.$l.albedo = this.calculateAlbedoColor(scope, ctx);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope, ctx));
      }
      scope.$l.diffuseColor = pb.vec3(0);
      scope.$l.specularColor = pb.vec3(0);
      scope.$l.normal = this.calculateNormal(scope, ctx);
      if (this.needCalculateEnvLight(ctx)) {
        scope.diffuseColor = pb.add(scope.diffuseColor, this.getEnvLightIrradiance(scope, scope.normal, ctx));
      }
      this.forEachLight(scope, ctx, function(type, posRange, dirCutoff, colorIntensity, shadow){
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.viewVec = that.calculateViewVector(this);
        this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
        this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
        this.$l.diffuse = pb.mul(this.lightColor, this.NoL);
        this.$l.specular = pb.mul(this.lightColor, pb.pow(this.NoH, this.kkShininess));
        if (shadow) {
          this.$l.shadow = pb.vec3(that.calculateShadow(this, this.NoL, ctx));
          this.diffuse = pb.mul(this.diffuse, this.shadow);
          this.specular = pb.mul(this.specular, this.shadow);
        }
        this.diffuseColor = pb.add(this.diffuseColor, this.diffuse);
        this.specularColor = pb.add(this.specularColor, this.specular);
      });
      scope.$l.litColor = pb.add(pb.mul(scope.albedo, pb.vec4(scope.diffuseColor, 1)), pb.vec4(scope.specularColor, 0));
      this.outputFragmentColor(scope, scope.litColor, ctx);
    } else {
      this.outputFragmentColor(scope, null, ctx);
    }
  }
}