// Stands in for the wasm-bindgen glue of @dimforge/rapier3d-simd, which jest
// cannot load; tests inject the compat build through initPhysics({ rapier }).
export function __wbg_set_wasm() {
  throw new Error('Rapier glue is not available in tests; pass initPhysics({ rapier })');
}
