import { boxFromScope, panelFromFace } from '../emit';
import type { GrammarContext, MaterialHint, Ruleset } from '../grammar';
import type { MaterialScheme } from '../palette';
import {
  extrudePlan,
  lPlan,
  offsetPlan,
  planEdgeFace,
  planEdgeSide,
  rectPlan,
  uPlan,
  type Plan
} from '../plan';
import { createScope, localToWorld, offsetLocal, repeat, type Scope } from '../scope';
import { bayOpenings, emitLitPanes } from './windows';

/**
 * Material group an emitted node of {@link urbanResidential} belongs to, carried as the node `id`.
 *
 * - `wall` - the solid facade: floor bands, piers, arcade columns.
 * - `glass` - the recessed window plane of the upper floors.
 * - `storefront` - the shop glazing of the ground floor, behind the arcade where there is one.
 * - `trim` - cornice, roof deck, parapet, balcony slabs, rooftop plant.
 * - `railing` - balcony railings.
 *
 * @public
 */
export type UrbanResidentialGroup = 'wall' | 'glass' | 'storefront' | 'trim' | 'railing';

/**
 * Tunable parameters of {@link urbanResidential}. Lengths in metres; `*Chance` values are
 * probabilities and `*Weight` values relative likelihoods, drawn from the seeded RNG.
 *
 * @public
 */
export interface UrbanResidentialParams {
  /** Floors including the ground floor. */
  floors: number;
  /** Height of an upper floor. */
  floorHeight: number;
  /** Height of the ground floor, taller for shops. */
  groundFloorHeight: number;
  /** Relative likelihood of a plain rectangular plan. */
  rectWeight: number;
  /** Relative likelihood of an L-shaped plan. */
  lWeight: number;
  /** Relative likelihood of a U-shaped plan around a courtyard open to the rear. */
  uWeight: number;
  /** Narrowest wing an L or U plan may leave; smaller footprints stay rectangular. */
  minWingDepth: number;
  /** Preferred width of a window bay on the upper floors. */
  bayWidth: number;
  /** Width of a window within its bay; the rest is pier. */
  windowWidth: number;
  /** Width of the piers at the ends of each wall. */
  cornerPierWidth: number;
  /** How far the window plane sits behind the wall face. */
  insetDepth: number;
  /** How far piers stand proud of the bands, so their faces never coincide. */
  pierProud: number;
  /** Height of the floor band straddling each floor line. */
  bandHeight: number;
  /**
   * Probability that the street sides get an arcade: the shop fronts set back behind a row of
   * columns, under the floor above. Only sides in {@link UrbanResidentialParams.entranceFaceMask}.
   */
  arcadeChance: number;
  /** How far an arcade sets the shop front back. */
  arcadeDepth: number;
  /** Preferred column spacing along an arcade, and pier spacing of other shop fronts. */
  arcadeBay: number;
  /** Width and depth of an arcade column. */
  columnWidth: number;
  /** How far a shop front without an arcade sits behind the wall face. */
  shopfrontInset: number;
  /** Probability that the building has balconies. */
  balconyChance: number;
  /** How far a balcony projects. */
  balconyDepth: number;
  /** Thickness of a balcony slab. */
  balconySlab: number;
  /** Height of a balcony railing. */
  railingHeight: number;
  /** Thickness of a balcony railing. */
  railingThickness: number;
  /** How far the cornice projects past the walls. */
  corniceDepth: number;
  /** Height of the cornice under the roof line. */
  corniceHeight: number;
  /** Height of the parapet around the roof. */
  parapetHeight: number;
  /** Thickness of the parapet. */
  parapetThickness: number;
  /** Thickness of the roof deck. */
  roofSlab: number;
  /** Maximum number of rooftop plant boxes. */
  maxRooftopUnits: number;
  /**
   * Fraction of upper-floor windows lit from inside, each emitted as a `'glass-lit'` pane just
   * proud of the glazing. 0, the default, lights none.
   */
  litWindowChance: number;
  /**
   * Sides facing a street, as a bit mask over `[+X, -X, +Z, -Z]` (bit 0 is +X). Arcades only
   * line these; courtyards and L notches open away from them.
   */
  entranceFaceMask: number;
  /**
   * Height above which the building is split, at floor lines, into several parts named
   * `mass0.<k>`; otherwise it is the single part `mass0`. Infinity never splits.
   */
  maxPartHeight: number;
}

const DEFAULTS: UrbanResidentialParams = {
  floors: 6,
  floorHeight: 3.1,
  groundFloorHeight: 4.4,
  rectWeight: 1,
  lWeight: 1,
  uWeight: 0.8,
  minWingDepth: 8,
  bayWidth: 3.2,
  windowWidth: 1.6,
  cornerPierWidth: 0.9,
  insetDepth: 0.3,
  pierProud: 0.04,
  bandHeight: 1.0,
  arcadeChance: 0.6,
  arcadeDepth: 3.2,
  arcadeBay: 4.5,
  columnWidth: 0.7,
  shopfrontInset: 0.25,
  balconyChance: 0.7,
  balconyDepth: 1.3,
  balconySlab: 0.3,
  railingHeight: 1.05,
  railingThickness: 0.12,
  corniceDepth: 0.5,
  corniceHeight: 0.6,
  parapetHeight: 0.9,
  parapetThickness: 0.25,
  roofSlab: 0.35,
  maxRooftopUnits: 3,
  litWindowChance: 0,
  entranceFaceMask: 0b1111,
  maxPartHeight: Infinity
};

type Ctx = GrammarContext<UrbanResidentialParams>;

/** Total height to the roof line, without the deck and parapet above it. @public */
export function urbanResidentialHeight(params: UrbanResidentialParams): number {
  const floors = Math.max(1, Math.floor(params.floors));
  return params.groundFloorHeight + (floors - 1) * params.floorHeight;
}

/** Carves an axis-aligned rectangle out of a face scope, in the face's own frame. */
function faceRect(face: Scope, x: number, y: number, width: number, height: number): Scope {
  return {
    origin: localToWorld(face, [x, y, 0]),
    basis: [[...face.basis[0]], [...face.basis[1]], [...face.basis[2]]],
    size: [Math.max(0, width), Math.max(0, height), 0]
  };
}

function pointInPlan(plan: Plan, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = plan.length - 1; i < plan.length; j = i++) {
    const [xi, zi] = plan[i];
    const [xj, zj] = plan[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Picks the plan: rectangular, or an L or U whose notch opens away from the streets */
function choosePlan(width: number, depth: number, ctx: Ctx): Plan {
  const p = ctx.params;
  const front = [0, 1, 2, 3].map((i) => !!((p.entranceFaceMask >> i) & 1));
  const shape = ctx.rng.weighted([
    { value: 'rect', weight: p.rectWeight },
    { value: 'l', weight: width >= p.minWingDepth * 2 && depth >= p.minWingDepth * 2 ? p.lWeight : 0 },
    { value: 'u', weight: width >= p.minWingDepth * 3 && depth >= p.minWingDepth * 2 ? p.uWeight : 0 }
  ]);
  if (shape === 'l') {
    // The removed corner touches the fewest street sides: [x side, z side] with 1 = max side
    const corners: [0 | 1, 0 | 1][] = [
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0]
    ];
    const streets = (c: [0 | 1, 0 | 1]) => (front[c[0] ? 0 : 1] ? 1 : 0) + (front[c[1] ? 2 : 3] ? 1 : 0);
    const fewest = Math.min(...corners.map(streets));
    const corner = ctx.rng.pick(corners.filter((c) => streets(c) === fewest));
    const notchW = width * ctx.rng.range(0.4, 0.55);
    const notchD = depth * ctx.rng.range(0.4, 0.55);
    return lPlan(
      width,
      depth,
      Math.min(notchW, width - p.minWingDepth),
      Math.min(notchD, depth - p.minWingDepth),
      corner
    );
  }
  if (shape === 'u') {
    // The courtyard opens to a side without a street, else to any side
    const quiet = [0, 1, 2, 3].filter((s) => !front[s]);
    const candidates = (quiet.length > 0 ? quiet : [0, 1, 2, 3]).filter((s) => {
      const span = s >= 2 ? width : depth;
      const reach = s >= 2 ? depth : width;
      return span >= p.minWingDepth * 3 && reach >= p.minWingDepth * 2;
    });
    if (candidates.length > 0) {
      const side = ctx.rng.pick(candidates);
      const span = side >= 2 ? width : depth;
      const reach = side >= 2 ? depth : width;
      const notchW = Math.min(span - p.minWingDepth * 2, span * ctx.rng.range(0.35, 0.5));
      const notchD = Math.min(reach - p.minWingDepth, reach * ctx.rng.range(0.4, 0.6));
      return uPlan(width, depth, notchW, notchD, side);
    }
  }
  return rectPlan(width, depth);
}

/** Vertical piers over one wall: one at each end and one between bays of `bayWidth` */
function emitPiers(face: Scope, ctx: Ctx, part: string, bayWidth: number, pierWidth: number) {
  const p = ctx.params;
  if (face.size[0] <= 1e-6 || face.size[1] <= 1e-6) {
    return;
  }
  const emitPier = (rect: Scope) => {
    // Proud of the bands and reaching behind the window plane, so no faces coincide
    const front = offsetLocal(rect, 'z', p.pierProud);
    ctx.emit(panelFromFace(front, -(p.insetDepth + p.pierProud * 2), { id: 'wall' }), part);
  };
  const corner = Math.min(p.cornerPierWidth, face.size[0] * 0.5);
  for (const x of [0, face.size[0] - corner]) {
    emitPier(faceRect(face, x, 0, corner, face.size[1]));
  }
  const bays = repeat(face, 'x', bayWidth);
  for (let i = 1; i < bays.length; i++) {
    const at = offsetLocal(bays[i], 'x', -pierWidth * 0.5);
    emitPier(faceRect(at, 0, 0, pierWidth, face.size[1]));
  }
}

/** A balcony in front of one window bay: slab, front railing and two side railings */
function emitBalcony(face: Scope, x: number, width: number, floorY: number, ctx: Ctx, part: string) {
  const p = ctx.params;
  const slab = faceRect(face, x, floorY - p.balconySlab, width, p.balconySlab);
  ctx.emit(panelFromFace(slab, p.balconyDepth, { id: 'trim' }), part);
  const t = Math.min(p.railingThickness, width * 0.25, p.balconyDepth * 0.5);
  const front = offsetLocal(faceRect(face, x, floorY, width, p.railingHeight), 'z', p.balconyDepth - t);
  ctx.emit(panelFromFace(front, t, { id: 'railing' }), part);
  for (const sx of [x, x + width - t]) {
    ctx.emit(
      panelFromFace(faceRect(face, sx, floorY, t, p.railingHeight), p.balconyDepth - t, { id: 'railing' }),
      part
    );
  }
}

const rules: Record<string, (scope: Scope, ctx: Ctx) => void> = {
  /**
   * The whole building in one rule: the plan and the arcade, balcony and part choices are
   * made once, then every storey is laid out against them.
   */
  Building(scope, ctx) {
    const p = ctx.params;
    const width = scope.size[0];
    const depth = scope.size[2];
    if (width <= 1e-6 || depth <= 1e-6) {
      return;
    }
    const plan = choosePlan(width, depth, ctx);
    const front = [0, 1, 2, 3].map((i) => !!((p.entranceFaceMask >> i) & 1));
    const sides = plan.map((_, i) => planEdgeSide(plan, i, width, depth));
    const arcade = ctx.rng.chance(p.arcadeChance);
    const arcadeEdges = sides.map((side) => arcade && side >= 0 && front[side]);
    const balconies = ctx.rng.chance(p.balconyChance);
    // Balconies on the quiet sides and the courtyard walls; on street sides only sometimes
    const balconyEdges = sides.map((side) => balconies && (side < 0 || !front[side] || ctx.rng.chance(0.4)));
    const balconyParity = ctx.rng.int(0, 1);

    const floors = Math.max(1, Math.floor(p.floors));
    const ground = Math.min(p.groundFloorHeight, scope.size[1]);
    const storeyBottoms = [0];
    for (let i = 1; i < floors; i++) {
      storeyBottoms.push(ground + (i - 1) * p.floorHeight);
    }
    const top = urbanResidentialHeight(p);
    const storeyTop = (i: number) => (i + 1 < floors ? storeyBottoms[i + 1] : top);

    // Parts: runs of storeys no taller than maxPartHeight
    const runs: number[][] = [[]];
    let runHeight = 0;
    const limit = p.maxPartHeight > 0 && Number.isFinite(p.maxPartHeight) ? p.maxPartHeight : Infinity;
    const target = Number.isFinite(limit) ? top / Math.ceil(top / limit - 1e-6) : Infinity;
    for (let i = 0; i < floors; i++) {
      const h = storeyTop(i) - storeyBottoms[i];
      if (runs[runs.length - 1].length > 0 && runHeight + h > target + 1e-6) {
        runs.push([]);
        runHeight = 0;
      }
      runs[runs.length - 1].push(i);
      runHeight += h;
    }
    const partOf = (k: number) => (runs.length > 1 ? `mass0.${k}` : 'mass0');

    runs.forEach((run, k) => {
      const part = partOf(k);
      for (const i of run) {
        const y0 = storeyBottoms[i];
        const y1 = storeyTop(i);
        if (i === 0) {
          // Ground floor: shop fronts, set back behind columns along arcade sides
          const insets = plan.map((_, e) =>
            arcadeEdges[e]
              ? p.arcadeDepth
              : sides[e] >= 0 && front[sides[e]]
                ? p.shopfrontInset
                : p.insetDepth
          );
          ctx.emit(extrudePlan(scope, offsetPlan(plan, insets), y0, y1 - y0, { id: 'storefront' }), part);
          plan.forEach((_, e) => {
            const face = planEdgeFace(scope, plan, e, y0, y1 - y0);
            if (!arcadeEdges[e]) {
              emitPiers(face, ctx, part, p.arcadeBay, 0.6);
              return;
            }
            const columns = Math.max(2, Math.round(face.size[0] / p.arcadeBay) + 1);
            const col = Math.min(p.columnWidth, face.size[0] / columns);
            for (let c = 0; c < columns; c++) {
              const x = ((face.size[0] - col) * c) / (columns - 1);
              ctx.emit(panelFromFace(faceRect(face, x, 0, col, face.size[1]), -col, { id: 'wall' }), part);
            }
          });
        }
        if (i + 1 < floors) {
          // The band straddling the floor line above; over an arcade it is the arcade ceiling
          const band = Math.min(p.bandHeight, (y1 - y0) * 0.8);
          ctx.emit(extrudePlan(scope, plan, y1 - band * 0.5, band, { id: 'wall' }), part);
        }
      }
      // Upper floors of this part: one window plane, then piers and balconies per wall
      const upper = run.filter((i) => i > 0);
      if (upper.length > 0) {
        const y0 = storeyBottoms[upper[0]];
        const y1 = storeyTop(upper[upper.length - 1]);
        ctx.emit(extrudePlan(scope, offsetPlan(plan, p.insetDepth), y0, y1 - y0, { id: 'glass' }), part);
        plan.forEach((_, e) => {
          const face = planEdgeFace(scope, plan, e, y0, y1 - y0);
          const pierWidth = Math.max(0.3, p.bayWidth - p.windowWidth);
          emitPiers(face, ctx, part, p.bayWidth, pierWidth);
          emitLitPanes(
            (node) => ctx.emit(node, part),
            ctx.rng,
            face,
            bayOpenings(face.size[0], p.cornerPierWidth, p.bayWidth, pierWidth),
            upper.map((i) => {
              const band = Math.min(p.bandHeight, (storeyTop(i) - storeyBottoms[i]) * 0.8) * 0.5;
              return [storeyBottoms[i] - y0 + band, storeyTop(i) - y0 - (i + 1 < floors ? band : 0)] as [
                number,
                number
              ];
            }),
            p.insetDepth,
            p.litWindowChance
          );
          if (!balconyEdges[e]) {
            return;
          }
          const bays = repeat(face, 'x', p.bayWidth);
          // Not the end bays, which meet the corner piers and the neighbouring wall's balconies
          for (let b = 1; b < bays.length - 1; b++) {
            if ((b + balconyParity) % 2 !== 0) {
              continue;
            }
            const bayX = (face.size[0] / bays.length) * b;
            const bayW = face.size[0] / bays.length;
            for (const i of upper) {
              emitBalcony(face, bayX + 0.1, bayW - 0.2, storeyBottoms[i] - y0, ctx, part);
            }
          }
        });
      }
    });

    // Roof: cornice, deck, parapet and plant, with the top part
    const roofPart = partOf(runs.length - 1);
    const cornice = Math.min(p.corniceHeight, top * 0.25);
    ctx.emit(
      extrudePlan(scope, offsetPlan(plan, -p.corniceDepth), top - cornice, cornice, { id: 'trim' }),
      roofPart
    );
    ctx.emit(extrudePlan(scope, plan, top, p.roofSlab, { id: 'trim' }), roofPart);
    plan.forEach((_, e) => {
      const face = planEdgeFace(scope, plan, e, top + p.roofSlab, p.parapetHeight);
      ctx.emit(panelFromFace(face, -p.parapetThickness, { id: 'trim' }), roofPart);
    });
    const units = ctx.rng.int(0, Math.max(0, p.maxRooftopUnits));
    const deckY = top + p.roofSlab;
    for (let u = 0; u < units; u++) {
      const w = ctx.rng.range(1.2, 3);
      const d = ctx.rng.range(1.2, 3);
      const h = ctx.rng.range(0.8, 2.2);
      const x = ctx.rng.range(0, Math.max(0, width - w));
      const z = ctx.rng.range(0, Math.max(0, depth - d));
      const margin = p.parapetThickness * 2;
      const fits = [
        [x - margin, z - margin],
        [x + w + margin, z - margin],
        [x + w + margin, z + d + margin],
        [x - margin, z + d + margin]
      ].every(([px, pz]) => pointInPlan(plan, px, pz));
      if (fits) {
        ctx.emit(
          boxFromScope(createScope([w, h, d], localToWorld(scope, [x, deckY, z]), scope.basis), {
            id: 'trim'
          }),
          roofPart
        );
      }
    }
  }
};

/** Clear glass: a dielectric, its look coming from what it reflects */
const CLEAR_GLASS: MaterialHint = {
  albedo: [0.02, 0.025, 0.03],
  metallic: 0,
  roughness: 0.05,
  variation: 0.2
};
const SHOP_GLASS: MaterialHint = {
  albedo: [0.03, 0.035, 0.04],
  metallic: 0,
  roughness: 0.05,
  variation: 0.2
};
const DARK_RAILING: MaterialHint = { albedo: [0.05, 0.05, 0.055], metallic: 0.7, roughness: 0.4 };

function scheme(
  id: string,
  displayName: string,
  wall: [number, number, number],
  trim: [number, number, number],
  weight = 1
): MaterialScheme {
  return {
    id,
    displayName,
    weight,
    palette: {
      wall: { albedo: wall, metallic: 0, roughness: 0.85, variation: 0.15 },
      glass: CLEAR_GLASS,
      storefront: SHOP_GLASS,
      trim: { albedo: trim, metallic: 0, roughness: 0.8, variation: 0.08 },
      railing: DARK_RAILING
    }
  };
}

/** Rendered and masonry facades of a city street, under pale cornices */
const REALISTIC_SCHEMES: MaterialScheme[] = [
  scheme('cream-render', 'Cream render', [0.55, 0.47, 0.34], [0.62, 0.6, 0.55]),
  scheme('ochre-render', 'Ochre render', [0.5, 0.32, 0.13], [0.6, 0.57, 0.5]),
  scheme('pink-render', 'Pink render', [0.56, 0.37, 0.32], [0.62, 0.6, 0.56]),
  scheme('grey-blue-render', 'Grey-blue render', [0.3, 0.34, 0.38], [0.58, 0.58, 0.56]),
  scheme('red-brick', 'Red brick', [0.25, 0.08, 0.045], [0.55, 0.52, 0.46]),
  scheme('white-render', 'White render', [0.64, 0.62, 0.58], [0.4, 0.39, 0.37], 0.7)
];

/** Strong flat colours for testing global illumination, as modern office's vivid set */
const VIVID_SCHEMES: MaterialScheme[] = (
  [
    ['red', 'Red', [0.65, 0.05, 0.03]],
    ['green', 'Green', [0.08, 0.45, 0.08]],
    ['blue', 'Blue', [0.05, 0.12, 0.6]],
    ['yellow', 'Yellow', [0.75, 0.55, 0.03]],
    ['orange', 'Orange', [0.8, 0.25, 0.03]],
    ['white', 'White', [0.8, 0.8, 0.8]]
  ] as [string, string, [number, number, number]][]
).map(([id, name, albedo]) => ({
  id,
  displayName: name,
  palette: {
    wall: { albedo, metallic: 0, roughness: 0.8 },
    glass: CLEAR_GLASS,
    storefront: SHOP_GLASS,
    trim: { albedo: [0.7, 0.7, 0.7], metallic: 0, roughness: 0.8 },
    railing: DARK_RAILING
  }
}));

const PALETTE: Record<UrbanResidentialGroup, MaterialHint> = REALISTIC_SCHEMES[0].palette as Record<
  UrbanResidentialGroup,
  MaterialHint
>;

/**
 * A city apartment block of four to a dozen storeys: rendered or brick walls with punched
 * windows, shops on a taller ground floor — behind a colonnade on the street sides when it has
 * an arcade — balconies, a cornice, and a rectangular, L or U plan whose notch opens away from
 * the street.
 *
 * Its arcades, balconies, cornices and courtyards make the spaces direct sunlight rarely
 * reaches, where only bounced light shows.
 *
 * Offers `realistic` and `vivid` scheme sets like {@link modernOffice}.
 *
 * @public
 */
export const urbanResidential: Ruleset<UrbanResidentialParams> = {
  id: 'urban-residential',
  displayName: 'Urban residential',
  axiom: 'Building',
  defaultParams: DEFAULTS,
  palette: PALETTE,
  schemeSets: { realistic: REALISTIC_SCHEMES, vivid: VIVID_SCHEMES },
  envelopeHeight: urbanResidentialHeight,
  rules
};
