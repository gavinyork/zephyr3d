/**
 * Integer hash random numbers of the particle emitter.
 *
 * Every random attribute of a particle is a pure function of the emitter seed, the particle's
 * birth serial and the attribute's channel, computed in 32 bit unsigned integers. The JS code
 * here (Math.imul and \>\>\> 0) and the WGSL of the GPU simulation give the same bits, so a
 * particle gets the same attributes on either backend.
 */

/** Multiplier spreading the channels of a particle over the hash domain (2^32 / golden ratio) */
const CHANNEL_STEP = 0x9e3779b9;

/** 1 / 2^24: the top 24 bits of a hash as a float in [0, 1), exact in f32 */
const INV_2_24 = 1 / 16777216;

/**
 * Hashes a 32 bit unsigned integer (lowbias32 by Chris Wellons)
 * @param x - Integer in [0, 2^32)
 * @returns Hash in [0, 2^32)
 * @internal
 */
export function particleHash(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Hash of the emitter seed, mixed into every particle's base hash
 * @param seed - Emitter seed
 * @internal
 */
export function particleSeedHash(seed: number): number {
  return particleHash(seed >>> 0);
}

/**
 * Base hash of a particle, from which its channels are drawn
 * @param seedHash - See particleSeedHash
 * @param serial - Birth serial of the particle; only its low 32 bits count
 * @internal
 */
export function particleBaseHash(seedHash: number, serial: number): number {
  return particleHash((serial ^ seedHash) >>> 0);
}

/**
 * A random number of a particle
 * @param base - Base hash of the particle
 * @param channel - Which attribute
 * @returns Number in [0, 1)
 * @internal
 */
export function particleRandom(base: number, channel: number): number {
  return (particleHash((base + Math.imul(channel + 1, CHANNEL_STEP)) >>> 0) >>> 8) * INV_2_24;
}

/**
 * Channels of the random numbers of a particle. The GPU simulation uses the same numbers.
 * @internal
 */
export const ParticleChannel = {
  Lifetime: 0,
  Speed: 1,
  Size: 2,
  Rotation: 3,
  AngularVelocity: 4,
  Color: 5,
  /** Handed to the material, e.g. for a random flipbook frame */
  Material: 6,
  /** Seven numbers for the emitter shape */
  Shape: 7,
  /** Two numbers for randomizeDirection */
  RandomDirection: 14
} as const;
