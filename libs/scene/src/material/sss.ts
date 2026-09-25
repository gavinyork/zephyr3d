import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, RenderStateSet } from '@zephyr3d/device';
import { Vector2, Vector3, type Clonable } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import {
  LIGHT_TYPE_POINT,
  MaterialVaryingFlags,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT
} from '../values';
import {
  skinDiffuseBRDF,
  skinDualLobeSpecular,
  skinDualSpecularRoughness,
  skinSpecularEnergyTerms,
  skinTransmission
} from '../shaders/skin_brdf';
import { SSSProfile } from './sssprofile';
import { fetchSampler } from '../utility/misc';

/**
 * HDR range that used to be packed into the PostSSS side buffer when the render
 * graph fell back to an 8-bit format.
 *
 * @deprecated The SSS scattering source is now recovered from `SceneColor` via
 * the diffuse luminance stored in its alpha channel (matching UE5), so no side
 * buffer and no LDR encoding is involved. Kept for source compatibility; it has
 * no effect on rendering.
 *
 * @public
 */
export const SKIN_SSS_LDR_ENCODE_RANGE = 4;

/**
 * Physically-based SSS material aligned with UE5's SubsurfaceProfile shading model.
 *
 * @remarks
 * Uses a pre-integrated curvature-dependent diffuse BRDF and dual-lobe GGX specular
 * driven by subsurface profile parameters. The **diffuse** luminance is written to
 * `SceneColor.a` so the {@link PostSSS} post effect can recover the diffusible
 * fraction as `saturate(SceneColor.a / luma(SceneColor.rgb))` — the same spec/diff
 * separation UE5 performs in its SSS Setup and Recombine passes.
 *
 * The optional `subsurfaceTexture` uses R as the SSS mask, which gates both the
 * screen-space diffusion and the dual specular lobe. Its other channels are
 * unused: transmission thickness is measured against the light's shadow map by
 * the transmission thickness pass rather than painted, and curvature is not part
 * of this path.
 *
 * @public
 */
export class SSSMaterial
  extends applyMaterialMixins(MeshMaterial, mixinLight, mixinVertexColor, mixinTextureProps('subsurface'))
  implements Clonable<SSSMaterial>
{
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  private _roughness: number;
  private _specularF0: number;
  private _transmissionStrength: number;
  private readonly _profile: SSSProfile;
  private readonly _subsurfaceProfileChanged: () => void;
  private readonly _lobeParams: Vector3;
  private readonly _profileTexelSize: Vector2;

  constructor() {
    super();
    this._subsurfaceProfileChanged = () => this.uniformChanged();
    // Created here and released in onDispose: the profile holds a row of a
    // 256-entry GPU table, and tying its life to the material's is what keeps
    // those rows from accumulating.
    this._profile = SSSProfile.createOwned();
    this._profile.addChangeListener(this._subsurfaceProfileChanged);
    this._lobeParams = new Vector3();
    this._profileTexelSize = new Vector2();
    this._roughness = 0.5;
    this._specularF0 = 0.04;
    this._transmissionStrength = 1;
    this.useFeature(SSSMaterial.FEATURE_VERTEX_NORMAL, true);
  }

  /** Releases the profile's table row along with the material. */
  protected onDispose() {
    super.onDispose();
    this._profile.removeChangeListener(this._subsurfaceProfileChanged);
    this._profile.dispose();
  }

  /**
   * Marker used by the forward render graph to enable the PostSSS post effect.
   *
   * @remarks
   * This no longer allocates a side buffer: the scattering source is recovered
   * from `SceneColor` and its diffuse-luminance alpha.
   */
  get postSSS() {
    return true;
  }

  /**
   * The profile driving this material's subsurface scattering.
   *
   * @remarks
   * Read-only and never null: the material creates one in its constructor and
   * owns it for life, so edit it in place rather than assigning a new one.
   *
   * ```ts
   * material.subsurfaceProfile.preset = 'jade';
   * material.subsurfaceProfile.meanFreePathDistance = 0.03;
   * ```
   *
   * Per-material ownership is what lets face, ears and lips scatter differently
   * in a single screen-space pass: the material writes its profile's id per pixel
   * and the diffusion looks the parameters up from there. Profiles are therefore
   * not shared - to transfer a look, use {@link SSSProfile.copyFrom}.
   *
   * @public
   */
  get subsurfaceProfile(): SSSProfile {
    return this._profile;
  }

  /**
   * Keeps the diffuse luminance written to `SceneColor.a` instead of letting the
   * opaque path overwrite it with 1. {@link PostSSS} needs it to separate the
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
    const other = new SSSMaterial();
    other.copyFrom(this);
    return other;
  }

  copyFrom(other: this) {
    super.copyFrom(other);
    // The values, not the profile: a clone owns its own row of the table, so
    // that disposing either material cannot pull the parameters out from under
    // the other.
    this._profile.copyFrom(other._profile);
    this.vertexNormal = other.vertexNormal;
    this.vertexTangent = other.vertexTangent;
    this.roughness = other.roughness;
    this.specularF0 = other.specularF0;
    this.transmissionStrength = other.transmissionStrength;
  }

  get vertexNormal() {
    return this.featureUsed<boolean>(SSSMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(SSSMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }

  get vertexTangent() {
    return this.featureUsed<boolean>(SSSMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val) {
    this.useFeature(SSSMaterial.FEATURE_VERTEX_TANGENT, !!val);
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

  /**
   * Fresnel reflectance at normal incidence.
   *
   * @remarks
   * Defaults to 0.04, what UE5's default `Specular` of 0.5 gives through
   * `F0 = 0.08 * Specular`; to port a UE5 material, use that conversion. This is
   * the only control over highlight strength, since a post-multiplier would skew
   * the grazing end of the Fresnel curve and bypass the energy terms, so the
   * specular would stop paying for itself out of the diffuse.
   *
   * The profile's IOR does not feed this: that drives transmission's refraction,
   * while the specular Fresnel stays on the dielectric mapping.
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

  /**
   * Overall multiplier on the back-lit transmission.
   *
   * @remarks
   * UE5 has no equivalent - its transmission is fully determined by the profile
   * and the measured thickness - so 1 is the faithful value and this exists only
   * to dial the effect back or push it further.
   *
   * Transmission additionally requires {@link PunctualLight.transmission} on at
   * least one shadow-casting light, since the thickness it needs is measured
   * against that light's shadow map. With no such light this has no effect.
   *
   * @public
   */
  get transmissionStrength() {
    return this._transmissionStrength;
  }
  set transmissionStrength(val) {
    const next = Math.max(0, val ?? 1);
    if (next !== this._transmissionStrength) {
      this._transmissionStrength = next;
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
    const lightPass = this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT;
    // Declared outside `needFragmentColorInput` deliberately: that predicate is
    // false in the prepass for an ordinary opaque material, so a declaration
    // inside it would leave the uniform undefined and the prepass would write id
    // 0 for every SSS pixel.
    const depthPassProfileId =
      this.drawContext.renderPass!.type === RENDER_PASS_TYPE_DEPTH && this.drawContext.sssProfileId;
    if (lightPass || depthPassProfileId) {
      scope.zSSSProfileId = pb.float().uniform(2);
    }
    if (this.needFragmentColorInput()) {
      if (lightPass) {
        scope.zSSSRoughness = pb.float().uniform(2);
        scope.zSSSSpecularF0 = pb.float().uniform(2);
        scope.zSSSLobeParams = pb.vec3().uniform(2);
        // Transmission is compiled in only when the thickness it needs exists.
        // The flag is part of the shader's cache key (render/lightpass.ts), and
        // it also guards against the per-light additive path, which has no
        // thickness texture and hands the BxDF a placeholder.
        if (this.drawContext.transmissionThickness) {
          scope.zSSSTransmissionStrength = pb.float().uniform(2);
          // rgba32f, so WebGPU will only accept a non-filtering sampler here;
          // the transmission profile is interpolated by hand for that reason.
          scope.zSSSProfileTex = pb.tex2D().sampleType('unfilterable-float').uniform(2);
          scope.zSSSProfileTexelSize = pb.vec2().uniform(2);
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
        scope.$l.roughness = scope.zSSSRoughness;
        scope.$l.skinMask = pb.float(1);
        if (this.subsurfaceTexture) {
          scope.$l.subsurfaceTexel = this.sampleSubsurfaceTexture(scope);
          scope.skinMask = pb.clamp(scope.subsurfaceTexel.r, 0, 1);
        }
        scope.$l.diffuseLighting = pb.vec3(0);
        scope.$l.transmissionLighting = pb.vec3(0);
        scope.$l.specularLighting = pb.vec3(0);
        scope.$l.envSpecular = pb.vec3(0);
        scope.$l.NoV = pb.clamp(pb.dot(scope.normal, scope.viewVec), 0.0001, 1);
        // The lobe roughnesses depend only on the material and profile, so they
        // are resolved once rather than per light. The SSS mask stands in for
        // UE5's per-pixel subsurface opacity, which is what fades the dual lobe
        // out where the surface stops being SSS.
        scope.$l.lobeRoughness = skinDualSpecularRoughness(
          scope,
          scope.roughness,
          scope.skinMask,
          scope.zSSSLobeParams.x,
          scope.zSSSLobeParams.y
        );
        // Multiple-scattering compensation. UE5 takes the average lobe roughness
        // here rather than computing a term per lobe, and applies the result to
        // both the direct and the ambient contribution.
        scope.$l.avgLobeRoughness = pb.mix(
          scope.lobeRoughness.x,
          scope.lobeRoughness.y,
          scope.zSSSLobeParams.z
        );
        scope.$l.energyTerms = skinSpecularEnergyTerms(
          scope,
          scope.avgLobeRoughness,
          scope.NoV,
          scope.zSSSSpecularF0
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
          // UE5's ReflectionEnvironment:
          //
          //   EnergyTerms = ComputeGGXSpecEnergyTerms(GBuffer.Roughness, NoV, SpecularColor)
          //   Color.rgb   = GatherRadiance(R, GBuffer.Roughness) * EnergyTerms.E
          //
          // Two consequences. The roughness is the raw **material** value, since
          // UE5 applies the dual lobe only in the direct BxDF. And the weight is
          // the directional albedo `E` - the split-sum DFG with multiple-scattering
          // folded in, not a bare Fresnel - which already carries the multi-scatter
          // gain, so it must not also be multiplied by the direct path's `W`.
          scope.$l.envEnergyTerms = skinSpecularEnergyTerms(
            scope,
            scope.roughness,
            scope.NoV,
            scope.zSSSSpecularF0
          );
          scope.envSpecular = pb.mul(
            this.getEnvLightRadiance(scope, scope.reflectVec, scope.roughness),
            scope.envEnergyTerms.y
          );
        }
        this.forEachLight(
          scope,
          function (
            type,
            posRange,
            dirCutoff,
            colorIntensity,
            extra,
            shadow,
            thickness,
            unshadowedColorIntensity
          ) {
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
              dirCutoff,
              extra
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
            // Back-lit transmission, after UE5's SubsurfaceProfileBxDF. UE5
            // attenuates by the *transmission* shadow, which is the encoded
            // optical depth itself - so the same value both indexes the profile
            // and scales it, which is why `thickness` appears twice.
            //
            // No surface shadow and no NoL: the light arrives from behind, so the
            // camera-facing surface is shadowed and turned away from it by
            // construction. Applying either would zero out exactly the pixels
            // this term exists for.
            if (that.drawContext.transmissionThickness) {
              this.$l.transmission = skinTransmission(
                this,
                this.zSSSProfileTex,
                this.zSSSProfileTexelSize,
                this.zSSSProfileId,
                thickness,
                this.normal,
                this.viewVec,
                this.lightDir
              );
              // The light before its surface shadow: see LitMaterial.forEachLight.
              // `thickness` below is the transmission's own shadow term.
              this.$l.transmissionLightColor = pb.mul(
                unshadowedColorIntensity.rgb,
                unshadowedColorIntensity.a,
                this.lightAtten
              );
              this.transmissionLighting = pb.add(
                this.transmissionLighting,
                pb.mul(
                  this.transmissionLightColor,
                  this.transmission,
                  thickness,
                  this.zSSSTransmissionStrength,
                  this.diffuseScale
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
              this.zSSSLobeParams.z,
              this.zSSSSpecularF0
            );
            this.specularLighting = pb.add(
              this.specularLighting,
              pb.mul(this.lightColor, this.shadowTerm, this.spec, this.NoL, this.specularScale)
            );
          }
        );
        scope.$l.diffusible = pb.mul(
          scope.albedo.rgb,
          pb.add(pb.mul(scope.diffuseLighting, scope.energyPreservation), scope.transmissionLighting)
        );
        scope.specularLighting = pb.add(
          pb.mul(scope.specularLighting, scope.energyConservation),
          scope.envSpecular
        );
        scope.$l.litColor = pb.add(scope.diffusible, scope.specularLighting);
        scope.$l.diffLum = pb.dot(scope.diffusible, pb.vec3(0.2126, 0.7152, 0.0722));
        scope.$l.postSSSMask = pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), scope.skinMask);
        if (
          this.drawContext.materialFlags &
          (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
        ) {
          scope.$l.outRoughness = pb.vec4(
            pb.mul(scope.albedo.rgb, pb.sub(1, scope.roughness)),
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
            scope.postSSSMask
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
            scope.postSSSMask
          );
        }
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.albedo);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }

  /**
   * The profile id the depth prepass writes for this material.
   *
   * @remarks
   * Overrides {@link MeshMaterial.getDepthPassProfileId}. The uniform is declared
   * in {@link SSSMaterial.fragmentShader} for the prepass as well as the light
   * pass, and bound below.
   */
  protected getDepthPassProfileId(scope: PBInsideFunctionScope) {
    return scope.zSSSProfileId;
  }

  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    const lightPass = ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT;
    const depthPassProfileId = ctx.renderPass!.type === RENDER_PASS_TYPE_DEPTH && ctx.sssProfileId;
    // Not gated on needFragmentColor: the prepass declares this uniform for
    // every SSS material, including the opaque ones that predicate excludes.
    if (lightPass || depthPassProfileId) {
      bindGroup.setValue('zSSSProfileId', this._profile.encodedId);
    }
    if (!this.needFragmentColor(ctx) || !lightPass) {
      return;
    }
    bindGroup.setValue('zSSSRoughness', this._roughness);
    bindGroup.setValue('zSSSSpecularF0', this._specularF0);
    const profile = this._profile;
    bindGroup.setValue(
      'zSSSLobeParams',
      this._lobeParams.setXYZ(profile.roughness0, profile.roughness1, profile.lobeMix)
    );
    if (ctx.transmissionThickness) {
      bindGroup.setValue('zSSSTransmissionStrength', this._transmissionStrength);
      const table = SSSProfile.getTable(ctx.device);
      if (table) {
        bindGroup.setTexture('zSSSProfileTex', table, fetchSampler('clamp_nearest_nomip'));
        this._profileTexelSize.setXY(1 / SSSProfile.tableColumns, 1 / SSSProfile.tableRows);
        bindGroup.setValue('zSSSProfileTexelSize', this._profileTexelSize);
      }
    }
  }
}
