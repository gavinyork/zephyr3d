import { RAPIER, glue } from './rapier_bundle';

/** The Rapier API, as exported by `@dimforge/rapier3d-simd`. @internal */
export type RapierAPI = typeof RAPIER;

/**
 * Fetches and instantiates the Rapier WebAssembly module.
 *
 * @internal
 */
export async function loadRapier(url: string): Promise<RapierAPI> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load the Rapier physics module from ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A missing file often comes back as an HTML page from a single-page-app
  // fallback route, which would otherwise fail with an opaque compile error.
  if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`${url} is not a WebAssembly module; check where the physics module is served from`);
  }
  const { instance } = await WebAssembly.instantiate(bytes, {
    './rapier_wasm3d_bg.js': glue as unknown as WebAssembly.ModuleImports
  });
  glue.__wbg_set_wasm(instance.exports);
  return RAPIER;
}
