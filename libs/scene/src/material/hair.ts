import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import { LIGHT_TYPE_POINT, MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { DrawContext } from '../render';
import type { Clonable, Immutable } from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';

/**
 * Which TBN axis runs along the hair strands of the card atlas.
 *
 * Most hair-card atlases lay strands out along the V axis of the UV, which maps to
 * the binormal; use 'tangent' when strands run along U instead.
 * @public
 */
export type HairStrandDirection = 'tangent' | 'binormal';

/**
 * Hair-card material using a Kajiya-Kay style double-lobe anisotropic lighting model.
 *
 * Lighting terms:
 * - Wrap diffuse to soften the terminator across thin cards.
 * - Primary specular lobe (usually near-white, sharp, shifted toward the root).
 * - Secondary specular lobe (tinted by hair color, broader, shifted toward the tip),
 *   with an optional shift texture that jitters both lobes per strand to break up
 *   the "angel ring" into natural streaks.
 * - Optional view-dependent transmission for backlit tips.
 * - Optional baked occlusion map (root darkening).
 *
 * Alpha handling comes from the MeshMaterial base: use `alphaCutoff` plus
 * `alphaDither` for TAA-converged soft edges on the opaque core, and
 * `blendMode='blend'` for the outer flyaway layer.
 * @public
 */
export class HairMaterial
  extends applyMaterialMixins(
    MeshMaterial,
    mixinLight,
    mixinVertexColor,
    mixinTextureProps('specularShift'),
    mixinTextureProps('occlusion')
  )
  implements Clonable<HairMaterial>
{
  /** @internal */
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_STRAND_DIRECTION = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_TRANSMISSION = this.defineFeature();
  /** @internal Primary lobe color (usually near-white). */
  private readonly _specular1Color: Vector3;
  /** @internal Primary lobe exponent. */
  private _specular1Power: number;
  /** @internal Primary lobe shift along the normal (negative moves toward root). */
  private _specular1Shift: number;
  /** @internal Secondary lobe color, multiplied by albedo in the shader. */
  private readonly _specular2Color: Vector3;
  /** @internal Secondary lobe exponent. */
  private _specular2Power: number;
  /** @internal Secondary lobe shift along the normal. */
  private _specular2Shift: number;
  /** @internal Scale applied to (shiftTexture.r - 0.5). */
  private _shiftMapScale: number;
  /** @internal Wrap diffuse amount in [0, 1]. */
  private _diffuseWrap: number;
  /** @internal Transmission tint color. */
  private readonly _transmissionColor: Vector3;
  /** @internal Transmission intensity, 0 disables the term. */
  private _transmissionIntensity: number;
  /** @internal Transmission view-alignment exponent. */
  private _transmissionPower: number;
  /** @internal Occlusion map strength in [0, 1]. */
  private _occlusionStrength: number;
  /** @internal Scratch vector for packing uniform values without per-frame allocation. */
  private readonly _uniformScratch: Vector4;
  /**
   * Creates an instance of HairMaterial with defaults tuned for dark stylized hair.
   */
  constructor() {
    super();
    this._specular1Color = new Vector3(0.35, 0.35, 0.35);
    this._specular1Power = 160;
    this._specular1Shift = -0.15;
    this._specular2Color = new Vector3(0.5, 0.45, 0.4);
    this._specular2Power = 40;
    this._specular2Shift = 0.1;
    this._shiftMapScale = 1;
    this._diffuseWrap = 0.5;
    this._transmissionColor = new Vector3(0.9, 0.65, 0.45);
    this._transmissionIntensity = 0;
    this._transmissionPower = 6;
    this._occlusionStrength = 1;
    this._uniformScratch = new Vector4();
    this.useFeature(HairMaterial.FEATURE_VERTEX_NORMAL, true);
    this.useFeature(HairMaterial.FEATURE_STRAND_DIRECTION, 'binormal');
    this.useFeature(HairMaterial.FEATURE_TRANSMISSION, false);
    // Hair cards are visible from both sides.
    this.cullMode = 'none';
  }
  clone() {
    const other = new HairMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    this.specular1Color = other.specular1Color;
    this.specular1Power = other.specular1Power;
    this.specular1Shift = other.specular1Shift;
    this.specular2Color = other.specular2Color;
    this.specular2Power = other.specular2Power;
    this.specular2Shift = other.specular2Shift;
    this.shiftMapScale = other.shiftMapScale;
    this.diffuseWrap = other.diffuseWrap;
    this.transmissionColor = other.transmissionColor;
    this.transmissionIntensity = other.transmissionIntensity;
    this.transmissionPower = other.transmissionPower;
    this.occlusionStrength = other.occlusionStrength;
  }
  /** true if vertex normal attribute presents */
  get vertexNormal() {
    return this.featureUsed<boolean>(HairMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(HairMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }
  /** true if vertex tangent attribute presents */
  get vertexTangent() {
    return this.featureUsed<boolean>(HairMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val) {
    this.useFeature(HairMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }
  /** Which TBN axis runs along the strands */
  get strandDirection() {
    return this.featureUsed<HairStrandDirection>(HairMaterial.FEATURE_STRAND_DIRECTION);
  }
  set strandDirection(val) {
    this.useFeature(HairMaterial.FEATURE_STRAND_DIRECTION, val);
  }
  /** Primary specular lobe color */
  get specular1Color(): Immutable<Vector3> {
    return this._specular1Color;
  }
  set specular1Color(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._specular1Color)) {
      this._specular1Color.set(val);
      this.uniformChanged();
    }
  }
  /** Primary specular lobe exponent */
  get specular1Power() {
    return this._specular1Power;
  }
  set specular1Power(val) {
    if (val !== this._specular1Power) {
      this._specular1Power = val;
      this.uniformChanged();
    }
  }
  /** Primary specular lobe shift along the normal */
  get specular1Shift() {
    return this._specular1Shift;
  }
  set specular1Shift(val) {
    if (val !== this._specular1Shift) {
      this._specular1Shift = val;
      this.uniformChanged();
    }
  }
  /** Secondary specular lobe color (multiplied by albedo) */
  get specular2Color(): Immutable<Vector3> {
    return this._specular2Color;
  }
  set specular2Color(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._specular2Color)) {
      this._specular2Color.set(val);
      this.uniformChanged();
    }
  }
  /** Secondary specular lobe exponent */
  get specular2Power() {
    return this._specular2Power;
  }
  set specular2Power(val) {
    if (val !== this._specular2Power) {
      this._specular2Power = val;
      this.uniformChanged();
    }
  }
  /** Secondary specular lobe shift along the normal */
  get specular2Shift() {
    return this._specular2Shift;
  }
  set specular2Shift(val) {
    if (val !== this._specular2Shift) {
      this._specular2Shift = val;
      this.uniformChanged();
    }
  }
  /** Scale applied to the shift texture */
  get shiftMapScale() {
    return this._shiftMapScale;
  }
  set shiftMapScale(val) {
    if (val !== this._shiftMapScale) {
      this._shiftMapScale = val;
      this.uniformChanged();
    }
  }
  /** Wrap diffuse amount in [0, 1] */
  get diffuseWrap() {
    return this._diffuseWrap;
  }
  set diffuseWrap(val) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (val !== this._diffuseWrap) {
      this._diffuseWrap = val;
      this.uniformChanged();
    }
  }
  /** Transmission tint color */
  get transmissionColor(): Immutable<Vector3> {
    return this._transmissionColor;
  }
  set transmissionColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._transmissionColor)) {
      this._transmissionColor.set(val);
      this.uniformChanged();
    }
  }
  /** Transmission intensity, 0 disables the transmission term */
  get transmissionIntensity() {
    return this._transmissionIntensity;
  }
  set transmissionIntensity(val) {
    val = val < 0 ? 0 : val;
    if (val !== this._transmissionIntensity) {
      this._transmissionIntensity = val;
      this.useFeature(HairMaterial.FEATURE_TRANSMISSION, val > 0);
      this.uniformChanged();
    }
  }
  /** Transmission view-alignment exponent */
  get transmissionPower() {
    return this._transmissionPower;
  }
  set transmissionPower(val) {
    if (val !== this._transmissionPower) {
      this._transmissionPower = val;
      this.uniformChanged();
    }
  }
  /** Occlusion map strength in [0, 1] */
  get occlusionStrength() {
    return this._occlusionStrength;
  }
  set occlusionStrength(val) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (val !== this._occlusionStrength) {
      this._occlusionStrength = val;
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
    if (
      this.needFragmentColor() &&
      this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
      !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)
    ) {
      scope.zHairSpec1 = pb.vec4().uniform(2);
      scope.zHairSpec2 = pb.vec4().uniform(2);
      scope.zHairShift = pb.vec4().uniform(2);
      scope.zHairParams = pb.vec4().uniform(2);
      if (this.featureUsed(HairMaterial.FEATURE_TRANSMISSION)) {
        scope.zHairTransmission = pb.vec4().uniform(2);
      }
    }
    if (this.needFragmentColorInput()) {
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
        scope.$l.normal = scope.normalInfo.normal;
        scope.$l.strandT =
          this.strandDirection === 'tangent' ? scope.normalInfo.TBN[0] : scope.normalInfo.TBN[1];
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        if (this.specularShiftTexture) {
          scope.$l.shiftVal = pb.mul(
            pb.sub(this.sampleSpecularShiftTexture(scope).r, 0.5),
            scope.zHairShift.z
          );
        } else {
          scope.$l.shiftVal = pb.float(0);
        }
        if (this.occlusionTexture) {
          scope.$l.hairAO = pb.mix(pb.float(1), this.sampleOcclusionTexture(scope).r, scope.zHairParams.y);
        } else {
          scope.$l.hairAO = pb.float(1);
        }
        scope.$l.litColor = this.hairLight(
          scope,
          scope.$inputs.worldPos,
          scope.normal,
          scope.strandT,
          scope.viewVec,
          scope.albedo,
          scope.shiftVal,
          scope.hairAO,
          scope.normalInfo.TBN[2]
        );
        if (
          this.drawContext.materialFlags &
          (MaterialVaryingFlags.SCENE_STORE_ROUGHNESS | MaterialVaryingFlags.SCENE_STORE_NORMAL)
        ) {
          // Screen-space reflections only produce noise on thin hair strands,
          // so write zero reflectance to keep SSR off for hair pixels.
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            pb.vec4(scope.litColor, scope.albedo.a),
            pb.vec4(0, 0, 0, 1),
            pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), 1)
          );
        } else {
          this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
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
      this.needFragmentColor(ctx) &&
      ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
      !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)
    ) {
      const scratch = this._uniformScratch;
      bindGroup.setValue(
        'zHairSpec1',
        scratch.setXYZW(
          this._specular1Color.x,
          this._specular1Color.y,
          this._specular1Color.z,
          this._specular1Power
        )
      );
      bindGroup.setValue(
        'zHairSpec2',
        scratch.setXYZW(
          this._specular2Color.x,
          this._specular2Color.y,
          this._specular2Color.z,
          this._specular2Power
        )
      );
      bindGroup.setValue(
        'zHairShift',
        scratch.setXYZW(this._specular1Shift, this._specular2Shift, this._shiftMapScale, this._diffuseWrap)
      );
      bindGroup.setValue(
        'zHairParams',
        scratch.setXYZW(this._transmissionPower, this._occlusionStrength, 0, 0)
      );
      if (this.featureUsed(HairMaterial.FEATURE_TRANSMISSION)) {
        bindGroup.setValue(
          'zHairTransmission',
          scratch.setXYZW(
            this._transmissionColor.x,
            this._transmissionColor.y,
            this._transmissionColor.z,
            this._transmissionIntensity
          )
        );
      }
    }
  }
  /**
   * Scheuermann-style anisotropic strand specular: shift the strand tangent along
   * the normal, then raise sin(T', H) to the lobe exponent with a directional fade.
   * @internal
   */
  private hairStrandSpecular(
    scope: PBInsideFunctionScope,
    strandT: PBShaderExp,
    normal: PBShaderExp,
    halfVec: PBShaderExp,
    shift: PBShaderExp,
    power: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'Z_hairStrandSpecular';
    pb.func(
      funcName,
      [pb.vec3('strandT'), pb.vec3('normal'), pb.vec3('halfVec'), pb.float('shift'), pb.float('power')],
      function () {
        this.$l.shiftedT = pb.normalize(pb.add(this.strandT, pb.mul(this.normal, this.shift)));
        this.$l.TdotH = pb.dot(this.shiftedT, this.halfVec);
        this.$l.sinTH = pb.sqrt(pb.max(pb.sub(1, pb.mul(this.TdotH, this.TdotH)), 0));
        this.$l.dirAtten = pb.smoothStep(-1, 0, this.TdotH);
        this.$return(pb.mul(this.dirAtten, pb.pow(pb.max(this.sinTH, 0.0001), this.power)));
      }
    );
    return pb.getGlobalScope()[funcName](strandT, normal, halfVec, shift, power) as PBShaderExp;
  }
  /**
   * Computes the lit color for hair with wrap diffuse, double-lobe anisotropic
   * specular and optional transmission.
   * @internal
   */
  /**
   * @param geometricNormal - Interpolated vertex normal, used for shadow normal
   * offset bias. Defaults to `normal`.
   */
  hairLight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    strandT: PBShaderExp,
    viewVec: PBShaderExp,
    albedo: PBShaderExp,
    shiftVal: PBShaderExp,
    ao: PBShaderExp,
    geometricNormal?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'Z_hairLight';
    const that = this;
    const baseLightPass = !that.drawContext.lightBlending;
    const useTransmission = that.featureUsed<boolean>(HairMaterial.FEATURE_TRANSMISSION);
    pb.func(
      funcName,
      [
        pb.vec3('worldPos'),
        pb.vec3('normal'),
        pb.vec3('strandT'),
        pb.vec3('viewVec'),
        pb.vec4('albedo'),
        pb.float('shiftVal'),
        pb.float('ao'),
        pb.vec3('geometricNormal')
      ],
      function () {
        if (!that.needFragmentColor()) {
          this.$return(this.albedo.rgb);
        } else {
          if (that.needCalculateEnvLight() && baseLightPass) {
            this.$l.diffuseColor = pb.mul(that.getEnvLightIrradiance(this, this.normal), this.ao);
          } else {
            this.$l.diffuseColor = pb.vec3(0);
          }
          this.$l.specularColor = pb.vec3(0);
          this.$l.transmissionColor = pb.vec3(0);
          that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
            this.$l.diffuseScale = pb.float(1);
            this.$l.specularScale = pb.float(1);
            this.$if(pb.equal(type, LIGHT_TYPE_POINT), function () {
              this.diffuseScale = extra.x;
              this.specularScale = extra.y;
            });
            this.$l.lightAtten = that.calculateLightAttenuation(
              this,
              type,
              this.worldPos,
              posRange,
              dirCutoff,
              extra
            );
            this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
            this.$l.NoL = pb.dot(this.normal, this.lightDir);
            this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
            this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
            // Wrap diffuse softens the terminator across thin cards.
            this.$l.wrap = this.zHairShift.w;
            this.$l.diffFactor = pb.clamp(pb.div(pb.add(this.NoL, this.wrap), pb.add(1, this.wrap)), 0, 1);
            this.$l.spec1 = that.hairStrandSpecular(
              this,
              this.strandT,
              this.normal,
              this.halfVec,
              pb.add(this.zHairShift.x, this.shiftVal),
              this.zHairSpec1.w
            );
            this.$l.spec2 = that.hairStrandSpecular(
              this,
              this.strandT,
              this.normal,
              this.halfVec,
              pb.add(this.zHairShift.y, this.shiftVal),
              this.zHairSpec2.w
            );
            // Fade specular out on the fully unlit side to avoid glowing shadows.
            this.$l.specFade = pb.smoothStep(-0.35, 0.15, this.NoL);
            this.$l.specTerm = pb.mul(
              pb.add(
                pb.mul(this.zHairSpec1.rgb, this.spec1),
                pb.mul(this.zHairSpec2.rgb, this.albedo.rgb, this.spec2)
              ),
              this.specFade
            );
            this.$l.diffuse = pb.mul(
              this.lightColor,
              1 / Math.PI,
              this.diffFactor,
              this.ao,
              this.diffuseScale
            );
            this.$l.specular = pb.mul(this.lightColor, this.specTerm, this.ao, this.specularScale);
            if (useTransmission) {
              this.$l.transDir = pb.normalize(pb.add(this.lightDir, pb.mul(this.normal, 0.3)));
              this.$l.VoL = pb.clamp(pb.dot(this.viewVec, pb.neg(this.transDir)), 0, 1);
              this.$l.transFactor = pb.mul(pb.pow(this.VoL, this.zHairParams.x), this.zHairTransmission.a);
              this.$l.transmission = pb.mul(
                this.lightColor,
                this.zHairTransmission.rgb,
                this.transFactor,
                this.ao
              );
            } else {
              this.$l.transmission = pb.vec3(0);
            }
            if (shadow) {
              this.$l.shadow = that.calculateShadow(
                this,
                this.worldPos,
                this.geometricNormal,
                pb.max(this.NoL, 0)
              );
              this.diffuse = pb.mul(this.diffuse, this.shadow);
              this.specular = pb.mul(this.specular, this.shadow);
              this.transmission = pb.mul(this.transmission, this.shadow);
            }
            this.diffuseColor = pb.add(this.diffuseColor, this.diffuse);
            this.specularColor = pb.add(this.specularColor, this.specular);
            this.transmissionColor = pb.add(this.transmissionColor, this.transmission);
          });
          this.$return(
            pb.add(pb.mul(this.albedo.rgb, this.diffuseColor), this.specularColor, this.transmissionColor)
          );
        }
      }
    );
    return pb
      .getGlobalScope()
      [
        funcName
      ](worldPos, normal, strandT, viewVec, albedo, shiftVal, ao, geometricNormal ?? normal) as PBShaderExp;
  }
}
