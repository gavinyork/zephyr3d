import type { AABB, Nullable } from '@zephyr3d/base';
import { Disposable, float2half, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import type { WaveGenerator } from './wavegenerator';
import { getDevice } from '../app/api';
import { fetchSampler } from '../utility/misc';
import { valueNoise } from '../shaders/noise';

/** Texels of the wave profile along the phase (one wavelength) and along the life of a wave. */
const PROFILE_PHASES = 128;
const PROFILE_LIVES = 32;
/** Along-shore phase variation: cycles of noise per metre. */
const PHASE_NOISE_SCALE = 0.04;
/** Wave sets: noise per metre along the shore, its drift in cycles per second, and how deep the sets cut. */
const SET_SCALE = 0.02;
const SET_DRIFT = 0.02;
const SET_DEPTH = 0.6;
/**
 * Depth share of the zone, as distance over zone width, past which the waves
 * stop shortening: the crests keep at least sqrt of this times the wavelength
 * apart, as a broken bore does, instead of bunching up without limit.
 */
const MIN_COMPRESSION = 0.15;
/**
 * Range of the waterline model's B (vertical over horizontal field slope,
 * about 1 / tan of the bed angle) over which the waves fade in: none against
 * anything steeper than about 35 degrees, full on beaches gentler than 15.
 */
const SHELVING_MIN = 1.5;
const SHELVING_FULL = 4;
/**
 * Swash: distance in metres from the waterline out to sea over which the
 * surface turns from rising straight up to sliding along the bed, and the
 * largest slide per metre of rise (a bed at about 3 degrees).
 */
const SWASH_BAND = 3;
const SWASH_SLIDE_MAX = 20;
/**
 * Clearance of the swash sheet from the bed: how much faster its height over
 * the bed grows near zero, and the most it is raised (or lowered) by that.
 */
const SWASH_CLEAR_SLOPE = 8;
const SWASH_CLEARANCE = 0.06;
/** Forward displacement of the profile's lip, in amplitudes per unit of the profile's forward channel. */
const FORWARD_SCALE = 2;
/** Step in metres of the finite differences the fragment normal is taken with. */
const NORMAL_STEP = 0.25;

let profileTexture: Nullable<Texture2D> = null;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The shape of a shore wave over its life, as FluidFlux2 stores in a vector
 * displacement map: u is the phase across one wavelength, crest at 0, the
 * front (shoreward) side at u just below 1; v is the life, 0 where the wave
 * rises out of the sea at the outer edge of the zone, 1 at the waterline.
 *
 * - r: height, for an amplitude of 1. The crest sharpens and the front face
 *   steepens as the wave shoals, it peaks at the breaking point and collapses
 *   to a lower bore that runs on to the beach.
 * - g: forward displacement towards the shore, in amplitudes: the lip that
 *   pitches ahead of a breaking crest.
 * - b: foam, on and behind a breaking crest and over the bore.
 *
 * Generated once; rgba16f, repeat along u, clamped along v by the sampler.
 */
function getProfileTexture() {
  if (!profileTexture) {
    const data = new Uint16Array(PROFILE_PHASES * PROFILE_LIVES * 4);
    for (let j = 0; j < PROFILE_LIVES; j++) {
      const v = j / (PROFILE_LIVES - 1);
      // Rises out of the sea, grows as it shoals, breaks, then runs on as a bore
      const grow = smoothstep(0, 0.15, v) * (1 + 0.8 * v);
      const env = grow + (0.55 - grow) * smoothstep(0.78, 1, v);
      const sharp = 1 + 3 * smoothstep(0.1, 0.8, v);
      const lean = 1.1 * smoothstep(0.35, 0.82, v) * (1 - 0.6 * smoothstep(0.85, 1, v));
      const curl = 0.9 * smoothstep(0.55, 0.8, v) * (1 - smoothstep(0.85, 0.97, v));
      const breaking = smoothstep(0.7, 0.82, v);
      for (let i = 0; i < PROFILE_PHASES; i++) {
        const theta = (i / PROFILE_PHASES) * Math.PI * 2;
        // Front-leaning: the argument runs ahead on the front side (theta past pi)
        const t = theta > Math.PI ? theta - Math.PI * 2 : theta;
        const c = Math.cos(t + lean * (1 - Math.cos(t)) * (t < 0 ? 1 : -0.35));
        // Trochoid-like: sharp crests, flat troughs, mean near zero
        const shaped = 2 * Math.pow(0.5 + 0.5 * c, sharp) - 1;
        const crest = Math.max(0, shaped);
        const height = shaped * env;
        const forward = curl * env * Math.pow(crest, 3);
        const foam = Math.min(1, breaking * smoothstep(0.1, 0.7, crest) + 0.8 * smoothstep(0.92, 1, v));
        const o = (j * PROFILE_PHASES + i) * 4;
        data[o] = float2half(height);
        data[o + 1] = float2half(forward);
        data[o + 2] = float2half(foam);
        data[o + 3] = float2half(1);
      }
    }
    profileTexture = getDevice().createTexture2D('rgba16f', PROFILE_PHASES, PROFILE_LIVES, {
      mipmapping: false
    })!;
    profileTexture.name = '@ShoreWaveProfile';
    profileTexture.update(data, 0, 0, PROFILE_PHASES, PROFILE_LIVES);
  }
  return profileTexture;
}

/**
 * Settings of the waves breaking on the shore, see {@link ShoreWaveGenerator}.
 * @public
 */
export interface ShoreWaveSettings {
  /** Crest to trough height in metres where the waves are biggest, before breaking. */
  height: number;
  /** Distance in metres between crests at the outer edge of the zone; they bunch up towards the shore. */
  wavelength: number;
  /** Seconds between successive waves. */
  period: number;
  /** How far out from the waterline the waves rise, in metres. */
  zone: number;
}

/**
 * Waves that roll in to the shore, break and run up the beach, layered over
 * another generator. After FluidFlux2: a wave profile over its life is looked
 * up by the phase of the wave train and by the distance to the shore, both
 * taken from the scene's waterline field, so the crests always come square on
 * to the coast, bunch up as the water shallows and break at the same depth
 * along the whole shore.
 *
 * On the land side of the waterline the profile is frozen at its shoreline
 * value: a sheet of water at the height of the bore, which each arriving crest
 * lifts up the sand and each trough drains back, so the waterline surges and
 * retreats with the waves.
 *
 * Needs the waterline field, which the water hands over every frame with
 * {@link ShoreWaveGenerator.setFrame}; without it the waves are off and the
 * wrapped generator shows unchanged.
 *
 * @public
 */
export class ShoreWaveGenerator extends Disposable implements WaveGenerator {
  private readonly _base: WaveGenerator;
  private readonly _settings: ShoreWaveSettings;
  private _waterline: Nullable<Texture2D>;
  private _version: number;
  private _dummy: Nullable<Texture2D>;
  /** (grid origin x, origin z, 1 / grid size, rest level) */
  private readonly _grid: Vector4;
  /** (half height, zone, crests across the zone: 2 zone / wavelength, time / period) */
  private readonly _wave: Vector4;
  private readonly _prev: Vector4;
  constructor(base: WaveGenerator, settings: ShoreWaveSettings) {
    super();
    this._base = base;
    this._settings = settings;
    this._waterline = null;
    this._version = 0;
    this._dummy = null;
    this._grid = new Vector4(0, 0, 0, 0);
    this._wave = new Vector4(0, 1, 1, 0);
    this._prev = new Vector4(0, 0, 0, 0);
  }
  /** The generator the shore waves are layered over. */
  get base() {
    return this._base;
  }
  /** The settings, held by reference; changes apply at the next {@link setFrame}. */
  get settings() {
    return this._settings;
  }
  /**
   * Hands over the waterline field and the clock for this frame, or null for
   * the field when there is none, which turns the waves off.
   * @param region - Grid placement as the waterline field reports it: (origin x, origin z, cell size, cells).
   */
  setFrame(waterline: Nullable<Texture2D>, region: Vector4, level: number, timeInSeconds: number) {
    const s = this._settings;
    this._waterline = waterline;
    const size = region.z * region.w;
    this._grid.setXYZW(region.x, region.y, waterline && size > 0 ? 1 / size : 0, level);
    this._prev.x = this._wave.w;
    this._wave.setXYZW(
      waterline ? s.height * 0.5 : 0,
      Math.max(0.1, s.zone),
      (2 * Math.max(0.1, s.zone)) / Math.max(0.1, s.wavelength),
      timeInSeconds / Math.max(0.1, s.period)
    );
    this._version++;
  }
  clone() {
    return new ShoreWaveGenerator(this._base.clone(), { ...this._settings }) as this;
  }
  get version() {
    return this._base.version + this._version;
  }
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    this._base.setupUniforms(scope, uniformGroup);
    scope.swWaterline = pb.tex2D().uniform(uniformGroup);
    scope.swProfile = pb.tex2D().uniform(uniformGroup);
    scope.swGrid = pb.vec4().uniform(uniformGroup);
    scope.swWave = pb.vec4().uniform(uniformGroup);
    // (wave clock of the previous frame, 0, 0, 0)
    scope.swPrev = pb.vec4().uniform(uniformGroup);
  }
  /**
   * Shore wave at an undisplaced world XZ: (height, forward displacement,
   * foam, 0) and the direction to the shore in `dir`.
   * @internal
   */
  private evaluate(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dir: PBShaderExp,
    tPhase?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func('swEvaluate', [pb.vec2('xz'), pb.vec4('dir').out(), pb.float('tPhase')], function () {
      this.dir = pb.vec4(0);
      this.$l.uv = pb.mul(pb.sub(this.xz, this.swGrid.xy), this.swGrid.z);
      this.$if(
        pb.or(
          pb.lessThanEqual(this.swWave.x, 0),
          pb.or(pb.any(pb.lessThan(this.uv, pb.vec2(0))), pb.any(pb.greaterThan(this.uv, pb.vec2(1))))
        ),
        function () {
          this.$return(pb.vec4(0));
        }
      );
      // Smoothed shore coordinates: (signed distance to the waterline, negative inland; bed B)
      this.$l.wl = pb.textureSampleLevel(this.swWaterline, this.uv, 0);
      this.$l.d = this.wl.x;
      this.$l.zone = this.swWave.y;
      this.$if(pb.greaterThan(this.d, this.zone), function () {
        this.$return(pb.vec4(0));
      });
      // Direction to the shore: down the gradient of the distance, one cell either side
      this.$l.c = this.swGrid.z;
      this.$l.g = pb.vec2(
        pb.sub(
          pb.textureSampleLevel(this.swWaterline, pb.add(this.uv, pb.vec2(this.c, 0)), 0).x,
          pb.textureSampleLevel(this.swWaterline, pb.sub(this.uv, pb.vec2(this.c, 0)), 0).x
        ),
        pb.sub(
          pb.textureSampleLevel(this.swWaterline, pb.add(this.uv, pb.vec2(0, this.c)), 0).x,
          pb.textureSampleLevel(this.swWaterline, pb.sub(this.uv, pb.vec2(0, this.c)), 0).x
        )
      );
      this.dir = pb.vec4(pb.neg(pb.div(this.g, pb.max(pb.length(this.g), 1e-5))), 0, 0);
      // Phase: crests travel shoreward and bunch up as they go, the integral
      // of 1 / wavelength with the wavelength shrinking as sqrt of the depth;
      // frozen at its shoreline value inland, where the bore becomes a sheet
      // Past the breaking depth the bore no longer shortens: below `dMin` the
      // phase runs on linearly at the rate it had there, instead of sqrt's
      // spacing collapsing to nothing at the waterline
      this.$l.dc = pb.max(this.d, 0);
      this.$l.dMin = pb.mul(this.zone, MIN_COMPRESSION);
      this.$l.rootMin = pb.sqrt(MIN_COMPRESSION);
      this.$l.rootTerm = this.$choice(
        pb.greaterThan(this.dc, this.dMin),
        pb.sqrt(pb.div(this.dc, this.zone)),
        pb.add(this.rootMin, pb.div(pb.sub(this.dc, this.dMin), pb.mul(2, this.rootMin, this.zone)))
      );
      this.$l.phase = pb.add(
        this.tPhase,
        pb.mul(this.swWave.z, this.rootTerm),
        valueNoise(this, pb.mul(this.xz, PHASE_NOISE_SCALE))
      );
      this.$l.life = pb.sub(1, pb.div(this.dc, this.zone));
      this.$l.pu = pb.fract(this.phase);
      this.$l.pv = pb.add(pb.mul(this.life, (PROFILE_LIVES - 1) / PROFILE_LIVES), 0.5 / PROFILE_LIVES);
      this.$l.prof = pb.textureSampleLevel(this.swProfile, pb.vec2(this.pu, this.pv), 0);
      // Sets: the waves swell and fade along the coast and over time
      this.$l.waveSet = pb.sub(
        1,
        pb.mul(
          SET_DEPTH,
          pb.sub(
            1,
            pb.smoothStep(
              0.3,
              0.7,
              valueNoise(this, pb.add(pb.mul(this.xz, SET_SCALE), pb.vec2(pb.mul(this.tPhase, SET_DRIFT), 0)))
            )
          )
        )
      );
      // The sheet runs only as far inland as a bore can climb the slope: the
      // height over the slope, with the model's B being 1 / tan of the bed angle
      this.$l.reach = pb.max(pb.mul(this.swWave.x, pb.max(this.wl.y, 1), 2), 0.5);
      this.$l.inland = pb.sub(1, pb.smoothStep(this.reach, pb.mul(this.reach, 1.5), pb.neg(this.d)));
      // Only where the bed shelves: waves roll in as surf on a beach, not
      // against a cliff, a pier or a hull, which the waterline field also holds
      this.$l.shelving = pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y);
      this.$l.amp = pb.mul(this.swWave.x, this.waveSet, this.inland, this.shelving);
      // Swash weight, 1 at and inland of the waterline, 0 a few metres out
      this.dir.z = pb.mul(pb.sub(1, pb.smoothStep(0, SWASH_BAND, this.d)), this.shelving);
      // Height of the rest surface over the bed under it, which the swash slide keeps
      this.dir.w = pb.div(this.d, pb.clamp(this.wl.y, 1, SWASH_SLIDE_MAX));
      this.$return(
        pb.vec4(
          pb.mul(this.prof.x, this.amp),
          pb.mul(this.prof.y, this.amp, FORWARD_SCALE),
          pb.mul(this.prof.z, this.waveSet, this.inland, this.shelving),
          // Swash: how far a unit of height moves the surface shoreward, so the
          // rise follows the bed instead of going straight up through the sand.
          // B (1 / tan of the bed angle) near the shore, fading to 0 offshore.
          pb.mul(pb.clamp(this.wl.y, 0, SWASH_SLIDE_MAX), this.dir.z)
        )
      );
    });
    return scope.swEvaluate(xz, dir, tPhase ?? scope.swWave.w) as PBShaderExp;
  }
  /**
   * Adds the shore wave to a position the wrapped generator displaced, at a
   * wave clock (time over period): up, and forward towards the shore, the lip
   * pitching ahead of a breaking crest. In the swash the rise slides along the
   * bed tangent instead, so a vertex under the sand stays that far under it
   * and only the water's edge climbs the beach; and the wrapped generator's
   * chop dies there, which left standing would poke through the sand and slid
   * would throw the waterline about by B times every ripple.
   * @internal
   */
  private displace(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    basePos: PBShaderExp,
    tPhase: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func('swDisplace', [pb.vec3('inPos'), pb.vec3('basePos'), pb.float('tPhase')], function () {
      this.$l.dir = pb.vec4(0);
      // At the undisplaced position, where the fragment stage evaluates it too
      this.$l.sw = that.evaluate(this, this.inPos.xz, this.dir, this.tPhase);
      this.$l.p = pb.mix(this.basePos, this.inPos, this.dir.z);
      // The slide keeps every vertex at its height over the bed, so near the
      // waterline the sheet lies on the sand within millimetres, and the depth
      // test flips between the two under TAA's jitter. Remapped so the water
      // stands clear of the bed or clearly under it: the height over the bed
      // grows SWASH_CLEAR_SLOPE times faster near zero, up to SWASH_CLEARANCE
      // more than it was, which narrows the near-coincident band as much.
      this.$l.gap = this.dir.w;
      this.$l.gapClear = pb.mul(
        pb.sign(this.gap),
        pb.min(pb.mul(pb.abs(this.gap), SWASH_CLEAR_SLOPE), pb.add(pb.abs(this.gap), SWASH_CLEARANCE))
      );
      this.p.y = pb.add(this.p.y, pb.mul(pb.sub(this.gapClear, this.gap), this.dir.z));
      this.$l.fwd = pb.add(this.sw.y, pb.mul(this.sw.x, this.sw.w));
      this.$return(
        pb.add(this.p, pb.vec3(pb.mul(this.dir.x, this.fwd), this.sw.x, pb.mul(this.dir.y, this.fwd)))
      );
    });
    return scope.swDisplace(inPos, basePos, tPhase) as PBShaderExp;
  }
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'swCalcPositionAndNormal',
      [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out()],
      function () {
        that._base.calcVertexPositionAndNormal(this, this.inPos, this.outPos, this.outNormal);
        this.outPos = that.displace(this, this.inPos, this.outPos, this.swWave.w);
      }
    );
    scope.swCalcPositionAndNormal(inPos, outPos, outNormal);
  }
  /**
   * Where a vertex was in the previous frame, for motion vectors: the shore
   * wave at the previous frame's clock. The shore waves sweep metres across
   * the beach in a second, and without this the temporal filter smears and
   * jitters their edge. The wrapped generator is taken as it is now.
   */
  calcPrevVertexPosition(scope: PBInsideFunctionScope, inPos: PBShaderExp, outPos: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    pb.func('swCalcPrevPosition', [pb.vec3('inPos'), pb.vec3('outPos').out()], function () {
      this.$l.n = pb.vec3(0, 1, 0);
      that._base.calcVertexPositionAndNormal(this, this.inPos, this.outPos, this.n);
      this.outPos = that.displace(this, this.inPos, this.outPos, this.swPrev.x);
    });
    scope.swCalcPrevPosition(inPos, outPos);
  }
  /**
   * Slope of the shore wave height at an undisplaced XZ, by central differences.
   * @internal
   */
  private slope(scope: PBInsideFunctionScope, xz: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    pb.func('swSlope', [pb.vec2('xz')], function () {
      this.$l.dir = pb.vec4(0);
      this.$l.hx1 = that.evaluate(this, pb.add(this.xz, pb.vec2(NORMAL_STEP, 0)), this.dir).x;
      this.$l.hx0 = that.evaluate(this, pb.sub(this.xz, pb.vec2(NORMAL_STEP, 0)), this.dir).x;
      this.$l.hz1 = that.evaluate(this, pb.add(this.xz, pb.vec2(0, NORMAL_STEP)), this.dir).x;
      this.$l.hz0 = that.evaluate(this, pb.sub(this.xz, pb.vec2(0, NORMAL_STEP)), this.dir).x;
      this.$return(pb.div(pb.vec2(pb.sub(this.hx1, this.hx0), pb.sub(this.hz1, this.hz0)), 2 * NORMAL_STEP));
    });
    return scope.swSlope(xz) as PBShaderExp;
  }
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, vertexNormal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swCalcFragmentNormal', [pb.vec2('xz'), pb.vec3('vn')], function () {
      this.$l.n = pb.normalize(that._base.calcFragmentNormal(this, this.xz, this.vn));
      this.$l.s = that.slope(this, this.xz);
      // Tilting the base normal by the shore wave's slope
      this.$return(pb.normalize(pb.add(this.n, pb.vec3(pb.neg(this.s.x), 0, pb.neg(this.s.y)))));
    });
    return scope.swCalcFragmentNormal(xz, vertexNormal) as PBShaderExp;
  }
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swCalcNormalAndFoam', [pb.vec2('xz'), pb.vec3('vn')], function () {
      this.$l.nf = that._base.calcFragmentNormalAndFoam(this, this.xz, this.vn);
      this.$l.s = that.slope(this, this.xz);
      this.$l.n = pb.normalize(
        pb.add(pb.normalize(this.nf.xyz), pb.vec3(pb.neg(this.s.x), 0, pb.neg(this.s.y)))
      );
      // The breaking crests and the bore are white; composed with the base
      // foam as overlapping coverage, as the material does with the shore foam
      this.$l.dir = pb.vec4(0);
      this.$l.f = pb.clamp(that.evaluate(this, this.xz, this.dir).z, 0, 1);
      this.$return(
        pb.vec4(this.n, pb.sub(1, pb.mul(pb.sub(1, pb.clamp(this.nf.w, 0, 1)), pb.sub(1, this.f))))
      );
    });
    return scope.swCalcNormalAndFoam(xz, vertexNormal) as PBShaderExp;
  }
  applyWaterBindGroup(bindGroup: BindGroup) {
    this._base.applyWaterBindGroup(bindGroup);
    bindGroup.setTexture(
      'swWaterline',
      this._waterline ?? this.getDummy(),
      fetchSampler('clamp_linear_nomip')
    );
    bindGroup.setTexture('swProfile', getProfileTexture(), fetchSampler('repeat_linear_nomip'));
    bindGroup.setValue('swGrid', this._grid);
    bindGroup.setValue('swWave', this._wave);
    bindGroup.setValue('swPrev', this._prev);
  }
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    this._base.calcClipmapTileAABB(minX, maxX, minZ, maxZ, y, outAABB);
    // The profile peaks at about 1.8 amplitudes before breaking
    const reach = this._settings.height;
    outAABB.minPoint.y -= reach;
    outAABB.maxPoint.y += reach;
    // The lip pitches forward, and the swash slides up the beach by up to
    // SWASH_SLIDE_MAX times its rise
    const slide = reach * SWASH_SLIDE_MAX;
    outAABB.minPoint.x -= slide;
    outAABB.minPoint.z -= slide;
    outAABB.maxPoint.x += slide;
    outAABB.maxPoint.z += slide;
  }
  /** The material steps the base generator; the clock comes with {@link setFrame}. */
  update() {}
  getHash() {
    return `${this._base.getHash()}:SW`;
  }
  needUpdate() {
    return true;
  }
  isOk(device: AbstractDevice) {
    return this._base.isOk(device);
  }
  protected onDispose() {
    super.onDispose();
    this._dummy?.dispose();
    this._dummy = null;
  }
  /** @internal */
  private getDummy() {
    if (!this._dummy) {
      this._dummy = getDevice().createTexture2D('rgba16f', 1, 1, { mipmapping: false })!;
    }
    return this._dummy;
  }
}
