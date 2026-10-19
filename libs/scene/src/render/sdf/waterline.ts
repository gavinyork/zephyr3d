import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import { declareDynamicSDFUniforms, declareGlobalSDFUniforms, sampleGlobalSDF } from '../../shaders/sdf';
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

/**
 * Horizontal distance to the waterline around the camera: on a square grid at
 * the rest level of a body of water, the distance in world units from each
 * cell to the nearest point where the scene's geometry pierces that level.
 *
 * Unlike the 3D distance to the nearest solid (the water depth over a gently
 * shelving bed), this measures shoreline bands outwards from where geometry
 * meets the water.
 *
 * Rebuilt on the GPU from the global clipmap, static geometry and the terrain
 * only: dynamic instances (a boat, a car wading in) are not shores and would
 * ring themselves with shore waves and foam. Steps:
 *
 * 1. Seed: a cell whose centre is inside geometry at the water level is its own nearest shore.
 * 2. Jump flooding, log2(resolution) passes, carries the nearest seed across the grid.
 * 3. Resolve, into an rgba16f texture sampled linearly by consumers:
 *    - x: distance to the nearest seed, the waterline at the rest level;
 *    - y, z: a linear model of the geometry around the cell, A and B with the horizontal distance
 *      to the waterline at a height `level + dy` being `A + B * dy`;
 *    - w: the field value at the cell at the rest level, telling how far the linear model holds.
 *
 * The linear model lets the waterline follow the waves (a surface raised by dy moves the edge
 * dy / tan(a) inland on a slope of angle a). From the field value s and its gradient g at the rest
 * level, the geometry near the cell is the plane s + g.(p - p0) = 0, crossed at height dy
 * (s + g.y * dy) / |g.xz| away horizontally: A = s / |g.xz|, B = g.y / |g.xz|. Exact for a planar
 * bed; farther from the shore the jump-flooded distance is used.
 *
 * The jump-flooded distance is accurate to about half a cell (0.25 m by default). WebGPU only, as the scene field is.
 *
 * @public
 */
export class WaterlineField {
  readonly resolution: number;
  readonly cellSize: number;
  private readonly _global: GlobalSDF;
  private _level: Nullable<number>;
  private _requested: boolean;
  private _seedA: Nullable<Texture2D>;
  private _seedB: Nullable<Texture2D>;
  /** Seeds in the water, flooded for the distance inland from it; and the pass between. */
  private _wetA: Nullable<Texture2D>;
  private _wetB: Nullable<Texture2D>;
  private _wetJfaBindGroups: BindGroup[];
  /** (field at the rest level, field half a cell above) per cell. */
  private _probe: Nullable<Texture2D>;
  private _result: Nullable<Texture2D>;
  /** Smoothed shore coordinates, see {@link WaterlineField.smoothTexture}; and the pass between. */
  private _smooth: Nullable<Texture2D>;
  private _smoothTemp: Nullable<Texture2D>;
  private _smoothProgram: Nullable<GPUProgram>;
  private _smoothBindGroups: BindGroup[];
  private _seedProgram: Nullable<GPUProgram>;
  private _jfaProgram: Nullable<GPUProgram>;
  private _resolveProgram: Nullable<GPUProgram>;
  private _seedBindGroup: Nullable<BindGroup>;
  private _jfaBindGroups: BindGroup[];
  private _resolveBindGroup: Nullable<BindGroup>;
  /** (origin x, origin z, cell size, resolution) of the grid as last built. */
  private readonly _region: Vector4;
  private _built: boolean;
  /** Content version of the global field, origin and level the grid was last built at. */
  private _builtVersion: number;
  private readonly _builtAt: [number, number, number];
  /** Defaults to 256 cells of 0.5 m: 128 m around the camera. */
  constructor(global: GlobalSDF, resolution = 256, cellSize = 0.5) {
    this._builtVersion = -1;
    this._builtAt = [NaN, NaN, NaN];
    this._global = global;
    this.resolution = Math.max(16, 2 ** Math.round(Math.log2(resolution)));
    this.cellSize = Math.max(1e-3, cellSize);
    this._level = null;
    this._requested = false;
    this._seedA = null;
    this._seedB = null;
    this._wetA = null;
    this._wetB = null;
    this._wetJfaBindGroups = [];
    this._probe = null;
    this._result = null;
    this._smooth = null;
    this._smoothTemp = null;
    this._smoothProgram = null;
    this._smoothBindGroups = [];
    this._seedProgram = null;
    this._jfaProgram = null;
    this._resolveProgram = null;
    this._seedBindGroup = null;
    this._jfaBindGroups = [];
    this._resolveBindGroup = null;
    this._region = new Vector4(0, 0, this.cellSize, this.resolution);
    this._built = false;
  }
  /** Grids built so far, for diagnosis. */
  get rebuilds() {
    return this._rebuilds;
  }
  private _rebuilds = 0;
  /** World Y the field is built at, or null before anything asked for it. */
  get level() {
    return this._level;
  }
  /** True once a grid has been built and {@link WaterlineField.texture} holds it. */
  get ready() {
    return this._built;
  }
  /**
   * Smooth shore coordinates per cell, rgba16f, for effects that build
   * geometry on them (see ShoreWaveGenerator): (signed distance to the
   * waterline, negative inland; B of the bed model; height of the bed over the
   * rest level; 0). The first two are Gaussian-filtered over about two metres;
   * the bed height is the cell's own, so it matches the ground.
   */
  get smoothTexture() {
    return this._built ? this._smooth : null;
  }
  /** (rest-level distance, model A, model B, field at the rest level) per cell, rgba16f. */
  get texture() {
    return this._result;
  }
  /** (origin x, origin z, cell size, resolution) of the grid, for sampling. */
  get region() {
    return this._region;
  }
  /**
   * Asks for the field at a water level this frame. Without a request in a
   * frame it is not rebuilt; with several, the last one wins.
   */
  request(level: number) {
    this._level = level;
    this._requested = true;
  }
  /** Rebuilds the grid around the camera when requested. Called by the global field after compositing. */
  update(cameraPos: Vector3) {
    if (!this._requested || this._level === null) {
      return;
    }
    this._requested = false;
    const n = this.resolution;
    const h = this.cellSize;
    const device = getDevice();
    this.ensureResources();
    // Snapped to cells, so the grid does not swim as the camera moves
    const ox = (Math.floor(cameraPos.x / h) - n / 2) * h;
    const oz = (Math.floor(cameraPos.z / h) - n / 2) * h;
    const version = this._global.staticVersion;
    const at = this._builtAt;
    if (
      this._built &&
      version === this._builtVersion &&
      at[0] === ox &&
      at[1] === oz &&
      at[2] === this._level
    ) {
      return;
    }
    this._builtVersion = version;
    at[0] = ox;
    at[1] = oz;
    at[2] = this._level;
    this._rebuilds++;
    this._region.setXYZW(ox, oz, h, n);
    const groups = n / WORKGROUP;
    // Seed
    const seedBG = this._seedBindGroup!;
    seedBG.setValue('grid', new Vector4(ox, oz, h, this._level));
    seedBG.setTexture('seedOut', this._seedA!);
    seedBG.setTexture('wetOut', this._wetA!);
    seedBG.setTexture('probeOut', this._probe!);
    this._global.applyBindGroup(seedBG);
    device.setProgram(this._seedProgram);
    device.setBindGroup(0, seedBG);
    device.compute(groups, groups, 1);
    // Jump flooding, halving the step down to one cell
    let src = this._seedA!;
    let dst = this._seedB!;
    let pass = 0;
    for (let step = n / 2; step >= 1; step >>= 1, pass++) {
      if (!this._jfaBindGroups[pass]) {
        this._jfaBindGroups[pass] = device.createBindGroup(this._jfaProgram!.bindGroupLayouts[0]);
      }
      const bg = this._jfaBindGroups[pass];
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
    // The same from the water side, for the distance inland
    let wetSrc = this._wetA!;
    let wetDst = this._wetB!;
    pass = 0;
    for (let step = n / 2; step >= 1; step >>= 1, pass++) {
      if (!this._wetJfaBindGroups[pass]) {
        this._wetJfaBindGroups[pass] = device.createBindGroup(this._jfaProgram!.bindGroupLayouts[0]);
      }
      const bg = this._wetJfaBindGroups[pass];
      bg.setValue('step', new Vector4(step, n, 0, 0));
      bg.setTexture('seedIn', wetSrc, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('seedOut', wetDst);
      device.setProgram(this._jfaProgram);
      device.setBindGroup(0, bg);
      device.compute(groups, groups, 1);
      const t = wetSrc;
      wetSrc = wetDst;
      wetDst = t;
    }
    // Resolve
    const rbg = this._resolveBindGroup!;
    rbg.setValue('grid', new Vector4(ox, oz, h, n));
    rbg.setTexture('seedIn', src, fetchSampler('clamp_nearest_nomip'));
    rbg.setTexture('probeIn', this._probe!, fetchSampler('clamp_nearest_nomip'));
    rbg.setTexture('result', this._result!);
    device.setProgram(this._resolveProgram);
    device.setBindGroup(0, rbg);
    device.compute(groups, groups, 1);
    // Smooth, separably: the first pass also turns the result into the signed distance
    for (let pass = 0; pass < 2; pass++) {
      if (!this._smoothBindGroups[pass]) {
        this._smoothBindGroups[pass] = device.createBindGroup(this._smoothProgram!.bindGroupLayouts[0]);
      }
      const bg = this._smoothBindGroups[pass];
      bg.setValue('smoothPass', new Vector4(pass, n, h, 0));
      bg.setTexture('wetIn', wetSrc, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture(
        'src',
        pass === 0 ? this._result! : this._smoothTemp!,
        fetchSampler('clamp_nearest_nomip')
      );
      bg.setTexture('dst', pass === 0 ? this._smoothTemp! : this._smooth!);
      device.setProgram(this._smoothProgram);
      device.setBindGroup(0, bg);
      device.compute(groups, groups, 1);
    }
    this._built = true;
  }
  dispose() {
    this._seedA?.dispose();
    this._seedB?.dispose();
    this._wetA?.dispose();
    this._wetB?.dispose();
    this._wetA = this._wetB = null;
    for (const bg of this._wetJfaBindGroups) {
      bg.dispose();
    }
    this._wetJfaBindGroups = [];
    this._probe?.dispose();
    this._result?.dispose();
    this._smooth?.dispose();
    this._smoothTemp?.dispose();
    for (const bg of this._smoothBindGroups) {
      bg.dispose();
    }
    this._smooth = this._smoothTemp = null;
    this._smoothBindGroups = [];
    this._seedBindGroup?.dispose();
    this._resolveBindGroup?.dispose();
    for (const bg of this._jfaBindGroups) {
      bg.dispose();
    }
    this._seedA = this._seedB = this._probe = this._result = null;
    this._seedBindGroup = this._resolveBindGroup = null;
    this._jfaBindGroups = [];
    this._built = false;
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
    this._smooth = tex('rgba16f');
    this._smooth.name = '@WaterlineSmooth';
    this._smoothTemp = tex('rgba16f');
    this._result.name = '@WaterlineField';
    const levels = this._global.levels;
    this._seedProgram = buildSDFProgram({
      label: 'WaterlineSeed',
      workgroupSize: [WORKGROUP, WORKGROUP, 1],
      compute(pb) {
        // (origin x, origin z, cell size, water level)
        this.grid = pb.vec4().uniform(0);
        this.seedOut = pb.texStorage2D.rg32float().storage(0);
        this.wetOut = pb.texStorage2D.rg32float().storage(0);
        this.probeOut = pb.texStorage2D.rg32float().storage(0);
        declareGlobalSDFUniforms(this, 0, levels);
        // Unsampled, declared for GlobalSDF.applyBindGroup
        declareDynamicSDFUniforms(this, 0);
        pb.main(function () {
          this.$l.id = this.$builtins.globalInvocationId.xy;
          this.$l.xz = pb.add(this.grid.xy, pb.mul(pb.add(pb.vec2(this.id), pb.vec2(0.5)), this.grid.z));
          this.$l.d = sampleGlobalSDF(this, pb.vec3(this.xz.x, this.grid.w, this.xz.y), levels);
          // Half a cell up, for the vertical slope of the field
          this.$l.dUp = sampleGlobalSDF(
            this,
            pb.vec3(this.xz.x, pb.add(this.grid.w, pb.mul(this.grid.z, 0.5)), this.xz.y),
            levels
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
    this._seedBindGroup = device.createBindGroup(this._seedProgram.bindGroupLayouts[0]);
    this._resolveBindGroup = device.createBindGroup(this._resolveProgram.bindGroupLayouts[0]);
    this._smoothProgram = buildSDFProgram({
      label: 'WaterlineSmooth',
      workgroupSize: [WORKGROUP, WORKGROUP, 1],
      compute(pb) {
        // (pass: 0 horizontal from the resolved field, 1 vertical; resolution; cell size)
        this.smoothPass = pb.vec4().uniform(0);
        this.src = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        // Nearest cell in the water, for the distance inland
        this.wetIn = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.dst = pb.texStorage2D.rgba16float().storage(0);
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
          this.$l.axis = this.$choice(pb.lessThan(this.smoothPass.x, 0.5), pb.ivec2(1, 0), pb.ivec2(0, 1));
          this.$l.acc = pb.vec2(0);
          this.$l.wsum = pb.float(0);
          for (let k = -SMOOTH_RADIUS; k <= SMOOTH_RADIUS; k++) {
            const w = Math.exp(-(k * k) / (2 * SMOOTH_SIGMA * SMOOTH_SIGMA));
            this.$l.q = pb.clamp(pb.add(this.id, pb.mul(this.axis, k)), pb.ivec2(0), pb.ivec2(this.last));
            this.$l.t = pb.textureLoad(this.src, this.q, 0);
            this.$l.v = this.$choice(
              pb.lessThan(this.smoothPass.x, 0.5),
              this.wlSigned(this.t, this.q),
              this.t.xy
            );
            this.acc = pb.add(this.acc, pb.mul(this.v, w));
            this.wsum = pb.add(this.wsum, w);
          }
          // The bed height, unfiltered: over the rest level, the negated field there
          this.$l.own = pb.textureLoad(this.src, this.id, 0);
          this.$l.bed = this.$choice(pb.lessThan(this.smoothPass.x, 0.5), pb.neg(this.own.w), this.own.z);
          pb.textureStore(this.dst, pb.uvec2(this.id), pb.vec4(pb.div(this.acc, this.wsum), this.bed, 0));
        });
      }
    });
  }
}
