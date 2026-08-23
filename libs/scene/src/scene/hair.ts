/**
 * A groom in the scene graph.
 *
 * @remarks
 * Strand hair is drawn from control points held in storage buffers and expanded
 * into camera-facing ribbons in the vertex shader, which needs a handful of
 * pieces wired together that nothing else in the engine needs: a primitive that
 * carries no attributes but still establishes a vertex layout, a draw range
 * derived from the material rather than from an index buffer, and a bounding box
 * computed on the CPU because the geometry does not exist until the vertex stage
 * has run. This node owns that assembly so a groom can be placed, transformed,
 * serialised and simulated like anything else.
 *
 * The material is deliberately not exposed. Strand geometry only exists inside
 * {@link HairStrandMaterial} - it reads control points from storage buffers that
 * no other material knows about - so letting one be swapped in would produce a
 * node that cannot draw. The shading controls are surfaced as properties of the
 * node instead, and they are what gets serialised.
 *
 * The geometry itself lives in a `.zhair` asset, referenced by path. That file
 * holds nothing but strands: the node's own settings, shading included, belong
 * to the scene rather than to the asset, so one groom can be shared by several
 * characters that each style it differently.
 *
 * WebGPU only, because the expansion reads storage buffers from the vertex
 * stage. On other backends the node exists and keeps its data but draws nothing.
 */
import type { Immutable, Nullable, Vector4 } from '@zephyr3d/base';
import { applyMixins, DRef, Vector3 } from '@zephyr3d/base';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, RenderQueue } from '../render';
import { Primitive } from '../render';
import { HairStrandMaterial } from '../material/hairstrand';
import type { HairShadingModel } from '../material/hair';
import { HairStrandData, type HairStrandSource } from '../material/hairstrand_data';
import {
  GPUHairSimulation,
  isHairSimulationSupported,
  type GPUHairSimulationOptions
} from '../animation/hair/gpu_hair_simulation';
import type { ParsedZHair } from '../asset/loaders/zhair/zhair_format';
import { parseZHair } from '../asset/loaders/zhair/zhair_format';
import { loadZHairStrandSources, mergeHairStrandSources } from '../asset/loaders/zhair/zhair_loader';
import { BoundingBox } from '../utility/bounding_volume';
import { QUEUE_OPAQUE } from '../values';
import { getEngine } from '../app/api';
import type { BlendMode } from '../material/meshmaterial';

/**
 * Hair scene node.
 *
 * @remarks
 * Point it at a `.zhair` asset with {@link HairNode.setHairAsset}, or hand it
 * control points directly with {@link HairNode.setStrands}. Everything the draw
 * call needs is derived from them.
 *
 * @public
 */
export class HairNode extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  /** @internal */
  private readonly _pickTarget: PickTarget;
  /** @internal */
  private readonly _material: DRef<HairStrandMaterial>;
  /** @internal */
  private readonly _primitive: DRef<Primitive>;
  /** @internal */
  private readonly _strands: DRef<HairStrandData>;
  /** @internal Local-space bounds of the control points, width included. */
  private _bounds: Nullable<BoundingBox>;
  /** @internal */
  private _castShadow: boolean;
  /** @internal Kept so the simulation can be rebuilt from the authored pose. */
  private _source: Nullable<HairStrandSource>;
  /** @internal Path of the `.zhair` asset, empty when strands were set directly. */
  private _hairAsset: string;
  /**
   * @internal The opened asset, kept so decimation can be changed without
   * reading the file again.
   */
  private _parsedAsset: Nullable<ParsedZHair>;
  /** @internal */
  private _strandStride: number;
  /** @internal */
  private _maxStrands: number;
  /** @internal */
  private _simulation: Nullable<GPUHairSimulation>;
  /** @internal */
  private _simulationEnabled: boolean;
  /**
   * @internal Simulation tuning, owned by the node.
   *
   * Held here rather than on the simulation because the node outlives it: the
   * dials survive the simulation being switched off and on, and can be set
   * before any strands have loaded.
   */
  private readonly _simulationOptions: GPUHairSimulationOptions;
  /**
   * Creates an empty hair node.
   *
   * @param scene - Scene the node belongs to.
   */
  constructor(scene: Scene) {
    super(scene);
    this._pickTarget = { node: this };
    this._material = new DRef(new HairStrandMaterial());
    this._primitive = new DRef();
    this._strands = new DRef();
    this._bounds = null;
    this._castShadow = true;
    this._source = null;
    this._hairAsset = '';
    this._parsedAsset = null;
    this._strandStride = 1;
    this._maxStrands = 0;
    this._simulation = null;
    this._simulationEnabled = false;
    this._simulationOptions = {
      gravity: new Vector3(0, -9.8, 0),
      damping: 0.05,
      stiffness: 0.35,
      substeps: 2,
      friction: 0.2
    };
  }

  //
  // Geometry
  //

  /** Path of the `.zhair` asset this node draws, or an empty string. */
  get hairAsset() {
    return this._hairAsset;
  }
  /**
   * Loads a `.zhair` asset.
   *
   * @remarks
   * The opened file is kept, so changing {@link HairNode.strandStride} or
   * {@link HairNode.maxStrands} afterwards re-decimates what is already in
   * memory instead of reading it again - and never touches the source archive
   * the asset was converted from.
   *
   * @param path - Asset path, or an empty string to clear the node.
   */
  async setHairAsset(path: string) {
    const assetId = path?.trim() ?? '';
    if (assetId === this._hairAsset) {
      return;
    }
    this._hairAsset = assetId;
    this._parsedAsset = null;
    if (!assetId) {
      this.setStrands(null);
      return;
    }
    let parsed: ParsedZHair;
    try {
      const data = (await getEngine().resourceManager.assetManager.fetchBinaryData(assetId)) as ArrayBuffer;
      parsed = parseZHair(data);
    } catch (err) {
      console.error(`Load hair asset failed: ${assetId}: ${err}`);
      this.setStrands(null);
      return;
    }
    // A load that was superseded while it was in flight must not overwrite the
    // asset that replaced it.
    if (this._hairAsset !== assetId) {
      return;
    }
    this._parsedAsset = parsed;
    this._applyAssetDecimation();
  }
  /**
   * Draw one strand in every `strandStride`.
   *
   * @remarks
   * A stride rather than a leading slice, so the kept strands stay spread over
   * the whole scalp instead of leaving a bald patch. Only meaningful when the
   * strands came from an asset; strands set directly are used as given.
   */
  get strandStride() {
    return this._strandStride;
  }
  set strandStride(val: number) {
    const v = val < 1 ? 1 : val | 0;
    if (v !== this._strandStride) {
      this._strandStride = v;
      this._applyAssetDecimation();
    }
  }
  /**
   * Upper bound on the number of strands drawn, or 0 for no bound.
   *
   * @remarks
   * Applied on top of {@link HairNode.strandStride} by widening the stride
   * further, so the result stays evenly spread.
   */
  get maxStrands() {
    return this._maxStrands;
  }
  set maxStrands(val: number) {
    const v = val < 0 ? 0 : val | 0;
    if (v !== this._maxStrands) {
      this._maxStrands = v;
      this._applyAssetDecimation();
    }
  }
  /** GPU-resident strand geometry, or null when none has been assigned. */
  get strands(): Nullable<HairStrandData> {
    return this._strands.get();
  }
  /** Number of strands currently drawn. */
  get strandCount() {
    return this._strands.get()?.strandCount ?? 0;
  }
  /**
   * Replaces the strands this node draws.
   *
   * @remarks
   * The direct route, for strands built in code rather than loaded from an
   * asset. Uploads the control points, sizes the draw call and recomputes the
   * bounding box; the previous strand data is released and any running
   * simulation is rebuilt, since its rest pose comes from the strands.
   *
   * @param source - Control points and topology, or null to clear the node.
   */
  setStrands(source: Nullable<HairStrandSource>) {
    this._disposeSimulation();
    this._strands.dispose();
    this._bounds = null;
    this._source = null;
    if (!source) {
      this.material.strands = null;
      this._primitive.dispose();
      this.invalidateBoundingVolume();
      return;
    }
    const data = new HairStrandData(source);
    this._strands.set(data);
    this._source = source;
    this.material.strands = data;
    this._bounds = computeStrandBounds(source);
    this._ensurePrimitive();
    this._syncDrawRange();
    this.invalidateBoundingVolume();
    if (this._simulationEnabled) {
      this._createSimulation();
    }
  }

  //
  // Shading
  //
  // The material is an implementation detail of this node - see the class
  // remarks - so its controls are surfaced here. Only the ones that do something
  // on the strand path are: the vertex shader emits no texture coordinates, so
  // the material's albedo, shift and occlusion maps have nothing to sample and
  // are deliberately left unreachable.
  //

  /** Base colour of the strands. */
  get albedoColor(): Immutable<Vector4> {
    return this.material.albedoColor;
  }
  set albedoColor(value: Vector4) {
    this.material.albedoColor = value;
  }
  /**
   * Which scattering model shades the hair.
   *
   * @remarks
   * `kajiya-kay` is the art-directed double lobe; `marschner` derives the lobes
   * from the fibre and is the one that renders back-lighting.
   */
  get shadingModel(): HairShadingModel {
    return this.material.shadingModel;
  }
  set shadingModel(value: HairShadingModel) {
    this.material.shadingModel = value;
  }
  /** Colour of the primary, near-white specular lobe. */
  get specular1Color(): Immutable<Vector3> {
    return this.material.specular1Color;
  }
  set specular1Color(value: Vector3) {
    this.material.specular1Color = value;
  }
  /** Exponent of the primary specular lobe. */
  get specular1Power() {
    return this.material.specular1Power;
  }
  set specular1Power(value: number) {
    this.material.specular1Power = value;
  }
  /** Shift of the primary specular lobe along the strand. */
  get specular1Shift() {
    return this.material.specular1Shift;
  }
  set specular1Shift(value: number) {
    this.material.specular1Shift = value;
  }
  /** Colour of the secondary, tinted specular lobe. */
  get specular2Color(): Immutable<Vector3> {
    return this.material.specular2Color;
  }
  set specular2Color(value: Vector3) {
    this.material.specular2Color = value;
  }
  /** Exponent of the secondary specular lobe. */
  get specular2Power() {
    return this.material.specular2Power;
  }
  set specular2Power(value: number) {
    this.material.specular2Power = value;
  }
  /** Shift of the secondary specular lobe along the strand. */
  get specular2Shift() {
    return this.material.specular2Shift;
  }
  set specular2Shift(value: number) {
    this.material.specular2Shift = value;
  }
  /** How far diffuse lighting wraps around the fibre. */
  get diffuseWrap() {
    return this.material.diffuseWrap;
  }
  set diffuseWrap(value: number) {
    this.material.diffuseWrap = value;
  }
  /** Colour of light transmitted through the fibre. */
  get transmissionColor(): Immutable<Vector3> {
    return this.material.transmissionColor;
  }
  set transmissionColor(value: Vector3) {
    this.material.transmissionColor = value;
  }
  /** Strength of back-lit transmission. */
  get transmissionIntensity() {
    return this.material.transmissionIntensity;
  }
  set transmissionIntensity(value: number) {
    this.material.transmissionIntensity = value;
  }
  /** Falloff exponent of back-lit transmission. */
  get transmissionPower() {
    return this.material.transmissionPower;
  }
  set transmissionPower(value: number) {
    this.material.transmissionPower = value;
  }
  /** Colour of multiple scattering within the groom. */
  get scatterColor(): Immutable<Vector3> {
    return this.material.scatterColor;
  }
  set scatterColor(value: Vector3) {
    this.material.scatterColor = value;
  }
  /** Strength of multiple scattering. */
  get scatterIntensity() {
    return this.material.scatterIntensity;
  }
  set scatterIntensity(value: number) {
    this.material.scatterIntensity = value;
  }
  /** Share of scattering taken as local rather than global. */
  get scatterLocal() {
    return this.material.scatterLocal;
  }
  set scatterLocal(value: number) {
    this.material.scatterLocal = value;
  }
  /** How far scattered light wraps around the fibre. */
  get scatterWrap() {
    return this.material.scatterWrap;
  }
  set scatterWrap(value: number) {
    this.material.scatterWrap = value;
  }
  /** Longitudinal shift of the Marschner lobes. */
  get marschnerShift() {
    return this.material.marschnerShift;
  }
  set marschnerShift(value: number) {
    this.material.marschnerShift = value;
  }
  /** Longitudinal roughness of the Marschner lobes. */
  get marschnerRoughness() {
    return this.material.marschnerRoughness;
  }
  set marschnerRoughness(value: number) {
    this.material.marschnerRoughness = value;
  }
  /** Index of refraction of the fibre. */
  get marschnerIOR() {
    return this.material.marschnerIOR;
  }
  set marschnerIOR(value: number) {
    this.material.marschnerIOR = value;
  }
  /**
   * How strongly pigmented the fibre is.
   *
   * @remarks
   * A multiplier on the distance transmitted light travels before leaving, so
   * raising it deepens the colour of the TT and TRT paths without touching the
   * white surface reflection.
   */
  get marschnerAbsorption() {
    return this.material.marschnerAbsorption;
  }
  set marschnerAbsorption(value: number) {
    this.material.marschnerAbsorption = value;
  }
  /** Relative weight of the R, TT and TRT lobes. */
  get marschnerLobes(): Immutable<Vector3> {
    return this.material.marschnerLobes;
  }
  set marschnerLobes(value: Immutable<Vector3>) {
    this.material.marschnerLobes = value;
  }

  //
  // Strand expansion
  //

  /**
   * Ribbon segments generated per strand.
   *
   * @remarks
   * The main quality dial, and independent of how many control points a strand
   * has: the shader resamples the curve, so the same 30-point strand can be
   * drawn with 12 segments close up and 3 far away.
   */
  get segmentsPerStrand() {
    return this.material.segmentsPerStrand;
  }
  set segmentsPerStrand(val: number) {
    if (val !== this.material.segmentsPerStrand) {
      this.material.segmentsPerStrand = val;
      this._syncDrawRange();
    }
  }
  /** Multiplier on the width stored in the strand data. */
  get strandWidthScale() {
    return this.material.strandWidthScale;
  }
  set strandWidthScale(value: number) {
    this.material.strandWidthScale = value;
  }
  /** Lower bound on ribbon width, in world units. */
  get minStrandWidth() {
    return this.material.minStrandWidth;
  }
  set minStrandWidth(value: number) {
    this.material.minStrandWidth = value;
  }
  /**
   * Lower bound on ribbon width, in pixels.
   *
   * @remarks
   * Real hair is thinner than a pixel and rasterises to a flickering dotted
   * line. Widening it to about a pixel and paying the extra coverage back in
   * alpha keeps distant hair fading rather than breaking up.
   */
  get minPixelWidth() {
    return this.material.minPixelWidth;
  }
  set minPixelWidth(value: number) {
    this.material.minPixelWidth = value;
  }
  /**
   * How far the shading normal bends across the ribbon, in [0, 1].
   *
   * @remarks
   * At 0 a strand shades as a flat tape, at 1 as a cylinder.
   */
  get strandRoundness() {
    return this.material.strandRoundness;
  }
  set strandRoundness(value: number) {
    this.material.strandRoundness = value;
  }
  /**
   * Strength of the root-depth ambient occlusion, in [0, 1].
   *
   * @remarks
   * Environment irradiance is not attenuated by anything - a shadow map answers
   * for one light, not for the sky - so without this every strand of a groom
   * receives the full sky and a dense hairstyle is lit as brightly in its
   * interior as on its surface, which reads as a flat silhouette with no volume.
   * Most obvious on pale hair, where there is little pigment to darken the
   * interior instead. Set to 0 to disable.
   *
   * Ambient light only: direct light is already attenuated by the shadow map,
   * and under DOM by a graded transmittance, so it is left alone.
   */
  get rootOcclusion() {
    return this.material.rootOcclusion;
  }
  set rootOcclusion(value: number) {
    this.material.rootOcclusion = value;
  }
  /**
   * How far along a strand the root occlusion reaches, in (0, 1].
   *
   * @remarks
   * Short for a groom whose strands leave the scalp quickly, longer for one
   * where they lie against each other most of their length.
   */
  get rootOcclusionRange() {
    return this.material.rootOcclusionRange;
  }
  set rootOcclusionRange(value: number) {
    this.material.rootOcclusionRange = value;
  }
  /** Drop strands with distance, redistributing their coverage to the survivors. */
  get strandLOD() {
    return this.material.strandLOD;
  }
  set strandLOD(value: boolean) {
    this.material.strandLOD = value;
  }
  /** Floor on the fraction of strands distance decimation keeps. */
  get minStrandLODRatio() {
    return this.material.minStrandLODRatio;
  }
  set minStrandLODRatio(value: number) {
    this.material.minStrandLODRatio = value;
  }

  //
  // Transparency and shadows
  //

  /**
   * How the strands blend with what is behind them.
   *
   * @remarks
   * The pixel-width floor pays its widening back in alpha, which only means
   * anything once blending is on; left at `none` every strand covers its pixel
   * fully and a dense groom reads as a solid shell.
   */
  get blendMode(): BlendMode {
    return this.material.blendMode;
  }
  set blendMode(value: BlendMode) {
    this.material.blendMode = value;
  }
  /** Alpha below which a fragment is discarded. */
  get alphaCutoff() {
    return this.material.alphaCutoff;
  }
  set alphaCutoff(value: number) {
    this.material.alphaCutoff = value;
  }
  /** Dither the alpha test, so a temporal filter resolves the soft edge. */
  get alphaDither() {
    return this.material.alphaDither;
  }
  set alphaDither(value: boolean) {
    this.material.alphaDither = value;
  }
  /** Whether the groom is drawn into shadow maps. */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(val: boolean) {
    this._castShadow = !!val;
  }
  /** Let the shadow caster pass respect strand alpha, for softer self-shadowing. */
  get transparentShadowCaster() {
    return this.material.transparentShadowCaster;
  }
  set transparentShadowCaster(value: boolean) {
    this.material.transparentShadowCaster = value;
  }
  /** Alpha below which a fragment casts no shadow. */
  get shadowAlphaCutoff() {
    return this.material.shadowAlphaCutoff;
  }
  set shadowAlphaCutoff(value: number) {
    this.material.shadowAlphaCutoff = value;
  }

  //
  // Simulation
  //

  /**
   * Whether strand dynamics run on this groom.
   *
   * @remarks
   * WebGPU only. Switching it on with no strands loaded is allowed - the
   * simulation is built when the strands arrive.
   */
  get simulationEnabled() {
    return this._simulationEnabled;
  }
  set simulationEnabled(val: boolean) {
    const enabled = !!val;
    if (enabled === this._simulationEnabled) {
      return;
    }
    this._simulationEnabled = enabled;
    if (enabled) {
      this._createSimulation();
    } else {
      this._disposeSimulation();
      // Without this the groom keeps whatever pose it was last simulated into,
      // which reads as a bug rather than as hair that stopped moving.
      if (this._source) {
        this._strands.get()?.dispose();
        this._strands.set(new HairStrandData(this._source));
        this.material.strands = this._strands.get();
      }
    }
  }
  /**
   * The running strand dynamics, or null when they are off or unsupported.
   *
   * @remarks
   * Exposed so a caller can reach past the node's own dials - to set colliders,
   * for one, which have no serialised form here.
   */
  get simulation(): Nullable<GPUHairSimulation> {
    return this._simulation;
  }
  /** World-space gravity acting on the strands. */
  get gravity(): Immutable<Vector3> {
    return this._simulationOptions.gravity!;
  }
  set gravity(value: Vector3) {
    this._simulationOptions.gravity = new Vector3(value);
    if (this._simulation) {
      this._simulation.gravity = this._simulationOptions.gravity;
    }
  }
  /** How strongly strands return to their authored shape, in [0, 1]. */
  get stiffness() {
    return this._simulationOptions.stiffness!;
  }
  set stiffness(value: number) {
    this._simulationOptions.stiffness = value;
    if (this._simulation) {
      this._simulation.stiffness = value;
    }
  }
  /** Velocity lost each step, in [0, 1]. */
  get damping() {
    return this._simulationOptions.damping!;
  }
  set damping(value: number) {
    this._simulationOptions.damping = value;
    if (this._simulation) {
      this._simulation.damping = value;
    }
  }
  /** Tangential motion removed at a contact, in [0, 1]. */
  get friction() {
    return this._simulationOptions.friction!;
  }
  set friction(value: number) {
    this._simulationOptions.friction = value;
    if (this._simulation) {
      this._simulation.friction = value;
    }
  }
  /** Integration substeps per fixed step. */
  get substeps() {
    return this._simulationOptions.substeps!;
  }
  set substeps(value: number) {
    this._simulationOptions.substeps = value;
    if (this._simulation) {
      this._simulation.substeps = value;
    }
  }

  //
  // Scene node and drawable
  //

  /**
   * {@inheritDoc SceneNode.update}
   *
   * @remarks
   * Drives the strand solver. The node re-queues itself every frame, because a
   * simulation only stands still when it is switched off.
   */
  update(frameId: number, elapsedInSeconds: number, deltaInSeconds: number) {
    super.update(frameId, elapsedInSeconds, deltaInSeconds);
    const simulation = this._simulation;
    if (simulation?.enabled) {
      simulation.update(deltaInSeconds, this.worldMatrix);
      this.scene?.queueUpdateNode(this);
    }
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   *
   * @remarks
   * Derived on the CPU from the control points, because the ribbons are built in
   * the vertex shader and the engine never sees them. The box is in local space;
   * the base class applies the world matrix.
   */
  computeBoundingVolume(): Nullable<BoundingBox> {
    return this._bounds ? new BoundingBox(this._bounds) : null;
  }
  /** {@inheritDoc SceneNode.isHair} */
  isHair(): this is HairNode {
    return true;
  }
  /** {@inheritDoc Drawable.getPickTarget} */
  getPickTarget() {
    return this._pickTarget;
  }
  /** {@inheritDoc Drawable.getMaterial} */
  getMaterial() {
    return this._material.get();
  }
  /** {@inheritDoc Drawable.getPrimitive} */
  getPrimitive() {
    return this._primitive.get();
  }
  /** {@inheritDoc Drawable.getMorphData} */
  getMorphData() {
    return null;
  }
  /** {@inheritDoc Drawable.getMorphInfo} */
  getMorphInfo() {
    return null;
  }
  /** {@inheritDoc Drawable.getSkinInfluenceData} */
  getSkinInfluenceData() {
    return null;
  }
  /** {@inheritDoc Drawable.getQueueType} */
  getQueueType() {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /** {@inheritDoc Drawable.isUnlit} */
  isUnlit() {
    return !this._material.get()?.supportLighting();
  }
  /** {@inheritDoc Drawable.needSceneColor} */
  needSceneColor() {
    return this._material.get()?.needSceneColor() ?? false;
  }
  /** {@inheritDoc Drawable.needSceneDepth} */
  needSceneDepth() {
    return this._material.get()?.needSceneDepth() ?? false;
  }
  /** {@inheritDoc Drawable.draw} */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>) {
    const material = this._material.get();
    const primitive = this._primitive.get();
    // An empty groom is a legitimate state - a node exists before its asset has
    // finished loading - and the draw range is zero until strands arrive.
    if (material && primitive && material.vertexCount > 0) {
      this.bind(ctx, renderQueue);
      material.draw(primitive, ctx);
    }
  }
  protected onDispose() {
    super.onDispose();
    this._disposeSimulation();
    this._primitive.dispose();
    this._strands.dispose();
    this._material.dispose();
    this._parsedAsset = null;
    this._source = null;
    this._bounds = null;
  }

  //
  // Internals
  //

  /**
   * The material, which is an implementation detail of this node.
   * @internal
   */
  private get material() {
    return this._material.get()!;
  }
  /**
   * Re-decimates the opened asset into the strands actually drawn.
   * @internal
   */
  private _applyAssetDecimation() {
    const parsed = this._parsedAsset;
    if (!parsed) {
      return;
    }
    // A `.zhair` holds one set per source curve object, and an XGen export
    // routinely carries several spline descriptions for a single hairstyle;
    // merging lets the whole head draw in one call.
    this.setStrands(
      mergeHairStrandSources(
        loadZHairStrandSources(parsed, {
          strandStride: this._strandStride,
          maxStrands: this._maxStrands
        })
      )
    );
  }
  /**
   * Starts strand dynamics over the current strands.
   * @internal
   */
  private _createSimulation() {
    this._disposeSimulation();
    const data = this._strands.get();
    if (!data || !this._source || !isHairSimulationSupported()) {
      return;
    }
    const simulation = new GPUHairSimulation(data, this._source, this._simulationOptions);
    if (simulation.enabled) {
      this._simulation = simulation;
      this.scene?.queueUpdateNode(this);
    } else {
      console.warn(simulation.disabledReason ?? 'GPU hair simulation could not start');
      simulation.dispose();
    }
  }
  /** @internal */
  private _disposeSimulation() {
    this._simulation?.dispose();
    this._simulation = null;
  }
  /**
   * Builds the primitive the draw call is issued against.
   *
   * @remarks
   * No vertex attribute is ever read - the vertex shader derives everything from
   * the vertex index and the storage buffers - but a draw still needs a vertex
   * layout to exist, and one float is the smallest buffer that establishes one.
   * @internal
   */
  private _ensurePrimitive() {
    if (this._primitive.get()) {
      return;
    }
    const primitive = new Primitive();
    primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(3));
    primitive.primitiveType = 'triangle-list';
    this._primitive.set(primitive);
  }
  /**
   * Points the draw range at however many vertices the material now needs.
   *
   * @remarks
   * Drawing is non-indexed, six vertices per ribbon segment, so the count moves
   * with both the strand count and {@link HairNode.segmentsPerStrand}.
   * @internal
   */
  private _syncDrawRange() {
    const primitive = this._primitive.get();
    if (primitive) {
      primitive.indexCount = this.material.vertexCount;
    }
  }
}

/**
 * Local-space bounds of a strand source, padded by the widest strand.
 *
 * @remarks
 * The ribbon is built around the control point, so half a width would suffice;
 * a full width is used because {@link HairNode.minPixelWidth} widens sub-pixel
 * strands beyond their authored size and the box has to survive that.
 * @internal
 */
function computeStrandBounds(source: HairStrandSource): BoundingBox {
  const scale = source.scale ?? 1;
  const positions = source.positions;
  let pointCount = 0;
  for (let i = 0; i < source.pointCounts.length; i++) {
    pointCount += source.pointCounts[i];
  }
  const box = new BoundingBox();
  box.beginExtend();
  for (let i = 0; i < pointCount; i++) {
    box.extend3(positions[i * 3] * scale, positions[i * 3 + 1] * scale, positions[i * 3 + 2] * scale);
  }
  let widest = source.defaultWidth ?? 0.0001;
  if (source.widths) {
    for (let i = 0; i < source.widths.length; i++) {
      if (source.widths[i] > widest) {
        widest = source.widths[i];
      }
    }
  }
  const pad = widest * scale * (source.widthScale ?? 1);
  box.minPoint.setXYZ(box.minPoint.x - pad, box.minPoint.y - pad, box.minPoint.z - pad);
  box.maxPoint.setXYZ(box.maxPoint.x + pad, box.maxPoint.y + pad, box.maxPoint.z + pad);
  return box;
}
