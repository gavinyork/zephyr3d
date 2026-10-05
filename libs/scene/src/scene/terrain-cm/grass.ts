import type { IndexBuffer, StructuredBuffer, Texture2D } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { AABB, ClipState, nextPowerOf2, DRef, DWeakRef, Disposable, Vector3, Vector4 } from '@zephyr3d/base';
import type { DrawContext, ShadowMapPass } from '../../render';
import type { Camera } from '../../camera';
import { Primitive } from '../../render';
import { ClipmapGrassMaterial } from './grassmaterial';
import type { ClipmapTerrain } from './terrain-cm';
import { getDevice } from '../../app/api';
import type { GrassBladeShape, GrassLayerKind } from './grass_gpu';
import { GRASS_CULL_PLANES, GrassGpuPlacement, GrassOcclusionMode, grassHash } from './grass_gpu';
import { DirectionalLight } from '../light';
import { RENDER_PASS_TYPE_SHADOWMAP } from '../../values';
import { BLADE_LOD_INDEX_COUNTS, ClipmapBladeGrassMaterial, createBladeIndices } from './bladegrassmaterial';

const INSTANCE_BYTES = 4 * 4;
/** Number of placement cells along each axis of a grass tile */
const TILE_CELLS = 64;
/** Default number of placement cells per density map texel along each axis */
const DEFAULT_CELLS_PER_TEXEL = 2;
const MAX_CELLS_PER_TEXEL = 8;
/** Default distance from the camera beyond which grass is not drawn */
const DEFAULT_DRAW_DISTANCE = 150;
/** Default fraction of blades kept at the draw distance */
const DEFAULT_FAR_DENSITY = 0.25;
/**
 * Number of the nearest cascades of the sun's shadow map procedural blades cast shadows into.
 * Farther cascades have texels too coarse for single blades.
 */
const GRASS_SHADOW_CASCADES = 2;
/** Default shape and clumping of procedural blades, see GrassBladeShape */
const DEFAULT_BLADE_SHAPE = [
  1.5, 0.3, 0.08, 0.2, 0.25, 0.2, 0.15, 0.1, 1.9, 0.48, 0.2, 0.3, 0.2, 0.5, 0.15, 80
];
/**
 * Default width of procedural blades
 * @internal
 */
export const DEFAULT_BLADE_WIDTH = 0.08;
/**
 * Default height of procedural blades
 * @internal
 */
export const DEFAULT_BLADE_HEIGHT = 1.5;

function distanceSqToAABB(x: number, y: number, z: number, aabb: AABB) {
  const dx = Math.max(aabb.minPoint.x - x, 0, x - aabb.maxPoint.x);
  const dy = Math.max(aabb.minPoint.y - y, 0, y - aabb.maxPoint.y);
  const dz = Math.max(aabb.minPoint.z - z, 0, z - aabb.maxPoint.z);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Grass blade instance buffer for a single tile
 * @internal
 */
export class GrassInstances extends Disposable {
  private _numInstances: number;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private readonly _indexBuffer: DRef<IndexBuffer>;
  private readonly _instanceBuffer: DRef<StructuredBuffer>;
  private readonly _primitive: DRef<Primitive>;
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    super();
    this._numInstances = 0;
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._instanceBuffer = new DRef();
    this._primitive = new DRef();
  }
  get numInstances() {
    return this._numInstances;
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._primitive.dispose();
    }
  }
  /**
   * Sets the packed instance data (x, y, sin, cos per instance)
   */
  setData(data: Float32Array<ArrayBuffer>, count: number) {
    this._numInstances = count;
    if (count === 0) {
      return;
    }
    const device = getDevice();
    const bytesRequired = count * INSTANCE_BYTES;
    let buffer = this._instanceBuffer.get();
    if (!buffer || buffer.byteLength < bytesRequired) {
      buffer = device.createVertexBuffer('tex1_f32x4', new Uint8Array(nextPowerOf2(bytesRequired)))!;
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
    }
    buffer.bufferSubData(0, data.subarray(0, count * 4));
  }
  draw() {
    if (this._numInstances > 0) {
      if (!this._primitive.get()) {
        const primitive = new Primitive();
        primitive.setVertexBuffer(this._baseVertexBuffer.get()!);
        primitive.setVertexBuffer(this._instanceBuffer.get()!, 'instance');
        primitive.setIndexBuffer(this._indexBuffer.get());
        primitive.primitiveType = 'triangle-list';
        primitive.indexStart = 0;
        primitive.indexCount = this._indexBuffer.get()!.length;
        this._primitive.set(primitive);
      }
      this._primitive.get()!.drawInstanced(this._numInstances);
    }
  }
  protected onDispose() {
    super.onDispose();
    this._baseVertexBuffer.dispose();
    this._indexBuffer.dispose();
    this._instanceBuffer.dispose();
    this._primitive.dispose();
  }
}

/**
 * Grass layer class
 *
 * @public
 */
export class GrassLayer extends Disposable {
  private static readonly _indexBuffer: DRef<IndexBuffer> = new DRef();
  private static readonly _bladeIndexBuffer: DRef<IndexBuffer> = new DRef();
  private static readonly _bladeVertexBuffer: DRef<StructuredBuffer> = new DRef();
  private static _bladeWarningShown = false;
  private static readonly _cullAABB = new AABB();
  private static readonly _cameraPos = new Vector3();
  private static readonly _visibleTiles: GrassInstances[] = [];
  private static readonly _instanceData = new Float32Array(TILE_CELLS * TILE_CELLS * 4);
  private readonly _kind: GrassLayerKind;
  private readonly _material: DRef<ClipmapGrassMaterial | ClipmapBladeGrassMaterial>;
  private readonly _bladeShape: GrassBladeShape;
  private readonly _seed: number;
  private _bladeWidth: number;
  private _bladeHeight: number;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private _densityWidth: number;
  private _densityHeight: number;
  private _cellsPerTexel: number;
  private _densityMap: Uint8Array;
  private readonly _tiles: Map<number, GrassInstances>;
  private _tilesX: number;
  private _tilesZ: number;
  private _numBlades: number;
  private _drawDistance: number;
  private _farDensity: number;
  /** Set on WebGPU with indirect draw: blades are placed on the GPU instead of in CPU tiles */
  private readonly _gpu: Nullable<GrassGpuPlacement>;
  /** Number of shadow maps the blades were placed for by the last updatePerCamera() call */
  private _numShadowTargets: number;
  /**
   * Creates an instance of GrassLayer
   * @param terrain - Clipmap terrain object
   * @param seed - Seed for deterministic blade placement, usually the layer index
   * @param bladeWidth - Grass blade width
   * @param bladeHeight - Grass blade height
   * @param albedoMap - Albedo texture for the blade, card layers only
   * @param kind - Textured cards, or procedural blades (drawn on WebGPU only)
   */
  constructor(
    terrain: ClipmapTerrain,
    seed: number,
    bladeWidth: number,
    bladeHeight: number,
    albedoMap?: Nullable<Texture2D>,
    kind: GrassLayerKind = 'card'
  ) {
    super();
    this._kind = kind;
    this._bladeShape = new Float32Array(DEFAULT_BLADE_SHAPE);
    if (kind === 'blade') {
      const material = new ClipmapBladeGrassMaterial(terrain);
      material.colorMap = albedoMap ?? null;
      this._material = new DRef(material);
    } else {
      const material = new ClipmapGrassMaterial(terrain);
      material.albedoTexture = albedoMap ?? null;
      if (albedoMap) {
        material.setTextureSize(albedoMap.width, albedoMap.height);
      }
      this._material = new DRef(material);
    }
    this._seed = seed;
    this._bladeWidth = bladeWidth;
    this._bladeHeight = bladeHeight;
    this._baseVertexBuffer = new DRef(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
    this._densityWidth = Math.max(1, terrain.sizeX);
    this._densityHeight = Math.max(1, terrain.sizeZ);
    this._cellsPerTexel = DEFAULT_CELLS_PER_TEXEL;
    this._densityMap = new Uint8Array(this._densityWidth * this._densityHeight);
    this._tiles = new Map();
    this._tilesX = 0;
    this._tilesZ = 0;
    this._numBlades = 0;
    this._drawDistance = 0;
    this._farDensity = 1;
    this._numShadowTargets = 0;
    if (!GrassGpuPlacement.isSupported()) {
      this._gpu = null;
      if (kind === 'blade' && !GrassLayer._bladeWarningShown) {
        GrassLayer._bladeWarningShown = true;
        console.warn('Procedural grass blades need WebGPU with indirect draw; blade layers are not drawn');
      }
    } else if (kind === 'blade') {
      this._gpu = new GrassGpuPlacement(
        'blade',
        GrassLayer._getBladeVertexBuffer()!,
        GrassLayer._getBladeIndexBuffer()!,
        BLADE_LOD_INDEX_COUNTS
      );
    } else {
      this._gpu = new GrassGpuPlacement('card', this._baseVertexBuffer.get()!, GrassLayer._getIndexBuffer()!);
    }
    if (kind === 'blade') {
      this._bladeShape[0] = bladeHeight;
      this._bladeShape[2] = bladeWidth;
      this.bladeMaterial!.lodDistance = this._bladeShape[15];
    }
    this._gpu?.setDensity(this._densityWidth, this._densityHeight, this._densityMap);
    this.drawDistance = DEFAULT_DRAW_DISTANCE;
    this.farDensity = DEFAULT_FAR_DENSITY;
    this.updateTileGrid();
  }
  /**
   * Distance from the camera beyond which blades of this layer are not drawn. Blades shrink
   * into the ground over the last quarter of it. Zero draws the layer at any distance.
   */
  get drawDistance() {
    return this._drawDistance;
  }
  set drawDistance(val: number) {
    val = Math.max(0, Number(val) || 0);
    if (val !== this._drawDistance) {
      this._drawDistance = val;
      this._material.get()!.setDrawDistance(val);
    }
  }
  /**
   * Fraction of the blades of this layer still drawn at the draw distance, 1 to draw them all.
   *
   * From a quarter of the draw distance on, blades thin out towards this fraction, each leaving
   * at its own fixed distance, and the remaining ones widen to keep the ground covered. Saves
   * most of the distant grass geometry where blades are placed on the GPU (WebGPU); elsewhere
   * the dropped blades are still drawn, only shrunk to nothing. Has no effect without a draw
   * distance, nor on blade layers, which thin out by their detail levels (see
   * {@link GrassLayer.lodDistance}).
   */
  get farDensity() {
    return this._farDensity;
  }
  set farDensity(val: number) {
    val = Math.min(1, Math.max(0.01, Number(val) || 0));
    if (val !== this._farDensity) {
      this._farDensity = val;
      this._material.get()!.setFarDensity(val);
    }
  }
  /** Kind of the blades of this layer, fixed at creation */
  get kind() {
    return this._kind;
  }
  /** @internal */
  updateMaterial() {
    this._material.get()!.uniformChanged();
  }
  /**
   * Sets the albedo texture of grass blades in this layer: the card texture of card layers, the
   * color map of blade layers (see {@link GrassLayer.colorMap})
   * @param albedoMap - Albedo texture to set
   */
  setAlbedoMap(albedoMap: Nullable<Texture2D>) {
    const material = this._material.get()!;
    if (material instanceof ClipmapGrassMaterial) {
      material.albedoTexture = albedoMap;
      if (albedoMap) {
        material.setTextureSize(albedoMap.width, albedoMap.height);
      }
    } else {
      material.colorMap = albedoMap;
    }
  }
  /**
   * Gets the albedo texture of grass blades in this layer
   * @returns - The card texture of card layers, the color map of blade layers
   */
  getAlbedoMap() {
    const material = this._material.get()!;
    return material instanceof ClipmapGrassMaterial ? material.albedoTexture : material.colorMap;
  }
  /** @internal */
  private get bladeMaterial() {
    const material = this._material.get()!;
    return material instanceof ClipmapBladeGrassMaterial ? material : null;
  }
  /** @internal */
  private setShape(index: number, value: number) {
    if (Number.isFinite(value)) {
      this._bladeShape[index] = value;
    }
  }
  /**
   * How much blade heights vary around the layer's blade height, as a fraction of it.
   * Blade layers only.
   */
  get heightRandomness() {
    return this._bladeShape[1];
  }
  set heightRandomness(val: number) {
    this.setShape(1, Math.min(1, Math.max(0, val)));
  }
  /** How much blade widths vary around the layer's blade width, as a fraction of it. Blade layers only. */
  get widthRandomness() {
    return this._bladeShape[3];
  }
  set widthRandomness(val: number) {
    this.setShape(3, Math.min(1, Math.max(0, val)));
  }
  /**
   * How far the blades lean over: 0 stands them upright, 1 lays their tips on the ground.
   * Blade layers only.
   */
  get tilt() {
    return this._bladeShape[4];
  }
  set tilt(val: number) {
    this.setShape(4, Math.min(1, Math.max(0, val)));
  }
  /** How much the lean varies from blade to blade. Blade layers only. */
  get tiltRandomness() {
    return this._bladeShape[5];
  }
  set tiltRandomness(val: number) {
    this.setShape(5, Math.min(1, Math.max(0, val)));
  }
  /**
   * How much the blades arch: 0 keeps them straight, higher values bow the middle up so the tips
   * droop. Blade layers only.
   */
  get bend() {
    return this._bladeShape[6];
  }
  set bend(val: number) {
    this.setShape(6, Math.min(1, Math.max(-1, val)));
  }
  /** How much the arch varies from blade to blade. Blade layers only. */
  get bendRandomness() {
    return this._bladeShape[7];
  }
  set bendRandomness(val: number) {
    this.setShape(7, Math.min(1, Math.max(0, val)));
  }
  /**
   * Typical size of a clump of blades, in world units. Blades of a clump share their height,
   * direction and color, so the field breaks up into patches this big. Blade layers only.
   */
  get clumpSize() {
    return this._bladeShape[8];
  }
  set clumpSize(val: number) {
    this.setShape(8, Math.max(0.01, val));
  }
  /**
   * How much the height changes from clump to clump: 0 keeps every patch the same height,
   * higher values give taller and shorter patches. Blade layers only.
   */
  get clumpHeightVariation() {
    return this._bladeShape[9];
  }
  set clumpHeightVariation(val: number) {
    this.setShape(9, Math.min(1, Math.max(0, val)));
  }
  /**
   * How much the blades of a clump gather toward its center: 0 spreads them evenly, 1 bunches
   * them into tufts. Blade layers only.
   */
  get clumpPull() {
    return this._bladeShape[10];
  }
  set clumpPull(val: number) {
    this.setShape(10, Math.min(1, Math.max(0, val)));
  }
  /**
   * How much the blades of a clump lean the same way: 0 lets each blade face its own random way,
   * 1 combs the whole patch in one direction. Blade layers only.
   */
  get clumpSameDirection() {
    return this._bladeShape[11];
  }
  set clumpSameDirection(val: number) {
    this.setShape(11, Math.min(1, Math.max(0, val)));
  }
  /**
   * How much the blades lean out from the center of their clump, so each patch splays open like a
   * tuft. Blade layers only.
   */
  get clumpFaceAway() {
    return this._bladeShape[12];
  }
  set clumpFaceAway(val: number) {
    this.setShape(12, Math.min(1, Math.max(0, val)));
  }
  /**
   * How much the brightness changes from clump to clump, giving the field a patchy look.
   * Blade layers only.
   */
  get clumpColorVariation() {
    return this.bladeMaterial?.clumpColorVariation ?? 0;
  }
  set clumpColorVariation(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.clumpColorVariation = val;
    }
  }
  /**
   * Optional color texture of the blades: V runs from the root (0) to the tip (1), U picks a
   * column per clump. Replaces the root and tip colors when set. Blade layers only.
   */
  get colorMap(): Nullable<Texture2D> {
    return this.bladeMaterial?.colorMap ?? null;
  }
  set colorMap(val: Nullable<Texture2D>) {
    const material = this.bladeMaterial;
    if (material) {
      material.colorMap = val;
    }
  }
  /**
   * How much the ambient light darkens toward the root, where the neighboring blades hide the
   * sky: 0 lights the whole blade evenly, 1 leaves the root black. Blade layers only.
   */
  get rootOcclusion() {
    return this.bladeMaterial?.rootOcclusion ?? 0;
  }
  set rootOcclusion(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.rootOcclusion = val;
    }
  }
  /**
   * How much the blades narrow toward the tip: 0 keeps them wide to the end, 1 narrows them evenly
   * to a point. Blade layers only.
   */
  get taper() {
    return this.bladeMaterial?.taper ?? 0;
  }
  set taper(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.taper = val;
    }
  }
  /**
   * Spends more of each blade's vertices near the tip, where it curves most. 1 spaces them
   * evenly; higher values give smoother drooping tips. Blade layers only.
   */
  get tipDetail() {
    return this.bladeMaterial?.tipDetail ?? 1;
  }
  set tipDetail(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.tipDetail = val;
    }
  }
  /**
   * How much the blade normals tilt outward across the width, so flat blades shade as if
   * curved. 0 shades them flat. Blade layers only.
   */
  get roundness() {
    return this.bladeMaterial?.roundness ?? 0;
  }
  set roundness(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.roundness = val;
    }
  }
  /**
   * How much blades seen edge-on widen toward the viewer, keeping fields full from low
   * angles. 0 disables it. Blade layers only.
   */
  get viewThickening() {
    return this.bladeMaterial?.viewThickening ?? 0;
  }
  set viewThickening(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.viewThickening = val;
    }
  }
  /**
   * Distance at which the blades start shading as one surface per clump, which calms the
   * glitter of distant fields. Blade layers only.
   */
  get farNormalStart() {
    return this.bladeMaterial?.farNormalStart ?? 0;
  }
  set farNormalStart(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.farNormalStart = val;
    }
  }
  /**
   * Distance beyond which the blades shade fully as one surface per clump. Blade layers only.
   */
  get farNormalEnd() {
    return this.bladeMaterial?.farNormalEnd ?? 0;
  }
  set farNormalEnd(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.farNormalEnd = val;
    }
  }
  /**
   * How dull the highlights of distant blades get, reached at the far normal end distance. Blade layers only.
   */
  get farRoughness() {
    return this.bladeMaterial?.farRoughness ?? 0;
  }
  set farRoughness(val: number) {
    const material = this.bladeMaterial;
    if (material) {
      material.farRoughness = val;
    }
  }
  /**
   * How much the wind turns the blades to lean downwind, per unit of wind push: 0 keeps their own
   * directions, higher values comb the field along the wind. Blade layers only.
   */
  get windFacing() {
    return this._bladeShape[13];
  }
  set windFacing(val: number) {
    this.setShape(13, Math.min(4, Math.max(0, val)));
  }
  /**
   * How far the wind lays the blades over, per unit of wind push: 0 leaves them standing, higher
   * values flatten them in strong gusts.
   */
  get windLean() {
    return this._material.get()!.windLean;
  }
  set windLean(val: number) {
    this._material.get()!.windLean = val;
  }
  /** How far the blade tips bob in the wind, as a fraction of their height per unit of wind push */
  get swayAmplitude() {
    return this._material.get()!.swayAmplitude;
  }
  set swayAmplitude(val: number) {
    const material = this._material.get()!;
    material.swayAmplitude = val;
    this.setShape(14, material.swayAmplitude);
  }
  /**
   * Distance from the camera at which blades switch to their low detail level: a quarter as many
   * blades, each four times as wide and with fewer vertices, blending in over the last quarter of this
   * distance. 0 keeps every blade at high detail up to the draw distance. Blade layers only.
   */
  get lodDistance() {
    return this._bladeShape[15];
  }
  set lodDistance(val: number) {
    val = Math.max(0, Number(val) || 0);
    this.setShape(15, val);
    const material = this.bladeMaterial;
    if (material) {
      material.lodDistance = val;
    }
  }
  /** How fast the blades bob in the wind, in radians per second */
  get swaySpeed() {
    return this._material.get()!.swaySpeed;
  }
  set swaySpeed(val: number) {
    this._material.get()!.swaySpeed = val;
  }
  /** Color at the root of the blades. Blade layers only. */
  get rootColor(): Vector4 {
    return this.bladeMaterial?.rootColor ?? Vector4.one();
  }
  set rootColor(val: Vector4) {
    const material = this.bladeMaterial;
    if (material) {
      material.rootColor = val;
    }
  }
  /** Color at the tip of the blades. Blade layers only. */
  get tipColor(): Vector4 {
    return this.bladeMaterial?.tipColor ?? Vector4.one();
  }
  set tipColor(val: Vector4) {
    const material = this.bladeMaterial;
    if (material) {
      material.tipColor = val;
    }
  }
  /**
   * Color of the light the blades let through when lit from behind, strongest at the tips, so a
   * field glows against a low sun. Black lets no light through. Blade layers only.
   */
  get transmissionColor(): Vector4 {
    return this.bladeMaterial?.transmissionColor ?? Vector4.zero();
  }
  set transmissionColor(val: Vector4) {
    const material = this.bladeMaterial;
    if (material) {
      material.transmissionColor = val;
    }
  }
  /**
   * How many grass blades are currently generated in this layer.
   *
   * Only counts the CPU placement path. Where blades are placed on the GPU (WebGPU) they are
   * generated around the camera every frame and this stays 0.
   */
  get numBlades() {
    return this._numBlades;
  }
  /**
   * Density map of this layer, one byte per texel (0 = no grass, 255 = full density).
   * Texel (x, z) covers the normalized terrain region [x/w..(x+1)/w, z/h..(z+1)/h].
   * After modifying the data, call {@link GrassLayer.updateDensityRegion} to
   * regenerate the affected blade instances.
   */
  get densityMap() {
    return this._densityMap;
  }
  /** Width of the density map in texels */
  get densityMapWidth() {
    return this._densityWidth;
  }
  /** Height of the density map in texels */
  get densityMapHeight() {
    return this._densityHeight;
  }
  /**
   * Number of placement cells per density map texel along each axis.
   * The maximum blade count per texel is the square of this value.
   */
  get cellsPerTexel() {
    return this._cellsPerTexel;
  }
  set cellsPerTexel(val: number) {
    val = Math.max(1, Math.min(MAX_CELLS_PER_TEXEL, val | 0));
    if (val !== this._cellsPerTexel) {
      this._cellsPerTexel = val;
      this.rebuild();
    }
  }
  /**
   * Replaces the density map and regenerates all blade instances
   * @param width - Density map width in texels
   * @param height - Density map height in texels
   * @param cellsPerTexel - Placement cells per texel along each axis
   * @param data - Density data, one byte per texel
   */
  setDensityData(width: number, height: number, cellsPerTexel: number, data: Uint8Array) {
    if (width < 1 || height < 1 || width * height !== data.length) {
      console.error('Invalid grass density data');
      return;
    }
    this._densityWidth = width;
    this._densityHeight = height;
    this._cellsPerTexel = Math.max(1, Math.min(MAX_CELLS_PER_TEXEL, cellsPerTexel | 0));
    this._densityMap = data;
    this.rebuild();
  }
  /**
   * Regenerates blade instances for all tiles overlapping a density map region
   * @param minTexelX - Minimum x texel of the region (inclusive)
   * @param minTexelZ - Minimum z texel of the region (inclusive)
   * @param maxTexelX - Maximum x texel of the region (exclusive)
   * @param maxTexelZ - Maximum z texel of the region (exclusive)
   */
  updateDensityRegion(minTexelX: number, minTexelZ: number, maxTexelX: number, maxTexelZ: number) {
    if (this._kind === 'blade' && !this._gpu) {
      return;
    }
    if (this._gpu) {
      this._gpu.updateDensityRegion(
        this._densityMap,
        this._densityWidth,
        Math.max(0, minTexelX),
        Math.max(0, minTexelZ),
        Math.min(this._densityWidth, maxTexelX),
        Math.min(this._densityHeight, maxTexelZ)
      );
      return;
    }
    const k = this._cellsPerTexel;
    // expand by one texel to cover the bilinear sampling footprint
    const cx0 = Math.max(0, (minTexelX - 1) * k);
    const cz0 = Math.max(0, (minTexelZ - 1) * k);
    const cx1 = Math.min(this._densityWidth * k, (maxTexelX + 1) * k);
    const cz1 = Math.min(this._densityHeight * k, (maxTexelZ + 1) * k);
    if (cx1 <= cx0 || cz1 <= cz0) {
      return;
    }
    const tx0 = Math.floor(cx0 / TILE_CELLS);
    const tz0 = Math.floor(cz0 / TILE_CELLS);
    const tx1 = Math.min(this._tilesX, Math.ceil(cx1 / TILE_CELLS));
    const tz1 = Math.min(this._tilesZ, Math.ceil(cz1 / TILE_CELLS));
    for (let tz = tz0; tz < tz1; tz++) {
      for (let tx = tx0; tx < tx1; tx++) {
        this.generateTile(tx, tz);
      }
    }
  }
  /**
   * Regenerates blade instances for the entire layer
   */
  rebuild() {
    for (const tile of this._tiles.values()) {
      tile.dispose();
    }
    this._tiles.clear();
    this._numBlades = 0;
    this.updateTileGrid();
    if (this._gpu) {
      this._gpu.setDensity(this._densityWidth, this._densityHeight, this._densityMap);
      return;
    }
    if (this._kind === 'blade') {
      return;
    }
    for (let tz = 0; tz < this._tilesZ; tz++) {
      for (let tx = 0; tx < this._tilesX; tx++) {
        this.generateTile(tx, tz);
      }
    }
  }
  /** Grass blade width in this layer */
  get bladeWidth() {
    return this._bladeWidth;
  }
  set bladeWidth(val: number) {
    this.setBladeSize(val, this._bladeHeight);
  }
  /** Grass blade height in this layer */
  get bladeHeight() {
    return this._bladeHeight;
  }
  set bladeHeight(val: number) {
    this.setBladeSize(this._bladeWidth, val);
  }
  /**
   * Sets the size of grass blades in this layer
   * @param width - Grass blade width
   * @param height - Grass blade height
   */
  setBladeSize(width: number, height: number) {
    if (width !== this._bladeWidth || height !== this._bladeHeight) {
      this._bladeWidth = width;
      this._bladeHeight = height;
      if (this._kind === 'blade') {
        this._bladeShape[0] = height;
        this._bladeShape[2] = width;
        return;
      }
      this._baseVertexBuffer.set(this.createBaseVertexBuffer(this._bladeWidth, this._bladeHeight));
      for (const tile of this._tiles.values()) {
        tile.setBaseVertexBuffer(this._baseVertexBuffer.get()!);
      }
      this._gpu?.setBaseVertexBuffer(this._baseVertexBuffer.get()!);
    }
  }
  /** @internal */
  private updateTileGrid() {
    this._tilesX = Math.ceil((this._densityWidth * this._cellsPerTexel) / TILE_CELLS);
    this._tilesZ = Math.ceil((this._densityHeight * this._cellsPerTexel) / TILE_CELLS);
  }
  /** @internal */
  private sampleDensity(u: number, v: number): number {
    const w = this._densityWidth;
    const h = this._densityHeight;
    const x = u * w - 0.5;
    const z = v * h - 0.5;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const x0 = Math.min(Math.max(ix, 0), w - 1);
    const x1 = Math.min(Math.max(ix + 1, 0), w - 1);
    const z0 = Math.min(Math.max(iz, 0), h - 1);
    const z1 = Math.min(Math.max(iz + 1, 0), h - 1);
    const d = this._densityMap;
    const a = d[z0 * w + x0] + (d[z0 * w + x1] - d[z0 * w + x0]) * fx;
    const b = d[z1 * w + x0] + (d[z1 * w + x1] - d[z1 * w + x0]) * fx;
    return (a + (b - a) * fz) * (1 / 255);
  }
  /** @internal */
  private regionIsEmpty(cx0: number, cz0: number, cx1: number, cz1: number): boolean {
    const k = this._cellsPerTexel;
    const x0 = Math.max(0, Math.floor(cx0 / k) - 1);
    const z0 = Math.max(0, Math.floor(cz0 / k) - 1);
    const x1 = Math.min(this._densityWidth, Math.ceil(cx1 / k) + 1);
    const z1 = Math.min(this._densityHeight, Math.ceil(cz1 / k) + 1);
    for (let z = z0; z < z1; z++) {
      const rowBase = z * this._densityWidth;
      for (let x = x0; x < x1; x++) {
        if (this._densityMap[rowBase + x] !== 0) {
          return false;
        }
      }
    }
    return true;
  }
  /** @internal */
  private generateTile(tx: number, tz: number) {
    const k = this._cellsPerTexel;
    const cw = this._densityWidth * k;
    const ch = this._densityHeight * k;
    const cx0 = tx * TILE_CELLS;
    const cz0 = tz * TILE_CELLS;
    const cx1 = Math.min(cx0 + TILE_CELLS, cw);
    const cz1 = Math.min(cz0 + TILE_CELLS, ch);
    const key = tz * this._tilesX + tx;
    let tile = this._tiles.get(key);
    // fast path: nothing to generate if there is no tile yet and no density
    if (!tile && this.regionIsEmpty(cx0, cz0, cx1, cz1)) {
      return;
    }
    const data = GrassLayer._instanceData;
    const seed = this._seed * 4;
    let count = 0;
    for (let cz = cz0; cz < cz1; cz++) {
      for (let cx = cx0; cx < cx1; cx++) {
        const u = (cx + grassHash(cx, cz, seed)) / cw;
        const v = (cz + grassHash(cx, cz, seed + 1)) / ch;
        if (this.sampleDensity(u, v) > grassHash(cx, cz, seed + 2)) {
          const angle = grassHash(cx, cz, seed + 3) * Math.PI * 2;
          data[count * 4 + 0] = u;
          data[count * 4 + 1] = v;
          data[count * 4 + 2] = angle;
          // Density LOD hash, see ClipmapGrassMaterial
          data[count * 4 + 3] = grassHash(cx, cz, seed + 4);
          count++;
        }
      }
    }
    this._numBlades += count - (tile?.numInstances ?? 0);
    if (count === 0) {
      if (tile) {
        tile.dispose();
        this._tiles.delete(key);
      }
    } else {
      if (!tile) {
        tile = new GrassInstances(this._baseVertexBuffer.get()!, GrassLayer._getIndexBuffer()!);
        this._tiles.set(key, tile);
      }
      tile.setData(data, count);
    }
  }
  /** @internal */
  private static _getIndexBuffer() {
    if (!this._indexBuffer.get()) {
      this._indexBuffer.set(
        getDevice().createIndexBuffer(
          new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11])
        )
      );
    }
    return this._indexBuffer.get();
  }
  /** @internal */
  private static _getBladeIndexBuffer() {
    if (!this._bladeIndexBuffer.get()) {
      this._bladeIndexBuffer.set(getDevice().createIndexBuffer(createBladeIndices()));
    }
    return this._bladeIndexBuffer.get();
  }
  /**
   * Procedural blades read nothing from their vertex buffer, but a draw still needs a vertex
   * layout, which one vertex establishes
   * @internal
   */
  private static _getBladeVertexBuffer() {
    if (!this._bladeVertexBuffer.get()) {
      this._bladeVertexBuffer.set(getDevice().createVertexBuffer('position_f32x3', new Float32Array(3))!);
    }
    return this._bladeVertexBuffer.get();
  }
  /** @internal */
  private createBaseVertexBuffer(bladeWidth: number, bladeHeight: number) {
    const device = getDevice();
    const r = bladeWidth * 0.5;
    const t = bladeHeight;
    const c = r * Math.cos(Math.PI / 3);
    const s = r * Math.sin(Math.PI / 3);
    const vertices = new Float32Array([
      r,
      0,
      0,
      0,
      1,
      r,
      t,
      0,
      0,
      0,
      -r,
      t,
      0,
      1,
      0,
      -r,
      0,
      0,
      1,
      1,

      c,
      0,
      s,
      0,
      1,
      -c,
      0,
      -s,
      1,
      1,
      -c,
      t,
      -s,
      1,
      0,
      c,
      t,
      s,
      0,
      0,

      -c,
      0,
      s,
      0,
      1,
      c,
      0,
      -s,
      1,
      1,
      c,
      t,
      -s,
      1,
      0,
      -c,
      t,
      s,
      0,
      0
    ]);
    return device.createInterleavedVertexBuffer(['position_f32x3', 'tex0_f32x2'], vertices);
  }
  /**
   * Places the blades seen from a camera on the GPU path; nothing to do on the CPU one.
   * @param shadowCullPlanes - For each shadow map the blades cast shadows into, the planes
   *   bounding where its casters can be (see GrassRenderer); blade layers only
   * @param shadowFade - View depths over which the shadow casting blades thin out
   * @internal
   */
  updatePerCamera(
    camera: Camera,
    terrain: ClipmapTerrain,
    occlusionMode: GrassOcclusionMode,
    shadowCullPlanes: Float32Array<ArrayBuffer>[],
    shadowFade: Nullable<[number, number]>
  ) {
    if (!this._gpu) {
      return;
    }
    const wind = terrain.scene?.env.wind.shaderParams ?? null;
    const place = (
      target: number,
      mode: GrassOcclusionMode,
      planes: Nullable<Float32Array<ArrayBuffer>>,
      fade: Nullable<[number, number]>
    ) =>
      this._gpu!.generate(
        camera,
        terrain,
        this._seed,
        this._cellsPerTexel,
        this._drawDistance,
        this._bladeWidth,
        this._bladeHeight,
        mode,
        this._farDensity,
        this._bladeShape,
        wind,
        target,
        planes,
        fade
      );
    place(0, occlusionMode, null, null);
    // Target i + 1 holds the casters of shadow map i. Blades hidden behind the terrain from the
    // camera still cast shadows, so these skip the occlusion culling.
    const numShadowTargets = this._kind === 'blade' ? shadowCullPlanes.length : 0;
    for (let i = 0; i < numShadowTargets; i++) {
      place(i + 1, GrassOcclusionMode.Off, shadowCullPlanes[i], shadowFade);
    }
    this._gpu.trimTargets(numShadowTargets + 1);
    this._numShadowTargets = numShadowTargets;
  }
  /**
   * Draws the shadow casters of the shadow map the blades were placed for by the last
   * updatePerCamera() call
   * @param shadowMap - Index of the shadow map
   * @internal
   */
  drawShadow(ctx: DrawContext, shadowMap: number) {
    if (shadowMap < this._numShadowTargets) {
      this.drawGpu(ctx, shadowMap + 1);
    }
  }
  /** @internal */
  setOcclusionDebug(val: boolean) {
    this._material.get()!.occlusionDebug = val;
  }
  /** @internal */
  draw(ctx: DrawContext, region: Vector4, minY: number, maxY: number) {
    if (this._kind === 'blade' && !this._gpu) {
      return;
    }
    if (this._gpu) {
      this.drawGpu(ctx, 0);
      return;
    }
    const wind = ctx.scene?.env.wind ?? null;
    const visible = GrassLayer._visibleTiles;
    visible.length = 0;
    const camera = ctx.camera;
    const cullAABB = GrassLayer._cullAABB;
    const cellsW = this._densityWidth * this._cellsPerTexel;
    const cellsH = this._densityHeight * this._cellsPerTexel;
    const rx = region.x;
    const rz = region.y;
    const rw = region.z - region.x;
    const rh = region.w - region.y;
    const cameraPos = camera.getWorldPosition(GrassLayer._cameraPos);
    const maxDistSq = this._drawDistance > 0 ? this._drawDistance * this._drawDistance : Infinity;
    // The wind can lay the cards over by up to their height
    const windPad = wind && wind.strength > 0 ? this._bladeHeight : 0;
    for (const [key, tile] of this._tiles) {
      const tx = key % this._tilesX;
      const tz = (key - tx) / this._tilesX;
      const u0 = (tx * TILE_CELLS) / cellsW;
      const v0 = (tz * TILE_CELLS) / cellsH;
      const u1 = Math.min(1, ((tx + 1) * TILE_CELLS) / cellsW);
      const v1 = Math.min(1, ((tz + 1) * TILE_CELLS) / cellsH);
      cullAABB.minPoint.setXYZ(rx + u0 * rw - windPad, minY, rz + v0 * rh - windPad);
      cullAABB.maxPoint.setXYZ(rx + u1 * rw + windPad, maxY, rz + v1 * rh + windPad);
      if (distanceSqToAABB(cameraPos.x, cameraPos.y, cameraPos.z, cullAABB) > maxDistSq) {
        continue;
      }
      const clipState = camera.clipMask
        ? cullAABB.getClipStateWithFrustumMask(camera.frustum, camera.clipMask)
        : cullAABB.getClipStateWithFrustum(camera.frustum);
      if (clipState !== ClipState.NOT_CLIPPED) {
        visible.push(tile);
      }
    }
    if (visible.length === 0) {
      return;
    }
    const material = this._material.get()! as ClipmapGrassMaterial;
    material.prepareDraw(wind);
    material.apply(ctx);
    for (let pass = 0; pass < material.numPasses; pass++) {
      material.bind(ctx.device, pass);
      for (const tile of visible) {
        tile.draw();
      }
    }
    visible.length = 0;
  }
  /** Draws the blades placed on the GPU into a target, see GrassGpuPlacement */
  private drawGpu(ctx: DrawContext, target: number) {
    // From the scene, not ctx.env: the depth pass clears ctx.env, and the depth prepass and the
    // light pass must bend the grass by the same wind or the light pass's equal depth test
    // rejects it
    const wind = ctx.scene?.env.wind ?? null;
    const gpu = this._gpu!;
    const material = this._material.get()!;
    if (material instanceof ClipmapBladeGrassMaterial) {
      const instances = gpu.getInstanceBuffer(target);
      if (!instances) {
        return;
      }
      material.setInstanceBuffer(instances, gpu.getLowListBase(target));
      // The camera the blades were placed for, also in the shadow map passes
      material.prepareDraw(ctx.camera, wind);
    } else {
      material.prepareDraw(wind);
    }
    material.apply(ctx);
    for (let pass = 0; pass < material.numPasses; pass++) {
      material.bind(ctx.device, pass);
      gpu.draw(target);
    }
  }
  /** @internal */
  protected onDispose() {
    super.onDispose();
    this._material.dispose();
    for (const tile of this._tiles.values()) {
      tile.dispose();
    }
    this._tiles.clear();
    this._baseVertexBuffer.dispose();
    this._gpu?.dispose();
  }
}
/**
 * Grass renderer for clipmap terrain
 * @public
 */
export class GrassRenderer extends Disposable {
  private static readonly _lightDir = new Vector3();
  private static readonly _forward = new Vector3();
  private static readonly _eye = new Vector3();
  private static readonly _center = new Vector3();
  private static readonly _tmp = new Vector3();
  private static readonly _edge0 = new Vector3();
  private static readonly _edge1 = new Vector3();
  private static readonly _normal = new Vector3();
  private static readonly _corners = Array.from({ length: 8 }, () => new Vector3());
  private static readonly _faceDots = [0, 0, 0, 0, 0, 0];
  private static readonly _facePlane = new Float32Array(4);
  private static readonly _shadowCullPlanes: Float32Array<ArrayBuffer>[] = [];
  private readonly _terrain: DWeakRef<ClipmapTerrain>;
  private _layers: GrassLayer[];
  private _occlusionCulling: boolean;
  private _occlusionDebug: boolean;
  private _suspendOcclusionCulling: boolean;
  private _castShadow: boolean;
  private _shadowFadeFraction: number;
  /** View depths over which the blades casting shadows thin out, see calcShadowCullPlanes */
  private _shadowFade: Nullable<[number, number]>;
  /** The light whose shadow map casters the blades were last placed for */
  private readonly _shadowLight: DWeakRef<DirectionalLight>;
  /**
   * Creates an instance of GrassRenderer
   * @param terrain - Clipmap terrain object
   */
  constructor(terrain: ClipmapTerrain) {
    super();
    this._terrain = new DWeakRef(terrain);
    this._layers = [];
    this._occlusionCulling = true;
    this._occlusionDebug = false;
    this._suspendOcclusionCulling = false;
    this._castShadow = true;
    this._shadowFadeFraction = 0.5;
    this._shadowFade = null;
    this._shadowLight = new DWeakRef();
  }
  /**
   * Whether to skip grass hidden behind the terrain itself (WebGPU only).
   *
   * Tested against the terrain height field every frame, so it never culls grass that is
   * visible, but it does not see occluders other than the terrain.
   */
  get occlusionCulling() {
    return this._occlusionCulling;
  }
  set occlusionCulling(val: boolean) {
    this._occlusionCulling = !!val;
  }
  /**
   * Draws the grass the terrain occlusion culling would skip in red instead of skipping it
   */
  get occlusionDebug() {
    return this._occlusionDebug;
  }
  set occlusionDebug(val: boolean) {
    this._occlusionDebug = !!val;
    for (const layer of this._layers) {
      layer.setOcclusionDebug(this._occlusionDebug);
    }
  }
  /**
   * Pauses the terrain occlusion culling while the height map is being edited, since the
   * height pyramid it relies on is only rebuilt afterwards.
   * @internal
   */
  get suspendOcclusionCulling() {
    return this._suspendOcclusionCulling;
  }
  set suspendOcclusionCulling(val: boolean) {
    this._suspendOcclusionCulling = !!val;
  }
  /** @internal */
  updateMaterial() {
    for (const layer of this._layers) {
      layer.updateMaterial();
    }
  }
  /**
   * Whether procedural blades cast shadows from the sun into the nearest cascades of its shadow
   * map (WebGPU only). Also needs the terrain to cast shadows.
   */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(val: boolean) {
    this._castShadow = !!val;
  }
  /**
   * Fraction of the last shadow cascade the blades cast shadows into over which their shadows
   * fade out toward its far end, blade by blade. 0 ends them on a line at the far end.
   */
  get shadowFadeFraction() {
    return this._shadowFadeFraction;
  }
  set shadowFadeFraction(val: number) {
    this._shadowFadeFraction = Math.min(1, Math.max(0, Number(val) || 0));
  }
  /** @internal */
  updatePerCamera(camera: Camera) {
    const terrain = this._terrain.get();
    if (terrain) {
      const mode =
        !this._occlusionCulling || this._suspendOcclusionCulling
          ? GrassOcclusionMode.Off
          : this._occlusionDebug
            ? GrassOcclusionMode.Debug
            : GrassOcclusionMode.Cull;
      const shadowCullPlanes = this.calcShadowCullPlanes(camera, terrain);
      for (const layer of this._layers) {
        layer.updatePerCamera(camera, terrain, mode, shadowCullPlanes, this._shadowFade);
      }
    }
  }
  /**
   * Culling planes of the blades casting shadows into each of the nearest cascades of the sun's
   * shadow map, and remembers the sun as the light the blades were placed for.
   */
  private calcShadowCullPlanes(camera: Camera, terrain: ClipmapTerrain): Float32Array<ArrayBuffer>[] {
    this._shadowLight.set(null);
    this._shadowFade = null;
    const scene = terrain.scene;
    const sun = scene ? DirectionalLight.getSunLight(scene) : null;
    if (
      !this._castShadow ||
      !terrain.castShadow ||
      !sun ||
      !sun.castShadow ||
      !GrassGpuPlacement.isSupported() ||
      !this._layers.some((layer) => layer.kind === 'blade')
    ) {
      return [];
    }
    this._shadowLight.set(sun);
    const distances = sun.shadow.getCascadeDistances(camera);
    const numCascades = Math.min(GRASS_SHADOW_CASCADES, distances.length - 1);
    // The blades thin out over the far part of the last cascade they cast shadows into, so the
    // shadowed ground does not end on a line at its far split
    const fadeEnd = distances[numCascades];
    const fadeStart = fadeEnd - (fadeEnd - distances[numCascades - 1]) * this._shadowFadeFraction;
    this._shadowFade = fadeEnd > fadeStart ? [fadeStart, fadeEnd] : null;
    // Direction the light travels in
    const lightDir = GrassRenderer._lightDir;
    lightDir.set(sun.directionAndCutoff.xyz());
    lightDir.inplaceNormalize();
    const m = camera.worldMatrix;
    // Camera forward, the view axis the split distances are measured along
    const forward = GrassRenderer._forward.setXYZ(-m.m02, -m.m12, -m.m22).inplaceNormalize();
    const eye = camera.getWorldPosition(GrassRenderer._eye);
    const perspective = camera.isPerspective();
    const nearCorners = camera.frustum.corners;
    const corners = GrassRenderer._corners;
    const center = GrassRenderer._center;
    const tmp = GrassRenderer._tmp;
    const result: Float32Array<ArrayBuffer>[] = [];
    for (let i = 0; i < numCascades; i++) {
      // Corners of the slice, indexed as the frustum corners: x << 2 | y << 1 | far. Each lies on
      // the ray through the matching near plane corner, at the split distance along the view axis.
      center.setXYZ(0, 0, 0);
      for (let c = 0; c < 8; c++) {
        const near = nearCorners[c & 6];
        const d = distances[i + (c & 1)];
        Vector3.sub(near, eye, tmp);
        const depth = Vector3.dot(tmp, forward);
        if (perspective) {
          Vector3.add(eye, Vector3.scale(tmp, d / depth, tmp), corners[c]);
        } else {
          Vector3.add(near, Vector3.scale(forward, d - depth, tmp), corners[c]);
        }
        Vector3.add(center, corners[c], center);
      }
      center.scaleBy(1 / 8);
      // Faces of the slice: the four corners sharing one bit, normals pointing inward
      const faceDots = GrassRenderer._faceDots;
      const planes = (GrassRenderer._shadowCullPlanes[i] ??= new Float32Array(GRASS_CULL_PLANES * 4));
      let numPlanes = 0;
      const addPlane = (a: Vector3, b: Vector3, c: Vector3) => {
        if (numPlanes < GRASS_CULL_PLANES) {
          if (GrassRenderer.planeThrough(a, b, c, center, planes, numPlanes * 4)) {
            numPlanes++;
          }
        }
      };
      for (let face = 0; face < 6; face++) {
        const bit = 1 << (face >> 1);
        const side = face & 1 ? bit : 0;
        const others = [0, 1, 2, 3].map((k) => {
          // The two free bits of the face, in order
          const free = [1, 2, 4].filter((b) => b !== bit);
          return side | (k & 1 ? free[0] : 0) | (k & 2 ? free[1] : 0);
        });
        GrassRenderer.planeThrough(
          corners[others[0]],
          corners[others[1]],
          corners[others[3]],
          center,
          GrassRenderer._facePlane,
          0
        );
        const facePlane = GrassRenderer._facePlane;
        faceDots[face] = facePlane[0] * lightDir.x + facePlane[1] * lightDir.y + facePlane[2] * lightDir.z;
        // Faces the light travels away from, or along, bound the swept slice
        if (faceDots[face] <= 0 && numPlanes < GRASS_CULL_PLANES) {
          planes.set(facePlane, numPlanes * 4);
          numPlanes++;
        }
      }
      // Silhouette edges: shared by a face kept and a face dropped. Two faces are adjacent when
      // they fix different corner bits; their edge is the two corners with both bits fixed.
      for (let fa = 0; fa < 6; fa++) {
        for (let fb = fa + 1; fb < 6; fb++) {
          const bitA = 1 << (fa >> 1);
          const bitB = 1 << (fb >> 1);
          const keptA = faceDots[fa] <= 0;
          const keptB = faceDots[fb] <= 0;
          if (bitA === bitB || keptA === keptB) {
            continue;
          }
          const fixed = (fa & 1 ? bitA : 0) | (fb & 1 ? bitB : 0);
          const freeBit = 7 & ~bitA & ~bitB;
          const a = corners[fixed];
          const b = corners[fixed | freeBit];
          // The third point extends the edge along the light, scaled by the edge length for
          Vector3.add(a, Vector3.scale(lightDir, Vector3.distance(a, b), tmp), tmp);
          addPlane(a, b, tmp);
        }
      }
      // The rest are planes everything is inside of
      for (let k = numPlanes; k < GRASS_CULL_PLANES; k++) {
        planes.set([0, 0, 0, 1e30], k * 4);
      }
      result.push(planes);
    }
    return result;
  }
  /**
   * Writes the plane through three points, normal turned toward an inside point, as (a, b, c, d)
   * at an offset of an array
   * @returns false if the points are degenerate
   */
  private static planeThrough(
    p0: Vector3,
    p1: Vector3,
    p2: Vector3,
    inside: Vector3,
    out: Float32Array,
    offset: number
  ) {
    const e0 = Vector3.sub(p1, p0, GrassRenderer._edge0);
    const e1 = Vector3.sub(p2, p0, GrassRenderer._edge1);
    const n = Vector3.cross(e0, e1, GrassRenderer._normal);
    const len = n.magnitude;
    if (len < 1e-12) {
      return false;
    }
    n.scaleBy(1 / len);
    let d = -Vector3.dot(n, p0);
    if (Vector3.dot(n, inside) + d < 0) {
      n.scaleBy(-1);
      d = -d;
    }
    out[offset] = n.x;
    out[offset + 1] = n.y;
    out[offset + 2] = n.z;
    out[offset + 3] = d;
    return true;
  }
  /** How many grass blades */
  get numGrassBlades() {
    return this._layers.reduce((sum, layer) => sum + layer.numBlades, 0);
  }
  /** How many grass layers */
  get numLayers() {
    return this._layers.length;
  }
  /**
   * Gets the grass layer at given index
   * @param index - Index of the grass layer
   * @returns The grass layer at the index
   */
  getLayer(index: number) {
    return this._layers[index];
  }
  /**
   * Adds a grass layer
   * @param bladeWidth - Width of grass blades in this layer
   * @param bladeHeight - Height of grass blades in this layer
   * @param albedoMap - Albedo texture of grass blades in this layer, card layers only
   * @param kind - Textured cards (default), or procedural blades drawn on WebGPU only
   * @returns Index of the added grass layer
   */
  addLayer(
    bladeWidth: number,
    bladeHeight: number,
    albedoMap?: Nullable<Texture2D>,
    kind: GrassLayerKind = 'card'
  ) {
    const layer = new GrassLayer(
      this._terrain.get()!,
      this._layers.length,
      bladeWidth,
      bladeHeight,
      albedoMap,
      kind
    );
    layer.setOcclusionDebug(this._occlusionDebug);
    this._layers.push(layer);
    return this._layers.length - 1;
  }
  /**
   * Gets the albedo texture of grass blades in the grass layer at given index
   * @param layer - Index of the grass layer to get
   * @returns Albedo texture of grass blades in the grass layer
   */
  getGrassTexture(layer: number) {
    return this._layers[layer]?.getAlbedoMap() ?? null;
  }
  /**
   * Sets the albedo texture of grass blades in the grass layer at given index
   * @param layer - Index of the grass layer to set
   * @param texture - Albedo texture to set
   */
  setGrassTexture(layer: number, texture: Texture2D) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.setAlbedoMap(texture);
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  /**
   * Gets the draw distance of the grass layer at given index
   * @param layer - Index of the grass layer
   * @returns Distance from the camera beyond which the layer is not drawn, 0 for unlimited
   */
  getDrawDistance(layer: number) {
    return this._layers[layer]?.drawDistance ?? 0;
  }
  /**
   * Sets the draw distance of the grass layer at given index
   * @param layer - Index of the grass layer
   * @param distance - Distance from the camera beyond which the layer is not drawn, 0 for unlimited
   */
  setDrawDistance(layer: number, distance: number) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.drawDistance = distance;
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  /**
   * Gets the fraction of blades kept at the draw distance for the grass layer at given index
   * @param layer - Index of the grass layer
   * @returns Fraction of blades drawn at the draw distance, see GrassLayer.farDensity
   */
  getFarDensity(layer: number) {
    return this._layers[layer]?.farDensity ?? 1;
  }
  /**
   * Sets the fraction of blades kept at the draw distance for the grass layer at given index
   * @param layer - Index of the grass layer
   * @param farDensity - Fraction of blades drawn at the draw distance, see GrassLayer.farDensity
   */
  setFarDensity(layer: number, farDensity: number) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.farDensity = farDensity;
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  /**
   * Gets width of the grass blades in the grass layer at given index
   * @param layer - Index of the grass layer
   * @returns Width of the grass blades in the layer
   */
  getBladeWidth(layer: number) {
    return this._layers[layer]?.bladeWidth ?? 0;
  }
  /**
   * Gets height of the grass blades in the grass layer at given index
   * @param layer - Index of the grass layer
   * @returns Height of the grass blades in the layer
   */
  getBladeHeight(layer: number) {
    return this._layers[layer]?.bladeHeight ?? 0;
  }
  /**
   * Sets size of the grass blades in the grass layer at given index
   * @param layer - Index of the grass layer
   * @param width - Width to set
   * @param height - Height to set
   */
  setBladeSize(layer: number, width: number, height: number) {
    const grassLayer = this._layers[layer];
    if (grassLayer) {
      grassLayer.setBladeSize(width, height);
    } else {
      console.error(`Invalid grass layer: ${layer}`);
    }
  }
  /** @internal */
  draw(ctx: DrawContext) {
    if (ctx.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP) {
      // Only into the cascades of the light the blades were placed for
      const light = (ctx.renderPass as ShadowMapPass).light;
      if (light && light === this._shadowLight.get()) {
        const cascade = ctx.shadowMapInfo?.get(light)?.cascadeIndex ?? 0;
        for (const layer of this._layers) {
          layer.drawShadow(ctx, cascade);
        }
      }
      return;
    }
    const bv = this._terrain.get()!.getWorldBoundingVolume()!.toAABB();
    const minY = bv.minPoint.y;
    const maxY = bv.maxPoint.y;
    for (const layer of this._layers) {
      layer.draw(ctx, this._terrain.get()!.worldRegion, minY - layer.bladeHeight, maxY + layer.bladeHeight);
    }
  }
  protected onDispose() {
    super.onDispose();
    this._terrain.dispose();
    this._shadowLight.dispose();
    for (const layer of this._layers) {
      layer.dispose();
    }
  }
}
