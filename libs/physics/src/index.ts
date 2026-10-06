/**
 * Rigid-body physics for zephyr3d: simulates the physics data on scene nodes
 * (`node.physics`) with a physics engine loaded from an engine package, such
 * as `@zephyr3d/physics-rapier`.
 *
 * @packageDocumentation
 */
export { initPhysics, getPhysicsEngine } from './init';
export { PhysicsSimulation } from './simulation';
export type * from './backend';
