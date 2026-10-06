import { setPhysicsWorldFactory } from '@zephyr3d/scene';
import type { PhysicsBackend } from './backend';
import { PhysicsSimulation } from './simulation';

let current: PhysicsBackend | null = null;
let loading: { engine: PhysicsBackend; promise: Promise<void> } | null = null;

/**
 * Loads a physics engine and makes it simulate scenes: from then on, every
 * scene gets a {@link PhysicsSimulation} as its `physicsWorld` the first time it
 * needs one.
 *
 * @remarks
 * Without it, physics data on nodes is kept, edited, saved and loaded, but not
 * simulated. Safe to call more than once; later calls with the same engine wait
 * for the first. Scenes that already have a world keep it.
 *
 * ```ts
 * import { initPhysics } from '@zephyr3d/physics';
 * import { rapierPhysics } from '@zephyr3d/physics-rapier';
 *
 * await initPhysics(rapierPhysics);
 * ```
 *
 * @param engine - The physics engine, from an engine package.
 * @param options - Options of the engine's loading, such as where its
 *   WebAssembly module is.
 *
 * @public
 */
export function initPhysics<O>(engine: PhysicsBackend<O>, options?: O): Promise<void> {
  if (current === engine && engine.ready) {
    return Promise.resolve();
  }
  if (loading?.engine !== engine) {
    const promise = engine
      .init(options)
      .then(() => {
        current = engine;
        setPhysicsWorldFactory((scene) => new PhysicsSimulation(scene, engine));
      })
      .catch((err) => {
        if (loading?.promise === promise) {
          loading = null;
        }
        throw err;
      });
    loading = { engine, promise };
  }
  return loading!.promise;
}

/**
 * The physics engine {@link initPhysics} loaded, or null.
 *
 * @public
 */
export function getPhysicsEngine(): PhysicsBackend | null {
  return current;
}
