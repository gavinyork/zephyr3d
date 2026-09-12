/**
 * Dependency-free procedural mesh generator.
 *
 * Takes a declarative {@link GeneratedModelSpec} (primitives, surfaces of
 * revolution, Bezier patches, swept curves, CSG booleans and sandboxed script
 * nodes) and tessellates it into plain vertex/index buffers. Nothing here
 * touches a graphics device, so it runs in a worker, in the browser, or under
 * node for tests.
 *
 * The worker entry lives in `./worker` and is intentionally not re-exported —
 * importing it has the side effect of installing an `onmessage` handler.
 *
 * @packageDocumentation
 */
export * from './generator';
export * from './normalize';
