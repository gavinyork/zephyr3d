import { Vector2, Vector4 } from '@zephyr3d/base';
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
import { ShaderHelper } from '../material/shader/helper';
import {
  InteractiveWaveGenerator,
  type WaterBathymetry,
  type WaterInteraction
} from '../render/water_interaction';
import type { ClipmapTerrain } from './terrain-cm/terrain-cm';
import type { WaterDebugOutput, WaterRefractionMode } from '../material/water';
import type { AbstractDevice, BindGroup, FrameBuffer, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import type { WaveGenerator } from '../render/wavegenerator';
import { QUEUE_OPAQUE } from '../values';
import { BoundingBox } from '../utility/bounding_volume';
import type { Camera } from '../camera';
import { getDevice } from '../app/api';
import { TerrainWaterlineSource, WaterlineField } from '../render/sdf/waterline';
import { RenderGraphExecutor } from '../render/rendergraph/executor';

/** Mean earth radius in meters, for the horizon distance. @internal */
const EARTH_RADIUS = 6371000;
/** Floor on the eye height feeding the horizon distance, in meters. @internal */
const MIN_HORIZON_EYE_HEIGHT = 0.1;
/**
 * How far past the tessellated surface the skirt's outer edge is placed, as a
 * multiple of the view distance. Its depth is pinned to the far plane.
 * @internal
 */
const SKIRT_DISTANCE_FACTOR = 10;
/**
 * Region rectangle standing in for "no bounds", matching the WaterMaterial
 * default. @internal
 */
const WHOLE_DOMAIN = new Vector4(-99999, -99999, 99999, 99999);
/**
 * The shore field's levels around the camera: cells along a side and the
 * finest cell size in metres, each level twice the size of the one before,
 * laid out as the foam field's are.
 */
const SHORE_FIELD_LEVELS = 4;
const SHORE_FIELD_CELLS = 256;
const SHORE_FIELD_CELL_SIZE = 0.5;
/** Shore field levels rebuilt in a frame at most, so the camera crossing every level's cell at once is no spike. */
const SHORE_FIELD_REBUILDS = 2;
/** No waterline grid: 0 cells. */
const NO_REGIONS: readonly Vector4[] = [new Vector4(0, 0, 1, 0)];

/**
 * One evaluated point of a water surface, in world space.
 *
 * `nx`/`ny`/`nz` are only filled when the caller asked for normals; otherwise
 * they stay at the straight-up default.
 *
 * @public
 */
export interface SurfacePointHit {
  /** World X of the displaced surface. */
  x: number;
  /** World Y of the displaced surface. */
  y: number;
  /** World Z of the displaced surface. */
  z: number;
  /** X component of the surface normal. */
  nx: number;
  /** Y component of the surface normal. */
  ny: number;
  /** Z component of the surface normal. */
  nz: number;
}

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
  /** Hash of the wave generator the feedback program was built for. */
  private _feedbackHash: string;
  private _feedbackBindGroup: DRef<BindGroup>;
  private _feedbackPrimitive: DRef<Primitive>;
  private _feedbackRenderTarget: DRef<FrameBuffer>;
  private _feedbackRenderStates: Nullable<RenderStateSet>;
  /**
   * Tail of the surface-query queue. The feedback pass reuses one vertex buffer
   * and render target, so requests are serialized in issue order.
   */
  private _feedbackQueue: Promise<void>;
  /**
   * Frame numbers of the stages of the most recent surface-point query, for
   * latency diagnostics: when it was requested, when its render was recorded,
   * and when the readback resolved. All are `device.frameInfo.frameCounter`.
   * @public
   */
  lastFeedbackTiming = { issued: 0, recorded: 0, mapped: 0 };
  private readonly _material: DRef<WaterMaterial>;
  /**
   * Whether each camera was inside this body of water on its previous update;
   * the submerged test has a dead band around the surface, so it needs the
   * crossing direction.
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
    this._material.get()!.TAAStrength = 0.2;
    this.waveGenerator = new FBMWaveGenerator();
    this._feedbackProgram = new DRef();
    this._feedbackHash = '';
    this._feedbackBindGroup = new DRef();
    this._feedbackPrimitive = new DRef();
    this._feedbackRenderTarget = new DRef();
    this._feedbackRenderStates = null;
    this._feedbackQueue = Promise.resolve();
    this._submerged = new WeakMap();
    scene.queuePerCameraUpdateNode(this);
  }
  /** Disposes the water node */
  protected onDispose() {
    super.onDispose();
    this._clipmap.dispose();
    this._shoreField?.dispose();
    this._shoreSource?.dispose();
    this._shoreField = null;
    this._shoreSource = null;
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
  /**
   * Wave generator object of the water: the source of the ambient surface.
   *
   * While an {@link interaction} is attached the surface actually drawn is
   * this generator plus the interaction field; this still returns the
   * generator on its own.
   */
  get waveGenerator() {
    return this.material.baseWaveGenerator;
  }
  set waveGenerator(waveGenerator) {
    this.material.waveGenerator = waveGenerator;
    if (this.material.needUpdate()) {
      this.scene?.queueUpdateNode(this);
    }
  }
  /**
   * Dynamic height field layered over the surface, driven by things touching
   * the water, or null for none. See {@link WaterInteraction}.
   *
   * The field is stepped on this water's own clock, so {@link animationSpeed}
   * scales it too; it is added everywhere the surface is evaluated, so
   * {@link getSurfacePoint} and the caustics see it as well.
   */
  get interaction() {
    return this.material.interaction;
  }
  set interaction(val: Nullable<WaterInteraction>) {
    this.material.interaction = val;
    if (this.material.needUpdate()) {
      this.scene?.queueUpdateNode(this);
    }
  }
  /**
   * Whether the surface reads as an unbounded ocean reaching the horizon,
   * rather than a body of water ending at the node's extent.
   *
   * Off by default. The region test is skipped while this is on.
   *
   * The horizon is reached without touching the camera's far plane: the
   * clipmap's outermost ring is drawn as a skirt whose outer vertices are
   * pushed well past it with their depth pinned to the far value.
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
   * Geometry cost grows only logarithmically. Keep it within the sky's
   * {@link SkyRenderer.aerialPerspectiveDistance}, or the far water stops
   * converging towards the sky colour and shows a hard band.
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
  /**
   * The wave clock the surface is currently at, in seconds.
   *
   * The time the displaced surface was last evaluated with (the value
   * {@link WaterMaterial.update} is handed), not the scene's elapsed time. CPU
   * samplers of the surface should use this clock; it matches `elapsedInSeconds`
   * from {@link SceneNode.update} only while {@link animationSpeed} is 1 and the
   * water has not been paused.
   */
  get waveTime() {
    return this._waveTime;
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
   * Furthest distance in meters from the camera the caustic map reaches; the
   * map is fitted to the part of the water within this distance.
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
  /** Water depth in metres below which no caustics show. */
  get causticsMinDepth() {
    return this.material.causticsMinDepth;
  }
  set causticsMinDepth(val: number) {
    this.material.causticsMinDepth = val;
  }
  /**
   * Whether a camera inside this body of water sees the water from the inside:
   * the medium applied to the whole scene, the sky replaced by water, and the
   * surface read from below with its Snell window.
   *
   * Uses the same medium coefficients the surface does ({@link absorption},
   * {@link scattering} and their scales). Atmospheric fog is suppressed while
   * submerged. Only reaches opaque geometry, like the atmospheric fog it
   * replaces.
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
   * Reads the caustic map as the surface's transmittance. Needs
   * {@link causticsEnabled}; switches itself off wherever the map is
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
   * shafts read as grain rather than as beams.
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
   * Without it a shaft runs straight through a piling or a hull. Costs a shadow
   * map lookup per march step, roughly doubling the cost of the shafts.
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
   * Strength of the glow of a backlit wave crest, 0 to disable. Authored, not
   * scaled by the light's intensity; {@link subsurfaceTint} supplies the hue.
   */
  get subsurfaceIntensity() {
    return this.material.subsurfaceIntensity;
  }
  set subsurfaceIntensity(val: number) {
    this.material.subsurfaceIntensity = val;
  }
  /**
   * Height above the still-water level, in meters, over which the lit wall of
   * a crest thins by a factor of `e`. Lower for a calm sea, higher so only the
   * tallest crests glow.
   */
  get subsurfaceCrestHeight() {
    return this.material.subsurfaceCrestHeight;
  }
  set subsurfaceCrestHeight(val: number) {
    this.material.subsurfaceCrestHeight = val;
  }
  /**
   * Colour of the crest glow, before the crest gate tints it with the medium's
   * extinction.
   */
  get subsurfaceTint() {
    return this.material.subsurfaceTint;
  }
  set subsurfaceTint(val: Vector3) {
    this.material.subsurfaceTint = val;
  }
  /**
   * Strength of the sunlight scattered out of the water column towards the eye,
   * 1 for the value the medium coefficients imply. Lets shadows darken the
   * water body and a low sun tint it; 0 leaves it lit by the environment alone.
   */
  get sunScatteringIntensity() {
    return this.material.sunScatteringIntensity;
  }
  set sunScatteringIntensity(val: number) {
    this.material.sunScatteringIntensity = val;
  }
  /**
   * Crest to trough height in metres of the waves rolling in to the shore,
   * breaking and running up the beach, 0 for none. They come square on to the
   * coast whatever its shape, and boats ride them. Needs the scene signed
   * distance field (WebGPU, scene SDF enabled).
   */
  get shoreWaveHeight() {
    return this.material.shoreWaveHeight;
  }
  set shoreWaveHeight(val: number) {
    this.material.shoreWaveHeight = val;
  }
  /** Thickness in metres over which a thin sheet of water fades in from the ground under it; 0 disables it. */
  get edgeFadeWidth() {
    return this.material.edgeFadeWidth;
  }
  set edgeFadeWidth(val: number) {
    this.material.edgeFadeWidth = val;
  }
  /** Distance in metres between shore wave crests at the outer edge of their zone. */
  get shoreWaveLength() {
    return this.material.shoreWaveLength;
  }
  set shoreWaveLength(val: number) {
    this.material.shoreWaveLength = val;
  }
  /** Seconds between successive shore waves. */
  get shoreWavePeriod() {
    return this.material.shoreWavePeriod;
  }
  set shoreWavePeriod(val: number) {
    this.material.shoreWavePeriod = val;
  }
  /** How far out from the waterline the shore waves rise, in metres. */
  get shoreWaveZone() {
    return this.material.shoreWaveZone;
  }
  set shoreWaveZone(val: number) {
    this.material.shoreWaveZone = val;
  }
  /** How sharp the shore wave crests become at the shore, 0 for a sine and towards 1 for a cusp. */
  get shoreWaveSharpness() {
    return this.material.shoreWaveSharpness;
  }
  set shoreWaveSharpness(val: number) {
    this.material.shoreWaveSharpness = val;
  }
  /** How far the shore wave crests lean towards the shore there, 0 for upright, 1 for a steep front face. */
  get shoreWaveLean() {
    return this.material.shoreWaveLean;
  }
  set shoreWaveLean(val: number) {
    this.material.shoreWaveLean = val;
  }
  /** How irregular the shore waves are, 0..1: 0 for parallel crests a fixed wavelength apart, higher for each wave with a period and a bend of its own. */
  get shoreWaveIrregularity() {
    return this.material.shoreWaveIrregularity;
  }
  set shoreWaveIrregularity(val: number) {
    this.material.shoreWaveIrregularity = val;
  }
  /** How fast the foam fades, per second (Crest's Foam Fade Rate): lower leaves longer trails behind breaking waves. */
  get foamFadeRate() {
    return this.material.foamFadeRate;
  }
  set foamFadeRate(val: number) {
    this.material.foamFadeRate = val;
  }
  /** How much foam the open water's breaking crests leave behind to drift and fade; 0 keeps foam only while a crest breaks. */
  get foamTrailStrength() {
    return this.material.foamTrailStrength;
  }
  set foamTrailStrength(val: number) {
    this.material.foamTrailStrength = val;
  }
  /** Share of the wind speed the foam drifts at, about 0.03 in nature. */
  get foamDrift() {
    return this.material.foamDrift;
  }
  set foamDrift(val: number) {
    this.material.foamDrift = val;
  }
  /** Side in metres of the finest square of water around the view whose foam lingers, in the most detail; coarser squares reach eight times as far, beyond which foam shows only while crests break. */
  get foamFieldSize() {
    return this.material.foamFieldSize;
  }
  set foamFieldSize(val: number) {
    this.material.foamFieldSize = val;
  }
  /** How much foam the breaking shore waves make (Crest's Wave Foam Strength). */
  get shoreWaveFoamStrength() {
    return this.material.shoreWaveFoamStrength;
  }
  set shoreWaveFoamStrength(val: number) {
    this.material.shoreWaveFoamStrength = val;
  }
  /** How much of the shore waves makes foam, 0..1, higher for more (Crest's Wave Foam Coverage). */
  get shoreWaveFoamCoverage() {
    return this.material.shoreWaveFoamCoverage;
  }
  set shoreWaveFoamCoverage(val: number) {
    this.material.shoreWaveFoamCoverage = val;
  }
  /** Water shallower than this many metres makes foam (Crest's Shoreline Foam Max Depth). */
  get shoreWaveShallowFoamDepth() {
    return this.material.shoreWaveShallowFoamDepth;
  }
  set shoreWaveShallowFoamDepth(val: number) {
    this.material.shoreWaveShallowFoamDepth = val;
  }
  /** How much foam shallow water makes (Crest's Shoreline Foam Strength). */
  get shoreWaveShallowFoamStrength() {
    return this.material.shoreWaveShallowFoamStrength;
  }
  set shoreWaveShallowFoamStrength(val: number) {
    this.material.shoreWaveShallowFoamStrength = val;
  }
  /** How opaque the foam is that the water makes against walls, rocks and piers standing in it, 0..1; it always rings them whole. */
  get wallFoamStrength() {
    return this.material.wallFoamStrength;
  }
  set wallFoamStrength(val: number) {
    this.material.wallFoamStrength = val;
  }
  /** Speed in metres per second the water has to hit a wall at before it makes any foam there. */
  get wallFoamMinSpeed() {
    return this.material.wallFoamMinSpeed;
  }
  set wallFoamMinSpeed(val: number) {
    this.material.wallFoamMinSpeed = val;
  }
  /** Speed in metres per second at which water hitting a wall makes the most foam. */
  get wallFoamMaxSpeed() {
    return this.material.wallFoamMaxSpeed;
  }
  set wallFoamMaxSpeed(val: number) {
    this.material.wallFoamMaxSpeed = val;
  }
  /** Speed in metres per second the foam drifts out from walls, rocks and piers at: higher for a wider ring of foam around them. */
  get wallFoamDrift() {
    return this.material.wallFoamDrift;
  }
  set wallFoamDrift(val: number) {
    this.material.wallFoamDrift = val;
  }
  /** Seconds the foam each breaking wave brings in lasts, behind the crest and up the beach. */
  get surfFoamDuration() {
    return this.material.surfFoamDuration;
  }
  set surfFoamDuration(val: number) {
    this.material.surfFoamDuration = val;
  }
  /** Water depth in metres at and below which foam stops drifting and stays where it is. */
  get foamSettleDepth() {
    return this.material.foamSettleDepth;
  }
  set foamSettleDepth(val: number) {
    this.material.foamSettleDepth = val;
  }
  /** Water depth in metres at and beyond which foam drifts freely. */
  get foamDriftDepth() {
    return this.material.foamDriftDepth;
  }
  set foamDriftDepth(val: number) {
    this.material.foamDriftDepth = val;
  }
  /** How fast foam settled in shallow water and on the sand fades, as a share of the foam's fade. */
  get settledFoamFade() {
    return this.material.settledFoamFade;
  }
  set settledFoamFade(val: number) {
    this.material.settledFoamFade = val;
  }
  /**
   * How the refracted view sample is located. Defaults to `march`.
   *
   * `offset` skips the depth-buffer search and displaces the screen UV by the
   * wave normal instead: cheaper, but submerged silhouettes smear. For hardware
   * that cannot afford the search.
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
   * Sets how strong the cheap distortion looks. A constant, because an offset
   * scaled by the real depth paints a second copy of anything breaking the surface.
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
   * The offset comes from refracting the view ray by Snell's law and projecting
   * its hit point back to the screen; this only dials it for a stylised look.
   * Values above 1 exaggerate, and the medium tint may stop matching what is
   * visible through the water.
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
   * Below 1 the surface reflects less and shows more of what is beneath it. The
   * F0 floor is scaled with it, so 0 gives no specular response at all.
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
   * Scales the wave generator's fold measure into a coverage fraction. 0
   * disables foam.
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
   * Above 1 this pushes light folding towards no foam, so only broken crests
   * show any.
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
      // Accumulate the scaled delta so a speed of zero freezes the phase in place.
      this._waveTime +=
        Math.max(0, elapsedInSeconds - Math.max(this._timeStart, this._lastUpdateTime)) *
        this._animationSpeed;
      this._lastUpdateTime = elapsedInSeconds;
      const interaction = this.material.interaction;
      if (interaction) {
        interaction.resolveNodes(this.scene);
        interaction.setWaterLevel(this.worldMatrix.m13);
      }
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
        // The skirt's outer edge sits beyond the tessellated surface to hide its last ring.
        mat.setSkirtDistance(viewDistance * SKIRT_DISTANCE_FACTOR);
      }
      this._renderData = this._clipmap.gather({
        camera,
        // An unbounded surface is not clipped to the node's region.
        minMaxWorldPos: infinite ? WHOLE_DOMAIN : mat.region,
        gridScale: Math.max(0.01, this._gridScale),
        userData: this,
        frustumCulling: true,
        viewDistance: infinite ? viewDistance : undefined,
        skirt: infinite,
        calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
          const p = that.worldMatrix.transformPointAffine(Vector3.zero());
          if (mat.waveGenerator) {
            mat.waveGenerator.calcClipmapTileAABB(minX, maxX, minZ, maxZ, p.y, outAABB);
          } else {
            outAABB.minPoint.setXYZ(minX, p.y, minZ);
            outAABB.maxPoint.setXYZ(maxX, p.y + 1, maxZ);
          }
        }
      });
      this.updateSubmergence(camera, mat);
      const interaction = mat.interaction;
      const wantsDepth = !!interaction && interaction.shallowDepth > 0;
      if ((mat.shoreWaveHeight > 0 || wantsDepth) && this.scene?.sdf.enabled) {
        // The interaction field and the shore waves read the waterline at the rest level
        this.scene.sdf.global?.waterline.request(this.worldMatrix.m13);
      }
      if (mat.shoreWaveHeight > 0) {
        // The waves and the beach's foam follow the terrain alone, in levels
        // out to the foam field's reach; the foam against walls, rocks and
        // piers the scene field's single level. Without a terrain the scene
        // field shapes the waves too.
        const terrainField = this.updateShoreField(camera);
        const waterline = this.scene?.sdf.enabled ? this.scene.sdf.global?.waterline : null;
        const wall = waterline?.ready ? waterline : null;
        const shore = terrainField?.ready ? terrainField : terrainField ? null : wall;
        mat.setShoreWaveFrame(
          shore?.smoothTexture ?? null,
          shore?.regions ?? NO_REGIONS,
          wall?.smoothTexture ?? null,
          wall?.region ?? NO_REGIONS[0],
          this.worldMatrix.m13
        );
      }
      if (interaction) {
        interaction.setBathymetry(wantsDepth ? this.findBathymetry() : null);
      }
      if (interaction && interaction.followMode === 'camera') {
        const focus = this.viewFocus(camera, interaction.windowSize * 0.5);
        interaction.setFocus(focus.x, focus.y);
      }
      // After the shore waves' frame, which the foam field's sources read
      const foamFocus = this.viewFocus(camera, mat.foamFieldSize * 0.5);
      RenderGraphExecutor.profileScope('WaterFoamField', () => mat.updateFoamField(foamFocus.x, foamFocus.y));
      this.scene?.queuePerCameraUpdateNode(this);
    }
  }
  /**
   * Where the interaction field reads the depth of the water: the scene
   * field's waterline grid when there is one, else the first terrain's height
   * map, else nothing.
   * @internal
   */
  private findBathymetry(): Nullable<WaterBathymetry> {
    const level = this.worldMatrix.m13;
    const waterline = this.scene?.sdf.enabled ? this.scene.sdf.global?.waterline : null;
    if (waterline?.ready && waterline.texture) {
      const r = waterline.region;
      return {
        kind: 'field',
        texture: waterline.texture,
        region: [r.x, r.y, r.z * r.w, r.z * r.w],
        level
      };
    }
    let terrain = this.findTerrain();
    const heightMap = terrain?.heightMap;
    if (!terrain || !heightMap) {
      return null;
    }
    const region = terrain.worldRegion;
    return {
      kind: 'height',
      texture: heightMap,
      region: [region.x, region.y, region.z - region.x, region.w - region.y],
      level,
      heightScale: Math.abs(terrain.scale.y),
      heightOffset: terrain.worldMatrix.m13
    };
  }
  /** The first terrain in the scene, cached while it stays in it. @internal */
  private findTerrain(): Nullable<ClipmapTerrain> {
    let terrain =
      this._bathyTerrain?.attached && this._bathyTerrain.scene === this.scene ? this._bathyTerrain : null;
    if (!terrain && this.scene) {
      this.scene.rootNode.iterate((node) => {
        if (node.isClipmapTerrain()) {
          terrain = node;
          return true;
        }
        return false;
      });
      this._bathyTerrain = terrain;
    }
    return terrain;
  }
  /**
   * Rebuilds the shore field, the waterline of the terrain alone in levels
   * around the camera, which the shore waves read, and returns it. Null
   * without a terrain or off WebGPU.
   * @internal
   */
  private updateShoreField(camera: Camera): Nullable<WaterlineField> {
    const terrain = this.findTerrain();
    const device = getDevice();
    if (!terrain?.heightMap || device.type !== 'webgpu') {
      return null;
    }
    if (!this._shoreField) {
      this._shoreSource = new TerrainWaterlineSource();
      this._shoreField = new WaterlineField(this._shoreSource, {
        levels: SHORE_FIELD_LEVELS,
        resolution: SHORE_FIELD_CELLS,
        cellSize: SHORE_FIELD_CELL_SIZE,
        maxRebuilds: SHORE_FIELD_REBUILDS
      });
    }
    this._shoreSource!.setTerrain(terrain);
    this._shoreField.request(this.worldMatrix.m13);
    device.pushDeviceStates();
    try {
      RenderGraphExecutor.profileScope('WaterShoreField', () =>
        this._shoreField!.update(camera.getWorldPosition())
      );
    } finally {
      device.popDeviceStates();
    }
    return this._shoreField;
  }
  /** @internal */
  private _shoreSource: Nullable<TerrainWaterlineSource> = null;
  /** @internal */
  private _shoreField: Nullable<WaterlineField> = null;
  /** @internal */
  private _bathyTerrain: Nullable<ClipmapTerrain> = null;
  /**
   * Decide whether `camera` is inside this body of water and publish the result.
   *
   * Run from `updatePerCamera`, which runs every frame regardless of culling, so
   * the state survives the surface leaving the frustum.
   *
   * The test is against the rest plane rather than the displaced surface, which
   * would need a GPU readback. A dead band of
   * {@link WaterMaterial.underwaterHysteresis} around the plane keeps an eye at
   * water level from flipping state every frame.
   * @internal
   */
  private updateSubmergence(camera: Camera, mat: WaterMaterial) {
    const surfaceY = this.worldMatrix.transformPointAffine(Vector3.zero()).y;
    let submerged = false;
    if (!this.hidden && this.attached) {
      const camPos = camera.getWorldPosition();
      const region = mat.region;
      // A bounded surface is only entered from within its own footprint.
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
   * The water the camera is looking at, on which a window that follows the
   * view (the interaction field, the foam field) is centred.
   *
   * Where the view direction meets the rest plane, no further ahead than
   * `reach` (half a window), so the window covers the visible water rather
   * than putting it in the sponge band at its edge.
   * @internal
   */
  private viewFocus(camera: Camera, reach: number) {
    const camPos = camera.getWorldPosition();
    const m = camera.worldMatrix;
    // The camera looks down its local -Z.
    const fx = -m.m02;
    const fy = -m.m12;
    const fz = -m.m22;
    const horizontal = Math.hypot(fx, fz);
    let ahead = reach;
    if (fy < -1e-4) {
      const t = (this.worldMatrix.m13 - camPos.y) / fy;
      if (t > 0) {
        ahead = Math.min(reach, t * horizontal);
      }
    }
    if (horizontal < 1e-6) {
      return new Vector2(camPos.x, camPos.z);
    }
    return new Vector2(camPos.x + (fx / horizontal) * ahead, camPos.z + (fz / horizontal) * ahead);
  }
  /**
   * Distance to the true horizon for the camera's height above this water, in
   * meters.
   *
   * `sqrt(2 * R * h)` for earth's radius: about 5km from an eye 2m up, 25km
   * from 50m.
   * @internal
   */
  private horizonDistance(camera: Camera) {
    const camPos = camera.getWorldPosition();
    const waterLevel = this.worldMatrix.transformPointAffine(Vector3.zero()).y;
    // Floored for cameras at or below the surface.
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
      // Null keeps an unbounded surface in the queue (ClipState.CLIPPED) and
      // leaves culling to the clipmap's per-tile test.
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
      mat.setClipmapGridInfo(
        this._gridScale,
        this.worldMatrix.m03,
        this.worldMatrix.m23,
        this._clipmap.tileResolution
      );
      mat.apply(ctx);
      for (const info of this._renderData!) {
        mat.draw(info.primitive, ctx, info.numInstances);
      }
    }
  }
  /**
   * Retrieve the disturbed world position and normal at water surface.
   * Set includeDisturbers to false for buoyancy: retain ambient waves and
   * external impulses, but exclude waves generated by moving disturbers.
   */
  async getSurfacePoint(
    points: Vector3[],
    outPos?: Vector3[],
    outNorm?: Vector3[],
    includeDisturbers = true
  ) {
    if (!outPos && !outNorm) {
      return;
    }
    const hits = await this._evaluateSurfacePoints(points, !!outNorm, includeDisturbers);
    if (!hits) {
      return;
    }
    for (let i = 0; i < points.length; i++) {
      outPos && outPos[i].setXYZ(hits[i].x, hits[i].y, hits[i].z);
      outNorm && outNorm[i].setXYZ(hits[i].nx, hits[i].ny, hits[i].nz);
    }
  }
  /**
   * Evaluate the disturbed surface over a set of world XZ positions.
   *
   * Evaluated by the same wave generator the material draws with, so it is
   * exact by construction. Costs one point-list draw plus one readback per call.
   * Requests are serialized because the vertex buffer and render target are
   * shared.
   *
   * @param points - World XZ positions to evaluate. Y is ignored.
   * @param withNormal - Whether to also read the surface normal back, which
   * costs a second readback of the same size.
   * @returns One hit per input point, or null if `points` was empty.
   * @internal
   */
  private async _evaluateSurfacePoints(
    points: Vector3[],
    withNormal: boolean,
    includeDisturbers = true
  ): Promise<Nullable<SurfacePointHit[]>> {
    const device = getDevice();
    if (!points || points.length === 0) {
      return null;
    }
    points = points.map((v) => v.clone());
    const timing = { issued: device.frameInfo.frameCounter, recorded: 0, mapped: 0 };
    // Take and replace the queue's tail in one synchronous step before awaiting,
    // so two callers arriving together cannot both pass the same settled tail.
    const previous = this._feedbackQueue;
    let release: () => void = () => {};
    this._feedbackQueue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    const hits: SurfacePointHit[] = points.map(() => ({
      x: 0,
      y: 0,
      z: 0,
      nx: 0,
      ny: 1,
      nz: 0
    }));
    try {
      await device.runNextFrameAsync(async () => {
        timing.recorded = device.frameInfo.frameCounter;
        const renderedGenerator = this.material.waveGenerator;
        const waveGenerator =
          !includeDisturbers && renderedGenerator instanceof InteractiveWaveGenerator
            ? new InteractiveWaveGenerator(renderedGenerator.base, renderedGenerator.interaction, false)
            : renderedGenerator;
        const feedbackHash = waveGenerator?.getHash() ?? '';
        if (this._feedbackProgram.get() && this._feedbackHash !== feedbackHash) {
          // The wave generator changed; rebuild the program for it.
          this._feedbackBindGroup.dispose();
          this._feedbackProgram.dispose();
        }
        if (!this._feedbackProgram.get()) {
          this._feedbackHash = feedbackHash;
          this._feedbackProgram.set(this._createFeedbackProgram(device, waveGenerator));
          this._feedbackBindGroup.set(
            device.createBindGroup(this._feedbackProgram.get()!.bindGroupLayouts[0])
          );
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
        // The generators displace from the still-water level, so it replaces the caller's Y.
        const level = this.worldMatrix.m13;
        for (let i = 0; i < points.length; i++) {
          vertices[i * 4 + 0] = points[i].x;
          vertices[i * 4 + 1] = level;
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
        if (waveGenerator) {
          waveGenerator.applyWaterBindGroup(bindGroup);
          ShaderHelper.setStandaloneCameraTime(bindGroup);
        }
        device.pushDeviceStates();
        device.setProgram(this._feedbackProgram.get());
        device.setBindGroup(0, this._feedbackBindGroup.get()!);
        device.setFramebuffer(this._feedbackRenderTarget.get());
        this._feedbackPrimitive.get()!.draw();
        device.popDeviceStates();
        const pos = new Float32Array(points.length * 4);
        // The normal attachment is only read when wanted, halving the readback otherwise.
        const norm = withNormal ? new Float32Array(points.length * 4) : null;
        // readPixels records its copy synchronously; flushing right after lets the
        // readback start before this frame's main render is recorded. This runs from
        // beginFrame, so the submit carries only the feedback work.
        const readPos = this._feedbackRenderTarget
          .get()!
          .getColorAttachment(0)
          .readPixels(0, 0, points.length, 1, 0, 0, pos);
        const readNorm = norm
          ? this._feedbackRenderTarget
              .get()!
              .getColorAttachment(1)
              .readPixels(0, 0, points.length, 1, 0, 0, norm)
          : Promise.resolve();
        device.flush();
        await Promise.all([readPos, readNorm]);
        timing.mapped = device.frameInfo.frameCounter;
        this.lastFeedbackTiming = timing;
        for (let i = 0; i < points.length; i++) {
          hits[i].x = pos[i * 4 + 0];
          hits[i].y = pos[i * 4 + 1];
          hits[i].z = pos[i * 4 + 2];
          if (norm) {
            hits[i].nx = norm[i * 4 + 0];
            hits[i].ny = norm[i * 4 + 1];
            hits[i].nz = norm[i * 4 + 2];
          }
        }
      });
    } finally {
      release();
    }
    return hits;
  }
  /** @internal */
  private _createFeedbackProgram(device: AbstractDevice, waveGenerator: Nullable<WaveGenerator>) {
    const program = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.position = pb.vec4().attrib('position');
        this.textureWidth = pb.float().uniform(0);
        if (waveGenerator) {
          waveGenerator.setupUniforms(this, 0);
          // Wave generators animate from camera.elapsedTime, declared standalone here
          ShaderHelper.declareStandaloneCameraTime(this, 0);
        }
        pb.main(function () {
          if (waveGenerator) {
            this.$l.worldPos = pb.vec3();
            this.$l.worldNorm = pb.vec3();
            waveGenerator.calcVertexPositionAndNormal(
              this,
              this.$inputs.position.xyz,
              this.worldPos,
              this.worldNorm
            );
          } else {
            this.$l.worldPos = this.$inputs.position.xyz;
            this.$l.worldNorm = pb.vec3(0, 1, 0);
          }
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
        if (waveGenerator) {
          waveGenerator.setupUniforms(this, 0);
          ShaderHelper.declareStandaloneCameraTime(this, 0);
        }
        pb.main(function () {
          this.$outputs.worldPos = pb.vec4(this.$inputs.worldPos, 1);
          this.$outputs.worldNorm = waveGenerator
            ? pb.vec4(waveGenerator.calcFragmentNormal(this, this.$inputs.xz, this.$inputs.worldNorm), 1)
            : pb.vec4(0, 1, 0, 1);
        });
      }
    })!;
    program.name = '@Water_Feedback';
    return program;
  }
}
