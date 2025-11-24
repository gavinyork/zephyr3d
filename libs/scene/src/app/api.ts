import type { AbstractDevice } from '@zephyr3d/device';
import type { Application } from './app';
import type { Engine } from './engine';
import type { InputManager } from '.';

/** @internal */
export let appInstance: Application;

/** @internal */
export function setApp(app: Application) {
  appInstance = app;
}

/**
 * Singleton accessor for the current Application instance.
 *
 * @returns The Application singleton.
 *
 * @public
 */

export function getApp(): Application {
  return appInstance;
}

/**
 * Singleton accessor for the current engine instance.
 *
 * @returns The engine singleton.
 *
 * @public
 */
export function getEngine(): Engine {
  return appInstance?.engine ?? null;
}

/**
 * Singleton accessor for the device instance.
 *
 * @returns The device singleton.
 *
 * @public
 */
export function getDevice(): AbstractDevice {
  return appInstance?.device ?? null;
}

/**
 * Singleton accessor for the input manager instance.
 *
 * @returns The input manager singleton.
 *
 * @public
 */

export function getInput(): InputManager {
  return appInstance?.inputManager ?? null;
}
