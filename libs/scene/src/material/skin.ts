import type { BindGroup, PBFunctionScope, RenderStateSet } from '@zephyr3d/device';
import { Vector3, type Clonable } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import { LIGHT_TYPE_POINT, MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import {
  skinDiffuseBRDF,
  skinDualLobeSpecular,
  skinDualSpecularRoughness,
  skinSpecularEnergyTerms
} from '../shaders/skin_brdf';
import { SkinProfile } from './skinprofile';

/**
 * HDR range that used to be packed into the SkinSSS side buffer when the render
 * graph fell back to an 8-bit format.
 *
 * @deprecated The skin scattering source is now recovered from `SceneColor` via
 * the diffuse luminance stored in its alpha channel (matching UE5), so no side
 * buffer and no LDR encoding is involved. Kept for source compatibility; it has
 * no effect on rendering.
 *
 * @public
 */
export const SKIN_SSS_LDR_ENCODE_RANGE = 4;

/**
 * Physically-based skin material aligned with UE5's SubsurfaceProfile shading model.
 *
 * @remarks
 * Uses a pre-integrated curvature-dependent diffuse BRDF and dual-lobe GGX specular
 * driven by subsurface profile parameters. The **diffuse** luminance is written to
 * `SceneColor.a` so the {@link SkinSSS} post effect can recover the diffusible
 * fraction as `saturate(SceneColor.a / luma(SceneColor.rgb))` — the same spec/diff
 * separation UE5 performs in its SSS Setup and Recombine passes.
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
  private _profile: SkinProfile | null;
  private readonly _subsurfaceProfileChanged: () => void;
  private readonly _lobeParams: Vector3;

  constructor() {
    super();
    this._profile = null;
    this._subsurfaceProfileChanged = () => this.uniformChanged();
    this._lobeParams = new Vector3();
    this._roughness = 0.5;
    this._specularStrength = 1;
    this._specularF0 = 0.04;
    this._transmissionStrength = 0;
    this._transmissionPower = 4;
    this.useFeature(SkinMaterial.FEATURE_VERTEX_NORMAL, true);
  }

  /**
   * Marker used by the forward render graph to enable the SkinSSS post effect.
   *
   * @remarks
   * This no longer allocates a side buffer: the scattering source is recovered
   * from `SceneColor` and its diffuse-luminance alpha.
   */
  get skinSSS() {
    return true;
  }

  /**
   * Shared profile asset driving the screen-space diffusion.
   *
   * @remarks
   * Assigning distinct profiles to different meshes — face, ears, lips — lets each
   * diffuse with its own scattering parameters in a single pass, since the
   * material writes the profile id per pixel.
   *
   * When `null`, the shared {@link SkinProfile.getDefault | default skin profile}
   * is used for shading.
   *
   * @public
   */
  get subsurfaceProfile() {
    return this._profile;
  }
  set subsurfaceProfile(val: SkinProfile | null) {
    if (val !== this._profile) {
      this._profile?.removeChangeListener(this._subsurfaceProfileChanged);
      this._profile = val ?? null;
      this._profile?.addChangeListener(this._subsurfaceProfileChanged);
      this.uniformChanged();
    }
  }

  /**
   * The profile actually used for shading.
   *
   * @remarks
   * Resolves {@link SkinMaterial.subsurfaceProfile} against the shared default,
   * so this never returns `null`.
   *
   * @public
   */
  get effectiveProfile(): SkinProfile {
    return this._profile ?? SkinProfile.getDefault();
  }

  /**
   * Keeps the diffuse luminance written to `SceneColor.a` instead of letting the
   * opaque path overwrite it with 1. {@link SkinSSS} needs it to separate the
   * diffusible energy from the specular it must leave untouched.
   */
  protected preservesOpaqueAlpha(ctx: DrawContext): boolean {
    return ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT;
  }

  /**
   * Keeps `SceneColor.a` additive across the multi-pass light loop.
   *
   * @remarks
   * The base implementation uses `zero/one` for alpha so that additive light
   * passes preserve whatever the base pass wrote. That is wrong here: the alpha
   * carries the diffuse luminance of the accumulated RGB, so it has to be summed
   * alongside it — otherwise `SceneColor.a / luma(SceneColor.rgb)` under-reports
   * the diffusible fraction as soon as a second light contributes, and the SSS
   * passes would scatter only the first light's diffuse energy.
   */
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext) {
    super.updateRenderStates(pass, stateSet, ctx);
    if (ctx.lightBlending && ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      const blendingState = stateSet.useBlendingState();
      if (blendingState.enabled) {
        blendingState.setBlendFuncAlpha('one', 'one');
      }
    }
  }

  clone() {
    const other = new SkinMaterial();
    other.copyFrom(this);
    return other;
  }

  copyFrom(other: this) {
    super.copyFrom(other);
    this.subsurfaceProfile = other.subsurfaceProfile;
    this.vertexNormal = other.vertexNormal;
    this.vertexTangent = other.vertexTangent;
    this.roughness = other.roughness;
    this.specularStrength = other.specularStrength;
    this.specularF0 = other.specularF0;
    this.transmissionStrength = other.transmissionStrength;
    this.transmissionPower = other.transmissionPower;
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

  /**
   * GGX base roughness the two specular lobes are derived from.
   *
   * @remarks
   * Defaults to UE5's material default of 0.5. The profile then tightens the
   * narrow lobe and broadens the wide one around this value, so it is the centre
   * of the dual-lobe highlight rather than the roughness of either lobe.
   */
  get roughness() {
    return this._roughness;
  }
  set roughness(val) {
    const next = Math.max(0.045, Math.min(1, val ?? 0.5));
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

  /**
   * Fresnel reflectance at normal incidence.
   *
   * @remarks
   * Defaults to 0.04, which is what UE5's default `Specular` of 0.5 produces
   * through `F0 = 0.08 * Specular`.
   *
   * Note the subsurface profile's IOR (1.55 in UE5's skin preset) does not feed
   * this: that value drives the refraction used by transmission, while the
   * specular Fresnel stays on the dielectric `0.08 * Specular` mapping.
   */
  get specularF0() {
    return this._specularF0;
  }
  set specularF0(val) {
    const next = Math.max(0, Math.min(0.2, val ?? 0.04));
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
        scope.zSkinLobeParams = pb.vec3().uniform(2);
        scope.zSkinProfileId = pb.float().uniform(2);
        if (this.subsurfaceTexture) {
          scope.zSkinTransmissionStrength = pb.float().uniform(2);
          scope.zSkinTransmissionPower = pb.float().uniform(2);
          scope.zSkinTransmissionTint = pb.vec3().uniform(2);
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
        // The lobe roughnesses depend only on the material and profile, so they
        // are resolved once rather than per light. The skin mask stands in for
        // UE5's per-pixel subsurface opacity, which is what fades the dual lobe
        // out where the surface stops being skin.
        scope.$l.lobeRoughness = skinDualSpecularRoughness(
          scope,
          scope.roughness,
          scope.skinMask,
          scope.zSkinLobeParams.x,
          scope.zSkinLobeParams.y
        );
        // Multiple-scattering compensation. UE5 takes the average lobe roughness
        // here rather than computing a term per lobe, and applies the result to
        // both the direct and the ambient contribution.
        scope.$l.avgLobeRoughness = pb.mix(
          scope.lobeRoughness.x,
          scope.lobeRoughness.y,
          scope.zSkinLobeParams.z
        );
        scope.$l.energyTerms = skinSpecularEnergyTerms(
          scope,
          scope.avgLobeRoughness,
          scope.NoV,
          scope.zSkinSpecularF0
        );
        // x scales specular back up to unit albedo; 1 - y is the energy left for
        // the diffuse underneath.
        scope.$l.energyConservation = scope.energyTerms.x;
        scope.$l.energyPreservation = pb.sub(1, scope.energyTerms.y);
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
          // Prefiltered radiance is a single lookup, so it takes the blended lobe
          // roughness rather than the raw material value — otherwise the ambient
          // highlight ignores the dual-lobe widening that direct light gets.
          scope.specularLighting = pb.add(
            scope.specularLighting,
            pb.mul(
              this.getEnvLightRadiance(scope, scope.reflectVec, scope.avgLobeRoughness),
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
          this.$l.VoH = pb.clamp(pb.dot(this.viewVec, this.halfVec), 0, 1);
          // Burley diffuse with the NoL cosine, as UE5's SubsurfaceProfileBxDF
          // evaluates it. The soft terminator is the screen-space diffusion's job;
          // bending this term to fake it double-counts the effect.
          this.$l.skinDiff = skinDiffuseBRDF(this, this.NoV, this.NoL, this.VoH, this.roughness);
          this.diffuseLighting = pb.add(
            this.diffuseLighting,
            pb.mul(this.lightColor, this.shadowTerm, this.skinDiff, this.NoL, this.diffuseScale)
          );
          // Back-lit transmission, tinted and attenuated by the profile.
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
              pb.mul(
                this.lightColor,
                this.zSkinTransmissionTint,
                this.transmission,
                this.diffuseScale,
                1 / Math.PI
              )
            );
          }
          // Dual-lobe GGX specular, with the NoL cosine UE5 applies alongside it.
          this.$l.spec = skinDualLobeSpecular(
            this,
            this.NoH,
            this.NoV,
            this.NoL,
            this.VoH,
            this.lobeRoughness,
            this.zSkinLobeParams.z,
            this.zSkinSpecularF0
          );
          this.specularLighting = pb.add(
            this.specularLighting,
            pb.mul(
              this.lightColor,
              this.shadowTerm,
              this.spec,
              this.NoL,
              this.zSkinSpecularStrength,
              this.specularScale
            )
          );
        });
        // --- Assemble ---
        //
        // UE5 applies the energy terms to the accumulated lighting rather than per
        // light: the diffuse loses what the specular layer above it reflected, and
        // the specular gains back the energy single-scattering GGX dropped. The
        // transmission is left alone, since it enters from behind the surface and
        // never passes through that specular layer.
        scope.$l.diffusible = pb.mul(
          scope.albedo.rgb,
          pb.add(
            pb.mul(scope.diffuseLighting, scope.energyPreservation),
            scope.transmissionLighting
          )
        );
        scope.specularLighting = pb.mul(scope.specularLighting, scope.energyConservation);
        scope.$l.litColor = pb.add(scope.diffusible, scope.specularLighting);
        // SceneColor.a = diffuse luminance. This is UE5's spec/diff separation
        // mechanism (verified in UEDigitalHuman.rdc, SSS::Setup lines 26-29 and
        // SSS::Recombine lines 32-36): the SSS passes recover the diffusible
        // fraction as `saturate(SceneColor.a / luma(SceneColor.rgb))`, so the
        // alpha must carry the *diffuse* luminance, not the specular one.
        scope.$l.diffLum = pb.dot(scope.diffusible, pb.vec3(0.2126, 0.7152, 0.0722));
        // Surface data for the SSS passes: rgb = world normal, a = skin mask.
        //
        // SceneColor.a cannot serve as the mask, because every opaque material
        // writes 1 there — gating on it makes the diffusion treat the background
        // and the eyes as skin and bleed into them. This channel plays the role
        // of UE5's Subsurface.ProfileIdTexture.
        //
        // The normal rides along so the diffusion can weight taps by how much
        // the surface has turned away (UE5 PassOne_Burley lines 323-325). Keeping
        // it here rather than reading SceneNormal makes scattering independent of
        // whether the optional normal MRT is enabled this frame.
        // a carries the profile id, scaled by the mask so that unmasked pixels
        // read back as id 0 ("not skin"). The diffusion recovers both from this
        // single channel, which is how UE5 drives several profiles from one pass.
        scope.$l.skinSSSMask = pb.vec4(
          pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)),
          pb.mul(scope.zSkinProfileId, scope.skinMask)
        );
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
            pb.vec4(scope.litColor, scope.diffLum),
            scope.outRoughness,
            pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), 1),
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            scope.skinSSSMask
          );
        } else {
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            pb.vec4(scope.litColor, scope.diffLum),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            scope.skinSSSMask
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
      const profile = this.effectiveProfile;
      bindGroup.setValue('zSkinLobeParams', this._lobeParams.setXYZ(profile.roughness0, profile.roughness1, profile.lobeMix));
      bindGroup.setValue('zSkinProfileId', profile.encodedId);
      if (this.subsurfaceTexture) {
        bindGroup.setValue('zSkinTransmissionStrength', this._transmissionStrength);
        bindGroup.setValue('zSkinTransmissionPower', this._transmissionPower);
        bindGroup.setValue('zSkinTransmissionTint', profile.transmissionTint);
      }
    }
  }
}
