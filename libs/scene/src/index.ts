/**
 * A modern, modular 3D rendering framework built on top of the `@zephyr3d/device` API.
 *
 * @remarks
 * This package provides a complete, extensible rendering stack targeting WebGPU/WebGL backends
 * through `@zephyr3d/device`. It offers scene graph management, materials and shaders, forward-plus
 * style lighting passes, shadow mapping, post-processing, GPU picking, animation, and a robust app/runtime
 * layer to orchestrate rendering and resource lifecycles.
 *
 * @packageDocumentation
 */

export * from './utility';
export * from './shapes';
export * from './render';
export * from './material';
export * from './render';
export * from './scene';
export * from './animation';
export * from './camera';
export * from './shaders';
export * from './shadow';
export * from './asset';
export * from './blitter';
export * from './values';
export * from './shaders';
export * from './posteffect';
export * from './app';
