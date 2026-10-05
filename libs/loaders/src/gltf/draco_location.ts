/**
 * Default location of the bundled Draco decoder: the `draco` directory next to
 * this module, where the build copies it.
 *
 * Kept in its own module because `import.meta` does not exist in the CommonJS
 * build the unit tests run against; the test config maps this file to a stub.
 *
 * @internal
 */
export function defaultDracoDecoderPath() {
  // Directories can not be emitted by bundlers: keep Vite from warning at build time
  return new URL(/* @vite-ignore */ './draco/', import.meta.url).href;
}
