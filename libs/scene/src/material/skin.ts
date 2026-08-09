import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import type { Clonable, Immutable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import { LIGHT_TYPE_POINT, MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';

/**
 * HDR range packed into the SkinSSS side buffer when the render graph falls
 * back to an 8-bit format. The material divides the scatter irradiance by this
 * factor on write and {@link SkinSSS} multiplies it back after the blur.
 * @public
 */
export const SKIN_SSS_LDR_ENCODE_RANGE = 4;

/**
 * Stylized realtime skin material.
 *
 * @remarks
 * This material is designed for the {@link SkinSSS} post effect. It renders a regular lit color,
 * and when `camera.skinSSS` is enabled it also writes a skin lighting multiplier into the
 * `SkinSSSTexture` MRT. The post effect blurs that side buffer in screen space to create a soft
 * character-skin look similar to simple game/anime skin renderers.
 *
 * The optional `subsurfaceTexture` uses R as skin mask, G as local softness and B as thickness
 * for the back-lit transmission term (thin regions such as ears and nostrils glow when lit from
 * behind; enable it by setting {@link SkinMaterial.transmissionStrength}).
 *
 * @public
 */
export class SkinMaterial
  extends applyMaterialMixins(MeshMaterial, mixinLight, mixinVertexColor, mixinTextureProps('subsurface'))
  implements Clonable<SkinMaterial>
{
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  private _shininess: number;
  private _specularStrength: number;
  private _diffuseWrap: number;
  private _diffuseSoftness: number;
  private _scatterWrap: number;
  private _scatterStrength: number;
  private readonly _scatterColor: Vector4;
  private _transmissionStrength: number;
  private _transmissionPower: number;

  constructor() {
    super();
    this._shininess = 72;
    this._specularStrength = 0.22;
    this._diffuseWrap = 0.28;
    this._diffuseSoftness = 0.45;
    this._scatterWrap = 0.65;
    this._scatterStrength = 0.7;
    this._scatterColor = new Vector4(1, 0.42, 0.28, 1);
    this._transmissionStrength = 0;
    this._transmissionPower = 4;
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
    this.shininess = other.shininess;
    this.specularStrength = other.specularStrength;
    this.diffuseWrap = other.diffuseWrap;
    this.diffuseSoftness = other.diffuseSoftness;
    this.scatterWrap = other.scatterWrap;
    this.scatterStrength = other.scatterStrength;
    this.scatterColor = other.scatterColor;
    this.transmissionStrength = other.transmissionStrength;
    this.transmissionPower = other.transmissionPower;
  }

  /** true if vertex normal attribute presents */
  get vertexNormal() {
    return this.featureUsed<boolean>(SkinMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(SkinMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }

  /** true if vertex tangent attribute presents */
  get vertexTangent() {
    return this.featureUsed<boolean>(SkinMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val) {
    this.useFeature(SkinMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }

  /** Blinn specular exponent. Higher values produce smaller highlights. */
  get shininess() {
    return this._shininess;
  }
  set shininess(val) {
    const next = Math.max(1, val ?? 1);
    if (next !== this._shininess) {
      this._shininess = next;
      this.uniformChanged();
    }
  }

  /** Direct specular strength. Keep this restrained for soft skin. */
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

  /** Wrap amount for visible diffuse lighting. */
  get diffuseWrap() {
    return this._diffuseWrap;
  }
  set diffuseWrap(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._diffuseWrap) {
      this._diffuseWrap = next;
      this.uniformChanged();
    }
  }

  /** Blend from hard Lambert lighting to wrapped diffuse lighting. */
  get diffuseSoftness() {
    return this._diffuseSoftness;
  }
  set diffuseSoftness(val) {
    const next = Math.max(0, Math.min(1, val ?? 0));
    if (next !== this._diffuseSoftness) {
      this._diffuseSoftness = next;
      this.uniformChanged();
    }
  }

  /** Wider wrap used only for the post-process scattering source. */
  get scatterWrap() {
    return this._scatterWrap;
  }
  set scatterWrap(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._scatterWrap) {
      this._scatterWrap = next;
      this.uniformChanged();
    }
  }

  /** Strength of the multiplier written into the SkinSSS side buffer. */
  get scatterStrength() {
    return this._scatterStrength;
  }
  set scatterStrength(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._scatterStrength) {
      this._scatterStrength = next;
      this.uniformChanged();
    }
  }

  /**
   * Strength of the back-lit transmission term. Requires a `subsurfaceTexture`
   * with thickness in the B channel; 0 (the default) disables transmission.
   */
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

  /** Exponent of the back-lit transmission falloff. Higher values tighten the glow. */
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

  /** Warm tint for the blurred skin lighting contribution. */
  get scatterColor(): Immutable<Vector4> {
    return this._scatterColor;
  }
  set scatterColor(val: Immutable<Vector4>) {
    if (!val.equalsTo(this._scatterColor)) {
      this._scatterColor.set(val);
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
        scope.zSkinShininess = pb.float().uniform(2);
        scope.zSkinSpecularStrength = pb.float().uniform(2);
        scope.zSkinDiffuseWrap = pb.float().uniform(2);
        scope.zSkinDiffuseSoftness = pb.float().uniform(2);
        scope.zSkinScatterWrap = pb.float().uniform(2);
        scope.zSkinScatterStrength = pb.float().uniform(2);
        scope.zSkinScatterColor = pb.vec4().uniform(2);
        // Encodes HDR scatter irradiance into the SkinSSS buffer range when the
        // render graph falls back to rgba8unorm (see getSSSLightingTextureFormat).
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
        scope.$l.normal = this.calculateNormal(
          scope,
          scope.$inputs.worldPos,
          scope.$inputs.wNorm,
          scope.$inputs.wTangent,
          scope.$inputs.wBinormal
        );
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        scope.$l.roughness = pb.sqrt(pb.div(2, pb.add(scope.zSkinShininess, 2)));
        scope.$l.skinMask = pb.float(1);
        scope.$l.skinSoftness = pb.float(0);
        scope.$l.skinThickness = pb.float(0);
        if (this.subsurfaceTexture) {
          scope.$l.subsurfaceTexel = this.sampleSubsurfaceTexture(scope);
          scope.skinMask = pb.clamp(scope.subsurfaceTexel.r, 0, 1);
          scope.skinSoftness = pb.clamp(scope.subsurfaceTexel.g, 0, 1);
          scope.skinThickness = pb.clamp(scope.subsurfaceTexel.b, 0, 1);
        }
        scope.$l.diffuseLighting = pb.vec3(0);
        scope.$l.scatterLighting = pb.vec3(0);
        scope.$l.specularLighting = pb.vec3(0);
        if (this.needCalculateEnvLight() && baseLightPass) {
          scope.$l.envDiffuse = this.getEnvLightIrradiance(scope, scope.normal);
          scope.diffuseLighting = pb.add(scope.diffuseLighting, scope.envDiffuse);
          scope.scatterLighting = pb.add(
            scope.scatterLighting,
            pb.mul(scope.envDiffuse, pb.add(0.7, pb.mul(scope.skinSoftness, 0.45)))
          );
          scope.$l.reflectVec = this.calculateReflectionVector(scope, scope.normal, scope.viewVec);
          scope.specularLighting = pb.add(
            scope.specularLighting,
            pb.mul(
              this.getEnvLightRadiance(scope, scope.reflectVec, scope.roughness),
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
          this.$l.rawNoL = pb.dot(this.normal, this.lightDir);
          this.$l.NoL = pb.clamp(this.rawNoL, 0, 1);
          this.$l.NoLWrap = pb.clamp(
            pb.div(pb.add(this.rawNoL, this.zSkinDiffuseWrap), pb.add(1, this.zSkinDiffuseWrap)),
            0,
            1
          );
          this.$l.NoLScatter = pb.clamp(
            pb.div(pb.add(this.rawNoL, this.zSkinScatterWrap), pb.add(1, this.zSkinScatterWrap)),
            0,
            1
          );
          // calculateShadow() samples with implicit derivatives (dpdx); WGSL
          // requires the call to stay in uniform control flow, so never wrap
          // it in a dynamic branch such as NoLWrap > 0.
          this.$l.shadowTerm = shadow
            ? that.calculateShadow(this, this.$inputs.worldPos, pb.max(this.NoL, 1e-5))
            : pb.float(1);
          this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.shadowTerm);
          this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
          this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
          this.$l.pointShininess = pb.max(
            pb.div(this.zSkinShininess, pb.add(1, pb.mul(this.sourceRadiusFactor, 32))),
            1
          );
          this.$l.hardDiffuse = pb.mul(this.lightColor, this.NoL, this.diffuseScale, 1 / Math.PI);
          this.$l.softDiffuse = pb.mul(this.lightColor, this.NoLWrap, this.diffuseScale, 1 / Math.PI);
          this.$l.softness = pb.clamp(
            pb.add(this.zSkinDiffuseSoftness, pb.mul(this.skinSoftness, 0.35)),
            0,
            1
          );
          this.diffuseLighting = pb.add(
            this.diffuseLighting,
            pb.mix(this.hardDiffuse, this.softDiffuse, this.softness)
          );
          this.scatterLighting = pb.add(
            this.scatterLighting,
            pb.mul(
              this.lightColor,
              this.NoLScatter,
              pb.add(0.7, pb.mul(this.skinSoftness, 0.55)),
              this.diffuseScale,
              1 / Math.PI
            )
          );
          if (that.subsurfaceTexture) {
            // Back-lit transmission: thin regions (B channel of the subsurface
            // texture) glow when the light faces the camera through the
            // surface. shadowFade already releases the shadow term on the
            // back-facing side, so the glow is not killed by self shadowing.
            this.$l.transmission = pb.mul(
              pb.pow(
                pb.clamp(pb.dot(pb.neg(this.lightDir), this.viewVec), 0, 1),
                this.zSkinTransmissionPower
              ),
              this.skinThickness,
              this.zSkinTransmissionStrength
            );
            this.scatterLighting = pb.add(
              this.scatterLighting,
              pb.mul(this.diffuseLightColor, this.transmission, this.diffuseScale, 1 / Math.PI)
            );
          }
          // Normalized Blinn with Schlick Fresnel (skin F0 = 0.028). Specular
          // keeps the unfaded shadow term and hard NoL masking.
          this.$l.specNormalization = pb.div(pb.add(this.pointShininess, 8), 8 * Math.PI);
          this.$l.specFresnel = pb.add(0.028, pb.mul(0.972, pb.pow(pb.sub(1, this.LoH), 5)));
          this.$l.specular = pb.mul(
            this.lightColor,
            pb.pow(this.NoH, this.pointShininess),
            this.zSkinSpecularStrength,
            this.specularScale,
            this.NoLWrap
          );
          this.specularLighting = pb.add(this.specularLighting, this.specular);
        });
        scope.$l.litColor = pb.add(pb.mul(scope.albedo.rgb, scope.diffuseLighting), scope.specularLighting);
        scope.$l.scatterMultiplier = pb.add(
          baseLightPass ? pb.vec3(1) : pb.vec3(0),
          pb.mul(
            scope.albedo.rgb,
            scope.scatterLighting,
            scope.zSkinScatterColor.rgb,
            scope.zSkinScatterStrength,
            pb.add(0.75, pb.mul(scope.skinSoftness, 0.45))
          )
        );
        scope.$l.skinSSS = pb.vec4(pb.mul(scope.scatterTerm, scope.zSkinScatterEncodeScale), scope.skinMask);
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
            pb.vec4(scope.litColor, scope.albedo.a),
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
            pb.vec4(scope.litColor, scope.albedo.a),
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
      bindGroup.setValue('zSkinShininess', this._shininess);
      bindGroup.setValue('zSkinSpecularStrength', this._specularStrength);
      bindGroup.setValue('zSkinDiffuseWrap', this._diffuseWrap);
      bindGroup.setValue('zSkinDiffuseSoftness', this._diffuseSoftness);
      bindGroup.setValue('zSkinScatterWrap', this._scatterWrap);
      bindGroup.setValue('zSkinScatterStrength', this._scatterStrength);
      bindGroup.setValue('zSkinScatterColor', this._scatterColor);
      const ldrSkinSSS = ctx.SkinSSSTexture && ctx.SkinSSSTexture.format === 'rgba8unorm';
      bindGroup.setValue('zSkinScatterEncodeScale', ldrSkinSSS ? 1 / SKIN_SSS_LDR_ENCODE_RANGE : 1);
      if (this.subsurfaceTexture) {
        bindGroup.setValue('zSkinTransmissionStrength', this._transmissionStrength);
        bindGroup.setValue('zSkinTransmissionPower', this._transmissionPower);
      }
    }
  }
}
