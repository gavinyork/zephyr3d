import type { PhysicsBackend } from '@zephyr3d/physics';
import { loadRapier, type RapierAPI } from './rapier_loader';
import { RAPIER_WASM_URL } from './rapier_location';
import { RapierWorld } from './rapier_world';

/**
 * Options of loading Rapier: `initPhysics(rapierPhysics, options)`.
 *
 * @public
 */
export interface RapierPhysicsOptions {
  /**
   * URL of `rapier_wasm3d_bg.wasm`. Defaults to the copy shipped beside this
   * package's modules, in `dist/rapier`.
   */
  wasmUrl?: string;
  /**
   * An already initialized Rapier module (`@dimforge/rapier3d-simd` or a
   * compatible build). When given, nothing is fetched. Used by tests and by
   * applications that load Rapier themselves.
   */
  rapier?: unknown;
}

let rapier: RapierAPI | null = null;
let loading: Promise<void> | null = null;

/**
 * The Rapier physics engine (`@dimforge/rapier3d-simd`), for
 * `initPhysics` of `@zephyr3d/physics`:
 *
 * ```ts
 * import { initPhysics } from '@zephyr3d/physics';
 * import { rapierPhysics } from '@zephyr3d/physics-rapier';
 *
 * await initPhysics(rapierPhysics);
 * ```
 *
 * @remarks
 * Loads Rapier's WebAssembly module (about 1.1 MB compressed) from beside this
 * package's modules, unless {@link RapierPhysicsOptions} say otherwise.
 *
 * @public
 */
export const rapierPhysics: PhysicsBackend<RapierPhysicsOptions> = {
  name: 'Rapier',
  get ready() {
    return !!rapier;
  },
  init(options?: RapierPhysicsOptions) {
    if (rapier) {
      return Promise.resolve();
    }
    if (!loading) {
      loading = (async () => {
        rapier = options?.rapier
          ? (options.rapier as RapierAPI)
          : await loadRapier(options?.wasmUrl ?? RAPIER_WASM_URL);
      })().catch((err) => {
        loading = null;
        throw err;
      });
    }
    return loading;
  },
  createWorld() {
    if (!rapier) {
      throw new Error('Rapier is not loaded; await initPhysics(rapierPhysics) first');
    }
    return new RapierWorld(rapier);
  }
};
