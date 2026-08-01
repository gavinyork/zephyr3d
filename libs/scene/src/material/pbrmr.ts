import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { Clonable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { DrawContext } from '../render';
import type { SubsurfaceProfile } from './subsurfaceprofile';

/**
 * PBRMetallicRoughnessMaterial class
 * @public
 */
export class PBRMetallicRoughnessMaterial
  extends applyMaterialMixins(
    MeshMaterial,
    mixinPBRMetallicRoughness,
    mixinVertexColor,
    mixinTextureProps('subsurface')
  )
  implements Clonable<PBRMetallicRoughnessMaterial>
{
  /** @internal */
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  private readonly _subsurfaceProfileChanged: () => void;
  private _subsurfaceProfile: SubsurfaceProfile | null;
  /**
   * Creates an instance of PBRMetallicRoughnessMaterial class
   */
  constructor() {
    super();
    this._subsurfaceProfileChanged = () => this.uniformChanged();
    this._subsurfaceProfile = null;
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL, true);
    this.transmission = false;
    this.transmissionFactor = 0.2;
    this.thicknessFactor = 0.35;
    this.attenuationColor = new Vector3(1, 0.5, 0.4);
    this.attenuationDistance = 0.6;
  }
  clone() {
    const other = new PBRMetallicRoughnessMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    this.vertexNormal = other.vertexNormal;
    this.vertexTangent = other.vertexTangent;
    this.subsurfaceProfile = other.subsurfaceProfile;
  }
  /** true if vertex normal attribute presents */
  get vertexNormal() {
    return this.featureUsed<boolean>(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex normal attribute presents */
  get vertexTangent() {
    return this.featureUsed<boolean>(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val) {
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  /** shared profile asset driving channel radius/falloff */
  get subsurfaceProfile() {
    return this._subsurfaceProfile;
  }
  set subsurfaceProfile(val: SubsurfaceProfile | null) {
    if (val !== this._subsurfaceProfile) {
      this._subsurfaceProfile?.removeChangeListener(this._subsurfaceProfileChanged);
      this._subsurfaceProfile = val ?? null;
      this._subsurfaceProfile?.addChangeListener(this._subsurfaceProfileChanged);
      this.optionChanged(true);
    }
  }
  private getSubsurfaceProfileId(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.zSubsurfaceProfileId as PBShaderExp;
  }
  private getSubsurfaceProfileScale(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.zSubsurfaceProfileScale as PBShaderExp;
  }
  private getSubsurfaceProfileStrength(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.zSubsurfaceProfileStrength as PBShaderExp;
  }
  private getSubsurfaceProfilePreset(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.zSubsurfaceProfilePreset as PBShaderExp;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    const worldMatrix = ShaderHelper.getWorldMatrix(scope);
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(worldMatrix, pb.vec4(scope.oPos, 1)).xyz;
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    const needsVolumeTransmissionRay =
      this.transmission ||
      (!!this._subsurfaceProfile &&
        this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
        !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_TRANSMISSION));
    if (needsVolumeTransmissionRay) {
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
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const renderPassType = this.drawContext.renderPass!.type;
    if (!!this._subsurfaceProfile && this.needFragmentColor() && renderPassType === RENDER_PASS_TYPE_LIGHT) {
      scope.zSubsurfaceProfileId = pb.float().uniform(2);
      scope.zSubsurfaceProfileScale = pb.float().uniform(2);
      scope.zSubsurfaceProfileStrength = pb.float().uniform(2);
      scope.zSubsurfaceProfilePreset = pb.float().uniform(2);
    }
    if (this.needFragmentColorInput()) {
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      if (renderPassType === RENDER_PASS_TYPE_LIGHT) {
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
          const writeSSSDiffuse =
            !!this._subsurfaceProfile &&
            !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_DIFFUSE);
          const writeSSSTransmission =
            !!this._subsurfaceProfile &&
            !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_TRANSMISSION);
          if (writeSSSDiffuse) {
            scope.$l.sssDiffuse = pb.vec4();
          }
          if (writeSSSTransmission) {
            scope.$l.sssTransmission = pb.vec4();
          }
          if (writeSSSDiffuse && writeSSSTransmission) {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              scope.outRoughness,
              scope.sssDiffuse,
              scope.sssTransmission
            );
          } else if (writeSSSDiffuse) {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              scope.outRoughness,
              scope.sssDiffuse
            );
          } else if (writeSSSTransmission) {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              scope.outRoughness,
              undefined,
              scope.sssTransmission
            );
          } else {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              scope.outRoughness
            );
          }
          const writeSSSProfile =
            !!this._subsurfaceProfile &&
            !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_PROFILE);
          scope.$l.sssProfile = writeSSSProfile ? this.buildSubsurfaceProfile(scope) : pb.vec4(0);
          scope.$l.sssParams = writeSSSProfile ? (scope.sssParams ?? pb.vec4(0)) : pb.vec4(0);
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
            pb.vec4(pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)), 1),
            scope.sssProfile,
            scope.sssParams,
            writeSSSDiffuse ? scope.sssDiffuse : undefined,
            writeSSSTransmission ? scope.sssTransmission : undefined,
            writeSSSProfile
          );
        } else {
          const writeSSSDiffuse =
            !!this._subsurfaceProfile &&
            !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_DIFFUSE);
          const writeSSSTransmission =
            !!this._subsurfaceProfile &&
            !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_TRANSMISSION);
          if (writeSSSDiffuse) {
            scope.$l.sssDiffuse = pb.vec4();
          }
          if (writeSSSTransmission) {
            scope.$l.sssTransmission = pb.vec4();
          }
          if (writeSSSDiffuse && writeSSSTransmission) {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              undefined,
              scope.sssDiffuse,
              scope.sssTransmission
            );
          } else if (writeSSSDiffuse) {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              undefined,
              scope.sssDiffuse
            );
          } else if (writeSSSTransmission) {
            scope.$l.litColor = this.PBRLight(
              scope,
              scope.$inputs.worldPos,
              scope.normalInfo.normal,
              scope.viewVec,
              scope.albedo,
              scope.normalInfo.TBN,
              undefined,
              undefined,
              scope.sssTransmission
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
          }
          const writeSSSProfile =
            !!this._subsurfaceProfile &&
            !!(this.drawContext.materialFlags & MaterialVaryingFlags.SSS_STORE_PROFILE);
          scope.$l.sssProfile = writeSSSProfile ? this.buildSubsurfaceProfile(scope) : pb.vec4(0);
          scope.$l.sssParams = writeSSSProfile ? (scope.sssParams ?? pb.vec4(0)) : pb.vec4(0);
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            pb.vec4(scope.litColor, scope.albedo.a),
            undefined,
            undefined,
            scope.sssProfile,
            scope.sssParams,
            writeSSSDiffuse ? scope.sssDiffuse : undefined,
            writeSSSTransmission ? scope.sssTransmission : undefined,
            writeSSSProfile
          );
        }
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.albedo);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (
      !!this._subsurfaceProfile &&
      this.needFragmentColor(ctx) &&
      ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT
    ) {
      const profile = this._subsurfaceProfile;
      bindGroup.setValue('zSubsurfaceProfileId', profile?.slot ?? 0);
      bindGroup.setValue('zSubsurfaceProfileScale', profile?.scale ?? 0);
      bindGroup.setValue('zSubsurfaceProfileStrength', profile?.strength ?? 0);
      bindGroup.setValue('zSubsurfaceProfilePreset', profile?.presetIndex ?? 0);
    }
  }
  protected _createHash() {
    return `${super._createHash()}:${this._subsurfaceProfile ? 1 : 0}`;
  }
  private buildSubsurfaceProfile(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    scope.$l.sssMask = pb.float(1);
    scope.$l.sssScatterSoftness = pb.float(0);
    scope.$l.sssTransmissionMask = pb.float(0);
    if (this.subsurfaceTexture) {
      scope.$l.sssTexel = this.sampleSubsurfaceTexture(scope);
      scope.sssMask = pb.clamp(scope.sssTexel.r, 0, 1);
      scope.sssScatterSoftness = pb.clamp(scope.sssTexel.g, 0, 1);
    }
    // A profile always enables diffusion, but thin transmission requires an authored map.
    scope.$l.sssTransmissionAuthor = pb.float(this.thicknessTexture ? 1 : 0);
    if (this.transmissionTexture) {
      scope.sssTransmissionAuthor = pb.clamp(
        pb.mul(this.sampleTransmissionTexture(scope).r, scope.zTransmissionFactor ?? 0),
        0,
        1
      );
    }
    scope.$l.sssThinAuthorMask = pb.float(this.transmissionTexture ? 1 : 0);
    if (this.thicknessTexture) {
      // KHR_materials_volume stores thickness in G: zero is thin and one is thick.
      scope.$l.sssThicknessSample = pb.clamp(this.sampleThicknessTexture(scope).g, 0, 1);
      scope.sssThinAuthorMask = pb.sub(1, scope.sssThicknessSample);
    }
    scope.$l.sssAuthoredTransmissionMask = pb.clamp(
      pb.mul(scope.sssTransmissionAuthor, scope.sssThinAuthorMask),
      0,
      1
    );
    scope.sssTransmissionMask = pb.clamp(
      pb.max(scope.sssTransmissionMask, scope.sssAuthoredTransmissionMask),
      0,
      1
    );
    scope.$l.sssScatterStrengthMask = pb.clamp(
      pb.add(pb.mul(scope.sssMask, 0.82), pb.mul(scope.sssScatterSoftness, 0.38)),
      0,
      1
    );
    scope.$l.sssScatterWidthMask = pb.clamp(
      pb.max(scope.sssMask, pb.mul(scope.sssScatterSoftness, 0.9)),
      0,
      1
    );
    scope.$l.sssStrength = pb.mul(this.getSubsurfaceProfileStrength(scope), scope.sssScatterStrengthMask);
    scope.$l.sssWidthBase = pb.mul(this.getSubsurfaceProfileScale(scope), scope.sssScatterWidthMask);
    scope.$l.sssWidth = pb.clamp(pb.div(scope.sssWidthBase, pb.add(scope.sssWidthBase, 1)), 0, 0.999);
    scope.$l.sssSlotEncoded = pb.div(this.getSubsurfaceProfileId(scope), 255);
    scope.$l.sssPresetEncoded = pb.div(this.getSubsurfaceProfilePreset(scope), 255);
    scope.$l.sssParams = pb.vec4(
      scope.sssSlotEncoded,
      scope.sssWidth,
      scope.sssPresetEncoded,
      pb.add(0.75, pb.mul(scope.sssScatterSoftness, 0.25))
    );
    return pb.vec4(scope.sssStrength, scope.sssStrength, scope.sssStrength, scope.sssTransmissionMask);
  }
}
