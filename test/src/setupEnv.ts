/**
 * Jest setupFiles entry: selects the engine depth convention before any
 * engine module is imported. Runs prior to the test framework and to module
 * evaluation, so the module-load-time REVERSE_Z constant reliably observes
 * the injected value.
 *
 * Select with the Z_CONVENTION environment variable:
 *   Z_CONVENTION=standard -> standard-Z
 *   anything else / unset  -> reverse-Z
 */
const zConvention = process.env.Z_CONVENTION;
(globalThis as Record<string, unknown>).__ZEPHYR3D_REVERSE_Z__ = zConvention !== 'standard';
