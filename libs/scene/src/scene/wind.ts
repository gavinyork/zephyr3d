import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Lattice period of the wind noise, in noise cells. The scroll offsets and the evolution
 * coordinate wrap at this period, so they never lose float precision however long the scene runs.
 */
const NOISE_PERIOD = 256;
/**
 * How fast the noise evolves in place, in noise cells per noise cell scrolled. Without it the gust
 * pattern would slide along rigidly; with it the gusts form and fade as they travel.
 */
const GUST_EVOLUTION = 0.35;
const DETAIL_EVOLUTION = 0.7;
/**
 * Period of the wind clock, in seconds. Oscillations driven by it (grass sway) jump once per
 * period, which keeps float precision of the phase good for the whole period.
 */
const CLOCK_PERIOD = 86400;
/** Number of vec4 in the shader parameters of one frame, see WindField.shaderParams */
const PARAMS_PER_FRAME = 4;

/**
 * Integer lattice hash shared by the CPU and GPU paths (same mixing as the grass placement hash).
 * Inputs are lattice coordinates already wrapped into [0, NOISE_PERIOD).
 */
function latticeHash(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Gradient selection of Ken Perlin's improved noise (Perlin, "Improving Noise", SIGGRAPH 2002) */
function grad(h: number, x: number, y: number, z: number): number {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrap(i: number) {
  return i & (NOISE_PERIOD - 1);
}

/**
 * 3D gradient noise in roughly [-1, 1], periodic with NOISE_PERIOD on every axis.
 * @internal
 */
export function windNoise3(x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const x0 = wrap(fx);
  const y0 = wrap(fy);
  const z0 = wrap(fz);
  const x1 = wrap(fx + 1);
  const y1 = wrap(fy + 1);
  const z1 = wrap(fz + 1);
  const dx = x - fx;
  const dy = y - fy;
  const dz = z - fz;
  const u = fade(dx);
  const v = fade(dy);
  const w = fade(dz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const n000 = grad(latticeHash(x0, y0, z0), dx, dy, dz);
  const n100 = grad(latticeHash(x1, y0, z0), dx - 1, dy, dz);
  const n010 = grad(latticeHash(x0, y1, z0), dx, dy - 1, dz);
  const n110 = grad(latticeHash(x1, y1, z0), dx - 1, dy - 1, dz);
  const n001 = grad(latticeHash(x0, y0, z1), dx, dy, dz - 1);
  const n101 = grad(latticeHash(x1, y0, z1), dx - 1, dy, dz - 1);
  const n011 = grad(latticeHash(x0, y1, z1), dx, dy - 1, dz - 1);
  const n111 = grad(latticeHash(x1, y1, z1), dx - 1, dy - 1, dz - 1);
  return lerp(
    lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
    lerp(lerp(n001, n101, u), lerp(n011, n111, u), v),
    w
  );
}

/**
 * Scene-wide wind.
 *
 * The model follows Ghost of Tsushima (Rockenbeck, "Blowing from the West", GDC 2021; Wohllaib,
 * "Procedural Grass in Ghost of Tsushima", GDC 2021): a single wind direction, and a push
 * strength that varies from place to place with time-varying Perlin noise scrolled along the
 * wind, so gusts can be seen travelling across fields. A second, finer noise layer adds the high
 * frequency part. The talks do not give how the noise is shaped, so the push here is
 *
 *   push = strength * max(0, 1 + gustStrength * gustNoise + detailStrength * detailNoise)
 *
 * with both noises in about [-1, 1].
 *
 * Systems that react to the wind (grass, foliage, particles...) sample it either on the CPU with
 * {@link WindField.sample} or in shaders with {@link WindField.shaderPush}, using the parameters
 * of {@link WindField.shaderParams}. Those carry the current and the previous frame, so a vertex
 * shader can place a vertex where it was last frame and output a correct motion vector.
 *
 * @public
 */
export class WindField {
  private _direction: number;
  private _strength: number;
  private _speed: number;
  private _gustStrength: number;
  private _gustScale: number;
  private _detailStrength: number;
  private _detailScale: number;
  /** Scroll offsets and evolution coordinates, in noise cells, wrapped to the noise period */
  private readonly _gust: Float64Array;
  private readonly _detail: Float64Array;
  /** vec4[2 * PARAMS_PER_FRAME]: current frame then previous frame */
  private readonly _params: Float32Array<ArrayBuffer>;
  private _hasPrev: boolean;
  private _time: number;
  /** @internal */
  constructor() {
    this._direction = 0;
    this._strength = 0.3;
    this._speed = 4;
    this._gustStrength = 0.6;
    this._gustScale = 30;
    this._detailStrength = 0.25;
    this._detailScale = 4;
    this._gust = new Float64Array(3);
    this._detail = new Float64Array(3);
    this._params = new Float32Array(8 * PARAMS_PER_FRAME);
    this._hasPrev = false;
    this._time = 0;
    this.writeParams(0);
  }
  /**
   * Direction the wind blows toward, in degrees on the ground plane. 0 blows toward +X,
   * 90 toward +Z.
   */
  get direction() {
    return this._direction;
  }
  set direction(val: number) {
    this._direction = val;
    this.writeParams(0);
  }
  /** Overall push of the wind. 0 is calm air. */
  get strength() {
    return this._strength;
  }
  set strength(val: number) {
    this._strength = Math.max(0, val);
    this.writeParams(0);
  }
  /** Speed at which the gusts travel along the wind, in world units per second */
  get speed() {
    return this._speed;
  }
  set speed(val: number) {
    this._speed = Math.max(0, val);
  }
  /** How much the gusts raise and lower the push, 0 for a steady wind */
  get gustStrength() {
    return this._gustStrength;
  }
  set gustStrength(val: number) {
    this._gustStrength = Math.max(0, val);
    this.writeParams(0);
  }
  /** Typical size of a gust, in world units */
  get gustScale() {
    return this._gustScale;
  }
  set gustScale(val: number) {
    this._gustScale = Math.max(0.01, val);
    this.writeParams(0);
  }
  /** How much the fine turbulence raises and lowers the push */
  get detailStrength() {
    return this._detailStrength;
  }
  set detailStrength(val: number) {
    this._detailStrength = Math.max(0, val);
    this.writeParams(0);
  }
  /** Typical size of the fine turbulence, in world units */
  get detailScale() {
    return this._detailScale;
  }
  set detailScale(val: number) {
    this._detailScale = Math.max(0.01, val);
    this.writeParams(0);
  }
  /** Unit wind direction on the ground plane as [x, z] */
  get directionXZ(): [number, number] {
    const a = (this._direction * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a)];
  }
  /** Wind clock in seconds, wrapping once a day; drives oscillations such as grass sway */
  get time() {
    return this._time;
  }
  /**
   * Shader parameters, 8 vec4: the current frame in [0, 4) and the previous frame in [4, 8).
   * Pass either half to {@link WindField.shaderPush}.
   */
  get shaderParams(): Float32Array<ArrayBuffer> {
    return this._params;
  }
  /**
   * Advances the wind by one frame. Called once per frame by the scene.
   * @internal
   */
  update(deltaSeconds: number) {
    // The frame being left becomes the previous frame, parameter edits included
    this._params.copyWithin(4 * PARAMS_PER_FRAME, 0, 4 * PARAMS_PER_FRAME);
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
    const [dx, dz] = this.directionXZ;
    const advance = (state: Float64Array, scale: number, evolution: number) => {
      const cells = (this._speed * dt) / scale;
      state[0] = (state[0] + dx * cells) % NOISE_PERIOD;
      state[1] = (state[1] + dz * cells) % NOISE_PERIOD;
      state[2] = (state[2] + cells * evolution) % NOISE_PERIOD;
    };
    advance(this._gust, this._gustScale, GUST_EVOLUTION);
    advance(this._detail, this._detailScale, DETAIL_EVOLUTION);
    this._time = (this._time + dt) % CLOCK_PERIOD;
    this.writeParams(0);
    if (!this._hasPrev) {
      // No previous frame yet: report no motion
      this._params.copyWithin(4 * PARAMS_PER_FRAME, 0, 4 * PARAMS_PER_FRAME);
      this._hasPrev = true;
    }
  }
  /**
   * Samples the wind push at a world position on the CPU
   * @param x - World X
   * @param z - World Z
   * @returns Push strength at the position, see {@link WindField}
   */
  sample(x: number, z: number): number {
    const g = windNoise3(
      x / this._gustScale - this._gust[0],
      z / this._gustScale - this._gust[1],
      this._gust[2]
    );
    const d = windNoise3(
      x / this._detailScale - this._detail[0],
      z / this._detailScale - this._detail[1],
      this._detail[2]
    );
    return this._strength * Math.max(0, 1 + this._gustStrength * g + this._detailStrength * d);
  }
  /** @internal */
  private writeParams(frame: number) {
    const p = this._params;
    const o = frame * 4 * PARAMS_PER_FRAME;
    const [dx, dz] = this.directionXZ;
    // (direction.xz, strength, gustStrength)
    p[o + 0] = dx;
    p[o + 1] = dz;
    p[o + 2] = this._strength;
    p[o + 3] = this._gustStrength;
    // (gust offset.xz, gust evolution, 1 / gustScale)
    p[o + 4] = this._gust[0];
    p[o + 5] = this._gust[1];
    p[o + 6] = this._gust[2];
    p[o + 7] = 1 / this._gustScale;
    // (detail offset.xz, detail evolution, 1 / detailScale)
    p[o + 8] = this._detail[0];
    p[o + 9] = this._detail[1];
    p[o + 10] = this._detail[2];
    p[o + 11] = 1 / this._detailScale;
    // (detailStrength, wind clock, unused, unused)
    p[o + 12] = this._detailStrength;
    p[o + 13] = this._time;
    p[o + 14] = 0;
    p[o + 15] = 0;
  }
  /**
   * Declares the wind shader functions and returns the push at a world position.
   *
   * @param scope - Current shader scope
   * @param worldXZ - World position on the ground plane (vec2)
   * @param p0 - First vec4 of the frame parameters, see {@link WindField.shaderParams}
   * @param p1 - Second vec4
   * @param p2 - Third vec4
   * @param p3 - Fourth vec4
   * @returns Push strength (float)
   */
  static shaderPush(
    scope: PBInsideFunctionScope,
    worldXZ: PBShaderExp,
    p0: PBShaderExp,
    p1: PBShaderExp,
    p2: PBShaderExp,
    p3: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const funcHash = 'Z_windLatticeHash';
    const funcGrad = 'Z_windGrad';
    const funcNoise = 'Z_windNoise3';
    const funcPush = 'Z_windPush';
    // See latticeHash()
    pb.func(funcHash, [pb.uint('x'), pb.uint('y'), pb.uint('z')], function () {
      this.$l.h = pb.compXor(
        pb.compXor(pb.mul(this.x, pb.uint(0x27d4eb2d)), pb.mul(this.y, pb.uint(0x165667b1))),
        pb.mul(this.z, pb.uint(0x9e3779b9))
      );
      this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 15)), pb.uint(0x85ebca6b));
      this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 13)), pb.uint(0xc2b2ae35));
      this.h = pb.compXor(this.h, pb.sar(this.h, 16));
      this.$return(this.h);
    });
    // See grad(). Branch-free with mix() since select() is not available on WebGL2
    pb.func(funcGrad, [pb.uint('hash'), pb.vec3('d')], function () {
      this.$l.h = pb.compAnd(this.hash, pb.uint(15));
      this.$l.u = pb.mix(this.d.y, this.d.x, pb.float(pb.lessThan(this.h, pb.uint(8))));
      this.$l.xz = pb.mix(
        this.d.z,
        this.d.x,
        pb.add(pb.float(pb.equal(this.h, pb.uint(12))), pb.float(pb.equal(this.h, pb.uint(14))))
      );
      this.$l.v = pb.mix(this.xz, this.d.y, pb.float(pb.lessThan(this.h, pb.uint(4))));
      this.$l.su = pb.sub(1, pb.mul(pb.float(pb.compAnd(this.h, pb.uint(1))), 2));
      this.$l.sv = pb.sub(1, pb.float(pb.compAnd(this.h, pb.uint(2))));
      this.$return(pb.add(pb.mul(this.u, this.su), pb.mul(this.v, this.sv)));
    });
    // See windNoise3()
    pb.func(funcNoise, [pb.vec3('p')], function () {
      this.$l.fl = pb.floor(this.p);
      this.$l.d = pb.sub(this.p, this.fl);
      this.$l.i = pb.ivec3(this.fl);
      this.$l.c0 = pb.uvec3(pb.compAnd(this.i, pb.ivec3(NOISE_PERIOD - 1)));
      this.$l.c1 = pb.uvec3(pb.compAnd(pb.add(this.i, pb.ivec3(1)), pb.ivec3(NOISE_PERIOD - 1)));
      this.$l.w = pb.mul(
        this.d,
        this.d,
        this.d,
        pb.add(pb.mul(this.d, pb.sub(pb.mul(this.d, 6), pb.vec3(15))), pb.vec3(10))
      );
      this.$l.n000 = this[funcGrad](this[funcHash](this.c0.x, this.c0.y, this.c0.z), this.d);
      this.$l.n100 = this[funcGrad](
        this[funcHash](this.c1.x, this.c0.y, this.c0.z),
        pb.sub(this.d, pb.vec3(1, 0, 0))
      );
      this.$l.n010 = this[funcGrad](
        this[funcHash](this.c0.x, this.c1.y, this.c0.z),
        pb.sub(this.d, pb.vec3(0, 1, 0))
      );
      this.$l.n110 = this[funcGrad](
        this[funcHash](this.c1.x, this.c1.y, this.c0.z),
        pb.sub(this.d, pb.vec3(1, 1, 0))
      );
      this.$l.n001 = this[funcGrad](
        this[funcHash](this.c0.x, this.c0.y, this.c1.z),
        pb.sub(this.d, pb.vec3(0, 0, 1))
      );
      this.$l.n101 = this[funcGrad](
        this[funcHash](this.c1.x, this.c0.y, this.c1.z),
        pb.sub(this.d, pb.vec3(1, 0, 1))
      );
      this.$l.n011 = this[funcGrad](
        this[funcHash](this.c0.x, this.c1.y, this.c1.z),
        pb.sub(this.d, pb.vec3(0, 1, 1))
      );
      this.$l.n111 = this[funcGrad](
        this[funcHash](this.c1.x, this.c1.y, this.c1.z),
        pb.sub(this.d, pb.vec3(1, 1, 1))
      );
      this.$return(
        pb.mix(
          pb.mix(pb.mix(this.n000, this.n100, this.w.x), pb.mix(this.n010, this.n110, this.w.x), this.w.y),
          pb.mix(pb.mix(this.n001, this.n101, this.w.x), pb.mix(this.n011, this.n111, this.w.x), this.w.y),
          this.w.z
        )
      );
    });
    pb.func(
      funcPush,
      [pb.vec2('xz'), pb.vec4('p0'), pb.vec4('p1'), pb.vec4('p2'), pb.vec4('p3')],
      function () {
        this.$l.g = this[funcNoise](pb.vec3(pb.sub(pb.mul(this.xz, this.p1.w), this.p1.xy), this.p1.z));
        this.$l.dn = this[funcNoise](pb.vec3(pb.sub(pb.mul(this.xz, this.p2.w), this.p2.xy), this.p2.z));
        this.$return(
          pb.mul(
            this.p0.z,
            pb.max(0, pb.add(1, pb.add(pb.mul(this.p0.w, this.g), pb.mul(this.p3.x, this.dn))))
          )
        );
      }
    );
    return pb.getGlobalScope()[funcPush](worldXZ, p0, p1, p2, p3) as PBShaderExp;
  }
}
