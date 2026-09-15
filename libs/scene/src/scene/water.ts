import { Vector4 } from '@zephyr3d/base';
import type { Matrix4x4, Nullable } from '@zephyr3d/base';
import { applyMixins, Vector3, DRef } from '@zephyr3d/base';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, PrimitiveInstanceInfo, RenderQueue } from '../render';
import { Primitive } from '../render';
import { Clipmap, FBMWaveGenerator } from '../render';
import { setWaterSubmergence } from '../render/underwater';
import { WaterMaterial } from '../material/water';
import type { WaterDebugOutput, WaterRefractionMode } from '../material/water';
import type { AbstractDevice, BindGroup, FrameBuffer, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import { QUEUE_OPAQUE } from '../values';
import { BoundingBox } from '../utility/bounding_volume';
import type { Camera } from '../camera';
import { getDevice } from '../app/api';

/** Mean earth radius in meters, for the horizon distance. @internal */
const EARTH_RADIUS = 6371000;
/** Floor on the eye height feeding the horizon distance, in meters. @internal */
const MIN_HORIZON_EYE_HEIGHT = 0.1;
/**
 * How far past the tessellated surface the skirt's outer edge is placed, as a
 * multiple of the view distance.
 *
 * Only has to be far enough that the ring reads as a horizon line rather than a
 * visible band; it is depth-pinned to the far plane regardless of how far out
 * it actually lands.
 * @internal
 */
const SKIRT_DISTANCE_FACTOR = 10;
/**
 * Region rectangle standing in for "no bounds", matching the WaterMaterial
 * default. @internal
 */
const WHOLE_DOMAIN = new Vector4(-99999, -99999, 99999, 99999);

/**
 * Water scene node
 * @public
 */
export class Water extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  private readonly _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _renderData: Nullable<PrimitiveInstanceInfo[]>;
  private _gridScale: number;
  private _viewDistance: number;
  private _animationSpeed: number;
  private _timeStart: number;
  /** Wave clock, in seconds. Advanced by `animationSpeed` per frame. */
  private _waveTime: number;
  /** Elapsed time at the previous update, for the frame delta. */
  private _lastUpdateTime: number;
  private _feedbackProgram: DRef<GPUProgram>;
  private _feedbackBindGroup: DRef<BindGroup>;
  private _feedbackPrimitive: DRef<Primitive>;
  private _feedbackRenderTarget: DRef<FrameBuffer>;
  private _feedbackRenderStates: Nullable<RenderStateSet>;
  private readonly _material: DRef<WaterMaterial>;
  /**
   * Whether each camera was inside this body of water on its previous update.
   *
   * The submerged test has a dead band around the surface, so it needs to know
   * which way it is crossing; per camera, because two views of one ocean can be
   * on opposite sides of it.
   */
  private readonly _submerged: WeakMap<Camera, boolean>;
  /**
   * Creates an instance of Water node
   * @param scene - Scene object
   */
  constructor(scene: Scene) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(32, []);
    this._renderData = null;
    this._gridScale = 1;
    this._viewDistance = 0;
    this._animationSpeed = 1;
    this._timeStart = 0;
    this._waveTime = 0;
    this._lastUpdateTime = 0;
    this._material = new DRef(new WaterMaterial());
    this._material.get()!.region = new Vector4(-1, -1, 1, 1);
    this._material.get()!.TAAStrength = 0.4;
    this.waveGenerator = new FBMWaveGenerator();
    this._feedbackProgram = new DRef();
    this._feedbackBindGroup = new DRef();
    this._feedbackPrimitive = new DRef();
    this._feedbackRenderTarget = new DRef();
    this._feedbackRenderStates = null;
    this._submerged = new WeakMap();
    scene.queuePerCameraUpdateNode(this);
  }
  /** Disposes the water node */
  protected onDispose() {
    super.onDispose();
    this._clipmap.dispose();
    this._renderData = null;
    this._feedbackBindGroup.dispose();
    this._feedbackPrimitive.dispose();
    this._feedbackProgram.dispose();
    this._feedbackRenderStates = null;
    if (this._feedbackRenderTarget.get()) {
      this._feedbackRenderTarget.get()!.getColorAttachment(0).dispose();
      this._feedbackRenderTarget.get()!.getColorAttachment(1).dispose();
      this._feedbackRenderTarget.dispose();
    }
    this._material.dispose();
  }
  /** Whether water should be drawn with lines */
  get wireframe() {
    return this._clipmap.wireframe;
  }
  set wireframe(val: boolean) {
    this._clipmap.wireframe = !!val;
  }
  /** Material of the water */
  get material() {
    return this._material.get()!;
  }
  /** Wave generator object of the water */
  get waveGenerator() {
    return this.material.waveGenerator;
  }
  set waveGenerator(waveGenerator) {
    this.material.waveGenerator = waveGenerator;
    if (this.material.needUpdate()) {
      this.scene?.queueUpdateNode(this);
    }
  }
  /**
   * Whether the surface reads as an unbounded ocean reaching the horizon,
   * rather than a body of water ending at the node's extent.
   *
   * Off by default. A pond, a lake or a pool has an edge, and the region test
   * that draws it is skipped entirely while this is on.
   *
   * The horizon is reached without touching the camera's far plane: the
   * clipmap's outermost ring is drawn as a skirt whose outer vertices are
   * pushed well past it with their depth pinned to the far value. A far plane
   * sized for the near scene therefore keeps its depth precision.
   */
  get infinite() {
    return this.material.infinite;
  }
  set infinite(val: boolean) {
    if (!!val !== this.material.infinite) {
      this.material.infinite = !!val;
      this.invalidateWorldBoundingVolume(false);
    }
  }
  /**
   * How far the surface is built out from the camera while {@link infinite} is
   * on, in meters. 0 derives it from the true horizon distance for the camera's
   * height above the water.
   *
   * Raising it costs clipmap levels, which are logarithmic in the distance, so
   * the geometry cost of a much larger value is small. What it really trades is
   * against the sky's {@link SkyRenderer.aerialPerspectiveDistance}: build the
   * water out further than the aerial perspective LUT reaches and the far water
   * stops converging towards the sky colour, which puts back the hard band this
   * setting exists to remove.
   */
  get viewDistance() {
    return this._viewDistance;
  }
  set viewDistance(val: number) {
    this._viewDistance = Math.max(0, val);
  }
  /**
   * Animation speed of the water. Zero freezes the surface where it is rather
   * than resetting it: the wave phase is accumulated, and this scales the
   * increment.
   */
  get animationSpeed() {
    return this._animationSpeed;
  }
  set animationSpeed(val) {
    this._animationSpeed = val;
  }
  /** TAA strength of the water */
  get TAAStrength() {
    return this.material.TAAStrength;
  }
  set TAAStrength(val) {
    this.material.TAAStrength = val;
  }
  /**
   * Whether this water projects caustics onto the geometry below it.
   *
   * Needs a shadow-casting directional light and a WebGL2/WebGPU device; the
   * caustics pass switches itself off when either is missing, and when the sun
   * drops close to the horizon.
   */
  get causticsEnabled() {
    return this.material.causticsEnabled;
  }
  set causticsEnabled(val: boolean) {
    this.material.causticsEnabled = val;
  }
  /** Strength of the caustic contrast. 0 leaves the light unmodulated. */
  get causticsIntensity() {
    return this.material.causticsIntensity;
  }
  set causticsIntensity(val: number) {
    this.material.causticsIntensity = val;
  }
  /** Depth in meters below the surface where the caustics are in focus. */
  get causticsDepth() {
    return this.material.causticsDepth;
  }
  set causticsDepth(val: number) {
    this.material.causticsDepth = val;
  }
  /**
   * Whether caustics land on the scene rather than on a plane at
   * {@link causticsDepth}. WebGL2 keeps the plane regardless.
   */
  get causticsSceneDepth() {
    return this.material.causticsSceneDepth;
  }
  set causticsSceneDepth(val: boolean) {
    this.material.causticsSceneDepth = val;
  }
  /**
   * Furthest distance in meters from the camera the caustic map reaches.
   *
   * A cap rather than a fixed extent: the map is fitted to the part of the water
   * within this distance.
   */
  get causticsRange() {
    return this.material.causticsRange;
  }
  set causticsRange(val: number) {
    this.material.causticsRange = val;
  }
  /**
   * Width in meters of the band the caustics fade out over at the edge of the
   * map, or 0 to derive it from {@link causticsRange}.
   */
  get causticsFadeDistance() {
    return this.material.causticsFadeDistance;
  }
  set causticsFadeDistance(val: number) {
    this.material.causticsFadeDistance = val;
  }
  /**
   * How strongly caustic map texels are concentrated near the camera, 0 to
   * spread them evenly. Ignored while the map already fits the water within
   * {@link causticsRange}.
   */
  get causticsWarp() {
    return this.material.causticsWarp;
  }
  set causticsWarp(val: number) {
    this.material.causticsWarp = val;
  }
  /**
   * Whether a camera inside this body of water sees the water from the inside:
   * the medium applied to the whole scene, the sky replaced by water, and the
   * surface read from below with its Snell window.
   *
   * Uses the same medium coefficients the surface does ({@link absorption},
   * {@link scattering} and their scales), so the volume and the surface never
   * disagree. Atmospheric fog is suppressed while submerged - the medium the eye
   * is looking through is water, not air.
   *
   * Only reaches opaque geometry, like the atmospheric fog it replaces;
   * transparent surfaces are not tinted by the column in front of them.
   */
  get underwaterEnabled() {
    return this.material.underwaterEnabled;
  }
  set underwaterEnabled(val: boolean) {
    this.material.underwaterEnabled = val;
  }
  /**
   * Scale on the downwelling sky light that fills the water column, 1 for the
   * value the sky implies. This is what the water fades to in the distance, so
   * it also sets how bright the underwater haze reads.
   */
  get underwaterAmbientIntensity() {
    return this.material.underwaterAmbientIntensity;
  }
  set underwaterAmbientIntensity(val: number) {
    this.material.underwaterAmbientIntensity = val;
  }
  /**
   * Whether shafts of sunlight are marched through the water column.
   *
   * Reads the caustic map as the surface's transmittance, so the shafts carry
   * the same pattern that lands on the sea bed. Needs {@link causticsEnabled}
   * and everything it needs; switches itself off wherever the map is
   * unavailable.
   */
  get underwaterGodRays() {
    return this.material.underwaterGodRays;
  }
  set underwaterGodRays(val: boolean) {
    this.material.underwaterGodRays = val;
  }
  /** Strength of the light shafts, 1 for the value the medium implies. */
  get underwaterGodRayIntensity() {
    return this.material.underwaterGodRayIntensity;
  }
  set underwaterGodRayIntensity(val: number) {
    this.material.underwaterGodRayIntensity = val;
  }
  /**
   * Samples taken along each view ray for the light shafts. Raise it when the
   * shafts read as grain rather than as beams, which is what too few samples of
   * a sharp caustic pattern look like.
   */
  get underwaterGodRaySteps() {
    return this.material.underwaterGodRaySteps;
  }
  set underwaterGodRaySteps(val: number) {
    this.material.underwaterGodRaySteps = val;
  }
  /**
   * Whether geometry standing in the water breaks the light shafts. Off by
   * default.
   *
   * The shafts come from the caustic map, which describes what the *surface* did
   * to the sunlight and knows nothing about what is under it, so without this a
   * shaft runs straight through a piling or a hull. Costs a shadow map lookup
   * per march step, roughly doubling what the shafts cost. The sea bed's own
   * shadows are unaffected either way.
   */
  get underwaterGodRayShadow() {
    return this.material.underwaterGodRayShadow;
  }
  set underwaterGodRayShadow(val: boolean) {
    this.material.underwaterGodRayShadow = val;
  }
  /**
   * Half-width in meters of the dead band around the surface the submerged test
   * uses, so a camera sitting at water level does not flip state every frame.
   * The test is against the rest plane, not the displaced surface.
   */
  get underwaterHysteresis() {
    return this.material.underwaterHysteresis;
  }
  set underwaterHysteresis(val: number) {
    this.material.underwaterHysteresis = val;
  }
  /**
   * Strength of the sunlight scattered forward through a wave crest, 0 to
   * disable.
   *
   * This is the term that makes a backlit crest glow. Authored rather than
   * derived; the medium's albedo supplies the colour, so raising this brightens
   * the glow without shifting its hue.
   */
  get subsurfaceIntensity() {
    return this.material.subsurfaceIntensity;
  }
  set subsurfaceIntensity(val: number) {
    this.material.subsurfaceIntensity = val;
  }
  /**
   * Height above the still-water level, in meters, over which the subsurface
   * gate absorbs.
   *
   * The glow is gated by the wave's vertical displacement, and the gate is a
   * slab of the medium: at this height a crest has attenuated by `e` to the
   * power of the medium's extinction, so red goes first and the crest picks up
   * a green edge. The absorption ramps in through a soft knee around the
   * still-water level, so a trough keeps a faint glow rather than cutting off,
   * and it never saturates however tall the crest. Lower it for a calm sea
   * whose crests barely rise; raise it so only the tallest waves glow.
   */
  get subsurfaceCrestHeight() {
    return this.material.subsurfaceCrestHeight;
  }
  set subsurfaceCrestHeight(val: number) {
    this.material.subsurfaceCrestHeight = val;
  }
  /**
   * Strength of the sunlight scattered out of the water column towards the eye,
   * 1 for the value the medium coefficients imply.
   *
   * This is what makes a shadow falling on the water darken the water itself,
   * and a low sun tint it. 0 leaves the body lit by the environment alone.
   */
  get sunScatteringIntensity() {
    return this.material.sunScatteringIntensity;
  }
  set sunScatteringIntensity(val: number) {
    this.material.sunScatteringIntensity = val;
  }
  /**
   * Coverage of the foam that collects where the water meets a surface, 0 to
   * disable. Off by default.
   *
   * Independent of the crest foam the wave generator produces: this one is keyed
   * on how far the surface is from whatever is behind it, measured to that
   * surface's own plane - the depth of water over a bed, the horizontal distance
   * to a piling or a hull - so one band covers both the shoreline and the contact
   * line around anything standing in the water.
   * {@link shoreFoamWashAmount} is what makes it run up and drain back rather
   * than sit there as a rim.
   *
   * Estimated from the depth buffer, so it only knows about what the camera can
   * see: water in front of something standing above the surface gets no foam
   * rather than a guess. See {@link WaterMaterial.shoreFoamAmount}.
   */
  get shoreFoamAmount() {
    return this.material.shoreFoamAmount;
  }
  set shoreFoamAmount(val: number) {
    this.material.shoreFoamAmount = val;
  }
  /**
   * How far, in meters, the foam band reaches from the surface behind it. A depth
   * of water over a bed, a horizontal distance against anything vertical. How
   * wide that is on screen depends on the geometry: a thin line on a steep
   * drop-off, a broad stretch on a flat shelf.
   */
  get shoreFoamDepth() {
    return this.material.shoreFoamDepth;
  }
  set shoreFoamDepth(val: number) {
    this.material.shoreFoamDepth = val;
  }
  /**
   * Falloff across the band. Above 1 pushes the coverage towards the near end and
   * keeps the outer edge thin and broken.
   */
  get shoreFoamFalloff() {
    return this.material.shoreFoamFalloff;
  }
  set shoreFoamFalloff(val: number) {
    this.material.shoreFoamFalloff = val;
  }
  /**
   * Size of the clumps the band's edge breaks into, as cycles across the band.
   *
   * Relative to {@link shoreFoamDepth} rather than in cycles per metre, so one
   * setting reads the same on a shoreline metres across and on a collar a
   * handspan wide around a piling.
   */
  get shoreFoamScale() {
    return this.material.shoreFoamScale;
  }
  set shoreFoamScale(val: number) {
    this.material.shoreFoamScale = val;
  }
  /**
   * How far the band's edge runs back and forth, as a fraction of
   * {@link shoreFoamDepth}. 0 leaves a static band.
   */
  get shoreFoamWashAmount() {
    return this.material.shoreFoamWashAmount;
  }
  set shoreFoamWashAmount(val: number) {
    this.material.shoreFoamWashAmount = val;
  }
  /** Run-up cycles per second. Swell rather than wind waves, so well under 1. */
  get shoreFoamWashSpeed() {
    return this.material.shoreFoamWashSpeed;
  }
  set shoreFoamWashSpeed(val: number) {
    this.material.shoreFoamWashSpeed = val;
  }
  /**
   * Spatial frequency of the run-up phase, in cycles per meter. At 0 the whole
   * waterline advances in lockstep, which reads as the water level rising and
   * falling; a cycle every few tens of meters breaks it into sections.
   */
  get shoreFoamWashScale() {
    return this.material.shoreFoamWashScale;
  }
  set shoreFoamWashScale(val: number) {
    this.material.shoreFoamWashScale = val;
  }
  /**
   * How the refracted view sample is located. Defaults to `march`.
   *
   * `offset` drops the depth-buffer search - a fixed number of texture fetches
   * per water pixel - and displaces the screen UV by the wave normal instead.
   * The water still refracts, but to the wrong point: a submerged silhouette
   * smears rather than holding still. Set it on hardware that cannot afford the
   * search.
   */
  get refractionMode() {
    return this.material.refractionMode;
  }
  set refractionMode(val: WaterRefractionMode) {
    this.material.refractionMode = val;
  }
  /**
   * Which intermediate shading term to display instead of the final colour.
   * A debugging aid; leave it at `none` in production. See
   * {@link WaterDebugOutput} for the available views.
   */
  get debugOutput() {
    return this.material.debugOutput;
  }
  set debugOutput(val: WaterDebugOutput) {
    this.material.debugOutput = val;
  }
  /**
   * Depth in meters the cheap refraction mode assumes the water is, used only
   * when {@link refractionMode} is `offset`.
   *
   * Sets how strong the cheap distortion looks. A constant rather than the real
   * distance to the bottom, because an offset scaled by that distance paints a
   * second copy of anything breaking the surface.
   */
  get cheapRefractionDepth() {
    return this.material.cheapRefractionDepth;
  }
  set cheapRefractionDepth(val: number) {
    this.material.cheapRefractionDepth = val;
  }
  /**
   * Scale on how much the medium blurs what is seen through it, 1 for the width
   * the scattering coefficient and the path length imply. 0 keeps the background
   * sharp at any depth.
   */
  get refractionBlur() {
    return this.material.refractionBlur;
  }
  set refractionBlur(val: number) {
    this.material.refractionBlur = val;
  }
  /** Absorption coefficient sigma_a in 1/m, per RGB channel. */
  get absorption() {
    return this.material.absorption;
  }
  set absorption(val: Vector3) {
    this.material.absorption = val;
  }
  /** Scale for the absorption coefficient. */
  get absorptionScale() {
    return this.material.absorptionScale;
  }
  set absorptionScale(val: number) {
    this.material.absorptionScale = val;
  }
  /** Scattering coefficient sigma_s in 1/m, per RGB channel. */
  get scattering() {
    return this.material.scattering;
  }
  set scattering(val: Vector3) {
    this.material.scattering = val;
  }
  /** Scale for the scattering coefficient. */
  get scatteringScale() {
    return this.material.scatteringScale;
  }
  set scatteringScale(val: number) {
    this.material.scatteringScale = val;
  }
  /**
   * Mean cosine of a single scattering event in the water, in `[0, 0.95]`.
   *
   * 0 scatters equally in all directions; higher brightens the water when
   * looking towards the sun through it.
   */
  get scatterAnisotropy() {
    return this.material.scatterAnisotropy;
  }
  set scatterAnisotropy(val: number) {
    this.material.scatterAnisotropy = val;
  }
  /**
   * Artistic scale on the refracted view offset. 1 is physical, 0 disables it.
   *
   * The offset itself is derived: the view ray is refracted at the surface by
   * Snell's law, walked to whatever is behind the water, and the hit point is
   * projected back to the screen. That already accounts for the incidence angle,
   * the depth of the receiver and the perspective foreshortening, so this exists
   * only to dial the result back for a stylised look - not to make it correct.
   *
   * Values above 1 exaggerate; the surface stays continuous, but the sample can
   * wander far enough from the true hit point that the medium tint stops
   * matching what is visible through it.
   */
  get refractionScale() {
    return this.material.refractionScale;
  }
  set refractionScale(val) {
    this.material.refractionScale = val;
  }
  /**
   * Scale on the Fresnel reflectance, 1 for the physical value.
   *
   * Below 1 the surface reflects less than it should and shows more of what is
   * beneath it. Water reflects almost everything at a grazing angle, which is
   * physically right but can bury a sea bed the shot is about; this is the knob
   * that trades that reflection away. The F0 floor is scaled with it, so 0 gives
   * a surface with no specular response at all.
   */
  get reflectionStrength() {
    return this.material.reflectionStrength;
  }
  set reflectionStrength(val) {
    this.material.reflectionStrength = val;
  }
  /**
   * How much of a folded texel reads as foam.
   *
   * The wave generator reports where the surface has folded over on itself,
   * which is a measure of the fold rather than of area; this scales it into a
   * coverage fraction. 0 disables foam.
   */
  get foamAmount() {
    return this.material.foamAmount;
  }
  set foamAmount(val: number) {
    this.material.foamAmount = val;
  }
  /**
   * Falloff applied to foam coverage before it is scaled.
   *
   * Above 1 this pushes light folding towards no foam at all, so only a crest
   * that has genuinely broken shows any - which is what keeps a windy sea from
   * turning uniformly white.
   */
  get foamFalloff() {
    return this.material.foamFalloff;
  }
  set foamFalloff(val: number) {
    this.material.foamFalloff = val;
  }
  /** Diffuse albedo of the foam. */
  get foamColor() {
    return this.material.foamColor;
  }
  set foamColor(val: Vector3) {
    this.material.foamColor = val;
  }
  /** {@inheritDoc SceneNode.update} */
  update(frameId: number, elapsedInSeconds: number) {
    if (this.material.needUpdate()) {
      this.scene?.queueUpdateNode(this);
      if (this._timeStart === 0) {
        this._timeStart = elapsedInSeconds;
      }
      // A running clock rather than `elapsed * speed`: scaling the absolute
      // elapsed time by the speed makes a speed of zero freeze the surface at
      // the origin of the timeline instead of where it is, so pausing snapped
      // the waves back to their first frame. Accumulating the delta keeps the
      // phase where it was, and a speed of zero simply stops advancing it.
      this._waveTime +=
        Math.max(0, elapsedInSeconds - Math.max(this._timeStart, this._lastUpdateTime)) *
        this._animationSpeed;
      this._lastUpdateTime = elapsedInSeconds;
      this.material.update(frameId, this._waveTime);
      this.invalidateWorldBoundingVolume(false);
    }
  }
  /** {@inheritDoc SceneNode.updatePerCamera} */
  updatePerCamera(camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number) {
    const mat = this._material.get();
    if (mat) {
      const that = this;
      const infinite = mat.infinite;
      let viewDistance = 0;
      if (infinite) {
        viewDistance = this._viewDistance > 0 ? this._viewDistance : this.horizonDistance(camera);
        // The skirt's outer edge sits beyond where the surface is tessellated,
        // so the band between them is what hides the last ring of geometry.
        mat.setSkirtDistance(viewDistance * SKIRT_DISTANCE_FACTOR);
      }
      this._renderData = this._clipmap.gather({
        camera,
        // An unbounded surface is not clipped to the node's extent, and the
        // region rectangle is what the clipmap would otherwise reject tiles
        // against. The material's own default is already this whole-domain
        // value; passing it keeps the two agreeing.
        minMaxWorldPos: infinite ? WHOLE_DOMAIN : mat.region,
        gridScale: Math.max(0.01, this._gridScale),
        userData: this,
        frustumCulling: true,
        viewDistance: infinite ? viewDistance : undefined,
        skirt: infinite,
        calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
          const p = that.worldMatrix.transformPointAffine(Vector3.zero());
          if (that.waveGenerator) {
            that.waveGenerator.calcClipmapTileAABB(minX, maxX, minZ, maxZ, p.y, outAABB);
          } else {
            outAABB.minPoint.setXYZ(minX, p.y, minZ);
            outAABB.maxPoint.setXYZ(maxX, p.y + 1, maxZ);
          }
        }
      });
      this.updateSubmergence(camera, mat);
      this.scene?.queuePerCameraUpdateNode(this);
    }
  }
  /**
   * Decide whether `camera` is inside this body of water and publish the result.
   *
   * Run from `updatePerCamera`, which the node re-queues every frame regardless
   * of culling - the state has to survive the surface leaving the frustum, which
   * is exactly what a camera on the sea bed looking down does to it.
   *
   * The test is against the rest plane rather than the displaced surface. Reading
   * the real wave height means a GPU readback ({@link Water.getSurfacePoint}) and
   * the frame or two of latency that comes with it; against that, the plane is
   * wrong only while the eye is within a wave height of the surface, which is
   * also the one case this feature deliberately does not try to render.
   *
   * A dead band of {@link WaterMaterial.underwaterHysteresis} around the plane
   * keeps an eye parked at water level from flipping state every frame: crossing
   * in has to reach below the band, crossing out has to reach above it.
   * @internal
   */
  private updateSubmergence(camera: Camera, mat: WaterMaterial) {
    const surfaceY = this.worldMatrix.transformPointAffine(Vector3.zero()).y;
    let submerged = false;
    if (!this.hidden && this.attached) {
      const camPos = camera.getWorldPosition();
      const region = mat.region;
      // An unbounded surface has no edge to fall outside of; a bounded one is
      // only entered from within its own footprint, so a camera beside a pool at
      // the height of its water is not in it.
      const inside =
        mat.infinite ||
        (camPos.x >= region.x && camPos.x <= region.z && camPos.z >= region.y && camPos.z <= region.w);
      if (inside) {
        const band = mat.underwaterHysteresis;
        submerged = this._submerged.get(camera) ? camPos.y < surfaceY + band : camPos.y < surfaceY - band;
      }
    }
    this._submerged.set(camera, submerged);
    setWaterSubmergence(camera, this, submerged, surfaceY);
  }
  /**
   * Distance to the true horizon for the camera's height above this water, in
   * meters.
   *
   * `sqrt(2 * R * h)` for earth's radius: about 5km from an eye 2m up, 25km
   * from 50m. Using the real figure rather than a constant is what makes the
   * horizon move correctly as the camera climbs, which is most of what sells
   * the scale of an ocean.
   * @internal
   */
  private horizonDistance(camera: Camera) {
    const camPos = camera.getWorldPosition();
    const waterLevel = this.worldMatrix.transformPointAffine(Vector3.zero()).y;
    // A camera below the surface still needs a surface to look at; the floor
    // also keeps the sqrt away from zero when the eye is exactly at water level.
    const height = Math.max(camPos.y - waterLevel, MIN_HORIZON_EYE_HEIGHT);
    return Math.sqrt(2 * EARTH_RADIUS * height);
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget() {
    return this._pickTarget;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData() {
    return null;
  }
  getSkinInfluenceData() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType() {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit() {
    return !this._material.get()?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor() {
    return this._material.get()?.needSceneColor() ?? false;
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth() {
    return this._material.get()?.needSceneDepth() ?? false;
  }
  /**
   * {@inheritDoc Drawable.needHiZNearest}
   */
  needHiZNearest() {
    return this._material.get()?.needHiZNearest() ?? false;
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial() {
    return this._material.get();
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive() {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.isWater}
   */
  isWater(): this is Water {
    return true;
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   */
  computeBoundingVolume() {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.computeWorldBoundingVolume}
   */
  computeWorldBoundingVolume() {
    const p = this.worldMatrix.transformPointAffine(Vector3.zero());
    const mat = this._material?.get();
    if (mat) {
      // An unbounded surface has no box to test. Null reaches the cull visitor
      // as ClipState.CLIPPED, which keeps the node in the queue and defers the
      // decision to the clipmap's per-tile culling - the only place that can
      // decide it, since the surface is built around wherever the camera is.
      if (mat.infinite) {
        return null;
      }
      const boundingBox = new BoundingBox();
      if (mat.waveGenerator) {
        mat.waveGenerator.calcClipmapTileAABB(
          mat.region.x,
          mat.region.z,
          mat.region.y,
          mat.region.w,
          p.y,
          boundingBox
        );
      } else {
        boundingBox.minPoint.setXYZ(mat.region.x, p.y, mat.region.y);
        boundingBox.maxPoint.setXYZ(mat.region.z, p.y + 1, mat.region.w);
      }
      return boundingBox;
    }
    return null;
  }
  /**
   * Grid scale
   */
  get gridScale() {
    return this._gridScale;
  }
  set gridScale(val) {
    this._gridScale = val;
  }
  calculateLocalTransform(outMatrix: Matrix4x4) {
    outMatrix.translation(this._position);
  }
  calculateWorldTransform(outMatrix: Matrix4x4) {
    outMatrix.set(this.localMatrix);
    if (this.parent) {
      outMatrix.m03 += this.parent.worldMatrix.m03;
      outMatrix.m13 += this.parent.worldMatrix.m13;
      outMatrix.m23 += this.parent.worldMatrix.m23;
    }
  }
  protected _onTransformChanged(invalidateLocal: boolean) {
    super._onTransformChanged(invalidateLocal);
    const material = this._material?.get();
    if (material) {
      const x = Math.abs(this.scale.x);
      const z = Math.abs(this.scale.z);
      const px = this.position.x;
      const pz = this.position.z;
      material.region = new Vector4(px - x, pz - z, px + x, pz + z);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>) {
    const mat = this._material?.get();
    if (mat) {
      this.bind(ctx, renderQueue);
      mat.setClipmapGridInfo(this._gridScale, this.worldMatrix.m03, this.worldMatrix.m23);
      mat.apply(ctx);
      for (const info of this._renderData!) {
        mat.draw(info.primitive, ctx, info.numInstances);
      }
    }
  }
  /**
   * Retreive the disturbed world position and normal at water surface
   */
  async getSurfacePoint(points: Vector3[], outPos?: Vector3[], outNorm?: Vector3[]) {
    const device = getDevice();
    if (!points || points.length === 0) {
      return;
    }
    points = points.map((v) => v.clone());
    await device.runNextFrameAsync(async () => {
      if (!this._feedbackProgram.get()) {
        this._feedbackProgram.set(this._createFeedbackProgram(device));
        this._feedbackBindGroup.set(device.createBindGroup(this._feedbackProgram.get()!.bindGroupLayouts[0]));
      }
      if (!this._feedbackPrimitive.get()) {
        this._feedbackPrimitive.set(new Primitive());
        this._feedbackPrimitive.get()!.primitiveType = 'point-list';
      }
      if (!this._feedbackRenderStates) {
        this._feedbackRenderStates = device.createRenderStateSet();
        this._feedbackRenderStates.useDepthState().enableTest(false).enableWrite(false);
        this._feedbackRenderStates.useRasterizerState().setCullMode('none');
      }
      const primitive = this._feedbackPrimitive.get()!;
      const vertices = new Float32Array(points.length * 4);
      for (let i = 0; i < points.length; i++) {
        vertices[i * 4 + 0] = points[i].x;
        vertices[i * 4 + 1] = points[i].y;
        vertices[i * 4 + 2] = points[i].z;
        vertices[i * 4 + 3] = i;
      }
      let vb = primitive.getVertexBuffer('position');
      if (!vb || vb.byteLength !== vertices.byteLength) {
        vb = device.createVertexBuffer('position_f32x4', vertices, { dynamic: true })!;
        primitive.setVertexBuffer(vb);
      } else {
        vb.bufferSubData(0, vertices);
      }
      const fb = this._feedbackRenderTarget.get();
      if (!fb || fb.getColorAttachment(0).width < points.length) {
        const rt0 = device.createTexture2D('rgba32f', points.length, 1, {
          mipmapping: false
        })!;
        const rt1 = device.createTexture2D('rgba32f', points.length, 1, {
          mipmapping: false
        })!;
        if (fb) {
          fb.getColorAttachment(0).dispose();
          fb.getColorAttachment(1).dispose();
          this._feedbackRenderTarget.dispose();
        }
        this._feedbackRenderTarget.set(device.createFrameBuffer([rt0, rt1], null));
      }
      primitive.indexCount = points.length;
      const bindGroup = this._feedbackBindGroup.get()!;
      bindGroup.setValue('textureWidth', this._feedbackRenderTarget.get()!.getWidth());
      this.waveGenerator!.applyWaterBindGroup(bindGroup);
      device.pushDeviceStates();
      device.setProgram(this._feedbackProgram.get());
      device.setBindGroup(0, this._feedbackBindGroup.get()!);
      device.setFramebuffer(this._feedbackRenderTarget.get());
      this._feedbackPrimitive.get()!.draw();
      device.popDeviceStates();
      const pos = new Float32Array(points.length * 4);
      const norm = new Float32Array(points.length * 4);
      await Promise.all([
        this._feedbackRenderTarget.get()!.getColorAttachment(0).readPixels(0, 0, points.length, 1, 0, 0, pos),
        this._feedbackRenderTarget.get()!.getColorAttachment(1).readPixels(0, 0, points.length, 1, 0, 0, norm)
      ]);
      for (let i = 0; i < points.length; i++) {
        if (outPos) {
          outPos[i].setXYZ(pos[i * 4 + 0], pos[i * 4 + 1], pos[i * 4 + 2]);
        }
        if (outNorm) {
          outNorm[i].setXYZ(norm[i * 4 + 0], norm[i * 4 + 1], norm[i * 4 + 2]);
        }
      }
    });
  }
  /** @internal */
  private _createFeedbackProgram(device: AbstractDevice) {
    const that = this;
    const program = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.position = pb.vec4().attrib('position');
        this.textureWidth = pb.float().uniform(0);
        that.waveGenerator!.setupUniforms(this, 0);
        pb.main(function () {
          this.$l.worldPos = pb.vec3();
          this.$l.worldNorm = pb.vec3();
          that.waveGenerator!.calcVertexPositionAndNormal(
            this,
            this.$inputs.position.xyz,
            this.worldPos,
            this.worldNorm
          );
          this.$outputs.worldPos = this.worldPos;
          this.$outputs.worldNorm = this.worldNorm;
          this.$outputs.xz = this.$inputs.position.xz;
          this.$l.ndcX = pb.sub(
            pb.mul(pb.div(pb.add(this.$inputs.position.w, 0.5), this.textureWidth), 2),
            1
          );
          if (pb.getDevice().type !== 'webgpu') {
            this.$builtins.pointSize = 1;
          }
          this.$l.$builtins.position = pb.vec4(this.ndcX, 0, 0, 1);
        });
      },
      fragment(pb) {
        this.$outputs.worldPos = pb.vec4();
        this.$outputs.worldNorm = pb.vec4();
        that.waveGenerator!.setupUniforms(this, 0);
        pb.main(function () {
          this.$outputs.worldPos = pb.vec4(this.$inputs.worldPos, 1);
          this.$outputs.worldNorm = pb.vec4(
            that.waveGenerator!.calcFragmentNormal(this, this.$inputs.xz, this.$inputs.worldNorm),
            1
          );
        });
      }
    })!;
    program.name = '@Water_Feedback';
    return program;
  }
}
