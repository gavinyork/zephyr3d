import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import { PBFunctionScope } from '@zephyr3d/device';
import { DrawContext } from '../render';
import { mixinPBRMetallicRoughness } from './mixins/pbr/metallicroughness';
import { mixinLight } from './mixins/lit';

export class NewPBRMetallicRoughnessMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRMetallicRoughness,
  mixinVertexColor,
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
      scope.$l.normalInfo = this.calculateNormalAndTBN(scope, ctx);
      scope.$l.normal = scope.normalInfo.normal;
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.pbrData = this.getCommonData(scope, scope.albedo, scope.viewVec, scope.normalInfo.TBN);
      scope.$l.lightingColor = pb.vec3(0);
      scope.$l.emissiveColor = this.calculateEmissiveColor(scope);
      this.indirectLighting(scope, scope.normal, scope.viewVec, scope.pbrData, scope.lightingColor, ctx);
      this.forEachLight(scope, ctx, function (type, posRange, dirCutoff, colorIntensity, shadow) {
        this.$l.diffuse = pb.vec3();
        this.$l.specular = pb.vec3();
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
        if (shadow) {
          this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.NoL, ctx));
        }
        that.directLighting(this, this.lightDir, this.lightColor, this.normal, this.viewVec, this.pbrData, this.lightingColor);
      });
      scope.$l.litColor = pb.add(scope.lightingColor, scope.emissiveColor);
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a), ctx);
    } else {
      this.outputFragmentColor(scope, null, ctx);
    }
  }
}
