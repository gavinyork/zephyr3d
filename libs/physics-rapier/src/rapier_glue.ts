// Types for the wasm-bindgen glue of @dimforge/rapier3d-simd, which ships none.
// Kept as a script (no imports or exports) so the declaration is global.
declare module '@dimforge/rapier3d-simd/rapier_wasm3d_bg.js' {
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
