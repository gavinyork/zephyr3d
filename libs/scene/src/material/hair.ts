import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinVertexColor } from './mixins/vertexcolor';
import { mixinTextureProps } from './mixins/texture';
import { mixinPBRBRDF } from './mixins/pbr/brdf';
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
 * Which scattering model shades the hair.
 *
 * - `kajiya-kay`: the phenomenological double lobe. Every term is an art dial,
 *   which makes it predictable and cheap, and is usually what a stylised hair
 *   card wants.
 * - `marschner`: the fibre model, splitting light into the three paths it can
 *   take through a strand. Costs more and gives up some direct control, but the
 *   secondary highlight takes the hair's own colour and backlit tips glow
 *   because the model says they must, not because someone dialled it in.
 * @public
 */
export type HairShadingModel = 'kajiya-kay' | 'marschner';

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
    mixinPBRBRDF,
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
  /** @internal */
  private static readonly FEATURE_SCATTER = this.defineFeature();
  /** @internal Selects the scattering model. Holds a {@link HairShadingModel}. */
  private static readonly FEATURE_SHADING_MODEL = this.defineFeature();
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
  /** @internal Marschner longitudinal shift of the R lobe, in sine units. */
  private _marschnerShift: number;
  /** @internal Marschner longitudinal roughness. */
  private _marschnerRoughness: number;
  /** @internal Refractive index of the fibre. */
  private _marschnerIOR: number;
  /** @internal Multiplier on the Beer-Lambert path length. */
  private _marschnerAbsorption: number;
  /** @internal Per-lobe intensities: R, TT, TRT. */
  private readonly _marschnerLobes: Vector3;
  /** @internal Tint of multiply-scattered light. */
  private readonly _scatterColor: Vector3;
  /** @internal Multiple scattering intensity, 0 disables the term. */
  private _scatterIntensity: number;
  /** @internal Share of the scattering that survives where direct light does not. */
  private _scatterLocal: number;
  /** @internal Angular width of the forward-scattered lobe. */
  private _scatterWrap: number;
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
    // Marschner defaults follow the measured fibre: the cuticle scales tilt the
    // surface by a few degrees, which is what separates the three lobes at all.
    this._marschnerShift = 0.035;
    this._marschnerRoughness = 0.3;
    this._marschnerIOR = 1.55;
    this._marschnerAbsorption = 1;
    this._marschnerLobes = new Vector3(1, 1, 1);
    this._scatterColor = new Vector3(1, 0.85, 0.7);
    this._scatterIntensity = 0;
    this._scatterLocal = 0.5;
    this._scatterWrap = 1;
    this._uniformScratch = new Vector4();
    this.useFeature(HairMaterial.FEATURE_VERTEX_NORMAL, true);
    this.useFeature(HairMaterial.FEATURE_STRAND_DIRECTION, 'binormal');
    this.useFeature(HairMaterial.FEATURE_TRANSMISSION, false);
    this.useFeature(HairMaterial.FEATURE_SCATTER, false);
    this.useFeature(HairMaterial.FEATURE_SHADING_MODEL, 'kajiya-kay');
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
    this.scatterColor = other.scatterColor;
    this.scatterIntensity = other.scatterIntensity;
    this.scatterLocal = other.scatterLocal;
    this.scatterWrap = other.scatterWrap;
    this.shadingModel = other.shadingModel;
    this.marschnerShift = other.marschnerShift;
    this.marschnerRoughness = other.marschnerRoughness;
    this.marschnerIOR = other.marschnerIOR;
    this.marschnerAbsorption = other.marschnerAbsorption;
    this.marschnerLobes = other.marschnerLobes;
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
  /**
   * Tint of multiply-scattered light.
   *
   * @remarks
   * Multiple scattering is strongly wavelength dependent - it is why blonde hair
   * glows and black hair does not - and the tint is applied on top of the hair's
   * own colour, which the term is already modulated by. Warm by default, since
   * the light that survives several bounces through keratin has lost its blue.
   */
  get scatterColor(): Immutable<Vector3> {
    return this._scatterColor;
  }
  set scatterColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._scatterColor)) {
      this._scatterColor.set(val);
      this.uniformChanged();
    }
  }
  /**
   * Multiple scattering intensity. Zero disables the term, which is the default.
   *
   * @remarks
   * Absorption alone makes the inside of a groom black, because that is what
   * absorption does: past a few fibres essentially nothing of the direct beam
   * survives. Real hair is not black there, and the difference is light that
   * reached the point after bouncing off neighbouring fibres rather than
   * travelling straight through.
   *
   * This adds an approximation of it in two parts, following the decomposition
   * dual scattering makes: a global term, the light that came through the hair in
   * front and arrives spread over a wide angle, and a local term, the light that
   * did not come through but re-emerges after scattering nearby. The first fades
   * with depth into the groom, the second does not, and it is the second that
   * stops the interior going black.
   *
   * The forward transmittance both terms are built from is the shadow value, so
   * this is at its most meaningful under a shadow mode that grades it - a deep
   * opacity map. Under a binary filter the global term simply follows the shadow
   * and the local term fills its complement.
   *
   * Off by default: it adds light the material did not previously emit, so it
   * changes the look of any groom it is enabled on rather than refining it.
   */
  get scatterIntensity() {
    return this._scatterIntensity;
  }
  set scatterIntensity(val) {
    val = val < 0 ? 0 : val;
    if (val !== this._scatterIntensity) {
      this._scatterIntensity = val;
      this.useFeature(HairMaterial.FEATURE_SCATTER, val > 0);
      this.uniformChanged();
    }
  }
  /**
   * Balance between the two scattering terms, in [0, 1].
   *
   * @remarks
   * Zero keeps only the global term, so the scattering follows the light and
   * vanishes deep in the groom. One keeps only the local term, which is brightest
   * exactly where the direct light is blocked. The default splits them evenly;
   * denser and lighter hair wants more local.
   */
  get scatterLocal() {
    return this._scatterLocal;
  }
  set scatterLocal(val) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (val !== this._scatterLocal) {
      this._scatterLocal = val;
      this.uniformChanged();
    }
  }
  /**
   * Angular width of the forward-scattered lobe.
   *
   * @remarks
   * Scattering spreads light as it crosses fibres, so the global term is not a
   * cosine lobe but a much broader one; this is how far past the terminator it
   * reaches. Larger than {@link HairMaterial.diffuseWrap} on purpose - that one
   * softens a terminator, this one models a beam that has genuinely lost its
   * direction.
   */
  get scatterWrap() {
    return this._scatterWrap;
  }
  set scatterWrap(val) {
    val = val < 0 ? 0 : val;
    if (val !== this._scatterWrap) {
      this._scatterWrap = val;
      this.uniformChanged();
    }
  }
  /**
   * Which scattering model shades the hair. Defaults to `kajiya-kay`.
   *
   * @remarks
   * Switching to `marschner` changes the look of any hair it is enabled on
   * rather than refining it, so it is opted into. See {@link HairShadingModel}
   * for what the two models are; the `marschner*` properties are inert under
   * `kajiya-kay` and the specular lobe properties are inert under `marschner`.
   *
   * Two existing properties overlap with it and should be left alone when it is
   * on: {@link HairMaterial.transmissionIntensity}, whose whole job is faking the
   * backlit glow that Marschner's TT path produces for real, and - on
   * `HairStrandMaterial` - `strandRoundness`, whose bent normal no longer reaches
   * the highlight, because Marschner already integrates across the fibre.
   */
  get shadingModel() {
    return this.featureUsed<HairShadingModel>(HairMaterial.FEATURE_SHADING_MODEL);
  }
  set shadingModel(val: HairShadingModel) {
    this.useFeature(HairMaterial.FEATURE_SHADING_MODEL, val);
  }
  /**
   * Longitudinal shift of the Marschner lobes, in sine units.
   *
   * @remarks
   * Hair is not a smooth cylinder: overlapping cuticle scales tilt its surface
   * by a few degrees toward the tip. That tilt is the only reason the three
   * lobes sit at different angles instead of on top of one another, so this is
   * what makes them read as separate highlights at all. The three shifts are
   * derived from it in the ratio the measurements give, R getting `-2x` and TRT
   * `4x`, so one dial moves the whole set consistently.
   *
   * Defaults to 0.035, roughly the measured 2 degrees.
   */
  get marschnerShift() {
    return this._marschnerShift;
  }
  set marschnerShift(val) {
    if (val !== this._marschnerShift) {
      this._marschnerShift = val;
      this.uniformChanged();
    }
  }
  /**
   * Longitudinal roughness of the Marschner lobes, in (0, 1].
   *
   * @remarks
   * The angular width of the highlight bands. Per-lobe widths are derived from
   * it - TT half, TRT double - which is the ordering real fibres show: light
   * that only passes through stays tight, light that has bounced inside spreads.
   */
  get marschnerRoughness() {
    return this._marschnerRoughness;
  }
  set marschnerRoughness(val) {
    const v = val < 0.005 ? 0.005 : val > 1 ? 1 : val;
    if (v !== this._marschnerRoughness) {
      this._marschnerRoughness = v;
      this.uniformChanged();
    }
  }
  /**
   * Refractive index of the fibre. Defaults to the measured 1.55 for keratin.
   *
   * @remarks
   * Sets how much light reflects at the surface rather than entering, and how
   * sharply it bends once inside - so it moves the balance between the white R
   * highlight and the two coloured paths. Rarely worth changing from the
   * measured value, but exposed because it is a real physical quantity.
   */
  get marschnerIOR() {
    return this._marschnerIOR;
  }
  set marschnerIOR(val) {
    const v = val < 1.01 ? 1.01 : val;
    if (v !== this._marschnerIOR) {
      this._marschnerIOR = v;
      this.uniformChanged();
    }
  }
  /**
   * Multiplier on how far light travels through the fibre before leaving.
   *
   * @remarks
   * The transmitted paths are tinted by absorbing the hair's own colour over the
   * distance they cross, so raising this deepens the colour of TT and TRT
   * without touching the white surface reflection. It is the dial for "how
   * strongly pigmented", separate from which colour the pigment is.
   */
  get marschnerAbsorption() {
    return this._marschnerAbsorption;
  }
  set marschnerAbsorption(val) {
    const v = val < 0 ? 0 : val;
    if (v !== this._marschnerAbsorption) {
      this._marschnerAbsorption = v;
      this.uniformChanged();
    }
  }
  /**
   * Per-path intensities as `(R, TT, TRT)`, all 1 by default.
   *
   * @remarks
   * Art override on top of the physics, and the fastest way to see what each
   * path contributes: zero two of them and the third is on its own. R is the
   * white surface highlight, TT the backlit glow, TRT the coloured secondary.
   */
  get marschnerLobes(): Immutable<Vector3> {
    return this._marschnerLobes;
  }
  set marschnerLobes(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._marschnerLobes)) {
      this._marschnerLobes.set(val);
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
      if (this.featureUsed(HairMaterial.FEATURE_SCATTER)) {
        scope.zHairScatter = pb.vec4().uniform(2);
      }
      if (this.shadingModel === 'marschner') {
        scope.zHairMarschner1 = pb.vec4().uniform(2);
        scope.zHairMarschner2 = pb.vec4().uniform(2);
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
        scope.$l.normal = this.calculateShadingNormal(scope, scope.normalInfo);
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
        scratch.setXYZW(
          this._transmissionPower,
          this._occlusionStrength,
          this._scatterLocal,
          this._scatterWrap
        )
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
      if (this.featureUsed(HairMaterial.FEATURE_SCATTER)) {
        bindGroup.setValue(
          'zHairScatter',
          scratch.setXYZW(
            this._scatterColor.x,
            this._scatterColor.y,
            this._scatterColor.z,
            this._scatterIntensity
          )
        );
      }
      if (this.shadingModel === 'marschner') {
        bindGroup.setValue(
          'zHairMarschner1',
          scratch.setXYZW(
            this._marschnerShift,
            this._marschnerRoughness,
            this._marschnerIOR,
            this._marschnerAbsorption
          )
        );
        // Normal-incidence reflectance from the index, folded here because it
        // does not vary per fragment. 1.55 gives roughly 0.046.
        const f0 = (this._marschnerIOR - 1) / (this._marschnerIOR + 1);
        bindGroup.setValue(
          'zHairMarschner2',
          scratch.setXYZW(this._marschnerLobes.x, this._marschnerLobes.y, this._marschnerLobes.z, f0 * f0)
        );
      }
    }
  }
  /**
   * Shading normal for the current fragment.
   *
   * @remarks
   * Split out from the interpolated frame so a subclass whose polygons stand in
   * for a different surface can say what that surface is. A hair card really is
   * the flat sheet it is drawn as, so the frame's own normal is right here;
   * {@link HairStrandMaterial} overrides this, because its quads stand in for
   * round fibres and shading them flat is the difference between hair and tape.
   * @internal
   */
  protected calculateShadingNormal(scope: PBInsideFunctionScope, normalInfo: PBShaderExp): PBShaderExp {
    return normalInfo.normal;
  }
  /**
   * Approximates the light that reaches a point after bouncing off neighbouring
   * fibres rather than travelling straight to it.
   *
   * @remarks
   * Follows the split dual scattering makes, without its precomputation - the
   * average forward and backward attenuations that theory derives from the fibre
   * BCSDF are stand-in constants here, because this material's lighting is a
   * phenomenological double lobe rather than a BCSDF to integrate.
   *
   * - **Global**, `throughput * wrapped(NoL)`: the beam that did cross the hair in
   *   front, arriving spread out. Scattering randomises direction as it goes, so
   *   the lobe is far wider than a cosine and reaches well past the terminator.
   * - **Local**, `1 - throughput`: the beam that did not get through. Some of it
   *   leaves the fibres it hit and re-emerges here, which is why it is brightest
   *   exactly where the direct light is fully blocked, and why it does not fade
   *   with depth the way the global term does.
   *
   * Both are modulated by the hair's own colour as well as the scatter tint,
   * because light that has bounced several times has been filtered by keratin
   * several times: it is the reason pale hair glows in shadow and dark hair
   * stays dark, and multiplying by albedo is what carries that difference.
   * @internal
   */
  hairScatter(
    scope: PBInsideFunctionScope,
    lightColor: PBShaderExp,
    albedo: PBShaderExp,
    NoL: PBShaderExp,
    throughput: PBShaderExp,
    ao: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'Z_hairScatter';
    pb.func(
      funcName,
      [pb.vec3('lightColor'), pb.vec3('albedo'), pb.float('NoL'), pb.float('throughput'), pb.float('ao')],
      function () {
        this.$l.localMix = this.zHairParams.z;
        this.$l.wrap = pb.max(this.zHairParams.w, 1e-4);
        // Wrapped well past the terminator, and never negative: a point facing
        // away from the light still receives scattered light, which is the whole
        // point of the term.
        this.$l.spread = pb.clamp(pb.div(pb.add(this.NoL, this.wrap), pb.add(1, this.wrap)), 0, 1);
        this.$l.global = pb.mul(this.throughput, this.spread);
        this.$l.local = pb.sub(1, this.throughput);
        this.$l.amount = pb.mix(this.global, this.local, this.localMix);
        this.$return(
          pb.mul(
            this.lightColor,
            this.albedo,
            this.zHairScatter.rgb,
            this.zHairScatter.a,
            this.amount,
            this.ao
          )
        );
      }
    );
    return pb.getGlobalScope()[funcName](lightColor, albedo, NoL, throughput, ao) as PBShaderExp;
  }
  /**
   * Normalised longitudinal lobe: a unit-integral Gaussian of width `width`.
   *
   * @remarks
   * Stands in for the exact longitudinal term, which involves a Bessel function
   * and, in the energy-conserving formulation, `cosh` - and `cosh` is not
   * available on WebGL1 in this shader builder. The Gaussian is the
   * approximation Marschner's own paper offers and is what real-time
   * implementations use.
   * @internal
   */
  private hairLongitudinal(scope: PBInsideFunctionScope, width: PBShaderExp, offset: PBShaderExp) {
    const pb = scope.$builder;
    const funcName = 'Z_hairLongitudinal';
    pb.func(funcName, [pb.float('width'), pb.float('offset')], function () {
      this.$l.b = pb.max(this.width, 0.0001);
      this.$l.t = pb.div(this.offset, this.b);
      this.$return(pb.div(pb.exp(pb.mul(this.t, this.t, -0.5)), pb.mul(this.b, Math.sqrt(2 * Math.PI))));
    });
    return pb.getGlobalScope()[funcName](width, offset) as PBShaderExp;
  }
  /**
   * Marschner fibre scattering: the three paths light can take through a strand.
   *
   * @remarks
   * Treats the strand as a translucent dielectric cylinder and adds up what
   * leaves it, split by how many times the light crossed a surface:
   *
   * - **R** bounces straight off the outside. It never meets the pigment, so it
   *   is the colour of the light - the white sheen on dark hair.
   * - **TT** goes in one side and out the other, crossing the pigment twice. It
   *   leaves roughly opposite where it entered, so it is what you see when the
   *   light is behind the head, and it carries the deepest colour.
   * - **TRT** goes in, reflects off the far inside wall, and comes back out. It
   *   emerges near the side it entered, so it reads as a second highlight
   *   alongside R - but having crossed the pigment three times it is tinted,
   *   which is why the secondary highlight of real hair is hair-coloured. The
   *   double lobe has to be told that; here it falls out.
   *
   * Each path is a longitudinal lobe `M` in the angle up the fibre times an
   * azimuthal lobe `N` in the angle around it, over `cos²θd` to convert the
   * fibre's scattering into a BCSDF. `M` is a Gaussian, offset per path by the
   * tilt of the cuticle scales - which is the entire reason the three appear at
   * different angles rather than on top of each other.
   *
   * `N` is where the original model is expensive: solving it exactly means
   * finding the roots of the exit-angle equation, a cubic for TRT. These are the
   * published analytic fits to those solutions, which is the standard real-time
   * trade - it costs the sharp caustic glint that a true root solve produces,
   * and keeps everything else.
   *
   * Deliberately never touches the shading normal: the fibre frame is the
   * tangent plus the two directions, and the round cross-section is already
   * integrated into `N`. That makes it immune to the flat-ribbon normal problem
   * that `HairStrandMaterial.strandRoundness` exists to work around.
   * @internal
   */
  private hairMarschner(
    scope: PBInsideFunctionScope,
    strandT: PBShaderExp,
    lightDir: PBShaderExp,
    viewVec: PBShaderExp,
    albedo: PBShaderExp,
    shiftVal: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_hairMarschner';
    pb.func(
      funcName,
      [pb.vec3('T'), pb.vec3('L'), pb.vec3('V'), pb.vec3('albedo'), pb.float('shiftVal')],
      function () {
        // Longitudinal angles, measured off the plane perpendicular to the fibre.
        this.$l.sinThetaL = pb.clamp(pb.dot(this.T, this.L), -1, 1);
        this.$l.sinThetaV = pb.clamp(pb.dot(this.T, this.V), -1, 1);
        // The difference angle. Every path length inside the fibre scales with
        // it, because a ray that enters obliquely has further to travel.
        this.$l.thetaD = pb.mul(pb.abs(pb.sub(pb.asin(this.sinThetaV), pb.asin(this.sinThetaL))), 0.5);
        this.$l.cosThetaD = pb.max(pb.cos(this.thetaD), 0.001);
        // Azimuth, from the two directions projected onto the fibre's cross
        // section. cos(phi) alone is enough: every N below is symmetric about
        // the plane through the light, so the sign of phi never matters.
        this.$l.Lp = pb.sub(this.L, pb.mul(this.T, this.sinThetaL));
        this.$l.Vp = pb.sub(this.V, pb.mul(this.T, this.sinThetaV));
        this.$l.cosPhi = pb.clamp(
          pb.mul(
            pb.dot(this.Lp, this.Vp),
            pb.inverseSqrt(pb.add(pb.mul(pb.dot(this.Lp, this.Lp), pb.dot(this.Vp, this.Vp)), 1e-5))
          ),
          -1,
          1
        );
        this.$l.cosHalfPhi = pb.sqrt(pb.clamp(pb.add(pb.mul(this.cosPhi, 0.5), 0.5), 0, 1));

        this.$l.ior = pb.max(this.zHairMarschner1.z, 1.01);
        // F0 is a function of the index alone, so it is folded on the CPU.
        this.$l.f0 = pb.vec3(this.zHairMarschner2.w);
        this.$l.f90 = pb.vec3(1);
        // Bravais' virtual index. A ray crossing the fibre at a slant refracts as
        // though the material had a different index; this is that index. The
        // widely used `1.19/cosThetaD + 0.36*cosThetaD` is a fit to this
        // expression for one particular value of the index, and would ignore the
        // index entirely - which would quietly make an exposed IOR do nothing.
        // The exact form costs one sqrt and keeps the parameter meaningful.
        this.$l.nPrime = pb.div(
          pb.sqrt(
            pb.max(pb.add(pb.mul(this.ior, this.ior), pb.mul(this.cosThetaD, this.cosThetaD), -1), 0.01)
          ),
          this.cosThetaD
        );

        // Cuticle tilt. The ratios between the three are what the measurements
        // give; the shift map perturbs all three together, per strand.
        this.$l.shift = pb.add(this.zHairMarschner1.x, this.shiftVal);
        this.$l.beta = pb.max(this.zHairMarschner1.y, 0.005);
        this.$l.width = pb.mul(this.beta, this.beta);
        this.$l.theta = pb.add(this.sinThetaL, this.sinThetaV);
        this.$l.absorb = this.zHairMarschner1.w;
        // Guards pow() against a zero base, which is legal but not uniformly
        // well behaved across drivers.
        this.$l.tint = pb.max(this.albedo, pb.vec3(0.0001));

        // --- R: off the surface, uncoloured.
        this.$l.mR = that.hairLongitudinal(this, this.width, pb.sub(this.theta, pb.mul(this.shift, -2)));
        this.$l.nR = pb.mul(this.cosHalfPhi, 0.25);
        this.$l.fR = that.fresnelSchlick(
          this,
          pb.sqrt(pb.clamp(pb.add(pb.mul(pb.dot(this.V, this.L), 0.5), 0.5), 0, 1)),
          this.f0,
          this.f90
        );
        this.$l.sR = pb.mul(this.fR, this.mR, this.nR, this.zHairMarschner2.x);

        // --- TT: in one side, out the other. Two pigment crossings.
        this.$l.mTT = that.hairLongitudinal(this, pb.mul(this.width, 0.5), pb.sub(this.theta, this.shift));
        this.$l.a = pb.div(1, this.nPrime);
        // Where across the fibre the ray that reaches the eye entered. The fit
        // stands in for inverting the refraction, and drives both how much
        // reflects away and how far the rest travels through the pigment.
        this.$l.h = pb.clamp(
          pb.mul(this.cosHalfPhi, pb.add(1, pb.mul(this.a, pb.sub(0.6, pb.mul(this.cosPhi, 0.8))))),
          -1,
          1
        );
        this.$l.fTT = that.fresnelSchlick(
          this,
          pb.mul(this.cosThetaD, pb.sqrt(pb.max(pb.sub(1, pb.mul(this.h, this.h)), 0))),
          this.f0,
          this.f90
        );
        this.$l.oneMinusFTT = pb.sub(pb.vec3(1), this.fTT);
        this.$l.ha = pb.mul(this.h, this.a);
        this.$l.pathTT = pb.div(
          pb.mul(pb.sqrt(pb.max(pb.sub(1, pb.mul(this.ha, this.ha)), 0)), 0.5),
          this.cosThetaD
        );
        this.$l.tTT = pb.pow(this.tint, pb.vec3(pb.mul(this.pathTT, this.absorb)));
        this.$l.nTT = pb.exp(pb.sub(pb.mul(this.cosPhi, -3.65), 3.98));
        this.$l.sTT = pb.mul(
          this.oneMinusFTT,
          this.oneMinusFTT,
          this.tTT,
          this.mTT,
          this.nTT,
          this.zHairMarschner2.y
        );

        // --- TRT: in, off the far wall, back out. Three pigment crossings, so
        // this is the lobe that carries the hair's colour into the highlight.
        this.$l.mTRT = that.hairLongitudinal(
          this,
          pb.mul(this.width, 2),
          pb.sub(this.theta, pb.mul(this.shift, 4))
        );
        this.$l.fTRT = that.fresnelSchlick(this, pb.mul(this.cosThetaD, 0.5), this.f0, this.f90);
        this.$l.oneMinusFTRT = pb.sub(pb.vec3(1), this.fTRT);
        this.$l.tTRT = pb.pow(this.tint, pb.vec3(pb.mul(pb.div(0.8, this.cosThetaD), this.absorb)));
        this.$l.nTRT = pb.exp(pb.sub(pb.mul(this.cosPhi, 17), 16.78));
        this.$l.sTRT = pb.mul(
          this.oneMinusFTRT,
          this.oneMinusFTRT,
          this.fTRT,
          this.tTRT,
          this.mTRT,
          this.nTRT,
          this.zHairMarschner2.z
        );

        this.$return(pb.div(pb.add(this.sR, this.sTT, this.sTRT), pb.mul(this.cosThetaD, this.cosThetaD)));
      }
    );
    return pb.getGlobalScope()[funcName](strandT, lightDir, viewVec, albedo, shiftVal) as PBShaderExp;
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
    const useScatter = that.featureUsed<boolean>(HairMaterial.FEATURE_SCATTER);
    const useMarschner = that.shadingModel === 'marschner';
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
          this.$l.scatterColor = pb.vec3(0);
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
            this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
            // Wrap diffuse softens the terminator across thin cards.
            this.$l.wrap = this.zHairShift.w;
            this.$l.diffFactor = pb.clamp(pb.div(pb.add(this.NoL, this.wrap), pb.add(1, this.wrap)), 0, 1);
            if (useMarschner) {
              // No half vector and no specular fade here. The fade exists to stop
              // the double lobe glowing where no light reaches; Marschner's TT
              // path is light that genuinely came through the fibre from behind,
              // so fading it out on the unlit side would delete the one thing the
              // model offers that the double lobe cannot produce at all.
              this.$l.specTerm = that.hairMarschner(
                this,
                this.strandT,
                this.lightDir,
                this.viewVec,
                this.albedo.rgb,
                this.shiftVal
              );
            } else {
              this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
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
            }
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
            // Fraction of the beam that reached this point without being absorbed.
            // Under a deep opacity map this grades with how much hair the light
            // crossed, which is exactly what the scattering terms want; under a
            // binary filter it is one or zero and they degrade to following it.
            this.$l.throughput = pb.float(1);
            if (shadow) {
              this.$l.shadow = that.calculateShadow(
                this,
                this.worldPos,
                this.geometricNormal,
                pb.max(this.NoL, 0)
              );
              this.throughput = this.shadow;
              this.diffuse = pb.mul(this.diffuse, this.shadow);
              this.specular = pb.mul(this.specular, this.shadow);
              this.transmission = pb.mul(this.transmission, this.shadow);
            }
            if (useScatter) {
              this.scatterColor = pb.add(
                this.scatterColor,
                that.hairScatter(this, this.lightColor, this.albedo.rgb, this.NoL, this.throughput, this.ao)
              );
            }
            this.diffuseColor = pb.add(this.diffuseColor, this.diffuse);
            this.specularColor = pb.add(this.specularColor, this.specular);
            this.transmissionColor = pb.add(this.transmissionColor, this.transmission);
          });
          this.$return(
            pb.add(
              pb.mul(this.albedo.rgb, this.diffuseColor),
              this.specularColor,
              this.transmissionColor,
              this.scatterColor
            )
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
