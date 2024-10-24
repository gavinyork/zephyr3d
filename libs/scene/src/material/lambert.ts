import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { PBFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';

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
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.color = pb.vec3(0);
        scope.$l.normal = this.calculateNormal(
          scope,
          scope.$inputs.worldPos,
          scope.$inputs.wNorm,
          scope.$inputs.wTangent,
          scope.$inputs.wBinormal
        );
        if (this.needCalculateEnvLight()) {
          scope.color = pb.add(scope.color, this.getEnvLightIrradiance(scope, scope.normal));
        }
        this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, shadow) {
          this.$l.lightAtten = that.calculateLightAttenuation(
            this,
            type,
            scope.$inputs.worldPos,
            posRange,
            dirCutoff
          );
          this.$l.lightDir = that.calculateLightDirection(
            this,
            type,
            scope.$inputs.worldPos,
            posRange,
            dirCutoff
          );
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.lightContrib = pb.mul(colorIntensity.rgb, colorIntensity.a, this.NoL, this.lightAtten);
          if (shadow) {
            this.$l.shadow = pb.vec3(that.calculateShadow(this, scope.$inputs.worldPos, this.NoL));
            this.lightContrib = pb.mul(this.lightContrib, this.shadow);
          }
          this.color = pb.add(this.color, this.lightContrib);
        });
        scope.$l.litColor = pb.mul(scope.albedo, pb.vec4(scope.color, 1));
        if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            scope.litColor,
            pb.vec4(0, 0, 0, 1),
            pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), 1)
          );
        } else {
          this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.litColor);
        }
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.albedo);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
