/**
 * Pseudorandom number generator
 * @public
 */
export class PRNG {
  /** @internal */
  private readonly _generator: () => number;
  /**
   * Creates an instance of PRNG
   * @param seed - The random seed
   */
  constructor(seed = 0) {
    // mulberry32 algorithm
    this._generator = () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Gets next random value between 0 and 1 */
  get() {
    return this._generator();
  }
}
