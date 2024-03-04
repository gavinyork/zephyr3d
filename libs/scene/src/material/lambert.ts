import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { PBFunctionScope } from '@zephyr3d/device';

/**
 * Lambert material
 * @public
 */
export class LambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLight, mixinVertexColor) {
  private static FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static FEATURE_VERTEX_TANGENT = this.defineFeature();
  constructor() {
    super();
    this.useFeature(LambertMaterial.FEATURE_VERTEX_NORMAL, true);
  }
  /** true if vertex normal attribute presents */
  get vertexNormal(): boolean {
    return this.featureUsed(LambertMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val: boolean) {
    this.useFeature(LambertMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex normal attribute presents */
  get vertexTangent(): boolean {
    return this.featureUsed(LambertMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val: boolean) {
    this.useFeature(LambertMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  vertexShader(scope: PBFunctionScope) {
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
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    scope.$l.worldPos = this.helper.getWorldPosition(scope).xyz;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      scope.$l.color = pb.vec3(0);
      scope.$l.normal = this.calculateNormal(scope, scope.worldPos);
      if (this.needCalculateEnvLight()) {
        scope.color = pb.add(scope.color, this.getEnvLightIrradiance(scope, scope.normal));
      }
      this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, shadow) {
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, scope.worldPos, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, scope.worldPos, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.lightContrib = pb.mul(colorIntensity.rgb, colorIntensity.a, this.NoL, this.lightAtten);
        if (shadow) {
          this.$l.shadow = pb.vec3(that.calculateShadow(this, scope.worldPos, this.NoL));
          this.lightContrib = pb.mul(this.lightContrib, this.shadow);
        }
        this.color = pb.add(this.color, this.lightContrib);
      });
      scope.$l.litColor = pb.mul(scope.albedo, pb.vec4(scope.color, 1));
      this.outputFragmentColor(scope, scope.worldPos, scope.litColor);
    } else {
      this.outputFragmentColor(scope, scope.worldPos, null);
    }
  }
}
