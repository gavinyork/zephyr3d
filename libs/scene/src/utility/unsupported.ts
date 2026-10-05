const warned = new Set<string>();

/**
 * Warns, once per feature, that a feature the scene asked for does not run on
 * the current backend.
 *
 * Used wherever such a feature degrades instead of failing, so that what is on
 * screen never differs from WebGPU without the console saying why. Features
 * whose fallback renders the same image - only computed elsewhere, or more
 * slowly - do not warn; they are listed in the backend support documentation.
 *
 * @param feature - What was asked for, e.g. `A-buffer OIT (Camera.oitMode 'abuffer')`.
 * @param requirement - What it needs, e.g. `WebGPU`.
 * @param consequence - What happens instead, e.g. `falling back to sorted alpha blending`.
 *
 * @internal
 */
export function warnUnsupported(feature: string, requirement: string, consequence: string) {
  if (!warned.has(feature)) {
    warned.add(feature);
    console.warn(`[zephyr3d] ${feature} requires ${requirement}; ${consequence}.`);
  }
}
