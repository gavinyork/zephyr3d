import type { GeneratedModelSpec, Vec3 } from '@zephyr3d/modelgen';
import {
  getStyle,
  listStyles,
  registerStyle,
  runGrammar,
  toSpec,
  type AnyRuleset
} from './grammar';
import { createScope } from './scope';
import { modernOffice } from './styles/modern-office';

const BUILTIN_STYLES: AnyRuleset[] = [modernOffice];

let builtinsRegistered = false;

/**
 * Registers the styles that ship with the library.
 *
 * Registration is lazy rather than a module-level side effect so the package can
 * stay `sideEffects: false` and remain tree-shakeable. Every entry point in this
 * module calls it, so you only need it directly if you reach for {@link getStyle}
 * yourself.
 *
 * @public
 */
export function ensureBuiltinStyles(): void {
  if (builtinsRegistered) {
    return;
  }
  builtinsRegistered = true;
  for (const style of BUILTIN_STYLES) {
    registerStyle(style);
  }
}

/**
 * Ids of every style available, built-in or registered by the caller.
 * @public
 */
export function availableStyles(): string[] {
  ensureBuiltinStyles();
  return listStyles();
}

/**
 * Options for {@link generateBuilding}.
 * @public
 */
export interface GenerateBuildingOptions {
  /** Style id, or a ruleset object to use directly. Defaults to `'modern-office'`. */
  style?: string | AnyRuleset;
  /** Random seed. The same seed and options always produce identical geometry. */
  seed?: number;
  /** Plan size as `[width, depth]` along X and Z. */
  footprint?: [number, number];
  /** World position of the building's minimum corner. Defaults to the origin. */
  origin?: Vec3;
  /**
   * Envelope height. When omitted it is derived from the style's
   * {@link Ruleset.envelopeHeight}, which is the usual case.
   */
  height?: number;
  /** Style-specific parameter overrides, merged over the style's defaults. */
  params?: Record<string, unknown>;
  /** Emit tangents, needed for normal-mapped materials. Defaults to false. */
  tangents?: boolean;
}

/**
 * Generates one building as a procedural model spec.
 *
 * The result is plain JSON: feed it to `generatePrimitive` from `@zephyr3d/modelgen`
 * for a runtime mesh, or write it out as an asset. Nothing here touches a graphics
 * device.
 *
 * @example
 * ```ts
 * const spec = generateBuilding({ seed: 7, footprint: [24, 18], params: { floors: 16 } });
 * const mesh = generatePrimitive(spec, Infinity);
 * ```
 *
 * @public
 */
export function generateBuilding(options: GenerateBuildingOptions = {}): GeneratedModelSpec {
  ensureBuiltinStyles();
  const ruleset = typeof options.style === 'object' ? options.style : getStyle(options.style ?? 'modern-office');

  const params = { ...ruleset.defaultParams, ...(options.params ?? {}) };
  const footprint = options.footprint ?? [24, 18];
  const width = Math.max(1e-3, footprint[0]);
  const depth = Math.max(1e-3, footprint[1]);
  const height = Math.max(1e-3, options.height ?? ruleset.envelopeHeight?.(params) ?? 30);

  const scope = createScope([width, height, depth], options.origin ?? [0, 0, 0]);
  const nodes = runGrammar(ruleset, { scope, seed: options.seed ?? 0, params });

  return toSpec(nodes, options.tangents ? { generateTangents: true } : undefined);
}
