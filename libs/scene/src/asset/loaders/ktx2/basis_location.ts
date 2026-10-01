/**
 * Default location of the bundled Basis transcoder: the `basis` directory next to
 * this module. The build copies the transcoder there. Vite and webpack 5 emit it
 * automatically from the `new URL(..., import.meta.url)` pattern; with plain Rollup
 * or esbuild, copy the directory beside the bundle or set KTX2Loader.transcoderPath.
 *
 * Kept in its own module because `import.meta` does not exist in the CommonJS
 * build the unit tests run against; the test config maps this file to a stub.
 *
 * @internal
 */
export function defaultBasisTranscoderPath() {
  return new URL('./basis/', import.meta.url).href;
}
