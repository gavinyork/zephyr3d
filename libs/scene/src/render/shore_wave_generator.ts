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
import { hash11, valueNoise } from '../shaders/noise';
import { FOAM_TEX_CELLS, getDefaultFoamTexture } from '../utility/textures/foam';

/** Texels of the inverse table along y = x - b sin x over one period, and along b. */
const INVERSE_SAMPLES = 256;
const INVERSE_SHARPNESS = 32;
/** Largest b the inverse table holds; at 1 the crest becomes a cusp. */
const SHARPNESS_MAX = 0.95;
/** Along-shore phase variation: cycles of noise per metre. */
const PHASE_NOISE_SCALE = 0.04;
/** Wave sets: noise per metre along the shore, its drift in cycles per wave, and how deep the sets cut. */
const SET_SCALE = 0.02;
const SET_DRIFT = 0.02;
const SET_DEPTH = 0.6;
/**
 * Crest bends: phase offset in cycles from noise along the shore (at the foot
 * of each point on the waterline), two octaves of noise per metre. Constant
 * along each way in, so a crest comes in bent and straightens as the spacing
 * between crests shrinks towards the shore.
 */
const BEND_SCALE = 0.035;
const BEND_AMPLITUDE = 0.45;
/**
 * Crest segments: each wave, picked by its count, rises and falls along the
 * shore by its own noise, so no two waves are whole lines broken at the same
 * places. Noise per metre along the shore, and how deep the gaps cut.
 */
const SEGMENT_SCALE = 0.06;
const SEGMENT_DEPTH = 0.85;
/**
 * Band limit of the displacement against the mesh, after Crest's handing each
 * LOD only the wavelengths its vertices can show (Bowles, "Crest: Novel ocean
 * rendering techniques in an open source framework", SIGGRAPH 2017): as mesh
 * vertices per crest spacing fall from SHARP_SAMPLES_FULL to SHARP_SAMPLES_MIN
 * the sharpened, leaning profile, whose narrow crest would zigzag between
 * coarse vertices, eases back to a sine; from AMP_SAMPLES_FULL to
 * AMP_SAMPLES_MIN the wave flattens out. The fragment stage keeps the full
 * profile in its normals.
 */
const SHARP_SAMPLES_MIN = 4;
const SHARP_SAMPLES_FULL = 12;
const AMP_SAMPLES_MIN = 2;
const AMP_SAMPLES_FULL = 4;
/**
 * The swash, the water a wave throws up the beach after its crest reaches the
 * waterline, after the ballistic run-up of Shen & Meyer ("Climb of a bore on
 * a beach", JFM 16, 1963) in the form Peregrine & Williams give it ("Swash
 * overtopping a truncated plane beach", JFM 440, 2001): the tip leaves the
 * waterline at u0 and slows under g tan(beta), s_f = u0 t - g tan(beta) t^2 / 2,
 * and behind it the water deepens as h = (s_f - s)^2 / (36 g t^2); ahead of it
 * the beach stays dry. Run up to the crest height above the rest level, so
 * u0 = sqrt(2 g height); its up-and-back lasts 2 u0 / (g tan(beta)), at most
 * SWASH_DURATION_MAX wave periods, past which it is slowed to fit.
 */
const SWASH_GRAVITY = 9.81;
const SWASH_DURATION_MAX = 0.8;
/**
 * Metres inland over which the crest collapsing at the waterline sinks into
 * the swash: the water level there falls off exponentially, so the surface
 * runs on unbroken from the sea.
 */
const SWASH_COLLAPSE = 0.6;
/** Metres behind the swash tip that its foam line spans. */
const SWASH_FRONT_FOAM = 1.2;
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
/** Largest B anything here is worked out with, a bed at about 3 degrees. */
const B_MAX = 20;
/** Distance in metres out from the waterline over which the wrapped generator's chop dies away. */
const CHOP_FADE = 3;
/**
 * The water's edge on the beach is drawn per pixel (see calcSurfaceCoverage),
 * where the water meets the bed height of the waterline field, not by where
 * the water mesh's triangles, a metre or more across, dip under the sand:
 * near the edge the mesh is held SWASH_CLEARANCE metres over the bed and cut
 * there. It is held where the bed is at most SWASH_LIFT_MARGIN metres above
 * the highest water, up to SWASH_EDGE_EXTEND metres past the farthest the
 * water reaches; the edge is softened over SWASH_EDGE_SOFT metres.
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
/** Shoaling, 0 at the outer edge of the zone and 1 at the waterline, past which the crests break. */
const BREAK_SHOAL = 0.55;
/** Size in metres of a cell of the foam's bubble web, and the softness of its threshold. */
const FOAM_CELL = 0.7;
const FOAM_FEATHER = 0.12;
/** Noise per metre staggering where the foam layers swap. */
const FOAM_SWAP_NOISE_SCALE = 0.05;

let inverseTexture: Nullable<Texture2D> = null;

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
export class ShoreWaveGenerator extends Disposable implements WaveGenerator {
  private readonly _base: WaveGenerator;
  private readonly _settings: ShoreWaveSettings;
  private _waterline: Nullable<Texture2D>;
  private _version: number;
  private _dummy: Nullable<Texture2D>;
  /** (grid origin x, origin z, 1 / grid size, rest level) */
  private readonly _grid: Vector4;
  /** (height, zone, crests across the zone: 2 zone / wavelength, time / period) */
  private readonly _wave: Vector4;
  /** (sharpness at the shore, lean at the shore, wave clock of the previous frame, period in seconds) */
  private readonly _shape: Vector4;
  constructor(base: WaveGenerator, settings: ShoreWaveSettings) {
    super();
    this._base = base;
    this._settings = settings;
    this._waterline = null;
    this._version = 0;
    this._dummy = null;
    this._grid = new Vector4(0, 0, 0, 0);
    this._wave = new Vector4(0, 1, 1, 0);
    this._shape = new Vector4(0, 0, 0, 0);
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
    const zone = Math.max(0.1, s.zone);
    this._shape.setXYZW(
      Math.min(Math.max(s.sharpness, 0), SHARPNESS_MAX),
      Math.min(Math.max(s.lean, 0), 1),
      this._wave.w,
      Math.max(0.1, s.period)
    );
    this._wave.setXYZW(
      waterline ? Math.max(0, s.height) : 0,
      zone,
      (2 * zone) / Math.max(0.1, s.wavelength),
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
    scope.swInverse = pb.tex2D().uniform(uniformGroup);
    scope.swGrid = pb.vec4().uniform(uniformGroup);
    scope.swWave = pb.vec4().uniform(uniformGroup);
    scope.swShape = pb.vec4().uniform(uniformGroup);
    scope.swFoam = pb.tex2D().uniform(uniformGroup);
  }
  /**
   * Shore wave at an undisplaced world XZ, at a wave clock (time over period):
   * (height, slope of the height along the distance to the shore, foam, 0).
   * Out parameters: `dir` (direction to the shore xy, weight of the wrapped
   * generator's chop dying near the shore z, bed height the surface is held
   * over w, far below the water where it is not) and `spacing`, the distance
   * between crests here. `cell` is the distance between mesh vertices to
   * band-limit to, 0 for the full profile.
   * @internal
   */
  private evaluate(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    dir: PBShaderExp,
    spacing: PBShaderExp,
    tPhase?: PBShaderExp,
    cell?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    pb.func(
      'swEvaluate',
      [pb.vec2('xz'), pb.vec4('dir').out(), pb.float('spacing').out(), pb.float('tPhase'), pb.float('cell')],
      function () {
        // No bed to hold the surface over, unless the shore says otherwise
        this.dir = pb.vec4(0, 0, 0, -1e4);
        this.spacing = pb.float(1);
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
        // Shore coordinates: (signed distance to the waterline, negative inland;
        // bed B; bed height over the rest level)
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
        // of 1 / wavelength with the wavelength shrinking as sqrt of the depth.
        // Past the breaking depth the bore no longer shortens: below `dMin` the
        // phase runs on linearly at the rate it had there, instead of sqrt's
        // spacing collapsing to nothing at the waterline. Frozen at its shoreline
        // value inland, where the water rises and falls over the beach.
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
        this.$l.bend = pb.add(
          valueNoise(this, pb.mul(this.foot, BEND_SCALE)),
          pb.mul(valueNoise(this, pb.add(pb.mul(this.foot, BEND_SCALE * 2.7), pb.vec2(31.7, 17.3))), 0.5)
        );
        this.$l.phase = pb.add(
          this.tPhase,
          pb.mul(this.swWave.z, this.rootTerm),
          valueNoise(this, pb.mul(this.noisePos, PHASE_NOISE_SCALE)),
          pb.mul(this.bend, BEND_AMPLITUDE)
        );
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
        this.waveSet = pb.mul(this.waveSet, segment(this, pb.floor(pb.add(this.phase, 0.5))));
        // Only where the bed shelves: waves roll in as surf on a beach, not
        // against a cliff, a pier or a hull, which the waterline field also
        // holds; and fading out towards the edge of the grid
        this.$l.edge = pb.min(
          pb.min(this.uv.x, this.uv.y),
          pb.min(pb.sub(1, this.uv.x), pb.sub(1, this.uv.y))
        );
        this.$l.shelving = pb.mul(
          pb.smoothStep(SHELVING_MIN, SHELVING_FULL, this.wl.y),
          pb.smoothStep(0, GRID_EDGE_FADE, this.edge)
        );
        // Rising out of the sea over the outer part of the zone
        this.$l.amp = pb.mul(
          this.swWave.x,
          this.waveSet,
          this.shelving,
          pb.smoothStep(0, 0.4, this.shoal),
          this.ampLod
        );
        this.$l.height = pb.mul(this.profile, this.amp);
        // Slope along the distance to the shore: X runs seaward at 1 / spacing,
        // and stands still inland where the phase is frozen
        this.$l.slope = this.$choice(
          pb.greaterThan(this.d, 0),
          pb.div(pb.mul(this.dYdX, this.amp), this.spacing),
          pb.float(0)
        );
        // Foam on the crests once they break, more the closer to the shore
        this.$l.foam = pb.mul(
          pb.smoothStep(BREAK_SHOAL, 1, this.shoal),
          pb.smoothStep(0.55, 0.95, this.profile),
          this.waveSet,
          this.shelving
        );
        // The wrapped generator's chop dies near the shore
        this.dir.z = pb.mul(pb.sub(1, pb.smoothStep(0, CHOP_FADE, this.d)), this.shelving);
        // The water rises straight up and is wet wherever it stands over the bed,
        // so its edge follows the beach whatever its shape. Near that edge the
        // mesh is held clear of the bed, with the edge cut per pixel: only where
        // the water could come near the bed, as far as it could reach, not on a
        // dune or a flat behind the beach higher than the highest water
        this.$l.highest = pb.mul(this.swWave.x, this.waveSet);
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
        // Inland: the swash, in wave periods since its crest reached the waterline
        // (X, the phase there being frozen at its waterline value), instead of
        // the water level rising and falling flat across the beach, which on a
        // gentle slope floods metres of sand at once and fills hollows ahead of
        // the water as if from below
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
          // The crest collapsing at the waterline
          this.$l.collapse = pb.mul(this.height, pb.exp(pb.div(pb.neg(this.s), SWASH_COLLAPSE)));
          this.height = pb.max(this.swash, this.collapse);
          // A line of foam rides the tip up the beach, thinning out as it runs back
          this.$l.frontFoam = this.$choice(
            pb.greaterThan(this.behind, 0),
            pb.mul(
              pb.sub(1, pb.smoothStep(0, SWASH_FRONT_FOAM, this.behind)),
              pb.sub(1, this.tt),
              this.swashSet,
              this.shelving
            ),
            pb.float(0)
          );
          this.foam = pb.max(
            pb.mul(this.foam, pb.exp(pb.div(pb.neg(this.s), SWASH_COLLAPSE))),
            this.frontFoam
          );
        });
        this.$return(pb.vec4(this.height, this.slope, this.foam, 0));
      }
    );
    return scope.swEvaluate(xz, dir, spacing, tPhase ?? scope.swWave.w, cell ?? pb.float(0)) as PBShaderExp;
  }
  /**
   * Adds the shore wave to a position the wrapped generator displaced, at a
   * wave clock (time over period): straight up. Near the shore the wrapped
   * generator's chop dies, which would poke through the sand and throw the
   * water's edge about, and near that edge the surface is held clear of the
   * bed, which the fragment stage cuts it to.
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
        // At the undisplaced position, where the fragment stage evaluates it too
        this.$l.sw = that.evaluate(this, this.inPos.xz, this.dir, this.spacing, this.tPhase, this.cell);
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
   * Where a vertex was in the previous frame, for motion vectors: the shore
   * wave at the previous frame's clock. The water's edge sweeps metres across
   * the beach in a second, and without this the temporal filter smears and
   * jitters it. The wrapped generator is taken as it is now.
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
   * The foam texture carried shoreward with the crests, by a two-layer flow
   * map: each layer slides along the direction to the shore at the local crest
   * speed (crest spacing per period) for one wave period, fading in and out
   * so its jump back is unseen, and starts every period at a new random offset,
   * so each wave brings its own foam. The layers' wave clocks are staggered by
   * half a period and by low-frequency noise, so they do not all swap at once.
   * Blended keeping the variance, which a plain mix halves, to keep the
   * thresholded web crisp.
   * @internal
   */
  private foamPattern(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    xzGrad: PBShaderExp,
    dir: PBShaderExp,
    spacing: PBShaderExp
  ) {
    const pb = scope.$builder;
    pb.func(
      'swFoamPattern',
      [pb.vec2('xz'), pb.vec4('xzGrad'), pb.vec2('dir'), pb.float('spacing')],
      function () {
        this.$l.uvScale = 1 / (FOAM_CELL * FOAM_TEX_CELLS);
        this.$l.clock = pb.add(this.swWave.w, valueNoise(this, pb.mul(this.xz, FOAM_SWAP_NOISE_SCALE)));
        this.$l.acc = pb.float(0);
        this.$l.wsq = pb.float(0);
        for (let k = 0; k < 2; k++) {
          this.$l[`t${k}`] = pb.add(this.clock, k * 0.5);
          this.$l[`tau${k}`] = pb.fract(this[`t${k}`]);
          this.$l[`cycle${k}`] = pb.floor(this[`t${k}`]);
          this.$l[`w${k}`] = pb.sub(1, pb.abs(pb.sub(pb.mul(this[`tau${k}`], 2), 1)));
          this.$l[`jump${k}`] = pb.fract(
            pb.mul(
              pb.sin(
                pb.vec2(
                  pb.add(pb.mul(this[`cycle${k}`], 12.9898), k * 78.233),
                  pb.mul(this[`cycle${k}`], 39.346)
                )
              ),
              43758.5453
            )
          );
          this.$l[`p${k}`] = pb.add(
            pb.mul(pb.sub(this.xz, pb.mul(this.dir, pb.mul(this[`tau${k}`], this.spacing))), this.uvScale),
            this[`jump${k}`]
          );
          this.$l[`s${k}`] = pb.textureSampleGrad(
            this.swFoam,
            this[`p${k}`],
            pb.mul(this.xzGrad.xy, this.uvScale),
            pb.mul(this.xzGrad.zw, this.uvScale)
          ).r;
          this.acc = pb.add(this.acc, pb.mul(pb.sub(this[`s${k}`], 0.5), this[`w${k}`]));
          this.wsq = pb.add(this.wsq, pb.mul(this[`w${k}`], this[`w${k}`]));
        }
        this.$return(pb.clamp(pb.add(0.5, pb.div(this.acc, pb.sqrt(pb.max(this.wsq, 1e-4)))), 0, 1));
      }
    );
    return scope.swFoamPattern(xz, xzGrad, dir, spacing) as PBShaderExp;
  }
  /**
   * The water's edge on the beach, per pixel: 1 where the water stands over
   * the bed, 0 where the mesh is only held clear of the sand so that its
   * coarse triangles do not draw the edge.
   */
  calcSurfaceCoverage(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('swSurfaceCoverage', [pb.vec2('xz')], function () {
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing);
      // Off the grid, out of the waves or away from the beach: nothing to cut
      this.$if(pb.lessThan(this.dir.w, -1e3), function () {
        this.$return(pb.float(1));
      });
      this.$l.uv = pb.mul(pb.sub(this.xz, this.swGrid.xy), this.swGrid.z);
      this.$l.bedB = pb.clamp(pb.textureSampleLevel(this.swWaterline, this.uv, 0).y, 1, B_MAX);
      // Water over the bed, the softening turned from metres across the slope into a height
      this.$l.soft = pb.div(SWASH_EDGE_SOFT, this.bedB);
      this.$return(pb.smoothStep(pb.neg(this.soft), this.soft, pb.sub(this.sw.x, this.dir.w)));
    });
    return scope.swSurfaceCoverage(xz) as PBShaderExp;
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
      this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing);
      this.$l.n = that._base.calcFragmentNormal(this, this.xz, this.vn);
      this.$return(that.tilt(this, this.n, this.sw, this.dir));
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
      // Screen derivatives for the foam texture, here in uniform control flow
      this.$l.xzGrad = pb.vec4(pb.dpdx(this.xz), pb.dpdy(this.xz));
      this.$l.dir = pb.vec4(0);
      this.$l.spacing = pb.float(0);
      this.$l.sw = that.evaluate(this, this.xz, this.dir, this.spacing);
      this.$l.nf = that._base.calcFragmentNormalAndFoam(this, this.xz, this.vn);
      this.$l.n = that.tilt(this, this.nf.xyz, this.sw, this.dir);
      // The breaking crests are white; composed with the base foam as
      // overlapping coverage, as the material does with the shore foam
      this.$l.density = pb.clamp(this.sw.z, 0, 1);
      // Black-point fade of the bubble web: the density uncovers clumps and
      // filaments instead of greying the whole area
      this.$l.f = pb.float(0);
      this.$if(pb.greaterThan(this.density, 0), function () {
        this.$l.pattern = that.foamPattern(this, this.xz, this.xzGrad, this.dir.xy, this.spacing);
        this.$l.threshold = pb.sub(1, this.density);
        this.f = pb.mul(
          pb.sqrt(this.density),
          pb.smoothStep(this.threshold, pb.add(this.threshold, FOAM_FEATHER), this.pattern)
        );
      });
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
    bindGroup.setTexture('swInverse', getInverseTexture(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('swGrid', this._grid);
    bindGroup.setValue('swWave', this._wave);
    bindGroup.setValue('swShape', this._shape);
    bindGroup.setTexture('swFoam', getDefaultFoamTexture(), fetchSampler('repeat_linear'));
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
      this._dummy = getDevice().createTexture2D('rgba16f', 1, 1, { mipmapping: false })!;
    }
    return this._dummy;
  }
}
