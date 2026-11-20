import type { Interpolator, Nullable } from '@zephyr3d/base';
import { AABB, Vector3, Vector4 } from '@zephyr3d/base';

/**
 * A range of numbers; each particle picks its own value in it
 * @public
 */
export class ParticleRange {
  /** Value at random number 0 */
  min: number;
  /** Value at random number 1 */
  max: number;
  /**
   * Creates a range
   * @param min - Value at random number 0
   * @param max - Value at random number 1, the same as min if omitted
   */
  constructor(min = 0, max = min) {
    this.min = min;
    this.max = max;
  }
  /**
   * Sets the range
   * @param min - Value at random number 0
   * @param max - Value at random number 1, the same as min if omitted
   * @returns self
   */
  set(min: number, max = min) {
    this.min = min;
    this.max = max;
    return this;
  }
  /** Copies another range */
  copyFrom(other: ParticleRange) {
    this.min = other.min;
    this.max = other.max;
    return this;
  }
  /** The value at a random number in [0, 1] */
  lerp(t: number) {
    return this.min + (this.max - this.min) * t;
  }
  /** The larger end */
  get upper() {
    return Math.max(this.min, this.max);
  }
  /** The end farther from zero, as a magnitude */
  get maxAbs() {
    return Math.max(Math.abs(this.min), Math.abs(this.max));
  }
}

/**
 * A burst of particles at a given time of every emission cycle
 * @public
 */
export class ParticleBurst {
  /** Seconds into the emission cycle of the first burst */
  time: number;
  /** Number of particles per burst, a whole number picked in this range */
  readonly count: ParticleRange;
  /** How many bursts, `interval` apart; 0 repeats until the end of the cycle */
  cycles: number;
  /** Seconds between the bursts of this entry */
  interval: number;
  /**
   * Creates a burst
   * @param options - Initial values
   */
  constructor(options?: {
    time?: number;
    count?: number | [number, number];
    cycles?: number;
    interval?: number;
  }) {
    this.time = options?.time ?? 0;
    const count = options?.count ?? 30;
    this.count = Array.isArray(count) ? new ParticleRange(count[0], count[1]) : new ParticleRange(count);
    this.cycles = options?.cycles ?? 1;
    this.interval = options?.interval ?? 0.1;
  }
  /** Copies another burst */
  copyFrom(other: ParticleBurst) {
    this.time = other.time;
    this.count.copyFrom(other.count);
    this.cycles = other.cycles;
    this.interval = other.interval;
    return this;
  }
}

/**
 * Color over a particle's life: an RGB curve and an alpha curve over the normalized age, the same
 * pair the editor's ramp texture creator edits
 * @public
 */
export class ParticleGradient {
  /** RGB curve (vec3, or vec4 whose fourth component is the alpha when there is no alpha curve) */
  rgb: Nullable<Interpolator>;
  /** Alpha curve (number) */
  alpha: Nullable<Interpolator>;
  /**
   * Creates a gradient
   * @param rgb - RGB curve over the normalized age, white if null
   * @param alpha - Alpha curve over the normalized age, opaque if null
   */
  constructor(rgb: Nullable<Interpolator> = null, alpha: Nullable<Interpolator> = null) {
    this.rgb = rgb;
    this.alpha = alpha;
  }
}

/**
 * Emission settings of a particle emitter
 * @public
 */
export class ParticleEmissionModule {
  /** Particles per second, independent of the frame rate */
  rate = 50;
  /** Particles per meter the emitter moves in world space (trails, tire smoke) */
  rateOverDistance = 0;
  /** Bursts within each emission cycle */
  bursts: ParticleBurst[] = [];
}

/**
 * Shape a particle emitter emits from
 * @public
 */
export type ParticleShapeType = 'point' | 'sphere' | 'hemisphere' | 'box' | 'cone' | 'circle' | 'edge';

/**
 * Where particles are born and which way they go, in the space of the emitter, emitting along +Y
 * @public
 */
export class ParticleShapeModule {
  /** Shape type */
  type: ParticleShapeType = 'cone';
  /** Radius of sphere, hemisphere, cone and circle */
  radius = 0.2;
  /**
   * Part of the shape particles are born in: 0 on its surface (edge for cone and circle, faces for
   * box) only, 1 throughout. Sampled evenly by area or volume.
   */
  thickness = 1;
  /**
   * Half angle in radians: of the spread around +Y for point, box and edge (π for every
   * direction), of the cone at its rim for cone
   */
  angle = 0.4;
  /** Angular range in radians around +Y for sphere, hemisphere, cone and circle */
  arc = Math.PI * 2;
  /** Size of the box */
  readonly boxSize = new Vector3(1, 1, 1);
  /** Length of the edge, along X */
  length = 1;
  /** 0 to 1: blends the direction toward a random one */
  randomizeDirection = 0;
}

/**
 * Values each particle picks at birth
 * @public
 */
export class ParticleStartModule {
  /** Lifetime in seconds */
  readonly lifetime = new ParticleRange(1, 1.5);
  /** Speed along the emission direction, in units per second */
  readonly speed = new ParticleRange(2, 3);
  /** Height of the quad; scaled by the size curve over the life and by the emitter's scale */
  readonly size = new ParticleRange(0.2, 0.4);
  /** Width over height of the quad */
  aspect = 1;
  /** Angle of the quad in its plane at birth, radians */
  readonly rotation = new ParticleRange(0, 0);
  /** Rate the quad turns at, radians per second */
  readonly angularVelocity = new ParticleRange(0, 0);
  /** Linear color, picked with colorB; may exceed 1 for bloom */
  readonly colorA = new Vector4(1, 1, 1, 1);
  /** Linear color, see colorA */
  readonly colorB = new Vector4(1, 1, 1, 1);
}

/**
 * Values over the life of a particle, multiplying the values it picked at birth. Assign a curve
 * again after changing it, which bakes it.
 * @public
 */
export class ParticleOverLifeModule {
  /** @internal */
  private _size: Nullable<Interpolator>;
  /** @internal */
  private _color: Nullable<ParticleGradient>;
  /** @internal */
  private readonly _onChange: () => void;
  /** @internal */
  constructor(onChange: () => void) {
    this._size = null;
    this._color = null;
    this._onChange = onChange;
  }
  /** Size factor over the normalized age (number curve); null for 1 */
  get size() {
    return this._size;
  }
  set size(curve: Nullable<Interpolator>) {
    this._size = curve;
    this._onChange();
  }
  /** Color factor over the normalized age; null for white */
  get color() {
    return this._color;
  }
  set color(gradient: Nullable<ParticleGradient>) {
    this._color = gradient;
    this._onChange();
  }
}

/**
 * Forces on particles
 * @public
 */
export class ParticleForcesModule {
  /** Acceleration in world space, units per second squared; not scaled with the emitter */
  readonly gravity = new Vector3(0, 0, 0);
  /** Rate in 1/s the velocity approaches the air's velocity at */
  drag = 0;
  /** Velocity of the air in world space, see drag */
  readonly airVelocity = new Vector3(0, 0, 0);
}

/**
 * How the bounds of a particle emitter, which cull it, are found
 * @public
 */
export type ParticleBoundsMode = 'auto' | 'fixed';

/**
 * Bounds of a particle emitter
 * @public
 */
export class ParticleBoundsModule {
  /** 'auto' measures the particles, 'fixed' uses box */
  mode: ParticleBoundsMode = 'auto';
  /** Box in the space of the emitter, for the fixed mode */
  readonly box = new AABB(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
}
