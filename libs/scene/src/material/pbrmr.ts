import { LitMaterial } from './lit';
import { applyMaterialMixins } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import { mixinVertexColor } from './mixins/vertexcolor';
import { PBFunctionScope } from '@zephyr3d/device';
import { DrawContext } from '../render';
import { mixinPBRMetallicRoughness } from './mixins/pbr/metallicroughness';

export class NewPBRMetallicRoughnessMaterial extends applyMaterialMixins(
  LitMaterial,
  mixinPBRMetallicRoughness,
  mixinVertexColor,
  mixinAlbedoColor,
) {
  constructor() {
    super();
  }
  vertexShader(scope: PBFunctionScope, ctx: DrawContext): void {
    super.vertexShader(scope, ctx);
    scope.$inputs.zPos = scope.$builder.vec3().attrib('position');
    this.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
    super.fragmentShader(scope, ctx);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor(ctx)) {
      scope.$l.albedo = this.calculateAlbedoColor(scope, ctx);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope, ctx));
      }
      scope.$l.normal = this.calculateNormal(scope, ctx);
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.pbrData = this.calculateCommonData(scope, scope.albedo);
      scope.$l.diffuseColor = pb.vec3(0);
      scope.$l.specularColor = pb.vec3(0);
      this.indirectLighting(scope, scope.normal, scope.viewVec, scope.pbrData, scope.diffuseColor, scope.specularColor, ctx);
      this.forEachLight(scope, ctx, function (type, posRange, dirCutoff, colorIntensity, shadow) {
        this.$l.diffuse = pb.vec3();
        this.$l.specular = pb.vec3();
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        that.directLighting(this, this.lightDir, this.normal, this.viewVec, this.pbrData, this.diffuse, this.specular);
        if (shadow) {
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.shadow = pb.vec3(that.calculateShadow(this, this.NoL, ctx));
          this.diffuse = pb.mul(this.diffuse, this.shadow);
          this.specular = pb.mul(this.specular, this.shadow);
        }
        this.diffuseColor = pb.add(this.diffuseColor, pb.mul(this.diffuse, this.lightColor));
        this.specularColor = pb.add(this.specularColor, pb.mul(this.specular, this.lightColor));
      });
      scope.$l.litColor = pb.vec4(pb.add(scope.diffuseColor, scope.specularColor), scope.albedo.a);
      //scope.$l.litColor = pb.vec4(pb.vec3(scope.pbrData.roughness), 1);
      this.outputFragmentColor(scope, scope.litColor, ctx);
    } else {
      this.outputFragmentColor(scope, null, ctx);
    }
  }
}
