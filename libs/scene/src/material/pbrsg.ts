import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinPBRSpecularGlossness } from './mixins/lightmodel/pbrspecularglossness';

export class PBRSpecularGlossinessMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinPBRSpecularGlossness,
  mixinVertexColor
) {
  private static FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static FEATURE_VERTEX_TANGENT = this.defineFeature();
  constructor() {
    super();
    this.useFeature(PBRSpecularGlossinessMaterial.FEATURE_VERTEX_NORMAL, true);
  }
  /** true if vertex normal attribute presents */
  get vertexNormal(): boolean {
    return this.featureUsed(PBRSpecularGlossinessMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val: boolean) {
    this.useFeature(PBRSpecularGlossinessMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex normal attribute presents */
  get vertexTangent(): boolean {
    return this.featureUsed(PBRSpecularGlossinessMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val: boolean) {
    this.useFeature(PBRSpecularGlossinessMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = this.helper.resolveVertexPosition(scope);
    scope.$l.wPos = pb.mul(this.helper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1));
    this.helper.pipeWorldPosition(scope, scope.wPos);
    this.helper.setClipSpacePosition(scope, pb.mul(this.helper.getViewProjectionMatrix(scope), scope.wPos));
    if (this.vertexNormal) {
      scope.$l.oNorm = this.helper.resolveVertexNormal(scope);
      scope.$l.wNorm = pb.mul(this.helper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
      this.helper.pipeWorldNormal(scope, scope.wNorm);
      if (this.vertexTangent) {
        scope.$l.oTangent = this.helper.resolveVertexTangent(scope);
        scope.$l.wTangent = pb.mul(this.helper.getNormalMatrix(scope), pb.vec4(scope.oTangent.xyz, 0)).xyz;
        this.helper.pipeWorldTangent(scope, scope.wTangent);
        scope.$l.wBinormal = pb.mul(pb.cross(scope.wNorm, scope.wTangent), scope.oTangent.w);
        this.helper.pipeWorldBinormal(scope, scope.wBinormal);
      }
    }
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
