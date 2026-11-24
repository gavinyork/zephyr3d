import type { AABB, Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, Vector2, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  Texture2DArray
} from '@zephyr3d/device';
import { getDevice } from '../app/api';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import type { WaveGenerator } from './wavegenerator';
import { ShaderHelper } from '../material/shader/helper';
import { RenderGraphExecutor } from './rendergraph/executor';

/**
 * The foam field is stepped at a fixed rate: FOAM_FIELD_FREQUENCY steps per
 * second, each advecting the field by the water's velocity, fading it and
 * adding what the sources make; at most FOAM_FIELD_MAX_STEPS catch up per
 * frame.
 */
const FOAM_FIELD_FREQUENCY = 30;
const FOAM_FIELD_MAX_STEPS = 8;
/**
 * Levels of the field: all centred on the view, each twice the size of the one
 * before at the same number of cells; an advection that would read off a level
 * reads the next coarser one instead. The material reads the finest level
 * holding a point, blended into the next over its edge.
 *
 * Level i steps once every 2^i steps of the finest, over that much time: its
 * cells are 2^i times as wide, so the foam crosses as many of them in a step
 * (refined in time as in space, Berger & Oliger, "Adaptive Mesh Refinement for
 * Hyperbolic Partial Differential Equations", J. Comput. Phys. 53, 1984). The
 * coarser levels take turns, level i at the steps n with n mod 2^i = 2^(i-1),
 * so no step works out more than two levels.
 */
const FOAM_FIELD_LEVELS = 4;
/** All the levels, as a mask of them. */
const FOAM_FIELD_ALL_LEVELS = (1 << FOAM_FIELD_LEVELS) - 1;
/** Steps of the finest level after which the turns of the coarser levels repeat. */
const FOAM_FIELD_CYCLE = 1 << (FOAM_FIELD_LEVELS - 1);
/** Cells along each side of a level. */
const FOAM_FIELD_CELLS = 256;
/** Threads along each side of a workgroup of the compute step. */
const FOAM_FIELD_GROUP_SIZE = 8;
/**
 * Share of a level, from each edge inwards, over which its coverage falls to
 * 0, so the foam with memory hands over to the foam without it with no seam.
 */
const FOAM_FIELD_EDGE_BLEND = 0.15;
/**
 * Gain on the foam the waves make: foam is added at FOAM_WAVE_GAIN times the
 * strength times how squeezed the water is, per second.
 */
export const FOAM_WAVE_GAIN = 5;

/**
 * What feeds the foam field and carries it about: the water's velocity and the
 * foam made at a point, worked out in the field's step.
 * @public
 */
export interface FoamFieldSource {
  /** Identifies the step shader the source builds into; equal keys share a program. */
  readonly foamSourceKey: string;
  /** Declares the uniforms {@link FoamFieldSource.calcFoamStep} reads, in bind group 0. */
  setupFoamSourceUniforms(scope: PBGlobalScope): void;
  /** Sets the uniforms {@link FoamFieldSource.setupFoamSourceUniforms} declared. */
  applyFoamSourceBindGroup(bindGroup: BindGroup): void;
  /**
   * The water's velocity at an undisplaced XZ and the foam made there this
   * step, as vec4(velocity x, velocity z, foam added, wall foam added). Wall
   * foam is a layer of its own, carried and faded as the foam is, which the
   * water shows whole where it is, by its strength, rather than cutting from
   * the foam texture by its density.
   * @param dt - Seconds this step covers, 0 for a step that only moves the grid.
   * @param fadeRate - The field's fade rate per second, for prewarming.
   * @param prewarm - True on the first step, which fills the field as if the
   *   sources had been running for a while.
   * @param state - inout vec4: two floats the field keeps per cell for its
   *   sources, held in place rather than carried with the foam, in xy, and
   *   in w the seconds since the source last wrote them, or a negative value
   *   where they hold nothing yet. What the source leaves in xy is kept at
   *   the last step of a frame.
   * @param shape - inout vec2, (0, 1) on entry: in x a density the foam here
   *   is raised to at least this step, for foam whose amount the source knows
   *   outright rather than as a rate; in y the share of the fade rate the foam
   *   here fades at.
   * @param cell - Side in metres of the cell the step works out. A level's
   *   grid holds nothing finer, so a source reads its own fields filtered over
   *   it rather than at a point, which would alias what is finer into the field.
   */
  calcFoamStep(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp,
    prewarm: PBShaderExp,
    state: PBShaderExp,
    shape: PBShaderExp,
    cell: PBShaderExp
  ): PBShaderExp;
}

/** @internal */
interface FoamStepProgram {
  program: GPUProgram;
  bindGroup: BindGroup;
  /** A compute program stepping every level in one dispatch, else a fragment program drawing one level */
  compute: boolean;
}

/**
 * Foam with memory: a scalar field over the water, carried by the water's
 * velocity, fading over time and fed by its sources. FOAM_FIELD_LEVELS levels
 * of square grids that the water moves along with the view, each twice the
 * size of the one before; a move of a grid is carried over in the next step,
 * new cells starting with what the next coarser level holds there, if any.
 * @public
 */
export class WaterFoamField extends Disposable {
  /** Ping-pong pair of arrays, a layer per level: the foam in r, the wall foam in g, the sources' state in ba. */
  private _arrays: Nullable<[Texture2DArray, Texture2DArray]>;
  /** Fragment path: a framebuffer on each array of the pair */
  private _framebuffers: Nullable<[FrameBuffer, FrameBuffer]>;
  private _current: number;
  /** Per level: (origin x, origin z, cell size, cells) as the field holds it; 0 cells before it does. */
  private readonly _regions: Vector4[];
  /** Per level: where the grid goes this frame. */
  private readonly _targets: Vector4[];
  /** Compute path: the targets, a vec4 per level */
  private readonly _levelRegions: Float32Array<ArrayBuffer>;
  /** Compute path: where the levels lay at the last step, a vec4 per level and one of 0 cells past the coarsest */
  private readonly _levelPrevRegions: Float32Array<ArrayBuffer>;
  private _programs: Map<string, FoamStepProgram>;
  private _timeToSimulate: number;
  private _lastTime: number;
  /** Per level: clock at which the sources last wrote its per-cell state; negative for never. */
  private readonly _stateTimes: number[];
  /** Per level: seconds since then, as of this frame. */
  private readonly _sinceState: number[];
  /** Per level: steps of the finest level since it last stepped, the time its next step covers. */
  private readonly _pendingSteps: number[];
  /** Per level: the last step of this frame that works it out, -1 for none. */
  private readonly _lastSteps: number[];
  /** Per step of this frame: the levels it works out, as a mask. */
  private readonly _stepMasks: number[];
  /** Steps of the finest level since prewarming, modulo FOAM_FIELD_CYCLE: whose turn it is. */
  private _stepCount: number;
  private _prewarm: boolean;
  private _fadeRate: number;
  private _size: number;
  private _baseStrength: number;
  private _drift: number;
  /** Velocity the foam drifts at on the wind, metres per second. */
  private readonly _driftVelocity: Vector2;
  private _dummy: Nullable<Texture2DArray>;
  /** (seconds a step of the finest level covers, fade rate, prewarm, level on the fragment path) */
  private readonly _params: Vector4;
  /**
   * Per level: (seconds its step covers, steps of the finest level it covers,
   * seconds since its sources' state was written, 0 kept as it is / 1 stepped /
   * 2 stepped and writing the state)
   */
  private readonly _levelParams: Vector4[];
  /** Compute path: the level parameters, a vec4 per level */
  private readonly _levelParamArray: Float32Array<ArrayBuffer>;
  private _version: number;
  constructor() {
    super();
    this._arrays = null;
    this._framebuffers = null;
    this._current = 0;
    this._regions = [];
    this._targets = [];
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      this._regions.push(new Vector4());
      this._targets.push(new Vector4());
    }
    this._levelRegions = new Float32Array(FOAM_FIELD_LEVELS * 4);
    this._levelPrevRegions = new Float32Array((FOAM_FIELD_LEVELS + 1) * 4);
    this._levelParams = Array.from({ length: FOAM_FIELD_LEVELS }, () => new Vector4());
    this._levelParamArray = new Float32Array(FOAM_FIELD_LEVELS * 4);
    this._stateTimes = new Array<number>(FOAM_FIELD_LEVELS).fill(-1);
    this._sinceState = new Array<number>(FOAM_FIELD_LEVELS).fill(0);
    this._pendingSteps = new Array<number>(FOAM_FIELD_LEVELS).fill(0);
    this._lastSteps = new Array<number>(FOAM_FIELD_LEVELS).fill(-1);
    this._stepMasks = new Array<number>(FOAM_FIELD_MAX_STEPS).fill(0);
    this._stepCount = 0;
    this._programs = new Map();
    this._timeToSimulate = 0;
    this._lastTime = -1;
    this._prewarm = true;
    this._fadeRate = 0.8;
    this._size = 128;
    this._baseStrength = 1;
    this._drift = 0.03;
    this._driftVelocity = new Vector2();
    this._dummy = null;
    this._params = new Vector4();
    this._version = 0;
  }
  /** How fast the foam fades, per second. */
  get fadeRate() {
    return this._fadeRate;
  }
  set fadeRate(val: number) {
    this._fadeRate = Math.max(1e-3, val);
  }
  /**
   * Side in metres of the finest level, the square of water around the view
   * that keeps its foam in the most detail; each further level doubles it.
   */
  get size() {
    return this._size;
  }
  set size(val: number) {
    this._size = Math.max(8, val);
  }
  /**
   * Scale of the foam the open water's breaking crests leave behind: 0 leaves
   * foam only while the crest breaks.
   */
  get baseStrength() {
    return this._baseStrength;
  }
  set baseStrength(val: number) {
    this._baseStrength = Math.max(0, val);
  }
  /**
   * Share of the wind speed the foam drifts at. Floating objects drift at
   * about 3% of the wind relative to the water, about sqrt(rho_air /
   * rho_water) (Wagner, Dell & Eisenman, "How Winds and Ocean Currents
   * Influence the Drift of Floating Objects", JPO 52(5), 2022).
   */
  get drift() {
    return this._drift;
  }
  set drift(val: number) {
    this._drift = Math.max(0, val);
  }
  /** Changes every step, for bind groups that only upload on a change. */
  get version() {
    return this._version;
  }
  /**
   * Places the levels around a point of the water, each on whole cells of its
   * own so that the field is carried over without resampling while the point
   * stays put, and steps the field to a clock time there. The time behind is
   * caught up in fixed steps of 1 / FOAM_FIELD_FREQUENCY, which the coarser
   * levels take in turns (see FOAM_FIELD_LEVELS). A level not stepped stays
   * where it lies: its next step carries it over to where it then goes, so it
   * trails the point by at most a step of its own, and the material reads the
   * field where it holds it either way. The first step prewarms every level.
   * @param focusX - World x the levels are centred on.
   * @param focusZ - World z the levels are centred on.
   * @param time - Clock in seconds.
   * @param wind - Wind velocity in metres per second, or null for none.
   * @param source - What feeds the field and carries it.
   */
  stepAround(
    focusX: number,
    focusZ: number,
    time: number,
    wind: Nullable<Immutable<Vector2>>,
    source: FoamFieldSource
  ) {
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      const size = this._size * (1 << i);
      const cell = size / FOAM_FIELD_CELLS;
      const half = size * 0.5;
      this._targets[i].setXYZW(
        Math.floor((focusX - half) / cell) * cell,
        Math.floor((focusZ - half) / cell) * cell,
        cell,
        FOAM_FIELD_CELLS
      );
    }
    this._driftVelocity.setXY((wind?.x ?? 0) * this._drift, (wind?.y ?? 0) * this._drift);
    const device = getDevice();
    this.ensureArrays(device);
    const dt = this._lastTime < 0 ? 0 : Math.min(Math.max(time - this._lastTime, 0), 0.25);
    this._lastTime = time;
    this._version++;
    this._timeToSimulate += dt;
    let steps = Math.floor(this._timeToSimulate * FOAM_FIELD_FREQUENCY);
    let stepDt = 1 / FOAM_FIELD_FREQUENCY;
    if (steps > FOAM_FIELD_MAX_STEPS) {
      steps = FOAM_FIELD_MAX_STEPS;
      this._timeToSimulate = 0;
    } else {
      this._timeToSimulate -= steps * stepDt;
    }
    if (steps === 0) {
      if (!this._prewarm) {
        return;
      }
      steps = 1;
      stepDt = 0;
    }
    const { program, bindGroup, compute } = this.getStepProgram(device, source);
    source.applyFoamSourceBindGroup(bindGroup);
    bindGroup.setValue('ffDrift', this._driftVelocity);
    // The levels each step works out: the finest, and the coarser one whose
    // turn it is; on prewarming all of them
    for (let step = 0; step < steps; step++) {
      if (step === 0 && this._prewarm) {
        this._stepMasks[step] = FOAM_FIELD_ALL_LEVELS;
      } else {
        this._stepMasks[step] = WaterFoamField.levelsSteppedAt(this._stepCount);
        this._stepCount = (this._stepCount + 1) % FOAM_FIELD_CYCLE;
      }
    }
    // A level's sources' state is of the water as it is this frame, which all
    // its steps of the frame see alike: it is read as of the last frame that
    // wrote it and written at its last step of the frame
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      this._sinceState[i] = this._stateTimes[i] < 0 ? 0 : Math.max(time - this._stateTimes[i], 0);
      this._lastSteps[i] = -1;
      for (let step = 0; step < steps; step++) {
        if ((this._stepMasks[step] >> i) & 1) {
          this._lastSteps[i] = step;
        }
      }
    }
    const sampler = fetchSampler('clamp_linear_nomip');
    device.pushDeviceStates();
    for (let step = 0; step < steps; step++) {
      const mask = this._stepMasks[step];
      for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
        // Every level has the time of a step of the finest to cover
        if (stepDt > 0) {
          this._pendingSteps[i]++;
        }
        const stepped = ((mask >> i) & 1) !== 0;
        const covered = stepped ? this._pendingSteps[i] : 0;
        if (stepped) {
          this._pendingSteps[i] = 0;
        }
        this._levelParams[i].setXYZW(
          covered * stepDt,
          covered,
          this._sinceState[i],
          stepped ? (step === this._lastSteps[i] ? 2 : 1) : 0
        );
      }
      bindGroup.setTexture('ffSrc', this._arrays![this._current], sampler);
      // Timed apart, so a frame catching up shows how many steps it took
      RenderGraphExecutor.profileScope('FoamStep', () => {
        if (compute) {
          // Every level in one dispatch, the level its third dimension; a level
          // kept as it is stays where it lies
          for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
            this._levelRegions.set((mask >> i) & 1 ? this._targets[i] : this._regions[i], i * 4);
            this._levelPrevRegions.set(this._regions[i], i * 4);
            this._levelParamArray.set(this._levelParams[i], i * 4);
          }
          bindGroup.setValue('ffRegions', this._levelRegions);
          bindGroup.setValue('ffPrevRegions', this._levelPrevRegions);
          bindGroup.setValue('ffLevelParams', this._levelParamArray);
          this._params.setXYZW(stepDt, this._fadeRate, this._prewarm ? 1 : 0, 0);
          bindGroup.setValue('ffParams', this._params);
          bindGroup.setTexture('ffDst', this._arrays![1 - this._current]);
          device.setProgram(program);
          device.setBindGroup(0, bindGroup);
          device.compute(
            FOAM_FIELD_CELLS / FOAM_FIELD_GROUP_SIZE,
            FOAM_FIELD_CELLS / FOAM_FIELD_GROUP_SIZE,
            FOAM_FIELD_LEVELS
          );
        } else {
          const fb = this._framebuffers![1 - this._current];
          for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
            bindGroup.setValue('ffRegion', (mask >> i) & 1 ? this._targets[i] : this._regions[i]);
            bindGroup.setValue('ffPrevRegion', this._regions[i]);
            bindGroup.setValue(
              'ffPrevRegionNext',
              i + 1 < FOAM_FIELD_LEVELS ? this._regions[i + 1] : Vector4.zero()
            );
            bindGroup.setValue('ffLevelParam', this._levelParams[i]);
            this._params.setXYZW(stepDt, this._fadeRate, this._prewarm ? 1 : 0, i);
            bindGroup.setValue('ffParams', this._params);
            fb.setColorAttachmentLayer(0, i);
            device.setFramebuffer(fb);
            device.setProgram(program);
            device.setBindGroup(0, bindGroup);
            drawFullscreenQuad();
          }
        }
      });
      for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
        if ((mask >> i) & 1) {
          this._regions[i].set(this._targets[i]);
        }
      }
      this._current = 1 - this._current;
      this._prewarm = false;
    }
    device.popDeviceStates();
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      if (this._lastSteps[i] >= 0) {
        this._stateTimes[i] = time;
      }
    }
  }
  /**
   * The levels step n of the finest level works out, as a mask: the finest,
   * and the coarser level i whose turn it is, n mod 2^i = 2^(i-1).
   * @internal
   */
  private static levelsSteppedAt(n: number) {
    let mask = 1;
    for (let i = 1; i < FOAM_FIELD_LEVELS; i++) {
      if (n % (1 << i) === 1 << (i - 1)) {
        mask |= 1 << i;
      }
    }
    return mask;
  }
  /** Declares the uniforms {@link WaterFoamField.sample} reads. */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    scope.ffTex = pb.tex2DArray().uniform(uniformGroup);
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      // (origin x, origin z, cell size, cells; 0 cells before the level exists)
      scope[`ffRegion${i}`] = pb.vec4().uniform(uniformGroup);
    }
    scope.ffDrift = pb.vec2().uniform(uniformGroup);
  }
  /** Sets the uniforms {@link WaterFoamField.setupUniforms} declared. */
  applyBindGroup(bindGroup: BindGroup) {
    bindGroup.setTexture(
      'ffTex',
      this._arrays ? this._arrays[this._current] : this.getDummy(),
      fetchSampler('clamp_linear_nomip')
    );
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      bindGroup.setValue(`ffRegion${i}`, this._arrays ? this._regions[i] : Vector4.zero());
    }
    bindGroup.setValue('ffDrift', this._driftVelocity);
  }
  /**
   * The field at an undisplaced XZ, as vec3(foam density, coverage, wall
   * foam). The finest level holding the point answers, blended into the next
   * coarser over the last FOAM_FIELD_EDGE_BLEND of it; coverage falls to 0 over
   * that share of the coarsest level and is 0 off it, where the reader falls
   * back to foam with no memory.
   */
  sample(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('ffSample', [pb.vec2('xz')], function () {
      this.$l.result = pb.vec3(0);
      // Share of the answer still to come from coarser levels
      this.$l.remaining = pb.float(1);
      for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
        const r = this[`ffRegion${i}`];
        this.$l[`uv${i}`] = pb.div(pb.sub(this.xz, r.xy), pb.max(pb.mul(r.z, r.w), 1e-4));
        const uv = this[`uv${i}`];
        this.$l[`edge${i}`] = pb.min(pb.min(uv.x, uv.y), pb.min(pb.sub(1, uv.x), pb.sub(1, uv.y)));
        const edge = this[`edge${i}`];
        this.$if(
          pb.and(pb.greaterThan(this.remaining, 0), pb.and(pb.greaterThan(r.w, 0), pb.greaterThan(edge, 0))),
          function () {
            this.$l.w = pb.mul(this.remaining, pb.smoothStep(0, FOAM_FIELD_EDGE_BLEND, edge));
            this.$l.texel = pb.textureArraySampleLevel(this.ffTex, uv, i, 0);
            this.result = pb.add(this.result, pb.mul(pb.vec3(this.texel.r, 1, this.texel.g), this.w));
            this.remaining = pb.sub(this.remaining, this.w);
          }
        );
      }
      this.$return(this.result);
    });
    return scope.ffSample(xz) as PBShaderExp;
  }
  protected onDispose() {
    super.onDispose();
    this.disposeArrays();
    for (const p of this._programs.values()) {
      p.program.dispose();
      p.bindGroup.dispose();
    }
    this._programs.clear();
    this._dummy?.dispose();
    this._dummy = null;
  }
  /** @internal */
  private ensureArrays(device: AbstractDevice) {
    if (this._arrays) {
      return;
    }
    // The compute step writes the arrays as storage textures, which cannot be
    // render targets; a new WebGPU texture reads as zero, so needs no clearing
    const compute = device.type === 'webgpu';
    const createArray = (name: string) => {
      const tex = device.createTexture2DArray(
        'rgba16f',
        FOAM_FIELD_CELLS,
        FOAM_FIELD_CELLS,
        FOAM_FIELD_LEVELS,
        {
          mipmapping: false,
          writable: compute
        }
      )!;
      tex.name = name;
      if (!compute) {
        const fb = device.createFrameBuffer([tex], null);
        for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
          fb.setColorAttachmentLayer(0, i);
          device.setFramebuffer(fb);
          device.clearFrameBuffer(Vector4.zero(), null, null);
        }
        fb.dispose();
      }
      return tex;
    };
    device.pushDeviceStates();
    try {
      this._arrays = [createArray('@WaterFoamField0'), createArray('@WaterFoamField1')];
      this._current = 0;
      for (const r of this._regions) {
        r.setXYZW(0, 0, 0, 0);
      }
      this._prewarm = true;
      this._stateTimes.fill(-1);
      this._pendingSteps.fill(0);
      this._stepCount = 0;
      this._framebuffers = compute
        ? null
        : ([0, 1].map((i) => device.createFrameBuffer([this._arrays![i]], null)) as [
            FrameBuffer,
            FrameBuffer
          ]);
    } finally {
      device.popDeviceStates();
    }
  }
  /** @internal */
  private getStepProgram(device: AbstractDevice, source: FoamFieldSource) {
    const programKey = source.foamSourceKey;
    let entry = this._programs.get(programKey);
    if (!entry) {
      const compute = device.type === 'webgpu';
      // Uniforms of the step: on the compute path the per-level ones are arrays
      // indexed by the level, on the fragment path those of the level drawn
      const declare = function (this: PBGlobalScope, pb: ProgramBuilder) {
        source.setupFoamSourceUniforms(this);
        this.ffSrc = pb.tex2DArray().uniform(0);
        if (compute) {
          this.ffDst = pb.texStorage2DArray.rgba16float().storage(0);
          // Per level: where it lies
          this.ffRegions = pb.vec4[FOAM_FIELD_LEVELS]().uniform(0);
          // Per level: where it lay at the last step, and past the coarsest a level of 0 cells
          this.ffPrevRegions = pb.vec4[FOAM_FIELD_LEVELS + 1]().uniform(0);
          // Per level: see WaterFoamField._levelParams
          this.ffLevelParams = pb.vec4[FOAM_FIELD_LEVELS]().uniform(0);
        } else {
          this.ffRegion = pb.vec4().uniform(0);
          // Where this level and the next coarser one lay at the last step; 0 cells for none
          this.ffPrevRegion = pb.vec4().uniform(0);
          this.ffPrevRegionNext = pb.vec4().uniform(0);
          this.ffLevelParam = pb.vec4().uniform(0);
        }
        // (seconds a step of the finest level covers, fade rate, prewarm, level on the fragment path)
        this.ffParams = pb.vec4().uniform(0);
        this.ffDrift = pb.vec2().uniform(0);
        // A point of a level as it was: its uv, and whether the level held it
        pb.func('ffPrevUV', [pb.vec2('wp'), pb.vec4('region')], function () {
          this.$l.uv = pb.div(
            pb.sub(this.wp, this.region.xy),
            pb.max(pb.mul(this.region.z, this.region.w), 1e-4)
          );
          this.$l.rMax = pb.sub(0.5, pb.div(1, pb.max(this.region.w, 1)));
          this.$l.r = pb.abs(pb.sub(this.uv, pb.vec2(0.5)));
          this.$return(
            pb.vec3(
              this.uv,
              this.$choice(
                pb.and(
                  pb.greaterThan(this.region.w, 0),
                  pb.lessThanEqual(pb.max(this.r.x, this.r.y), this.rMax)
                ),
                pb.float(1),
                pb.float(0)
              )
            )
          );
        });
      };
      // The step of one cell, from the locals `cell` (its centre, in cells),
      // `level`, `region`, `prevRegion`, `prevRegionNext` and
      // `levelParams`: leaves its new texel in `ffOut`
      const step = function (this: PBInsideFunctionScope, pb: ProgramBuilder) {
        this.$l.ffOut = pb.vec4(0);
        this.$if(pb.lessThan(this.levelParams.w, 0.5), function () {
          // Not stepped: kept as it is, where it lies
          this.ffOut = pb.textureArrayLoad(this.ffSrc, pb.ivec2(this.cell), this.level, 0);
        }).$else(function () {
          stepCell.call(this, pb);
        });
      };
      const stepCell = function (this: PBInsideFunctionScope, pb: ProgramBuilder) {
        this.$l.dt = this.levelParams.x;
        this.$l.fadeRate = this.ffParams.y;
        this.$l.prewarm = pb.greaterThan(this.ffParams.z, 0.5);
        // World position of this cell's centre
        this.$l.xz = pb.add(this.region.xy, pb.mul(this.cell, this.region.z));
        // The sources' state stays with the cell: from the same place, on
        // the grid as it was, where that grid held it
        this.$l.stateAt = this.ffPrevUV(this.xz, this.prevRegion);
        this.$l.prevState = pb.vec2(0);
        this.$l.stateAge = pb.float(-1);
        this.$if(pb.greaterThan(this.stateAt.z, 0.5), function () {
          this.prevState = pb.textureArraySampleLevel(this.ffSrc, this.stateAt.xy, this.level, 0).ba;
          this.$if(pb.and(pb.not(this.prewarm), pb.greaterThan(this.levelParams.z, 0)), function () {
            this.stateAge = this.levelParams.z;
          });
        });
        this.$l.state = pb.vec4(this.prevState, 0, this.stateAge);
        this.$l.shape = pb.vec2(0, 1);
        this.$l.src = source.calcFoamStep(
          this,
          this.xz,
          this.dt,
          this.fadeRate,
          this.prewarm,
          this.state,
          this.shape,
          this.region.z
        );
        // Sample from the previous step, upstream of the flow: this level as
        // it was, else the next coarser one, nothing where neither held it
        this.$l.flowed = pb.sub(this.xz, pb.mul(this.src.xy, this.dt));
        this.$l.at = this.ffPrevUV(this.flowed, this.prevRegion);
        // (foam, wall foam)
        this.$l.foam = pb.vec2(0);
        this.$if(pb.greaterThan(this.at.z, 0.5), function () {
          this.foam = pb.textureArraySampleLevel(this.ffSrc, this.at.xy, this.level, 0).rg;
        }).$else(function () {
          this.$l.atNext = this.ffPrevUV(this.flowed, this.prevRegionNext);
          this.$if(pb.greaterThan(this.atNext.z, 0.5), function () {
            this.foam = pb.textureArraySampleLevel(this.ffSrc, this.atNext.xy, pb.add(this.level, 1), 0).rg;
          });
        });
        // Fade, as over the steps of the finest level the step covers, then what
        // the sources make
        this.$l.fadeStep = pb.max(
          0,
          pb.sub(1, pb.mul(this.fadeRate, pb.max(this.shape.y, 0), this.ffParams.x))
        );
        this.foam = pb.mul(
          this.foam,
          this.$choice(
            pb.greaterThan(this.levelParams.y, 0),
            pb.pow(this.fadeStep, this.levelParams.y),
            pb.float(1)
          )
        );
        this.foam = pb.add(this.foam, this.src.zw);
        // At least what the source knows is here
        this.foam.x = pb.max(this.foam.x, pb.clamp(this.shape.x, 0, 1));
        this.ffOut = pb.vec4(
          pb.clamp(this.foam, pb.vec2(0), pb.vec2(1)),
          this.$choice(pb.greaterThan(this.levelParams.w, 1.5), this.state.xy, this.prevState)
        );
      };
      const program = compute
        ? device.buildComputeProgram({
            workgroupSize: [FOAM_FIELD_GROUP_SIZE, FOAM_FIELD_GROUP_SIZE, 1],
            compute(pb) {
              declare.call(this, pb);
              pb.main(function () {
                this.$l.level = pb.int(this.$builtins.globalInvocationId.z);
                this.$l.cell = pb.add(pb.vec2(this.$builtins.globalInvocationId.xy), pb.vec2(0.5));
                this.$l.region = this.ffRegions.at(this.level);
                this.$l.prevRegion = this.ffPrevRegions.at(this.level);
                this.$l.prevRegionNext = this.ffPrevRegions.at(pb.add(this.level, 1));
                this.$l.levelParams = this.ffLevelParams.at(this.level);
                step.call(this, pb);
                pb.textureArrayStore(
                  this.ffDst,
                  this.$builtins.globalInvocationId.xy,
                  this.level,
                  this.ffOut
                );
              });
            }
          })!
        : device.buildRenderProgram({
            vertex(pb) {
              this.$inputs.pos = pb.vec2().attrib('position');
              pb.main(function () {
                this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
              });
            },
            fragment(pb) {
              this.$outputs.outColor = pb.vec4();
              declare.call(this, pb);
              pb.main(function () {
                this.$l.level = pb.int(this.ffParams.w);
                this.$l.cell = this.$builtins.fragCoord.xy;
                this.$l.region = this.ffRegion;
                this.$l.prevRegion = this.ffPrevRegion;
                this.$l.prevRegionNext = this.ffPrevRegionNext;
                this.$l.levelParams = this.ffLevelParam;
                step.call(this, pb);
                this.$outputs.outColor = this.ffOut;
              });
            }
          })!;
      program.name = `@WaterFoamFieldStep:${programKey}`;
      entry = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]), compute };
      this._programs.set(programKey, entry);
    }
    return entry;
  }
  /** @internal */
  private disposeArrays() {
    this._framebuffers?.forEach((fb) => fb.dispose());
    this._framebuffers = null;
    this._arrays?.forEach((tex) => tex.dispose());
    this._arrays = null;
  }
  /** @internal */
  private getDummy() {
    if (!this._dummy) {
      this._dummy = getDevice().createTexture2DArray('rgba16f', 1, 1, 1, { mipmapping: false })!;
    }
    return this._dummy;
  }
}

/**
 * The open water's share of the foam field: foam left where the wrapped
 * generator's crests break, drifting on the wind. The generator's own foam
 * density stands in for the wave Jacobian's squeeze, so the field is fed by
 * the same crests the generator shows foam on, as the generator shows them
 * over a pixel the size of the cell: the waves too short for the cell are
 * filtered out rather than sampled sparsely.
 * @internal
 */
export class WaveFoamSource implements FoamFieldSource {
  private readonly _generator: Nullable<WaveGenerator>;
  private readonly _field: WaterFoamField;
  /** (strength, 0, 0, 0) */
  private readonly _sourceParams: Vector4;
  readonly foamSourceKey: string;
  constructor(generator: Nullable<WaveGenerator>, field: WaterFoamField) {
    this._generator = generator;
    this._field = field;
    this._sourceParams = new Vector4();
    this.foamSourceKey = `WG:${generator?.getHash() ?? ''}`;
  }
  setupFoamSourceUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    if (this._generator) {
      this._generator.setupUniforms(scope, 0);
      // FBM and Gerstner animate from camera.elapsedTime, which a standalone
      // program has to declare itself
      ShaderHelper.declareStandaloneCameraTime(scope, 0);
    }
    scope.wgFoamSource = pb.vec4().uniform(0);
  }
  applyFoamSourceBindGroup(bindGroup: BindGroup) {
    if (this._generator) {
      this._generator.applyWaterBindGroup(bindGroup);
      ShaderHelper.setStandaloneCameraTime(bindGroup);
    }
    this._sourceParams.setXYZW(this._field.baseStrength, 0, 0, 0);
    bindGroup.setValue('wgFoamSource', this._sourceParams);
  }
  calcFoamStep(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp,
    prewarm: PBShaderExp,
    _state: PBShaderExp,
    _shape: PBShaderExp,
    cell: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'wgFoamStep',
      [pb.vec2('xz'), pb.float('dt'), pb.float('fadeRate'), pb.bool('prewarm'), pb.float('cell')],
      function () {
        this.$l.strength = this.wgFoamSource.x;
        this.$l.density = pb.float(0);
        if (that._generator) {
          // The cell's footprint, as the screen derivatives of a pixel that size
          this.density = pb.clamp(
            that._generator.calcFragmentNormalAndFoam(
              this,
              this.xz,
              pb.vec3(0, 1, 0),
              undefined,
              pb.vec4(this.cell, 0, 0, this.cell)
            ).w,
            0,
            1
          );
        }
        // On prewarm, feed the source over a longer step so the field starts with foam
        this.$l.waveDt = this.$choice(
          this.prewarm,
          pb.max(this.dt, pb.div(pb.min(1, pb.sub(this.strength, 1)), this.fadeRate)),
          this.dt
        );
        this.$return(
          pb.vec4(this.ffDrift, pb.mul(FOAM_WAVE_GAIN, this.waveDt, this.strength, this.density), 0)
        );
      }
    );
    return scope.wgFoamStep(xz, dt, fadeRate, prewarm, cell) as PBShaderExp;
  }
}

/**
 * Velocity of the water carrying the foam at an undisplaced XZ in the
 * material's shaders, given the drift on the wind: the drift with the source's
 * own water added and, where it knows of walls, led along them.
 * @public
 */
export interface FoamFlowSource {
  calcFoamFlow(scope: PBInsideFunctionScope, xz: PBShaderExp, drift: PBShaderExp): PBShaderExp;
}

/**
 * Layers the foam field over the generator it wraps: inside the field the foam
 * is the field's, which the generator feeds and so must not add a second
 * time, and the foam texture travels with the water; off the field the
 * generator's foam shows unchanged. Wraps the base generator, below the
 * interaction field and the shore waves, whose foam is composed over it.
 * @internal
 */
export class FoamFieldWaveGenerator extends Disposable implements WaveGenerator {
  private readonly _base: WaveGenerator;
  private readonly _field: WaterFoamField;
  /** Velocity of the water from the drift, from the shore waves while they are on. */
  flowSource: Nullable<FoamFlowSource>;
  calcPrevVertexPosition?: WaveGenerator['calcPrevVertexPosition'];
  calcSurfaceCoverage?: WaveGenerator['calcSurfaceCoverage'];
  calcSheetThickness?: WaveGenerator['calcSheetThickness'];
  calcUnresolvedSlopeVariance?: WaveGenerator['calcUnresolvedSlopeVariance'];
  constructor(base: WaveGenerator, field: WaterFoamField) {
    super();
    this._base = base;
    this._field = field;
    this.flowSource = null;
    // Optional parts of the surface pass straight through, present only where
    // the base has them
    if (base.calcPrevVertexPosition) {
      this.calcPrevVertexPosition = base.calcPrevVertexPosition.bind(base);
    }
    if (base.calcSurfaceCoverage) {
      this.calcSurfaceCoverage = base.calcSurfaceCoverage.bind(base);
    }
    if (base.calcSheetThickness) {
      this.calcSheetThickness = base.calcSheetThickness.bind(base);
    }
    if (base.calcUnresolvedSlopeVariance) {
      this.calcUnresolvedSlopeVariance = base.calcUnresolvedSlopeVariance.bind(base);
    }
  }
  /** The generator the field is layered over. */
  get base() {
    return this._base;
  }
  /** The foam field. */
  get field() {
    return this._field;
  }
  get wind() {
    return this._base.wind;
  }
  clone() {
    return new FoamFieldWaveGenerator(this._base.clone(), this._field) as this;
  }
  get version() {
    return this._base.version + this._field.version;
  }
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    this._base.setupUniforms(scope, uniformGroup);
    this._field.setupUniforms(scope, uniformGroup);
  }
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ) {
    this._base.calcVertexPositionAndNormal(scope, inPos, outPos, outNormal, vertexSpacing);
  }
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, vertexNormal: PBShaderExp) {
    return this._base.calcFragmentNormal(scope, xz, vertexNormal);
  }
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp,
    foamFlow?: PBShaderExp,
    footprint?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const params = [pb.vec2('xz'), pb.vec3('vn')];
    const args = [xz, vertexNormal];
    if (foamFlow) {
      params.push(pb.vec2('fflow').inout());
      args.push(foamFlow);
    }
    if (footprint) {
      params.push(pb.vec4('fp'));
      args.push(footprint);
    }
    const funcName = `ffCalcNormalAndFoam${foamFlow ? 'S' : ''}${footprint ? 'F' : ''}`;
    pb.func(funcName, params, function () {
      this.$l.nf = that._base.calcFragmentNormalAndFoam(
        this,
        this.xz,
        this.vn,
        foamFlow ? this.fflow : undefined,
        footprint ? this.fp : undefined
      );
      this.$l.ff = that._field.sample(this, this.xz);
      this.$l.ffTotal = pb.clamp(this.ff.x, 0, 1);
      if (foamFlow) {
        // Carried by the water: the texture travels with the field's foam, the
        // velocity blended rather than two patterns, which would be blended
        // before the cut. Over the whole field, not only where it holds foam:
        // the flow source may show foam the field lacks (the near shore).
        this.$if(pb.greaterThan(this.ff.y, 0), function () {
          this.$l.flow = that.flowSource
            ? that.flowSource.calcFoamFlow(this, this.xz, this.ffDrift)
            : this.ffDrift;
          this.fflow = pb.mix(this.fflow, this.flow, this.ff.y);
        });
      }
      this.$return(pb.vec4(this.nf.xyz, pb.mix(pb.clamp(this.nf.w, 0, 1), this.ffTotal, this.ff.y)));
    });
    return scope[funcName](...args) as PBShaderExp;
  }
  applyWaterBindGroup(bindGroup: BindGroup) {
    this._base.applyWaterBindGroup(bindGroup);
    this._field.applyBindGroup(bindGroup);
  }
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    this._base.calcClipmapTileAABB(minX, maxX, minZ, maxZ, y, outAABB);
  }
  /** The material steps the base generator and the field; nothing to do here. */
  update() {}
  getHash() {
    return `${this._base.getHash()}:FF`;
  }
  needUpdate() {
    return true;
  }
  isOk(device: AbstractDevice) {
    return this._base.isOk(device);
  }
}
