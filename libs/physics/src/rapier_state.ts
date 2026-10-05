import type { RapierAPI } from './rapier_loader';

// The loaded Rapier module, kept apart from init.ts so that the world can read
// it without importing the components that init.ts registers.
let rapier: RapierAPI | null = null;

/** @internal */
export function setRapier(module: RapierAPI) {
  rapier = module;
}

/** Whether {@link initPhysics} has completed. @public */
export function isPhysicsReady() {
  return !!rapier;
}

/** @internal */
export function getRapier(): RapierAPI {
  if (!rapier) {
    throw new Error('Physics is not initialized; await initPhysics() first');
  }
  return rapier;
}
