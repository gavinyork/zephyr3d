/**
 * Procedural scene generation for zephyr3d.
 *
 * The library emits declarative procedural model specs rather than meshes, so it
 * never needs a graphics device and can run in a worker, in the editor, or under
 * node for tests. Pair it with `@zephyr3d/modelgen` to tessellate the result.
 *
 * Layers, from the bottom up:
 *
 * - {@link Scope} and its operations — an oriented box plus split / repeat /
 *   face / extrude, the vocabulary a shape grammar is written in.
 * - {@link Ruleset} and {@link runGrammar} — the derivation engine. A style is
 *   data, not engine code, so new architectural styles are additive.
 * - {@link generateBuilding} — the convenience entry point.
 *
 * @packageDocumentation
 */
export * from './scope';
export * from './emit';
export * from './random';
export * from './grammar';
export * from './building';
export * from './wfc/model';
export * from './wfc/solve';
export * from './layout/city-block';
export * from './styles/modern-office';
