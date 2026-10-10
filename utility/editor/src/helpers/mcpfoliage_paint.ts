/**
 * Painting tools of the editor MCP bridge: painting the density mask of a foliage layer, whose
 * painted instances are regenerated where it changed, and regenerating layers from their masks.
 */
import type { FoliageSystem } from '@zephyr3d/scene';
import { regenerateFoliageLayer, regenerateFoliageRegion } from './foliagepaint';
import type { FoliageGenRegion } from './foliagegen';

/** Layer index from MCP parameters, or an error */
export function parseLayerIndex(foliage: FoliageSystem, value: unknown) {
  const index = Number(value ?? 0);
  if (!Number.isInteger(index) || index < 0 || index >= foliage.numLayers) {
    return {
      index: -1,
      err: `\`layer\` must be an index below ${foliage.numLayers}; add layers with foliage_set_layers`
    };
  }
  return { index, err: null };
}

/** The painted and placed instance counts of a layer, for results */
export function layerCounts(foliage: FoliageSystem, index: number) {
  const layer = foliage.getLayer(index)!;
  return { painted: layer.generatedCount, placed: layer.manualCount, layer_count: layer.count };
}

/** A circle to paint, local to the foliage system */
export type PaintStroke = { x: number; z: number; radius: number };

/** Paint strokes from MCP parameters (world positions), or an error */
export function parsePaintStrokes(foliage: FoliageSystem, params: any): PaintStroke[] | string {
  const strokes: any[] = Array.isArray(params.strokes)
    ? params.strokes
    : params.center
      ? [{ center: params.center, radius: params.radius }]
      : [];
  if (strokes.length === 0) {
    return 'Give `center` and `radius`, or `strokes`: [{ center: [x, z], radius }, ...]';
  }
  const ox = foliage.worldMatrix.m03;
  const oz = foliage.worldMatrix.m23;
  const out: PaintStroke[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const c = strokes[i]?.center;
    const radius = Number(strokes[i]?.radius);
    const x = Array.isArray(c) ? Number(c[0]) : Number.NaN;
    const z = Array.isArray(c) ? Number(c[1]) : Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(radius > 0)) {
      return `Stroke ${i}: \`center\` must be a world [x, z] and \`radius\` positive`;
    }
    out.push({ x: x - ox, z: z - oz, radius });
  }
  return out;
}

/**
 * Applies paint strokes to the mask of a layer and regenerates its painted instances where the
 * mask changed
 * @param mode - set: the density inside each circle becomes `density` (blended at the soft
 * edge); add: raised by it; erase: lowered by it
 */
export async function applyPaintStrokes(
  foliage: FoliageSystem,
  index: number,
  strokes: PaintStroke[],
  mode: 'set' | 'add' | 'erase',
  density: number,
  falloff: number
) {
  let region: FoliageGenRegion | null = null;
  for (const s of strokes) {
    const changed =
      mode === 'set'
        ? foliage.fillMaskCircle(index, s.x, s.z, s.radius, density, falloff)
        : foliage.paintMask(index, s.x, s.z, s.radius, mode === 'erase' ? -density : density, falloff);
    if (changed) {
      region = region
        ? [
            Math.min(region[0], changed[0]),
            Math.min(region[1], changed[1]),
            Math.max(region[2], changed[2]),
            Math.max(region[3], changed[3])
          ]
        : changed;
    }
  }
  if (region) {
    await regenerateFoliageRegion(foliage, index, region);
  }
}

/** Regenerates the painted instances of layers from their masks */
export async function regenerateLayers(foliage: FoliageSystem, indices: number[]) {
  for (const i of indices) {
    await regenerateFoliageLayer(foliage, i);
  }
}
