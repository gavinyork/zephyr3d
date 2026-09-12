import type { GeneratedModelSpec } from './generator';

/**
 * JSON value accepted by {@link normalizeGeneratedModelSpec}.
 * @public
 */
export type JsonInput = null | boolean | number | string | JsonInput[] | { [key: string]: JsonInput };

function toCamelCase(value: string): string {
  return String(value).replace(/[_-]([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}

// Enum values that differ between the snake_case wire format and the camelCase
// form the tessellator expects. Keys are already camel-cased when consulted.
const ENUM_ALIASES: Record<string, Record<string, string>> = {
  coordinateSystem: {
    editor: 'editor',
    y_up: 'yUp',
    yup: 'yUp',
    yUp: 'yUp',
    z_up: 'zUp',
    zup: 'zUp',
    zUp: 'zUp'
  },
  coordinateRemap: {
    none: 'none',
    z_up_to_y_up: 'zUpToYUp',
    zUpToYUp: 'zUpToYUp',
    y_up_to_z_up: 'yUpToZUp',
    yUpToZUp: 'yUpToZUp'
  },
  surfaceType: {
    bezier_patch: 'bezierPatch',
    bezierPatch: 'bezierPatch'
  },
  curveType: {
    polyline: 'polyline',
    bezier: 'bezier',
    catmull_rom: 'catmullRom',
    catmullRom: 'catmullRom',
    nurbs: 'nurbs'
  },
  language: {
    javascript: 'javascript',
    js: 'js'
  }
};

function normalizeValue(value: JsonInput, key: string): JsonInput {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, ''));
  }
  if (value && typeof value === 'object') {
    const normalized: { [key: string]: JsonInput } = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const normalizedKey = toCamelCase(childKey);
      normalized[normalizedKey] = normalizeValue(childValue, normalizedKey);
    }
    return normalized;
  }
  if (typeof value === 'string') {
    return ENUM_ALIASES[key]?.[value] ?? value;
  }
  return value;
}

/**
 * Converts a snake_case procedural model spec (the MCP/JSON-Schema wire format)
 * into the camelCase form {@link generatePrimitive} expects.
 *
 * Keys are camel-cased recursively (`segments_u` -\> `segmentsU`) and a handful of
 * enum values are re-mapped (`z_up` -\> `zUp`, `catmull_rom` -\> `catmullRom`, ...).
 * Input that is already camelCase passes through unchanged, so calling this on a
 * spec built programmatically is harmless.
 *
 * @param value - The raw spec, typically parsed from JSON.
 * @returns The normalized spec.
 * @public
 */
export function normalizeGeneratedModelSpec(value: JsonInput): GeneratedModelSpec {
  return normalizeValue(value, '') as unknown as GeneratedModelSpec;
}
