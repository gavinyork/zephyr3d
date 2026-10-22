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
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import { getDevice } from '../app/api';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { getDefaultFoamTexture, sampleFoamTexture } from '../utility/textures/foam';
import type { WaveGenerator } from './wavegenerator';
import { ShaderHelper } from '../material/shader/helper';

/**
 * The foam field is stepped as Crest steps its persistent simulations
 * (UpdateFoam.compute, Wave Harmonic, MIT): FOAM_FIELD_FREQUENCY steps per
 * second, each advecting the field by the water's velocity, fading it and
 * adding what the sources make; at most FOAM_FIELD_MAX_STEPS catch up per
 * frame.
 */
const FOAM_FIELD_FREQUENCY = 30;
const FOAM_FIELD_MAX_STEPS = 8;
/** Crest's flow foam: two samples, each slid for up to FOAM_FLOW_PERIOD seconds and faded across. */
const FOAM_FLOW_PERIOD = 2;
/**
 * Levels of the field, laid out as Crest's LODs are: all centred on the view,
 * each twice the size of the one before at the same number of cells, each
 * stepped on its own, and an advection that would read off a level reading
 * the next coarser one instead (UpdateFoam.compute). The material reads the
 * finest level holding a point, blended into the next over its edge.
 */
const FOAM_FIELD_LEVELS = 4;
/** Cells along each side of a level. */
const FOAM_FIELD_CELLS = 256;
/**
 * Share of a level, from each edge inwards, over which its coverage falls to
 * 0, so the foam with memory hands over to the foam without it with no seam.
 */
const FOAM_FIELD_EDGE_BLEND = 0.15;
/**
 * Fade of foam left on the ground, as a multiple of the field's fade rate:
 * under water and once the ground has dried. At the default fade rate of 0.8
 * the deposit halves in about 3.5 s under the swash and 0.9 s on dry sand.
 */
const FOAM_DEPOSIT_WET_FADE = 0.25;
const FOAM_DEPOSIT_DRY_FADE = 1;
/**
 * Crest's gain on the foam the waves make (UpdateFoam.compute): foam is added
 * at FOAM_WAVE_GAIN times the strength times how squeezed the water is, per
 * second.
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
  /** Whether this source can leave foam attached to the ground. */
  readonly supportsFoamDeposition?: boolean;
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
   * @param contact - Optional out vec2: in x the rate per second at which
   *   mobile foam attaches to the ground here, in y how dry the ground is,
   *   0..1, which speeds up the fading of foam left on it. Starts at 0 for
   *   sources without deposition.
   */
  calcFoamStep(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp,
    prewarm: PBShaderExp,
    state: PBShaderExp,
    contact?: PBShaderExp
  ): PBShaderExp;
}

/** @internal */
interface FoamStepProgram {
  program: GPUProgram;
  bindGroup: BindGroup;
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
  /** Foam attached to world XZ, with the same levels and ping-pong index. */
  private _depositedArrays: Nullable<[Texture2DArray, Texture2DArray]>;
  private _depositionSourceKey: Nullable<string>;
  private _framebuffers: Nullable<[FrameBuffer, FrameBuffer]>;
  private _current: number;
  /** Per level: (origin x, origin z, cell size, cells) as the field holds it; 0 cells before it does. */
  private readonly _regions: Vector4[];
  /** Per level: where the grid goes this frame. */
  private readonly _targets: Vector4[];
  private _programs: Map<string, FoamStepProgram>;
  private _timeToSimulate: number;
  private _lastTime: number;
  /** Clock at which the sources last wrote their per-cell state; negative for never. */
  private _stateTime: number;
  private _prewarm: boolean;
  private _fadeRate: number;
  private _size: number;
  private _baseStrength: number;
  private _drift: number;
  /** Velocity the foam drifts at on the wind, metres per second. */
  private readonly _driftVelocity: Vector2;
  private _dummy: Nullable<Texture2DArray>;
  /** (dt, fade rate, prewarm, level) */
  private readonly _params: Vector4;
  /** (seconds since the sources' state was written, whether this step writes it, 0, 0) */
  private readonly _stateParams: Vector4;
  /** (clock in seconds, 0, 0, 0) */
  private readonly _clock: Vector4;
  private _version: number;
  constructor() {
    super();
    this._arrays = null;
    this._depositedArrays = null;
    this._depositionSourceKey = null;
    this._framebuffers = null;
    this._current = 0;
    this._regions = [];
    this._targets = [];
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      this._regions.push(new Vector4());
      this._targets.push(new Vector4());
    }
    this._programs = new Map();
    this._timeToSimulate = 0;
    this._lastTime = -1;
    this._stateTime = -1;
    this._prewarm = true;
    this._fadeRate = 0.8;
    this._size = 128;
    this._baseStrength = 1;
    this._drift = 0.03;
    this._driftVelocity = new Vector2();
    this._dummy = null;
    this._params = new Vector4();
    this._stateParams = new Vector4();
    this._clock = new Vector4();
    this._version = 0;
  }
  /** How fast the foam fades, per second (Crest's Foam Fade Rate). */
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
   * Scale of the foam the open water's breaking crests leave behind, as
   * Crest's Wave Foam Strength: 0 leaves foam only while the crest breaks.
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
   * caught up in fixed steps of 1 / FOAM_FIELD_FREQUENCY; with no step due, a
   * step of no time still carries the field over to where the grids now lie.
   * The first step prewarms it.
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
    let moved = false;
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
      moved = moved || !this._regions[i].equalsTo(this._targets[i]);
    }
    this._driftVelocity.setXY((wind?.x ?? 0) * this._drift, (wind?.y ?? 0) * this._drift);
    const device = getDevice();
    this.ensureArrays(device, source);
    const dt = this._lastTime < 0 ? 0 : Math.min(Math.max(time - this._lastTime, 0), 0.25);
    this._lastTime = time;
    // The clock carries the foam texture along; readers see it every frame
    this._clock.x = time;
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
      if (!moved && !this._prewarm) {
        return;
      }
      steps = 1;
      stepDt = 0;
    }
    const { program, bindGroup } = this.getStepProgram(device, source);
    source.applyFoamSourceBindGroup(bindGroup);
    bindGroup.setValue('ffDrift', this._driftVelocity);
    // The sources' state is of the water as it is this frame, which every step
    // of the frame sees alike: it is read as of the last frame that wrote it
    // and written at the frame's last step
    const sinceState = this._stateTime < 0 ? 0 : Math.max(time - this._stateTime, 0);
    const sampler = fetchSampler('clamp_linear_nomip');
    device.pushDeviceStates();
    for (let step = 0; step < steps; step++) {
      const fb = this._framebuffers![1 - this._current];
      bindGroup.setTexture('ffSrc', this._arrays![this._current], sampler);
      if (this._depositedArrays) {
        bindGroup.setTexture('ffDepositedSrc', this._depositedArrays[this._current], sampler);
      }
      this._stateParams.setXYZW(sinceState, step === steps - 1 ? 1 : 0, 0, 0);
      bindGroup.setValue('ffState', this._stateParams);
      for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
        // Only the first step carries the field across a move of the grids
        const prev = step === 0 ? this._regions : this._targets;
        bindGroup.setValue('ffRegion', this._targets[i]);
        bindGroup.setValue('ffPrevRegion', prev[i]);
        bindGroup.setValue('ffPrevRegionNext', i + 1 < FOAM_FIELD_LEVELS ? prev[i + 1] : Vector4.zero());
        this._params.setXYZW(stepDt, this._fadeRate, this._prewarm ? 1 : 0, i);
        bindGroup.setValue('ffParams', this._params);
        fb.setColorAttachmentLayer(0, i);
        if (this._depositedArrays) {
          fb.setColorAttachmentLayer(1, i);
        }
        device.setFramebuffer(fb);
        device.setProgram(program);
        device.setBindGroup(0, bindGroup);
        drawFullscreenQuad();
      }
      this._current = 1 - this._current;
      this._prewarm = false;
    }
    device.popDeviceStates();
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      this._regions[i].set(this._targets[i]);
    }
    this._stateTime = time;
  }
  /** Declares the uniforms {@link WaterFoamField.sample} reads. */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    scope.ffTex = pb.tex2DArray().uniform(uniformGroup);
    scope.ffDepositedTex = pb.tex2DArray().uniform(uniformGroup);
    scope.ffDepositedEnabled = pb.float().uniform(uniformGroup);
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      // (origin x, origin z, cell size, cells; 0 cells before the level exists)
      scope[`ffRegion${i}`] = pb.vec4().uniform(uniformGroup);
    }
    scope.ffDrift = pb.vec2().uniform(uniformGroup);
    scope.ffClock = pb.vec4().uniform(uniformGroup);
  }
  /** Sets the uniforms {@link WaterFoamField.setupUniforms} declared. */
  applyBindGroup(bindGroup: BindGroup) {
    bindGroup.setTexture(
      'ffTex',
      this._arrays ? this._arrays[this._current] : this.getDummy(),
      fetchSampler('clamp_linear_nomip')
    );
    bindGroup.setTexture(
      'ffDepositedTex',
      this._depositedArrays ? this._depositedArrays[this._current] : this.getDummy(),
      fetchSampler('clamp_linear_nomip')
    );
    bindGroup.setValue('ffDepositedEnabled', this._depositedArrays ? 1 : 0);
    for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
      bindGroup.setValue(`ffRegion${i}`, this._arrays ? this._regions[i] : Vector4.zero());
    }
    bindGroup.setValue('ffDrift', this._driftVelocity);
    bindGroup.setValue('ffClock', this._clock);
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
  /** Foam attached to world XZ, as (density, coverage), with the same LOD blend. */
  sampleDeposited(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('ffSampleDeposited', [pb.vec2('xz')], function () {
      this.$l.result = pb.vec2(0);
      this.$if(pb.lessThan(this.ffDepositedEnabled, 0.5), function () {
        this.$return(this.result);
      });
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
            this.$l.density = pb.textureArraySampleLevel(this.ffDepositedTex, uv, i, 0).r;
            this.result = pb.add(this.result, pb.mul(pb.vec2(this.density, 1), this.w));
            this.remaining = pb.sub(this.remaining, this.w);
          }
        );
      }
      this.$return(this.result);
    });
    return scope.ffSampleDeposited(xz) as PBShaderExp;
  }
  /**
   * The foam texture carried by the water, as Crest's ComputeFoamWithFlow:
   * two samples, each slid along the flow for up to FOAM_FLOW_PERIOD seconds
   * and then set back, half a period apart, faded across so neither jump
   * shows. Returns (value, slope along x, slope along z) as
   * {@link sampleFoamTexture} does.
   * @param time - Clock in seconds.
   * @param flow - Velocity of the water in metres per second.
   */
  static flowPattern(
    scope: PBInsideFunctionScope,
    tex: PBShaderExp,
    uvScale: PBShaderExp,
    time: PBShaderExp,
    xz: PBShaderExp,
    xzGrad: PBShaderExp,
    flow: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func(
      'ffFlowPattern',
      [pb.vec2('xz'), pb.vec4('xzGrad'), pb.vec2('flow'), pb.float('time'), pb.float('uvScale')],
      function () {
        const half = FOAM_FLOW_PERIOD * 0.5;
        this.$l.offset1 = pb.mod(this.time, FOAM_FLOW_PERIOD);
        this.$l.weight1 = pb.div(this.offset1, half);
        this.weight1 = this.$choice(pb.greaterThan(this.weight1, 1), pb.sub(2, this.weight1), this.weight1);
        this.$l.offset2 = pb.mod(pb.add(this.time, half), FOAM_FLOW_PERIOD);
        this.$l.s1 = sampleFoamTexture(
          this,
          tex,
          pb.mul(pb.sub(this.xz, pb.mul(this.flow, this.offset1)), this.uvScale),
          this.xzGrad,
          this.uvScale
        );
        this.$l.s2 = sampleFoamTexture(
          this,
          tex,
          pb.mul(pb.sub(this.xz, pb.mul(this.flow, this.offset2)), this.uvScale),
          this.xzGrad,
          this.uvScale
        );
        this.$return(pb.mix(this.s2, this.s1, this.weight1));
      }
    );
    return scope.ffFlowPattern(xz, xzGrad, flow, time, uvScale) as PBShaderExp;
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
  private ensureArrays(device: AbstractDevice, source: FoamFieldSource) {
    const createArray = (format: 'rgba16f' | 'r16f', name: string) => {
      const tex = device.createTexture2DArray(format, FOAM_FIELD_CELLS, FOAM_FIELD_CELLS, FOAM_FIELD_LEVELS, {
        mipmapping: false
      })!;
      tex.name = name;
      const fb = device.createFrameBuffer([tex], null);
      for (let i = 0; i < FOAM_FIELD_LEVELS; i++) {
        fb.setColorAttachmentLayer(0, i);
        device.setFramebuffer(fb);
        device.clearFrameBuffer(Vector4.zero(), null, null);
      }
      fb.dispose();
      return tex;
    };
    const depositionKey = source.supportsFoamDeposition ? source.foamSourceKey : null;
    if (this._arrays && depositionKey === this._depositionSourceKey) {
      return;
    }
    device.pushDeviceStates();
    try {
      if (!this._arrays) {
        this._arrays = [
          createArray('rgba16f', '@WaterFoamField0'),
          createArray('rgba16f', '@WaterFoamField1')
        ];
        this._current = 0;
        for (const r of this._regions) {
          r.setXYZW(0, 0, 0, 0);
        }
        this._prewarm = true;
        this._stateTime = -1;
      }
      // Switching away from a beach discards its attached foam. Keep mobile
      // foam and wall history intact, and never resurrect old beach deposits.
      this._framebuffers?.forEach((fb) => fb.dispose());
      this._depositedArrays?.forEach((tex) => tex.dispose());
      this._depositedArrays =
        depositionKey !== null
          ? [createArray('r16f', '@WaterDepositedFoam0'), createArray('r16f', '@WaterDepositedFoam1')]
          : null;
      this._framebuffers = [0, 1].map((i) =>
        device.createFrameBuffer(
          this._depositedArrays ? [this._arrays![i], this._depositedArrays[i]] : [this._arrays![i]],
          null
        )
      ) as [FrameBuffer, FrameBuffer];
      this._depositionSourceKey = depositionKey;
    } finally {
      device.popDeviceStates();
    }
  }
  /**
   * Foam the thin sheet leaves on the ground: the ground's foam rises towards
   * the drifting foam over it, never past it, and the drifting foam is not
   * drained. A conserved transfer piles up where the sheet keeps flowing over
   * the same thin cells, saturating a band denser than any foam the water
   * carries, and starves the water flowing on of the foam it should leave
   * farther down. Wall foam is not involved.
   */
  private static depositFoam(
    scope: PBInsideFunctionScope,
    mobile: PBShaderExp,
    deposited: PBShaderExp,
    contact: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func(
      'ffDeposit',
      [pb.float('mobile'), pb.float('deposited'), pb.vec2('contact'), pb.float('dt'), pb.float('fadeRate')],
      function () {
        this.$l.m = pb.clamp(this.mobile, 0, 1);
        // Slower than the drifting foam while water still covers it; once the
        // sheet drains away, faster, or the swash's upper reach, which holds
        // the most of it, outlasts everything below as a stranded line.
        this.$l.fade = pb.mix(FOAM_DEPOSIT_WET_FADE, FOAM_DEPOSIT_DRY_FADE, pb.clamp(this.contact.y, 0, 1));
        this.$l.d = pb.mul(
          pb.clamp(this.deposited, 0, 1),
          pb.exp(pb.neg(pb.mul(this.fade, this.fadeRate, this.dt)))
        );
        this.$l.fraction = pb.sub(1, pb.exp(pb.neg(pb.mul(pb.max(this.contact.x, 0), this.dt))));
        this.$return(
          pb.vec2(this.m, pb.add(this.d, pb.mul(pb.max(pb.sub(this.m, this.d), 0), this.fraction)))
        );
      }
    );
    return scope.ffDeposit(mobile, deposited, contact, dt, fadeRate) as PBShaderExp;
  }
  /** @internal */
  private getStepProgram(device: AbstractDevice, source: FoamFieldSource) {
    const deposition = !!source.supportsFoamDeposition;
    const programKey = `${source.foamSourceKey}:${deposition ? 'deposited' : 'mobile'}`;
    let entry = this._programs.get(programKey);
    if (!entry) {
      const program = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          if (deposition) {
            this.$outputs.outDeposited = pb.vec4();
            this.ffDepositedSrc = pb.tex2DArray().uniform(0);
          }
          source.setupFoamSourceUniforms(this);
          this.ffSrc = pb.tex2DArray().uniform(0);
          this.ffRegion = pb.vec4().uniform(0);
          // Where this level and the next coarser one lay at the last step; 0 cells for none
          this.ffPrevRegion = pb.vec4().uniform(0);
          this.ffPrevRegionNext = pb.vec4().uniform(0);
          // (dt, fade rate, prewarm, level)
          this.ffParams = pb.vec4().uniform(0);
          this.ffDrift = pb.vec2().uniform(0);
          // (seconds since the sources' state was written, whether this step writes it, 0, 0)
          this.ffState = pb.vec4().uniform(0);
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
          pb.main(function () {
            this.$l.dt = this.ffParams.x;
            this.$l.fadeRate = this.ffParams.y;
            this.$l.prewarm = pb.greaterThan(this.ffParams.z, 0.5);
            this.$l.level = pb.int(this.ffParams.w);
            // World position of this cell's centre
            this.$l.xz = pb.add(this.ffRegion.xy, pb.mul(this.$builtins.fragCoord.xy, this.ffRegion.z));
            // The sources' state stays with the cell: from the same place, on
            // the grid as it was, where that grid held it
            this.$l.stateAt = this.ffPrevUV(this.xz, this.ffPrevRegion);
            this.$l.prevState = pb.vec2(0);
            this.$l.stateAge = pb.float(-1);
            this.$if(pb.greaterThan(this.stateAt.z, 0.5), function () {
              this.prevState = pb.textureArraySampleLevel(this.ffSrc, this.stateAt.xy, this.level, 0).ba;
              this.$if(pb.and(pb.not(this.prewarm), pb.greaterThan(this.ffState.x, 0)), function () {
                this.stateAge = this.ffState.x;
              });
            });
            this.$l.state = pb.vec4(this.prevState, 0, this.stateAge);
            this.$l.contact = pb.vec2(0);
            this.$l.src = source.calcFoamStep(
              this,
              this.xz,
              this.dt,
              this.fadeRate,
              this.prewarm,
              this.state,
              this.contact
            );
            // Sample from the previous step, upstream of the flow: this level as
            // it was, else the next coarser one, nothing where neither held it
            this.$l.flowed = pb.sub(this.xz, pb.mul(this.src.xy, this.dt));
            this.$l.at = this.ffPrevUV(this.flowed, this.ffPrevRegion);
            // (foam, wall foam)
            this.$l.foam = pb.vec2(0);
            this.$if(pb.greaterThan(this.at.z, 0.5), function () {
              this.foam = pb.textureArraySampleLevel(this.ffSrc, this.at.xy, this.level, 0).rg;
            }).$else(function () {
              this.$l.atNext = this.ffPrevUV(this.flowed, this.ffPrevRegionNext);
              this.$if(pb.greaterThan(this.atNext.z, 0.5), function () {
                this.foam = pb.textureArraySampleLevel(
                  this.ffSrc,
                  this.atNext.xy,
                  pb.add(this.level, 1),
                  0
                ).rg;
              });
            });
            // Fade, then what the sources make
            this.foam = pb.mul(this.foam, pb.max(0, pb.sub(1, pb.mul(this.fadeRate, this.dt))));
            this.foam = pb.add(this.foam, this.src.zw);
            if (deposition) {
              // Ground foam is sampled at this world position, never upstream.
              this.$l.deposited = pb.float(0);
              this.$if(pb.greaterThan(this.stateAt.z, 0.5), function () {
                this.deposited = pb.textureArraySampleLevel(
                  this.ffDepositedSrc,
                  this.stateAt.xy,
                  this.level,
                  0
                ).r;
              }).$else(function () {
                this.$l.depositedNext = this.ffPrevUV(this.xz, this.ffPrevRegionNext);
                this.$if(pb.greaterThan(this.depositedNext.z, 0.5), function () {
                  this.deposited = pb.textureArraySampleLevel(
                    this.ffDepositedSrc,
                    this.depositedNext.xy,
                    pb.add(this.level, 1),
                    0
                  ).r;
                });
              });
              this.$l.exchange = WaterFoamField.depositFoam(
                this,
                this.foam.r,
                this.deposited,
                this.contact,
                this.dt,
                this.fadeRate
              );
              this.foam.r = this.exchange.x;
              this.$outputs.outDeposited = pb.vec4(this.exchange.y, 0, 0, 1);
            }
            this.$outputs.outColor = pb.vec4(
              pb.clamp(this.foam, pb.vec2(0), pb.vec2(1)),
              this.$choice(pb.greaterThan(this.ffState.y, 0.5), this.state.xy, this.prevState)
            );
          });
        }
      })!;
      program.name = `@WaterFoamFieldStep:${programKey}`;
      entry = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]) };
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
    this._depositedArrays?.forEach((tex) => tex.dispose());
    this._depositedArrays = null;
    this._depositionSourceKey = null;
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
 * generator's crests break, drifting on the wind. Crest feeds its foam
 * simulation from the Jacobian of its animated waves the same way
 * (UpdateFoam.compute); here the generator's own foam density stands for the
 * squeeze, so the field is fed by the same crests the generator shows foam on.
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
    _state: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'wgFoamStep',
      [pb.vec2('xz'), pb.float('dt'), pb.float('fadeRate'), pb.bool('prewarm')],
      function () {
        this.$l.strength = this.wgFoamSource.x;
        this.$l.density = pb.float(0);
        if (that._generator) {
          this.density = pb.clamp(
            that._generator.calcFragmentNormalAndFoam(this, this.xz, pb.vec3(0, 1, 0)).w,
            0,
            1
          );
        }
        // Crest's prewarm of the wave source
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
    return scope.wgFoamStep(xz, dt, fadeRate, prewarm) as PBShaderExp;
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
 * Settings the foam field reads from the water to draw its foam texture.
 * @internal
 */
export interface FoamFieldLook {
  getFoamTexture(): Nullable<Texture2D>;
  getFoamTextureSize(): number;
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
  private readonly _look: FoamFieldLook;
  /** Velocity of the water from the drift, from the shore waves while they are on. */
  flowSource: Nullable<FoamFlowSource>;
  calcPrevVertexPosition?: WaveGenerator['calcPrevVertexPosition'];
  calcSurfaceCoverage?: WaveGenerator['calcSurfaceCoverage'];
  calcSheetThickness?: WaveGenerator['calcSheetThickness'];
  constructor(base: WaveGenerator, field: WaterFoamField, look: FoamFieldLook) {
    super();
    this._base = base;
    this._field = field;
    this._look = look;
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
    return new FoamFieldWaveGenerator(this._base.clone(), this._field, this._look) as this;
  }
  get version() {
    return this._base.version + this._field.version;
  }
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    this._base.setupUniforms(scope, uniformGroup);
    this._field.setupUniforms(scope, uniformGroup);
    scope.ffFoamTex = pb.tex2D().uniform(uniformGroup);
    scope.ffFoamUVScale = pb.float().uniform(uniformGroup);
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
    foamSample?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const params = [pb.vec2('xz'), pb.vec3('vn')];
    if (foamSample) {
      params.push(pb.vec3('fs').inout());
    }
    const funcName = foamSample ? 'ffCalcNormalAndFoamS' : 'ffCalcNormalAndFoam';
    pb.func(funcName, params, function () {
      // Screen derivatives for the foam texture, here in uniform control flow
      if (foamSample) {
        this.$l.xzGrad = pb.vec4(pb.dpdx(this.xz), pb.dpdy(this.xz));
      }
      this.$l.nf = that._base.calcFragmentNormalAndFoam(
        this,
        this.xz,
        this.vn,
        foamSample ? this.fs : undefined
      );
      this.$l.ff = that._field.sample(this, this.xz);
      // The ground layer draws the more of drifting and deposited foam, but
      // only once the sheet thins enough to hand over to it. Show the same
      // here, or foam the ground holds vanishes until then and opens a seam.
      this.$l.ffTotal = pb.clamp(pb.max(this.ff.x, that._field.sampleDeposited(this, this.xz).x), 0, 1);
      if (foamSample) {
        // Carried by the water: the texture travels with the field's foam.
        // Over the whole field, not only where it holds foam: the flow source
        // may show foam the field lacks (the near shore), on this pattern.
        this.$if(pb.greaterThan(this.ff.y, 0), function () {
          this.$l.flow = that.flowSource
            ? that.flowSource.calcFoamFlow(this, this.xz, this.ffDrift)
            : this.ffDrift;
          this.$l.pattern = WaterFoamField.flowPattern(
            this,
            this.ffFoamTex,
            this.ffFoamUVScale,
            this.ffClock.x,
            this.xz,
            this.xzGrad,
            this.flow
          );
          this.fs = pb.mix(this.fs, this.pattern, this.ff.y);
        });
      }
      this.$return(pb.vec4(this.nf.xyz, pb.mix(pb.clamp(this.nf.w, 0, 1), this.ffTotal, this.ff.y)));
    });
    return (
      foamSample ? scope[funcName](xz, vertexNormal, foamSample) : scope[funcName](xz, vertexNormal)
    ) as PBShaderExp;
  }
  applyWaterBindGroup(bindGroup: BindGroup) {
    this._base.applyWaterBindGroup(bindGroup);
    this._field.applyBindGroup(bindGroup);
    bindGroup.setTexture(
      'ffFoamTex',
      this._look.getFoamTexture() ?? getDefaultFoamTexture(),
      fetchSampler('repeat_linear')
    );
    bindGroup.setValue('ffFoamUVScale', 1 / Math.max(0.01, this._look.getFoamTextureSize()));
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
