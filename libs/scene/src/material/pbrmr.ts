import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { Clonable } from '@zephyr3d/base';

/**
 * PBRMetallicRoughnessMaterial class
 * @public
 */
export class PBRMetallicRoughnessMaterial
  extends applyMaterialMixins(MeshMaterial, mixinPBRMetallicRoughness, mixinVertexColor)
  implements Clonable<PBRMetallicRoughnessMaterial>
{
  /** @internal */
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  /**
   * Creates an instance of PBRMetallicRoughnessMaterial class
   */
  constructor() {
    super();
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL, true);
  }
  clone(): PBRMetallicRoughnessMaterial {
    const other = new PBRMetallicRoughnessMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.vertexNormal = other.vertexNormal;
    this.vertexTangent = other.vertexTangent;
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
    const worldMatrix = ShaderHelper.getWorldMatrix(scope);
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(worldMatrix, pb.vec4(scope.oPos, 1)).xyz;
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    if (this.transmission) {
      scope.$outputs.screenUV = pb.add(pb.mul(pb.div(scope.csPos.xy, scope.csPos.w), 0.5), pb.vec2(0.5));
      scope.$outputs.modelScale = pb.vec3(
        pb.length(worldMatrix[0].xyz),
        pb.length(worldMatrix[1].xyz),
        pb.length(worldMatrix[2].xyz)
      );
    }
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
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(
          scope,
          scope.$inputs.worldPos,
          scope.$inputs.wNorm,
          scope.$inputs.wTangent,
          scope.$inputs.wBinormal
        );
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
          scope.$l.outRoughness = pb.vec4();
          scope.$l.litColor = this.PBRLight(
            scope,
            scope.$inputs.worldPos,
            scope.normalInfo.normal,
            scope.viewVec,
            scope.albedo,
            scope.normalInfo.TBN,
            scope.outRoughness
          );
          /*
          scope.outRoughness = pb.vec4(
            pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)),
            scope.outRoughness.a
          );
          */
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            pb.vec4(scope.litColor, scope.albedo.a),
            scope.outRoughness,
            pb.vec4(pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)), 1)
          );
        } else {
          scope.$l.litColor = this.PBRLight(
            scope,
            scope.$inputs.worldPos,
            scope.normalInfo.normal,
            scope.viewVec,
            scope.albedo,
            scope.normalInfo.TBN
          );
          this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
        }
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.albedo);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
