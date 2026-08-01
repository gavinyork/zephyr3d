/**
 * Jest setupFiles entry: selects the engine depth convention before any
 * engine module is imported. Runs prior to the test framework and to module
 * evaluation, so the module-load-time REVERSE_Z constant reliably observes
 * the injected value.
 *
 * Select with the Z_CONVENTION environment variable:
 *   Z_CONVENTION=reverse  -> reverse-Z
 *   anything else / unset -> standard-Z
 */
(globalThis as Record<string, unknown>).__ZEPHYR3D_REVERSE_Z__ = process.env.Z_CONVENTION === 'reverse';
