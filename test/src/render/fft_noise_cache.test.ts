/**
 * The FFT wave generator's noise texture cache is shared across every generator
 * in the process, so its key has to name everything that selects the contents.
 *
 * It once named only the resolution. Two oceans seeded differently then came out
 * identical, with the winning seed decided by which one was constructed first -
 * a failure that leaves no error behind and that no rendering test would call
 * out, because both oceans still look like plausible oceans.
 *
 * The texture itself needs a device, so what is pinned here is the pair the
 * cache is keyed on and the seed-to-bytes mapping underneath it.
 */

import { PRNG } from '../../../libs/base/src/prng';

/** The keying rule from FFTWaveGenerator.getNoiseTexture. */
function noiseCacheKey(size: number, randomSeed: number): string {
  return `${size}:${randomSeed}`;
}

/** The generator's own noise fill, which the cache is standing in front of. */
function noise2d(size: number, randomSeed: number, rgba: boolean): Float32Array {
  const rand = new PRNG(randomSeed);
  if (rgba) {
    const array = new Float32Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      array[i * 4 + 0] = rand.get();
      array[i * 4 + 1] = rand.get();
    }
    return array;
  }
  return Float32Array.from([...Array(size * size * 2)].map(() => rand.get()));
}

describe('FFT noise texture cache key', () => {
  test('separates seeds at the same resolution', () => {
    expect(noiseCacheKey(256, 0)).not.toBe(noiseCacheKey(256, 1));
  });

  test('separates resolutions at the same seed', () => {
    expect(noiseCacheKey(256, 7)).not.toBe(noiseCacheKey(512, 7));
  });

  test('reuses one entry for the same size and seed', () => {
    expect(noiseCacheKey(256, 7)).toBe(noiseCacheKey(256, 7));
  });

  test('no two keys in a mixed set collide', () => {
    const keys = new Set<string>();
    for (const size of [128, 256, 512]) {
      for (const seed of [0, 1, 42]) {
        keys.add(noiseCacheKey(size, seed));
      }
    }
    expect(keys.size).toBe(9);
  });
});

describe('FFT noise contents', () => {
  test('differ between seeds', () => {
    const a = noise2d(16, 0, false);
    const b = noise2d(16, 1, false);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test('are reproducible for one seed', () => {
    expect(Array.from(noise2d(16, 5, false))).toEqual(Array.from(noise2d(16, 5, false)));
  });

  test('fill the layout each backend expects', () => {
    // WebGL takes rgba32f and uses rg; everything else takes rg32f.
    const rgba = noise2d(8, 3, true);
    const rg = noise2d(8, 3, false);
    expect(rgba.length).toBe(8 * 8 * 4);
    expect(rg.length).toBe(8 * 8 * 2);
    // Same stream either way, so a scene does not change appearance with the
    // backend: the first two of each rgba texel are the first two of rg.
    expect(rgba[0]).toBe(rg[0]);
    expect(rgba[1]).toBe(rg[1]);
    expect(rgba[4]).toBe(rg[2]);
    // The unused channels stay zero rather than consuming the stream.
    expect(rgba[2]).toBe(0);
    expect(rgba[3]).toBe(0);
  });
});
