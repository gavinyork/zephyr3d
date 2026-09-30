import type {
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  IndexBuffer,
  PBInsideFunctionScope,
  PBShaderExp,
  StructuredBuffer,
  Texture2D
} from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Disposable, DRef, nextPowerOf2, Vector3, Vector4 } from '@zephyr3d/base';
import type { Camera } from '../../camera';
import { Primitive } from '../../render';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import type { ClipmapTerrain } from './terrain-cm';
import { WindField } from '../wind';

const WORKGROUP_SIZE = 8;
/**
 * Largest placement window side, in cells. Bounds the per-frame work and the instance buffer
 * when the draw distance is unlimited or the cells are tiny.
 */
const MAX_WINDOW_CELLS = 2048;
/**
 * Width of the band, in density LOD hash units, over which a blade shrinks before the density
 * LOD drops it. Hashes are scaled into [0, 1 - band) so that full density keeps every blade whole.
 * @internal
 */
export const GRASS_LOD_FADE_BAND = 0.05;
/** Fraction of the draw distance at which the density starts to fall */
const GRASS_LOD_START = 0.25;
/**
 * Density LOD parameters shared by the grass material and the GPU placement: (distance at which
 * the density starts to fall, fraction of blades kept at the draw distance). A fraction of 1
 * disables it.
 * @internal
 */
export function grassDensityLod(drawDistance: number, farDensity: number): [number, number] {
  if (drawDistance <= 0 || farDensity >= 1) {
    return [0, 1];
  }
  return [drawDistance * GRASS_LOD_START, Math.max(0.01, farDensity)];
}
/**
 * Kind of blades a grass layer draws: textured cards, or procedural Bezier blades (WebGPU only)
 * @public
 */
export type GrassLayerKind = 'card' | 'blade';
/** Vec4 per instance written by the placement pass for each layer kind */
const INSTANCE_VEC4: Record<GrassLayerKind, number> = { card: 1, blade: 4 };
/** Seed offset of the procedural blade hashes, clear of the card hashes of every layer */
const BLADE_SEED_BASE = 65536;
/** Number of floats in GrassBladeShape */
export const GRASS_BLADE_SHAPE_SIZE = 16;
/**
 * Procedural blade parameters sent to the placement pass, 16 floats:
 * - [0, 8): height, height randomness, width, width randomness, tilt, tilt randomness, bend,
 *   bend randomness. Height and width randomness are fractions of the base value, tilt and bend
 *   randomness absolute amounts, each applied as base + randomness * [-1, 1).
 * - [8, 13): clump size, clump height variation, pull toward the clump point, same direction
 *   within a clump, facing away from the clump point.
 * - [13, 15): how far the wind turns the blades downwind per unit of push, sway amplitude (as a
 *   fraction of the height, only used to pad the culling bounds).
 * - [15]: distance at which blades switch to the low detail level, see grassBladeLodDistance.
 * @internal
 */
export type GrassBladeShape = Float32Array<ArrayBuffer>;
/**
 * Fraction of the low detail distance over which the near blades make way for the far ones:
 * three in four shrink away, the fourth widens and morphs into the low detail shape. The same
 * last-quarter band as the draw distance fade.
 * @internal
 */
export const GRASS_BLADE_LOD_BAND = 0.25;
/** Stand-in for an unlimited distance in shader uniforms */
const NO_LIMIT = 1e30;
/**
 * Distance at which procedural blades switch to the low detail level, or NO_LIMIT when they never
 * do: zero disables the low detail level, and so does a distance past the draw distance.
 * @internal
 */
export function grassBladeLodDistance(lodDistance: number, drawDistance: number) {
  return lodDistance > 0 && (drawDistance <= 0 || lodDistance < drawDistance) ? lodDistance : NO_LIMIT;
}
/** Samples along the line of sight of the terrain occlusion test, one per workgroup thread */
const OCCLUSION_SAMPLES = WORKGROUP_SIZE * WORKGROUP_SIZE;

/**
 * Terrain occlusion culling mode of the GPU grass placement
 * @internal
 */
export const GrassOcclusionMode = {
  Off: 0,
  Cull: 1,
  /** Keep occluded blades but flag them, see ClipmapGrassMaterial.occlusionDebug */
  Debug: 2
} as const;
/** @internal */
export type GrassOcclusionMode = (typeof GrassOcclusionMode)[keyof typeof GrassOcclusionMode];

/**
 * Grass blade placement hash, shared by the CPU and GPU paths.
 *
 * Returns a value in [0, 1) with 24 bits of precision: that is all a float32 can hold, so
 * keeping the CPU side to the same bits makes both paths place exactly the same blades.
 *
 * @internal
 */
export function grassHash(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/**
 * GPU placement and culling of the blades of one grass layer (WebGPU with indirect draw only).
 *
 * Blade placement is procedural - a hash per placement cell and a bilinear density lookup - so
 * instead of keeping instances for the whole terrain, a compute pass evaluates the cells around
 * the camera every frame, keeps the blades inside the frustum and the draw distance, and appends
 * them to an instance buffer whose count lands in an indirect draw argument buffer.
 *
 * The output uses the instance format of the CPU path (u, v, facing angle, density LOD hash), so the grass material
 * is shared. Each dispatched thread emits at most one blade and the instance buffer holds one
 * per thread, so the output can never overflow.
 *
 * Procedural blades have two detail levels, after "Procedural Grass in Ghost of Tsushima"
 * (Wohllaib, GDC 2021): low detail blades are spaced twice as far apart, and the high detail
 * blades thin out by three quarters before the switch so the two meet seamlessly. Here the
 * dispatch has two layers: z = 0 places a blade per cell around the camera, up to the low detail
 * distance, into the high detail list; z = 1 places one blade per 2x2 block of cells beyond it
 * into the low detail list. The blade kept for a block is one of its four cells picked by a
 * hash, placed exactly as the near layer places it, so a blade moving from one list to the other
 * stays where it is. Both lists share the instance buffer, the low one from `lowListBase` on,
 * and each has its own indirect draw arguments.
 *
 * @internal
 */
export class GrassGpuPlacement extends Disposable {
  private static readonly _programs: Partial<Record<GrassLayerKind, GPUProgram>> = {};
  private static readonly _cameraPos = new Vector3();
  private static readonly _planes = new Float32Array(24);
  private readonly _densityTexture: DRef<Texture2D>;
  private readonly _kind: GrassLayerKind;
  private readonly _instanceBuffer: DRef<GPUDataBuffer>;
  private readonly _argsBuffer: DRef<GPUDataBuffer>;
  private readonly _bindGroup: DRef<BindGroup>;
  private readonly _primitive: DRef<Primitive>;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private readonly _shape0: Vector4;
  private readonly _shape1: Vector4;
  private readonly _clump0: Vector4;
  private readonly _clump1: Vector4;
  private static readonly _calmWind = new Float32Array(32);
  private readonly _indexBuffer: DRef<IndexBuffer>;
  private readonly _args: Uint32Array<ArrayBuffer>;
  /** Index count of each detail level; they follow each other in the index buffer */
  private readonly _lodIndexCounts: number[];
  private readonly _window: Vector4;
  /** Far window, in 2x2 blocks of cells (procedural blades only) */
  private readonly _window2: Vector4;
  /** (low detail distance, first instance of the low detail list, unused, unused) */
  private readonly _lod: Vector4;
  private readonly _cells: Vector4;
  private readonly _params: Vector4;
  private readonly _posScale: Vector4;
  private readonly _camera: Vector4;
  private readonly _occlusion: Vector4;
  private readonly _heightInfo: Vector4;
  private readonly _densityLod: Vector4;
  private _capacity: number;
  /**
   * Whether the current device can run the GPU path
   */
  static isSupported() {
    const device = getDevice();
    return device.type === 'webgpu' && device.getDeviceCaps().miscCaps.supportDrawIndirect;
  }
  /**
   * @param kind - Kind of blades placed
   * @param baseVertexBuffer - Vertex buffer of the drawn blade. Procedural blades read nothing
   *   from it; a draw still needs a vertex layout.
   * @param indexBuffer - Index buffer of the drawn blade
   * @param lodIndexCounts - Index count of each detail level, which follow each other in the index
   *   buffer. Procedural blades have two; defaults to the whole buffer as one level.
   */
  constructor(
    kind: GrassLayerKind,
    baseVertexBuffer: StructuredBuffer,
    indexBuffer: IndexBuffer,
    lodIndexCounts?: number[]
  ) {
    super();
    this._kind = kind;
    this._lodIndexCounts = lodIndexCounts ?? [indexBuffer.length];
    this._shape0 = new Vector4();
    this._shape1 = new Vector4();
    this._clump0 = new Vector4();
    this._clump1 = new Vector4();
    this._densityTexture = new DRef();
    this._instanceBuffer = new DRef();
    // Five draw arguments per detail level
    const numArgs = this._lodIndexCounts.length * 5;
    this._argsBuffer = new DRef(getDevice().createBuffer(numArgs * 4, { usage: 'indirect', storage: true }));
    this._bindGroup = new DRef();
    this._primitive = new DRef();
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._args = new Uint32Array(numArgs);
    this._window = new Vector4();
    this._window2 = new Vector4();
    this._lod = new Vector4();
    this._cells = new Vector4();
    this._params = new Vector4();
    this._posScale = new Vector4();
    this._camera = new Vector4();
    this._occlusion = new Vector4();
    this._heightInfo = new Vector4();
    this._densityLod = new Vector4();
    this._capacity = 0;
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._primitive.dispose();
    }
  }
  /**
   * Uploads the whole density map, recreating the texture when its size changed
   * @param width - Density map width in texels
   * @param height - Density map height in texels
   * @param data - Density data, one byte per texel
   */
  setDensity(width: number, height: number, data: Uint8Array) {
    let tex = this._densityTexture.get();
    if (!tex || tex.width !== width || tex.height !== height) {
      tex = getDevice().createTexture2D('r8unorm', width, height, { mipmapping: false })!;
      tex.name = 'GrassDensity';
      this._densityTexture.set(tex);
      this._bindGroup.dispose();
    }
    // Texture uploads take views of plain array buffers only
    const bytes =
      data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);
    tex.update(bytes, 0, 0, width, height);
  }
  /**
   * Uploads a rectangle of the density map
   * @param data - The whole density map, one byte per texel
   * @param width - Density map width in texels
   * @param x0 - Minimum x texel (inclusive)
   * @param z0 - Minimum z texel (inclusive)
   * @param x1 - Maximum x texel (exclusive)
   * @param z1 - Maximum z texel (exclusive)
   */
  updateDensityRegion(data: Uint8Array, width: number, x0: number, z0: number, x1: number, z1: number) {
    const tex = this._densityTexture.get();
    if (!tex || x1 <= x0 || z1 <= z0) {
      return;
    }
    const w = x1 - x0;
    const h = z1 - z0;
    const rect = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) {
      rect.set(data.subarray((z0 + z) * width + x0, (z0 + z) * width + x1), z * w);
    }
    tex.update(rect, x0, z0, w, h);
  }
  /**
   * Places and culls the blades seen from a camera. Runs a compute pass, so it must be called
   * outside of render passes, before the draws that consume the result.
   */
  generate(
    camera: Camera,
    terrain: ClipmapTerrain,
    seed: number,
    cellsPerTexel: number,
    drawDistance: number,
    bladeWidth: number,
    bladeHeight: number,
    occlusionMode: GrassOcclusionMode,
    farDensity: number,
    bladeShape?: GrassBladeShape,
    windParams?: Nullable<Float32Array<ArrayBuffer>>
  ) {
    const density = this._densityTexture.get();
    const heightMap = terrain.heightMap;
    // Draw arguments of each detail level, whose indices follow each other: (index count,
    // instance count, first index, base vertex, first instance)
    let firstIndex = 0;
    for (let i = 0; i < this._lodIndexCounts.length; i++) {
      this._args.set([this._lodIndexCounts[i], 0, firstIndex, 0, 0], i * 5);
      firstIndex += this._lodIndexCounts[i];
    }
    this._argsBuffer.get()!.bufferSubData(0, this._args);
    if (!density || !heightMap) {
      return;
    }
    const blade = this._kind === 'blade' && !!bladeShape;
    const region = terrain.worldRegion;
    const cellsW = density.width * cellsPerTexel;
    const cellsH = density.height * cellsPerTexel;
    const cellSizeX = (region.z - region.x) / cellsW;
    const cellSizeZ = (region.w - region.y) / cellsH;
    const cameraPos = camera.getWorldPosition(GrassGpuPlacement._cameraPos);
    const centerX = (cameraPos.x - region.x) / cellSizeX;
    const centerZ = (cameraPos.z - region.y) / cellSizeZ;
    const drawRadius = drawDistance > 0 ? drawDistance : Infinity;
    // Near window: cells within the draw distance, or within the low detail distance of blades
    // that have one; far window: 2x2 blocks of cells from there on to the draw distance
    const lodDistance = blade ? grassBladeLodDistance(bladeShape[15], drawDistance) : NO_LIMIT;
    const nearRadius = Math.min(drawRadius, lodDistance);
    const near = GrassGpuPlacement.cellWindow(
      centerX,
      centerZ,
      nearRadius / cellSizeX,
      nearRadius / cellSizeZ,
      cellsW,
      cellsH,
      1
    );
    const far =
      lodDistance < NO_LIMIT && lodDistance < drawRadius
        ? GrassGpuPlacement.cellWindow(
            centerX,
            centerZ,
            drawRadius / cellSizeX,
            drawRadius / cellSizeZ,
            cellsW,
            cellsH,
            2
          )
        : [0, 0, 0, 0];
    const nearCount = near[2] * near[3];
    const farCount = far[2] * far[3];
    if (nearCount <= 0 && farCount <= 0) {
      return;
    }
    // Each list holds at most one blade per thread of its layer
    this.ensureCapacity(Math.max(nearCount, farCount));
    const bindGroup = this.getBindGroup();
    this._window.setXYZW(near[0], near[1], near[2], near[3]);
    this._window2.setXYZW(far[0], far[1], far[2], far[3]);
    this._lod.setXYZW(lodDistance, this._capacity, 0, 0);
    this._cells.setXYZW(cellsW, cellsH, density.width, density.height);
    // Bounding sphere of a blade, centred halfway up; the density LOD widens distant blades
    const lod = grassDensityLod(drawDistance, farDensity);
    this._densityLod.setXYZW(lod[0], lod[1], 0, 0);
    if (blade) {
      // A blade reaches at most its tallest height from its base in any direction, plus half its
      // width, which grows fourfold toward the low detail level
      const maxHeight =
        bladeShape[0] * (1 + Math.abs(bladeShape[1])) * (1 + Math.abs(bladeShape[9])) * (1 + bladeShape[14]);
      const maxWidth = bladeShape[2] * (1 + Math.abs(bladeShape[3])) * 4;
      this._shape0.setXYZW(bladeShape[0], bladeShape[1], bladeShape[2], bladeShape[3]);
      this._shape1.setXYZW(bladeShape[4], bladeShape[5], bladeShape[6], bladeShape[7]);
      this._clump0.setXYZW(1 / Math.max(1e-3, bladeShape[8]), bladeShape[9], bladeShape[10], bladeShape[11]);
      this._clump1.setXYZW(bladeShape[12], bladeShape[13], 0, 0);
      this._params.setXYZW(seed * 4, drawDistance, maxHeight + maxWidth * 0.5, 0);
      bladeHeight = maxHeight;
    } else {
      const maxWidth = bladeWidth / lod[1];
      // The wind turns a card about its base, which takes its top up to 1.12 times its height
      // from the centre of the card
      const radius =
        windParams && windParams[2] > 0
          ? maxWidth * 0.5 + bladeHeight * 1.12
          : Math.sqrt(maxWidth * maxWidth * 0.25 + bladeHeight * bladeHeight * 0.25);
      this._params.setXYZW(seed * 4, drawDistance, radius, bladeHeight * 0.5);
    }
    this._posScale.setXYZW(terrain.scale.x, terrain.scale.y, terrain.scale.z, terrain.worldMatrix.m13);
    this._camera.setXYZW(cameraPos.x, cameraPos.y, cameraPos.z, 0);
    // Terrain occlusion needs the height pyramid, and heights that grow upwards
    const pyramid = terrain.heightPyramid;
    const occlusion = pyramid && terrain.scale.y > 0 ? occlusionMode : GrassOcclusionMode.Off;
    const bounds = terrain.getWorldBoundingVolume()?.toAABB();
    // Absorbs half float and interpolation error in the heights
    const epsilon = bounds ? (bounds.maxPoint.y - bounds.minPoint.y) * 1e-3 + 1e-4 : 1e-3;
    this._occlusion.setXYZW(occlusion, terrain.clipmapTileResolution, epsilon, bladeHeight);
    this._heightInfo.setXYZW(
      heightMap.width,
      heightMap.height,
      pyramid?.mipLevelCount ?? 1,
      Math.max((region.z - region.x) / heightMap.width, (region.w - region.y) / heightMap.height)
    );
    // Planes masked out by the camera become ones everything is inside of
    const planes = GrassGpuPlacement._planes;
    const frustumPlanes = camera.frustum.planes;
    const mask = camera.clipMask || 0x3f;
    for (let i = 0; i < 6; i++) {
      const p = frustumPlanes[i];
      const enabled = !!(mask & (1 << i));
      planes[i * 4 + 0] = enabled ? p.a : 0;
      planes[i * 4 + 1] = enabled ? p.b : 0;
      planes[i * 4 + 2] = enabled ? p.c : 0;
      planes[i * 4 + 3] = enabled ? p.d : 1e30;
    }
    bindGroup.setValue('window', this._window);
    bindGroup.setValue('cells', this._cells);
    bindGroup.setValue('params', this._params);
    bindGroup.setValue('region', region);
    bindGroup.setValue('posScale', this._posScale);
    bindGroup.setValue('cameraPos', this._camera);
    bindGroup.setValue('planes', planes);
    bindGroup.setValue('occlusion', this._occlusion);
    bindGroup.setValue('densityLod', this._densityLod);
    bindGroup.setValue('heightInfo', this._heightInfo);
    if (this._kind === 'blade') {
      bindGroup.setValue('window2', this._window2);
      bindGroup.setValue('lod', this._lod);
      bindGroup.setValue('shape0', this._shape0);
      bindGroup.setValue('shape1', this._shape1);
      bindGroup.setValue('clump0', this._clump0);
      bindGroup.setValue('clump1', this._clump1);
      bindGroup.setValue('wind', windParams ?? GrassGpuPlacement._calmWind);
    }
    // Any texture of the right sample type does when occlusion is off. Declared unfilterable
    // (read with textureLoad only), so the sampler bound with it must be a non-filtering one
    // whatever the texture's default is: rg32f counts as filterable where the device has
    // float32-filterable.
    bindGroup.setTexture(
      'heightPyramid',
      pyramid ?? GrassGpuPlacement.getDummyPyramid(),
      fetchSampler('clamp_nearest_nomip')
    );
    bindGroup.setTexture('density', density);
    bindGroup.setTexture('heightMap', heightMap, fetchSampler('clamp_linear_nomip'));
    const device = getDevice();
    device.setProgram(GrassGpuPlacement.getProgram(this._kind));
    device.setBindGroup(0, bindGroup);
    // The far layer, when there is one, runs as z = 1 of the same dispatch
    device.compute(
      Math.ceil(Math.max(near[2], far[2]) / WORKGROUP_SIZE),
      Math.ceil(Math.max(near[3], far[3]) / WORKGROUP_SIZE),
      farCount > 0 ? 2 : 1
    );
  }
  /**
   * Window of placement units within a radius of a point, clipped to the grid and to
   * MAX_WINDOW_CELLS units a side: (first x, first z, units wide, units high)
   * @param centerX - Point x, in cells
   * @param centerZ - Point z, in cells
   * @param radiusX - Radius along x, in cells
   * @param radiusZ - Radius along z, in cells
   * @param cellsW - Grid width, in cells
   * @param cellsH - Grid height, in cells
   * @param unit - Placement unit side, in cells
   */
  private static cellWindow(
    centerX: number,
    centerZ: number,
    radiusX: number,
    radiusZ: number,
    cellsW: number,
    cellsH: number,
    unit: number
  ): [number, number, number, number] {
    const halfMax = MAX_WINDOW_CELLS / 2;
    const cx = centerX / unit;
    const cz = centerZ / unit;
    const rx = Math.min(radiusX / unit, halfMax);
    const rz = Math.min(radiusZ / unit, halfMax);
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(Math.ceil(cellsW / unit), Math.ceil(cx + rx));
    const z0 = Math.max(0, Math.floor(cz - rz));
    const z1 = Math.min(Math.ceil(cellsH / unit), Math.ceil(cz + rz));
    return [x0, z0, Math.max(0, x1 - x0), Math.max(0, z1 - z0)];
  }
  /** Instance buffer written by the last generate() call */
  get instanceBuffer() {
    return this._instanceBuffer.get();
  }
  /**
   * First instance of the low detail list in the instance buffer (procedural blades only); the
   * high detail list starts at 0
   */
  get lowListBase() {
    return this._capacity;
  }
  /** Draws the blades of the last generate() call; the material must be bound */
  draw() {
    let primitive = this._primitive.get();
    if (!primitive) {
      const instanceBuffer = this._instanceBuffer.get();
      if (!instanceBuffer) {
        return;
      }
      primitive = new Primitive();
      primitive.setVertexBuffer(this._baseVertexBuffer.get()!);
      if (this._kind === 'card') {
        primitive.setVertexBuffer(instanceBuffer as StructuredBuffer, 'instance');
      }
      primitive.setIndexBuffer(this._indexBuffer.get());
      primitive.primitiveType = 'triangle-list';
      primitive.indexStart = 0;
      primitive.indexCount = this._indexBuffer.get()!.length;
      this._primitive.set(primitive);
    }
    // One draw per detail level; the arguments pick its range of the index buffer
    for (let i = 0; i < this._lodIndexCounts.length; i++) {
      primitive.drawIndirect(this._argsBuffer.get()!, i * 20);
    }
  }
  private ensureCapacity(numInstances: number) {
    if (numInstances > this._capacity) {
      this._capacity = nextPowerOf2(numInstances);
      const device = getDevice();
      const buffer =
        this._kind === 'card'
          ? device.createVertexBuffer('tex1_f32x4', new Float32Array(this._capacity * 4), {
              storage: true
            })!
          : // The high and the low detail lists, each of the capacity
            device.createBuffer(this._capacity * 2 * INSTANCE_VEC4.blade * 16, {
              usage: 'uniform',
              storage: true,
              dynamic: false,
              managed: false
            });
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
      this._bindGroup.dispose();
    }
  }
  private getBindGroup() {
    let bindGroup = this._bindGroup.get();
    if (!bindGroup) {
      bindGroup = getDevice().createBindGroup(GrassGpuPlacement.getProgram(this._kind).bindGroupLayouts[0]);
      bindGroup.setBuffer('instances', this._instanceBuffer.get()!);
      bindGroup.setBuffer('args', this._argsBuffer.get()!);
      this._bindGroup.set(bindGroup);
    }
    return bindGroup;
  }
  private static _dummyPyramid: Nullable<Texture2D> = null;
  private static getDummyPyramid() {
    if (!this._dummyPyramid) {
      this._dummyPyramid = getDevice().createTexture2D('rg32f', 1, 1, { mipmapping: false })!;
      this._dummyPyramid.update(new Float32Array(2), 0, 0, 1, 1);
    }
    return this._dummyPyramid;
  }
  private static getProgram(kind: GrassLayerKind) {
    let program = this._programs[kind];
    if (!program) {
      const blade = kind === 'blade';
      program = getDevice().buildComputeProgram({
        label: blade ? 'GrassBladePlacement' : 'GrassPlacement',
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE, 1],
        compute(pb) {
          // (first cell x, first cell z, cells wide, cells high)
          this.window = pb.vec4().uniform(0);
          // (cells x, cells z, density width, density height)
          this.cells = pb.vec4().uniform(0);
          // (seed, draw distance, blade bounding radius, blade centre height)
          this.params = pb.vec4().uniform(0);
          this.region = pb.vec4().uniform(0);
          // (terrain scale xyz, terrain origin y)
          this.posScale = pb.vec4().uniform(0);
          this.cameraPos = pb.vec4().uniform(0);
          this.planes = pb.vec4[6]().uniform(0);
          // (mode, clipmap tile resolution, height epsilon, blade height)
          this.occlusion = pb.vec4().uniform(0);
          // (density falloff start distance, density at the draw distance, unused, unused)
          this.densityLod = pb.vec4().uniform(0);
          // (height map width, height map height, pyramid mip count, grid cell size)
          this.heightInfo = pb.vec4().uniform(0);
          if (blade) {
            // Far window: (first block x, first block z, blocks wide, blocks high), 2x2 cells a block
            this.window2 = pb.vec4().uniform(0);
            // (low detail distance, first instance of the low detail list, unused, unused)
            this.lod = pb.vec4().uniform(0);
            // See GrassBladeShape
            this.shape0 = pb.vec4().uniform(0);
            this.shape1 = pb.vec4().uniform(0);
            // (1 / clump size, height variation, pull to the clump point, same direction)
            this.clump0 = pb.vec4().uniform(0);
            // (face away from the clump point, wind facing, unused, unused)
            this.clump1 = pb.vec4().uniform(0);
            // Scene wind, current frame then previous frame, see WindField.shaderParams
            this.wind = pb.vec4[8]().uniform(0);
          }
          this.heightPyramid = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.occludedFlag = pb.atomic_uint().workgroup();
          this.density = pb.tex2D().uniform(0);
          this.heightMap = pb.tex2D().uniform(0);
          this.instances = pb.vec4[0]().storageBuffer(0);
          this.args = pb.atomic_uint[0]().storageBuffer(0);
          // See grassHash(); unsigned integer arithmetic wraps like Math.imul
          pb.func('grassHash', [pb.uint('x'), pb.uint('z'), pb.uint('s')], function () {
            this.$l.h = pb.compXor(
              pb.compXor(pb.mul(this.x, pb.uint(0x27d4eb2d)), pb.mul(this.z, pb.uint(0x165667b1))),
              pb.mul(this.s, pb.uint(0x9e3779b9))
            );
            this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 15)), pb.uint(0x85ebca6b));
            this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 13)), pb.uint(0xc2b2ae35));
            this.h = pb.compXor(this.h, pb.sar(this.h, 16));
            this.$return(pb.mul(pb.float(pb.sar(this.h, 8)), 1 / 16777216));
          });
          // Bilinear density, the same filtering as GrassLayer.sampleDensity()
          pb.func('sampleDensity', [pb.vec2('uv')], function () {
            this.$l.size = this.cells.zw;
            this.$l.p = pb.sub(pb.mul(this.uv, this.size), pb.vec2(0.5));
            this.$l.i = pb.floor(this.p);
            this.$l.f = pb.sub(this.p, this.i);
            this.$l.maxIndex = pb.sub(this.size, pb.vec2(1));
            this.$l.i0 = pb.ivec2(pb.clamp(this.i, pb.vec2(0), this.maxIndex));
            this.$l.i1 = pb.ivec2(pb.clamp(pb.add(this.i, pb.vec2(1)), pb.vec2(0), this.maxIndex));
            const texel = (scope: PBInsideFunctionScope, x: string, z: string) =>
              pb.textureLoad(scope.density, pb.ivec2(scope[x].x, scope[z].y), 0).r;
            this.$l.a = pb.mix(texel(this, 'i0', 'i0'), texel(this, 'i1', 'i0'), this.f.x);
            this.$l.b = pb.mix(texel(this, 'i0', 'i1'), texel(this, 'i1', 'i1'), this.f.x);
            this.$return(pb.mix(this.a, this.b, this.f.y));
          });
          // (max, min) height over a rectangle of height map texels [lo, hi], read from the
          // pyramid level where the rectangle spans at most 2x2 texels
          pb.func('pyramidRange', [pb.vec2('lo'), pb.vec2('hi')], function () {
            this.$l.extent = pb.max(pb.sub(this.hi.x, this.lo.x), pb.sub(this.hi.y, this.lo.y));
            this.$l.level = pb.clamp(
              pb.ceil(pb.log2(pb.max(this.extent, 1))),
              0,
              pb.sub(this.heightInfo.z, 1)
            );
            this.$l.texelSize = pb.exp2(this.level);
            this.$l.mip = pb.int(this.level);
            this.$l.maxIndex = pb.sub(
              pb.vec2(pb.textureDimensions(this.heightPyramid, this.mip)),
              pb.vec2(1)
            );
            this.$l.i0 = pb.ivec2(
              pb.clamp(pb.floor(pb.div(this.lo, this.texelSize)), pb.vec2(0), this.maxIndex)
            );
            this.$l.i1 = pb.ivec2(
              pb.clamp(pb.floor(pb.div(this.hi, this.texelSize)), pb.vec2(0), this.maxIndex)
            );
            this.$l.a = pb.textureLoad(this.heightPyramid, this.i0, this.mip).rg;
            this.$l.b = pb.textureLoad(this.heightPyramid, pb.ivec2(this.i1.x, this.i0.y), this.mip).rg;
            this.$l.c = pb.textureLoad(this.heightPyramid, pb.ivec2(this.i0.x, this.i1.y), this.mip).rg;
            this.$l.d = pb.textureLoad(this.heightPyramid, this.i1, this.mip).rg;
            this.$return(
              pb.vec2(
                pb.max(pb.max(this.a.x, this.b.x), pb.max(this.c.x, this.d.x)),
                pb.min(pb.min(this.a.y, this.b.y), pb.min(this.c.y, this.d.y))
              )
            );
          });
          pb.main(function () {
            // Placement units of this thread's layer: cells of the near window, or 2x2 blocks of
            // cells of the far window (z = 1, procedural blades only)
            this.$l.far = pb.notEqual(this.$builtins.globalInvocationId.z, pb.uint(0));
            this.$l.win = this.window;
            this.$l.unit = pb.float(1);
            if (blade) {
              this.$if(this.far, function () {
                this.win = this.window2;
                this.unit = pb.float(2);
              });
            }
            // Terrain occlusion, one test per workgroup: the group's blades are hidden if every
            // line of sight to them dips below the terrain somewhere in front of them. Each
            // thread checks one point along the way.
            this.$l.occluded = pb.uint(0);
            this.$if(pb.greaterThan(this.occlusion.x, 0.5), function () {
              this.$l.cellSize = pb.div(pb.sub(this.region.zw, this.region.xy), this.cells.xy);
              this.$l.toTexel = pb.div(this.heightInfo.xy, pb.sub(this.region.zw, this.region.xy));
              this.$l.g0 = pb.mul(
                pb.add(this.win.xy, pb.mul(pb.vec2(this.$builtins.workGroupId.xy), WORKGROUP_SIZE)),
                this.unit
              );
              this.$l.g1 = pb.min(
                pb.add(this.g0, pb.vec2(pb.mul(this.unit, WORKGROUP_SIZE))),
                pb.mul(pb.add(this.win.xy, this.win.zw), this.unit)
              );
              this.$l.fmin = pb.add(this.region.xy, pb.mul(this.g0, this.cellSize));
              this.$l.fmax = pb.add(this.region.xy, pb.mul(this.g1, this.cellSize));
              this.$l.cam = this.cameraPos.xz;
              this.$l.camY = this.cameraPos.y;
              // Highest blade tip of the group; one texel of margin for the bilinear heights
              this.$l.groupRange = this.pyramidRange(
                pb.sub(pb.mul(pb.sub(this.fmin, this.region.xy), this.toTexel), pb.vec2(1)),
                pb.add(pb.mul(pb.sub(this.fmax, this.region.xy), this.toTexel), pb.vec2(1))
              );
              this.$l.topY = pb.add(
                pb.add(pb.mul(this.groupRange.x, this.posScale.y), this.posScale.w),
                this.occlusion.w
              );
              this.$l.dNear = pb.length(
                pb.max(pb.max(pb.sub(this.fmin, this.cam), pb.sub(this.cam, this.fmax)), pb.vec2(0))
              );
              this.$l.dFar = pb.length(
                pb.max(pb.abs(pb.sub(this.cam, this.fmin)), pb.abs(pb.sub(this.cam, this.fmax)))
              );
              this.$l.center = pb.mul(pb.add(this.fmin, this.fmax), 0.5);
              this.$l.groupRadius = pb.mul(pb.length(pb.sub(this.fmax, this.fmin)), 0.5);
              this.$l.sMin = pb.mul(this.heightInfo.w, 2);
              this.$l.sEnd = pb.sub(this.dNear, this.groupRadius);
              // A camera below the terrain would see everything as occluded
              this.$l.camTexel = pb.mul(pb.sub(this.cam, this.region.xy), this.toTexel);
              this.$l.camGround = pb.add(
                pb.mul(this.pyramidRange(this.camTexel, this.camTexel).y, this.posScale.y),
                this.posScale.w
              );
              this.$if(
                pb.and(pb.greaterThan(this.sEnd, this.sMin), pb.greaterThanEqual(this.camY, this.camGround)),
                function () {
                  // Steepest line of sight to the group: to the nearest edge when looking up at
                  // its highest tip, to the farthest one when looking down
                  this.$l.slope = pb.div(
                    pb.sub(this.topY, this.camY),
                    pb.mix(this.dFar, this.dNear, pb.step(this.camY, this.topY))
                  );
                  this.$l.dir = pb.normalize(pb.sub(this.center, this.cam));
                  this.$l.k = pb.float(
                    pb.add(
                      pb.mul(this.$builtins.localInvocationId.y, WORKGROUP_SIZE),
                      this.$builtins.localInvocationId.x
                    )
                  );
                  this.$l.s = pb.add(
                    this.sMin,
                    pb.mul(pb.sub(this.sEnd, this.sMin), pb.div(pb.add(this.k, 0.5), OCCLUSION_SAMPLES))
                  );
                  this.$l.p = pb.add(this.cam, pb.mul(this.dir, this.s));
                  // Lateral spread of the lines of sight at this distance, plus how far below the
                  // samples the rendered surface can reach: a clipmap level of 2^L cells averages
                  // heights within 4 * 2^L cells, and 2^L <= s / (T * cell) there, doubled for safety
                  this.$l.spread = pb.div(pb.mul(this.groupRadius, this.s), this.dNear);
                  this.$l.lodReach = pb.mul(
                    pb.mul(
                      pb.max(1, pb.div(pb.mul(this.s, 2), pb.mul(this.occlusion.y, this.heightInfo.w))),
                      this.heightInfo.w
                    ),
                    4
                  );
                  this.$l.halfSize = pb.mul(pb.vec2(pb.add(this.spread, this.lodReach)), this.toTexel);
                  this.$l.pc = pb.mul(pb.sub(this.p, this.region.xy), this.toTexel);
                  this.$l.lo = pb.sub(this.pc, this.halfSize);
                  this.$l.hi = pb.add(this.pc, this.halfSize);
                  // Beyond the terrain there is nothing to hide behind
                  this.$if(
                    pb.and(
                      pb.and(pb.greaterThanEqual(this.lo.x, 0), pb.greaterThanEqual(this.lo.y, 0)),
                      pb.and(
                        pb.lessThanEqual(this.hi.x, this.heightInfo.x),
                        pb.lessThanEqual(this.hi.y, this.heightInfo.y)
                      )
                    ),
                    function () {
                      this.$l.ground = pb.sub(
                        pb.add(
                          pb.mul(this.pyramidRange(this.lo, this.hi).y, this.posScale.y),
                          this.posScale.w
                        ),
                        this.occlusion.z
                      );
                      this.$if(
                        pb.lessThan(pb.add(this.camY, pb.mul(this.slope, this.s)), this.ground),
                        function () {
                          pb.atomicOr(this.occludedFlag, 1);
                        }
                      );
                    }
                  );
                }
              );
              pb.workgroupBarrier();
              this.occluded = pb.atomicOr(this.occludedFlag, 0);
            });
            this.$l.id = this.$builtins.globalInvocationId.xy;
            this.$if(
              pb.and(
                pb.and(
                  pb.lessThan(this.id.x, pb.uint(this.win.z)),
                  pb.lessThan(this.id.y, pb.uint(this.win.w))
                ),
                pb.or(pb.equal(this.occluded, 0), pb.greaterThan(this.occlusion.x, 1.5))
              ),
              function () {
                this.$l.cx = pb.add(pb.uint(this.win.x), this.id.x);
                this.$l.cz = pb.add(pb.uint(this.win.y), this.id.y);
                this.$l.seed = pb.uint(this.params.x);
                // Blades that give way to the low detail level: 1 for the three cells of each
                // 2x2 block that the far layer does not keep
                this.$l.extra = pb.float(0);
                if (blade) {
                  this.$l.bseed = pb.add(pb.mul(this.seed, 16), pb.uint(BLADE_SEED_BASE));
                  // The cell of a 2x2 block the far layer keeps, picked by a hash of the block
                  this.$l.block = this.$choice(
                    this.far,
                    pb.uvec2(this.cx, this.cz),
                    pb.uvec2(pb.sar(this.cx, 1), pb.sar(this.cz, 1))
                  );
                  this.$l.kept = pb.min(
                    pb.uint(pb.mul(this.grassHash(this.block.x, this.block.y, pb.add(this.bseed, 5)), 4)),
                    pb.uint(3)
                  );
                  this.$if(this.far, function () {
                    this.cx = pb.add(pb.mul(this.block.x, 2), pb.compAnd(this.kept, pb.uint(1)));
                    this.cz = pb.add(pb.mul(this.block.y, 2), pb.sar(this.kept, 1));
                  }).$else(function () {
                    this.extra = pb.float(
                      pb.notEqual(
                        pb.add(pb.compAnd(this.cx, pb.uint(1)), pb.mul(pb.compAnd(this.cz, pb.uint(1)), 2)),
                        this.kept
                      )
                    );
                  });
                }
                this.$l.uv = pb.div(
                  pb.add(
                    pb.vec2(pb.float(this.cx), pb.float(this.cz)),
                    pb.vec2(
                      this.grassHash(this.cx, this.cz, this.seed),
                      this.grassHash(this.cx, this.cz, pb.add(this.seed, 1))
                    )
                  ),
                  this.cells.xy
                );
                this.$if(
                  pb.and(
                    pb.greaterThan(
                      this.sampleDensity(this.uv),
                      this.grassHash(this.cx, this.cz, pb.add(this.seed, 2))
                    ),
                    // The cell a block of the far layer keeps can fall past the grid's last row
                    pb.and(
                      pb.lessThan(this.cx, pb.uint(this.cells.x)),
                      pb.lessThan(this.cz, pb.uint(this.cells.y))
                    )
                  ),
                  function () {
                    this.$l.regionSize = pb.sub(this.region.zw, this.region.xy);
                    if (blade) {
                      // Clumps, after "Procedural Grass in Ghost of Tsushima": a procedural
                      // Voronoi over the nearest 3x3 points of a grid, each jittered by a hash;
                      // the blade belongs to the clump of the nearest point
                      this.$l.cp = pb.mul(
                        pb.add(this.region.xy, pb.mul(this.uv, this.regionSize)),
                        this.clump0.x
                      );
                      this.$l.cellBase = pb.floor(this.cp);
                      this.$l.bestDist = pb.float(1e9);
                      this.$l.clumpPoint = this.cp;
                      this.$l.clumpCell = pb.uvec2(0);
                      this.$l.cellF = pb.vec2(0);
                      this.$l.cellU = pb.uvec2(0);
                      this.$l.point = pb.vec2(0);
                      this.$l.pointDist = pb.float(0);
                      for (let dz = -1; dz <= 1; dz++) {
                        for (let dx = -1; dx <= 1; dx++) {
                          this.cellF = pb.add(this.cellBase, pb.vec2(dx, dz));
                          // Negative cells wrap to large unsigned values, all the hash needs
                          this.cellU = pb.uvec2(pb.ivec2(this.cellF));
                          this.point = pb.add(
                            this.cellF,
                            pb.vec2(
                              this.grassHash(this.cellU.x, this.cellU.y, pb.add(this.bseed, 8)),
                              this.grassHash(this.cellU.x, this.cellU.y, pb.add(this.bseed, 9))
                            )
                          );
                          this.pointDist = pb.dot(pb.sub(this.point, this.cp), pb.sub(this.point, this.cp));
                          this.$if(pb.lessThan(this.pointDist, this.bestDist), function () {
                            this.bestDist = this.pointDist;
                            this.clumpPoint = this.point;
                            this.clumpCell = this.cellU;
                          });
                        }
                      }
                      this.$l.clumpCenter = pb.div(this.clumpPoint, this.clump0.x);
                      this.$l.clumpAngle = pb.mul(
                        this.grassHash(this.clumpCell.x, this.clumpCell.y, pb.add(this.bseed, 10)),
                        Math.PI * 2
                      );
                      this.$l.clumpHeight = pb.sub(
                        pb.mul(this.grassHash(this.clumpCell.x, this.clumpCell.y, pb.add(this.bseed, 11)), 2),
                        1
                      );
                      this.$l.clumpColor = this.grassHash(
                        this.clumpCell.x,
                        this.clumpCell.y,
                        pb.add(this.bseed, 12)
                      );
                      // Pull the blade toward its clump point before it is placed on the terrain
                      this.uv = pb.mix(
                        this.uv,
                        pb.div(pb.sub(this.clumpCenter, this.region.xy), this.regionSize),
                        this.clump0.z
                      );
                    }
                    this.$l.xz = pb.add(this.region.xy, pb.mul(this.uv, this.regionSize));
                    this.$l.height = pb.add(
                      pb.mul(pb.textureSampleLevel(this.heightMap, this.uv, 0).r, this.posScale.y),
                      this.posScale.w
                    );
                    this.$l.base = pb.vec3(this.xz.x, this.height, this.xz.y);
                    this.$l.dist = pb.distance(this.base, this.cameraPos.xyz);
                    this.$l.visible = pb.or(
                      pb.lessThanEqual(this.params.y, 0),
                      pb.lessThanEqual(this.dist, this.params.y)
                    );
                    this.$l.lodHash = this.grassHash(this.cx, this.cz, pb.add(this.seed, 4));
                    if (blade) {
                      // Detail level: each blade belongs to the near layer up to the low detail
                      // distance and to the far layer from there on, measured the same way in both
                      this.visible = pb.and(
                        this.visible,
                        pb.equal(this.far, pb.greaterThanEqual(this.dist, this.lod.x))
                      );
                    } else {
                      // Density LOD, see ClipmapGrassMaterial: drop the blades the material would
                      // shrink to nothing
                      this.$if(pb.greaterThan(this.params.y, 0), function () {
                        this.$l.keep = pb.mix(
                          1,
                          this.densityLod.y,
                          pb.smoothStep(this.densityLod.x, this.params.y, this.dist)
                        );
                        this.visible = pb.and(
                          this.visible,
                          pb.lessThan(pb.mul(this.lodHash, 1 - GRASS_LOD_FADE_BAND), this.keep)
                        );
                      });
                    }
                    this.$l.center = pb.add(this.base, pb.vec3(0, this.params.w, 0));
                    for (let i = 0; i < 6; i++) {
                      this.visible = pb.and(
                        this.visible,
                        pb.greaterThanEqual(
                          pb.add(pb.dot(this.planes.at(i).xyz, this.center), this.planes.at(i).w),
                          pb.neg(this.params.z)
                        )
                      );
                    }
                    this.$if(this.visible, function () {
                      this.$l.angle = pb.mul(
                        this.grassHash(this.cx, this.cz, pb.add(this.seed, 3)),
                        Math.PI * 2
                      );
                      // Occluded blades kept for debugging are flagged by adding 2 to the hash; blade
                      // instances carry the extra flag in its place, their density LOD is the
                      // detail levels
                      this.$l.flaggedHash = pb.add(
                        blade ? this.extra : this.lodHash,
                        pb.mul(pb.float(pb.notEqual(this.occluded, 0)), 2)
                      );
                      if (blade) {
                        // Near blades append to the high detail list, far ones to the low detail
                        // list, whose draw arguments follow and whose instances start at lod.y
                        this.$l.slot = pb.uint(0);
                        this.$if(this.far, function () {
                          this.slot = pb.add(pb.atomicAdd(this.args.at(6), 1), pb.uint(this.lod.y));
                        }).$else(function () {
                          this.slot = pb.atomicAdd(this.args.at(1), 1);
                        });
                      } else {
                        this.$l.slot = pb.atomicAdd(this.args.at(1), 1);
                      }
                      if (!blade) {
                        this.instances.setAt(this.slot, pb.vec4(this.uv, this.angle, this.flaggedHash));
                      } else {
                        // Layout: see ClipmapBladeGrassMaterial
                        const signedHash = (scope: PBInsideFunctionScope, k: number) =>
                          pb.sub(pb.mul(scope.grassHash(scope.cx, scope.cz, pb.add(scope.bseed, k)), 2), 1);
                        this.$l.bladeHeight = pb.mul(
                          this.shape0.x,
                          pb.max(0, pb.add(1, pb.mul(this.shape0.y, signedHash(this, 0)))),
                          pb.max(0, pb.add(1, pb.mul(this.clump0.y, this.clumpHeight)))
                        );
                        this.$l.bladeWidth = pb.mul(
                          this.shape0.z,
                          pb.max(0, pb.add(1, pb.mul(this.shape0.w, signedHash(this, 1))))
                        );
                        this.$l.tilt = pb.clamp(
                          pb.add(this.shape1.x, pb.mul(this.shape1.y, signedHash(this, 2))),
                          0,
                          1
                        );
                        this.$l.bend = pb.add(this.shape1.z, pb.mul(this.shape1.w, signedHash(this, 3)));
                        this.$l.bladeHash = this.grassHash(this.cx, this.cz, pb.add(this.bseed, 4));
                        // Facing: toward the clump's shared direction, then away from its point
                        this.$l.clumpDir = pb.vec2(pb.cos(this.clumpAngle), pb.sin(this.clumpAngle));
                        this.$l.facing = pb.mix(
                          pb.vec2(pb.cos(this.angle), pb.sin(this.angle)),
                          this.clumpDir,
                          this.clump0.w
                        );
                        this.$l.away = pb.sub(this.xz, this.clumpCenter);
                        this.$l.awayLen = pb.length(this.away);
                        this.$if(pb.greaterThan(this.awayLen, 1e-5), function () {
                          this.facing = pb.mix(this.facing, pb.div(this.away, this.awayLen), this.clump1.x);
                        });
                        this.$if(pb.lessThan(pb.dot(this.facing, this.facing), 1e-8), function () {
                          this.facing = this.clumpDir;
                        });
                        this.$l.facingAngle = pb.atan2(this.facing.y, this.facing.x);
                        // Wind: sample the push for this frame and the last one, and turn the facing
                        // downwind by it; the vertex shader rebuilds both frames for motion vectors
                        this.$l.windPush = WindField.shaderPush(
                          this,
                          this.xz,
                          this.wind.at(0),
                          this.wind.at(1),
                          this.wind.at(2),
                          this.wind.at(3)
                        );
                        this.$l.windPushPrev = WindField.shaderPush(
                          this,
                          this.xz,
                          this.wind.at(4),
                          this.wind.at(5),
                          this.wind.at(6),
                          this.wind.at(7)
                        );
                        this.$l.facingNow = this.facingAngle;
                        this.$l.facingPrev = this.facingAngle;
                        this.$l.bladeDir = pb.vec2(pb.cos(this.facingAngle), pb.sin(this.facingAngle));
                        const turn = (
                          scope: PBInsideFunctionScope,
                          out: string,
                          push: string,
                          dir: PBShaderExp
                        ) => {
                          scope.$if(
                            pb.and(pb.greaterThan(scope[push], 0), pb.greaterThan(pb.dot(dir, dir), 1e-6)),
                            function () {
                              this[out] = pb.add(
                                this.facingAngle,
                                pb.mul(
                                  pb.atan2(
                                    pb.sub(pb.mul(this.bladeDir.x, dir.y), pb.mul(this.bladeDir.y, dir.x)),
                                    pb.dot(this.bladeDir, dir)
                                  ),
                                  pb.clamp(pb.mul(this[push], this.clump1.y), 0, 1)
                                )
                              );
                            }
                          );
                        };
                        turn(this, 'facingNow', 'windPush', this.wind.at(0).xy);
                        turn(this, 'facingPrev', 'windPushPrev', this.wind.at(4).xy);
                        // Terrain normal under the blade (central differences of the height map, as
                        // in ClipmapGrassMaterial), x and z quantized to 12 bits each and packed into
                        // an integer a float holds exactly. Distant blades shade toward it.
                        this.$l.texel = pb.div(pb.vec2(1), this.heightInfo.xy);
                        this.$l.sampleDist = pb.mul(this.regionSize, pb.mul(this.texel, 2));
                        this.$l.hL = pb.textureSampleLevel(
                          this.heightMap,
                          pb.sub(this.uv, pb.vec2(this.texel.x, 0)),
                          0
                        ).r;
                        this.$l.hR = pb.textureSampleLevel(
                          this.heightMap,
                          pb.add(this.uv, pb.vec2(this.texel.x, 0)),
                          0
                        ).r;
                        this.$l.hU = pb.textureSampleLevel(
                          this.heightMap,
                          pb.sub(this.uv, pb.vec2(0, this.texel.y)),
                          0
                        ).r;
                        this.$l.hD = pb.textureSampleLevel(
                          this.heightMap,
                          pb.add(this.uv, pb.vec2(0, this.texel.y)),
                          0
                        ).r;
                        this.$l.terrainNormal = pb.normalize(
                          pb.vec3(
                            pb.neg(
                              pb.div(pb.mul(pb.sub(this.hR, this.hL), this.posScale.y), this.sampleDist.x)
                            ),
                            1,
                            pb.neg(
                              pb.div(pb.mul(pb.sub(this.hD, this.hU), this.posScale.y), this.sampleDist.y)
                            )
                          )
                        );
                        this.$l.quantized = pb.floor(
                          pb.add(
                            pb.mul(pb.add(pb.mul(this.terrainNormal.xz, 0.5), pb.vec2(0.5)), 4095),
                            pb.vec2(0.5)
                          )
                        );
                        this.$l.packedNormal = pb.add(pb.mul(this.quantized.x, 4096), this.quantized.y);
                        this.$l.first = pb.mul(this.slot, INSTANCE_VEC4.blade);
                        this.instances.setAt(this.first, pb.vec4(this.base, this.flaggedHash));
                        this.instances.setAt(
                          pb.add(this.first, 1),
                          pb.vec4(this.facingNow, this.facingPrev, this.windPush, this.windPushPrev)
                        );
                        this.instances.setAt(
                          pb.add(this.first, 2),
                          pb.vec4(this.clumpAngle, this.clumpColor, this.packedNormal, this.bladeHash)
                        );
                        this.instances.setAt(
                          pb.add(this.first, 3),
                          pb.vec4(this.bladeHeight, this.bladeWidth, this.tilt, this.bend)
                        );
                      }
                    });
                  }
                );
              }
            );
          });
        }
      })!;
      this._programs[kind] = program;
    }
    return program;
  }
  protected onDispose() {
    super.onDispose();
    this._densityTexture.dispose();
    this._instanceBuffer.dispose();
    this._argsBuffer.dispose();
    this._bindGroup.dispose();
    this._primitive.dispose();
    this._baseVertexBuffer.dispose();
    this._indexBuffer.dispose();
  }
}
