import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import { declareDynamicSDFUniforms, declareGlobalSDFUniforms, sampleSceneSDF } from '../../shaders/sdf';
import type { GlobalSDF } from './global_sdf';

/** Seed coordinate meaning "no seed yet". */
const NO_SEED = -1e5;
const WORKGROUP = 8;
/** Horizontal field gradient below which the bed counts as flat. */
const WATERLINE_MIN_SLOPE = 0.02;
/** Bound of the linear model coefficients, within half float range. */
const WATERLINE_MODEL_CLAMP = 10000;

/**
 * Horizontal distance to the waterline around the camera: on a square grid at
 * the rest level of a body of water, the distance in world units from each
 * cell to the nearest point where the scene's geometry pierces that level.
 *
 * This is what a shoreline effect wants rather than the distance to the
 * nearest solid in 3D, which over a gently shelving bed is the water depth
 * and spreads a shoreline band metres wide across a beach. Here a beach and a
 * piling both get a band measured outwards from where they meet the water.
 *
 * Rebuilt every frame on the GPU from the scene field, so dynamic geometry (a
 * boat hull) moves its waterline with it:
 *
 * 1. Seed: a cell whose centre is inside geometry at the water level is its own nearest shore.
 * 2. Jump flooding, log2(resolution) passes, carries the nearest seed across the grid.
 * 3. Resolve, into an rgba16f texture sampled linearly by consumers:
 *    - x: distance to the nearest seed, the waterline at the rest level;
 *    - y, z: a linear model of the geometry around the cell, A and B with the horizontal distance
 *      to the waterline at a height `level + dy` being `A + B * dy`;
 *    - w: the field value at the cell at the rest level, telling how far the linear model holds.
 *
 * The linear model is what follows the waves. On a beach shelving at angle a, a surface raised
 * by dy moves its edge dy / tan(a) inland, metres for a small swell on a gentle slope, so a band
 * measured from the rest-level line would sit out in the water. From the field value s and its
 * gradient g at the rest level, the geometry near the cell is the plane s + g.(p - p0) = 0, and
 * at height dy that plane is crossed (s + g.y * dy) / |g.xz| away horizontally: A = s / |g.xz|,
 * B = g.y / |g.xz|. Exact for a planar bed, it holds near the shore, where it is needed; farther
 * out the jump-flooded distance answers.
 *
 * Accurate to about half a cell (0.125 m by default). WebGPU only, as the scene field is.
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
  /** (field at the rest level, field half a cell above) per cell. */
  private _probe: Nullable<Texture2D>;
  private _result: Nullable<Texture2D>;
  private _seedProgram: Nullable<GPUProgram>;
  private _jfaProgram: Nullable<GPUProgram>;
  private _resolveProgram: Nullable<GPUProgram>;
  private _seedBindGroup: Nullable<BindGroup>;
  private _jfaBindGroups: BindGroup[];
  private _resolveBindGroup: Nullable<BindGroup>;
  /** (origin x, origin z, cell size, resolution) of the grid as last built. */
  private readonly _region: Vector4;
  private _built: boolean;
  constructor(global: GlobalSDF, resolution = 512, cellSize = 0.25) {
    this._global = global;
    this.resolution = Math.max(16, 2 ** Math.round(Math.log2(resolution)));
    this.cellSize = Math.max(1e-3, cellSize);
    this._level = null;
    this._requested = false;
    this._seedA = null;
    this._seedB = null;
    this._probe = null;
    this._result = null;
    this._seedProgram = null;
    this._jfaProgram = null;
    this._resolveProgram = null;
    this._seedBindGroup = null;
    this._jfaBindGroups = [];
    this._resolveBindGroup = null;
    this._region = new Vector4(0, 0, this.cellSize, this.resolution);
    this._built = false;
  }
  /** World Y the field is built at, or null before anything asked for it. */
  get level() {
    return this._level;
  }
  /** True once a grid has been built and {@link WaterlineField.texture} holds it. */
  get ready() {
    return this._built;
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
    this._region.setXYZW(ox, oz, h, n);
    const groups = n / WORKGROUP;
    // Seed
    const seedBG = this._seedBindGroup!;
    seedBG.setValue('grid', new Vector4(ox, oz, h, this._level));
    seedBG.setTexture('seedOut', this._seedA!);
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
    // Resolve
    const rbg = this._resolveBindGroup!;
    rbg.setValue('grid', new Vector4(ox, oz, h, n));
    rbg.setTexture('seedIn', src, fetchSampler('clamp_nearest_nomip'));
    rbg.setTexture('probeIn', this._probe!, fetchSampler('clamp_nearest_nomip'));
    rbg.setTexture('result', this._result!);
    device.setProgram(this._resolveProgram);
    device.setBindGroup(0, rbg);
    device.compute(groups, groups, 1);
    this._built = true;
  }
  dispose() {
    this._seedA?.dispose();
    this._seedB?.dispose();
    this._probe?.dispose();
    this._result?.dispose();
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
    this._probe = tex('rg32f');
    this._result = tex('rgba16f');
    this._result.name = '@WaterlineField';
    const levels = this._global.levels;
    this._seedProgram = device.buildComputeProgram({
      label: 'WaterlineSeed',
      workgroupSize: [WORKGROUP, WORKGROUP, 1],
      compute(pb) {
        // (origin x, origin z, cell size, water level)
        this.grid = pb.vec4().uniform(0);
        this.seedOut = pb.texStorage2D.rg32float().storage(0);
        this.probeOut = pb.texStorage2D.rg32float().storage(0);
        declareGlobalSDFUniforms(this, 0, levels);
        declareDynamicSDFUniforms(this, 0);
        pb.main(function () {
          this.$l.id = this.$builtins.globalInvocationId.xy;
          this.$l.xz = pb.add(this.grid.xy, pb.mul(pb.add(pb.vec2(this.id), pb.vec2(0.5)), this.grid.z));
          this.$l.d = sampleSceneSDF(this, pb.vec3(this.xz.x, this.grid.w, this.xz.y), levels);
          // Half a cell up, for the vertical slope of the field
          this.$l.dUp = sampleSceneSDF(
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
        });
      }
    })!;
    this._jfaProgram = device.buildComputeProgram({
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
    this._resolveProgram = device.buildComputeProgram({
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
  }
}
