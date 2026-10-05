/**
 * URL of the Rapier WebAssembly module, beside this module in `dist`.
 *
 * @remarks
 * Kept in its own module because `import.meta` does not compile in the
 * CommonJS test build, which stubs this file out.
 *
 * @internal
 */
export const RAPIER_WASM_URL = new URL(/* @vite-ignore */ './rapier/rapier_wasm3d_bg.wasm', import.meta.url)
  .href;
