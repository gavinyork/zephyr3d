// The whole of Rapier, behind one module. The build bundles this file on its own
// into dist/rapier/rapier.js (see rollup.config.mjs), so Rapier's internal
// circular imports stay inside one file instead of reaching consumers' bundlers.
export * as RAPIER from '@dimforge/rapier3d-simd';
// The wasm-bindgen glue, which the WebAssembly module imports.
export * as glue from '@dimforge/rapier3d-simd/rapier_wasm3d_bg.js';
