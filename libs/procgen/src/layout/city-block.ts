import type { GeneratedModelSpec, ProceduralNode } from '@zephyr3d/modelgen';
import { Random } from '../random';
import { buildSocketModel, type WfcTileDef } from '../wfc/model';
import { solveWfc } from '../wfc/solve';

/**
 * What a solved cell is used for.
 * @public
 */
export type CityCellKind = 'road' | 'lot' | 'plaza';

/** Payload carried by each city tile. @public */
export interface CityTileData {
  kind: CityCellKind;
  /** Road connections in `[+X, -X, +Z, -Z]` order. */
  links: [boolean, boolean, boolean, boolean];
}

const R = 'road';
const L = 'land';

function road(
  id: string,
  links: [boolean, boolean, boolean, boolean],
  weight: number
): WfcTileDef<CityTileData> {
  return {
    id,
    weight,
    sockets: links.map((linked) => (linked ? R : L)) as [string, string, string, string],
    data: { kind: 'road', links }
  };
}

/**
 * The built-in street tile set.
 *
 * Note what is *absent*: there is no dead-end tile. Every road tile joins at least
 * two sides, so the network can never terminate mid-block. Combined with a forced
 * ring of road around the boundary, that removes the orphan-stub failure mode
 * without needing a connectivity check after the fact — which is the kind of global
 * constraint plain WFC cannot express.
 *
 * @public
 */
export const cityBlockTiles: readonly WfcTileDef<CityTileData>[] = [
  road('road-ew', [true, true, false, false], 2.2),
  road('road-ns', [false, false, true, true], 2.2),
  road('road-corner-xp-zp', [true, false, true, false], 0.5),
  road('road-corner-xp-zn', [true, false, false, true], 0.5),
  road('road-corner-xn-zp', [false, true, true, false], 0.5),
  road('road-corner-xn-zn', [false, true, false, true], 0.5),
  road('road-t-no-xp', [false, true, true, true], 0.4),
  road('road-t-no-xn', [true, false, true, true], 0.4),
  road('road-t-no-zp', [true, true, false, true], 0.4),
  road('road-t-no-zn', [true, true, true, false], 0.4),
  road('road-cross', [true, true, true, true], 0.35),
  {
    id: 'lot',
    // Weighed against the *sum* of the road variants above (~8.3), not against any
    // one of them: eleven road tiles competing with one lot tile is what turns a
    // block into a car park.
    weight: 22,
    sockets: [L, L, L, L],
    data: { kind: 'lot', links: [false, false, false, false] }
  },
  {
    id: 'plaza',
    weight: 1.5,
    sockets: [L, L, L, L],
    data: { kind: 'plaza', links: [false, false, false, false] }
  }
];

/**
 * A buildable rectangle in world space, ready to hand to a building generator.
 * @public
 */
export interface CityParcel {
  /** Minimum corner on X. */
  x: number;
  /** Minimum corner on Z. */
  z: number;
  width: number;
  depth: number;
  /** How many grid cells the parcel covers, before setbacks were applied. */
  cells: number;
  /**
   * Which sides of the parcel face a street, in `[+X, -X, +Z, -Z]` order — the same
   * order as {@link sideFaces} and the tile socket arrays.
   *
   * A caller uses this to point entrances at the street. All four are false for a
   * landlocked parcel, which the interior of a large block can still produce.
   */
  frontage: [boolean, boolean, boolean, boolean];
  /** Bit `i` set when `frontage[i]` is true; convenient to pass as a style parameter. */
  frontageMask: number;
}

/**
 * Options for {@link generateCityBlock}.
 * @public
 */
export interface CityBlockOptions {
  /** Grid width in cells. */
  width: number;
  /** Grid depth in cells. */
  height: number;
  /** World size of one cell. Defaults to 18. */
  cellSize?: number;
  /** Random seed. */
  seed?: number;
  /**
   * Gap between a street-facing parcel edge and the building. Small, so buildings
   * line the street the way they do in a real block. Defaults to 1.8.
   */
  frontSetback?: number;
  /**
   * Gap on edges that do not face a street. Larger, which pushes the slack into the
   * middle of the block as rear yards instead of spreading every building evenly.
   * Defaults to 5.5.
   */
  rearSetback?: number;
  /** Largest parcel span in cells along X. Defaults to 3. */
  maxParcelWidth?: number;
  /** Largest parcel span in cells along Z. Defaults to 2. */
  maxParcelDepth?: number;
  /** World position of the block's minimum corner. Defaults to centring on the origin. */
  origin?: [number, number];
}

/**
 * A solved city block.
 * @public
 */
export interface CityBlockLayout {
  width: number;
  height: number;
  cellSize: number;
  origin: [number, number];
  /** Cell usage indexed `[z][x]`. */
  kinds: CityCellKind[][];
  /** The collapsed tiles, for callers that care about road orientation. */
  tiles: WfcTileDef<CityTileData>[][];
  /** Buildable rectangles, in world space. */
  parcels: CityParcel[];
  /** How many solver attempts were needed. */
  attempts: number;
}

const model = buildSocketModel(cityBlockTiles);

/**
 * Generates a street layout and the parcels between the streets.
 *
 * The road network comes from wave function collapse — local adjacency producing
 * global variety is exactly what it is good at. Building *shape* is deliberately not
 * WFC's job here; the parcels it produces are handed to a shape grammar instead.
 *
 * @example
 * ```ts
 * const block = generateCityBlock({ width: 7, height: 6, seed: 3 });
 * for (const parcel of block.parcels) {
 *   generateBuilding({ footprint: [parcel.width, parcel.depth], origin: [parcel.x, 0, parcel.z] });
 * }
 * ```
 *
 * @public
 */
export function generateCityBlock(options: CityBlockOptions): CityBlockLayout {
  const { width, height } = options;
  const cellSize = options.cellSize ?? 18;
  const frontSetback = options.frontSetback ?? 1.8;
  const rearSetback = options.rearSetback ?? 5.5;
  const maxParcelWidth = Math.max(1, options.maxParcelWidth ?? 3);
  const maxParcelDepth = Math.max(1, options.maxParcelDepth ?? 2);
  const origin = options.origin ?? [(-width * cellSize) / 2, (-height * cellSize) / 2];

  const result = solveWfc(model, {
    width,
    height,
    seed: options.seed ?? 0,
    // Ring the block in road so the network always reaches the outside world, and so
    // no parcel ends up landlocked.
    fixed: (x, z) => boundaryTiles(x, z, width, height)
  });

  const kinds: CityCellKind[][] = result.tiles.map((row) => row.map((tile) => tile.data!.kind));

  const rng = new Random((options.seed ?? 0) ^ 0x5bf03635);
  const claimed: boolean[][] = kinds.map((row) => row.map(() => false));
  const parcels: CityParcel[] = [];

  const buildable = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < width && z < height && kinds[z][x] === 'lot' && !claimed[z][x];

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (!buildable(x, z)) {
        continue;
      }
      // Grow a rectangle greedily. Varying the cap per parcel is what stops the block
      // reading as a uniform grid of identically sized buildings.
      const capW = rng.int(1, maxParcelWidth);
      const capD = rng.int(1, maxParcelDepth);
      let spanX = 1;
      while (spanX < capW && buildable(x + spanX, z)) {
        spanX++;
      }
      let spanZ = 1;
      while (spanZ < capD) {
        let rowFree = true;
        for (let i = 0; i < spanX; i++) {
          if (!buildable(x + i, z + spanZ)) {
            rowFree = false;
            break;
          }
        }
        if (!rowFree) {
          break;
        }
        spanZ++;
      }
      for (let dz = 0; dz < spanZ; dz++) {
        for (let dx = 0; dx < spanX; dx++) {
          claimed[z + dz][x + dx] = true;
        }
      }

      const isRoad = (cx: number, cz: number) =>
        cx >= 0 && cz >= 0 && cx < width && cz < height && kinds[cz][cx] === 'road';

      // A side fronts the street if any cell just past it is carriageway.
      const frontage: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      for (let dz = 0; dz < spanZ; dz++) {
        frontage[0] ||= isRoad(x + spanX, z + dz);
        frontage[1] ||= isRoad(x - 1, z + dz);
      }
      for (let dx = 0; dx < spanX; dx++) {
        frontage[2] ||= isRoad(x + dx, z + spanZ);
        frontage[3] ||= isRoad(x + dx, z - 1);
      }
      // A landlocked parcel has no street to line up with, so it keeps an even gap
      // all round rather than being shoved into a corner.
      const anyFrontage = frontage.some(Boolean);
      const gap = (fronting: boolean) =>
        anyFrontage ? (fronting ? frontSetback : rearSetback) : frontSetback;

      const cellX0 = origin[0] + x * cellSize;
      const cellZ0 = origin[1] + z * cellSize;
      const minX = cellX0 + gap(frontage[1]);
      const maxX = cellX0 + spanX * cellSize - gap(frontage[0]);
      const minZ = cellZ0 + gap(frontage[3]);
      const maxZ = cellZ0 + spanZ * cellSize - gap(frontage[2]);
      if (maxX - minX <= 0 || maxZ - minZ <= 0) {
        continue;
      }
      parcels.push({
        x: minX,
        z: minZ,
        width: maxX - minX,
        depth: maxZ - minZ,
        cells: spanX * spanZ,
        frontage,
        frontageMask: frontage.reduce((mask, on, i) => mask | (on ? 1 << i : 0), 0)
      });
    }
  }

  return { width, height, cellSize, origin, kinds, tiles: result.tiles, parcels, attempts: result.attempts };
}

/** Tile ids permitted on the forced boundary ring, or null for interior cells. */
function boundaryTiles(x: number, z: number, width: number, height: number): string[] | null {
  const west = x === 0;
  const east = x === width - 1;
  const north = z === 0;
  const south = z === height - 1;
  if (!west && !east && !north && !south) {
    return null;
  }
  // Corners can only turn the one way that stays on the ring.
  if (west && north) {
    return ['road-corner-xp-zp'];
  }
  if (east && north) {
    return ['road-corner-xn-zp'];
  }
  if (west && south) {
    return ['road-corner-xp-zn'];
  }
  if (east && south) {
    return ['road-corner-xn-zn'];
  }
  // Edges run along the ring and may branch inward, but never outward.
  if (north) {
    return ['road-ew', 'road-t-no-zn'];
  }
  if (south) {
    return ['road-ew', 'road-t-no-zp'];
  }
  if (west) {
    return ['road-ns', 'road-t-no-xn'];
  }
  return ['road-ns', 'road-t-no-xp'];
}

/**
 * Options for {@link cityBlockGroundSpec}.
 * @public
 */
export interface CityGroundOptions {
  /** Carriageway width. Defaults to 45% of the cell, leaving verges either side. */
  roadWidth?: number;
  /** Slab thickness; sits just above y=0 to avoid coplanar faces with the ground. */
  thickness?: number;
}

/**
 * Emits the ground plane of a block: the carriageway, and a slab per plaza cell.
 *
 * A road cell does not pave its whole cell. It draws one arm from the cell centre
 * towards each side it actually connects to, so the result is a street network of
 * believable width with verges between the kerb and the building line — paving the
 * full cell turns a modest block into an airfield.
 *
 * Nodes are tagged `'road'` and `'plaza'` so they can be split into material groups
 * the same way building geometry is.
 *
 * @public
 */
export function cityBlockGroundSpec(
  layout: CityBlockLayout,
  options: CityGroundOptions = {}
): GeneratedModelSpec {
  const nodes: ProceduralNode[] = [];
  const { cellSize, origin } = layout;
  const thickness = options.thickness ?? 0.08;
  const roadWidth = Math.min(cellSize, options.roadWidth ?? cellSize * 0.45);
  const arm = cellSize * 0.5;
  const y = thickness * 0.5;

  for (let z = 0; z < layout.height; z++) {
    for (let x = 0; x < layout.width; x++) {
      const kind = layout.kinds[z][x];
      const cx = origin[0] + (x + 0.5) * cellSize;
      const cz = origin[1] + (z + 0.5) * cellSize;

      if (kind === 'plaza') {
        nodes.push({
          type: 'box',
          id: 'plaza',
          size: [cellSize, thickness, cellSize],
          position: [cx, y, cz]
        });
        continue;
      }
      if (kind !== 'road') {
        continue;
      }

      // The junction square, which also fills the elbow of a corner tile.
      nodes.push({
        type: 'box',
        id: 'road',
        size: [roadWidth, thickness, roadWidth],
        position: [cx, y, cz]
      });

      const links = layout.tiles[z][x].data!.links;
      // [+X, -X, +Z, -Z]
      const arms: [number, number, number, number][] = [
        [arm, roadWidth, cx + arm * 0.5, cz],
        [arm, roadWidth, cx - arm * 0.5, cz],
        [roadWidth, arm, cx, cz + arm * 0.5],
        [roadWidth, arm, cx, cz - arm * 0.5]
      ];
      for (let dir = 0; dir < 4; dir++) {
        if (!links[dir]) {
          continue;
        }
        const [sx, sz, px, pz] = arms[dir];
        nodes.push({
          type: 'box',
          id: 'road',
          size: [sx, thickness, sz],
          position: [px, y, pz]
        });
      }
    }
  }
  return { version: 1, nodes };
}
