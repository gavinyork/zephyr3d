import { loadRapier, type RapierAPI } from './rapier_loader';
import { RAPIER_WASM_URL } from './rapier_location';
import { registerSceneNodeComponentType, tryGetApp, type ResourceManager } from '@zephyr3d/scene';
import { RigidBody } from './rigid_body';
import { Collider } from './collider';
import { Joint } from './joint';
import { CharacterController } from './character';
import { isPhysicsReady, setRapier } from './rapier_state';
import { registerPhysicsSerializableClasses } from './serialization';

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
  /**
   * Serialization manager to register the physics components with; see
   * {@link registerPhysics}. Defaults to the running application's.
   */
  manager?: ResourceManager;
}

const registeredManagers = new WeakSet<ResourceManager>();

/**
 * Makes the physics components known to the scene and to a serialization
 * manager, so scenes containing them can be loaded, saved and edited.
 *
 * @remarks
 * Does not load the physics engine: components can be created, edited and
 * saved, but nothing is simulated until {@link initPhysics} completes.
 * Synchronous and safe to call more than once. {@link initPhysics} calls it
 * too.
 *
 * @param manager - The serialization manager. Defaults to the running
 *   application's; without one, only the component types are registered.
 *
 * @public
 */
export function registerPhysics(manager?: ResourceManager) {
  registerSceneNodeComponentType(RigidBody);
  registerSceneNodeComponentType(Collider);
  registerSceneNodeComponentType(Joint);
  registerSceneNodeComponentType(CharacterController);
  const target = manager ?? tryGetApp()?.engine?.resourceManager;
  if (target && !registeredManagers.has(target)) {
    registeredManagers.add(target);
    registerPhysicsSerializableClasses(target);
  }
}

let loading: Promise<void> | null = null;

/**
 * Loads the physics engine. Must complete before a {@link PhysicsWorld} steps.
 *
 * @remarks
 * Safe to call more than once; later calls wait for the first. Also calls
 * {@link registerPhysics}, so call it before loading scenes that contain
 * physics components.
 *
 * @public
 */
export function initPhysics(options?: PhysicsInitOptions): Promise<void> {
  registerPhysics(options?.manager);
  if (isPhysicsReady()) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = (async () => {
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
