/**
 * Default location of the bundled Basis transcoder: the `basis` directory next to
 * this module. The build copies the transcoder there. Bundlers can not emit a
 * directory from the `new URL(..., import.meta.url)` pattern, so copy it beside the
 * bundle or set KTX2Loader.transcoderPath. The @vite-ignore comment has to sit inside
 * the call, before the string, for Vite to skip its build time lookup warning.
 *
 * Kept in its own module because `import.meta` does not exist in the CommonJS
 * build the unit tests run against; the test config maps this file to a stub.
 *
 * @internal
 */
export function defaultBasisTranscoderPath() {
  return new URL(/* @vite-ignore */ './basis/', import.meta.url).href;
}
