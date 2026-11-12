import type { ProceduralNode } from '@zephyr3d/modelgen';
import { panelFromFace } from '../emit';
import type { Random } from '../random';
import { localToWorld, offsetLocal, type Scope } from '../scope';

/** Gap kept between a lit pane and the members around it, so their faces never coincide */
const PANE_GAP = 0.02;
/** How far a lit pane stands in front of the glazing, and reaches behind it */
const PANE_HALF_DEPTH = 0.05;

/**
 * Horizontal spans of the window openings across a wall: the bays of {@link repeat}'s rounding
 * of `bayWidth`, less the corner piers at the ends and half an intermediate pier on each side.
 */
export function bayOpenings(
  wallWidth: number,
  cornerPier: number,
  bayWidth: number,
  pierWidth: number
): [number, number][] {
  if (wallWidth <= 0 || bayWidth <= 0) {
    return [];
  }
  const count = Math.max(1, Math.round(wallWidth / bayWidth));
  const step = wallWidth / count;
  const corner = Math.min(cornerPier, wallWidth * 0.5);
  const openings: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const x0 = i === 0 ? corner : i * step + pierWidth * 0.5;
    const x1 = i === count - 1 ? wallWidth - corner : (i + 1) * step - pierWidth * 0.5;
    if (x1 - x0 > PANE_GAP * 4) {
      openings.push([x0, x1]);
    }
  }
  return openings;
}

/**
 * Emits a lit pane over a random share of the window openings of a wall: a thin `'glass-lit'`
 * box straddling the glazing plane `glassDepth` behind the face. Draws one random number per
 * opening only when `chance` is above zero, so a style with lighting off consumes none.
 */
export function emitLitPanes(
  emit: (node: ProceduralNode | null) => void,
  rng: Random,
  face: Scope,
  columns: [number, number][],
  rows: [number, number][],
  glassDepth: number,
  chance: number
) {
  if (chance <= 0) {
    return;
  }
  for (const [y0, y1] of rows) {
    for (const [x0, x1] of columns) {
      if (!rng.chance(chance) || y1 - y0 <= PANE_GAP * 4) {
        continue;
      }
      const rect: Scope = {
        origin: localToWorld(face, [x0 + PANE_GAP, y0 + PANE_GAP, 0]),
        basis: [[...face.basis[0]], [...face.basis[1]], [...face.basis[2]]],
        size: [x1 - x0 - PANE_GAP * 2, y1 - y0 - PANE_GAP * 2, 0]
      };
      emit(
        panelFromFace(offsetLocal(rect, 'z', -glassDepth - PANE_HALF_DEPTH), PANE_HALF_DEPTH * 2, {
          id: 'glass-lit'
        })
      );
    }
  }
}
