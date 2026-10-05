// Jest runs the engine sources as CommonJS, where `import.meta` does not exist.
// Stands in for libs/physics/src/rapier_location.ts; tests inject Rapier instead.
export const RAPIER_WASM_URL = 'http://localhost/rapier/rapier_wasm3d_bg.wasm';
