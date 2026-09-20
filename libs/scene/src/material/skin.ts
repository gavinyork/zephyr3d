import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import type { Clonable } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import { LIGHT_TYPE_POINT, MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import { skinDiffuseBRDF, skinDualLobeSpecular } from '../shaders/skin_brdf';

/**
 * HDR range packed into the SkinSSS side buffer when the render graph falls
 * back to an 8-bit format.
 * @public
 */
export const SKIN_SSS_LDR_ENCODE_RANGE = 4;

/**
 * Physically-based skin material aligned with UE5's SubsurfaceProfile shading model.
 *
 * @remarks
 * Uses a pre-integrated curvature-dependent diffuse BRDF and dual-lobe GGX specular
 * driven by subsurface profile parameters. The specular luminance is written to
 * `SceneColor.a` so the {@link SkinSSS} post effect can precisely separate specular
 * from diffuse for Burley diffusion redistribution.
 *
 * The optional `subsurfaceTexture` uses R as skin mask, G as curvature and B as
 * thickness for the back-lit transmission term.
 *
 * @public
 */
export class SkinMaterial
  extends applyMaterialMixins(MeshMaterial, mixinLight, mixinVertexColor, mixinTextureProps('subsurface'))
  implements Clonable<SkinMaterial>
{
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  private _roughness: number;
  private _specularStrength: number;
  private _specularF0: number;
  private _transmissionStrength: number;
  private _transmissionPower: number;
  private _dualLobeBlend: number;
  private _narrowLobeMod: number;
  private _wideLobeMod: number;

  constructor() {
    super();
    this._roughness = 0.35;
    this._specularStrength = 1;
    this._specularF0 = 0.028;
    this._transmissionStrength = 0;
    this._transmissionPower = 4;
    this._dualLobeBlend = 0.5;
    this._narrowLobeMod = 0.5;
    this._wideLobeMod = 0.7;
    this.useFeature(SkinMaterial.FEATURE_VERTEX_NORMAL, true);
  }

  /** Marker used by the forward render graph to allocate the SkinSSS MRT. */
  get skinSSS() {
    return true;
  }

  clone() {
    const other = new SkinMaterial();
    other.copyFrom(this);
    return other;
  }

  copyFrom(other: this) {
    super.copyFrom(other);
    this.vertexNormal = other.vertexNormal;
    this.vertexTangent = other.vertexTangent;
    this.roughness = other.roughness;
    this.specularStrength = other.specularStrength;
    this.specularF0 = other.specularF0;
    this.transmissionStrength = other.transmissionStrength;
    this.transmissionPower = other.transmissionPower;
    this.dualLobeBlend = other.dualLobeBlend;
    this.narrowLobeRoughnessMod = other.narrowLobeRoughnessMod;
    this.wideLobeRoughnessMod = other.wideLobeRoughnessMod;
  }

  get vertexNormal() {
    return this.featureUsed<boolean>(SkinMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(SkinMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }

  get vertexTangent() {
    return this.featureUsed<boolean>(SkinMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val) {
    this.useFeature(SkinMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }

  /** GGX base roughness. 0.35 is typical for skin. */
  get roughness() {
    return this._roughness;
  }
  set roughness(val) {
    const next = Math.max(0.045, Math.min(1, val ?? 0.35));
    if (next !== this._roughness) {
      this._roughness = next;
      this.uniformChanged();
    }
  }

  /** Specular strength multiplier. */
  get specularStrength() {
    return this._specularStrength;
  }
  set specularStrength(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._specularStrength) {
      this._specularStrength = next;
      this.uniformChanged();
    }
  }

  /** Fresnel F0 for the skin oil layer. 0.028 is the physical skin value. */
  get specularF0() {
    return this._specularF0;
  }
  set specularF0(val) {
    const next = Math.max(0, Math.min(0.2, val ?? 0.028));
    if (next !== this._specularF0) {
      this._specularF0 = next;
      this.uniformChanged();
    }
  }

  /** Back-lit transmission strength (needs thickness in subsurface texture B). */
  get transmissionStrength() {
    return this._transmissionStrength;
  }
  set transmissionStrength(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._transmissionStrength) {
      this._transmissionStrength = next;
      this.uniformChanged();
    }
  }

  /** Exponent of the back-lit transmission falloff. */
  get transmissionPower() {
    return this._transmissionPower;
  }
  set transmissionPower(val) {
    const next = Math.max(1, val ?? 1);
    if (next !== this._transmissionPower) {
      this._transmissionPower = next;
      this.uniformChanged();
    }
  }

  /** Blend factor between narrow and wide specular lobes (UE5 profile row 5.z). */
  get dualLobeBlend() {
    return this._dualLobeBlend;
  }
  set dualLobeBlend(val) {
    const next = Math.max(0, Math.min(1, val ?? 0.5));
    if (next !== this._dualLobeBlend) {
      this._dualLobeBlend = next;
      this.uniformChanged();
    }
  }

  /** Narrow lobe roughness modifier (UE5 profile row 5.x). */
  get narrowLobeRoughnessMod() {
    return this._narrowLobeMod;
  }
  set narrowLobeRoughnessMod(val) {
    const next = Math.max(0, Math.min(1, val ?? 0.5));
    if (next !== this._narrowLobeMod) {
      this._narrowLobeMod = next;
      this.uniformChanged();
    }
  }

  /** Wide lobe roughness modifier (UE5 profile row 5.y). */
  get wideLobeRoughnessMod() {
    return this._wideLobeMod;
  }
  set wideLobeRoughnessMod(val) {
    const next = Math.max(0, Math.min(1, val ?? 0.7));
    if (next !== this._wideLobeMod) {
      this._wideLobeMod = next;
      this.uniformChanged();
    }
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
    if (this.needFragmentColorInput()) {
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        scope.zSkinRoughness = pb.float().uniform(2);
        scope.zSkinSpecularStrength = pb.float().uniform(2);
        scope.zSkinSpecularF0 = pb.float().uniform(2);
        scope.zSkinNarrowLobeMod = pb.float().uniform(2);
        scope.zSkinWideLobeMod = pb.float().uniform(2);
        scope.zSkinDualLobeBlend = pb.float().uniform(2);
        scope.zSkinScatterEncodeScale = pb.float().uniform(2);
        if (this.subsurfaceTexture) {
          scope.zSkinTransmissionStrength = pb.float().uniform(2);
          scope.zSkinTransmissionPower = pb.float().uniform(2);
        }
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      if (this.vertexColor) {
        scope.albedo = pb.mul(scope.albedo, this.getVertexColor(scope));
      }
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        const baseLightPass = !this.drawContext.lightBlending;
        scope.$l.normalInfo = this.calculateNormalAndTBN(
          scope,
          scope.$inputs.worldPos,
          scope.$inputs.wNorm,
          scope.$inputs.wTangent,
          scope.$inputs.wBinormal
        );
        scope.$l.normal = scope.normalInfo.normal;
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        scope.$l.roughness = scope.zSkinRoughness;
        scope.$l.skinMask = pb.float(1);
        scope.$l.skinThickness = pb.float(0);
        if (this.subsurfaceTexture) {
          scope.$l.subsurfaceTexel = this.sampleSubsurfaceTexture(scope);
          scope.skinMask = pb.clamp(scope.subsurfaceTexel.r, 0, 1);
          scope.skinThickness = pb.clamp(scope.subsurfaceTexel.b, 0, 1);
        }
        scope.$l.diffuseLighting = pb.vec3(0);
        scope.$l.transmissionLighting = pb.vec3(0);
        scope.$l.specularLighting = pb.vec3(0);
        scope.$l.NoV = pb.clamp(pb.dot(scope.normal, scope.viewVec), 0.0001, 1);
        // --- Environment lighting ---
        if (this.needCalculateEnvLight() && baseLightPass) {
          scope.$l.envDiffuse = this.getEnvLightIrradiance(scope, scope.normal);
          scope.diffuseLighting = pb.add(scope.diffuseLighting, scope.envDiffuse);
          scope.$l.reflectVec = this.calculateReflectionVector(scope, scope.normal, scope.viewVec);
          scope.$l.envF0 = pb.vec3(scope.zSkinSpecularF0);
          scope.$l.envF90 = pb.vec3(pb.clamp(pb.sub(1, scope.roughness), scope.zSkinSpecularF0, 1));
          scope.$l.envF = pb.add(
            scope.envF0,
            pb.mul(pb.sub(scope.envF90, scope.envF0), pb.pow(pb.sub(1, scope.NoV), 5))
          );
          scope.specularLighting = pb.add(
            scope.specularLighting,
            pb.mul(
              this.getEnvLightRadiance(scope, scope.reflectVec, scope.roughness),
              scope.envF,
              scope.zSkinSpecularStrength
            )
          );
        }
        this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
          this.$l.diffuseScale = pb.float(1);
          this.$l.specularScale = pb.float(1);
          this.$l.sourceRadiusFactor = pb.float(0);
          this.$if(pb.equal(type, LIGHT_TYPE_POINT), function () {
            this.diffuseScale = extra.x;
            this.specularScale = extra.y;
            this.sourceRadiusFactor = pb.div(
              extra.z,
              pb.max(pb.distance(posRange.xyz, this.$inputs.worldPos), 0.0001)
            );
          });
          this.$l.lightAtten = that.calculateLightAttenuation(
            this,
            type,
            this.$inputs.worldPos,
            posRange,
            dirCutoff,
            extra
          );
          this.$l.lightDir = that.calculateLightDirection(
            this,
            type,
            this.$inputs.worldPos,
            posRange,
            dirCutoff
          );
          this.$l.rawNdotL = pb.dot(this.normal, this.lightDir);
          this.$l.NoL = pb.clamp(this.rawNdotL, 0, 1);
          this.$l.VdotL = pb.dot(this.viewVec, this.lightDir);
          // Shadow: pre-integrated BRDF handles NdotL internally, so pass a
          // fixed bias to keep normal-offset stable at the terminator.
          this.$l.shadowTerm = shadow
            ? that.calculateShadow(this, this.$inputs.worldPos, scope.normalInfo.TBN[2], pb.float(0.5))
            : pb.float(1);
          this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
          this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
          this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
          this.$l.LoH = pb.clamp(pb.dot(this.lightDir, this.halfVec), 0, 1);
          // Pre-integrated skin diffuse — Burley-like Fresnel modulation.
          // No NdotL clamping: SSS allows light to scatter past the terminator.
          this.$l.skinDiff = skinDiffuseBRDF(this, this.rawNdotL, this.NoV, this.VdotL, this.roughness);
          this.diffuseLighting = pb.add(
            this.diffuseLighting,
            pb.mul(this.lightColor, this.shadowTerm, this.skinDiff, this.diffuseScale, 1 / Math.PI)
          );
          // Back-lit transmission
          if (that.subsurfaceTexture) {
            this.$l.transmission = pb.mul(
              pb.pow(
                pb.clamp(pb.dot(pb.neg(this.lightDir), this.viewVec), 0, 1),
                this.zSkinTransmissionPower
              ),
              this.skinThickness,
              this.zSkinTransmissionStrength
            );
            this.transmissionLighting = pb.add(
              this.transmissionLighting,
              pb.mul(this.lightColor, this.transmission, this.diffuseScale, 1 / Math.PI)
            );
          }
          // Dual-lobe GGX specular
          this.$l.spec = skinDualLobeSpecular(
            this,
            this.NoH,
            this.NoV,
            this.NoL,
            this.LoH,
            this.roughness,
            this.zSkinSpecularF0,
            this.skinMask,
            this.zSkinNarrowLobeMod,
            this.zSkinWideLobeMod,
            this.zSkinDualLobeBlend
          );
          this.specularLighting = pb.add(
            this.specularLighting,
            pb.mul(
              this.lightColor,
              this.shadowTerm,
              this.spec,
              this.zSkinSpecularStrength,
              this.specularScale
            )
          );
        });
        // --- Assemble ---
        scope.$l.diffusible = pb.mul(
          scope.albedo.rgb,
          pb.add(scope.diffuseLighting, scope.transmissionLighting)
        );
        scope.$l.litColor = pb.add(scope.diffusible, scope.specularLighting);
        // SceneColor.a = specular luminance (UE5 mechanism for spec/diff separation)
        scope.$l.specLum = pb.dot(scope.specularLighting, pb.vec3(0.2126, 0.7152, 0.0722));
        scope.$l.skinSSS = pb.vec4(pb.mul(scope.diffusible, scope.zSkinScatterEncodeScale), scope.skinMask);
        if (
          this.drawContext.materialFlags &
          (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
        ) {
          scope.$l.outRoughness = pb.vec4(
            pb.mul(scope.albedo.rgb, pb.sub(1, scope.roughness), scope.zSkinSpecularStrength),
            pb.mul(scope.roughness, ShaderHelper.getCameraRoughnessFactor(scope))
          );
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            pb.vec4(scope.litColor, scope.specLum),
            scope.outRoughness,
            pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), 1),
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            scope.skinSSS
          );
        } else {
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            pb.vec4(scope.litColor, scope.specLum),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            scope.skinSSS
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
    if (this.needFragmentColor(ctx) && ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      bindGroup.setValue('zSkinRoughness', this._roughness);
      bindGroup.setValue('zSkinSpecularStrength', this._specularStrength);
      bindGroup.setValue('zSkinSpecularF0', this._specularF0);
      bindGroup.setValue('zSkinNarrowLobeMod', this._narrowLobeMod);
      bindGroup.setValue('zSkinWideLobeMod', this._wideLobeMod);
      bindGroup.setValue('zSkinDualLobeBlend', this._dualLobeBlend);
      const ldrSkinSSS = ctx.SkinSSSTexture && ctx.SkinSSSTexture.format === 'rgba8unorm';
      bindGroup.setValue('zSkinScatterEncodeScale', ldrSkinSSS ? 1 / SKIN_SSS_LDR_ENCODE_RANGE : 1);
      if (this.subsurfaceTexture) {
        bindGroup.setValue('zSkinTransmissionStrength', this._transmissionStrength);
        bindGroup.setValue('zSkinTransmissionPower', this._transmissionPower);
      }
    }
  }
}
