import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinPBRSpecularGlossness } from './mixins/lightmodel/pbrspecularglossness';

export class PBRSpecularGlossinessMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinPBRSpecularGlossness,
  mixinVertexColor
) {
  constructor() {
    super();
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    scope.$inputs.zPos = scope.$builder.vec3().attrib('position');
    this.helper.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.normalInfo = this.calculateNormalAndTBN(scope);
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.litColor = this.PBRLight(scope, scope.normalInfo.normal, scope.normalInfo.TBN, scope.viewVec, scope.albedo);
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
