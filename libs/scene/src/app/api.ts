import type { Nullable } from '@zephyr3d/base';
import type { Application } from './app';

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
export function getApp() {
  return appInstance;
}

/**
 * Singleton accessor for the current Application instance.
 *
 * @returns The Application singleton.
 *
 * @public
 */
export function tryGetApp(): Nullable<Application> {
  return appInstance ?? null;
}

/**
 * Singleton accessor for the current engine instance.
 *
 * @returns The engine singleton.
 *
 * @public
 */
export function getEngine() {
  return appInstance!.engine!;
}

/**
 * Singleton accessor for the device instance.
 *
 * @returns The device singleton.
 *
 * @public
 */
export function getDevice() {
  return appInstance!.device!;
}

/**
 * Singleton accessor for the input manager instance.
 *
 * @returns The input manager singleton.
 *
 * @public
 */

export function getInput() {
  return appInstance!.inputManager!;
}
