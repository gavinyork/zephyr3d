import type { ParticleLUT } from './particle_lut';
import { PARTICLE_LUT_SIZE } from './particle_lut';
import { ParticleChannel, particleBaseHash, particleRandom } from './particle_random';

/**
 * Shape types as the simulation numbers them
 * @internal
 */
export const PARTICLE_SHAPE_IDS = {
  point: 0,
  sphere: 1,
  hemisphere: 2,
  box: 3,
  cone: 4,
  circle: 5,
  edge: 6
} as const;

/** Floats per particle in the instance buffer */
export const PARTICLE_INSTANCE_FLOATS = 16;
/** Floats per slot of the simulation state */
export const PARTICLE_STATE_FLOATS = 8;

/**
 * Everything one simulation step needs, filled by the emitter each frame. Both backends read
 * the same values; the GPU one packs them into a uniform buffer.
 *
 * Simulation space is world space for world space emitters and the emitter's space otherwise.
 * @internal
 */
export class ParticleSimParams {
  /** Seconds to advance the particles already alive */
  dt = 0;
  /** Slots */
  capacity = 0;
  /** First serial of the window */
  windowStart = 0;
  /** Serials in the window, the last ones born this frame */
  count = 0;
  /** First serial born this frame */
  firstNew = 0;
  /** Births spread over the frame, the first ones of this frame; the rest are born at its end */
  numSpread = 0;
  /** See particleSeedHash */
  seedHash = 0;
  /** Whether particles live in world space */
  worldSpace = true;
  /** Draw the newest particle first */
  newestFirst = false;
  /** World matrix of the emitter at the end of the frame */
  readonly world = new Float64Array(16);
  /** How far the emitter moved in world space over the frame */
  readonly delta = new Float64Array(3);
  /** Velocity added at birth, simulation space */
  readonly inherit = new Float64Array(3);
  /** Acceleration, simulation space */
  readonly gravity = new Float64Array(3);
  /** Velocity of the air, simulation space */
  readonly air = new Float64Array(3);
  /** Rate the velocity approaches the air's at, 1/s */
  drag = 0;
  /** Scale of the emitter, applied to the sizes */
  sizeScale = 1;
  /** See PARTICLE_SHAPE_IDS */
  shapeType = 0;
  radius = 0;
  thickness = 1;
  angle = 0;
  arc = 0;
  /** Half size of the box */
  readonly boxHalf = new Float64Array(3);
  length = 0;
  randomizeDirection = 0;
  lifeMin = 1;
  lifeMax = 1;
  speedMin = 0;
  speedMax = 0;
  sizeMin = 0;
  sizeMax = 0;
  aspect = 1;
  rotationMin = 0;
  rotationMax = 0;
  angularMin = 0;
  angularMax = 0;
  readonly colorA = new Float64Array(4);
  readonly colorB = new Float64Array(4);
  /** Length added along the velocity per unit speed by stretched quads, 0 for none (bounds only) */
  stretchSpeed = 0;
  /** Length scale of stretched quads along the velocity, 0 when not stretched (bounds only) */
  stretchLength = 0;
}

/** Position (0..2) and direction (3..5) from the shape */
const shapeOut = new Float64Array(6);

/**
 * Samples where a particle is born and which way it goes, in the space of the emitter
 * @param p - Parameters
 * @param base - Base hash of the particle
 * @param out - Position (0..2), unit direction (3..5)
 */
function sampleShape(p: ParticleSimParams, base: number, out: Float64Array) {
  const u0 = particleRandom(base, ParticleChannel.Shape + 0);
  const u1 = particleRandom(base, ParticleChannel.Shape + 1);
  const u2 = particleRandom(base, ParticleChannel.Shape + 2);
  const thickness = p.thickness < 0 ? 0 : p.thickness > 1 ? 1 : p.thickness;
  const inner = 1 - thickness;
  let px = 0;
  let py = 0;
  let pz = 0;
  let dx = 0;
  let dy = 1;
  let dz = 0;
  switch (p.shapeType) {
    case PARTICLE_SHAPE_IDS.sphere:
    case PARTICLE_SHAPE_IDS.hemisphere: {
      // Even over the (half) sphere: the height is even, not the polar angle
      const y = p.shapeType === PARTICLE_SHAPE_IDS.sphere ? 1 - 2 * u0 : u0;
      const rxz = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = p.arc * u1;
      dx = rxz * Math.cos(phi);
      dy = y;
      dz = rxz * Math.sin(phi);
      // Even over the shell's volume
      const inner3 = inner * inner * inner;
      const r = p.radius * Math.cbrt(inner3 + u2 * (1 - inner3));
      px = dx * r;
      py = dy * r;
      pz = dz * r;
      break;
    }
    case PARTICLE_SHAPE_IDS.circle:
    case PARTICLE_SHAPE_IDS.cone: {
      const phi = p.arc * u0;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      // Even over the ring's area
      const inner2 = inner * inner;
      const q = Math.sqrt(inner2 + u1 * (1 - inner2));
      px = c * q * p.radius;
      pz = s * q * p.radius;
      if (p.shapeType === PARTICLE_SHAPE_IDS.circle) {
        dx = c;
        dy = 0;
        dz = s;
      } else {
        // Tilted outward the more the farther out, by the full angle at the rim
        const tilt = p.angle * q;
        const st = Math.sin(tilt);
        dx = c * st;
        dy = Math.cos(tilt);
        dz = s * st;
      }
      break;
    }
    case PARTICLE_SHAPE_IDS.box: {
      const hx = p.boxHalf[0];
      const hy = p.boxHalf[1];
      const hz = p.boxHalf[2];
      if (thickness >= 1) {
        px = (2 * u0 - 1) * hx;
        py = (2 * u1 - 1) * hy;
        pz = (2 * u2 - 1) * hz;
      } else {
        // A face by its area, a point on it, then inward by up to thickness of the half size
        const u3 = particleRandom(base, ParticleChannel.Shape + 3);
        const u4 = particleRandom(base, ParticleChannel.Shape + 4);
        const ax = hy * hz;
        const ay = hx * hz;
        const az = hx * hy;
        const pick = u0 * (ax + ay + az);
        const side = u3 < 0.5 ? -1 : 1;
        const depth = 1 - u4 * thickness;
        const a = 2 * u1 - 1;
        const b = 2 * u2 - 1;
        if (pick < ax) {
          px = side * hx * depth;
          py = a * hy;
          pz = b * hz;
        } else if (pick < ax + ay) {
          px = a * hx;
          py = side * hy * depth;
          pz = b * hz;
        } else {
          px = a * hx;
          py = b * hy;
          pz = side * hz * depth;
        }
      }
      break;
    }
    case PARTICLE_SHAPE_IDS.edge:
      px = (u0 - 0.5) * p.length;
      break;
  }
  if (
    p.shapeType === PARTICLE_SHAPE_IDS.point ||
    p.shapeType === PARTICLE_SHAPE_IDS.box ||
    p.shapeType === PARTICLE_SHAPE_IDS.edge
  ) {
    // Even over the cap of the angle around +Y
    const a = particleRandom(base, ParticleChannel.Shape + 5);
    const b = particleRandom(base, ParticleChannel.Shape + 6);
    const cosT = 1 - a * (1 - Math.cos(p.angle));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = 2 * Math.PI * b;
    dx = sinT * Math.cos(phi);
    dy = cosT;
    dz = sinT * Math.sin(phi);
  }
  if (p.randomizeDirection > 0) {
    const k = p.randomizeDirection > 1 ? 1 : p.randomizeDirection;
    const y = 1 - 2 * particleRandom(base, ParticleChannel.RandomDirection);
    const rxz = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = 2 * Math.PI * particleRandom(base, ParticleChannel.RandomDirection + 1);
    const rx = rxz * Math.cos(phi);
    const rz = rxz * Math.sin(phi);
    const mx = dx + (rx - dx) * k;
    const my = dy + (y - dy) * k;
    const mz = dz + (rz - dz) * k;
    const len = Math.hypot(mx, my, mz);
    if (len > 1e-6) {
      dx = mx / len;
      dy = my / len;
      dz = mz / len;
    } else {
      dx = rx;
      dy = y;
      dz = rz;
    }
  }
  out[0] = px;
  out[1] = py;
  out[2] = pz;
  out[3] = dx;
  out[4] = dy;
  out[5] = dz;
}

/**
 * The CPU simulation: the particle state in typed arrays, stepped in a loop that writes the
 * instance data of the live particles in drawing order. Dead particles are left out, so fewer
 * instances may be drawn than the window holds.
 * @internal
 */
export class CpuParticleSim {
  /** Slots */
  readonly capacity: number;
  /** Per slot: position, age, velocity, lifetime */
  private readonly _state: Float32Array<ArrayBuffer>;
  /** Instance data of the live particles, see ParticleEmitter for the layout */
  readonly instances: Float32Array<ArrayBuffer>;
  /** Live particles written to instances by the last step */
  numInstances: number;
  /** World bounds of the live particles by the last step, quads included */
  readonly boundsMin: Float64Array;
  readonly boundsMax: Float64Array;
  constructor(capacity: number) {
    this.capacity = capacity;
    this._state = new Float32Array(capacity * PARTICLE_STATE_FLOATS);
    this.instances = new Float32Array(capacity * PARTICLE_INSTANCE_FLOATS);
    this.numInstances = 0;
    this.boundsMin = new Float64Array(3);
    this.boundsMax = new Float64Array(3);
  }
  /**
   * Steps the window: births first, then the particles of earlier frames, then writes the live
   * ones to the instance data
   * @param p - Parameters
   * @param lut - Curves over the life
   * @param output - Whether to write the instance data and bounds (not while prewarming)
   */
  step(p: ParticleSimParams, lut: ParticleLUT, output: boolean) {
    const state = this._state;
    const inst = this.instances;
    const lutData = lut.data;
    const C = this.capacity;
    const dt = p.dt;
    const m = p.world;
    const gx = p.gravity[0];
    const gy = p.gravity[1];
    const gz = p.gravity[2];
    const ax = p.air[0];
    const ay = p.air[1];
    const az = p.air[2];
    const drag = p.drag > 0 ? p.drag : 0;
    const dragDt = Math.exp(-drag * dt);
    const worldSpace = p.worldSpace;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let n = 0;
    const count = p.count;
    for (let k = 0; k < count; k++) {
      const i = p.newestFirst ? count - 1 - k : k;
      const serial = p.windowStart + i;
      const o = (serial % C) * PARTICLE_STATE_FLOATS;
      const base = particleBaseHash(p.seedHash, serial);
      let stepDt = dt;
      let decay = dragDt;
      if (serial >= p.firstNew) {
        // Born this frame, at its share f of the frame; it lives the rest of it
        const b = serial - p.firstNew;
        const f = b < p.numSpread ? (b + 0.5) / p.numSpread : 1;
        sampleShape(p, base, shapeOut);
        const speed = p.speedMin + (p.speedMax - p.speedMin) * particleRandom(base, ParticleChannel.Speed);
        const lifetime = p.lifeMin + (p.lifeMax - p.lifeMin) * particleRandom(base, ParticleChannel.Lifetime);
        const sx = shapeOut[0];
        const sy = shapeOut[1];
        const sz = shapeOut[2];
        const dx = shapeOut[3] * speed;
        const dy = shapeOut[4] * speed;
        const dz = shapeOut[5] * speed;
        if (worldSpace) {
          // Where the emitter was at the time of birth: back along this frame's move
          const back = 1 - f;
          state[o + 0] = m[0] * sx + m[4] * sy + m[8] * sz + m[12] - p.delta[0] * back;
          state[o + 1] = m[1] * sx + m[5] * sy + m[9] * sz + m[13] - p.delta[1] * back;
          state[o + 2] = m[2] * sx + m[6] * sy + m[10] * sz + m[14] - p.delta[2] * back;
          state[o + 4] = m[0] * dx + m[4] * dy + m[8] * dz + p.inherit[0];
          state[o + 5] = m[1] * dx + m[5] * dy + m[9] * dz + p.inherit[1];
          state[o + 6] = m[2] * dx + m[6] * dy + m[10] * dz + p.inherit[2];
        } else {
          state[o + 0] = sx;
          state[o + 1] = sy;
          state[o + 2] = sz;
          state[o + 4] = dx;
          state[o + 5] = dy;
          state[o + 6] = dz;
        }
        state[o + 3] = 0;
        state[o + 7] = lifetime > 1e-3 ? lifetime : 1e-3;
        stepDt = (1 - f) * dt;
        decay = Math.exp(-drag * stepDt);
      }
      let age = state[o + 3];
      const life = state[o + 7];
      if (age >= life) {
        continue;
      }
      // Integrate: forces, then drag toward the air, then move
      let vx = state[o + 4] + gx * stepDt;
      let vy = state[o + 5] + gy * stepDt;
      let vz = state[o + 6] + gz * stepDt;
      vx = ax + (vx - ax) * decay;
      vy = ay + (vy - ay) * decay;
      vz = az + (vz - az) * decay;
      let px = state[o + 0] + vx * stepDt;
      let py = state[o + 1] + vy * stepDt;
      let pz = state[o + 2] + vz * stepDt;
      age += stepDt;
      state[o + 0] = px;
      state[o + 1] = py;
      state[o + 2] = pz;
      state[o + 3] = age;
      state[o + 4] = vx;
      state[o + 5] = vy;
      state[o + 6] = vz;
      if (age >= life || !output) {
        continue;
      }
      if (!worldSpace) {
        const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
        const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
        const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
        const ux = m[0] * vx + m[4] * vy + m[8] * vz;
        const uy = m[1] * vx + m[5] * vy + m[9] * vz;
        const uz = m[2] * vx + m[6] * vy + m[10] * vz;
        px = wx;
        py = wy;
        pz = wz;
        vx = ux;
        vy = uy;
        vz = uz;
      }
      // Curves over the life, linear between the samples
      const a = age / life;
      const x = a * (PARTICLE_LUT_SIZE - 1);
      const i0 = Math.floor(x);
      const i1 = i0 < PARTICLE_LUT_SIZE - 1 ? i0 + 1 : i0;
      const t = x - i0;
      const c0 = i0 * 4;
      const c1 = i1 * 4;
      const s0 = (PARTICLE_LUT_SIZE + i0) * 4;
      const s1 = (PARTICLE_LUT_SIZE + i1) * 4;
      const sizeFactor = lutData[s0] + (lutData[s1] - lutData[s0]) * t;
      const size =
        (p.sizeMin + (p.sizeMax - p.sizeMin) * particleRandom(base, ParticleChannel.Size)) *
        sizeFactor *
        p.sizeScale;
      const width = size * p.aspect;
      const rotation =
        p.rotationMin +
        (p.rotationMax - p.rotationMin) * particleRandom(base, ParticleChannel.Rotation) +
        (p.angularMin +
          (p.angularMax - p.angularMin) * particleRandom(base, ParticleChannel.AngularVelocity)) *
          age;
      const tc = particleRandom(base, ParticleChannel.Color);
      const q = n * PARTICLE_INSTANCE_FLOATS;
      inst[q + 0] = px;
      inst[q + 1] = py;
      inst[q + 2] = pz;
      inst[q + 3] = rotation;
      inst[q + 4] = width;
      inst[q + 5] = size;
      inst[q + 6] = a;
      inst[q + 7] = particleRandom(base, ParticleChannel.Material);
      for (let j = 0; j < 4; j++) {
        const start = p.colorA[j] + (p.colorB[j] - p.colorA[j]) * tc;
        inst[q + 8 + j] = start * (lutData[c0 + j] + (lutData[c1 + j] - lutData[c0 + j]) * t);
      }
      inst[q + 12] = vx;
      inst[q + 13] = vy;
      inst[q + 14] = vz;
      inst[q + 15] = 0;
      n++;
      // Reach of the quad from its center, turned any way
      let reach = 0.5 * Math.hypot(width, size);
      if (p.stretchLength > 0 || p.stretchSpeed > 0) {
        reach = Math.hypot(width, size * p.stretchLength + Math.hypot(vx, vy, vz) * p.stretchSpeed);
      }
      if (px - reach < minX) {
        minX = px - reach;
      }
      if (py - reach < minY) {
        minY = py - reach;
      }
      if (pz - reach < minZ) {
        minZ = pz - reach;
      }
      if (px + reach > maxX) {
        maxX = px + reach;
      }
      if (py + reach > maxY) {
        maxY = py + reach;
      }
      if (pz + reach > maxZ) {
        maxZ = pz + reach;
      }
    }
    if (output) {
      this.numInstances = n;
      this.boundsMin[0] = minX;
      this.boundsMin[1] = minY;
      this.boundsMin[2] = minZ;
      this.boundsMax[0] = maxX;
      this.boundsMax[1] = maxY;
      this.boundsMax[2] = maxZ;
    }
  }
}
