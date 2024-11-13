const primes = [15731, 789221, 1376312589];

function noise1(x: number): number {
  x = (x << 13) ^ x;
  return 1 - ((x * (x * x * primes[0] + primes[1]) + primes[2]) & 0x7fffffff) / 1073741824;
}

function noise2(x: number, y: number): number {
  let n = x + y * 57;
  n = (n << 13) ^ n;
  return 1 - ((n * (n * n * primes[0] + primes[1]) + primes[2]) & 0x7fffffff) / 1073741824;
}

function noise3(x: number, y: number, z: number): number {
  const l = x + y * 57;
  const m = y + z * 57;
  let n = l + m * 57;
  n = (n << 13) ^ n;
  return 1 - ((n * (n * n * primes[0] + primes[1]) + primes[2]) & 0x7fffffff) / 1073741824;
}

function interpolate(a: number, b: number, x: number): number {
  return a + (b - a) * x;
}

function smoothNoise1(x: number): number {
  return noise1(x) / 2 + noise1(x - 1) / 4 + noise1(x + 1) / 4;
}

function smoothNoise2(x: number, y: number): number {
  const corners =
    (noise2(x - 1, y - 1) + noise2(x + 1, y - 1) + noise2(x - 1, y + 1) + noise2(x + 1, y + 1)) / 16;
  const sides = (noise2(x - 1, y) + noise2(x + 1, y) + noise2(x, y - 1) + noise2(x, y + 1)) / 8;
  const center = noise2(x, y) / 4;
  return corners + sides + center;
}

function smoothNoise3(x: number, y: number, z: number): number {
  let corners: number, sides: number, center: number;
  corners =
    (noise3(x - 1, y - 1, z - 1) +
      noise3(x + 1, y - 1, z - 1) +
      noise3(x - 1, y + 1, z - 1) +
      noise3(x + 1, y + 1, z - 1)) /
    16;
  sides =
    (noise3(x - 1, y, z - 1) + noise3(x + 1, y, z - 1) + noise3(x, y - 1, z - 1) + noise3(x, y + 1, z - 1)) /
    8;
  center = noise3(x, y, z - 1) / 4;
  const zm1 = corners + sides + center;
  corners =
    (noise3(x - 1, y - 1, z) + noise3(x + 1, y - 1, z) + noise3(x - 1, y + 1, z) + noise3(x + 1, y + 1, z)) /
    16;
  sides = (noise3(x - 1, y, z) + noise3(x + 1, y, z) + noise3(x, y - 1, z) + noise3(x, y + 1, z)) / 8;
  center = noise3(x, y, z) / 4;
  const zo = corners + sides + center;
  corners =
    (noise3(x - 1, y - 1, z + 1) +
      noise3(x + 1, y - 1, z + 1) +
      noise3(x - 1, y + 1, z + 1) +
      noise3(x + 1, y + 1, z + 1)) /
    16;
  sides =
    (noise3(x - 1, y, z + 1) + noise3(x + 1, y, z + 1) + noise3(x, y - 1, z + 1) + noise3(x, y + 1, z + 1)) /
    8;
  center = noise3(x, y, z + 1) / 4;
  const zp1 = corners + sides + center;
  return zm1 / 4 + zo / 2 + zp1 / 4;
}

function interpolateNoise1(x: number): number {
  const ix = Math.floor(x);
  const fract = x - ix;
  const v1 = smoothNoise1(ix);
  const v2 = smoothNoise1(ix + 1);
  return interpolate(v1, v2, fract);
}

function interpolateNoise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const fractX = x - ix;
  const iy = Math.floor(y);
  const fractY = y - iy;
  const v1 = smoothNoise2(ix, iy);
  const v2 = smoothNoise2(ix + 1, iy);
  const v3 = smoothNoise2(ix, iy + 1);
  const v4 = smoothNoise2(ix + 1, iy + 1);
  const i1 = interpolate(v1, v2, fractX);
  const i2 = interpolate(v3, v4, fractX);
  return interpolate(i1, i2, fractY);
}

function interpolateNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const fractX = x - ix;
  const iy = Math.floor(y);
  const fractY = y - iy;
  const iz = Math.floor(z);
  const fractZ = z - iz;
  const v1 = smoothNoise3(ix, iy, iz);
  const v2 = smoothNoise3(ix + 1, iy, iz);
  const v3 = smoothNoise3(ix, iy + 1, iz);
  const v4 = smoothNoise3(ix + 1, iy + 1, iz);
  const v5 = smoothNoise3(ix, iy, iz + 1);
  const v6 = smoothNoise3(ix + 1, iy, iz + 1);
  const v7 = smoothNoise3(ix, iy + 1, iz + 1);
  const v8 = smoothNoise3(ix + 1, iy + 1, iz + 1);
  const i1 = interpolate(v1, v2, fractX);
  const i2 = interpolate(v3, v4, fractX);
  const i3 = interpolate(v5, v6, fractX);
  const i4 = interpolate(v7, v8, fractX);
  const i5 = interpolate(i1, i2, fractY);
  const i6 = interpolate(i3, i4, fractY);
  return interpolate(i5, i6, fractZ);
}

/** @internal */
export function perlinNoise1D(x: number, amp: number, freq: number): number {
  return interpolateNoise1(x * freq) * amp;
}

/** @internal */
export function perlinNoise2D(x: number, y: number, amp: number, freqX: number, freqY: number): number {
  return interpolateNoise2(x * freqX, y * freqY) * amp;
}

/** @internal */
export function perlinNoise3D(
  x: number,
  y: number,
  z: number,
  amp: number,
  freqX: number,
  freqY: number,
  freqZ: number
) {
  return interpolateNoise3(x * freqX, y * freqY, z * freqZ) * amp;
}

export function halton23(length: number): [number, number][] {
  function halton(base: number, index: number) {
    let result = 0;
    let f = 1;
    while (index > 0) {
      f /= base;
      result += f * (index % base);
      index = Math.floor(index / base);
    }
    return result;
  }
  const jitters: [number, number][] = [];
  for (let i = 1; i <= length; i++) {
    jitters.push([(halton(2, i) - 0.5) * 2, (halton(3, i) - 0.5) * 2]);
  }
  return jitters;
}
