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
  Texture2D
} from '@zephyr3d/device';
import { getDevice } from '../app/api';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { getDefaultFoamTexture, sampleFoamTexture } from '../utility/textures/foam';
import type { WaveGenerator } from './wavegenerator';

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
 * Levels the field is sampled with. One for now; the levels are laid out as
 * Crest's LODs would be (each twice the size of the one before), and
 * {@link WaterFoamField.sample} picks between them, so more can be added
 * without touching what reads the field.
 */
const FOAM_FIELD_MAX_LEVELS = 1;
/** Cells along each side of a level. */
const FOAM_FIELD_CELLS = 256;
/**
 * Share of a level, from each edge inwards, over which its coverage falls to
 * 0, so the foam with memory hands over to the foam without it with no seam.
 */
const FOAM_FIELD_EDGE_BLEND = 0.15;
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
  /** Declares the uniforms {@link FoamFieldSource.calcFoamStep} reads, in bind group 0. */
  setupFoamSourceUniforms(scope: PBGlobalScope): void;
  /** Sets the uniforms {@link FoamFieldSource.setupFoamSourceUniforms} declared. */
  applyFoamSourceBindGroup(bindGroup: BindGroup): void;
  /**
   * The water's velocity at an undisplaced XZ and the foam made there this
   * step, as vec3(velocity x, velocity z, foam added).
   * @param dt - Seconds this step covers, 0 for a step that only moves the grid.
   * @param fadeRate - The field's fade rate per second, for prewarming.
   * @param prewarm - True on the first step, which fills the field as if the
   *   sources had been running for a while.
   */
  calcFoamStep(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp,
    prewarm: PBShaderExp
  ): PBShaderExp;
}

/** @internal */
interface FoamFieldLevel {
  textures: Texture2D[];
  framebuffers: FrameBuffer[];
  current: number;
  /** (origin x, origin z, cell size, cells) */
  region: Vector4;
}

/** @internal */
interface FoamStepProgram {
  program: GPUProgram;
  bindGroup: BindGroup;
}

/**
 * Foam with memory: a scalar field over the water, carried by the water's
 * velocity, fading over time and fed by its sources. One level of a square
 * grid that the water moves along with the camera; a move of the grid is
 * carried over in the next step, new cells starting without foam.
 * @public
 */
export class WaterFoamField extends Disposable {
  private _levels: FoamFieldLevel[];
  private _programs: Map<string, FoamStepProgram>;
  private _timeToSimulate: number;
  private _lastTime: number;
  private _prewarm: boolean;
  private _fadeRate: number;
  private _size: number;
  private _baseStrength: number;
  private _drift: number;
  /** Velocity the foam drifts at on the wind, metres per second. */
  private readonly _driftVelocity: Vector2;
  private readonly _region: Vector4;
  private _dummy: Nullable<Texture2D>;
  /** (dt, fade rate, prewarm, 0) */
  private readonly _params: Vector4;
  /** (clock in seconds, 0, 0, 0) */
  private readonly _clock: Vector4;
  private _version: number;
  constructor() {
    super();
    this._levels = [];
    this._programs = new Map();
    this._timeToSimulate = 0;
    this._lastTime = -1;
    this._prewarm = true;
    this._fadeRate = 0.8;
    this._size = 128;
    this._baseStrength = 1;
    this._drift = 0.03;
    this._driftVelocity = new Vector2();
    this._region = new Vector4();
    this._dummy = null;
    this._params = new Vector4();
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
  /** Side in metres of the square of water around the view that keeps its foam. */
  get size() {
    return this._size;
  }
  set size(val: number) {
    this._size = Math.max(8, val);
  }
  /**
   * Scale of the foam the open water's breaking crests leave behind, as
   * Crest's Wave Foam Strength: 0 keeps them as they were, foam only while the
   * crest breaks.
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
   * Places the grid around a point of the water, on whole cells so that the
   * field is carried over without resampling while the point stays put, and
   * steps the field there. See {@link WaterFoamField.step}.
   * @param focusX - World x the grid is centred on.
   * @param focusZ - World z the grid is centred on.
   * @param wind - Wind velocity in metres per second, or null for none.
   */
  stepAround(
    focusX: number,
    focusZ: number,
    time: number,
    wind: Nullable<Immutable<Vector2>>,
    source: FoamFieldSource
  ) {
    const cell = this._size / FOAM_FIELD_CELLS;
    const half = this._size * 0.5;
    this._region.setXYZW(
      Math.floor((focusX - half) / cell) * cell,
      Math.floor((focusZ - half) / cell) * cell,
      cell,
      FOAM_FIELD_CELLS
    );
    this._driftVelocity.setXY((wind?.x ?? 0) * this._drift, (wind?.y ?? 0) * this._drift);
    this.step(this._region, time, source);
  }
  /**
   * Steps the field to a clock time on a grid. The time behind is caught up in
   * fixed steps of 1 / FOAM_FIELD_FREQUENCY; with no step due, a step of no
   * time still carries the field over to where the grid now lies. The first
   * step prewarms it.
   * @param region - Grid placement: (origin x, origin z, cell size, cells).
   * @param time - Clock in seconds.
   * @param source - What feeds the field and carries it.
   */
  step(region: Vector4, time: number, source: FoamFieldSource) {
    const device = getDevice();
    const level = this.ensureLevel(device, 0, region);
    const dt = this._lastTime < 0 ? 0 : Math.min(Math.max(time - this._lastTime, 0), 0.25);
    this._lastTime = time;
    // The clock carries the foam texture along; readers see it every frame
    this._clock.x = time;
    this._version++;
    const moved = !level.region.equalsTo(region);
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
    device.pushDeviceStates();
    for (let i = 0; i < steps; i++) {
      // Only the first step carries the field across a move of the grid
      bindGroup.setValue('ffPrevRegion', i === 0 ? level.region : region);
      bindGroup.setValue('ffRegion', region);
      this._params.setXYZW(stepDt, this._fadeRate, this._prewarm ? 1 : 0, 0);
      bindGroup.setValue('ffParams', this._params);
      bindGroup.setTexture('ffSrc', level.textures[level.current], fetchSampler('clamp_linear_nomip'));
      device.setFramebuffer(level.framebuffers[1 - level.current]);
      device.setProgram(program);
      device.setBindGroup(0, bindGroup);
      drawFullscreenQuad();
      level.current = 1 - level.current;
      this._prewarm = false;
    }
    device.popDeviceStates();
    level.region.set(region);
  }
  /** Declares the uniforms {@link WaterFoamField.sample} reads. */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    for (let i = 0; i < FOAM_FIELD_MAX_LEVELS; i++) {
      scope[`ffTex${i}`] = pb.tex2D().uniform(uniformGroup);
      // (origin x, origin z, cell size, cells; 0 cells before the level exists)
      scope[`ffRegion${i}`] = pb.vec4().uniform(uniformGroup);
    }
    scope.ffDrift = pb.vec2().uniform(uniformGroup);
    scope.ffClock = pb.vec4().uniform(uniformGroup);
  }
  /** Sets the uniforms {@link WaterFoamField.setupUniforms} declared. */
  applyBindGroup(bindGroup: BindGroup) {
    for (let i = 0; i < FOAM_FIELD_MAX_LEVELS; i++) {
      const level = this._levels[i];
      bindGroup.setTexture(
        `ffTex${i}`,
        level ? level.textures[level.current] : this.getDummy(),
        fetchSampler('clamp_linear_nomip')
      );
      bindGroup.setValue(`ffRegion${i}`, level ? level.region : Vector4.zero());
    }
    bindGroup.setValue('ffDrift', this._driftVelocity);
    bindGroup.setValue('ffClock', this._clock);
  }
  /**
   * The field at an undisplaced XZ, as vec2(foam density, coverage): coverage
   * is 1 well inside a level, falls to 0 over the last FOAM_FIELD_EDGE_BLEND
   * of it and is 0 off every level, where the reader falls back to foam with
   * no memory.
   */
  sample(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('ffSample', [pb.vec2('xz')], function () {
      this.$l.result = pb.vec2(0);
      // Finest level first; the first that holds the point answers
      for (let i = FOAM_FIELD_MAX_LEVELS - 1; i >= 0; i--) {
        const r = this[`ffRegion${i}`];
        const tex = this[`ffTex${i}`];
        this.$l[`uv${i}`] = pb.div(pb.sub(this.xz, r.xy), pb.max(pb.mul(r.z, r.w), 1e-4));
        const uv = this[`uv${i}`];
        this.$l[`edge${i}`] = pb.min(pb.min(uv.x, uv.y), pb.min(pb.sub(1, uv.x), pb.sub(1, uv.y)));
        const edge = this[`edge${i}`];
        this.$if(pb.and(pb.greaterThan(r.w, 0), pb.greaterThan(edge, 0)), function () {
          this.result = pb.vec2(
            pb.textureSampleLevel(tex, uv, 0).r,
            pb.smoothStep(0, FOAM_FIELD_EDGE_BLEND, edge)
          );
        });
      }
      this.$return(this.result);
    });
    return scope.ffSample(xz) as PBShaderExp;
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
    this.disposeLevels();
    for (const p of this._programs.values()) {
      p.program.dispose();
      p.bindGroup.dispose();
    }
    this._programs.clear();
    this._dummy?.dispose();
    this._dummy = null;
  }
  /** @internal */
  private ensureLevel(device: AbstractDevice, index: number, region: Vector4) {
    const res = region.w;
    let level = this._levels[index];
    if (!level || level.textures[0].width !== res) {
      if (level) {
        this.disposeLevel(level);
      }
      const textures: Texture2D[] = [];
      const framebuffers: FrameBuffer[] = [];
      device.pushDeviceStates();
      for (let i = 0; i < 2; i++) {
        const tex = device.createTexture2D('r16f', res, res, { mipmapping: false })!;
        tex.name = `@WaterFoamField${index}_${i}`;
        const fb = device.createFrameBuffer([tex], null);
        device.setFramebuffer(fb);
        device.clearFrameBuffer(Vector4.zero(), null, null);
        textures.push(tex);
        framebuffers.push(fb);
      }
      device.popDeviceStates();
      level = { textures, framebuffers, current: 0, region: new Vector4(region) };
      this._levels[index] = level;
      this._prewarm = true;
    }
    return level;
  }
  /** @internal */
  private getStepProgram(device: AbstractDevice, source: FoamFieldSource) {
    let entry = this._programs.get(source.foamSourceKey);
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
          source.setupFoamSourceUniforms(this);
          this.ffSrc = pb.tex2D().uniform(0);
          this.ffRegion = pb.vec4().uniform(0);
          this.ffPrevRegion = pb.vec4().uniform(0);
          this.ffParams = pb.vec4().uniform(0);
          this.ffDrift = pb.vec2().uniform(0);
          pb.main(function () {
            this.$l.dt = this.ffParams.x;
            this.$l.fadeRate = this.ffParams.y;
            this.$l.prewarm = pb.greaterThan(this.ffParams.z, 0.5);
            // World position of this cell's centre
            this.$l.xz = pb.add(this.ffRegion.xy, pb.mul(this.$builtins.fragCoord.xy, this.ffRegion.z));
            this.$l.src = source.calcFoamStep(this, this.xz, this.dt, this.fadeRate, this.prewarm);
            // Sample from the previous step, upstream of the flow; nothing where
            // that falls off the grid as it was
            this.$l.flowed = pb.sub(this.xz, pb.mul(this.src.xy, this.dt));
            this.$l.prevUV = pb.div(
              pb.sub(this.flowed, this.ffPrevRegion.xy),
              pb.mul(this.ffPrevRegion.z, this.ffPrevRegion.w)
            );
            this.$l.rMax = pb.sub(0.5, pb.div(1, this.ffPrevRegion.w));
            this.$l.r = pb.abs(pb.sub(this.prevUV, pb.vec2(0.5)));
            this.$l.foam = pb.float(0);
            this.$if(pb.lessThanEqual(pb.max(this.r.x, this.r.y), this.rMax), function () {
              this.foam = pb.textureSampleLevel(this.ffSrc, this.prevUV, 0).r;
            });
            // Fade, then what the sources make
            this.foam = pb.mul(this.foam, pb.max(0, pb.sub(1, pb.mul(this.fadeRate, this.dt))));
            this.foam = pb.add(this.foam, this.src.z);
            this.$outputs.outColor = pb.vec4(pb.clamp(this.foam, 0, 1), 0, 0, 1);
          });
        }
      })!;
      program.name = `@WaterFoamFieldStep:${source.foamSourceKey}`;
      entry = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]) };
      this._programs.set(source.foamSourceKey, entry);
    }
    return entry;
  }
  /** @internal */
  private disposeLevel(level: FoamFieldLevel) {
    level.framebuffers.forEach((fb) => fb.dispose());
    level.textures.forEach((tex) => tex.dispose());
  }
  /** @internal */
  private disposeLevels() {
    this._levels.forEach((level) => this.disposeLevel(level));
    this._levels = [];
  }
  /** @internal */
  private getDummy() {
    if (!this._dummy) {
      this._dummy = getDevice().createTexture2D('rgba16f', 1, 1, { mipmapping: false })!;
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
    this._generator?.setupUniforms(scope, 0);
    scope.wgFoamSource = pb.vec4().uniform(0);
  }
  applyFoamSourceBindGroup(bindGroup: BindGroup) {
    this._generator?.applyWaterBindGroup(bindGroup);
    this._sourceParams.setXYZW(this._field.baseStrength, 0, 0, 0);
    bindGroup.setValue('wgFoamSource', this._sourceParams);
  }
  calcFoamStep(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp,
    prewarm: PBShaderExp
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
        this.$return(pb.vec3(this.ffDrift, pb.mul(FOAM_WAVE_GAIN, this.waveDt, this.strength, this.density)));
      }
    );
    return scope.wgFoamStep(xz, dt, fadeRate, prewarm) as PBShaderExp;
  }
}

/**
 * Velocity of the water carrying the foam, besides the drift on the wind, at an
 * undisplaced XZ in the material's shaders.
 * @public
 */
export interface FoamFlowSource {
  calcFoamFlow(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp;
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
  /** Velocity of the water besides the drift, from the shore waves while they are on. */
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
      if (foamSample) {
        // Carried by the water: the texture travels with the field's foam
        this.$if(pb.greaterThan(pb.mul(this.ff.x, this.ff.y), 0), function () {
          this.$l.flow = this.ffDrift;
          if (that.flowSource) {
            this.flow = pb.add(this.flow, that.flowSource.calcFoamFlow(this, this.xz));
          }
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
      this.$return(pb.vec4(this.nf.xyz, pb.mix(pb.clamp(this.nf.w, 0, 1), this.ff.x, this.ff.y)));
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
