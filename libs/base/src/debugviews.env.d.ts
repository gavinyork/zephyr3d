/**
 * Ambient declaration for the build-time debug views define.
 *
 * Application bundlers may replace the bare identifier `__ZEPHYR3D_DEBUG_VIEWS__`
 * with a boolean literal (e.g. rollup `@rollup/plugin-replace` or Vite/esbuild
 * `define`) to select whether debug views are available at build time and let the
 * minifier eliminate their code when they are not.
 *
 * This hand-written declaration file only participates in type checking of
 * this package; it is not re-emitted into the published type declarations.
 */
declare const __ZEPHYR3D_DEBUG_VIEWS__: boolean | undefined;
