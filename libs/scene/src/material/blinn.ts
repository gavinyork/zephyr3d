import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinBlinnPhong } from './mixins/lightmodel/blinnphong';

export class BlinnMaterial extends applyMaterialMixins(MeshMaterial, mixinBlinnPhong, mixinVertexColor) {
  private static FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static FEATURE_VERTEX_TANGENT = this.defineFeature();
  constructor() {
    super();
    this.useFeature(BlinnMaterial.FEATURE_VERTEX_NORMAL, true);
  }
  /** true if vertex normal attribute presents */
  get vertexNormal(): boolean {
    return this.featureUsed(BlinnMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val: boolean) {
    this.useFeature(BlinnMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex normal attribute presents */
  get vertexTangent(): boolean {
    return this.featureUsed(BlinnMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val: boolean) {
    this.useFeature(BlinnMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = this.helper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(this.helper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    this.helper.setClipSpacePosition(scope, pb.mul(this.helper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    if (this.vertexNormal) {
      scope.$l.oNorm = this.helper.resolveVertexNormal(scope);
      scope.$outputs.wNorm = pb.mul(this.helper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
      if (this.vertexTangent) {
        scope.$l.oTangent = this.helper.resolveVertexTangent(scope);
        scope.$outputs.wTangent = pb.mul(this.helper.getNormalMatrix(scope), pb.vec4(scope.oTangent.xyz, 0)).xyz;
        scope.$outputs.wBinormal = pb.mul(pb.cross(scope.$outputs.wNorm, scope.$outputs.wTangent), scope.oTangent.w);
      }
    }
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.wNorm, scope.$inputs.wTangent, scope.$inputs.wBinormal);
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.blinnPhongLight(scope, scope.$inputs.worldPos, scope.normal, scope.viewVec, scope.albedo);
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
