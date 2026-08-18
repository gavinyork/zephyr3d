import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { Clonable, Immutable } from '@zephyr3d/base';
import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinPBRBRDF } from './mixins/pbr/brdf';
import { mixinTextureProps } from './mixins/texture';
import { ShaderHelper } from './shader/helper';
import { SSR_interleavedGradientNoise } from '../shaders/ssr';
import type { DrawContext } from '../render';
import { LIGHT_TYPE_POINT, RENDER_PASS_TYPE_LIGHT } from '../values';

/** Taps in the contact-occlusion disc. 16 rather than 8: close-ups need the density. */
const CONTACT_AO_SAMPLES = 16;
/**
 * Cap on the on-screen radius of the contact-occlusion disc, in pixels.
 * Keeps the sample density usable in close-up, where the projected radius
 * would otherwise reach hundreds of pixels and read as grain.
 */
const CONTACT_AO_MAX_PIXEL_RADIUS = 48;
/** Golden angle, in radians. Spreads the disc taps without any table. */
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Realtime eye material for realistic and semi-realistic characters.
 *
 * @remarks
 * Shades the whole eyeball - sclera, limbus and iris - from a single mesh and a
 * single material. There is no separate cornea layer: the corneal bulge is
 * simulated by refracting the view ray and offsetting the iris lookup, so no
 * transparent second surface, OIT or depth sorting is involved.
 *
 * The refraction works in tangent space (per-fragment TBN) rather than object
 * space, because the shader cannot reconstruct a fixed object-space gaze axis
 * after skinning. The residual error over the sphere's curvature is small at
 * the depths an iris actually sits.
 *
 * Regions are derived analytically from the UV distance to the iris centre, so
 * no mask texture is required - which is why the asset must place the iris at a
 * known UV location; see {@link EyeMaterial.irisCenter}.
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
  private static readonly FEATURE_SOCKET_OCCLUSION = this.defineFeature();
  private static readonly FEATURE_CONTACT_AO = this.defineFeature();
  private static readonly FEATURE_CONTACT_AO_JITTER = this.defineFeature();

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
  private readonly _socketRotation: Vector4;
  private _upperLidAngle: number;
  private _lowerLidAngle: number;
  private _socketOcclusionSoftness: number;
  private _socketOcclusionStrength: number;
  private _contactAORadius: number;
  private _contactAOMinDistance: number;
  private _contactAOMaxDistance: number;
  private _contactAOStrength: number;
  // Derived from _socketRotation; never serialized or exposed.
  private readonly _socketUp: Vector4;
  private readonly _socketForward: Vector4;
  private readonly _socketCos: Vector4;
  // Derived from the contact AO distances; never serialized or exposed.
  private readonly _contactAORange: Vector4;

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
    this._limbalRingWidth = 0.15;
    this._limbalRingStrength = 0.7;
    this._scleraColor = new Vector4(0.9, 0.88, 0.86, 1);
    this._scleraWrap = 0.35;
    this._scleraEdgeTint = new Vector4(0.55, 0.22, 0.18, 1);
    this._corneaSpecularStrength = 1;
    this._corneaRoughness = 0.05;
    this._socketRotation = new Vector4(0, 0, 0, 0);
    this._upperLidAngle = 50;
    this._lowerLidAngle = 65;
    this._socketOcclusionSoftness = 15;
    this._socketOcclusionStrength = 0.65;
    // Metric defaults for a ~12mm-radius eyeball in a one-unit-per-metre
    // scene. Assets authored at a different world scale must scale all three.
    this._contactAORadius = 0.006;
    this._contactAOMinDistance = 0.0004;
    this._contactAOMaxDistance = 0.006;
    this._contactAOStrength = 0.7;
    this._socketUp = new Vector4(0, 1, 0, 0);
    this._socketForward = new Vector4(0, 0, 1, 0);
    this._socketCos = new Vector4();
    this._contactAORange = new Vector4();
    this.useFeature(EyeMaterial.FEATURE_VERTEX_NORMAL, true);
    // Initialised explicitly: featureUsed() returns undefined for a feature
    // never touched, which would disagree with the serialization descriptor's
    // declared default and silently change assets on load.
    this.useFeature(EyeMaterial.FEATURE_VERTEX_TANGENT, false);
    this.useFeature(EyeMaterial.FEATURE_SOCKET_OCCLUSION, false);
    this.useFeature(EyeMaterial.FEATURE_CONTACT_AO, false);
    this.useFeature(EyeMaterial.FEATURE_CONTACT_AO_JITTER, false);
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
    this.socketOcclusion = other.socketOcclusion;
    this.socketRotation = other.socketRotation;
    this.upperLidAngle = other.upperLidAngle;
    this.lowerLidAngle = other.lowerLidAngle;
    this.socketOcclusionSoftness = other.socketOcclusionSoftness;
    this.socketOcclusionStrength = other.socketOcclusionStrength;
    this.contactAO = other.contactAO;
    this.contactAORadius = other.contactAORadius;
    this.contactAOMinDistance = other.contactAOMinDistance;
    this.contactAOMaxDistance = other.contactAOMaxDistance;
    this.contactAOStrength = other.contactAOStrength;
    this.contactAOTemporalJitter = other.contactAOTemporalJitter;
  }

  /** true if vertex normal attribute presents */
  get vertexNormal() {
    return this.featureUsed<boolean>(EyeMaterial.FEATURE_VERTEX_NORMAL);
  }
  set vertexNormal(val) {
    this.useFeature(EyeMaterial.FEATURE_VERTEX_NORMAL, !!val);
  }

  /**
   * true if vertex tangent attribute presents. Refraction needs a tangent
   * frame; without one the iris renders flat, with no parallax.
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
   * Depth of the iris plane below the corneal surface, in UV units - the
   * parallax strength. 0 is flat; 0.05-0.08 reads as a real anterior chamber.
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

  /** Pupil dilation, -1 (fully constricted) to 1 (fully dilated). Animatable. */
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

  /**
   * Width of the dark ring at the iris edge, as a fraction of
   * {@link EyeMaterial.irisRadius} - relative, so resizing the iris keeps the
   * ring in proportion.
   */
  get limbalRingWidth() {
    return this._limbalRingWidth;
  }
  set limbalRingWidth(val) {
    const next = Math.min(1, Math.max(0, val ?? 0));
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

  /**
   * Enables eye-socket occlusion - the soft shadowing of the eyeball by the
   * eyelids and socket.
   *
   * @remarks
   * Analytic: an asymmetric aperture defined by
   * {@link EyeMaterial.upperLidAngle} and {@link EyeMaterial.lowerLidAngle}
   * around an axis fixed in the eyeball mesh's object space (rotatable via
   * {@link EyeMaterial.socketRotation}). Darkens ambient diffuse, ambient
   * specular and direct lights outside the aperture; no mask texture, extra
   * pass or per-frame scripting. Object space means the frame follows skinning
   * and node motion automatically, and vertical gaze drags the occlusion with
   * the eye - approximating how real upper lids follow it.
   */
  get socketOcclusion() {
    return this.featureUsed<boolean>(EyeMaterial.FEATURE_SOCKET_OCCLUSION);
  }
  set socketOcclusion(val) {
    this.useFeature(EyeMaterial.FEATURE_SOCKET_OCCLUSION, !!val);
  }

  /**
   * Euler rotation (degrees, xyz) applied to the canonical socket frame.
   * At (0, 0, 0) the frame matches the documented asset convention: +Y towards
   * the upper lid, +Z along the gaze. Angles rather than unit vectors because
   * angles are the inspector-editable form.
   */
  get socketRotation(): Immutable<Vector4> {
    return this._socketRotation;
  }
  set socketRotation(val: Immutable<Vector4>) {
    if (val && !this._socketRotation.equalsTo(val)) {
      this._socketRotation.set(val);
      this.updateSocketFrame();
      this.uniformChanged();
    }
  }

  /** Aperture half-angle towards the upper lid, in degrees from the socket up axis. */
  get upperLidAngle() {
    return this._upperLidAngle;
  }
  set upperLidAngle(val) {
    const next = Math.min(90, Math.max(5, val ?? 5));
    if (next !== this._upperLidAngle) {
      this._upperLidAngle = next;
      this.uniformChanged();
    }
  }

  /**
   * Aperture half-angle towards the lower lid, in degrees. Defaults wider than
   * {@link EyeMaterial.upperLidAngle}; that asymmetry is what makes the
   * occlusion read as an eye socket.
   */
  get lowerLidAngle() {
    return this._lowerLidAngle;
  }
  set lowerLidAngle(val) {
    const next = Math.min(90, Math.max(5, val ?? 5));
    if (next !== this._lowerLidAngle) {
      this._lowerLidAngle = next;
      this.uniformChanged();
    }
  }

  /** Width of the lit-to-shadowed transition, in degrees. */
  get socketOcclusionSoftness() {
    return this._socketOcclusionSoftness;
  }
  set socketOcclusionSoftness(val) {
    const next = Math.min(45, Math.max(1, val ?? 1));
    if (next !== this._socketOcclusionSoftness) {
      this._socketOcclusionSoftness = next;
      this.uniformChanged();
    }
  }

  /** Overall socket occlusion strength, 0 to 1. */
  get socketOcclusionStrength() {
    return this._socketOcclusionStrength;
  }
  set socketOcclusionStrength(val) {
    const next = Math.min(1, Math.max(0, val ?? 0));
    if (next !== this._socketOcclusionStrength) {
      this._socketOcclusionStrength = next;
      this.uniformChanged();
    }
  }

  /**
   * Enables screen-space contact occlusion of the eyeball by whatever sits in
   * front of it - in practice the eyelid margin and the lashes.
   *
   * @remarks
   * Complements {@link EyeMaterial.socketOcclusion}: the socket aperture is an
   * analytic model of the lids, while this term reads the depth prepass and so
   * follows the real lid mesh - blinks, asymmetry and all. Dims the ambient
   * terms and the diffuse response of direct lights (whose shadow maps cannot
   * resolve the millimetre lid gap); direct specular is left untouched so the
   * corneal highlight survives.
   *
   * Requires a depth prepass. Forward+ always runs one; where none is bound the
   * term silently resolves to no occlusion.
   */
  get contactAO() {
    return this.featureUsed<boolean>(EyeMaterial.FEATURE_CONTACT_AO);
  }
  set contactAO(val) {
    this.useFeature(EyeMaterial.FEATURE_CONTACT_AO, !!val);
  }

  /**
   * Radius of the contact occlusion disc, in world units - how far from the
   * lid the darkening reaches. Rescale for assets not authored at one unit per
   * metre; roughly half the eyeball radius is a good starting point.
   */
  get contactAORadius() {
    return this._contactAORadius;
  }
  set contactAORadius(val) {
    const next = Math.max(1e-6, val ?? 1e-6);
    if (next !== this._contactAORadius) {
      this._contactAORadius = next;
      this.uniformChanged();
    }
  }

  /**
   * Smallest depth step that counts as an occluder, in world units. Raise it
   * until the eyeball stops shading itself. Compared against the eyeball's own
   * tangent plane rather than raw depth, so only residual curvature - not
   * view-dependent slope - has to clear it.
   */
  get contactAOMinDistance() {
    return this._contactAOMinDistance;
  }
  set contactAOMinDistance(val) {
    const next = Math.max(1e-6, val ?? 1e-6);
    if (next !== this._contactAOMinDistance) {
      this._contactAOMinDistance = next;
      this.uniformChanged();
    }
  }

  /**
   * Largest depth step that counts as an occluder, in world units. Anything
   * further in front is unrelated geometry overlapping the eye on screen and
   * must not paint a shadow onto it - keep it at the order of the lid gap.
   * Forced to at least 4x {@link EyeMaterial.contactAOMinDistance} on upload
   * so the two smoothstep ramps cannot cross.
   */
  get contactAOMaxDistance() {
    return this._contactAOMaxDistance;
  }
  set contactAOMaxDistance(val) {
    const next = Math.max(1e-6, val ?? 1e-6);
    if (next !== this._contactAOMaxDistance) {
      this._contactAOMaxDistance = next;
      this.uniformChanged();
    }
  }

  /**
   * Overall contact occlusion strength, 0 to 1. Calibrated so that 1 drives
   * the ambient terms to zero right at the contact line.
   */
  get contactAOStrength() {
    return this._contactAOStrength;
  }
  set contactAOStrength(val) {
    const next = Math.min(1, Math.max(0, val ?? 0));
    if (next !== this._contactAOStrength) {
      this._contactAOStrength = next;
      this.uniformChanged();
    }
  }

  /**
   * Advances the contact-occlusion noise pattern every frame so TAA can
   * integrate the grain away. Opt-in: without a temporal accumulator the
   * advancing pattern reads as flicker, worse than the static grain it
   * replaces. Enable it if and only if the pipeline resolves temporally.
   */
  get contactAOTemporalJitter() {
    return this.featureUsed<boolean>(EyeMaterial.FEATURE_CONTACT_AO_JITTER);
  }
  set contactAOTemporalJitter(val) {
    this.useFeature(EyeMaterial.FEATURE_CONTACT_AO_JITTER, !!val);
  }

  /**
   * Recomputes the object-space socket up/forward vectors from
   * {@link EyeMaterial.socketRotation}.
   *
   * @internal
   */
  private updateSocketFrame() {
    const d2r = Math.PI / 180;
    const rot = Quaternion.fromEulerAngle(
      this._socketRotation.x * d2r,
      this._socketRotation.y * d2r,
      this._socketRotation.z * d2r
    ).toMatrix3x3();
    const up = rot.transformVector(new Vector3(0, 1, 0));
    const forward = rot.transformVector(new Vector3(0, 0, 1));
    this._socketUp.setXYZW(up.x, up.y, up.z, 0);
    this._socketForward.setXYZW(forward.x, forward.y, forward.z, 0);
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
      if (this.socketOcclusion && this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        // The socket axes take the same transform chain as the normal
        // attribute - skin matrix, then normal matrix - so the occlusion stays
        // attached to the eye through node motion and skeletal animation.
        scope.zEyeSocketUp = pb.vec4().uniform(2);
        scope.zEyeSocketForward = pb.vec4().uniform(2);
        const skinMatrix = ShaderHelper.getSkinMatrix(scope);
        scope.$l.oSocketUp = skinMatrix
          ? pb.mul(skinMatrix, pb.vec4(scope.zEyeSocketUp.xyz, 0)).xyz
          : scope.zEyeSocketUp.xyz;
        scope.$l.oSocketForward = skinMatrix
          ? pb.mul(skinMatrix, pb.vec4(scope.zEyeSocketForward.xyz, 0)).xyz
          : scope.zEyeSocketForward.xyz;
        scope.$outputs.wSocketUp = pb.mul(
          ShaderHelper.getNormalMatrix(scope),
          pb.vec4(scope.oSocketUp, 0)
        ).xyz;
        scope.$outputs.wSocketForward = pb.mul(
          ShaderHelper.getNormalMatrix(scope),
          pb.vec4(scope.oSocketForward, 0)
        ).xyz;
      }
    }
  }

  /**
   * Fractional visibility of a world-space direction through the socket
   * aperture: 1 fully visible, approaching 0 towards the lids. Evaluated on
   * the surface normal, the reflection vector and light directions so all
   * lighting terms agree on where the lids are. The rear-hemisphere falloff
   * (`forLight`) applies to light directions only - applying it to surface
   * normals would paint the whole rear of a bare eyeball dark.
   *
   * @internal
   */
  private socketAperture(scope: PBInsideFunctionScope, dir: PBShaderExp, forLight: boolean) {
    const pb = scope.$builder;
    const funcName = forLight ? 'Z_eyeSocketApertureLight' : 'Z_eyeSocketApertureSurface';
    pb.func(funcName, [pb.vec3('dir'), pb.vec4('lidCos'), pb.float('strength')], function () {
      this.$l.up = pb.normalize(this.$inputs.wSocketUp);
      this.$l.lat = pb.dot(this.dir, this.up);
      // lidCos packs cos(angle +/- softness) per lid, precomputed on the CPU:
      // (upper outer, upper inner, lower outer, lower inner).
      this.$l.occUpper = pb.smoothStep(this.lidCos.x, this.lidCos.y, this.lat);
      this.$l.occLower = pb.smoothStep(this.lidCos.z, this.lidCos.w, pb.neg(this.lat));
      this.$l.visibility = pb.sub(1, pb.max(this.occUpper, this.occLower));
      if (forLight) {
        // Light from behind the eye's equator is blocked by the head itself;
        // the ramp straddles zero so the dimming eases in early.
        this.$l.forward = pb.normalize(this.$inputs.wSocketForward);
        this.visibility = pb.mul(this.visibility, pb.smoothStep(-0.4, 0.25, pb.dot(this.dir, this.forward)));
      }
      this.$return(pb.mix(pb.float(1), this.visibility, this.strength));
    });
    return pb.getGlobalScope()[funcName](dir, scope.zEyeSocketCos, scope.zEyeSocketStrength) as PBShaderExp;
  }

  /**
   * Fraction of the ambient hemisphere still reaching this fragment once the
   * geometry standing in front of the eyeball is accounted for: 1 open, 0 fully
   * buried under the lid.
   *
   * @remarks
   * Samples the depth prepass in a disc around the fragment and counts the taps
   * in front of the eyeball's own local tangent plane. Comparing against that
   * plane rather than raw depth cancels the surface's slope and foreshortening,
   * which is what lets the min/max thresholds be plain world-space distances.
   *
   * Must be called from uniform control flow - it takes screen-space
   * derivatives, which WGSL only permits there.
   *
   * @internal
   */
  private contactAOTerm(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    if (!ShaderHelper.getLinearDepthTexture(scope)) {
      // No depth prepass bound for this pass. Forward+ always runs one, but a
      // material must not assume the pipeline it is drawn by.
      return pb.float(1);
    }
    const funcName = 'Z_eyeContactAO';
    const temporalJitter = !!this.contactAOTemporalJitter;
    pb.func(
      funcName,
      [pb.vec3('worldPos'), pb.vec4('range'), pb.float('radius'), pb.float('strength')],
      function () {
        this.$l.renderSize = ShaderHelper.getRenderSize(this);
        this.$l.viewPos = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.worldPos, 1)).xyz;
        // Distance along the view axis, which is what the depth prepass writes
        // once scaled back up by the far plane.
        this.$l.centerZ = pb.neg(this.viewPos.z);
        // Derivatives first: the fade below returns early, and everything after
        // that early return is non-uniform control flow.
        this.$l.dzdx = pb.dpdx(this.centerZ);
        this.$l.dzdy = pb.dpdy(this.centerZ);
        // Project the world-space radius rather than reading the projection
        // matrix diagonal, so off-centre/oblique projections stay correct.
        this.$l.projMatrix = ShaderHelper.getProjectionMatrix(this);
        this.$l.h0 = pb.mul(this.projMatrix, pb.vec4(this.viewPos, 1));
        this.$l.h1 = pb.mul(this.projMatrix, pb.vec4(pb.add(this.viewPos, pb.vec3(this.radius, 0, 0)), 1));
        this.$l.pixelRadius = pb.min(
          pb.length(
            pb.mul(pb.sub(pb.div(this.h1.xy, this.h1.w), pb.div(this.h0.xy, this.h0.w)), 0.5, this.renderSize)
          ),
          CONTACT_AO_MAX_PIXEL_RADIUS
        );
        // A disc of only a couple of pixels is pure noise; fade it out rather
        // than sample it.
        this.$l.fade = pb.smoothStep(1.5, 4, this.pixelRadius);
        this.$if(pb.lessThanEqual(this.fade, 0), function () {
          this.$return(pb.float(1));
        });
        this.$l.screenUV = pb.div(this.$builtins.fragCoord.xy, this.renderSize);
        this.$l.far = ShaderHelper.getCameraParams(this).y;
        // Per-pixel rotation of the spiral breaks up banding. Static unless
        // temporal jitter is opted in (see contactAOTemporalJitter); the
        // framestamp is wrapped to keep the IGN math inside float precision.
        this.$l.frameId = temporalJitter
          ? pb.mod(pb.float(ShaderHelper.getFramestamp(this)), 64)
          : pb.float(0);
        this.$l.rotation = pb.mul(
          SSR_interleavedGradientNoise(this, this.$builtins.fragCoord.xy, this.frameId),
          Math.PI * 2
        );
        this.$l.occlusion = pb.float(0);
        this.$l.weightSum = pb.float(0);
        this.$for(pb.int('i'), 0, CONTACT_AO_SAMPLES, function () {
          this.$l.t = pb.div(pb.add(pb.float(this.i), 0.5), CONTACT_AO_SAMPLES);
          this.$l.angle = pb.add(this.rotation, pb.mul(pb.float(this.i), GOLDEN_ANGLE));
          // sqrt spreads the taps evenly over the disc. Without it they pile up
          // at the centre and the outer half of the radius goes unsampled.
          this.$l.offset = pb.mul(
            pb.vec2(pb.cos(this.angle), pb.sin(this.angle)),
            pb.mul(pb.sqrt(this.t), this.pixelRadius)
          );
          this.$l.sampleZ = pb.mul(
            ShaderHelper.sampleLinearDepth(
              this,
              ShaderHelper.getLinearDepthTexture(this),
              pb.add(this.screenUV, pb.div(this.offset, this.renderSize)),
              0
            ),
            this.far
          );
          // Where the eyeball itself would be at this tap.
          this.$l.predicted = pb.add(
            this.centerZ,
            pb.mul(this.dzdx, this.offset.x),
            pb.mul(this.dzdy, this.offset.y)
          );
          this.$l.delta = pb.sub(this.predicted, this.sampleZ);
          // range packs (min in, min out, max in, max out), ordered on the CPU.
          // Under the near pair the step is the eyeball shading itself; over
          // the far pair it is unrelated geometry overlapping the eye on
          // screen, which must not paint a shadow onto it.
          this.$l.accept = pb.mul(
            pb.smoothStep(this.range.x, this.range.y, this.delta),
            pb.sub(1, pb.smoothStep(this.range.z, this.range.w, this.delta))
          );
          // Nearer taps occlude more, turning the lid edge into a gradient.
          // The slope is gentle on purpose: the lid signal lives on the outer
          // rim of the disc, which a steep falloff would discount.
          this.$l.falloff = pb.sub(1, pb.mul(this.t, 0.75));
          this.occlusion = pb.add(this.occlusion, pb.mul(this.accept, this.falloff));
          this.weightSum = pb.add(this.weightSum, this.falloff);
        });
        // Semi-disc calibration: a lid edge at the fragment covers at most half
        // the disc (the other half is the eyeball itself), so raw coverage tops
        // out near 0.5. Doubling maps that to full occlusion; the smoothstep's
        // low edge discards lone-stray-tap grain.
        this.$l.coverage = pb.smoothStep(
          0.1,
          0.9,
          pb.mul(pb.div(this.occlusion, pb.max(this.weightSum, 1e-4)), 2)
        );
        this.$l.ao = pb.sub(1, pb.mul(this.coverage, this.strength));
        this.$return(pb.mix(pb.float(1), this.ao, this.fade));
      }
    );
    const globalScope = pb.getGlobalScope();
    return globalScope[funcName](
      scope.$inputs.worldPos,
      scope.zEyeContactAORange,
      scope.zEyeContactAORadius,
      scope.zEyeContactAOStrength
    ) as PBShaderExp;
  }

  /**
   * Offsets the iris lookup to account for refraction through the cornea:
   * refracts the view direction in tangent space and walks the refracted ray
   * down to the iris plane. Falls back to the unmodified UV when there is no
   * tangent frame to refract in.
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
   * Rescales the iris radially so the pupil can open and close: a power curve
   * pinned at the iris edge moves the pupil boundary while the limbus stays
   * put, matching how a real iris deforms.
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
      // Maps a display radius to the texture radius it samples: an exponent
      // above 1 samples further in, dilating the pupil. Pinned at norm = 1
      // either way, so dilation never disturbs the limbus.
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
        if (this.socketOcclusion && this.vertexNormal) {
          scope.zEyeSocketCos = pb.vec4().uniform(2);
          scope.zEyeSocketStrength = pb.float().uniform(2);
        }
        if (this.contactAO) {
          scope.zEyeContactAORange = pb.vec4().uniform(2);
          scope.zEyeContactAORadius = pb.float().uniform(2);
          scope.zEyeContactAOStrength = pb.float().uniform(2);
        }
      }
      if (!litPass) {
        // Depth/shadow style passes only need coverage, not shading.
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(1));
        return;
      }

      // TBN[2] is the pre-normal-map geometric normal, needed for shadow normal
      // offset bias.
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        scope.$inputs.wNorm,
        scope.$inputs.wTangent,
        scope.$inputs.wBinormal
      );
      scope.$l.normal = scope.normalInfo.normal;
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
      // texture, which is authored as one iris filling the frame.
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
      scope.$l.limbalWidth = pb.mul(scope.zEyeIrisRadius, scope.zEyeLimbalRingWidth);
      scope.$l.limbal = pb.smoothStep(
        pb.sub(scope.zEyeIrisRadius, scope.limbalWidth),
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

      const socketOcc = !!this.socketOcclusion && !!this.vertexNormal;
      const baseLightPass = !this.drawContext.lightBlending;
      // Evaluated once at function scope: it takes screen-space derivatives
      // (uniform control flow only) and is view- but not light-dependent. Also
      // needed in additive light passes, since it dims direct diffuse too.
      scope.$l.contactAO = this.contactAO ? this.contactAOTerm(scope) : pb.float(1);
      if (this.needCalculateEnvLight() && baseLightPass) {
        // Socket occlusion: irradiance keyed off the surface normal, radiance
        // off the reflection vector, so a reflection ray aimed at the eyelid
        // dims even where the surface itself is open.
        scope.$l.envIrradiance = this.getEnvLightIrradiance(scope, scope.normal);
        if (socketOcc) {
          scope.envIrradiance = pb.mul(scope.envIrradiance, this.socketAperture(scope, scope.normal, false));
        }
        scope.envIrradiance = pb.mul(scope.envIrradiance, scope.contactAO);
        scope.diffuseLighting = pb.add(scope.diffuseLighting, scope.envIrradiance);
        scope.$l.reflectVec = this.calculateReflectionVector(scope, scope.normal, scope.viewVec);
        scope.$l.envFresnel = this.fresnelSchlick(scope, scope.NoV, scope.F0, scope.F90);
        scope.$l.envRadiance = pb.mul(
          this.getEnvLightRadiance(scope, scope.reflectVec, scope.zEyeCorneaRoughness),
          scope.envFresnel,
          scope.zEyeCorneaSpecularStrength
        );
        if (socketOcc) {
          scope.envRadiance = pb.mul(scope.envRadiance, this.socketAperture(scope, scope.reflectVec, false));
        }
        // The lid occludes the sky the cornea mirrors just as much as the sky
        // it diffuses.
        scope.envRadiance = pb.mul(scope.envRadiance, scope.contactAO);
        scope.specularLighting = pb.add(scope.specularLighting, scope.envRadiance);
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
          ? that.calculateShadow(this, this.$inputs.worldPos, scope.normalInfo.TBN[2], pb.max(this.NoL, 1e-5))
          : pb.float(1);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.shadowTerm);
        if (socketOcc) {
          // A light arriving from outside the lid aperture is blocked before
          // it reaches the eyeball - a shadow map cannot resolve this, since
          // the lid sits inside any workable depth bias.
          this.lightColor = pb.mul(this.lightColor, that.socketAperture(this, this.lightDir, true));
        }
        // Wrapped diffuse only for the sclera; the iris is lit through the
        // cornea and stays comparatively crisp.
        this.$l.NoLWrap = pb.clamp(
          pb.div(pb.add(this.rawNoL, this.zEyeScleraWrap), pb.add(1, this.zEyeScleraWrap)),
          0,
          1
        );
        this.$l.diffuseTerm = pb.mix(this.NoLWrap, this.NoL, this.irisMask);
        // The contact term dims direct diffuse too, or the contact shadow
        // vanishes under direct lighting. Direct specular is left out: if the
        // light is visible from the fragment, its highlight should be as well.
        this.diffuseLighting = pb.add(
          this.diffuseLighting,
          pb.mul(this.lightColor, this.diffuseTerm, this.diffuseScale, this.contactAO)
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

      // Light that has entered the iris and bounced around inside it - without
      // this the iris crushes to black in shadow. Fed by environment
      // irradiance (already carrying the occlusion terms), scaled by
      // irisBrightness.
      scope.$l.irisEnvLight =
        baseLightPass && this.needCalculateEnvLight() ? scope.envIrradiance : pb.vec3(0);
      scope.$l.internal = pb.mul(scope.albedo, scope.irisEnvLight, scope.zEyeIrisBrightness, scope.irisMask);
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
      if (this.socketOcclusion && this.vertexNormal) {
        const d2r = Math.PI / 180;
        const softness = this._socketOcclusionSoftness;
        // (upper outer, upper inner, lower outer, lower inner) - see
        // socketAperture. Clamped so the smoothstep edges never coincide.
        this._socketCos.setXYZW(
          Math.cos(Math.min(this._upperLidAngle + softness, 179) * d2r),
          Math.cos(Math.max(this._upperLidAngle - softness, 1) * d2r),
          Math.cos(Math.min(this._lowerLidAngle + softness, 179) * d2r),
          Math.cos(Math.max(this._lowerLidAngle - softness, 1) * d2r)
        );
        bindGroup.setValue('zEyeSocketUp', this._socketUp);
        bindGroup.setValue('zEyeSocketForward', this._socketForward);
        bindGroup.setValue('zEyeSocketCos', this._socketCos);
        bindGroup.setValue('zEyeSocketStrength', this._socketOcclusionStrength);
      }
      if (this.contactAO) {
        const minD = this._contactAOMinDistance;
        // The near pair ramps a tap in as an occluder, the far pair ramps it
        // back out as unrelated geometry. Widen the outer distance (never
        // clamp the inner one) to keep the two ramps from crossing.
        const maxD = Math.max(this._contactAOMaxDistance, minD * 4);
        // The far ramp starts at 0.75x rather than halfway: ramping out
        // earlier discounts the thicker parts of the lid margin.
        this._contactAORange.setXYZW(minD, minD * 2, maxD * 0.75, maxD);
        bindGroup.setValue('zEyeContactAORange', this._contactAORange);
        bindGroup.setValue('zEyeContactAORadius', this._contactAORadius);
        bindGroup.setValue('zEyeContactAOStrength', this._contactAOStrength);
      }
    }
  }
}
