// Jest runs as CommonJS and cannot load meshoptimizer's ESM-only simplifier, which has no
// CommonJS twin. Tests pass their own simplifier where they generate levels of detail.

export const MeshoptSimplifier = {
  ready: Promise.resolve(),
  simplify() {
    throw new Error('meshoptimizer simplifier is not available in tests, pass a simplifier');
  },
  simplifyWithAttributes() {
    throw new Error('meshoptimizer simplifier is not available in tests, pass a simplifier');
  }
};
