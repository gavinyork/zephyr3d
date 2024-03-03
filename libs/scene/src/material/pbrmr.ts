import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';

export class PBRMetallicRoughnessMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinPBRMetallicRoughness,
  mixinVertexColor
) {
  private static FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static FEATURE_VERTEX_TANGENT = this.defineFeature();
  constructor() {
    super();
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL, true);
  }
  /** true if vertex normal attribute presents */
  get vertexNormal(): boolean {
    return this.featureUsed(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val: boolean) {
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex normal attribute presents */
  get vertexTangent(): boolean {
    return this.featureUsed(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val: boolean) {
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.zPos = pb.vec3().attrib('position');
    if (this.vertexNormal) {
      scope.$inputs.normal = pb.vec3().attrib('normal');
    }
    if (this.vertexTangent) {
      scope.$inputs.tangent = pb.vec4().attrib('tangent');
    }
    this.helper.processPositionAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.normalInfo = this.calculateNormalAndTBN(scope);
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.normalInfo.normal,
        scope.normalInfo.TBN,
        scope.viewVec,
        scope.albedo
      );
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
