/**
 * Direction index on the 2D grid: `0` = +X, `1` = -X, `2` = +Z, `3` = -Z.
 *
 * Socket arrays on {@link WfcTileDef} follow this same order.
 *
 * @public
 */
export type Direction = 0 | 1 | 2 | 3;

/** Grid step for each {@link Direction}, as `[dx, dz]`. @public */
export const DIRECTION_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

/** The direction facing back the other way. @public */
export const OPPOSITE: readonly Direction[] = [1, 0, 3, 2];

/**
 * One tile in a wave function collapse tile set.
 *
 * A tile is pure data: the solver never inspects {@link WfcTileDef.data}, it only
 * matches sockets. That is what keeps the solver reusable for street layouts,
 * dungeon rooms or anything else with local adjacency rules.
 *
 * @public
 */
export interface WfcTileDef<T = unknown> {
  /** Identifier, unique within a tile set. */
  id: string;
  /** Relative likelihood when collapsing. Defaults to 1. Zero excludes the tile. */
  weight?: number;
  /** Edge sockets in `[+X, -X, +Z, -Z]` order. */
  sockets: [string, string, string, string];
  /** Caller payload carried through to the result. */
  data?: T;
}

/**
 * Decides whether two socket strings may face each other across a cell boundary.
 *
 * The default is equality, which is all a symmetric tile set needs. A tile set with
 * handed tiles (a mesh that only fits one way round) supplies its own matcher.
 *
 * @public
 */
export type SocketMatcher = (a: string, b: string) => boolean;

/**
 * A tile set with its adjacency table precomputed.
 *
 * Adjacency is stored as one bitset per (tile, direction): bit `t` is set when tile
 * `t` may sit on that side. Precomputing turns the inner loop of propagation into
 * bitwise ORs and ANDs rather than repeated socket comparisons.
 *
 * @public
 */
export interface WfcModel<T = unknown> {
  tiles: readonly WfcTileDef<T>[];
  weights: readonly number[];
  /** Words per bitset; `ceil(tiles.length / 32)`. */
  words: number;
  /** `allowed[direction][tileIndex]` is a bitset of tiles permitted on that side. */
  allowed: readonly Uint32Array[][];
}

/**
 * Builds a {@link WfcModel} from a tile set by matching edge sockets.
 *
 * @param tiles - The tile set. Tiles with a weight of zero are dropped.
 * @param match - Socket compatibility test. Defaults to string equality.
 * @throws If the tile set is empty or contains duplicate ids.
 * @public
 */
export function buildSocketModel<T>(
  tiles: readonly WfcTileDef<T>[],
  match: SocketMatcher = (a, b) => a === b
): WfcModel<T> {
  const active = tiles.filter((tile) => (tile.weight ?? 1) > 0);
  if (active.length === 0) {
    throw new Error('A WFC tile set needs at least one tile with a positive weight');
  }
  const seen = new Set<string>();
  for (const tile of active) {
    if (seen.has(tile.id)) {
      throw new Error(`Duplicate WFC tile id "${tile.id}"`);
    }
    seen.add(tile.id);
  }

  const words = Math.max(1, Math.ceil(active.length / 32));
  const allowed: Uint32Array[][] = [];
  for (let dir = 0 as Direction; dir < 4; dir++) {
    const perTile: Uint32Array[] = [];
    for (let a = 0; a < active.length; a++) {
      const mask = new Uint32Array(words);
      for (let b = 0; b < active.length; b++) {
        // Tile `b` sits on side `dir` of tile `a`, so `a`'s socket on that side
        // faces `b`'s socket on the opposite side.
        if (match(active[a].sockets[dir], active[b].sockets[OPPOSITE[dir]])) {
          mask[b >>> 5] |= 1 << (b & 31);
        }
      }
      perTile.push(mask);
    }
    allowed.push(perTile);
  }

  return {
    tiles: active,
    weights: active.map((tile) => tile.weight ?? 1),
    words,
    allowed
  };
}
