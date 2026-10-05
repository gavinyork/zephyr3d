import { loadRapier, type RapierAPI } from './rapier_loader';
import { RAPIER_WASM_URL } from './rapier_location';
import { registerSceneNodeComponentType } from '@zephyr3d/scene';
import { RigidBody } from './rigid_body';
import { Collider } from './collider';
import { Joint } from './joint';
import { CharacterController } from './character';
import { isPhysicsReady, setRapier } from './rapier_state';

/** Options of {@link initPhysics}. @public */
export interface PhysicsInitOptions {
  /**
   * URL of `rapier_wasm3d_bg.wasm`. Defaults to the copy shipped beside this
   * package's modules.
   */
  wasmUrl?: string;
  /**
   * An already initialized Rapier module (`@dimforge/rapier3d-simd` or a
   * compatible build). When given, nothing is fetched. Used by tests and by
   * applications that load Rapier themselves.
   */
  rapier?: unknown;
}

let loading: Promise<void> | null = null;

/**
 * Loads the physics engine. Must complete before a {@link PhysicsWorld} steps.
 *
 * @remarks
 * Safe to call more than once; later calls wait for the first. Also registers
 * the physics components with the scene, so the editor and scene loading know
 * them.
 *
 * @public
 */
export function initPhysics(options?: PhysicsInitOptions): Promise<void> {
  if (isPhysicsReady()) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = (async () => {
      registerSceneNodeComponentType(RigidBody);
      registerSceneNodeComponentType(Collider);
      registerSceneNodeComponentType(Joint);
      registerSceneNodeComponentType(CharacterController);
      if (options?.rapier) {
        setRapier(options.rapier as RapierAPI);
      } else {
        setRapier(await loadRapier(options?.wasmUrl ?? RAPIER_WASM_URL));
      }
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}
