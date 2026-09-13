import type { Vec3 } from '@zephyr3d/modelgen';
import { boxFromScope, panelFromFace } from '../emit';
import type { GrammarContext, MaterialHint, Ruleset } from '../grammar';
import {
  abs,
  createScope,
  flt,
  inset,
  localToWorld,
  offsetLocal,
  rel,
  repeat,
  scaleAboutCenter,
  sideFaces,
  split,
  type Scope
} from '../scope';

/**
 * Material group an emitted node belongs to.
 *
 * Every node the ruleset emits is tagged with one of these as its `id`, and the
 * tessellator keeps the tag, so a caller can split one building's spec into one
 * sub-spec per group and render each with its own material. That is the whole
 * mechanism — there is no separate material system to configure.
 *
 * @public
 */
export type MaterialGroup = 'glass' | 'frame' | 'wall' | 'trim';

/**
 * The facade language a building wears.
 *
 * - `curtain` - thin mullions over a shallow recess: a glass tower.
 * - `punched` - thick piers and deep reveals: discrete windows in a solid wall.
 * - `banded` - no verticals, heavy spandrels: horizontal ribbon windows.
 *
 * @public
 */
export type FacadeStyle = 'curtain' | 'punched' | 'banded';

/**
 * Proportions that turn the shared facade rule into one of the {@link FacadeStyle}
 * languages. All three are built from the same three parts — vertical members,
 * horizontal members and a recessed glazing plane — and differ only in dimensions.
 *
 * @public
 */
export interface FacadePreset {
  style: FacadeStyle;
  /** How far the glazing plane sits behind the outer wall face. */
  insetDepth: number;
  /** Width of an intermediate vertical member. Zero suppresses them entirely. */
  pierWidth: number;
  /** Width of the vertical member at each end of a face. Always present. */
  cornerPierWidth: number;
  /**
   * How far vertical members stand in front of the outer wall plane.
   *
   * Must stay above zero: the horizontal bands are full-footprint boxes whose outer
   * face sits exactly on that plane, so a flush vertical would be coplanar with them
   * and z-fight at every floor line. The offset also reads as a real shadow line.
   */
  pierProud: number;
  /** Height of the horizontal member straddling each floor line. */
  bandHeight: number;
  /** Preferred horizontal spacing of vertical members. */
  bayWidth: number;
  /** Which material the horizontal members read as. */
  bandGroup: MaterialGroup;
}

const PRESETS: Record<FacadeStyle, FacadePreset> = {
  curtain: {
    style: 'curtain',
    insetDepth: 0.35,
    pierWidth: 0.22,
    cornerPierWidth: 0.4,
    pierProud: 0.06,
    bandHeight: 0.5,
    bayWidth: 3.0,
    bandGroup: 'frame'
  },
  punched: {
    style: 'punched',
    insetDepth: 0.6,
    pierWidth: 1.3,
    cornerPierWidth: 1.6,
    pierProud: 0.04,
    bandHeight: 1.5,
    bayWidth: 3.4,
    bandGroup: 'wall'
  },
  banded: {
    style: 'banded',
    insetDepth: 0.45,
    pierWidth: 0,
    cornerPierWidth: 1.0,
    pierProud: 0.04,
    bandHeight: 1.7,
    bayWidth: 3.2,
    bandGroup: 'wall'
  }
};

/**
 * Tunable parameters for the modern office style.
 *
 * Lengths are in world units (metres). Every `*Chance` value is a probability in
 * `[0, 1]` and every `*Weight` a relative likelihood, both evaluated against the
 * seeded RNG, so the same seed always makes the same choices.
 *
 * @public
 */
export interface ModernOfficeParams {
  /** Number of occupied floors, including the ground floor. */
  floors: number;
  /** Height of a typical upper floor. */
  floorHeight: number;
  /** Height of the taller ground-floor lobby. */
  groundFloorHeight: number;
  /** Relative likelihood of a glass curtain wall. */
  curtainWeight: number;
  /** Relative likelihood of punched windows in a solid wall. */
  punchedWeight: number;
  /** Relative likelihood of horizontal ribbon windows. */
  bandedWeight: number;
  /** Height of the parapet wall around each roof deck. */
  parapetHeight: number;
  /** Wall thickness of the parapet. */
  parapetThickness: number;
  /** Thickness of the roof deck slab. */
  roofSlab: number;
  /** Probability of an entrance canopy over the lobby. */
  canopyChance: number;
  /**
   * How far the canopy projects from the facade.
   *
   * This is the only geometry that leaves the requested footprint. Everything else
   * is strictly contained, so a caller packing buildings into a block should either
   * reserve this much clearance or set {@link ModernOfficeParams.canopyChance} to 0.
   */
  canopyDepth: number;
  /**
   * Which sides may carry the entrance canopy, as a bit mask over the face order
   * `[+X, -X, +Z, -Z]` — bit 0 is +X. Defaults to 15 (any side).
   *
   * A caller placing buildings on a street grid passes the parcel's street frontage
   * here, so entrances face the road instead of a rear yard.
   */
  entranceFaceMask: number;
  /** Probability that the building gets a wider podium at its base. */
  podiumChance: number;
  /** Number of floors the podium occupies when present. */
  podiumFloors: number;
  /** Footprint factor of the tower relative to the podium. */
  towerShrink: number;
  /** Probability of a setback partway up the tower. */
  setbackChance: number;
  /** Fraction of the tower height below the setback. */
  setbackFraction: number;
  /** Footprint factor of the mass above the setback. */
  setbackScale: number;
  /** Maximum number of rooftop plant boxes. */
  maxRooftopUnits: number;
}

const DEFAULTS: ModernOfficeParams = {
  floors: 12,
  floorHeight: 3.6,
  groundFloorHeight: 5.2,
  curtainWeight: 1,
  punchedWeight: 1,
  bandedWeight: 0.8,
  parapetHeight: 1.1,
  parapetThickness: 0.3,
  roofSlab: 0.35,
  canopyChance: 0.6,
  canopyDepth: 1.8,
  entranceFaceMask: 0b1111,
  podiumChance: 0.45,
  podiumFloors: 2,
  towerShrink: 0.78,
  setbackChance: 0.5,
  setbackFraction: 0.62,
  setbackScale: 0.76,
  maxRooftopUnits: 4
};

/** Payload threaded from the massing rule down to the facade rules. @public */
export interface ModernOfficeData {
  facade: FacadePreset;
}

type Ctx = GrammarContext<ModernOfficeParams, ModernOfficeData>;

/** A deck scope has zero height by construction, so only its plan area matters. */
function hasFootprint(scope: Scope, epsilon = 1e-6): boolean {
  return scope.size[0] > epsilon && scope.size[2] > epsilon;
}

/** Carves an axis-aligned rectangle out of a face scope, in the face's own frame. */
function faceRect(face: Scope, x: number, y: number, width: number, height: number): Scope {
  return {
    origin: localToWorld(face, [x, y, 0]),
    basis: [[...face.basis[0]], [...face.basis[1]], [...face.basis[2]]],
    size: [Math.max(0, width), Math.max(0, height), 0]
  };
}

function facadeOf(ctx: Ctx): FacadePreset {
  return ctx.data?.facade ?? PRESETS.curtain;
}

/**
 * Total envelope height for a set of parameters.
 *
 * Exported because callers need it to size the axiom scope before the grammar runs.
 * @public
 */
export function modernOfficeHeight(params: ModernOfficeParams): number {
  const floors = Math.max(1, Math.floor(params.floors));
  return params.groundFloorHeight + (floors - 1) * params.floorHeight;
}

/**
 * Emits the shaft of one mass: the recessed glazing plane, the horizontal member at
 * every floor line, and the facade derivations for all four sides.
 *
 * `hasGroundFloor` makes the bottom storey taller, which is what separates a
 * street-level lobby from a typical floor.
 */
function emitShaft(scope: Scope, ctx: Ctx, hasGroundFloor: boolean): void {
  const { floorHeight, groundFloorHeight } = ctx.params;
  const preset = facadeOf(ctx);
  if (!hasFootprint(scope) || scope.size[1] <= 0) {
    return;
  }

  // One glazing volume per mass. The members emitted over it are what carve it into
  // readable windows, so a deeper inset plus fatter members reads as a solid wall.
  ctx.emit(boxFromScope(inset(scope, [preset.insetDepth, 0, preset.insetDepth]), { id: 'glass' }));

  const height = scope.size[1];
  const storeys: Scope[] = hasGroundFloor
    ? split(scope, 'y', [abs(Math.min(groundFloorHeight, height)), flt(1)]).flatMap((part, index) =>
        index === 0 ? [part] : repeat(part, 'y', floorHeight)
      )
    : repeat(scope, 'y', floorHeight);

  // A band straddles the top of every storey except the last, whose edge is covered
  // by the roof deck. Straddling rather than sitting under the line centres the
  // glazing in each storey instead of pushing it to the floor.
  for (let i = 0; i < storeys.length - 1; i++) {
    const storey = storeys[i];
    const bandHeight = Math.min(preset.bandHeight, storey.size[1]);
    const base = offsetLocal(storey, 'y', storey.size[1] - bandHeight * 0.5);
    const band = createScope([scope.size[0], bandHeight, scope.size[2]], base.origin, base.basis);
    ctx.emit(boxFromScope(band, { id: preset.bandGroup }));
  }

  for (const face of sideFaces(scope)) {
    ctx.derive('Facade', face, ctx.data);
  }

  if (hasGroundFloor && ctx.rng.chance(ctx.params.canopyChance)) {
    // sideFaces returns [+X, -X, +Z, -Z], which is the order the mask is defined in.
    const candidates = sideFaces(scope).filter((_, index) => (ctx.params.entranceFaceMask >> index) & 1);
    if (candidates.length > 0) {
      const face = ctx.rng.pick(candidates);
      const width = Math.min(face.size[0] * 0.42, 7);
      const x = (face.size[0] - width) * 0.5;
      const y = Math.min(groundFloorHeight, height) - 0.75;
      // Metal rather than trim, and thin: a thick pale slab reads as a floating shelf
      // instead of an entrance canopy.
      ctx.emit(panelFromFace(faceRect(face, x, y, width, 0.22), ctx.params.canopyDepth, { id: 'frame' }));
    }
  }
}

/**
 * Emits a roof deck plus its parapet ring, and returns the scope of the deck
 * surface so callers can place equipment on it.
 */
function emitRoofDeck(scope: Scope, ctx: Ctx): Scope | null {
  const { roofSlab, parapetHeight, parapetThickness } = ctx.params;
  if (!hasFootprint(scope)) {
    return null;
  }
  const deck = createScope([scope.size[0], roofSlab, scope.size[2]], scope.origin, scope.basis);
  ctx.emit(boxFromScope(deck, { id: 'trim' }));

  const parapetBase = offsetLocal(scope, 'y', roofSlab);
  const parapet = createScope(
    [scope.size[0], parapetHeight, scope.size[2]],
    parapetBase.origin,
    parapetBase.basis
  );
  // A ring of four inward panels rather than a solid block, so the deck stays open.
  for (const face of sideFaces(parapet)) {
    ctx.emit(panelFromFace(face, -parapetThickness, { id: 'trim' }));
  }
  return parapetBase;
}

const rules: Record<string, (scope: Scope, ctx: Ctx) => void> = {
  /**
   * Massing. Picks the facade language and the podium / setback composition up
   * front, then hands each resulting mass to the shaft rules. Doing the composition
   * in one rule keeps the building's overall proportions readable in one place.
   */
  Building(scope, ctx) {
    const p = ctx.params;
    const facade = ctx.rng.weighted([
      { value: PRESETS.curtain, weight: p.curtainWeight },
      { value: PRESETS.punched, weight: p.punchedWeight },
      { value: PRESETS.banded, weight: p.bandedWeight }
    ]);
    const data: ModernOfficeData = { facade };
    const masses: { scope: Scope; ground: boolean }[] = [];

    let remaining = scope;
    const wantsPodium =
      ctx.rng.chance(p.podiumChance) && p.floors > p.podiumFloors + 3 && p.podiumFloors >= 1;

    if (wantsPodium) {
      const podiumHeight = p.groundFloorHeight + (p.podiumFloors - 1) * p.floorHeight;
      const [podium, above] = split(scope, 'y', [abs(podiumHeight), flt(1)]);
      masses.push({ scope: podium, ground: true });
      remaining = scaleAboutCenter(above, [p.towerShrink, 1, p.towerShrink]);
    }

    const isGroundMass = masses.length === 0;
    if (ctx.rng.chance(p.setbackChance) && remaining.size[1] > p.floorHeight * 4) {
      const [lower, upper] = split(remaining, 'y', [rel(p.setbackFraction), flt(1)]);
      masses.push({ scope: lower, ground: isGroundMass });
      masses.push({
        scope: scaleAboutCenter(upper, [p.setbackScale, 1, p.setbackScale]),
        ground: false
      });
    } else {
      masses.push({ scope: remaining, ground: isGroundMass });
    }

    masses.forEach((mass, index) => {
      ctx.derive(mass.ground ? 'BaseMass' : 'Mass', mass.scope, data);
      const top = offsetLocal(mass.scope, 'y', mass.scope.size[1]);
      const deck = createScope([mass.scope.size[0], 0, mass.scope.size[2]], top.origin, top.basis);
      ctx.derive(index === masses.length - 1 ? 'Roof' : 'Terrace', deck, data);
    });
  },

  /** Shaft whose lowest storey is a tall lobby. */
  BaseMass(scope, ctx) {
    emitShaft(scope, ctx, true);
  },

  /** Shaft of uniform storeys, used above a podium or setback. */
  Mass(scope, ctx) {
    emitShaft(scope, ctx, false);
  },

  /**
   * Vertical members across one face. Bays tile exactly, so the rhythm stays aligned
   * across the whole elevation regardless of the face's width. A preset with no
   * intermediate piers still gets the two corner piers, which is what stops a ribbon
   * facade reading as a floating pane of glass.
   */
  Facade(face, ctx) {
    const preset = facadeOf(ctx);
    if (face.size[0] <= 0 || face.size[1] <= 0) {
      return;
    }
    // Piers run from slightly proud of the wall plane back past the glazing plane, so
    // neither their outer face (vs. the floor bands) nor their inner face (vs. the
    // glazing) ends up coplanar with another surface.
    const emitPier = (rect: Scope) => {
      const front = offsetLocal(rect, 'z', preset.pierProud);
      ctx.emit(panelFromFace(front, -(preset.insetDepth + preset.pierProud * 2), { id: 'frame' }));
    };

    const corner = Math.min(preset.cornerPierWidth, face.size[0] * 0.5);
    for (const x of [0, face.size[0] - corner]) {
      emitPier(faceRect(face, x, 0, corner, face.size[1]));
    }
    if (preset.pierWidth <= 0) {
      return;
    }
    const bays = repeat(face, 'x', preset.bayWidth);
    // Only the interior boundaries: the two ends are already the corner piers.
    for (let i = 1; i < bays.length; i++) {
      const pier = offsetLocal(bays[i], 'x', -preset.pierWidth * 0.5);
      emitPier(faceRect(pier, 0, 0, preset.pierWidth, face.size[1]));
    }
  },

  /** Roof deck over a setback or podium: deck and parapet, no equipment. */
  Terrace(scope, ctx) {
    emitRoofDeck(scope, ctx);
  },

  /** Topmost roof: deck, parapet and a scatter of plant enclosures. */
  Roof(scope, ctx) {
    const deck = emitRoofDeck(scope, ctx);
    if (!deck) {
      return;
    }
    const p = ctx.params;
    const units = ctx.rng.int(1, Math.max(1, p.maxRooftopUnits));
    const usable = inset(deck, [p.parapetThickness * 2, 0, p.parapetThickness * 2]);
    if (!hasFootprint(usable)) {
      return;
    }
    for (let i = 0; i < units; i++) {
      const w = ctx.rng.range(1.2, Math.max(1.4, usable.size[0] * 0.32));
      const d = ctx.rng.range(1.2, Math.max(1.4, usable.size[2] * 0.32));
      const h = ctx.rng.range(0.9, 2.6);
      const x = ctx.rng.range(0, Math.max(0, usable.size[0] - w));
      const z = ctx.rng.range(0, Math.max(0, usable.size[2] - d));
      const unit = createScope([w, h, d] as Vec3, localToWorld(usable, [x, 0, z]), usable.basis);
      ctx.emit(boxFromScope(unit, { id: 'trim' }));
    }
  }
};

/**
 * Materials the style was designed against.
 *
 * Albedo is **linear**, not display-referred: linear 0.18 encodes to roughly sRGB
 * 0.46, i.e. the mid-grey of concrete. Reading these as screen values is the easy
 * mistake — it produces a chalky, washed-out block.
 *
 * The tonal order matters more than the exact numbers: `wall` sits clearly below
 * `frame` so a punched-window mass reads as solid, and `trim` lower still so roof
 * decks stop glaring under a high sun. `variation` is what keeps a block of nine
 * from looking like nine copies.
 */
const PALETTE: Record<MaterialGroup, MaterialHint> = {
  glass: { albedo: [0.035, 0.05, 0.075], metallic: 0.35, roughness: 0.12, variation: 0.3 },
  frame: { albedo: [0.3, 0.31, 0.32], metallic: 0.55, roughness: 0.35, variation: 0.12 },
  wall: { albedo: [0.18, 0.168, 0.15], metallic: 0, roughness: 0.85, variation: 0.3 },
  trim: { albedo: [0.115, 0.115, 0.12], metallic: 0.05, roughness: 0.7, variation: 0.15 }
};

/**
 * A contemporary office building in one of three facade languages: glass curtain
 * wall, punched windows, or horizontal ribbons — with an optional podium, setback
 * and a plant-cluttered roof.
 *
 * This is the reference ruleset. A new style registers its own {@link Ruleset} and
 * needs no changes here or in the engine.
 *
 * @public
 */
export const modernOffice: Ruleset<ModernOfficeParams, ModernOfficeData> = {
  id: 'modern-office',
  displayName: 'Modern office',
  axiom: 'Building',
  defaultParams: DEFAULTS,
  palette: PALETTE,
  envelopeHeight: modernOfficeHeight,
  rules
};

/** The built-in facade presets, keyed by style. @public */
export const facadePresets: Readonly<Record<FacadeStyle, FacadePreset>> = PRESETS;
