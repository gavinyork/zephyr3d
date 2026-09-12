import { PRNG } from '@zephyr3d/base';

/**
 * Seeded random helpers used by rulesets.
 *
 * Everything a ruleset does must go through this, never `Math.random`: a demo
 * scene has to regenerate identically from the same seed.
 *
 * @public
 */
export class Random {
  private readonly _prng: PRNG;

  /**
   * @param seed - Seed value. The same seed always yields the same sequence.
   */
  constructor(seed = 0) {
    this._prng = new PRNG(seed);
  }

  /** Next value in `[0, 1)`. */
  next(): number {
    return this._prng.get();
  }

  /** Uniform value in `[min, max)`. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in `[min, max]`, inclusive on both ends. */
  int(min: number, max: number): number {
    if (max < min) {
      return min;
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly picks one item. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Random.pick requires a non-empty array');
    }
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }

  /**
   * Picks one item with probability proportional to its weight.
   *
   * Non-positive weights are treated as zero; if every weight is zero the first
   * entry is returned so a mis-tuned weight table degrades instead of throwing.
   */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    if (items.length === 0) {
      throw new Error('Random.weighted requires a non-empty array');
    }
    const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (total <= 0) {
      return items[0].value;
    }
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, item.weight);
      if (roll <= 0) {
        return item.value;
      }
    }
    return items[items.length - 1].value;
  }
}
