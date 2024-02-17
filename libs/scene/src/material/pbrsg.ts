import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinLight } from './mixins/lit';
import { mixinPBRSpecularGlossness } from './mixins/pbr/specularglossness';

export class PBRSpecularGlossinessMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRSpecularGlossness,
  mixinVertexColor
) {
  constructor() {
    super();
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    scope.$inputs.zPos = scope.$builder.vec3().attrib('position');
    this.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.normalInfo = this.calculateNormalAndTBN(scope);
      scope.$l.normal = scope.normalInfo.normal;
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.pbrData = this.getCommonData(scope, scope.albedo, scope.viewVec, scope.normalInfo.TBN);
      scope.$l.lightingColor = pb.vec3(0);
      scope.$l.emissiveColor = this.calculateEmissiveColor(scope);
      this.indirectLighting(scope, scope.normal, scope.viewVec, scope.pbrData, scope.lightingColor);
      this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, shadow) {
        this.$l.diffuse = pb.vec3();
        this.$l.specular = pb.vec3();
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
        if (shadow) {
          this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.NoL));
        }
        that.directLighting(
          this,
          this.lightDir,
          this.lightColor,
          this.normal,
          this.viewVec,
          this.pbrData,
          this.lightingColor
        );
      });
      scope.$l.litColor = pb.add(scope.lightingColor, scope.emissiveColor);
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
