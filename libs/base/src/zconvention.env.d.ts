/**
 * Ambient declaration for the build-time depth convention define.
 *
 * Application bundlers may replace the bare identifier `__ZEPHYR3D_REVERSE_Z__`
 * with a boolean literal (e.g. rollup `@rollup/plugin-replace` or Vite/esbuild
 * `define`) to select the depth convention at build time and let the minifier
 * eliminate the unused code path.
 *
 * This hand-written declaration file only participates in type checking of
 * this package; it is not re-emitted into the published type declarations.
 */
declare const __ZEPHYR3D_REVERSE_Z__: boolean | undefined;
