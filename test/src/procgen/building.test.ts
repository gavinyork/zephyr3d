import { generatePrimitive, type GeneratedModelSpec } from '@zephyr3d/modelgen';
import {
  availableStyles,
  facadePresets,
  createScope,
  generateBuilding,
  listStyles,
  modernOffice,
  modernOfficeHeight,
  registerStyle,
  runGrammar,
  type ModernOfficeParams,
  type Ruleset
} from '@zephyr3d/procgen';

function tessellate(spec: GeneratedModelSpec) {
  return generatePrimitive(spec, Infinity);
}

/** Counts emitted nodes per material group tag. */
function countGroups(spec: GeneratedModelSpec): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of spec.nodes ?? []) {
    const id = node.id ?? '<untagged>';
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Facade relief stands slightly proud of the wall plane so vertical members are not
 * coplanar with the floor bands. It is the only projection once canopies are off, and
 * it is bounded by the presets rather than by a fudged tolerance.
 */
const RELIEF = Math.max(...Object.values(facadePresets).map((preset) => preset.pierProud));

describe('procgen / grammar engine', () => {
  interface P {
    depth: number;
  }

  const splitter: Ruleset<P> = {
    id: 'test-splitter',
    axiom: 'Root',
    defaultParams: { depth: 2 },
    rules: {
      Root(scope, ctx) {
        if (ctx.depth >= ctx.params.depth) {
          ctx.emit({ type: 'box', size: [...scope.size], position: [0, 0, 0] });
          return;
        }
        ctx.derive('Root', scope);
      }
    }
  };

  it('rewrites until the rules stop deriving', () => {
    const nodes = runGrammar(splitter, { scope: createScope([1, 1, 1]) });
    expect(nodes).toHaveLength(1);
  });

  it('merges caller params over the ruleset defaults', () => {
    const seen: number[] = [];
    const probe: Ruleset<{ a: number; b: number }> = {
      id: 'test-params',
      axiom: 'Root',
      defaultParams: { a: 1, b: 2 },
      rules: {
        Root(_scope, ctx) {
          seen.push(ctx.params.a, ctx.params.b);
        }
      }
    };
    runGrammar(probe, { scope: createScope([1, 1, 1]), params: { b: 99 } });
    expect(seen).toEqual([1, 99]);
  });

  it('rejects an unknown symbol instead of silently dropping it', () => {
    const broken: Ruleset<Record<string, never>> = {
      id: 'test-typo',
      axiom: 'Root',
      defaultParams: {},
      rules: {
        Root(scope, ctx) {
          ctx.derive('Facadde', scope);
        }
      }
    };
    expect(() => runGrammar(broken, { scope: createScope([1, 1, 1]) })).toThrow(
      /no rule for symbol "Facadde"/
    );
  });

  it('stops a runaway ruleset at the depth limit', () => {
    const runaway: Ruleset<Record<string, never>> = {
      id: 'test-runaway',
      axiom: 'Root',
      defaultParams: {},
      rules: {
        Root(scope, ctx) {
          ctx.derive('Root', scope);
        }
      }
    };
    expect(() => runGrammar(runaway, { scope: createScope([1, 1, 1]), maxDepth: 8 })).toThrow(
      /max derivation depth 8/
    );
  });

  it('stops a ruleset that emits without bound', () => {
    const spammer: Ruleset<Record<string, never>> = {
      id: 'test-spam',
      axiom: 'Root',
      defaultParams: {},
      rules: {
        Root(scope, ctx) {
          for (let i = 0; i < 100; i++) {
            ctx.emit({ type: 'box', size: [...scope.size], position: [0, 0, 0] });
          }
          ctx.derive('Root', scope);
        }
      }
    };
    expect(() => runGrammar(spammer, { scope: createScope([1, 1, 1]), maxNodes: 150 })).toThrow(
      /max node count 150/
    );
  });

  it('ignores null emissions so emitters can be chained', () => {
    const nullable: Ruleset<Record<string, never>> = {
      id: 'test-null',
      axiom: 'Root',
      defaultParams: {},
      rules: {
        Root(_scope, ctx) {
          ctx.emit(null);
        }
      }
    };
    expect(runGrammar(nullable, { scope: createScope([1, 1, 1]) })).toHaveLength(0);
  });

  it('carries a payload from a derivation to the symbol it derives', () => {
    const seen: (string | undefined)[] = [];
    const parameterized: Ruleset<Record<string, never>, string> = {
      id: 'test-derive-data',
      axiom: 'Root',
      defaultParams: {},
      rules: {
        Root(scope, ctx) {
          seen.push(ctx.data);
          ctx.derive('Leaf', scope, 'payload');
        },
        Leaf(_scope, ctx) {
          seen.push(ctx.data);
        }
      }
    };
    runGrammar(parameterized, { scope: createScope([1, 1, 1]) });
    // The axiom gets no payload; the derived symbol gets what was handed to it.
    expect(seen).toEqual([undefined, 'payload']);
  });
});

describe('procgen / style registry', () => {
  it('exposes the built-in modern office style', () => {
    expect(availableStyles()).toContain('modern-office');
    expect(listStyles()).toContain('modern-office');
  });

  it('accepts a caller-supplied style and rejects id collisions', () => {
    const custom: Ruleset<Record<string, never>> = {
      id: 'test-custom-style',
      axiom: 'Root',
      defaultParams: {},
      rules: {
        Root(_scope, ctx) {
          ctx.emit(null);
        }
      }
    };
    registerStyle(custom);
    expect(availableStyles()).toContain('test-custom-style');
    // Re-registering the same object is a no-op, a different one is a mistake.
    expect(() => registerStyle(custom)).not.toThrow();
    expect(() => registerStyle({ ...custom, axiom: 'Other' })).toThrow(/already registered/);
  });
});

describe('procgen / modern office buildings', () => {
  it('derives the envelope height from the floor counts', () => {
    const params: ModernOfficeParams = { ...modernOffice.defaultParams, floors: 10 };
    expect(modernOfficeHeight(params)).toBeNear(params.groundFloorHeight + 9 * params.floorHeight, 1e-9);
  });

  it('produces geometry that tessellates cleanly', () => {
    const result = tessellate(generateBuilding({ seed: 1, footprint: [24, 18] }));
    expect(result.vertexCount).toBeGreaterThan(100);
    expect(result.indexCount % 3).toBe(0);
    const normals = result.primitive.vertices.normal.data;
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeNear(1, 1e-3);
    }
  });

  it('stays inside its footprint so buildings can be packed into a block', () => {
    expect(RELIEF).toBeGreaterThan(0);
    expect(RELIEF).toBeLessThan(0.2);

    for (let seed = 0; seed < 12; seed++) {
      const width = 20;
      const depth = 16;
      // Canopies are the other deliberate exception to containment; excluded here so
      // the core guarantee is tested on its own.
      const result = tessellate(
        generateBuilding({ seed, footprint: [width, depth], params: { canopyChance: 0 } })
      );
      expect(result.boxMin[0]).toBeGreaterThanOrEqual(-RELIEF - 1e-4);
      expect(result.boxMin[2]).toBeGreaterThanOrEqual(-RELIEF - 1e-4);
      expect(result.boxMax[0]).toBeLessThanOrEqual(width + RELIEF + 1e-4);
      expect(result.boxMax[2]).toBeLessThanOrEqual(depth + RELIEF + 1e-4);
      expect(result.boxMin[1]).toBeGreaterThanOrEqual(-1e-4);
    }
  });

  it('bounds the canopy overhang so a caller can still reserve space', () => {
    const width = 20;
    const depth = 16;
    const canopyDepth = 2.2;
    for (let seed = 0; seed < 20; seed++) {
      const result = tessellate(
        generateBuilding({
          seed,
          footprint: [width, depth],
          params: { canopyChance: 1, canopyDepth }
        })
      );
      expect(result.boxMin[0]).toBeGreaterThanOrEqual(-canopyDepth - 1e-4);
      expect(result.boxMin[2]).toBeGreaterThanOrEqual(-canopyDepth - 1e-4);
      expect(result.boxMax[0]).toBeLessThanOrEqual(width + canopyDepth + 1e-4);
      expect(result.boxMax[2]).toBeLessThanOrEqual(depth + canopyDepth + 1e-4);
    }
  });

  it('honours the requested origin', () => {
    const result = tessellate(
      generateBuilding({
        seed: 3,
        footprint: [10, 10],
        origin: [100, 0, -50],
        params: { canopyChance: 0 }
      })
    );
    expect(result.boxMin[0]).toBeGreaterThanOrEqual(100 - RELIEF - 1e-4);
    expect(result.boxMax[0]).toBeLessThanOrEqual(110 + RELIEF + 1e-4);
    expect(result.boxMin[2]).toBeGreaterThanOrEqual(-50 - RELIEF - 1e-4);
    expect(result.boxMax[2]).toBeLessThanOrEqual(-40 + RELIEF + 1e-4);
  });

  it('reaches at least the envelope height, plus roof structure', () => {
    const params = { floors: 14 };
    const height = modernOfficeHeight({ ...modernOffice.defaultParams, ...params });
    const result = tessellate(generateBuilding({ seed: 5, footprint: [22, 22], params }));
    expect(result.boxMax[1]).toBeGreaterThanOrEqual(height - 1e-3);
    // Roof deck, parapet and plant boxes sit above the envelope, but not by much.
    expect(result.boxMax[1]).toBeLessThan(height + 6);
  });

  it('grows with the floor count', () => {
    const short = tessellate(generateBuilding({ seed: 2, footprint: [20, 20], params: { floors: 5 } }));
    const tall = tessellate(generateBuilding({ seed: 2, footprint: [20, 20], params: { floors: 25 } }));
    expect(tall.boxMax[1]).toBeGreaterThan(short.boxMax[1] * 2);
    expect(tall.vertexCount).toBeGreaterThan(short.vertexCount);
  });

  it('is deterministic for a given seed', () => {
    const a = generateBuilding({ seed: 42, footprint: [18, 14] });
    const b = generateBuilding({ seed: 42, footprint: [18, 14] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('varies between seeds', () => {
    const specs = new Set<string>();
    for (let seed = 0; seed < 8; seed++) {
      specs.add(JSON.stringify(generateBuilding({ seed, footprint: [18, 14] })));
    }
    expect(specs.size).toBeGreaterThan(1);
  });

  it('produces a spread of massing outcomes, not one silhouette', () => {
    // One 'glass' node is emitted per mass, so counting them measures whether the
    // podium / setback decisions actually diversify the silhouette.
    const massCounts = new Map<number, number>();
    for (let seed = 0; seed < 40; seed++) {
      const spec = generateBuilding({ seed, footprint: [22, 18] });
      const masses = (spec.nodes ?? []).filter((node) => node.id === 'glass').length;
      massCounts.set(masses, (massCounts.get(masses) ?? 0) + 1);
    }
    // Expect single-mass, setback and podium variants all to show up.
    expect(massCounts.size).toBeGreaterThanOrEqual(3);
    for (const count of massCounts.values()) {
      expect(count).toBeGreaterThan(1);
    }
  });

  it('tags every node with a material group', () => {
    const groups = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      for (const node of generateBuilding({ seed, footprint: [24, 18] }).nodes ?? []) {
        groups.add(node.id ?? '<untagged>');
      }
    }
    // Untagged geometry cannot be assigned a material, so it must never appear.
    expect(groups.has('<untagged>')).toBe(false);
    expect(groups).toEqual(new Set(['glass', 'frame', 'wall', 'trim']));
  });

  it('gives each facade style a distinct composition', () => {
    const only = (style: 'curtain' | 'punched' | 'banded') =>
      countGroups(
        generateBuilding({
          seed: 3,
          footprint: [24, 18],
          params: {
            curtainWeight: style === 'curtain' ? 1 : 0,
            punchedWeight: style === 'punched' ? 1 : 0,
            bandedWeight: style === 'banded' ? 1 : 0,
            // Pin the massing so only the facade differs between the three, and drop
            // the canopy, which is also a 'frame' node and would skew the counts.
            podiumChance: 0,
            setbackChance: 0,
            canopyChance: 0
          }
        })
      );

    const curtain = only('curtain');
    const punched = only('punched');
    const banded = only('banded');

    // A curtain wall's horizontal members are metal trim, not wall.
    expect(curtain.wall ?? 0).toBe(0);
    expect(punched.wall ?? 0).toBeGreaterThan(0);
    expect(banded.wall ?? 0).toBeGreaterThan(0);

    // Ribbon windows have no intermediate piers, only the corners: four faces times
    // two corners, per mass.
    expect(banded.frame).toBe(8);
    expect(punched.frame).toBeGreaterThan(banded.frame);
    // Finer bays mean a curtain wall carries the most verticals of the three.
    expect(curtain.frame).toBeGreaterThan(punched.frame);
  });

  it('picks a facade style per building, and all three occur', () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const counts = countGroups(
        generateBuilding({
          seed,
          footprint: [24, 18],
          params: { podiumChance: 0, setbackChance: 0, canopyChance: 0 }
        })
      );
      shapes.add(`${(counts.wall ?? 0) > 0}:${counts.frame === 8}`);
    }
    // curtain (no wall), punched (wall + piers), banded (wall, corners only).
    expect(shapes.size).toBe(3);
  });

  it('ships a palette covering every material group it emits', () => {
    const palette = modernOffice.palette;
    expect(palette).toBeDefined();
    const emitted = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      for (const node of generateBuilding({ seed, footprint: [24, 18] }).nodes ?? []) {
        emitted.add(node.id!);
      }
    }
    // A group with no palette entry would leave a consumer guessing at its material.
    for (const group of emitted) {
      expect(palette![group]).toBeDefined();
    }
    for (const hint of Object.values(palette!)) {
      // Albedo is linear, so values near 1 would be brighter than any real material.
      for (const channel of hint.albedo) {
        expect(channel).toBeGreaterThan(0);
        expect(channel).toBeLessThanOrEqual(0.9);
      }
      expect(hint.metallic).toBeGreaterThanOrEqual(0);
      expect(hint.metallic).toBeLessThanOrEqual(1);
      expect(hint.roughness).toBeGreaterThan(0);
      expect(hint.roughness).toBeLessThanOrEqual(1);
    }
  });

  it('puts the entrance canopy only on a permitted face', () => {
    // A deep canopy on a single permitted side shows up unambiguously in the bounds.
    const depth = 12;
    const size = 20;
    const sides: { mask: number; grow: 'maxX' | 'minX' | 'maxZ' | 'minZ' }[] = [
      { mask: 0b0001, grow: 'maxX' },
      { mask: 0b0010, grow: 'minX' },
      { mask: 0b0100, grow: 'maxZ' },
      { mask: 0b1000, grow: 'minZ' }
    ];
    for (const { mask, grow } of sides) {
      for (let seed = 0; seed < 5; seed++) {
        const result = tessellate(
          generateBuilding({
            seed,
            footprint: [size, size],
            params: {
              canopyChance: 1,
              canopyDepth: depth,
              entranceFaceMask: mask,
              podiumChance: 0,
              setbackChance: 0
            }
          })
        );
        const over = {
          maxX: result.boxMax[0] - size,
          minX: -result.boxMin[0],
          maxZ: result.boxMax[2] - size,
          minZ: -result.boxMin[2]
        };
        expect(over[grow]).toBeGreaterThan(depth * 0.5);
        for (const key of ['maxX', 'minX', 'maxZ', 'minZ'] as const) {
          if (key !== grow) {
            expect(over[key]).toBeLessThanOrEqual(RELIEF + 1e-4);
          }
        }
      }
    }
  });

  it('emits tangents on request', () => {
    const plain = tessellate(generateBuilding({ seed: 1, footprint: [12, 12] }));
    const tangential = tessellate(generateBuilding({ seed: 1, footprint: [12, 12], tangents: true }));
    expect(plain.hasTangents).toBe(false);
    expect(tangential.hasTangents).toBe(true);
  });

  it('survives extreme parameters without throwing', () => {
    expect(() =>
      tessellate(generateBuilding({ seed: 1, footprint: [3, 3], params: { floors: 1 } }))
    ).not.toThrow();
    expect(() =>
      tessellate(generateBuilding({ seed: 1, footprint: [80, 60], params: { floors: 40 } }))
    ).not.toThrow();
  });
});
