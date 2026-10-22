import type {
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import { declareDynamicSDFUniforms, declareGlobalSDFUniforms, sampleGlobalSDF } from '../../shaders/sdf';
import type { ClipmapTerrain } from '../../scene/terrain-cm/terrain-cm';
import type { GlobalSDF } from './global_sdf';
import { buildSDFProgram } from './sdf_programs';

/** Seed coordinate meaning "no seed yet". */
const NO_SEED = -1e5;
const WORKGROUP = 8;
/** Gaussian smoothing of the shore coordinates, in cells: half width and sigma. */
const SMOOTH_RADIUS = 4;
const SMOOTH_SIGMA = 2;
/** Field value within which the bed model is used, and its coefficient bound. */
const SMOOTH_MODEL_REACH = 4;
const SMOOTH_MODEL_CLAMP = 1000;
/** Jump-flooded distance, in metres, over which the bed model hands over to it. */
const SMOOTH_BLEND_START = 1;
const SMOOTH_BLEND_END = 4;
/** Horizontal field gradient below which the bed counts as flat. */
const WATERLINE_MIN_SLOPE = 0.02;
/** Bound of the linear model coefficients, within half float range. */
const WATERLINE_MODEL_CLAMP = 10000;
/** Distance a terrain source reports off its height map: open water, well past the bed model's reach. */
const TERRAIN_OFF_MAP = 1e4;

/**
 * What a {@link WaterlineField} is built from: a signed distance to the solid
 * ground at a world position, negative inside it, which the seed pass samples
 * at the rest level and half a cell above.
 * @internal
 */
export interface WaterlineSource {
  /** Identifies the seed program the source builds into. */
  readonly label: string;
  /** Goes up whenever the ground may have changed. */
  readonly version: number;
  /** Declares the uniforms {@link WaterlineSource.sampleDistance} reads, in bind group 0. */
  declareUniforms(scope: PBGlobalScope): void;
  /** Sets the uniforms {@link WaterlineSource.declareUniforms} declared. */
  applyBindGroup(bindGroup: BindGroup): void;
  /** Signed distance to the ground at a world position. */
  sampleDistance(scope: PBInsideFunctionScope, pos: PBShaderExp): PBShaderExp;
}

/**
 * The global scene field as a waterline source: static geometry and the
 * terrain, without the dynamic instances.
 * @internal
 */
export class SDFWaterlineSource implements WaterlineSource {
  readonly label = 'SDF';
  private readonly _global: GlobalSDF;
  constructor(global: GlobalSDF) {
    this._global = global;
  }
  get version() {
    return this._global.staticVersion;
  }
  declareUniforms(scope: PBGlobalScope) {
    declareGlobalSDFUniforms(scope, 0, this._global.levels);
    // Unsampled, declared for GlobalSDF.applyBindGroup
    declareDynamicSDFUniforms(scope, 0);
  }
  applyBindGroup(bindGroup: BindGroup) {
    this._global.applyBindGroup(bindGroup);
  }
  sampleDistance(scope: PBInsideFunctionScope, pos: PBShaderExp) {
    return sampleGlobalSDF(scope, pos, this._global.levels);
  }
}

/**
 * A terrain's height map as a waterline source: the distance above the
 * surface over its slope, exact on a plane, as the global field composites
 * the terrain. Only the terrain, so nothing standing on a beach bends its
 * shoreline. Off the height map, or with no terrain, everything is water.
 * @internal
 */
export class TerrainWaterlineSource implements WaterlineSource {
  readonly label = 'Terrain';
  private _terrain: Nullable<ClipmapTerrain>;
  private _version: number;
  private _key: string;
  private readonly _region: Vector4;
  /** (height scale, world y, 1 / width, 1 / height) */
  private readonly _params: Vector4;
  private _dummy: Nullable<Texture2D>;
  constructor() {
    this._terrain = null;
    this._version = 0;
    this._key = '';
    this._region = new Vector4(0, 0, 0, 0);
    this._params = new Vector4(0, 0, 1, 1);
    this._dummy = null;
  }
  get terrain() {
    return this._terrain;
  }
  get version() {
    return this._version;
  }
  /** Sets the terrain and notices changes to it; call before the field updates. */
  setTerrain(terrain: Nullable<ClipmapTerrain>) {
    this._terrain = terrain;
    const heightMap = terrain?.heightMap ?? null;
    let key = '';
    if (terrain && heightMap) {
      const r = terrain.worldRegion;
      this._region.setXYZW(r.x, r.y, r.z, r.w);
      this._params.setXYZW(
        Math.abs(terrain.scale.y),
        terrain.worldMatrix.m13,
        1 / heightMap.width,
        1 / heightMap.height
      );
      key = `${heightMap.uid}:${terrain.heightVersion}:${[...this._region, ...this._params].join(',')}`;
    } else {
      this._region.setXYZW(0, 0, 0, 0);
    }
    if (key !== this._key) {
      this._key = key;
      this._version++;
    }
  }
  declareUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    scope.wlHeightMap = pb.tex2D().uniform(0);
    // (min x, min z, max x, max z); empty for no terrain
    scope.wlTerrainRegion = pb.vec4().uniform(0);
    scope.wlTerrainParams = pb.vec4().uniform(0);
  }
  applyBindGroup(bindGroup: BindGroup) {
    const heightMap = this._terrain?.heightMap ?? null;
    bindGroup.setTexture('wlHeightMap', heightMap ?? this.getDummy(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('wlTerrainRegion', this._region);
    bindGroup.setValue('wlTerrainParams', this._params);
  }
  sampleDistance(scope: PBInsideFunctionScope, pos: PBShaderExp) {
    const pb = scope.$builder;
    pb.func('wlTerrainHeight', [pb.vec2('xz')], function () {
      this.$l.uv = pb.div(
        pb.sub(this.xz, this.wlTerrainRegion.xy),
        pb.sub(this.wlTerrainRegion.zw, this.wlTerrainRegion.xy)
      );
      this.$return(
        pb.add(
          pb.mul(pb.textureSampleLevel(this.wlHeightMap, this.uv, 0).r, this.wlTerrainParams.x),
          this.wlTerrainParams.y
        )
      );
    });
    pb.func('wlTerrainDistance', [pb.vec3('p')], function () {
      this.$if(
        pb.or(
          pb.any(pb.lessThanEqual(this.wlTerrainRegion.zw, this.wlTerrainRegion.xy)),
          pb.or(
            pb.any(pb.lessThan(this.p.xz, this.wlTerrainRegion.xy)),
            pb.any(pb.greaterThan(this.p.xz, this.wlTerrainRegion.zw))
          )
        ),
        function () {
          this.$return(pb.float(TERRAIN_OFF_MAP));
        }
      );
      this.$l.h = this.wlTerrainHeight(this.p.xz);
      // Central differences one height map texel apart, in world units
      this.$l.cell = pb.mul(
        pb.sub(this.wlTerrainRegion.zw, this.wlTerrainRegion.xy),
        this.wlTerrainParams.zw
      );
      this.$l.hx = pb.sub(
        this.wlTerrainHeight(pb.add(this.p.xz, pb.vec2(this.cell.x, 0))),
        this.wlTerrainHeight(pb.sub(this.p.xz, pb.vec2(this.cell.x, 0)))
      );
      this.$l.hz = pb.sub(
        this.wlTerrainHeight(pb.add(this.p.xz, pb.vec2(0, this.cell.y))),
        this.wlTerrainHeight(pb.sub(this.p.xz, pb.vec2(0, this.cell.y)))
      );
      this.$l.grad = pb.div(pb.vec2(this.hx, this.hz), pb.mul(this.cell, 2));
      this.$return(pb.div(pb.sub(this.p.y, this.h), pb.sqrt(pb.add(1, pb.dot(this.grad, this.grad)))));
    });
    return scope.wlTerrainDistance(pos) as PBShaderExp;
  }
  dispose() {
    this._dummy?.dispose();
    this._dummy = null;
  }
  /** @internal */
  private getDummy() {
    if (!this._dummy) {
      this._dummy = getDevice().createTexture2D('r16f', 1, 1, { mipmapping: false })!;
    }
    return this._dummy;
  }
}

/** Bind groups of one level's build: each dispatch of a frame needs its own uniforms. */
interface LevelBindGroups {
  seed: BindGroup;
  jfa: BindGroup[];
  wetJfa: BindGroup[];
  resolve: BindGroup;
  smooth: [BindGroup, BindGroup];
}

/**
 * Options of a {@link WaterlineField}.
 * @public
 */
export interface WaterlineFieldOptions {
  /** Levels, each twice the cell size of the one before at the same number of cells. Default 1. */
  levels?: number;
  /** Cells along each side of a level, a power of two. Default 256. */
  resolution?: number;
  /** Cell size of the finest level in world units. Default 0.5. */
  cellSize?: number;
}

/**
 * Horizontal distance to the waterline around the camera: on square grids at
 * the rest level of a body of water, the distance in world units from each
 * cell to the nearest point where the ground pierces that level.
 *
 * Unlike the 3D distance to the nearest solid (the water depth over a gently
 * shelving bed), this measures shoreline bands outwards from where the ground
 * meets the water.
 *
 * Built on the GPU from a {@link WaterlineSource}: the global clipmap (static
 * geometry and the terrain; dynamic instances, a boat or a car wading in, are
 * not shores and would ring themselves with shore waves and foam) or the
 * terrain alone. One or more levels, all centred on the camera, each twice the
 * cell size of the one before. Per level:
 *
 * 1. Seed: a cell whose centre is inside the ground at the water level is its own nearest shore.
 * 2. Jump flooding, log2(resolution) passes, carries the nearest seed across the grid.
 * 3. Resolve, into an rgba16f texture:
 *    - x: distance to the nearest seed, the waterline at the rest level;
 *    - y, z: a linear model of the ground around the cell, A and B with the horizontal distance
 *      to the waterline at a height `level + dy` being `A + B * dy`;
 *    - w: the field value at the cell at the rest level, telling how far the linear model holds.
 * 4. Smooth, into a layer of {@link WaterlineField.smoothTexture}.
 *
 * The linear model lets the waterline follow the waves (a surface raised by dy moves the edge
 * dy / tan(a) inland on a slope of angle a). From the field value s and its gradient g at the rest
 * level, the ground near the cell is the plane s + g.(p - p0) = 0, crossed at height dy
 * (s + g.y * dy) / |g.xz| away horizontally: A = s / |g.xz|, B = g.y / |g.xz|. Exact for a planar
 * bed; farther from the shore the jump-flooded distance is used.
 *
 * The jump-flooded distance is accurate to about half a cell. A level only sees
 * the shores on its own grid, so near its edge the nearest one may lie off it.
 * WebGPU only.
 *
 * @public
 */
export class WaterlineField {
  readonly levels: number;
  readonly resolution: number;
  readonly cellSize: number;
  private readonly _source: WaterlineSource;
  private _level: Nullable<number>;
  private _requested: boolean;
  private _seedA: Nullable<Texture2D>;
  private _seedB: Nullable<Texture2D>;
  /** Seeds in the water, flooded for the distance inland from it; and the pass between. */
  private _wetA: Nullable<Texture2D>;
  private _wetB: Nullable<Texture2D>;
  /** (field at the rest level, field half a cell above) per cell. */
  private _probe: Nullable<Texture2D>;
  private _result: Nullable<Texture2D>;
  /** Smoothed shore coordinates, a layer per level, see {@link WaterlineField.smoothTexture}. */
  private _smooth: Nullable<Texture2DArray>;
  private _smoothTemp: Nullable<Texture2D>;
  private _smoothHProgram: Nullable<GPUProgram>;
  private _smoothVProgram: Nullable<GPUProgram>;
  private _seedProgram: Nullable<GPUProgram>;
  private _jfaProgram: Nullable<GPUProgram>;
  private _resolveProgram: Nullable<GPUProgram>;
  private _bindGroups: LevelBindGroups[];
  /** Per level: (origin x, origin z, cell size, resolution) as last built; 0 cells before it is. */
  private readonly _regions: Vector4[];
  /** Per level: source version, origin x, origin z and water level it was last built at. */
  private readonly _builtAt: [number, number, number, number][];
  constructor(source: WaterlineSource, options?: WaterlineFieldOptions) {
    this._source = source;
    this.levels = Math.max(1, Math.min(8, Math.floor(options?.levels ?? 1)));
    this.resolution = Math.max(16, 2 ** Math.round(Math.log2(options?.resolution ?? 256)));
    this.cellSize = Math.max(1e-3, options?.cellSize ?? 0.5);
    this._level = null;
    this._requested = false;
    this._seedA = null;
    this._seedB = null;
    this._wetA = null;
    this._wetB = null;
    this._probe = null;
    this._result = null;
    this._smooth = null;
    this._smoothTemp = null;
    this._smoothHProgram = null;
    this._smoothVProgram = null;
    this._seedProgram = null;
    this._jfaProgram = null;
    this._resolveProgram = null;
    this._bindGroups = [];
    this._regions = Array.from({ length: this.levels }, () => new Vector4(0, 0, 0, 0));
    this._builtAt = Array.from({ length: this.levels }, () => [NaN, NaN, NaN, NaN]);
  }
  /** Grids built so far, a level each, for diagnosis. */
  get rebuilds() {
    return this._rebuilds;
  }
  private _rebuilds = 0;
  /** What the field is built from. */
  get source() {
    return this._source;
  }
  /** World Y the field is built at, or null before anything asked for it. */
  get level() {
    return this._level;
  }
  /** True once the finest level has been built. */
  get ready() {
    return this._regions[0].w > 0;
  }
  /**
   * Smooth shore coordinates per cell, an rgba16f array with a layer per
   * level, for effects that build geometry on them (see ShoreWaveGenerator):
   * (signed distance to the waterline, negative inland; B of the bed model;
   * height of the bed over the rest level; 0). The first two are
   * Gaussian-filtered over two cells; the bed height is the cell's own, so it
   * matches the ground. Null before the finest level is built.
   */
  get smoothTexture() {
    return this.ready ? this._smooth : null;
  }
  /**
   * (rest-level distance, model A, model B, field at the rest level) per cell
   * of the level built last, rgba16f: the finest level when there is one.
   */
  get texture() {
    return this._result;
  }
  /** (origin x, origin z, cell size, resolution) of the finest level, for sampling. */
  get region() {
    return this._regions[0];
  }
  /** (origin x, origin z, cell size, resolution) per level; 0 cells for a level not built yet. */
  get regions(): readonly Vector4[] {
    return this._regions;
  }
  /**
   * Asks for the field at a water level this frame. Without a request in a
   * frame it is not rebuilt; with several, the last one wins.
   */
  request(level: number) {
    this._level = level;
    this._requested = true;
  }
  /** Rebuilds the levels around the camera that moved or went stale, when requested. */
  update(cameraPos: Vector3) {
    if (!this._requested || this._level === null) {
      return;
    }
    this._requested = false;
    this.ensureResources();
    const version = this._source.version;
    // Coarse first, so the resolved texture ends up holding the finest level
    for (let i = this.levels - 1; i >= 0; i--) {
      const h = this.cellSize * 2 ** i;
      const n = this.resolution;
      // Snapped to cells, so the grid does not swim as the camera moves
      const ox = (Math.floor(cameraPos.x / h) - n / 2) * h;
      const oz = (Math.floor(cameraPos.z / h) - n / 2) * h;
      const at = this._builtAt[i];
      if (
        this._regions[i].w > 0 &&
        at[0] === version &&
        at[1] === ox &&
        at[2] === oz &&
        at[3] === this._level
      ) {
        continue;
      }
      at[0] = version;
      at[1] = ox;
      at[2] = oz;
      at[3] = this._level;
      this.buildLevel(i, ox, oz, h);
      this._regions[i].setXYZW(ox, oz, h, n);
      this._rebuilds++;
    }
  }
  dispose() {
    this._seedA?.dispose();
    this._seedB?.dispose();
    this._wetA?.dispose();
    this._wetB?.dispose();
    this._probe?.dispose();
    this._result?.dispose();
    this._smooth?.dispose();
    this._smoothTemp?.dispose();
    this._seedA = this._seedB = this._wetA = this._wetB = null;
    this._probe = this._result = this._smoothTemp = null;
    this._smooth = null;
    for (const bgs of this._bindGroups) {
      bgs.seed.dispose();
      bgs.resolve.dispose();
      for (const bg of [...bgs.jfa, ...bgs.wetJfa, ...bgs.smooth]) {
        bg.dispose();
      }
    }
    this._bindGroups = [];
    for (const r of this._regions) {
      r.setXYZW(0, 0, 0, 0);
    }
  }
  /** Builds one level into its layer of the smoothed array. @internal */
  private buildLevel(index: number, ox: number, oz: number, h: number) {
    const device = getDevice();
    const n = this.resolution;
    const groups = n / WORKGROUP;
    const bgs = this._bindGroups[index];
    // Seed
    const seedBG = bgs.seed;
    seedBG.setValue('grid', new Vector4(ox, oz, h, this._level!));
    seedBG.setTexture('seedOut', this._seedA!);
    seedBG.setTexture('wetOut', this._wetA!);
    seedBG.setTexture('probeOut', this._probe!);
    this._source.applyBindGroup(seedBG);
    device.setProgram(this._seedProgram);
    device.setBindGroup(0, seedBG);
    device.compute(groups, groups, 1);
    // Jump flooding, halving the step down to one cell, from the shore and from the water side
    const flood = (a: Texture2D, b: Texture2D, bindGroups: BindGroup[]) => {
      let src = a;
      let dst = b;
      let pass = 0;
      for (let step = n / 2; step >= 1; step >>= 1, pass++) {
        const bg = bindGroups[pass];
        bg.setValue('step', new Vector4(step, n, 0, 0));
        bg.setTexture('seedIn', src, fetchSampler('clamp_nearest_nomip'));
        bg.setTexture('seedOut', dst);
        device.setProgram(this._jfaProgram);
        device.setBindGroup(0, bg);
        device.compute(groups, groups, 1);
        const t = src;
        src = dst;
        dst = t;
      }
      return src;
    };
    const seeds = flood(this._seedA!, this._seedB!, bgs.jfa);
    const wet = flood(this._wetA!, this._wetB!, bgs.wetJfa);
    // Resolve
    const rbg = bgs.resolve;
    rbg.setValue('grid', new Vector4(ox, oz, h, n));
    rbg.setTexture('seedIn', seeds, fetchSampler('clamp_nearest_nomip'));
    rbg.setTexture('probeIn', this._probe!, fetchSampler('clamp_nearest_nomip'));
    rbg.setTexture('result', this._result!);
    device.setProgram(this._resolveProgram);
    device.setBindGroup(0, rbg);
    device.compute(groups, groups, 1);
    // Smooth, separably: the first pass also turns the result into the signed distance
    for (let pass = 0; pass < 2; pass++) {
      const bg = bgs.smooth[pass];
      bg.setValue('smoothPass', new Vector4(pass, n, h, index));
      bg.setTexture('wetIn', wet, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture(
        'src',
        pass === 0 ? this._result! : this._smoothTemp!,
        fetchSampler('clamp_nearest_nomip')
      );
      bg.setTexture('dst', pass === 0 ? this._smoothTemp! : this._smooth!);
      device.setProgram(pass === 0 ? this._smoothHProgram : this._smoothVProgram);
      device.setBindGroup(0, bg);
      device.compute(groups, groups, 1);
    }
  }
  /** @internal */
  private ensureResources() {
    if (this._seedProgram) {
      return;
    }
    const device = getDevice();
    const n = this.resolution;
    const tex = (format: 'rg32f' | 'rgba16f') =>
      device.createTexture2D(format, n, n, { mipmapping: false, writable: true })!;
    this._seedA = tex('rg32f');
    this._seedB = tex('rg32f');
    this._wetA = tex('rg32f');
    this._wetB = tex('rg32f');
    this._probe = tex('rg32f');
    this._result = tex('rgba16f');
    this._result.name = `@Waterline${this._source.label}`;
    this._smoothTemp = tex('rgba16f');
    this._smooth = device.createTexture2DArray('rgba16f', n, n, this.levels, {
      mipmapping: false,
      writable: true
    })!;
    this._smooth.name = `@Waterline${this._source.label}Smooth`;
    const source = this._source;
    this._seedProgram = buildSDFProgram({
      label: `WaterlineSeed${source.label}`,
      workgroupSize: [WORKGROUP, WORKGROUP, 1],
      compute(pb) {
        // (origin x, origin z, cell size, water level)
        this.grid = pb.vec4().uniform(0);
        this.seedOut = pb.texStorage2D.rg32float().storage(0);
        this.wetOut = pb.texStorage2D.rg32float().storage(0);
        this.probeOut = pb.texStorage2D.rg32float().storage(0);
        source.declareUniforms(this);
        pb.main(function () {
          this.$l.id = this.$builtins.globalInvocationId.xy;
          this.$l.xz = pb.add(this.grid.xy, pb.mul(pb.add(pb.vec2(this.id), pb.vec2(0.5)), this.grid.z));
          this.$l.d = source.sampleDistance(this, pb.vec3(this.xz.x, this.grid.w, this.xz.y));
          // Half a cell up, for the vertical slope of the field
          this.$l.dUp = source.sampleDistance(
            this,
            pb.vec3(this.xz.x, pb.add(this.grid.w, pb.mul(this.grid.z, 0.5)), this.xz.y)
          );
          pb.textureStore(this.probeOut, this.id, pb.vec4(this.d, this.dUp, 0, 0));
          pb.textureStore(
            this.seedOut,
            this.id,
            this.$choice(
              pb.lessThan(this.d, 0),
              pb.vec4(pb.vec2(this.id), 0, 0),
              pb.vec4(NO_SEED, NO_SEED, 0, 0)
            )
          );
          pb.textureStore(
            this.wetOut,
            this.id,
            this.$choice(
              pb.lessThan(this.d, 0),
              pb.vec4(NO_SEED, NO_SEED, 0, 0),
              pb.vec4(pb.vec2(this.id), 0, 0)
            )
          );
        });
      }
    })!;
    this._jfaProgram = buildSDFProgram({
      label: 'WaterlineJFA',
      workgroupSize: [WORKGROUP, WORKGROUP, 1],
      compute(pb) {
        // (step, resolution, 0, 0)
        this.step = pb.vec4().uniform(0);
        this.seedIn = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.seedOut = pb.texStorage2D.rg32float().storage(0);
        pb.main(function () {
          this.$l.id = pb.ivec2(this.$builtins.globalInvocationId.xy);
          this.$l.n = pb.int(this.step.y);
          this.$l.s = pb.int(this.step.x);
          this.$l.p = pb.vec2(this.id);
          this.$l.best = pb.textureLoad(this.seedIn, this.id, 0).xy;
          this.$l.bestD = pb.dot(pb.sub(this.best, this.p), pb.sub(this.best, this.p));
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) {
                continue;
              }
              this.$l.q = pb.add(this.id, pb.mul(pb.ivec2(dx, dy), this.s));
              this.$if(
                pb.and(
                  pb.all(pb.greaterThanEqual(this.q, pb.ivec2(0))),
                  pb.all(pb.lessThan(this.q, pb.ivec2(this.n)))
                ),
                function () {
                  this.$l.c = pb.textureLoad(this.seedIn, this.q, 0).xy;
                  this.$l.cd = pb.dot(pb.sub(this.c, this.p), pb.sub(this.c, this.p));
                  this.$if(pb.lessThan(this.cd, this.bestD), function () {
                    this.best = this.c;
                    this.bestD = this.cd;
                  });
                }
              );
            }
          }
          pb.textureStore(this.seedOut, pb.uvec2(this.id), pb.vec4(this.best, 0, 0));
        });
      }
    })!;
    this._resolveProgram = buildSDFProgram({
      label: 'WaterlineResolve',
      workgroupSize: [WORKGROUP, WORKGROUP, 1],
      compute(pb) {
        // (origin x, origin z, cell size, resolution)
        this.grid = pb.vec4().uniform(0);
        this.seedIn = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.probeIn = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.result = pb.texStorage2D.rgba16float().storage(0);
        pb.main(function () {
          this.$l.id = this.$builtins.globalInvocationId.xy;
          this.$l.p = pb.vec2(this.id);
          this.$l.seed = pb.textureLoad(this.seedIn, pb.ivec2(this.id), 0).xy;
          this.$l.v = pb.sub(this.p, this.seed);
          this.$l.len = pb.length(this.v);
          // A seed is a whole solid cell: the shore is half a cell nearer than its centre
          this.$l.dist = pb.mul(pb.max(pb.sub(this.len, 0.5), 0), this.grid.z);
          // No shore anywhere on the grid: as far as the grid reaches
          this.dist = this.$choice(
            pb.lessThan(this.seed.x, NO_SEED * 0.5),
            pb.mul(this.grid.w, this.grid.z),
            this.dist
          );
          // Gradient of the field at the rest level: horizontally from the neighbouring
          // cells (one-sided at the grid edge), vertically from the probe above
          this.$l.ip = pb.ivec2(this.id);
          this.$l.last = pb.sub(pb.int(this.grid.w), 1);
          this.$l.probe = pb.textureLoad(this.probeIn, this.ip, 0).xy;
          this.$l.xl = pb.max(pb.sub(this.ip.x, 1), 0);
          this.$l.xr = pb.min(pb.add(this.ip.x, 1), this.last);
          this.$l.zl = pb.max(pb.sub(this.ip.y, 1), 0);
          this.$l.zr = pb.min(pb.add(this.ip.y, 1), this.last);
          this.$l.gx = pb.div(
            pb.sub(
              pb.textureLoad(this.probeIn, pb.ivec2(this.xr, this.ip.y), 0).x,
              pb.textureLoad(this.probeIn, pb.ivec2(this.xl, this.ip.y), 0).x
            ),
            pb.mul(pb.float(pb.sub(this.xr, this.xl)), this.grid.z)
          );
          this.$l.gz = pb.div(
            pb.sub(
              pb.textureLoad(this.probeIn, pb.ivec2(this.ip.x, this.zr), 0).x,
              pb.textureLoad(this.probeIn, pb.ivec2(this.ip.x, this.zl), 0).x
            ),
            pb.mul(pb.float(pb.sub(this.zr, this.zl)), this.grid.z)
          );
          this.$l.gy = pb.div(pb.sub(this.probe.y, this.probe.x), pb.mul(this.grid.z, 0.5));
          // A flat bed never meets the water: the model then says far away
          this.$l.gh = pb.max(pb.length(pb.vec2(this.gx, this.gz)), WATERLINE_MIN_SLOPE);
          this.$l.a = pb.clamp(pb.div(this.probe.x, this.gh), -WATERLINE_MODEL_CLAMP, WATERLINE_MODEL_CLAMP);
          this.$l.b = pb.clamp(pb.div(this.gy, this.gh), -WATERLINE_MODEL_CLAMP, WATERLINE_MODEL_CLAMP);
          pb.textureStore(this.result, this.id, pb.vec4(this.dist, this.a, this.b, this.probe.x));
        });
      }
    })!;
    this._smoothHProgram = buildSmoothProgram(false);
    this._smoothVProgram = buildSmoothProgram(true);
    const passes = Math.log2(n);
    for (let i = 0; i < this.levels; i++) {
      this._bindGroups.push({
        seed: device.createBindGroup(this._seedProgram.bindGroupLayouts[0]),
        jfa: Array.from({ length: passes }, () =>
          device.createBindGroup(this._jfaProgram!.bindGroupLayouts[0])
        ),
        wetJfa: Array.from({ length: passes }, () =>
          device.createBindGroup(this._jfaProgram!.bindGroupLayouts[0])
        ),
        resolve: device.createBindGroup(this._resolveProgram.bindGroupLayouts[0]),
        smooth: [
          device.createBindGroup(this._smoothHProgram.bindGroupLayouts[0]),
          device.createBindGroup(this._smoothVProgram.bindGroupLayouts[0])
        ]
      });
    }
  }
}

/**
 * One pass of the separable smoothing: horizontal from the resolved field
 * into a scratch texture, or vertical from it into a level's layer.
 */
function buildSmoothProgram(toArray: boolean) {
  return buildSDFProgram({
    label: toArray ? 'WaterlineSmoothV' : 'WaterlineSmoothH',
    workgroupSize: [WORKGROUP, WORKGROUP, 1],
    compute(pb) {
      // (pass: 0 horizontal from the resolved field, 1 vertical; resolution; cell size; layer)
      this.smoothPass = pb.vec4().uniform(0);
      this.src = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      // Nearest cell in the water, for the distance inland
      this.wetIn = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.dst = toArray
        ? pb.texStorage2DArray.rgba16float().storage(0)
        : pb.texStorage2D.rgba16float().storage(0);
      // Signed distance and B of a resolved texel: the bed model near the
      // shore, the jump-flooded distance farther out, blended over a couple
      // of metres. Inland, away from the model, the negated jump-flooded
      // distance from the water side (the resolved distance is 0 on land).
      pb.func('wlSigned', [pb.vec4('t'), pb.ivec2('q')], function () {
        this.$l.model = pb.and(
          pb.lessThan(pb.abs(this.t.w), SMOOTH_MODEL_REACH),
          pb.lessThan(pb.abs(this.t.y), SMOOTH_MODEL_CLAMP)
        );
        this.$l.wet = pb.textureLoad(this.wetIn, this.q, 0).xy;
        this.$l.inland = this.$choice(
          pb.lessThan(this.wet.x, NO_SEED * 0.5),
          pb.mul(this.smoothPass.y, this.smoothPass.z),
          pb.mul(pb.max(pb.sub(pb.length(pb.sub(pb.vec2(this.q), this.wet)), 0.5), 0), this.smoothPass.z)
        );
        this.$l.far = this.$choice(pb.lessThan(this.t.w, 0), pb.neg(this.inland), this.t.x);
        this.$l.w = this.$choice(
          this.model,
          pb.smoothStep(SMOOTH_BLEND_START, SMOOTH_BLEND_END, pb.abs(this.far)),
          1
        );
        this.$return(pb.vec2(pb.mix(this.t.y, this.far, this.w), this.$choice(this.model, this.t.z, 0)));
      });
      pb.main(function () {
        this.$l.id = pb.ivec2(this.$builtins.globalInvocationId.xy);
        this.$l.last = pb.sub(pb.int(this.smoothPass.y), 1);
        this.$l.axis = toArray ? pb.ivec2(0, 1) : pb.ivec2(1, 0);
        this.$l.acc = pb.vec2(0);
        this.$l.wsum = pb.float(0);
        for (let k = -SMOOTH_RADIUS; k <= SMOOTH_RADIUS; k++) {
          const w = Math.exp(-(k * k) / (2 * SMOOTH_SIGMA * SMOOTH_SIGMA));
          this.$l.q = pb.clamp(pb.add(this.id, pb.mul(this.axis, k)), pb.ivec2(0), pb.ivec2(this.last));
          this.$l.t = pb.textureLoad(this.src, this.q, 0);
          this.$l.v = toArray ? this.t.xy : this.wlSigned(this.t, this.q);
          this.acc = pb.add(this.acc, pb.mul(this.v, w));
          this.wsum = pb.add(this.wsum, w);
        }
        // Keep the bed unfiltered; the second pass carries its height through.
        this.$l.own = pb.textureLoad(this.src, this.id, 0);
        if (toArray) {
          pb.textureArrayStore(
            this.dst,
            pb.uvec2(this.id),
            pb.int(this.smoothPass.w),
            pb.vec4(pb.div(this.acc, this.wsum), this.own.z, 0)
          );
        } else {
          this.$l.bed = pb.neg(this.own.w);
          this.$if(
            pb.and(
              pb.lessThan(pb.abs(this.own.w), SMOOTH_MODEL_REACH),
              pb.and(
                pb.lessThan(pb.abs(this.own.y), SMOOTH_MODEL_CLAMP),
                pb.and(pb.greaterThan(this.own.z, 1e-3), pb.lessThan(this.own.z, WATERLINE_MODEL_CLAMP))
              )
            ),
            function () {
              // A + B * dy = 0 gives vertical bed height; -SDF is a normal distance.
              this.bed = pb.div(pb.neg(this.own.y), this.own.z);
            }
          );
          pb.textureStore(this.dst, pb.uvec2(this.id), pb.vec4(pb.div(this.acc, this.wsum), this.bed, 0));
        }
      });
    }
  });
}
