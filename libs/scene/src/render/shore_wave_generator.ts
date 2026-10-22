import type { AABB, Nullable } from '@zephyr3d/base';
import { Disposable, float2half, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import type { WaveGenerator } from './wavegenerator';
import type { FoamFieldSource, FoamFlowSource } from './water_foam';
import { FOAM_WAVE_GAIN } from './water_foam';
import { getDevice } from '../app/api';
import { fetchSampler } from '../utility/misc';
import { hash11, valueNoise } from '../shaders/noise';

/** Texels of the inverse table along y = x - b sin x over one period, and along b. */
const INVERSE_SAMPLES = 256;
const INVERSE_SHARPNESS = 32;
/** Largest b the inverse table holds; at 1 the crest becomes a cusp. */
const SHARPNESS_MAX = 0.95;
/** Wave sets: noise per metre along the shore, its drift in cycles per wave, and how deep the sets cut. */
const SET_SCALE = 0.02;
const SET_DRIFT = 0.02;
const SET_DEPTH = 0.6;
/**
 * Irregular waves. A point d out sees at time t the crest that left the outer
 * edge tau(d) earlier, so the phase is Psi(t / T + tau(d) / T), with
 * Psi(s) = s + J(s, foot): noise J in s gives each wave its own period, and
 * noise along the shore (at the foot of each waterline point) its own bend.
 * Psi must keep rising (1 + dJ/ds > 0) or crests would pass each other; at full
 * irregularity dJ/ds is at most IRREGULAR_AMPLITUDE * IRREGULAR_RATE * 1.5 = 0.56.
 *
 * IRREGULAR_RATE: noise cycles per wave; IRREGULAR_SHORE_SCALE: noise cycles per
 * metre along the shore; IRREGULAR_AMPLITUDE: wave cycles J spans at full irregularity.
 */
const IRREGULAR_RATE = 0.15;
const IRREGULAR_SHORE_SCALE = 0.035;
const IRREGULAR_AMPLITUDE = 2.5;
/** Step in wave cycles over which dJ/ds is taken. */
const IRREGULAR_STEP = 0.05;
/**
 * Crest segments: each wave rises and falls along the shore by its own noise.
 * Noise per metre along the shore, and how deep the gaps cut.
 */
const SEGMENT_SCALE = 0.06;
const SEGMENT_DEPTH = 0.85;
/**
 * Band limit of the displacement against the mesh, after Crest's per-LOD
 * wavelength filtering (Bowles, "Crest: Novel ocean rendering techniques in an
 * open source framework", SIGGRAPH 2017): as mesh vertices per crest spacing
 * fall from SHARP_SAMPLES_FULL to SHARP_SAMPLES_MIN the sharpened profile eases
 * back to a sine; from AMP_SAMPLES_FULL to AMP_SAMPLES_MIN the wave flattens.
 * The fragment stage keeps the full profile in its normals.
 */
const SHARP_SAMPLES_MIN = 4;
const SHARP_SAMPLES_FULL = 12;
const AMP_SAMPLES_MIN = 2;
const AMP_SAMPLES_FULL = 4;
/**
 * The swash, after the ballistic run-up of Shen & Meyer ("Climb of a bore on a
 * beach", JFM 16, 1963) in the form of Peregrine & Williams ("Swash overtopping
 * a truncated plane beach", JFM 440, 2001): the tip leaves the waterline at u0
 * and slows under g tan(beta), s_f = u0 t - g tan(beta) t^2 / 2, with depth
 * h = (s_f - s)^2 / (36 g t^2) behind it. u0 = sqrt(2 g height); the run up and
 * back lasts 2 u0 / (g tan(beta)), at most SWASH_DURATION_MAX wave periods.
 *
 * Water velocity u = ds_f/dt + (2/3)(s - s_f) / t, from continuity
 * h_t + (u h)_s = 0.
 */
const SWASH_GRAVITY = 9.81;
const SWASH_DURATION_MAX = 0.8;
/** Metres inland over which the crest collapsing at the waterline sinks exponentially into the swash. */
const SWASH_COLLAPSE = 0.6;
/**
 * Depth share of the zone (distance over zone width) past which the waves stop
 * shortening, so crests keep at least sqrt of this times the wavelength apart.
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
 * Within FOAM_SLIP_BAND metres of a waterline too steep for surf (rocks, cliffs,
 * piers; see SHELVING_MIN) foam is carried out along the wall's normal at the
 * wall foam's drift speed, blending into the water's own velocity over that
 * distance, so it rings the wall evenly whatever the wind. Not on a beach.
 */
const FOAM_SLIP_BAND = 2;
/**
 * Thin swash imprints its foam on the sand, at a rate per second rising to
 * FOAM_DEPOSIT_RATE as the sheet thins below FOAM_DEPOSIT_DEPTH metres; where
 * it drains away entirely, at FOAM_STRAND_RATE. The thin front of the uprush
 * crosses each cell in a few hundredths of a second, carrying the densest
 * foam, so the rate has to imprint most of it in one pass: otherwise only the
 * highest reach, where the front lingers, keeps foam, and the backwash leaves
 * it there as a band apart from the water.
 */
const FOAM_DEPOSIT_DEPTH = 0.05;
const FOAM_DEPOSIT_RATE = 30;
const FOAM_STRAND_RATE = 30;
/**
 * The near-shore zone, see nearShore: still water shallower than the shore
 * wave height over NEAR_SHORE_BREAKER (a wave breaks once its height reaches
 * about 0.78 of the depth), blended into the open water over a further
 * NEAR_SHORE_BLEND of that depth. Foam there stands still and is at least
 * NEAR_SHORE_FOAM_EDGE at the threshold, rising to NEAR_SHORE_FOAM_SHORE at
 * the waterline and on the wet beach.
 */
const NEAR_SHORE_BREAKER = 0.78;
const NEAR_SHORE_BLEND = 0.5;
const NEAR_SHORE_FOAM_EDGE = 0.6;
const NEAR_SHORE_FOAM_SHORE = 0.85;
/**
 * Seconds over which the water's speed at a wall is averaged before it makes
 * foam there, about a wave period: see the wall foam step.
 */
const WALL_SPEED_AVERAGE = 3;
/**
 * Metres past FOAM_SLIP_BAND within which a cell's water is followed to where
 * the waves carry it, about the largest horizontal displacement of choppy waves.
 */
const WALL_DISPLACEMENT_REACH = 6;
/**
 * FOAM_WALL: foam the water makes dashing against a wall, after the trapped-air
 * potential of Ihmsen, Akinci, Akinci & Teschner, "Unified Spray, Foam and
 * Bubbles for Particle-Based Fluids" (CGI 2012), eq. (1)-(3) and (8):
 * v_diff = sum |v_ij| (1 - v_ij . x_ij) W(x_ij, h), W = 1 - |x| / h, clamped by
 * Phi(I, tmin, tmax) = (min(I, tmax) - min(I, tmin)) / (tmax - tmin), and foam
 * made at a rate k I_k I_ta with I_k = Phi(E_k).
 *
 * Here the neighbour is the wall at rest, h = FOAM_SLIP_BAND along its normal n:
 * v_diff = (|v| - v . n) W, averaged over a wave's orbit to |v| W so every face
 * of a wall foams alike. |v| is the surface's rate of rise, which also works for
 * generators that only displace vertically (FBM). The wall-at-rest neighbour,
 * the orbit average, the thresholds, the per-unit-mass kinetic energy and the
 * weighting by wall steepness are adaptations, not from the paper.
 *
 * The foam goes to a layer of its own (see FoamFieldSource), shown whole with
 * its strength as opacity rather than cut from the foam texture. It is made at
 * FOAM_WAVE_GAIN regardless of the strength, so it saturates against the wall.
 */
/** Largest B anything here is worked out with, a bed at about 3 degrees. */
const B_MAX = 20;
/** Distance in metres out from the waterline over which the wrapped generator's chop dies away. */
const CHOP_FADE = 3;
/**
 * The water's edge on the beach is cut per pixel (see calcSurfaceCoverage)
 * where the water meets the bed height of the waterline field; near the edge
 * the mesh is held SWASH_CLEARANCE metres over the bed. That applies where the
 * bed is at most SWASH_LIFT_MARGIN above the highest water, up to
 * SWASH_EDGE_EXTEND metres past the farthest the water reaches; the edge is
 * softened over SWASH_EDGE_SOFT metres.
 */
const SWASH_CLEARANCE = 0.06;
const SWASH_LIFT_MARGIN = 0.1;
const SWASH_EDGE_EXTEND = 2;
const SWASH_EDGE_SOFT = 0.08;
/**
 * Share of the grid, from each edge inwards, over which the waves fade out,
 * so the grid following the camera has no visible border.
 */
const GRID_EDGE_FADE = 0.15;
/**
 * Levels of the shore field the waves read, at most. A level's distance to
 * the waterline is exact only while it is shorter than the way to the level's
 * edge (a shore off the grid may lie nearer); over SHORE_TRUST_START to 1 of
 * that ratio a level hands over to the next coarser one, the coarsest taking
 * what is left.
 */
const SHORE_LEVELS_MAX = 4;
const SHORE_TRUST_START = 0.5;
/**
 * The foam the shore waves make feeds the water's foam field (see
 * {@link WaterFoamField}), as Crest's UpdateFoam.compute (Wave Harmonic, MIT)
 * is fed: by the waves where their displacement is squeezed (the determinant
 * of its Jacobian below a coverage threshold) and by shallow water.
 */

let inverseTexture: Nullable<Texture2D> = null;
/** Names the level weights of callers that do not want them. */
let weightLocals = 0;
const COMPONENTS = ['x', 'y', 'z', 'w'] as const;

/**
 * The inverse of y = x - b sin x over one period, which carries the wave
 * profile from its parameter to the distance along the wave: u is y / 2pi in
 * [0, 1], v is b / SHARPNESS_MAX; the texel holds x / 2pi. y increases with x
 * for b below 1, so the inverse is unique, solved here by bisection once.
 */
function getInverseTexture() {
  if (!inverseTexture) {
    const data = new Uint16Array(INVERSE_SAMPLES * INVERSE_SHARPNESS * 4);
    for (let j = 0; j < INVERSE_SHARPNESS; j++) {
      const b = (j / (INVERSE_SHARPNESS - 1)) * SHARPNESS_MAX;
      for (let i = 0; i < INVERSE_SAMPLES; i++) {
        const y = (i / (INVERSE_SAMPLES - 1)) * Math.PI * 2;
        let lo = 0;
        let hi = Math.PI * 2;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) * 0.5;
          if (mid - b * Math.sin(mid) < y) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const o = (j * INVERSE_SAMPLES + i) * 4;
        data[o] = float2half(((lo + hi) * 0.5) / (Math.PI * 2));
        data[o + 3] = float2half(1);
      }
    }
    inverseTexture = getDevice().createTexture2D('rgba16f', INVERSE_SAMPLES, INVERSE_SHARPNESS, {
      mipmapping: false
    })!;
    inverseTexture.name = '@ShoreWaveInverse';
    inverseTexture.update(data, 0, 0, INVERSE_SAMPLES, INVERSE_SHARPNESS);
  }
  return inverseTexture;
}

/**
 * Settings of the waves breaking on the shore, see {@link ShoreWaveGenerator}.
 * @public
 */
export interface ShoreWaveSettings {
  /** Crest to trough height in metres of the waves at the shore. */
  height: number;
  /** Distance in metres between crests at the outer edge of the zone; they bunch up towards the shore. */
  wavelength: number;
  /** Seconds between successive waves. */
  period: number;
  /** How far out from the waterline the waves rise, in metres. */
  zone: number;
  /** How sharp the crests become at the shore, 0 for a sine and towards 1 for a cusp. */
  sharpness: number;
  /** How far the crests lean towards the shore there, 0 for upright, 1 for a steep front face. */
  lean: number;
  /**
   * How irregular the waves are, 0..1: 0 for crests coming in as parallel
   * lines a fixed wavelength apart, higher for each wave with a period and a
   * bend of its own. Defaults to 0.6.
   */
  irregularity?: number;
  /** Scale of the foam the breaking waves make (Crest's Wave Foam Strength). Defaults to 1. */
  waveFoamStrength?: number;
  /** How much of the waves makes foam, 0..1, higher for more (Crest's Wave Foam Coverage). Defaults to 0.55. */
  waveFoamCoverage?: number;
  /** Water shallower than this many metres makes foam (Crest's Shoreline Foam Max Depth). Defaults to 0.65. */
  shorelineFoamMaxDepth?: number;
  /** Scale of the foam shallow water makes (Crest's Shoreline Foam Strength). Defaults to 2. */
  shorelineFoamStrength?: number;
  /** How opaque the foam the water makes dashing against walls, rocks and piers is, 0..1 (see FOAM_WALL). Defaults to 1. */
  wallFoamStrength?: number;
  /** Impact speed in metres per second below which the water makes no foam against a wall. Defaults to 0.2. */
  wallFoamMinSpeed?: number;
  /** Impact speed in metres per second at and above which the water makes the most foam against a wall. Defaults to 1.5. */
  wallFoamMaxSpeed?: number;
  /** Speed in metres per second the foam drifts out from a wall at, which sets how wide a ring it makes. Defaults to 0.3. */
  wallFoamDrift?: number;
}

/**
 * Waves that roll in to the shore and wash up the beach, layered over another
 * generator. After the "near-shore waves" articles by Yang Chao: a wave train
 * whose distance along the way in is the distance to the waterline, taken from
 * the scene's waterline field, so the crests come square on to the coast;
 * whose wavelength shortens towards the shore; and whose profile is a
 * trochoid, Y = A (cos x + 1) / 2 at X = (x - b sin x) / 2pi raised to the
 * power r, sharpening (b) and leaning shoreward (r below 1) as it shoals.
 *
 * The profile never drops below the rest level, so each crest lifts the
 * water over the beach and each trough lets it drain: the water's edge, cut
 * per pixel where the water meets the bed, runs up the sand and back with the
 * waves, along the beach's own shape.
 *
 * Needs the waterline field, which the water hands over every frame with
 * {@link ShoreWaveGenerator.setFrame}; without it the waves are off and the
 * wrapped generator shows unchanged.
 *
 * @public
 */
export class ShoreWaveGenerator extends Disposable implements WaveGenerator, FoamFieldSource, FoamFlowSource {
  private readonly _base: WaveGenerator;
  private readonly _settings: ShoreWaveSettings;
  /** The shore field's levels, and the wall field, see {@link ShoreWaveGenerator.setFrame}. */
  private _shore: Nullable<Texture2DArray>;
  private _wall: Nullable<Texture2DArray>;
  private _version: number;
  private _dummy: Nullable<Texture2DArray>;
  /** Of the wall field: (grid origin x, origin z, 1 / grid size, rest level) */
  private readonly _grid: Vector4;
  /** Per shore level: (grid origin x, origin z, 1 / grid size, cell size); 0 size for none. */
  private readonly _shoreLevels: Vector4[];
  /** (shore levels, 0, 0, 0) */
  private readonly _shoreInfo: Vector4;
  /** (height, zone, crests across the zone: 2 zone / wavelength, time / period) */
  private readonly _wave: Vector4;
  /** (sharpness at the shore, lean at the shore, wave clock of the previous frame, period in seconds) */
  private readonly _shape: Vector4;
  /** (wave cycles the irregularity spans, wall foam drift speed, 0, 0) */
  private readonly _vary: Vector4;
  /** What the open water feeds the foam field with, which the shore waves add theirs to. */
  private readonly _baseFoamSource: FoamFieldSource;
  /** (wave foam strength, wave foam coverage, shoreline foam strength, shoreline foam max depth) */
  private readonly _foamSourceParams: Vector4;
  /** (wall foam strength, min impact speed, max impact speed, 0) */
  private readonly _wallFoamParams: Vector4;
  /** The foam field step reads the shore waves under this key. */
  readonly foamSourceKey: string;
  readonly supportsFoamDeposition = true;
  calcUnresolvedSlopeVariance?: WaveGenerator['calcUnresolvedSlopeVariance'];
  constructor(base: WaveGenerator, settings: ShoreWaveSettings, baseFoamSource: FoamFieldSource) {
    super();
    this._base = base;
    // The shore waves are smooth at any footprint; the slopes lost are the open sea's
    if (base.calcUnresolvedSlopeVariance) {
      this.calcUnresolvedSlopeVariance = base.calcUnresolvedSlopeVariance.bind(base);
    }
    this._settings = settings;
    this._baseFoamSource = baseFoamSource;
    this.foamSourceKey = `SW:${baseFoamSource.foamSourceKey}`;
    this._shore = null;
    this._wall = null;
    this._version = 0;
    this._dummy = null;
    this._grid = new Vector4(0, 0, 0, 0);
    this._shoreLevels = Array.from({ length: SHORE_LEVELS_MAX }, () => new Vector4(0, 0, 0, 0));
    this._shoreInfo = new Vector4(0, 0, 0, 0);
    this._wave = new Vector4(0, 1, 1, 0);
    this._shape = new Vector4(0, 0, 0, 0);
    this._vary = new Vector4(0, 0, 0, 0);
    this._foamSourceParams = new Vector4();
    this._wallFoamParams = new Vector4();
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
   * Hands over the waterline fields and the clock for this frame. The shore
   * field, in levels, shapes the waves and the beach's foam; without it the
   * waves are off. The wall field, a single level, makes the foam against
   * walls, rocks and piers; without it there is none.
   * @param shore - The shore field's smoothed array, a layer per level.
   * @param shoreRegions - Per level as the field reports it: (origin x, origin z, cell size, cells); 0 cells for none.
   * @param wall - The wall field's smoothed array, read at layer 0.
   * @param wallRegion - Its grid, as the shore levels'.
   */
  setFrame(
    shore: Nullable<Texture2DArray>,
    shoreRegions: readonly Vector4[],
    wall: Nullable<Texture2DArray>,
    wallRegion: Vector4,
    level: number,
    timeInSeconds: number
  ) {
    const s = this._settings;
    this._shore = shore;
    this._wall = wall;
    const levels = shore ? Math.min(shoreRegions.length, SHORE_LEVELS_MAX) : 0;
    for (let i = 0; i < SHORE_LEVELS_MAX; i++) {
      const r = i < levels ? shoreRegions[i] : null;
      const size = r ? r.z * r.w : 0;
      this._shoreLevels[i].setXYZW(r?.x ?? 0, r?.y ?? 0, size > 0 ? 1 / size : 0, r?.z ?? 0);
    }
    this._shoreInfo.x = levels;
    const shoreReady = levels > 0 && this._shoreLevels[0].z > 0;
    const wallSize = wallRegion.z * wallRegion.w;
    this._grid.setXYZW(wallRegion.x, wallRegion.y, wall && wallSize > 0 ? 1 / wallSize : 0, level);
    const zone = Math.max(0.1, s.zone);
    this._shape.setXYZW(
      Math.min(Math.max(s.sharpness, 0), SHARPNESS_MAX),
      Math.min(Math.max(s.lean, 0), 1),
      this._wave.w,
      Math.max(0.1, s.period)
    );
    this._wave.setXYZW(
      shoreReady ? Math.max(0, s.height) : 0,
      zone,
      (2 * zone) / Math.max(0.1, s.wavelength),
      timeInSeconds / Math.max(0.1, s.period)
    );
    this._vary.x = Math.min(Math.max(s.irregularity ?? 0.6, 0), 1) * IRREGULAR_AMPLITUDE;
    this._vary.y = Math.max(0, s.wallFoamDrift ?? 0.3);
    this._version++;
  }
  setupFoamSourceUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    this._baseFoamSource.setupFoamSourceUniforms(scope);
    this.setupShoreUniforms(scope, 0);
    scope.swFoamSource = pb.vec4().uniform(0);
    // (strength, min impact speed, max impact speed, 0)
    scope.swWallFoam = pb.vec4().uniform(0);
  }
  applyFoamSourceBindGroup(bindGroup: BindGroup) {
    const s = this._settings;
    this._baseFoamSource.applyFoamSourceBindGroup(bindGroup);
    this.applyShoreBindGroup(bindGroup);
    this._foamSourceParams.setXYZW(
      s.waveFoamStrength ?? 1,
      s.waveFoamCoverage ?? 0.55,
      s.shorelineFoamStrength ?? 2,
      Math.max(0.01, s.shorelineFoamMaxDepth ?? 0.65)
    );
    bindGroup.setValue('swFoamSource', this._foamSourceParams);
    const minSpeed = Math.max(0, s.wallFoamMinSpeed ?? 0.2);
    this._wallFoamParams.setXYZW(
      Math.min(Math.max(s.wallFoamStrength ?? 1, 0), 1),
      minSpeed,
      Math.max(minSpeed + 1e-3, s.wallFoamMaxSpeed ?? 1.5),
      0
    );
    bindGroup.setValue('swWallFoam', this._wallFoamParams);
  }
  /**
   * The velocity carrying the foam (drift and the swash, led along walls) and
   * the foam the shore waves make this step: from the waves where their
   * displacement squeezes the water and from shallow water, both prewarmed as
   * Crest does, and from the water dashing against walls (see FOAM_WALL);
   * added to the open water's. Keeps the wrapped generator's displacement in
   * the field's state near walls.
   */
  calcFoamStep(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dt: PBShaderExp,
    fadeRate: PBShaderExp,
    prewarm: PBShaderExp,
    state: PBShaderExp,
    contact?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const funcName = contact ? 'swFoamDepositStep' : 'swFoamStep';
    pb.func(
      funcName,
      [
        pb.vec2('xz'),
        pb.float('dt'),
        pb.float('fadeRate'),
        pb.bool('prewarm'),
        pb.vec4('state').inout(),
        ...(contact ? [pb.vec2('contact').out()] : [])
      ],
      function () {
        if (contact) {
          this.contact = pb.vec2(0);
        }
        this.$l.baseStep = that._baseFoamSource.calcFoamStep(
          this,
          this.xz,
          this.dt,
          this.fadeRate,
          this.prewarm,
          this.state
        );
        this.$l.waveStrength = this.swFoamSource.x;
        this.$l.dir = pb.vec4(0);
        this.$l.spacing = pb.float(0);
        this.$l.coverage = pb.float(1);
        this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing, this.coverage);
        this.$l.wall = that.wall(this, this.xz);
        // Drift alone, stopping near the shore (see nearShore): the onshore-
        // only surge would continuously pump foam onto the beach, and the
        // swash would strip it (see below).
        this.$l.velocity = pb.mul(
          that.slip(this, this.wall, this.baseStep.xy),
          pb.sub(1, that.nearShore(this, this.xz).x)
        );
        this.$l.waveDt = this.$choice(
          this.prewarm,
          pb.max(this.dt, pb.div(pb.min(1, pb.sub(this.waveStrength, 1)), this.fadeRate)),
          this.dt
        );
        this.$l.foam = pb.mul(
          FOAM_WAVE_GAIN,
          this.waveDt,
          this.waveStrength,
          pb.clamp(pb.sub(this.swFoamSource.y, this.sw.z), 0, 1)
        );
        // Foam from shallow water, by the depth under the displaced surface, as
        // Crest makes it, scaled by the kinetic-energy potential of Ihmsen et al.
        // (eq. (8), I_k = Phi(E_k)) of the water's speed under the shore waves,
        // per unit mass between the wall foam's speeds: made while a crest surges
        // in or the swash runs, not where the water lies still or has drained.
        // Only where there is water (unlike Crest, which feeds dry land the swash
        // would later run over), only on the waterline field, and faded towards
        // its edge as the waves are
        this.$l.wl = pb.vec4(0);
        this.$l.gridFade = that.waterlineAt(this, this.xz, this.wl);
        this.$if(
          pb.and(pb.greaterThan(this.swWave.x, 0), pb.greaterThanEqual(this.gridFade, 0)),
          function () {
            this.$l.depth = pb.sub(this.sw.x, this.wl.z);
            this.$l.shoreDt = this.$choice(this.prewarm, pb.div(1, this.fadeRate), this.dt);
            this.shoreDt = pb.mul(this.shoreDt, this.gridFade);
            if (contact) {
              // Beach the swash reaches: a dry cell strands the foam the
              // drained sheet held. Farther inland, nothing comes to rest.
              this.$l.beach = pb.mul(
                pb.smoothStep(0, SWASH_EDGE_SOFT, pb.neg(this.wl.x)),
                pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y),
                this.gridFade,
                this.$choice(
                  pb.greaterThan(
                    this.wl.x,
                    pb.neg(
                      pb.add(pb.mul(this.swWave.x, pb.clamp(this.wl.y, 1, B_MAX), 1.5), SWASH_EDGE_EXTEND)
                    )
                  ),
                  pb.float(1),
                  pb.float(0)
                )
              );
              this.contact = pb.vec2(pb.mul(FOAM_STRAND_RATE, this.beach), 1);
            }
            this.$if(pb.greaterThan(this.depth, 0), function () {
              // The swash does not carry the field's foam: advected with the
              // ballistic sheet, it all piles up at the highest reach, which
              // drains and keeps it, while the backwash strips the beach below
              // and leaves a band apart from the water. Foam stays where the
              // waves made it and settles on the sand as the sheet thins.
              if (contact) {
                // The thinner the sheet, the faster its foam settles. Not
                // weighed by coverage, which reaches 0 just as the sheet is
                // thinnest; the sheet's front, thinning to nothing, strands
                // what it carries as the drained ground does.
                this.contact = pb.vec2(
                  pb.mul(
                    this.beach,
                    pb.mix(
                      FOAM_STRAND_RATE,
                      pb.mul(FOAM_DEPOSIT_RATE, pb.sub(1, pb.smoothStep(0, FOAM_DEPOSIT_DEPTH, this.depth))),
                      this.coverage
                    )
                  ),
                  pb.sub(1, this.coverage)
                );
              }
              this.$l.shoreEnergy = pb.mul(this.sw.w, this.sw.w, 0.5);
              this.$l.shoreEMin = pb.mul(this.swWallFoam.y, this.swWallFoam.y, 0.5);
              this.$l.shoreEMax = pb.mul(this.swWallFoam.z, this.swWallFoam.z, 0.5);
              this.$l.shoreKinetic = pb.div(
                pb.sub(pb.min(this.shoreEnergy, this.shoreEMax), pb.min(this.shoreEnergy, this.shoreEMin)),
                pb.max(pb.sub(this.shoreEMax, this.shoreEMin), 1e-6)
              );
              this.foam = pb.add(
                this.foam,
                pb.mul(
                  this.swFoamSource.z,
                  this.shoreDt,
                  this.shoreKinetic,
                  pb.clamp(pb.sub(1, pb.div(this.depth, this.swFoamSource.w)), 0, 1)
                )
              );
            });
          }
        );
        // Foam from the water dashing against a wall: the trapped-air potential
        // by the surface water's velocity (see FOAM_WALL).
        // Cells whose water the waves can carry to within the band of a wall
        this.$l.wallFoam = pb.float(0);
        this.$if(
          pb.and(
            pb.greaterThan(this.wall.w, 0),
            pb.lessThan(this.wall.z, FOAM_SLIP_BAND + WALL_DISPLACEMENT_REACH)
          ),
          function () {
            this.$l.restPos = pb.vec3(this.xz.x, this.swGrid.w, this.xz.y);
            this.$l.wavePos = pb.vec3(0);
            this.$l.waveNormal = pb.vec3(0, 1, 0);
            that._base.calcVertexPositionAndNormal(this, this.restPos, this.wavePos, this.waveNormal);
            this.$l.rise = pb.sub(this.wavePos.y, this.restPos.y);
            // The wall as seen from where the waves carry this water, as Crest takes
            // the shallow water foam's depth at the displaced position
            // (UpdateFoam.compute): the field is kept at undisplaced positions
            this.$l.wallAt = that.wall(this, pb.add(this.xz, pb.sub(this.wavePos.xz, this.restPos.xz)));
            this.$l.wallReach = pb.max(0, pb.sub(1, pb.div(this.wallAt.z, FOAM_SLIP_BAND)));
            this.$l.wallW = this.$choice(
              pb.greaterThan(this.wallAt.z, 0),
              pb.mul(this.wallAt.w, this.wallReach),
              pb.float(0)
            );
            this.$l.avgSpeed = this.state.y;
            this.$if(pb.greaterThan(this.state.w, 0), function () {
              // Averaged over WALL_SPEED_AVERAGE seconds: the instantaneous speed
              // varies per cell with ripples shorter than a cell
              this.avgSpeed = pb.mix(
                this.state.y,
                pb.abs(pb.div(pb.sub(this.rise, this.state.x), this.state.w)),
                pb.min(1, pb.div(this.state.w, WALL_SPEED_AVERAGE))
              );
              this.$l.speed = this.avgSpeed;
              // |v| W, the trapped-air potential averaged over a wave's orbit, with
              // W = 1 - d / h at the displaced position
              this.$l.vDiff = pb.mul(this.speed, this.wallReach);
              this.$l.tMin = this.swWallFoam.y;
              this.$l.tMax = this.swWallFoam.z;
              this.$l.trapped = pb.div(
                pb.sub(pb.min(this.vDiff, this.tMax), pb.min(this.vDiff, this.tMin)),
                pb.sub(this.tMax, this.tMin)
              );
              this.$l.energy = pb.mul(this.speed, this.speed, 0.5);
              this.$l.eMin = pb.mul(this.tMin, this.tMin, 0.5);
              this.$l.eMax = pb.mul(this.tMax, this.tMax, 0.5);
              this.$l.kinetic = pb.div(
                pb.sub(pb.min(this.energy, this.eMax), pb.min(this.energy, this.eMin)),
                pb.max(pb.sub(this.eMax, this.eMin), 1e-6)
              );
              this.$if(pb.greaterThan(this.wallW, 0), function () {
                this.wallFoam = pb.mul(FOAM_WAVE_GAIN, this.kinetic, this.trapped, this.wallAt.w, this.dt);
              });
            });
            this.state = pb.vec4(this.rise, this.avgSpeed, 0, this.state.w);
          }
        );
        this.$return(
          pb.vec4(this.velocity, pb.add(this.baseStep.z, this.foam), pb.add(this.baseStep.w, this.wallFoam))
        );
      }
    );
    return (
      contact
        ? scope[funcName](xz, dt, fadeRate, prewarm, state, contact)
        : scope[funcName](xz, dt, fadeRate, prewarm, state)
    ) as PBShaderExp;
  }
  /**
   * Restricts projected, deposited foam to the beach bed. The mesh above it
   * only carries the draw; a scene point supplies the actual ground position.
   */
  calcFoamGroundMask(scope: PBInsideFunctionScope, worldPos: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swFoamGroundMask', [pb.vec3('position')], function () {
      this.$l.wl = pb.vec4(0);
      this.$l.gridFade = that.waterlineAt(this, this.position.xz, this.wl);
      this.$if(pb.or(pb.lessThanEqual(this.swWave.x, 0), pb.lessThan(this.gridFade, 0)), function () {
        this.$return(pb.float(0));
      });
      this.$l.bed = pb.add(this.swGrid.w, this.wl.z);
      this.$l.reach = pb.mul(this.swWave.x, pb.clamp(this.wl.y, 1, B_MAX));
      // This is a bed-support mask, shared by thin mobile and deposited foam.
      // Do not cut at the static waterline: a raised, dry carrier can project
      // to wet ground just seaward of it, leaving neither layer visible there.
      // Sheet thickness controls the handover; deposition itself stays onshore.
      this.$return(
        pb.mul(
          pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y),
          this.gridFade,
          pb.sub(1, pb.smoothStep(0.08, 0.2, pb.abs(pb.sub(this.position.y, this.bed)))),
          this.$choice(
            pb.and(
              pb.lessThan(this.wl.z, pb.add(this.swWave.x, SWASH_LIFT_MARGIN)),
              pb.greaterThan(this.wl.x, pb.neg(pb.add(pb.mul(this.reach, 1.5), SWASH_EDGE_EXTEND)))
            ),
            pb.float(1),
            pb.float(0)
          )
        )
      );
    });
    return scope.swFoamGroundMask(worldPos) as PBShaderExp;
  }
  /**
   * The velocity the foam texture slides with at an undisplaced XZ in the
   * water's shaders: the drift it is given, led along the walls.
   */
  calcFoamFlow(scope: PBInsideFunctionScope, xz: PBShaderExp, drift: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swFoamFlow', [pb.vec2('xz'), pb.vec2('drift')], function () {
      // The drift only, not the waves' water: flow mapping (Vlachos, "Water Flow
      // in Portal 2", SIGGRAPH 2010) needs a smooth, slowly varying flow, as
      // Crest's currents are, and the surge and swash jump at the waterline and
      // shear along the beach. The field still carries the foam with the waves.
      // Standing still near the shore, as the field's foam does there, so
      // the water's foam pattern and the beach's are one.
      this.$return(
        pb.mul(
          that.slip(this, that.wall(this, this.xz), this.drift),
          pb.sub(1, that.nearShore(this, this.xz).x)
        )
      );
    });
    return scope.swFoamFlow(xz, drift) as PBShaderExp;
  }
  /**
   * The wall at an undisplaced XZ, from the wall field: (normal out of the
   * land x, z, distance to the waterline, how much of a wall the waterline
   * is, 0 on a beach the surf rolls up and off the field). The normal is only
   * worked out within FOAM_SLIP_BAND of a wall, else 0.
   * @internal
   */
  private wall(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('swWall', [pb.vec2('xz')], function () {
      this.$l.uv = pb.mul(pb.sub(this.xz, this.swGrid.xy), this.swGrid.z);
      this.$if(
        pb.or(
          pb.lessThanEqual(this.swGrid.z, 0),
          pb.or(pb.any(pb.lessThan(this.uv, pb.vec2(0))), pb.any(pb.greaterThan(this.uv, pb.vec2(1))))
        ),
        function () {
          this.$return(pb.vec4(0, 0, 1e4, 0));
        }
      );
      this.$l.wl = pb.textureArraySampleLevel(this.swWallField, this.uv, 0, 0);
      this.$l.edge = pb.min(pb.min(this.uv.x, this.uv.y), pb.min(pb.sub(1, this.uv.x), pb.sub(1, this.uv.y)));
      // The complement of the shelving the surf rolls in on, faded out towards
      // the edge of the field
      this.$l.steep = pb.mul(
        pb.sub(1, pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y)),
        pb.smoothStep(0, GRID_EDGE_FADE, this.edge)
      );
      this.$if(
        pb.or(pb.lessThanEqual(this.steep, 0), pb.greaterThanEqual(this.wl.x, FOAM_SLIP_BAND)),
        function () {
          this.$return(pb.vec4(0, 0, this.wl.x, this.steep));
        }
      );
      // Out of the land: up the gradient of the distance to the waterline, a metre either side
      this.$l.c = this.swGrid.z;
      this.$l.g = pb.vec2(
        pb.sub(
          pb.textureArraySampleLevel(this.swWallField, pb.add(this.uv, pb.vec2(this.c, 0)), 0, 0).x,
          pb.textureArraySampleLevel(this.swWallField, pb.sub(this.uv, pb.vec2(this.c, 0)), 0, 0).x
        ),
        pb.sub(
          pb.textureArraySampleLevel(this.swWallField, pb.add(this.uv, pb.vec2(0, this.c)), 0, 0).x,
          pb.textureArraySampleLevel(this.swWallField, pb.sub(this.uv, pb.vec2(0, this.c)), 0, 0).x
        )
      );
      this.$return(pb.vec4(pb.div(this.g, pb.max(pb.length(this.g), 1e-5)), this.wl.x, this.steep));
    });
    return scope.swWall(xz) as PBShaderExp;
  }
  /**
   * The shore field at an undisplaced XZ: its shore coordinates (see
   * WaterlineField.smoothTexture) into `wl`, and returned, the weight the
   * shore effects fade by towards the edge of the field, or -1 off it or with
   * no field. The finest level that holds the point and can vouch for its
   * distance answers (see SHORE_LEVELS_MAX), blended into the next coarser
   * over the last GRID_EDGE_FADE of it; only the coarsest fades out. The
   * levels' shares go to `weights`, for {@link shoreGradient}.
   * @internal
   */
  private waterlineAt(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    wl: PBShaderExp,
    weights?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func('swWaterlineAt', [pb.vec2('xz'), pb.vec4('wl').out(), pb.vec4('weights').out()], function () {
      this.wl = pb.vec4(0);
      this.weights = pb.vec4(0);
      // Share of the answer still to come from coarser levels
      this.$l.remaining = pb.float(1);
      this.$l.last = pb.sub(this.swShoreInfo.x, 1);
      for (let i = 0; i < SHORE_LEVELS_MAX; i++) {
        const r = this[`swShore${i}`];
        this.$l[`uv${i}`] = pb.mul(pb.sub(this.xz, r.xy), r.z);
        const uv = this[`uv${i}`];
        this.$l[`edge${i}`] = pb.min(pb.min(uv.x, uv.y), pb.min(pb.sub(1, uv.x), pb.sub(1, uv.y)));
        const edge = this[`edge${i}`];
        this.$if(
          pb.and(pb.greaterThan(this.remaining, 0), pb.and(pb.greaterThan(r.z, 0), pb.greaterThan(edge, 0))),
          function () {
            this.$l.t = pb.textureArraySampleLevel(this.swWaterline, uv, i, 0);
            // Distance over the way to the edge, both in metres; the coarsest
            // level present vouches for everything
            this.$l.trust = this.$choice(
              pb.lessThan(pb.float(i), this.last),
              pb.sub(1, pb.smoothStep(SHORE_TRUST_START, 1, pb.div(pb.mul(pb.abs(this.t.x), r.z), edge))),
              pb.float(1)
            );
            this.$l.w = pb.mul(this.remaining, pb.smoothStep(0, GRID_EDGE_FADE, edge), this.trust);
            this.wl = pb.add(this.wl, pb.mul(this.t, this.w));
            this.weights[COMPONENTS[i]] = this.w;
            this.remaining = pb.sub(this.remaining, this.w);
          }
        );
      }
      this.$l.sum = pb.sub(1, this.remaining);
      this.$if(pb.lessThanEqual(this.sum, 0), function () {
        this.$return(pb.float(-1));
      });
      this.wl = pb.div(this.wl, this.sum);
      this.$return(this.sum);
    });
    if (!weights) {
      const name = `swLevelWeights${weightLocals++}`;
      scope.$l[name] = pb.vec4(0);
      weights = scope[name] as PBShaderExp;
    }
    return scope.swWaterlineAt(xz, wl, weights) as PBShaderExp;
  }
  /**
   * Gradient of the distance to the waterline at an undisplaced XZ, per metre,
   * from the levels by the shares {@link waterlineAt} gave them: each level's
   * difference a metre or a cell, whichever is more, either side.
   * @internal
   */
  private shoreGradient(scope: PBInsideFunctionScope, xz: PBShaderExp, weights: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('swShoreGradient', [pb.vec2('xz'), pb.vec4('weights')], function () {
      this.$l.g = pb.vec2(0);
      for (let i = 0; i < SHORE_LEVELS_MAX; i++) {
        const w = this.weights[COMPONENTS[i]];
        this.$if(pb.greaterThan(w, 0), function () {
          const r = this[`swShore${i}`];
          this.$l[`guv${i}`] = pb.mul(pb.sub(this.xz, r.xy), r.z);
          this.$l[`step${i}`] = pb.max(r.w, 1);
          this.$l[`c${i}`] = pb.mul(this[`step${i}`], r.z);
          const uv = this[`guv${i}`];
          const c = this[`c${i}`];
          this.$l[`d${i}`] = pb.vec2(
            pb.sub(
              pb.textureArraySampleLevel(this.swWaterline, pb.add(uv, pb.vec2(c, 0)), i, 0).x,
              pb.textureArraySampleLevel(this.swWaterline, pb.sub(uv, pb.vec2(c, 0)), i, 0).x
            ),
            pb.sub(
              pb.textureArraySampleLevel(this.swWaterline, pb.add(uv, pb.vec2(0, c)), i, 0).x,
              pb.textureArraySampleLevel(this.swWaterline, pb.sub(uv, pb.vec2(0, c)), i, 0).x
            )
          );
          this.g = pb.add(this.g, pb.mul(this[`d${i}`], pb.div(w, pb.mul(this[`step${i}`], 2))));
        });
      }
      this.$return(this.g);
    });
    return scope.swShoreGradient(xz, weights) as PBShaderExp;
  }
  /**
   * A velocity near a waterline too steep for surf, given the wall there (see
   * {@link wall}), handed over to the wall foam's drift out along the wall's
   * normal. See FOAM_SLIP_BAND.
   * @internal
   */
  private slip(scope: PBInsideFunctionScope, wall: PBShaderExp, v: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('swFoamSlip', [pb.vec4('wall'), pb.vec2('v')], function () {
      this.$l.weight = pb.mul(this.wall.w, pb.sub(1, pb.smoothStep(0, FOAM_SLIP_BAND, this.wall.z)));
      this.$return(pb.mix(this.v, pb.mul(this.wall.xy, this.swVary.y), this.weight));
    });
    return scope.swFoamSlip(wall, v) as PBShaderExp;
  }
  clone() {
    return new ShoreWaveGenerator(this._base.clone(), { ...this._settings }, this._baseFoamSource) as this;
  }
  get version() {
    return this._base.version + this._version;
  }
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    this._base.setupUniforms(scope, uniformGroup);
    this.setupShoreUniforms(scope, uniformGroup);
  }
  /** The uniforms {@link ShoreWaveGenerator.evaluate} reads. @internal */
  private setupShoreUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    // The shore field's levels, and the wall field's, see setFrame
    scope.swWaterline = pb.tex2DArray().uniform(uniformGroup);
    scope.swWallField = pb.tex2DArray().uniform(uniformGroup);
    scope.swInverse = pb.tex2D().uniform(uniformGroup);
    for (let i = 0; i < SHORE_LEVELS_MAX; i++) {
      // (origin x, origin z, 1 / size, cell size); 0 size for no level
      scope[`swShore${i}`] = pb.vec4().uniform(uniformGroup);
    }
    // (shore levels, 0, 0, 0)
    scope.swShoreInfo = pb.vec4().uniform(uniformGroup);
    // The wall field: (origin x, origin z, 1 / size, rest level)
    scope.swGrid = pb.vec4().uniform(uniformGroup);
    scope.swWave = pb.vec4().uniform(uniformGroup);
    scope.swShape = pb.vec4().uniform(uniformGroup);
    // (irregularity: wave cycles J spans, wall foam drift speed, 0, 0)
    scope.swVary = pb.vec4().uniform(uniformGroup);
  }
  /** @internal */
  private applyShoreBindGroup(bindGroup: BindGroup) {
    bindGroup.setTexture('swWaterline', this._shore ?? this.getDummy(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('swWallField', this._wall ?? this.getDummy(), fetchSampler('clamp_linear_nomip'));
    for (let i = 0; i < SHORE_LEVELS_MAX; i++) {
      bindGroup.setValue(`swShore${i}`, this._shoreLevels[i]);
    }
    bindGroup.setValue('swShoreInfo', this._shoreInfo);
    bindGroup.setTexture('swInverse', getInverseTexture(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('swGrid', this._grid);
    bindGroup.setValue('swWave', this._wave);
    bindGroup.setValue('swShape', this._shape);
    bindGroup.setValue('swVary', this._vary);
  }
  /**
   * Shore wave at an undisplaced world XZ, at a wave clock (time over period):
   * (height over the rest level, slope of the height along the distance to
   * the shore, determinant of the Jacobian of the displacement, speed of the
   * water carrying the foam towards the shore in metres per second, negative
   * in the backwash).
   * Out parameters: `dir` (direction to the shore xy, weight of the wrapped
   * generator's chop dying near the shore z, bed height the surface is held
   * over w, far below the water where it is not), `spacing`, the distance
   * between crests here, and `coverage`, the water's share of the surface.
   * `cell` is the distance between mesh vertices to
   * band-limit to, 0 for the full profile.
   * @internal
   */
  private evaluate(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dir: PBShaderExp,
    spacing: PBShaderExp,
    coverage: PBShaderExp,
    tPhase?: PBShaderExp,
    cell?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'swEvaluate',
      [
        pb.vec2('xz'),
        pb.vec4('dir').out(),
        pb.float('spacing').out(),
        pb.float('coverage').out(),
        pb.float('tPhase'),
        pb.float('cell')
      ],
      function () {
        // No bed to hold the surface over, unless the shore says otherwise
        this.dir = pb.vec4(0, 0, 0, -1e4);
        this.spacing = pb.float(1);
        this.coverage = pb.float(1);
        // Shore coordinates: (signed distance to the waterline, negative inland;
        // bed B; bed height over the rest level)
        this.$l.wl = pb.vec4(0);
        this.$l.levelWeights = pb.vec4(0);
        this.$l.gridFade = that.waterlineAt(this, this.xz, this.wl, this.levelWeights);
        this.$if(pb.or(pb.lessThanEqual(this.swWave.x, 0), pb.lessThan(this.gridFade, 0)), function () {
          this.$return(pb.vec4(0, 0, 1, 0));
        });
        this.$l.d = this.wl.x;
        this.$l.zone = this.swWave.y;
        this.$if(pb.greaterThan(this.d, this.zone), function () {
          this.$return(pb.vec4(0, 0, 1, 0));
        });
        // Direction to the shore: down the gradient of the distance
        this.$l.g = that.shoreGradient(this, this.xz, this.levelWeights);
        this.dir = pb.vec4(pb.neg(pb.div(this.g, pb.max(pb.length(this.g), 1e-5))), 0, 0);
        // Phase: the integral of 1 / wavelength, with the wavelength shrinking as
        // sqrt of the depth. Below `dMin` (past breaking) it runs on linearly;
        // inland it is frozen at its shoreline value.
        this.$l.dc = pb.max(this.d, 0);
        this.$l.dMin = pb.mul(this.zone, MIN_COMPRESSION);
        this.$l.rootMin = pb.sqrt(MIN_COMPRESSION);
        this.$l.rootTerm = this.$choice(
          pb.greaterThan(this.dc, this.dMin),
          pb.sqrt(pb.div(this.dc, this.zone)),
          pb.add(this.rootMin, pb.div(pb.sub(this.dc, this.dMin), pb.mul(2, this.rootMin, this.zone)))
        );
        // Distance between crests here, 1 / the phase's rate of change along the way in
        this.spacing = pb.div(
          pb.mul(2, pb.sqrt(pb.mul(pb.max(this.dc, this.dMin), this.zone))),
          pb.max(this.swWave.z, 1e-4)
        );
        // Where this point's way in meets the waterline: noise there varies along
        // the shore only
        this.$l.foot = pb.add(this.xz, pb.mul(this.dir.xy, this.d));
        // Inland every noise is taken at the foot, so the swash keeps one clock
        // and one height all the way up the beach
        this.$l.noisePos = this.$choice(pb.greaterThan(this.d, 0), this.xz, this.foot);
        // The crests' clock, in waves, and the irregular phase it reads as:
        // s + J(s, foot), see IRREGULAR_RATE
        this.$l.s = pb.add(this.tPhase, pb.mul(this.swWave.z, this.rootTerm));
        this.$l.shoreUV = pb.mul(this.foot, IRREGULAR_SHORE_SCALE);
        this.$l.j0 = valueNoise(this, pb.add(this.shoreUV, pb.vec2(pb.mul(this.s, IRREGULAR_RATE), 0)));
        this.$l.j1 = valueNoise(
          this,
          pb.add(this.shoreUV, pb.vec2(pb.mul(pb.add(this.s, IRREGULAR_STEP), IRREGULAR_RATE), 0))
        );
        this.$l.phase = pb.add(this.s, pb.mul(this.swVary.x, pb.sub(this.j0, 0.5)));
        // dPsi/ds: a wave of a longer period here is that much farther apart
        this.$l.rate = pb.max(
          pb.add(1, pb.div(pb.mul(this.swVary.x, pb.sub(this.j1, this.j0)), IRREGULAR_STEP)),
          0.1
        );
        // The crests travel at the speed of the water depth whatever their
        // period: set before the spacing takes the period in
        this.$l.crestSpeed = pb.max(pb.div(this.spacing, this.swShape.w), 0.1);
        this.spacing = pb.div(this.spacing, this.rate);
        // Distance along the wave from a crest, seaward: 0 at the crest, its front
        // (shoreward) face just below 1
        this.$l.X = pb.fract(this.phase);
        // Shoaling, 0 at the outer edge of the zone, 1 at the waterline and inland
        this.$l.shoal = pb.sub(1, pb.div(this.dc, this.zone));
        // Mesh vertices per crest spacing, where a mesh is being displaced
        this.$l.sharpLod = pb.float(1);
        this.$l.ampLod = pb.float(1);
        this.$if(pb.greaterThan(this.cell, 0), function () {
          this.$l.samples = pb.div(this.spacing, this.cell);
          this.sharpLod = pb.smoothStep(SHARP_SAMPLES_MIN, SHARP_SAMPLES_FULL, this.samples);
          this.ampLod = pb.smoothStep(AMP_SAMPLES_MIN, AMP_SAMPLES_FULL, this.samples);
        });
        // The profile: X = (g / 2pi)^r with g = x - b sin x, Y = (cos x + 1) / 2.
        // Sharper (b) and leaning further shoreward (r below 1) as it shoals.
        this.$l.b = pb.mul(this.swShape.x, pb.smoothStep(0, 0.8, this.shoal), this.sharpLod);
        this.$l.r = pb.div(
          1,
          pb.add(1, pb.mul(this.swShape.y, 2, pb.smoothStep(0.2, 1, this.shoal), this.sharpLod))
        );
        this.$l.gu = pb.pow(pb.max(this.X, 1e-5), pb.div(1, this.r));
        this.$l.xu = pb.textureSampleLevel(
          this.swInverse,
          pb.vec2(
            pb.add(pb.mul(this.gu, (INVERSE_SAMPLES - 1) / INVERSE_SAMPLES), 0.5 / INVERSE_SAMPLES),
            pb.add(
              pb.mul(pb.div(this.b, SHARPNESS_MAX), (INVERSE_SHARPNESS - 1) / INVERSE_SHARPNESS),
              0.5 / INVERSE_SHARPNESS
            )
          ),
          0
        ).r;
        this.$l.x = pb.mul(this.xu, Math.PI * 2);
        this.$l.cx = pb.cos(this.x);
        this.$l.profile = pb.mul(pb.add(this.cx, 1), 0.5);
        // dY/dX = (dY/dx) / (dX/dx), dX/dx = r (g / 2pi)^(r - 1) (1 - b cos x) / 2pi
        this.$l.dXdx = pb.div(
          pb.mul(
            this.r,
            pb.pow(pb.max(this.gu, 1e-4), pb.sub(this.r, 1)),
            pb.max(pb.sub(1, pb.mul(this.b, this.cx)), 1e-3)
          ),
          Math.PI * 2
        );
        this.$l.dYdX = pb.div(pb.mul(pb.sin(this.x), -0.5), pb.max(this.dXdx, 1e-3));
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
                valueNoise(
                  this,
                  pb.add(pb.mul(this.noisePos, SET_SCALE), pb.vec2(pb.mul(this.tPhase, SET_DRIFT), 0))
                )
              )
            )
          )
        );
        // Segments of a wave, picked by its count: each rises and falls along the
        // shore by its own noise
        const segment = (scope: PBInsideFunctionScope, index: PBShaderExp) => {
          const seed = pb.mul(pb.vec2(hash11(scope, index), hash11(scope, pb.add(index, 17.31))), 97);
          return pb.sub(
            1,
            pb.mul(
              SEGMENT_DEPTH,
              pb.sub(
                1,
                pb.smoothStep(0.2, 0.6, valueNoise(scope, pb.add(pb.mul(this.foot, SEGMENT_SCALE), seed)))
              )
            )
          );
        };
        // The swash belongs to the crest that threw it, counted from its arrival
        // at the waterline, for the whole of its run up and back
        this.$l.swashSet = pb.mul(this.waveSet, segment(this, pb.floor(this.phase)));
        // Elsewhere counted from trough to trough, where the height and its slope
        // are 0, so switching to the next wave's noise shows no seam
        this.$l.crestSegment = segment(this, pb.floor(pb.add(this.phase, 0.5)));
        this.waveSet = pb.mul(this.waveSet, this.crestSegment);
        // Only where the bed shelves (surf rolls in on a beach, not against a
        // cliff, pier or hull), faded out towards the edge of the grid
        this.$l.shelving = pb.mul(pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y), this.gridFade);
        // Rising out of the sea over the outer part of the zone
        this.$l.amp = pb.mul(
          this.swWave.x,
          this.waveSet,
          this.shelving,
          pb.smoothStep(0, 0.4, this.shoal),
          this.ampLod
        );
        this.$l.height = pb.mul(this.profile, this.amp);
        // Keep the whole soft edge on the wet side of the bed intersection.
        this.$l.edgeSoft = pb.div(SWASH_EDGE_SOFT, pb.clamp(this.wl.y, 1, B_MAX));
        this.coverage = pb.smoothStep(0, this.edgeSoft, pb.sub(this.height, this.wl.z));
        // Slope along the distance to the shore: X runs seaward at 1 / spacing,
        // and stands still inland where the phase is frozen
        this.$l.slope = this.$choice(
          pb.greaterThan(this.d, 0),
          pb.div(pb.mul(this.dYdX, this.amp), this.spacing),
          pb.float(0)
        );
        // Determinant of the Jacobian of the horizontal displacement the profile
        // stands for (dX/dx 2pi), below 1 where the water is squeezed at the crest's
        // front; scaled by the wave's share of the full height.
        this.$l.det = pb.add(
          1,
          pb.mul(pb.div(this.amp, pb.max(this.swWave.x, 1e-4)), pb.sub(pb.mul(this.dXdx, Math.PI * 2), 1))
        );
        // The wrapped generator's chop dies near the shore
        this.dir.z = pb.mul(pb.sub(1, pb.smoothStep(0, CHOP_FADE, this.d)), this.shelving);
        // The water rises straight up and is wet wherever it stands over the bed.
        // Near that edge the mesh is held clear of the bed and cut per pixel, only
        // where the water could reach (not on dunes higher than the highest water)
        // A conservative, time-independent support region: a weaker next
        // crest must not drop the mesh under a swash that is still draining.
        // Actual water is bounded by coverage, independently of this mesh.
        this.$l.highest = this.swWave.x;
        this.$l.reach = pb.mul(this.highest, pb.clamp(this.wl.y, 1, B_MAX));
        this.dir.w = this.$choice(
          pb.and(
            pb.and(
              pb.greaterThan(this.shelving, 0),
              pb.lessThan(this.wl.z, pb.add(this.highest, SWASH_LIFT_MARGIN))
            ),
            pb.greaterThan(this.d, pb.neg(pb.add(pb.mul(this.reach, 1.5), SWASH_EDGE_EXTEND)))
          ),
          this.wl.z,
          pb.float(-1e4)
        );
        // Speed of the water carrying the foam along the way in. In place of Crest's
        // flow simulation, the velocity under a long wave, u = g eta / c with c the
        // crest speed, towards the shore.
        this.$l.flow = pb.clamp(
          pb.div(pb.mul(SWASH_GRAVITY, this.height), this.crestSpeed),
          0,
          this.crestSpeed
        );
        // Inland: the swash, in wave periods since its crest reached the waterline
        // (X, the phase there being frozen at its waterline value)
        this.$if(pb.lessThan(this.d, 0), function () {
          this.$l.s = pb.neg(this.d);
          this.$l.bedB = pb.clamp(this.wl.y, 1, B_MAX);
          this.$l.runUp = pb.mul(this.swWave.x, this.swashSet, this.shelving);
          this.$l.runUpH = pb.max(pb.mul(this.runUp, this.bedB), 1e-3);
          // Up and back in 2 u0 / (g tan(beta)) = 2 B sqrt(2 height / g) seconds
          this.$l.duration = pb.clamp(
            pb.div(
              pb.mul(2, this.bedB, pb.sqrt(pb.div(pb.mul(2, this.runUp), SWASH_GRAVITY))),
              this.swShape.w
            ),
            1e-3,
            SWASH_DURATION_MAX
          );
          this.$l.tt = pb.div(this.X, this.duration);
          this.$l.front = this.$choice(
            pb.lessThan(this.tt, 1),
            pb.mul(4, this.runUpH, this.tt, pb.sub(1, this.tt)),
            pb.float(0)
          );
          // h = (s_f - s)^2 / (36 g' t^2) with g' tan(beta) = 8 runUpH / duration^2
          this.$l.behind = pb.sub(this.front, this.s);
          this.$l.depth = pb.div(
            pb.mul(this.behind, this.behind),
            pb.mul(288, this.runUpH, this.bedB, pb.max(pb.mul(this.tt, this.tt), 1e-6))
          );
          this.$l.swash = this.$choice(
            pb.greaterThan(this.behind, 0),
            pb.add(this.wl.z, this.depth),
            pb.sub(this.wl.z, 1)
          );
          // Its water's velocity, u = ds_f/dt + (2/3)(s - s_f) / t, in metres per
          // second: t is tt durations of periods
          this.$l.seconds = pb.mul(this.duration, this.swShape.w);
          this.flow = this.$choice(
            pb.and(pb.greaterThan(this.behind, 0), pb.lessThan(this.tt, 1)),
            pb.div(
              pb.sub(
                pb.mul(4, this.runUpH, pb.sub(1, pb.mul(2, this.tt))),
                pb.div(pb.mul(this.behind, 2 / 3), pb.max(this.tt, 1e-3))
              ),
              this.seconds
            ),
            pb.float(0)
          );
          // The crest collapsing at the waterline
          this.$l.collapse = pb.mul(this.height, pb.exp(pb.div(pb.neg(this.s), SWASH_COLLAPSE)));
          // The sheet becomes quadratically thin at its front: fading by depth
          // leaves half coverage just inside it, then cuts to zero outside.
          // Fade over the last centimetres behind the front instead, keeping
          // the collapsing crest's own wet region where it reaches farther.
          this.$l.swashCoverage = this.$choice(
            pb.and(
              pb.greaterThan(this.runUp, 0),
              pb.and(pb.greaterThan(this.tt, 0), pb.lessThan(this.tt, 1))
            ),
            pb.smoothStep(0, SWASH_EDGE_SOFT, this.behind),
            pb.float(0)
          );
          this.coverage = pb.max(
            this.swashCoverage,
            pb.smoothStep(0, this.edgeSoft, pb.sub(this.collapse, this.wl.z))
          );
          this.height = pb.max(this.swash, this.collapse);
          // The swash runs up as a sheet, not squeezed
          this.det = pb.float(1);
        });
        this.$return(pb.vec4(this.height, this.slope, this.det, this.flow));
      }
    );
    return scope.swEvaluate(
      xz,
      dir,
      spacing,
      coverage,
      tPhase ?? scope.swWave.w,
      cell ?? pb.float(0)
    ) as PBShaderExp;
  }
  /**
   * Adds the shore wave to a position the wrapped generator displaced, straight
   * up, at a wave clock (time over period). Near the shore the wrapped
   * generator's chop dies and the surface is held clear of the bed.
   * @internal
   */
  private displace(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    basePos: PBShaderExp,
    tPhase: PBShaderExp,
    cell: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'swDisplace',
      [pb.vec3('inPos'), pb.vec3('basePos'), pb.float('tPhase'), pb.float('cell')],
      function () {
        this.$l.dir = pb.vec4(0);
        this.$l.spacing = pb.float(0);
        this.$l.coverage = pb.float(1);
        // At the undisplaced position, where the fragment stage evaluates it too
        this.$l.sw = that.evaluate(
          this,
          this.inPos.xz,
          this.dir,
          this.spacing,
          this.coverage,
          this.tPhase,
          this.cell
        );
        this.$l.out = pb.mix(this.basePos, this.inPos, this.dir.z);
        this.out.y = pb.max(
          pb.add(this.out.y, this.sw.x),
          pb.add(this.swGrid.w, this.dir.w, SWASH_CLEARANCE)
        );
        this.$return(this.out);
      }
    );
    return scope.swDisplace(inPos, basePos, tPhase, cell) as PBShaderExp;
  }
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'swCalcPositionAndNormal',
      [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out(), pb.float('cell')],
      function () {
        that._base.calcVertexPositionAndNormal(this, this.inPos, this.outPos, this.outNormal);
        this.outPos = that.displace(this, this.inPos, this.outPos, this.swWave.w, this.cell);
      }
    );
    scope.swCalcPositionAndNormal(inPos, outPos, outNormal, vertexSpacing ?? pb.float(0));
  }
  /**
   * Where a vertex was in the previous frame, for motion vectors: the shore wave
   * at the previous frame's clock. The wrapped generator is taken as it is now.
   */
  calcPrevVertexPosition(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func('swCalcPrevPosition', [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.float('cell')], function () {
      this.$l.n = pb.vec3(0, 1, 0);
      that._base.calcVertexPositionAndNormal(this, this.inPos, this.outPos, this.n);
      this.outPos = that.displace(this, this.inPos, this.outPos, this.swShape.z, this.cell);
    });
    scope.swCalcPrevPosition(inPos, outPos, vertexSpacing ?? pb.float(0));
  }
  /**
   * Depth of the water over the bed of the waterline field, stable under the
   * camera jitter. -1 where there is no bed to measure from, off the grid or
   * away from the beach.
   */
  calcSheetThickness(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swSheetThickness', [pb.vec2('xz')], function () {
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.coverage = pb.float(1);
      this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing, this.coverage);
      this.$if(pb.lessThan(this.dir.w, -1e3), function () {
        this.$return(pb.float(-1));
      });
      this.$return(pb.max(pb.sub(this.sw.x, this.dir.w), 0));
    });
    return scope.swSheetThickness(xz) as PBShaderExp;
  }
  /**
   * The near-shore zone at an undisplaced XZ, as vec2(weight, foam density):
   * weight 1 where the still water is shallower than the breaking depth and
   * on the beach, 0 in the open water, off a beach or off the field; the
   * density the foam is at least shown with there. Both depend only on the
   * still-water depth, which is continuous from the open water across the
   * waterline (0 inland) and does not pulse as the crests pass. Not a
   * simulation: it makes the breaking waves' foam and the beach's one sheet.
   */
  nearShore(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swNearShore', [pb.vec2('xz')], function () {
      this.$l.wl = pb.vec4(0);
      this.$l.gridFade = that.waterlineAt(this, this.xz, this.wl);
      this.$if(pb.or(pb.lessThanEqual(this.swWave.x, 0), pb.lessThan(this.gridFade, 0)), function () {
        this.$return(pb.vec2(0));
      });
      // Still-water depth: the bed below the rest level, 0 inland
      this.$l.h = pb.max(pb.neg(this.wl.z), 0);
      this.$l.hn = pb.div(this.swWave.x, NEAR_SHORE_BREAKER);
      this.$l.weight = pb.mul(
        pb.sub(1, pb.smoothStep(this.hn, pb.mul(this.hn, 1 + NEAR_SHORE_BLEND), this.h)),
        pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y),
        this.gridFade
      );
      this.$return(
        pb.vec2(
          this.weight,
          pb.mix(NEAR_SHORE_FOAM_SHORE, NEAR_SHORE_FOAM_EDGE, pb.smoothStep(0, this.hn, this.h))
        )
      );
    });
    return scope.swNearShore(xz) as PBShaderExp;
  }
  /**
   * Foam density shown at an undisplaced XZ from the field's: in the
   * near-shore zone at least its density, blended in over the zone's edge.
   */
  calcNearShoreFoam(scope: PBInsideFunctionScope, xz: PBShaderExp, density: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swNearShoreFoam', [pb.vec2('xz'), pb.float('density')], function () {
      this.$l.ns = that.nearShore(this, this.xz);
      this.$return(pb.mix(this.density, pb.max(this.density, this.ns.y), this.ns.x));
    });
    return scope.swNearShoreFoam(xz, density) as PBShaderExp;
  }
  /**
   * The water's edge on the beach, per pixel: 1 where the water stands over the
   * bed, 0 where the mesh is only held clear of the sand or, past where it is
   * held, runs down into it.
   */
  calcSurfaceCoverage(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swSurfaceCoverage', [pb.vec2('xz')], function () {
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.coverage = pb.float(1);
      that.evaluate(this, this.xz, this.dir, this.spacing, this.coverage);
      this.$return(this.coverage);
    });
    return scope.swSurfaceCoverage(xz) as PBShaderExp;
  }
  /**
   * Debug classification on the same undisplaced coordinates as the mesh:
   * (shore envelope weight, inland flag, current wet coverage). The envelope
   * excludes the moving crest profile and wave-set strength, so its boundary
   * remains legible throughout a wave cycle. This is one displaced mesh.
   * @internal
   */
  calcDebugRegion(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swDebugRegion', [pb.vec2('xz')], function () {
      this.$l.wl = pb.vec4(0);
      this.$l.gridFade = that.waterlineAt(this, this.xz, this.wl);
      this.$if(pb.or(pb.lessThanEqual(this.swWave.x, 0), pb.lessThan(this.gridFade, 0)), function () {
        this.$return(pb.vec3(0, 0, 1));
      });
      // Match evaluate's shelving, grid-edge and outer-zone amplitude fades;
      // dir.z alone only measures the much narrower chop-suppression band.
      this.$l.weight = pb.mul(
        pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y),
        this.gridFade,
        pb.smoothStep(0, 0.4, pb.sub(1, pb.div(pb.max(this.wl.x, 0), this.swWave.y)))
      );
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.coverage = pb.float(1);
      that.evaluate(this, this.xz, this.dir, this.spacing, this.coverage);
      this.$return(
        pb.vec3(this.weight, this.$choice(pb.lessThan(this.wl.x, 0), pb.float(1), pb.float(0)), this.coverage)
      );
    });
    return scope.swDebugRegion(xz) as PBShaderExp;
  }
  /**
   * Debug colour of the shore field's levels at an undisplaced XZ: red, green,
   * blue and yellow from the finest by their shares, times the fade out of
   * the coarsest, banded every 2 metres of the distance to the waterline.
   * @internal
   */
  calcDebugLevels(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swDebugLevels', [pb.vec2('xz')], function () {
      this.$l.wl = pb.vec4(0);
      this.$l.levelWeights = pb.vec4(0);
      this.$l.gridFade = that.waterlineAt(this, this.xz, this.wl, this.levelWeights);
      this.$if(pb.lessThan(this.gridFade, 0), function () {
        this.$return(pb.vec3(0.1));
      });
      this.$l.c = pb.div(
        pb.add(
          pb.add(
            pb.mul(pb.vec3(1, 0.1, 0.1), this.levelWeights.x),
            pb.mul(pb.vec3(0.1, 1, 0.1), this.levelWeights.y)
          ),
          pb.add(
            pb.mul(pb.vec3(0.15, 0.3, 1), this.levelWeights.z),
            pb.mul(pb.vec3(1, 0.9, 0.1), this.levelWeights.w)
          )
        ),
        this.gridFade
      );
      this.$l.band = pb.step(0.5, pb.fract(pb.mul(this.wl.x, 0.5)));
      this.$return(pb.mul(this.c, this.gridFade, pb.mix(0.55, 1, this.band)));
    });
    return scope.swDebugLevels(xz) as PBShaderExp;
  }
  /**
   * Normal tilted by the shore wave's slope, which runs along the direction to
   * the shore: the analytic dY/dX of the profile, so no extra evaluations.
   * @internal
   */
  private tilt(scope: PBInsideFunctionScope, n: PBShaderExp, sw: PBShaderExp, dir: PBShaderExp) {
    const pb = scope.$builder;
    // Gradient of the height in XZ: the slope along the distance, which grows seaward (-dir)
    const grad = pb.mul(pb.neg(dir.xy), sw.y);
    return pb.normalize(pb.add(pb.normalize(n), pb.vec3(pb.neg(grad.x), 0, pb.neg(grad.y))));
  }
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, vertexNormal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swCalcFragmentNormal', [pb.vec2('xz'), pb.vec3('vn')], function () {
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.coverage = pb.float(1);
      this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing, this.coverage);
      this.$l.n = that._base.calcFragmentNormal(this, this.xz, this.vn);
      this.$return(that.tilt(this, this.n, this.sw, this.dir));
    });
    return scope.swCalcFragmentNormal(xz, vertexNormal) as PBShaderExp;
  }
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp,
    foamSample?: PBShaderExp,
    footprint?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const params = [pb.vec2('xz'), pb.vec3('vn')];
    const args = [xz, vertexNormal];
    if (foamSample) {
      params.push(pb.vec3('fs').inout());
      args.push(foamSample);
    }
    if (footprint) {
      params.push(pb.vec4('fp'));
      args.push(footprint);
    }
    const funcName = `swCalcNormalAndFoam${foamSample ? 'S' : ''}${footprint ? 'F' : ''}`;
    pb.func(funcName, params, function () {
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.coverage = pb.float(1);
      this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing, this.coverage);
      // The foam the shore waves make is in the foam field, which the wrapped
      // generator reads
      this.$l.nf = that._base.calcFragmentNormalAndFoam(
        this,
        this.xz,
        this.vn,
        foamSample ? this.fs : undefined,
        footprint ? this.fp : undefined
      );
      this.$return(pb.vec4(that.tilt(this, this.nf.xyz, this.sw, this.dir), this.nf.w));
    });
    return scope[funcName](...args) as PBShaderExp;
  }
  applyWaterBindGroup(bindGroup: BindGroup) {
    this._base.applyWaterBindGroup(bindGroup);
    this.applyShoreBindGroup(bindGroup);
  }
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    this._base.calcClipmapTileAABB(minX, maxX, minZ, maxZ, y, outAABB);
    // The water rises by up to the wave height, and near its edge on the beach
    // the surface is held over the bed, a little higher still
    outAABB.maxPoint.y += this._settings.height + SWASH_LIFT_MARGIN + SWASH_CLEARANCE;
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
      this._dummy = getDevice().createTexture2DArray('rgba16f', 1, 1, 1, { mipmapping: false })!;
    }
    return this._dummy;
  }
}
