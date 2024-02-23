import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { PBFunctionScope } from '@zephyr3d/device';

/**
 * Lambert material
 * @public
 */
export class LambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLight, mixinVertexColor) {
  constructor() {
    super();
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    scope.$inputs.zPos = scope.$builder.vec3().attrib('position');
    this.helper.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.color = pb.vec3(0);
      scope.$l.normal = this.calculateNormal(scope);
      if (this.needCalculateEnvLight()) {
        scope.color = pb.add(scope.color, this.getEnvLightIrradiance(scope, scope.normal));
      }
      this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, shadow) {
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.lightContrib = pb.mul(colorIntensity.rgb, colorIntensity.a, this.NoL, this.lightAtten);
        if (shadow) {
          this.$l.shadow = pb.vec3(that.calculateShadow(this, this.NoL));
          this.lightContrib = pb.mul(this.lightContrib, this.shadow);
        }
        this.color = pb.add(this.color, this.lightContrib);
      });
      scope.$l.litColor = pb.mul(scope.albedo, pb.vec4(scope.color, 1));
      this.outputFragmentColor(scope, scope.litColor);
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
