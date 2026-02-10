// Common test utilities

export function numberEquals(x: number, y: number, epsl?: number) {
  const e = epsl ?? 0.0001 * Math.max(1, Math.abs(x), Math.abs(y));
  return Math.abs(x - y) <= e;
}

export function rand(minval = -10, maxval = 10): number {
  return Math.random() * (maxval - minval) + minval;
}

export function randInt(minval = -999999, maxval = 999999) {
  return Math.floor(Math.random() * (maxval - minval + 1) + minval);
}

export function randNonZero(minval = -10, maxval = 10) {
  for (;;) {
    const r = rand(minval, maxval);
    if (Math.abs(r) > Number.EPSILON) {
      return r;
    }
  }
}
