// spcr-joint-dynamics — math adapter layer
// Wraps base/vector.ts (class-based) with plain-object API for backward compatibility

// ── Utility ──

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothStep(from: number, to: number, t: number): number {
  const c = clamp01((t - from) / (to - from));
  return c * c * (3 - 2 * c);
}
