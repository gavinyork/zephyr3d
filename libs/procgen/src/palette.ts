import type { MaterialHint } from './grammar';
import type { Random } from './random';

/**
 * One complete set of materials a building can wear, see {@link Ruleset.schemeSets}.
 *
 * A style's {@link Ruleset.palette} is a single look; a scheme set is a family of looks a
 * caller picks from per building, so a block reads as many buildings rather than one design
 * with its brightness nudged.
 *
 * @public
 */
export interface MaterialScheme {
  /** Stable identifier within its set. */
  id: string;
  /** Human-readable name for UI. */
  displayName?: string;
  /** Relative likelihood of being picked. Defaults to 1. */
  weight?: number;
  /** Materials keyed by material group, like {@link Ruleset.palette}. */
  palette: Readonly<Record<string, MaterialHint>>;
  /**
   * Style parameter overrides that suit the scheme, merged over the caller's — a brick
   * scheme, say, preferring punched windows to a curtain wall.
   */
  params?: Readonly<Record<string, unknown>>;
}

/**
 * Picks a scheme from a list by weight.
 * @returns The scheme, or `null` for an empty list.
 * @public
 */
export function pickMaterialScheme(schemes: readonly MaterialScheme[], rng: Random): MaterialScheme | null {
  if (schemes.length === 0) {
    return null;
  }
  return rng.weighted(schemes.map((scheme) => ({ value: scheme, weight: Math.max(0, scheme.weight ?? 1) })));
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) * 0.5;
  if (max - min < 1e-9) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s <= 1e-9) {
    return [l, l, l];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    t = t - Math.floor(t);
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * How one building departs from a scheme, shared by all its material groups so the building
 * still reads as one object. Make one with {@link randomMaterialTone}.
 * @public
 */
export interface MaterialTone {
  /** Lightness shift in `[-1, 1]`, scaled by each hint's {@link MaterialHint.variation}. */
  lightness: number;
  /** Hue shift in turns. */
  hue: number;
  /** Saturation factor offset in `[-1, 1]`, scaled by each hint's variation. */
  saturation: number;
}

/**
 * Draws a tone: lightness and saturation anywhere in their range, hue within `maxHueShift` turns.
 * @public
 */
export function randomMaterialTone(rng: Random, maxHueShift = 0.02): MaterialTone {
  return {
    lightness: rng.next() * 2 - 1,
    hue: (rng.next() * 2 - 1) * maxHueShift,
    saturation: rng.next() * 2 - 1
  };
}

/**
 * Applies a building's tone to a hint, in HSL: lightness scales by `1 + variation × lightness`,
 * saturation by `1 + variation × saturation`, and the hue turns by `hue`. A hint without
 * variation is returned unchanged. The albedo stays within `[0, 1]`.
 * @public
 */
export function applyMaterialTone(hint: MaterialHint, tone: MaterialTone): MaterialHint {
  const variation = hint.variation ?? 0;
  if (variation <= 0) {
    return hint;
  }
  const [h, s, l] = rgbToHsl(hint.albedo);
  const albedo = hslToRgb([
    h + tone.hue,
    Math.min(1, Math.max(0, s * (1 + variation * tone.saturation))),
    Math.min(1, Math.max(0, l * (1 + variation * tone.lightness)))
  ]);
  return { ...hint, albedo };
}
