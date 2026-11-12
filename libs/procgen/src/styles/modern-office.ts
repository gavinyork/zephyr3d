import type { Vec3 } from '@zephyr3d/modelgen';
import { boxFromScope, panelFromFace } from '../emit';
import type { GrammarContext, MaterialHint, Ruleset } from '../grammar';
import type { MaterialScheme } from '../palette';
import { bayOpenings, emitLitPanes } from './windows';
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
  /**
   * Fraction of windows lit from inside, each emitted as a `'glass-lit'` pane just proud of the
   * glazing so a caller can give it an emissive material. 0, the default, lights none.
   */
  litWindowChance: number;
  /**
   * Height above which a mass is split, at floor lines, into several parts (see
   * {@link GrammarContext.part}). Each mass is always its own part, named `mass<index>`
   * from the ground up; a split mass's pieces are `mass<index>.<k>`. Infinity, the
   * default, never splits.
   *
   * Meant for callers that mesh every part separately, for example to bake a distance
   * field per mesh at a resolution a whole tower would not get.
   */
  maxPartHeight: number;
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
  maxRooftopUnits: 4,
  litWindowChance: 0,
  maxPartHeight: Infinity
};

/** Payload threaded from the massing rule down to the facade rules. @public */
export interface ModernOfficeData {
  facade: FacadePreset;
  /**
   * Glazed height of each storey on the face a facade rule builds, as `[bottom, top]` from the
   * face's foot. Set by the shaft for its facades.
   */
  windows?: [number, number][];
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
 * Groups consecutive storeys into runs no taller than `maxHeight`, each holding at least one
 * storey. A non-finite or non-positive limit keeps every storey in one run.
 */
function chunkStoreys(storeys: Scope[], maxHeight: number): Scope[][] {
  if (!(maxHeight > 0) || !Number.isFinite(maxHeight)) {
    return [storeys];
  }
  const total = storeys.reduce((sum, storey) => sum + storey.size[1], 0);
  // Even runs rather than full runs plus a sliver at the top
  const target = total / Math.ceil(total / maxHeight - 1e-6);
  const chunks: Scope[][] = [];
  let current: Scope[] = [];
  let height = 0;
  for (const storey of storeys) {
    if (current.length > 0 && height + storey.size[1] > target + 1e-6) {
      chunks.push(current);
      current = [];
      height = 0;
    }
    current.push(storey);
    height += storey.size[1];
  }
  chunks.push(current);
  return chunks;
}

/**
 * Emits the shaft of one mass: the recessed glazing plane, the horizontal member at
 * every floor line, and the facade derivations for all four sides.
 *
 * `hasGroundFloor` makes the bottom storey taller, which is what separates a
 * street-level lobby from a typical floor.
 *
 * A mass taller than {@link ModernOfficeParams.maxPartHeight} is emitted as several parts
 * named `<mass part>.<index>`, split at floor lines.
 */
function emitShaft(scope: Scope, ctx: Ctx, hasGroundFloor: boolean): void {
  const { floorHeight, groundFloorHeight } = ctx.params;
  const preset = facadeOf(ctx);
  if (!hasFootprint(scope) || scope.size[1] <= 0) {
    return;
  }

  const height = scope.size[1];
  const storeys: Scope[] = hasGroundFloor
    ? split(scope, 'y', [abs(Math.min(groundFloorHeight, height)), flt(1)]).flatMap((part, index) =>
        index === 0 ? [part] : repeat(part, 'y', floorHeight)
      )
    : repeat(scope, 'y', floorHeight);
  if (storeys.length === 0) {
    return;
  }

  // A band straddles the top of every storey except the last, whose edge is covered
  // by the roof deck. Straddling rather than sitting under the line centres the
  // glazing in each storey instead of pushing it to the floor.
  const chunks = chunkStoreys(storeys, ctx.params.maxPartHeight);
  const chunkParts = chunks.map((_, k) => (chunks.length > 1 ? `${ctx.part}.${k}` : ctx.part));
  let storeyIndex = 0;
  chunks.forEach((chunk, k) => {
    const part = chunkParts[k];
    const chunkHeight = chunk.reduce((sum, storey) => sum + storey.size[1], 0);
    const chunkScope = createScope([scope.size[0], chunkHeight, scope.size[2]], chunk[0].origin, scope.basis);
    // Glazed height of each storey in this part, between the bands, for lit windows
    const windows: [number, number][] = [];
    let y = 0;
    chunk.forEach((storey, s) => {
      const index = storeyIndex + s;
      const below = index > 0 ? Math.min(preset.bandHeight, storeys[index - 1].size[1]) * 0.5 : 0;
      const above = index < storeys.length - 1 ? Math.min(preset.bandHeight, storey.size[1]) * 0.5 : 0;
      windows.push([y + below, y + storey.size[1] - above]);
      y += storey.size[1];
    });
    // One glazing volume per mass (or per part of a tall mass). The members emitted over it
    // are what carve it into readable windows, so a deeper inset plus fatter members reads
    // as a solid wall.
    ctx.emit(
      boxFromScope(inset(chunkScope, [preset.insetDepth, 0, preset.insetDepth]), { id: 'glass' }),
      part
    );
    for (const storey of chunk) {
      if (storeyIndex++ === storeys.length - 1) {
        break;
      }
      const bandHeight = Math.min(preset.bandHeight, storey.size[1]);
      const base = offsetLocal(storey, 'y', storey.size[1] - bandHeight * 0.5);
      const band = createScope([scope.size[0], bandHeight, scope.size[2]], base.origin, base.basis);
      ctx.emit(boxFromScope(band, { id: preset.bandGroup }), part);
    }
    for (const face of sideFaces(chunkScope)) {
      ctx.derive('Facade', face, { ...ctx.data!, windows }, part);
    }
  });

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
      ctx.emit(
        panelFromFace(faceRect(face, x, y, width, 0.22), ctx.params.canopyDepth, { id: 'frame' }),
        chunkParts[0]
      );
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
      const part = `mass${index}`;
      ctx.derive(mass.ground ? 'BaseMass' : 'Mass', mass.scope, data, part);
      const top = offsetLocal(mass.scope, 'y', mass.scope.size[1]);
      const deck = createScope([mass.scope.size[0], 0, mass.scope.size[2]], top.origin, top.basis);
      ctx.derive(index === masses.length - 1 ? 'Roof' : 'Terrace', deck, data, part);
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
    // A ribbon facade has no intermediate piers, but its lights still go bay by bay
    emitLitPanes(
      (node) => ctx.emit(node),
      ctx.rng,
      face,
      bayOpenings(face.size[0], preset.cornerPierWidth, preset.bayWidth, preset.pierWidth),
      ctx.data?.windows ?? [],
      preset.insetDepth,
      ctx.params.litWindowChance
    );
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
 * Builds a scheme. `frame` covers the mullions of a curtain wall but also the piers of a
 * punched or ribbon facade, so a scheme whose walls are masonry gives its frame the wall's
 * colour and keeps curtain walls out through its facade weights.
 */
function scheme(
  id: string,
  displayName: string,
  weight: number,
  palette: Record<MaterialGroup, MaterialHint>,
  facades: { curtain: number; punched: number; banded: number }
): MaterialScheme {
  return {
    id,
    displayName,
    weight,
    palette,
    params: {
      curtainWeight: facades.curtain,
      punchedWeight: facades.punched,
      bandedWeight: facades.banded
    }
  };
}

/** Clear glass: a dielectric, its look coming from the sky it reflects */
const CLEAR_GLASS: MaterialHint = {
  albedo: [0.02, 0.025, 0.03],
  metallic: 0,
  roughness: 0.05,
  variation: 0.2
};

/**
 * Looks of real buildings, for a block that should read as a believable city. Linear albedo
 * within the range of real materials, from dark bronze glass to white render.
 */
const REALISTIC_SCHEMES: MaterialScheme[] = [
  scheme(
    'blue-glass',
    'Blue glass tower',
    1.2,
    {
      glass: { albedo: [0.018, 0.04, 0.055], metallic: 0, roughness: 0.05, variation: 0.25 },
      frame: { albedo: [0.45, 0.46, 0.48], metallic: 0.9, roughness: 0.3, variation: 0.1 },
      wall: { albedo: [0.32, 0.32, 0.33], metallic: 0, roughness: 0.7, variation: 0.15 },
      trim: { albedo: [0.22, 0.22, 0.23], metallic: 0, roughness: 0.8, variation: 0.1 }
    },
    { curtain: 3, punched: 0, banded: 0.6 }
  ),
  scheme(
    'bronze-glass',
    'Bronze glass tower',
    0.6,
    {
      glass: { albedo: [0.04, 0.034, 0.024], metallic: 0, roughness: 0.05, variation: 0.2 },
      frame: { albedo: [0.2, 0.13, 0.07], metallic: 0.9, roughness: 0.35, variation: 0.15 },
      wall: { albedo: [0.12, 0.11, 0.1], metallic: 0, roughness: 0.7, variation: 0.15 },
      trim: { albedo: [0.18, 0.17, 0.16], metallic: 0, roughness: 0.8, variation: 0.1 }
    },
    { curtain: 2, punched: 0, banded: 1 }
  ),
  scheme(
    'limestone',
    'Limestone',
    1,
    {
      glass: CLEAR_GLASS,
      frame: { albedo: [0.4, 0.35, 0.26], metallic: 0, roughness: 0.8, variation: 0.12 },
      wall: { albedo: [0.44, 0.38, 0.28], metallic: 0, roughness: 0.8, variation: 0.12 },
      trim: { albedo: [0.3, 0.27, 0.21], metallic: 0, roughness: 0.85, variation: 0.1 }
    },
    { curtain: 0, punched: 2.5, banded: 1 }
  ),
  scheme(
    'red-brick',
    'Red brick',
    1,
    {
      glass: CLEAR_GLASS,
      frame: { albedo: [0.22, 0.068, 0.038], metallic: 0, roughness: 0.85, variation: 0.2 },
      wall: { albedo: [0.25, 0.075, 0.04], metallic: 0, roughness: 0.85, variation: 0.2 },
      trim: { albedo: [0.36, 0.34, 0.3], metallic: 0, roughness: 0.8, variation: 0.1 }
    },
    { curtain: 0, punched: 3, banded: 0.5 }
  ),
  scheme(
    'white-render',
    'White render',
    1,
    {
      glass: { albedo: [0.02, 0.03, 0.04], metallic: 0, roughness: 0.05, variation: 0.2 },
      frame: { albedo: [0.6, 0.58, 0.54], metallic: 0, roughness: 0.75, variation: 0.06 },
      wall: { albedo: [0.62, 0.6, 0.56], metallic: 0, roughness: 0.75, variation: 0.06 },
      trim: { albedo: [0.4, 0.39, 0.37], metallic: 0, roughness: 0.8, variation: 0.08 }
    },
    { curtain: 0, punched: 1, banded: 2 }
  ),
  scheme(
    'terracotta',
    'Terracotta',
    0.7,
    {
      glass: CLEAR_GLASS,
      frame: { albedo: [0.36, 0.13, 0.05], metallic: 0, roughness: 0.8, variation: 0.15 },
      wall: { albedo: [0.4, 0.15, 0.06], metallic: 0, roughness: 0.8, variation: 0.15 },
      trim: { albedo: [0.45, 0.4, 0.33], metallic: 0, roughness: 0.8, variation: 0.1 }
    },
    { curtain: 0, punched: 1.5, banded: 2 }
  )
];

/** One saturated colour for a whole facade, framed by a pale roof */
function vivid(id: string, displayName: string, albedo: [number, number, number]): MaterialScheme {
  return scheme(
    id,
    displayName,
    1,
    {
      glass: CLEAR_GLASS,
      frame: { albedo: [albedo[0] * 0.9, albedo[1] * 0.9, albedo[2] * 0.9], metallic: 0, roughness: 0.8 },
      wall: { albedo, metallic: 0, roughness: 0.8 },
      trim: { albedo: [0.7, 0.7, 0.7], metallic: 0, roughness: 0.8 }
    },
    // Solid facades: a curtain wall would hide the colour behind glass
    { curtain: 0, punched: 2, banded: 1 }
  );
}

/**
 * Strong, flat colours with no per-building drift, for testing global illumination: colour
 * bleeding between facades and onto the street shows plainly. Albedo stays at or below 0.8.
 */
const VIVID_SCHEMES: MaterialScheme[] = [
  vivid('red', 'Red', [0.65, 0.05, 0.03]),
  vivid('green', 'Green', [0.08, 0.45, 0.08]),
  vivid('blue', 'Blue', [0.05, 0.12, 0.6]),
  vivid('yellow', 'Yellow', [0.75, 0.55, 0.03]),
  vivid('orange', 'Orange', [0.8, 0.25, 0.03]),
  vivid('white', 'White', [0.8, 0.8, 0.8])
];

/**
 * A contemporary office building in one of three facade languages: glass curtain
 * wall, punched windows, or horizontal ribbons — with an optional podium, setback
 * and a plant-cluttered roof.
 *
 * This is the reference ruleset. A new style registers its own {@link Ruleset} and
 * needs no changes here or in the engine.
 *
 * Besides its reference {@link Ruleset.palette}, it offers two scheme sets: `realistic`,
 * real facade materials from glass towers to brick and render, and `vivid`, saturated flat
 * colours for testing global illumination.
 *
 * @public
 */
export const modernOffice: Ruleset<ModernOfficeParams, ModernOfficeData> = {
  id: 'modern-office',
  displayName: 'Modern office',
  axiom: 'Building',
  defaultParams: DEFAULTS,
  palette: PALETTE,
  schemeSets: { realistic: REALISTIC_SCHEMES, vivid: VIVID_SCHEMES },
  envelopeHeight: modernOfficeHeight,
  rules
};

/** The built-in facade presets, keyed by style. @public */
export const facadePresets: Readonly<Record<FacadeStyle, FacadePreset>> = PRESETS;
