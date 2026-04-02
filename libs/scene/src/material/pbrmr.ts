import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_GBUFFER, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { Clonable, Immutable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { DrawContext } from '../render';

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
  /** @internal */
  private static readonly FEATURE_SUBSURFACE_SCATTERING = this.defineFeature();
  /** @internal */
  private static readonly SUBSURFACE_COLOR_UNIFORM = this.defineInstanceUniform(
    'subsurfaceColor',
    'rgb',
    'SubsurfaceColor'
  );
  /** @internal */
  private static readonly SUBSURFACE_SCALE_UNIFORM = this.defineInstanceUniform(
    'subsurfaceScale',
    'float',
    'SubsurfaceScale'
  );
  /** @internal */
  private static readonly SUBSURFACE_POWER_UNIFORM = this.defineInstanceUniform(
    'subsurfacePower',
    'float',
    'SubsurfacePower'
  );
  /** @internal */
  private static readonly SUBSURFACE_INTENSITY_UNIFORM = this.defineInstanceUniform(
    'subsurfaceIntensity',
    'float',
    'SubsurfaceIntensity'
  );
  private readonly _subsurfaceColor: Vector3;
  private _subsurfaceScale: number;
  private _subsurfacePower: number;
  private _subsurfaceIntensity: number;
  /**
   * Creates an instance of PBRMetallicRoughnessMaterial class
   */
  constructor() {
    super();
    this._subsurfaceColor = new Vector3(1, 0.3, 0.2);
    this._subsurfaceScale = 0.5;
    this._subsurfacePower = 1.5;
    this._subsurfaceIntensity = 0.5;
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_VERTEX_NORMAL, true);
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_SUBSURFACE_SCATTERING, false);
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
    this.subsurfaceScattering = other.subsurfaceScattering;
    this.subsurfaceColor = other.subsurfaceColor;
    this.subsurfaceScale = other.subsurfaceScale;
    this.subsurfacePower = other.subsurfacePower;
    this.subsurfaceIntensity = other.subsurfaceIntensity;
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
  /** true if subsurface scattering is enabled */
  get subsurfaceScattering() {
    return this.featureUsed<boolean>(PBRMetallicRoughnessMaterial.FEATURE_SUBSURFACE_SCATTERING);
  }
  set subsurfaceScattering(val) {
    this.useFeature(PBRMetallicRoughnessMaterial.FEATURE_SUBSURFACE_SCATTERING, !!val);
  }
  /** subsurface scattering color tint */
  get subsurfaceColor(): Immutable<Vector3> {
    return this._subsurfaceColor;
  }
  set subsurfaceColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._subsurfaceColor)) {
      this._subsurfaceColor.set(val);
      this.uniformChanged();
    }
  }
  /** wrap factor for the scattering profile */
  get subsurfaceScale() {
    return this._subsurfaceScale;
  }
  set subsurfaceScale(val: number) {
    if (val !== this._subsurfaceScale) {
      this._subsurfaceScale = val;
      this.uniformChanged();
    }
  }
  /** profile exponent for the scattering profile */
  get subsurfacePower() {
    return this._subsurfacePower;
  }
  set subsurfacePower(val: number) {
    if (val !== this._subsurfacePower) {
      this._subsurfacePower = val;
      this.uniformChanged();
    }
  }
  /** final intensity of scattering contribution */
  get subsurfaceIntensity() {
    return this._subsurfaceIntensity;
  }
  set subsurfaceIntensity(val: number) {
    if (val !== this._subsurfaceIntensity) {
      this._subsurfaceIntensity = val;
      this.uniformChanged();
    }
  }
  private getSubsurfaceColor(scope: PBInsideFunctionScope): PBShaderExp {
    const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
    return (instancing ? scope.$inputs.zSubsurfaceColor : scope.zSubsurfaceColor) as PBShaderExp;
  }
  private getSubsurfaceScale(scope: PBInsideFunctionScope): PBShaderExp {
    const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
    return (instancing ? scope.$inputs.zSubsurfaceScale : scope.zSubsurfaceScale) as PBShaderExp;
  }
  private getSubsurfacePower(scope: PBInsideFunctionScope): PBShaderExp {
    const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
    return (instancing ? scope.$inputs.zSubsurfacePower : scope.zSubsurfacePower) as PBShaderExp;
  }
  private getSubsurfaceIntensity(scope: PBInsideFunctionScope): PBShaderExp {
    const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
    return (instancing ? scope.$inputs.zSubsurfaceIntensity : scope.zSubsurfaceIntensity) as PBShaderExp;
  }
  vertexShader(scope: PBFunctionScope) {
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
    if (
      this.subsurfaceScattering &&
      this.needFragmentColor() &&
      this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING
    ) {
      scope.$outputs.zSubsurfaceColor = this.getInstancedUniform(
        scope,
        PBRMetallicRoughnessMaterial.SUBSURFACE_COLOR_UNIFORM
      );
      scope.$outputs.zSubsurfaceScale = this.getInstancedUniform(
        scope,
        PBRMetallicRoughnessMaterial.SUBSURFACE_SCALE_UNIFORM
      );
      scope.$outputs.zSubsurfacePower = this.getInstancedUniform(
        scope,
        PBRMetallicRoughnessMaterial.SUBSURFACE_POWER_UNIFORM
      );
      scope.$outputs.zSubsurfaceIntensity = this.getInstancedUniform(
        scope,
        PBRMetallicRoughnessMaterial.SUBSURFACE_INTENSITY_UNIFORM
      );
    }
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (
      this.subsurfaceScattering &&
      this.needFragmentColor() &&
      this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
      !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)
    ) {
      scope.zSubsurfaceColor = pb.vec3().uniform(2);
      scope.zSubsurfaceScale = pb.float().uniform(2);
      scope.zSubsurfacePower = pb.float().uniform(2);
      scope.zSubsurfaceIntensity = pb.float().uniform(2);
    }
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
          if (this.subsurfaceScattering) {
            scope.$l.NoV = pb.clamp(pb.dot(scope.normalInfo.normal, scope.viewVec), 0, 1);
            scope.$l.wrapNdotV = pb.clamp(
              pb.div(pb.add(pb.sub(1, scope.NoV), this.getSubsurfaceScale(scope)), pb.add(1, this.getSubsurfaceScale(scope))),
              0,
              1
            );
            scope.$l.sssFactor = pb.mul(
              pb.pow(scope.wrapNdotV, this.getSubsurfacePower(scope)),
              this.getSubsurfaceIntensity(scope)
            );
            if (this.subsurfaceTexture) {
              scope.sssFactor = pb.mul(scope.sssFactor, this.sampleSubsurfaceTexture(scope).r);
            }
            scope.litColor = pb.add(
              scope.litColor,
              pb.mul(scope.albedo.rgb, this.getSubsurfaceColor(scope), scope.sssFactor)
            );
          }
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
          if (this.subsurfaceScattering) {
            scope.$l.NoV = pb.clamp(pb.dot(scope.normalInfo.normal, scope.viewVec), 0, 1);
            scope.$l.wrapNdotV = pb.clamp(
              pb.div(pb.add(pb.sub(1, scope.NoV), this.getSubsurfaceScale(scope)), pb.add(1, this.getSubsurfaceScale(scope))),
              0,
              1
            );
            scope.$l.sssFactor = pb.mul(
              pb.pow(scope.wrapNdotV, this.getSubsurfacePower(scope)),
              this.getSubsurfaceIntensity(scope)
            );
            if (this.subsurfaceTexture) {
              scope.sssFactor = pb.mul(scope.sssFactor, this.sampleSubsurfaceTexture(scope).r);
            }
            scope.litColor = pb.add(
              scope.litColor,
              pb.mul(scope.albedo.rgb, this.getSubsurfaceColor(scope), scope.sssFactor)
            );
          }
          this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
        }
      } else if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_GBUFFER) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(
          scope,
          scope.$inputs.worldPos,
          scope.$inputs.wNorm,
          scope.$inputs.wTangent,
          scope.$inputs.wBinormal
        );
        scope.$l.metallic = this.calculateMetallic(scope, scope.albedo, scope.normalInfo.normal);
        scope.$l.roughness = this.calculateRoughness(scope, scope.albedo, scope.normalInfo.normal);
        scope.$l.occlusion = pb.float(1);
        if (this.metallicRoughnessTexture) {
          scope.metallic = pb.mul(scope.metallic, this.sampleMetallicRoughnessTexture(scope).z);
          scope.roughness = pb.mul(scope.roughness, this.sampleMetallicRoughnessTexture(scope).y);
        }
        if (this.occlusionTexture) {
          scope.occlusion = pb.add(
            pb.mul(scope.zOcclusionStrength, pb.sub(this.sampleOcclusionTexture(scope).r, 1)),
            1
          );
        }
        scope.$l.emissive = this.calculateEmissiveColor(scope);
        scope.roughness = pb.mul(scope.roughness, ShaderHelper.getCameraRoughnessFactor(scope));
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          scope.albedo,
          pb.vec4(scope.metallic, scope.occlusion, 1, scope.roughness),
          pb.vec4(pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)), 1),
          pb.vec4(scope.emissive, 1)
        );
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
      this.subsurfaceScattering &&
      this.needFragmentColor(ctx) &&
      ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
      !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)
    ) {
      bindGroup.setValue('zSubsurfaceColor', this._subsurfaceColor);
      bindGroup.setValue('zSubsurfaceScale', this._subsurfaceScale);
      bindGroup.setValue('zSubsurfacePower', this._subsurfacePower);
      bindGroup.setValue('zSubsurfaceIntensity', this._subsurfaceIntensity);
    }
  }
}
