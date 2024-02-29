import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinBlinnPhong } from './mixins/lightmodel/blinnphong';

export class BlinnMaterial extends applyMaterialMixins(MeshMaterial, mixinBlinnPhong, mixinVertexColor) {
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
      scope.$l.normal = this.calculateNormal(scope);
      scope.$l.viewVec = that.calculateViewVector(scope);
      scope.$l.litColor = this.blinnPhongLight(scope, scope.normal, scope.viewVec, scope.albedo);
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
