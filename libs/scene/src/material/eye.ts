import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { Clonable, Immutable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinPBRBRDF } from './mixins/pbr/brdf';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import { LIGHT_TYPE_POINT, RENDER_PASS_TYPE_LIGHT } from '../values';

/**
 * Realtime eye material for realistic and semi-realistic characters.
 *
 * @remarks
 * Shades the whole eyeball - sclera, limbus and iris - from a single mesh and a
 * single material. There is no separate cornea layer: the corneal bulge is
 * simulated by refracting the view ray and offsetting the iris lookup, so the
 * asset needs no transparent second surface and the material never participates
 * in OIT or depth sorting.
 *
 * The refraction is done in tangent space rather than in the eye's own object
 * space. That is a deliberate constraint of the engine rather than a stylistic
 * choice: {@link ShaderHelper.resolveVertexPosition} yields the post-skinning
 * position, the bind-pose attribute is not exposed as a varying, and no inverse
 * world matrix is available to a shader - so a fixed object-space gaze axis
 * cannot be reconstructed. Working off the per-fragment TBN sidesteps all of
 * that at the cost of slight inaccuracy over the sphere's curvature, which is
 * small at the depths an iris actually sits.
 *
 * Regions are derived analytically from the distance between the sampling UV and
 * the iris centre, so no mask texture is required and the limbal ring comes for
 * free. This is why the asset must place the iris at a known UV location - see
 * {@link EyeMaterial.irisCenter}.
 *
 * Expected asset setup:
 * - A single eyeball mesh (sphere or front dome) carrying normals *and*
 *   tangents; without tangents there is no TBN and refraction degrades to a
 *   flat iris.
 * - UVs that place the pupil centre at {@link EyeMaterial.irisCenter}, with the
 *   iris occupying a disc of {@link EyeMaterial.irisRadius} around it.
 * - An iris texture with the pupil at its centre. The sclera texture is
 *   optional; without one the sclera is shaded from {@link EyeMaterial.scleraColor}.
 *
 * @public
 */
export class EyeMaterial
  extends applyMaterialMixins(
    MeshMaterial,
    mixinLight,
    mixinPBRBRDF,
    mixinTextureProps('iris'),
    mixinTextureProps('sclera')
  )
  implements Clonable<EyeMaterial>
{
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();

  private readonly _irisCenter: Vector4;
  private _irisRadius: number;
  private _irisDepth: number;
  private _ior: number;
  private _pupilRadius: number;
  private _pupilDilation: number;
  private readonly _irisColor: Vector4;
  private _irisBrightness: number;
  private _limbalRingWidth: number;
  private _limbalRingStrength: number;
  private readonly _scleraColor: Vector4;
  private _scleraWrap: number;
  private readonly _scleraEdgeTint: Vector4;
  private _corneaSpecularStrength: number;
  private _corneaRoughness: number;

  constructor() {
    super();
    this._irisCenter = new Vector4(0.5, 0.5, 0, 0);
    this._irisRadius = 0.22;
    this._irisDepth = 0.06;
    this._ior = 1.376;
    this._pupilRadius = 0.35;
    this._pupilDilation = 0;
    this._irisColor = new Vector4(1, 1, 1, 1);
    this._irisBrightness = 0.15;
    this._limbalRingWidth = 0.05;
    this._limbalRingStrength = 0.7;
    this._scleraColor = new Vector4(0.9, 0.88, 0.86, 1);
    this._scleraWrap = 0.35;
    this._scleraEdgeTint = new Vector4(0.55, 0.22, 0.18, 1);
    this._corneaSpecularStrength = 1;
    this._corneaRoughness = 0.05;
    this.useFeature(EyeMaterial.FEATURE_VERTEX_NORMAL, true);
    // Initialised explicitly rather than left unset: featureUsed() returns
    // undefined for a feature that was never touched, which would make
    // `vertexTangent` disagree with the `false` its serialization descriptor
    // declares, and a descriptor whose default does not match the constructor
    // is how assets silently change on load.
    this.useFeature(EyeMaterial.FEATURE_VERTEX_TANGENT, false);
  }

  clone() {
    const other = new EyeMaterial();
    other.copyFrom(this);
    return other;
  }

  copyFrom(other: this) {
    super.copyFrom(other);
    this.vertexNormal = other.vertexNormal;
    this.vertexTangent = other.vertexTangent;
    this.irisCenter = other.irisCenter;
    this.irisRadius = other.irisRadius;
    this.irisDepth = other.irisDepth;
    this.ior = other.ior;
    this.pupilRadius = other.pupilRadius;
    this.pupilDilation = other.pupilDilation;
    this.irisColor = other.irisColor;
    this.irisBrightness = other.irisBrightness;
    this.limbalRingWidth = other.limbalRingWidth;
    this.limbalRingStrength = other.limbalRingStrength;
    this.scleraColor = other.scleraColor;
    this.scleraWrap = other.scleraWrap;
    this.scleraEdgeTint = other.scleraEdgeTint;
    this.corneaSpecularStrength = other.corneaSpecularStrength;
    this.corneaRoughness = other.corneaRoughness;
  }

  /** true if vertex normal attribute presents */
  get vertexNormal() {
    return this.featureUsed<boolean>(EyeMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(EyeMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }

  /**
   * true if vertex tangent attribute presents.
   *
   * @remarks
   * Refraction needs a tangent frame. With no tangents the material still
   * renders, but the iris sits flat on the surface with no parallax.
   */
  get vertexTangent() {
    return this.featureUsed<boolean>(EyeMaterial.FEATURE_VERTEX_TANGENT);
  }
  set vertexTangent(val) {
    this.useFeature(EyeMaterial.FEATURE_VERTEX_TANGENT, !!val);
  }

  /** UV coordinate of the pupil centre. Only xy is used. */
  get irisCenter(): Immutable<Vector4> {
    return this._irisCenter;
  }
  set irisCenter(val: Immutable<Vector4>) {
    if (val && !this._irisCenter.equalsTo(val)) {
      this._irisCenter.set(val);
      this.uniformChanged();
    }
  }

  /** Iris disc radius, in UV units. */
  get irisRadius() {
    return this._irisRadius;
  }
  set irisRadius(val) {
    const next = Math.max(0.001, val ?? 0.001);
    if (next !== this._irisRadius) {
      this._irisRadius = next;
      this.uniformChanged();
    }
  }

  /**
   * Depth of the iris plane below the corneal surface, in UV units.
   *
   * @remarks
   * This is the parallax strength: at 0 the iris is painted flat on the surface
   * and the eye looks like a decal. Values around 0.05-0.08 read as a real
   * anterior chamber.
   */
  get irisDepth() {
    return this._irisDepth;
  }
  set irisDepth(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._irisDepth) {
      this._irisDepth = next;
      this.uniformChanged();
    }
  }

  /** Index of refraction of the cornea. 1.376 is the physical value. */
  get ior() {
    return this._ior;
  }
  set ior(val) {
    const next = Math.max(1, val ?? 1);
    if (next !== this._ior) {
      this._ior = next;
      this.uniformChanged();
    }
  }

  /** Pupil radius as a fraction of the iris radius, at zero dilation. */
  get pupilRadius() {
    return this._pupilRadius;
  }
  set pupilRadius(val) {
    const next = Math.min(0.95, Math.max(0.01, val ?? 0.01));
    if (next !== this._pupilRadius) {
      this._pupilRadius = next;
      this.uniformChanged();
    }
  }

  /**
   * Pupil dilation, -1 (fully constricted) to 1 (fully dilated).
   *
   * @remarks
   * Animatable, and worth animating: pupil size is one of the few involuntary
   * signals an audience reads as emotion rather than as animation.
   */
  get pupilDilation() {
    return this._pupilDilation;
  }
  set pupilDilation(val) {
    const next = Math.min(1, Math.max(-1, val ?? 0));
    if (next !== this._pupilDilation) {
      this._pupilDilation = next;
      this.uniformChanged();
    }
  }

  /** Tint multiplied over the iris texture. */
  get irisColor(): Immutable<Vector4> {
    return this._irisColor;
  }
  set irisColor(val: Immutable<Vector4>) {
    if (val && !this._irisColor.equalsTo(val)) {
      this._irisColor.set(val);
      this.uniformChanged();
    }
  }

  /** Fake internal scattering that keeps the iris from going black in shadow. */
  get irisBrightness() {
    return this._irisBrightness;
  }
  set irisBrightness(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._irisBrightness) {
      this._irisBrightness = next;
      this.uniformChanged();
    }
  }

  /** Width of the dark ring at the iris edge, in UV units. */
  get limbalRingWidth() {
    return this._limbalRingWidth;
  }
  set limbalRingWidth(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._limbalRingWidth) {
      this._limbalRingWidth = next;
      this.uniformChanged();
    }
  }

  /** How dark the limbal ring gets. 0 disables it. */
  get limbalRingStrength() {
    return this._limbalRingStrength;
  }
  set limbalRingStrength(val) {
    const next = Math.min(1, Math.max(0, val ?? 0));
    if (next !== this._limbalRingStrength) {
      this._limbalRingStrength = next;
      this.uniformChanged();
    }
  }

  /** Base sclera colour. Pure white reads as plastic; keep it slightly warm. */
  get scleraColor(): Immutable<Vector4> {
    return this._scleraColor;
  }
  set scleraColor(val: Immutable<Vector4>) {
    if (val && !this._scleraColor.equalsTo(val)) {
      this._scleraColor.set(val);
      this.uniformChanged();
    }
  }

  /** Diffuse wrap for the sclera, standing in for its subsurface softness. */
  get scleraWrap() {
    return this._scleraWrap;
  }
  set scleraWrap(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._scleraWrap) {
      this._scleraWrap = next;
      this.uniformChanged();
    }
  }

  /** Colour bled into the sclera away from the iris, standing in for vasculature. */
  get scleraEdgeTint(): Immutable<Vector4> {
    return this._scleraEdgeTint;
  }
  set scleraEdgeTint(val: Immutable<Vector4>) {
    if (val && !this._scleraEdgeTint.equalsTo(val)) {
      this._scleraEdgeTint.set(val);
      this.uniformChanged();
    }
  }

  /** Strength of the corneal highlight - the main cue that an eye is wet. */
  get corneaSpecularStrength() {
    return this._corneaSpecularStrength;
  }
  set corneaSpecularStrength(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._corneaSpecularStrength) {
      this._corneaSpecularStrength = next;
      this.uniformChanged();
    }
  }

  /** Corneal roughness. Keep it very low; the cornea is close to a mirror. */
  get corneaRoughness() {
    return this._corneaRoughness;
  }
  set corneaRoughness(val) {
    const next = Math.min(1, Math.max(0.001, val ?? 0.001));
    if (next !== this._corneaRoughness) {
      this._corneaRoughness = next;
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

  /**
   * Offsets the iris lookup to account for refraction through the cornea.
   *
   * @remarks
   * Refracts the view direction at the surface, then walks the refracted ray
   * down to the iris plane and returns where it lands. Working in tangent space
   * means the iris plane is "one irisDepth along the local normal", which is
   * what makes this independent of the eye's orientation in the world.
   *
   * Falls back to the unmodified UV when there is no tangent frame to refract
   * in, which keeps an asset without tangents rendering rather than breaking.
   *
   * @internal
   */
  private refractIrisUV(scope: PBInsideFunctionScope, uv: PBShaderExp, viewVec: PBShaderExp) {
    const pb = scope.$builder;
    if (!this.vertexTangent) {
      return uv;
    }
    const that = this;
    const funcName = 'Z_eyeRefractIrisUV';
    pb.func(
      funcName,
      [pb.vec2('uv'), pb.vec3('viewVec'), pb.vec3('worldPos'), pb.float('depth'), pb.float('ior')],
      function () {
        this.$l.TBN = that.calculateTBN(
          this,
          this.worldPos,
          this.$inputs.wNorm,
          this.$inputs.wTangent,
          this.$inputs.wBinormal
        );
        // World -> tangent is the transpose of the (orthonormal) TBN.
        this.$l.vTangent = pb.normalize(
          pb.vec3(
            pb.dot(this.viewVec, this.TBN[0]),
            pb.dot(this.viewVec, this.TBN[1]),
            pb.dot(this.viewVec, this.TBN[2])
          )
        );
        // Incident direction points into the surface, hence the negation.
        this.$l.refracted = pb.refract(pb.neg(this.vTangent), pb.vec3(0, 0, 1), pb.div(1, this.ior));
        // Total internal reflection returns a zero vector; leave the UV alone.
        this.$if(pb.lessThan(pb.dot(this.refracted, this.refracted), 0.0001), function () {
          this.$return(this.uv);
        });
        // March to the iris plane. The guard keeps grazing angles, where the
        // ray runs nearly parallel to the plane, from exploding the offset.
        this.$l.travel = pb.div(this.depth, pb.max(pb.abs(this.refracted.z), 0.15));
        this.$return(pb.add(this.uv, pb.mul(this.refracted.xy, this.travel)));
      }
    );
    return pb
      .getGlobalScope()
      [funcName](uv, viewVec, scope.$inputs.worldPos, scope.zEyeIrisDepth, scope.zEyeIOR) as PBShaderExp;
  }

  /**
   * Rescales the iris radially so the pupil can open and close.
   *
   * @remarks
   * Remaps the normalised radius with a power curve pinned at the iris edge:
   * the pupil boundary moves while the outer rim stays put, so dilation never
   * disturbs the limbus. Constricting compresses the iris pattern outward and
   * dilating stretches it inward, which is how a real iris behaves.
   *
   * @internal
   */
  private applyPupilDilation(scope: PBInsideFunctionScope, irisUV: PBShaderExp) {
    const pb = scope.$builder;
    const funcName = 'Z_eyeApplyPupilDilation';
    pb.func(funcName, [pb.vec2('irisUV'), pb.float('dilation')], function () {
      // Operates in iris-texture space, where the pupil sits at (0.5, 0.5) and
      // the iris rim is at radius 0.5.
      this.$l.delta = pb.sub(this.irisUV, pb.vec2(0.5));
      this.$l.dist = pb.length(this.delta);
      this.$if(pb.lessThan(this.dist, 0.00001), function () {
        this.$return(this.irisUV);
      });
      this.$l.norm = pb.clamp(pb.div(this.dist, 0.5), 0, 1);
      // Maps a display radius to the texture radius it samples, so the curve
      // runs backwards from intuition: an exponent above 1 samples further in,
      // which pushes the pupil boundary outward and dilates the pupil. Pinned
      // at norm = 1 either way, so dilation never disturbs the limbus.
      this.$l.exponent = pb.exp(pb.mul(this.dilation, 0.9));
      this.$l.remapped = pb.mul(pb.pow(this.norm, this.exponent), 0.5);
      this.$return(pb.add(pb.vec2(0.5), pb.mul(pb.div(this.delta, this.dist), this.remapped)));
    });
    return pb.getGlobalScope()[funcName](irisUV, scope.zEyePupilDilation) as PBShaderExp;
  }

  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColorInput()) {
      const litPass = this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT;
      if (litPass) {
        scope.zEyeIrisCenter = pb.vec4().uniform(2);
        scope.zEyeIrisRadius = pb.float().uniform(2);
        scope.zEyeIrisDepth = pb.float().uniform(2);
        scope.zEyeIOR = pb.float().uniform(2);
        scope.zEyePupilRadius = pb.float().uniform(2);
        scope.zEyePupilDilation = pb.float().uniform(2);
        scope.zEyeIrisColor = pb.vec4().uniform(2);
        scope.zEyeIrisBrightness = pb.float().uniform(2);
        scope.zEyeLimbalRingWidth = pb.float().uniform(2);
        scope.zEyeLimbalRingStrength = pb.float().uniform(2);
        scope.zEyeScleraColor = pb.vec4().uniform(2);
        scope.zEyeScleraWrap = pb.float().uniform(2);
        scope.zEyeScleraEdgeTint = pb.vec4().uniform(2);
        scope.zEyeCorneaSpecularStrength = pb.float().uniform(2);
        scope.zEyeCorneaRoughness = pb.float().uniform(2);
      }
      if (!litPass) {
        // Depth/shadow style passes only need coverage, not shading.
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(1));
        return;
      }

      scope.$l.normal = this.calculateNormal(
        scope,
        scope.$inputs.worldPos,
        scope.$inputs.wNorm,
        scope.$inputs.wTangent,
        scope.$inputs.wBinormal
      );
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.NoV = pb.clamp(pb.dot(scope.normal, scope.viewVec), 0.001, 1);

      // Surface UV drives the region split; the iris lookup is refracted from it.
      scope.$l.surfaceUV = this.hasIrisTexture()
        ? this.getIrisTexCoord(scope)
        : this.hasScleraTexture()
          ? this.getScleraTexCoord(scope)
          : pb.vec2(0.5);
      scope.$l.surfaceOffset = pb.sub(scope.surfaceUV, scope.zEyeIrisCenter.xy);
      scope.$l.surfaceDist = pb.length(scope.surfaceOffset);

      // Refract on the surface UV, then remap the iris disc onto the full iris
      // texture: the texture is authored as one iris filling the frame with the
      // pupil at its centre, so sampling it with raw surface UVs would only ever
      // hit the few texels around the pupil.
      scope.$l.refractedUV = this.refractIrisUV(scope, scope.surfaceUV, scope.viewVec);
      scope.$l.irisUV = pb.add(
        pb.vec2(0.5),
        pb.div(pb.sub(scope.refractedUV, scope.zEyeIrisCenter.xy), pb.mul(scope.zEyeIrisRadius, 2))
      );
      scope.irisUV = this.applyPupilDilation(scope, scope.irisUV);

      // Sclera.
      scope.$l.scleraAlbedo = scope.zEyeScleraColor.rgb;
      if (this.hasScleraTexture()) {
        scope.scleraAlbedo = pb.mul(scope.scleraAlbedo, this.sampleScleraTexture(scope, scope.surfaceUV).rgb);
      }
      // Vasculature reads strongest away from the iris.
      scope.$l.edgeAmount = pb.smoothStep(
        scope.zEyeIrisRadius,
        pb.add(scope.zEyeIrisRadius, 0.35),
        scope.surfaceDist
      );
      scope.scleraAlbedo = pb.mix(
        scope.scleraAlbedo,
        pb.mul(scope.scleraAlbedo, scope.zEyeScleraEdgeTint.rgb),
        pb.mul(scope.edgeAmount, scope.zEyeScleraEdgeTint.a)
      );

      // Iris.
      scope.$l.irisAlbedo = scope.zEyeIrisColor.rgb;
      if (this.hasIrisTexture()) {
        scope.irisAlbedo = pb.mul(scope.irisAlbedo, this.sampleIrisTexture(scope, scope.irisUV).rgb);
      }
      // Limbal ring, keyed off the surface radius so refraction cannot smear it.
      scope.$l.limbal = pb.smoothStep(
        pb.sub(scope.zEyeIrisRadius, scope.zEyeLimbalRingWidth),
        scope.zEyeIrisRadius,
        scope.surfaceDist
      );
      scope.irisAlbedo = pb.mul(
        scope.irisAlbedo,
        pb.sub(1, pb.mul(scope.limbal, scope.zEyeLimbalRingStrength))
      );

      // Region blend. The transition is a fraction of the iris radius so it
      // scales with the eye instead of being a fixed UV distance.
      scope.$l.irisMask = pb.sub(
        1,
        pb.smoothStep(
          pb.mul(scope.zEyeIrisRadius, 0.97),
          pb.mul(scope.zEyeIrisRadius, 1.03),
          scope.surfaceDist
        )
      );
      scope.$l.albedo = pb.mix(scope.scleraAlbedo, scope.irisAlbedo, scope.irisMask);

      scope.$l.diffuseLighting = pb.vec3(0);
      scope.$l.specularLighting = pb.vec3(0);
      scope.$l.alphaRoughness = pb.mul(scope.zEyeCorneaRoughness, scope.zEyeCorneaRoughness);
      // Water/cornea reflectance at normal incidence.
      scope.$l.F0 = pb.vec3(0.04);
      scope.$l.F90 = pb.vec3(1);

      const baseLightPass = !this.drawContext.lightBlending;
      if (this.needCalculateEnvLight() && baseLightPass) {
        scope.diffuseLighting = pb.add(
          scope.diffuseLighting,
          this.getEnvLightIrradiance(scope, scope.normal)
        );
        scope.$l.reflectVec = this.calculateReflectionVector(scope, scope.normal, scope.viewVec);
        scope.$l.envFresnel = this.fresnelSchlick(scope, scope.NoV, scope.F0, scope.F90);
        scope.specularLighting = pb.add(
          scope.specularLighting,
          pb.mul(
            this.getEnvLightRadiance(scope, scope.reflectVec, scope.zEyeCorneaRoughness),
            scope.envFresnel,
            scope.zEyeCorneaSpecularStrength
          )
        );
      }

      this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
        this.$l.diffuseScale = pb.float(1);
        this.$l.specularScale = pb.float(1);
        this.$if(pb.equal(type, LIGHT_TYPE_POINT), function () {
          this.diffuseScale = extra.x;
          this.specularScale = extra.y;
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
        // calculateShadow() samples with implicit derivatives, which WGSL only
        // permits in uniform control flow - so this must never sit inside a
        // dynamic branch.
        this.$l.shadowTerm = shadow
          ? that.calculateShadow(this, this.$inputs.worldPos, pb.max(this.NoL, 1e-5))
          : pb.float(1);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.shadowTerm);
        // Wrapped diffuse only for the sclera; the iris is lit through the
        // cornea and stays comparatively crisp.
        this.$l.NoLWrap = pb.clamp(
          pb.div(pb.add(this.rawNoL, this.zEyeScleraWrap), pb.add(1, this.zEyeScleraWrap)),
          0,
          1
        );
        this.$l.diffuseTerm = pb.mix(this.NoLWrap, this.NoL, this.irisMask);
        this.diffuseLighting = pb.add(
          this.diffuseLighting,
          pb.mul(this.lightColor, this.diffuseTerm, this.diffuseScale)
        );

        this.$l.halfVec = pb.normalize(pb.add(this.lightDir, this.viewVec));
        this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
        this.$l.VoH = pb.clamp(pb.dot(this.viewVec, this.halfVec), 0, 1);
        this.$l.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
        this.$l.Vis = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
        this.$l.F = that.fresnelSchlick(this, this.VoH, this.F0, this.F90);
        this.specularLighting = pb.add(
          this.specularLighting,
          pb.mul(
            this.lightColor,
            this.F,
            pb.mul(this.D, this.Vis, this.NoL),
            this.zEyeCorneaSpecularStrength,
            this.specularScale
          )
        );
      });

      // Light that has entered the iris and bounced around inside it. Without
      // this the iris crushes to black in shadow and the eye reads as a hole.
      scope.$l.internal = pb.mul(scope.albedo, scope.zEyeIrisBrightness, scope.irisMask);
      scope.$l.litColor = pb.add(
        pb.mul(scope.albedo, scope.diffuseLighting),
        scope.internal,
        scope.specularLighting
      );
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, 1));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }

  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx) && ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      bindGroup.setValue('zEyeIrisCenter', this._irisCenter);
      bindGroup.setValue('zEyeIrisRadius', this._irisRadius);
      bindGroup.setValue('zEyeIrisDepth', this._irisDepth);
      bindGroup.setValue('zEyeIOR', this._ior);
      bindGroup.setValue('zEyePupilRadius', this._pupilRadius);
      bindGroup.setValue('zEyePupilDilation', this._pupilDilation);
      bindGroup.setValue('zEyeIrisColor', this._irisColor);
      bindGroup.setValue('zEyeIrisBrightness', this._irisBrightness);
      bindGroup.setValue('zEyeLimbalRingWidth', this._limbalRingWidth);
      bindGroup.setValue('zEyeLimbalRingStrength', this._limbalRingStrength);
      bindGroup.setValue('zEyeScleraColor', this._scleraColor);
      bindGroup.setValue('zEyeScleraWrap', this._scleraWrap);
      bindGroup.setValue('zEyeScleraEdgeTint', this._scleraEdgeTint);
      bindGroup.setValue('zEyeCorneaSpecularStrength', this._corneaSpecularStrength);
      bindGroup.setValue('zEyeCorneaRoughness', this._corneaRoughness);
    }
  }
}
