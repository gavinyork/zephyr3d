import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinPBRSpecularGlossness } from './mixins/lightmodel/pbrspecularglossness';
import { ShaderHelper } from './shader/helper';

/**
 * PBRSpecularGlossinessMaterial class
 * @public
 */
export class PBRSpecularGlossinessMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinPBRSpecularGlossness,
  mixinVertexColor
) {
  /** @internal */
  private static FEATURE_VERTEX_NORMAL = this.defineFeature();
  /** @internal */
  private static FEATURE_VERTEX_TANGENT = this.defineFeature();
  /**
   * Creates an instance of PBRSpecularGlossinessMaterial class
   */
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
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    if (this.vertexNormal) {
      scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
      scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
      if (this.vertexTangent) {
        scope.$l.oTangent = ShaderHelper.resolveVertexTangent(scope);
        scope.$outputs.wTangent = pb.mul(
          ShaderHelper.getNormalMatrix(scope),
          pb.vec4(scope.oTangent.xyz, 0)
        ).xyz;
        scope.$outputs.wBinormal = pb.mul(
          pb.cross(scope.$outputs.wNorm, scope.$outputs.wTangent),
          scope.oTangent.w
        );
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
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        scope.$inputs.wNorm,
        scope.$inputs.wTangent,
        scope.$inputs.wBinormal
      );
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.$inputs.worldPos,
        scope.normalInfo.normal,
        scope.viewVec,
        scope.albedo,
        scope.normalInfo.TBN
      );
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
