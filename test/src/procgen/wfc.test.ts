import {
  buildSocketModel,
  cityBlockGroundSpec,
  cityBlockTiles,
  generateCityBlock,
  OPPOSITE,
  solveWfc,
  type CityBlockLayout,
  type WfcModel,
  type WfcTileDef
} from '@zephyr3d/procgen';

/** Asserts every adjacent pair in a solved grid has matching sockets. */
function expectArcConsistent<T>(
  tiles: WfcTileDef<T>[][],
  match: (a: string, b: string) => boolean = (a, b) => a === b
): void {
  const height = tiles.length;
  const width = tiles[0].length;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const here = tiles[z][x];
      if (x + 1 < width) {
        expect(match(here.sockets[0], tiles[z][x + 1].sockets[OPPOSITE[0]])).toBe(true);
      }
      if (z + 1 < height) {
        expect(match(here.sockets[2], tiles[z + 1][x].sockets[OPPOSITE[2]])).toBe(true);
      }
    }
  }
}

describe('procgen / wfc model', () => {
  it('rejects an empty tile set', () => {
    expect(() => buildSocketModel([])).toThrow(/at least one tile/);
    expect(() => buildSocketModel([{ id: 'a', weight: 0, sockets: ['x', 'x', 'x', 'x'] }])).toThrow(
      /at least one tile/
    );
  });

  it('rejects duplicate tile ids', () => {
    expect(() =>
      buildSocketModel([
        { id: 'a', sockets: ['x', 'x', 'x', 'x'] },
        { id: 'a', sockets: ['y', 'y', 'y', 'y'] }
      ])
    ).toThrow(/Duplicate WFC tile id "a"/);
  });

  it('builds an adjacency table from socket equality', () => {
    const model: WfcModel = buildSocketModel([
      { id: 'p', sockets: ['p', 'p', 'p', 'p'] },
      { id: 'q', sockets: ['q', 'q', 'q', 'q'] }
    ]);
    // Tile 0 may only sit beside tile 0, so only bit 0 is set in every direction.
    for (let dir = 0; dir < 4; dir++) {
      expect(model.allowed[dir][0][0]).toBe(0b01);
      expect(model.allowed[dir][1][0]).toBe(0b10);
    }
  });
});

describe('procgen / wfc solver', () => {
  const twoColour = [
    { id: 'p', sockets: ['p', 'p', 'p', 'p'] as [string, string, string, string] },
    { id: 'q', sockets: ['q', 'q', 'q', 'q'] as [string, string, string, string] }
  ];

  it('fills a grid with a single tile when that is the only option', () => {
    const model = buildSocketModel([{ id: 'only', sockets: ['s', 's', 's', 's'] }]);
    const result = solveWfc(model, { width: 5, height: 4, seed: 1 });
    expect(result.tiles).toHaveLength(4);
    expect(result.tiles[0]).toHaveLength(5);
    for (const row of result.tiles) {
      for (const tile of row) {
        expect(tile.id).toBe('only');
      }
    }
  });

  it('honours socket rules: incompatible tiles never end up adjacent', () => {
    const model = buildSocketModel(twoColour);
    for (let seed = 0; seed < 6; seed++) {
      const result = solveWfc(model, { width: 6, height: 6, seed });
      expectArcConsistent(result.tiles);
      // These two never match, so the whole grid must settle on one of them.
      const ids = new Set(result.tiles.flat().map((tile) => tile.id));
      expect(ids.size).toBe(1);
    }
  });

  it('supports a custom socket matcher', () => {
    // "Different sockets attract" forces a checkerboard.
    const model = buildSocketModel(twoColour, (a, b) => a !== b);
    const result = solveWfc(model, { width: 7, height: 5, seed: 2 });
    expectArcConsistent(result.tiles, (a, b) => a !== b);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 7; x++) {
        const expected = (x + z) % 2 === 0 ? result.tiles[0][0].id : result.tiles[0][1].id;
        expect(result.tiles[z][x].id).toBe(expected);
      }
    }
  });

  it('applies fixed cells as boundary conditions', () => {
    const model = buildSocketModel(twoColour, (a, b) => a !== b);
    const result = solveWfc(model, {
      width: 4,
      height: 4,
      seed: 5,
      fixed: (x, z) => (x === 0 && z === 0 ? ['q'] : null)
    });
    expect(result.tiles[0][0].id).toBe('q');
    expect(result.tiles[0][1].id).toBe('p');
  });

  it('rejects a fixed cell naming an unknown tile', () => {
    const model = buildSocketModel(twoColour);
    expect(() =>
      solveWfc(model, { width: 3, height: 3, fixed: () => ['nope'] })
    ).toThrow(/unknown tile id "nope"/);
  });

  it('gives up with a clear message when the tile set is over-constrained', () => {
    const model = buildSocketModel(twoColour);
    expect(() =>
      solveWfc(model, {
        width: 3,
        height: 3,
        maxAttempts: 3,
        // 'p' and 'q' cannot be adjacent, so opposite fixed corners is unsatisfiable.
        fixed: (x, z) => {
          if (x === 0 && z === 0) {
            return ['p'];
          }
          return x === 2 && z === 2 ? ['q'] : null;
        }
      })
    ).toThrow(/failed after 3 attempts/);
  });

  it('rejects a degenerate grid size', () => {
    const model = buildSocketModel(twoColour);
    expect(() => solveWfc(model, { width: 0, height: 4 })).toThrow(/must be positive integers/);
    expect(() => solveWfc(model, { width: 3, height: 2.5 })).toThrow(/must be positive integers/);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const model = buildSocketModel(cityBlockTiles);
    const render = (seed: number) =>
      solveWfc(model, { width: 6, height: 6, seed })
        .tiles.map((row) => row.map((tile) => tile.id).join('|'))
        .join('/');
    expect(render(11)).toBe(render(11));
    const shapes = new Set([render(1), render(2), render(3), render(4), render(5)]);
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('respects tile weights', () => {
    const model = buildSocketModel([
      { id: 'common', weight: 20, sockets: ['s', 's', 's', 's'] },
      { id: 'rare', weight: 1, sockets: ['s', 's', 's', 's'] }
    ]);
    let common = 0;
    let rare = 0;
    for (let seed = 0; seed < 8; seed++) {
      for (const tile of solveWfc(model, { width: 10, height: 10, seed }).tiles.flat()) {
        if (tile.id === 'common') {
          common++;
        } else {
          rare++;
        }
      }
    }
    expect(common).toBeGreaterThan(rare * 4);
  });
});

describe('procgen / city block layout', () => {
  const layouts: CityBlockLayout[] = [];
  for (let seed = 0; seed < 10; seed++) {
    layouts.push(generateCityBlock({ width: 7, height: 6, seed }));
  }

  it('rings the block in road so it connects to the outside', () => {
    for (const layout of layouts) {
      for (let x = 0; x < layout.width; x++) {
        expect(layout.kinds[0][x]).toBe('road');
        expect(layout.kinds[layout.height - 1][x]).toBe('road');
      }
      for (let z = 0; z < layout.height; z++) {
        expect(layout.kinds[z][0]).toBe('road');
        expect(layout.kinds[z][layout.width - 1]).toBe('road');
      }
    }
  });

  it('never leaves a road stub: every link lands on a matching link', () => {
    for (const layout of layouts) {
      for (let z = 0; z < layout.height; z++) {
        for (let x = 0; x < layout.width; x++) {
          const links = layout.tiles[z][x].data!.links;
          const neighbours: [number, number][] = [
            [x + 1, z],
            [x - 1, z],
            [x, z + 1],
            [x, z - 1]
          ];
          for (let dir = 0; dir < 4; dir++) {
            if (!links[dir]) {
              continue;
            }
            const [nx, nz] = neighbours[dir];
            if (nx < 0 || nz < 0 || nx >= layout.width || nz >= layout.height) {
              // Only the boundary ring may point outward, and it never does.
              expect(`${x},${z} dir ${dir}`).toBe('inside the grid');
            }
            expect(layout.tiles[nz][nx].data!.links[OPPOSITE[dir]]).toBe(true);
          }
        }
      }
    }
  });

  it('keeps the whole road network reachable from the ring', () => {
    for (const layout of layouts) {
      const seen = new Set<number>();
      const stack = [0];
      while (stack.length > 0) {
        const cell = stack.pop()!;
        if (seen.has(cell)) {
          continue;
        }
        seen.add(cell);
        const x = cell % layout.width;
        const z = (cell / layout.width) | 0;
        const links = layout.tiles[z][x].data!.links;
        const steps: [number, number][] = [
          [x + 1, z],
          [x - 1, z],
          [x, z + 1],
          [x, z - 1]
        ];
        for (let dir = 0; dir < 4; dir++) {
          if (!links[dir]) {
            continue;
          }
          const [nx, nz] = steps[dir];
          if (nx >= 0 && nz >= 0 && nx < layout.width && nz < layout.height) {
            stack.push(nz * layout.width + nx);
          }
        }
      }
      let roadCells = 0;
      for (let z = 0; z < layout.height; z++) {
        for (let x = 0; x < layout.width; x++) {
          if (layout.kinds[z][x] === 'road') {
            roadCells++;
          }
        }
      }
      expect(seen.size).toBe(roadCells);
    }
  });

  it('produces parcels that never overlap and never sit on a road', () => {
    for (const layout of layouts) {
      expect(layout.parcels.length).toBeGreaterThan(0);
      for (let a = 0; a < layout.parcels.length; a++) {
        const p = layout.parcels[a];
        // Inside the block, and clear of the boundary ring.
        expect(p.x).toBeGreaterThanOrEqual(layout.origin[0] + layout.cellSize);
        expect(p.z).toBeGreaterThanOrEqual(layout.origin[1] + layout.cellSize);
        expect(p.x + p.width).toBeLessThanOrEqual(
          layout.origin[0] + (layout.width - 1) * layout.cellSize + 1e-6
        );
        expect(p.z + p.depth).toBeLessThanOrEqual(
          layout.origin[1] + (layout.height - 1) * layout.cellSize + 1e-6
        );
        for (let b = a + 1; b < layout.parcels.length; b++) {
          const q = layout.parcels[b];
          const disjoint =
            p.x + p.width <= q.x + 1e-9 ||
            q.x + q.width <= p.x + 1e-9 ||
            p.z + p.depth <= q.z + 1e-9 ||
            q.z + q.depth <= p.z + 1e-9;
          expect(disjoint).toBe(true);
        }
      }
    }
  });

  it('covers every buildable cell with exactly one parcel', () => {
    for (const layout of layouts) {
      let lotCells = 0;
      for (let z = 0; z < layout.height; z++) {
        for (let x = 0; x < layout.width; x++) {
          if (layout.kinds[z][x] === 'lot') {
            lotCells++;
          }
        }
      }
      const claimed = layout.parcels.reduce((sum, parcel) => sum + parcel.cells, 0);
      expect(claimed).toBe(lotCells);
    }
  });

  it('leaves most of the interior buildable rather than paving it over', () => {
    // Road variants outnumber lot tiles eleven to one, so without a weight that
    // accounts for their combined mass the solver tiles the block with tarmac.
    let interior = 0;
    let lots = 0;
    for (const layout of layouts) {
      for (let z = 1; z < layout.height - 1; z++) {
        for (let x = 1; x < layout.width - 1; x++) {
          interior++;
          if (layout.kinds[z][x] !== 'road') {
            lots++;
          }
        }
      }
    }
    expect(lots / interior).toBeGreaterThan(0.6);
  });

  it('is deterministic for a seed', () => {
    const a = generateCityBlock({ width: 6, height: 5, seed: 21 });
    const b = generateCityBlock({ width: 6, height: 5, seed: 21 });
    expect(JSON.stringify(b.parcels)).toBe(JSON.stringify(a.parcels));
    expect(b.kinds).toEqual(a.kinds);
  });

  it('draws roads as connected arms rather than paving whole cells', () => {
    const layout = generateCityBlock({ width: 6, height: 5, seed: 4 });
    const spec = cityBlockGroundSpec(layout);
    let roadCells = 0;
    let plazaCells = 0;
    let expectedRoadNodes = 0;
    for (let z = 0; z < layout.height; z++) {
      for (let x = 0; x < layout.width; x++) {
        const kind = layout.kinds[z][x];
        if (kind === 'road') {
          roadCells++;
          // One junction square plus one arm per connection.
          expectedRoadNodes += 1 + layout.tiles[z][x].data!.links.filter(Boolean).length;
        } else if (kind === 'plaza') {
          plazaCells++;
        }
      }
    }
    const byId = { road: 0, plaza: 0 } as Record<string, number>;
    for (const node of spec.nodes!) {
      expect(['road', 'plaza']).toContain(node.id);
      byId[node.id!]++;
    }
    expect(byId.road).toBe(expectedRoadNodes);
    expect(byId.plaza).toBe(plazaCells);
    // The whole point: a road cell is not a fully paved cell.
    expect(byId.road).toBeGreaterThan(roadCells);

    // Carriageway must be narrower than the cell, or the verges vanish.
    const junction = spec.nodes!.find((node) => node.id === 'road') as { size: number[] };
    expect(junction.size[0]).toBeLessThan(layout.cellSize);
  });
});
