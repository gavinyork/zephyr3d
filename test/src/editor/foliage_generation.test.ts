import {
  FOLIAGE_GEN_STRIDE,
  foliageCandidatePositions,
  foliageCellRange,
  generateFoliageRegion,
  heightGridSurface,
  precomputedSurface
} from '../../../utility/editor/src/helpers/foliagegen';
import type {
  FoliageGenContext,
  FoliageGenRegion,
  FoliageGenSettings
} from '../../../utility/editor/src/helpers/foliagegen';

const SETTINGS: FoliageGenSettings = {
  spacing: 2,
  scaleRange: [0.5, 1.5],
  slopeRange: [0, 90],
  heightRange: null,
  yOffset: 0.25,
  randomYaw: true,
  seed: 42
};

const FLAT = { height: 3, slope: 0, normal: [0, 1, 0] as [number, number, number] };

function context(
  density: FoliageGenContext['density'],
  extra?: Partial<FoliageGenContext>
): FoliageGenContext {
  return {
    density,
    surface: () => FLAT,
    storeHeight: false,
    originX: 0,
    originY: 0,
    originZ: 0,
    ...extra
  };
}

/** Instances as sorted rows, for comparisons independent of order */
function rows(data: Float32Array) {
  const out: number[][] = [];
  for (let k = 0; k < data.length; k += FOLIAGE_GEN_STRIDE) {
    out.push(Array.from(data.subarray(k, k + FOLIAGE_GEN_STRIDE)));
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** A soft round blob of density, so instances have to pass different thresholds */
const blob = (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - 3, z + 5) / 30);

describe('foliage candidate grid', () => {
  it('aligns regions to whole cells, without reaching past an edge on a cell edge', () => {
    expect(foliageCellRange([0, 0, 4, 4], 2)).toMatchObject({
      i0: 0,
      j0: 0,
      i1: 1,
      j1: 1,
      aligned: [0, 0, 4, 4]
    });
    expect(foliageCellRange([-1, 0.5, 3, 3.5], 2)).toMatchObject({
      i0: -1,
      j0: 0,
      i1: 1,
      j1: 1,
      aligned: [-2, 0, 4, 4]
    });
  });

  it('keeps every candidate inside its own cell', () => {
    const cand = foliageCandidatePositions(SETTINGS, [-20, -20, 20, 20]);
    let k = 0;
    for (let j = cand.j0; j <= cand.j1; j++) {
      for (let i = cand.i0; i <= cand.i1; i++) {
        const x = cand.positions[k++];
        const z = cand.positions[k++];
        expect(Math.floor(x / SETTINGS.spacing)).toBe(i);
        expect(Math.floor(z / SETTINGS.spacing)).toBe(j);
      }
    }
  });
});

describe('foliage generation', () => {
  it('gives the same instances for a region generated whole or in pieces', () => {
    const whole = generateFoliageRegion(SETTINGS, [-30, -40, 34, 26], context(blob));
    const pieces = [
      generateFoliageRegion(SETTINGS, [-30, -40, 2, 26], context(blob)),
      generateFoliageRegion(SETTINGS, [2, -40, 34, -6], context(blob)),
      generateFoliageRegion(SETTINGS, [2, -6, 34, 26], context(blob))
    ];
    const joined = new Float32Array(pieces.reduce((n, p) => n + p.instances.length, 0));
    let o = 0;
    for (const p of pieces) {
      joined.set(p.instances, o);
      o += p.instances.length;
    }
    expect(whole.instances.length).toBeGreaterThan(0);
    expect(rows(joined)).toEqual(rows(whole.instances));
  });

  it('only adds instances as the density rises, keeping the ones there', () => {
    const region: FoliageGenRegion = [0, 0, 60, 60];
    const low = rows(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 0.3)
      ).instances
    );
    const high = rows(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 0.6)
      ).instances
    );
    const key = (r: number[]) => r.join(',');
    const highKeys = new Set(high.map(key));
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(low.length);
    for (const r of low) {
      expect(highKeys.has(key(r))).toBe(true);
    }
    // Roughly the density times the number of candidates
    const candidates = (60 / SETTINGS.spacing) ** 2;
    expect(low.length / candidates).toBeGreaterThan(0.2);
    expect(low.length / candidates).toBeLessThan(0.4);
  });

  it('grows nothing at zero density and every candidate at full density', () => {
    const region: FoliageGenRegion = [0, 0, 20, 20];
    expect(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 0)
      ).instances.length
    ).toBe(0);
    const full = generateFoliageRegion(
      SETTINGS,
      region,
      context(() => 1)
    );
    expect(full.instances.length / FOLIAGE_GEN_STRIDE).toBe(full.candidates);
  });

  it('changes the arrangement with the seed', () => {
    const region: FoliageGenRegion = [0, 0, 20, 20];
    const a = rows(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 1)
      ).instances
    );
    const b = rows(
      generateFoliageRegion(
        { ...SETTINGS, seed: 7 },
        region,
        context(() => 1)
      ).instances
    );
    expect(a).not.toEqual(b);
  });

  it('filters by slope and height, and skips where there is no surface', () => {
    const region: FoliageGenRegion = [0, 0, 20, 20];
    const steep = { height: 3, slope: 60, normal: [0.8, 0.5, 0] as [number, number, number] };
    const bySlope = generateFoliageRegion(
      { ...SETTINGS, slopeRange: [0, 45] },
      region,
      context(() => 1, { surface: (x) => (x < 10 ? FLAT : steep) })
    );
    expect(rows(bySlope.instances).every(([x]) => x < 10)).toBe(true);
    expect(bySlope.instances.length).toBeGreaterThan(0);
    const byHeight = generateFoliageRegion(
      { ...SETTINGS, heightRange: [5, 10] },
      region,
      context(() => 1)
    );
    expect(byHeight.instances.length).toBe(0);
    const none = generateFoliageRegion(
      SETTINGS,
      region,
      context(() => 1, { surface: () => null })
    );
    expect(none.instances.length).toBe(0);
  });

  it('stores the offset on a terrain, and the height relative to the origin on any surface', () => {
    const region: FoliageGenRegion = [0, 0, 4, 4];
    const onTerrain = rows(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 1)
      ).instances
    );
    expect(onTerrain.every((r) => Math.abs(r[2] - 0.25) < 1e-6)).toBe(true);
    const onAny = rows(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 1, { storeHeight: true, originY: 1 })
      ).instances
    );
    // Surface at 3, origin at 1, offset 0.25
    expect(onAny.every((r) => Math.abs(r[2] - 2.25) < 1e-6)).toBe(true);
  });

  it('lets a place script lower the probability and override the scale', () => {
    const region: FoliageGenRegion = [0, 0, 40, 40];
    const seen: number[] = [];
    const result = generateFoliageRegion(
      SETTINGS,
      region,
      context(() => 1, {
        place: (p) => {
          seen.push(p.density);
          return p.lx < 20 ? { probability: 1, scale: 2 } : 0;
        }
      })
    );
    const r = rows(result.instances);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(([x, , , , s]) => x < 20 && s === 2)).toBe(true);
    expect(seen.every((d) => d === 1)).toBe(true);
  });

  it('reads heights and slopes from a height grid', () => {
    // A ramp rising 1 m per meter along x over a 10 x 10 m terrain at the origin
    const w = 11;
    const heights = new Float32Array(w * w);
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        heights[j * w + i] = (i + 0.5) * (10 / w);
      }
    }
    const { surface } = heightGridSurface(heights, w, w, [0, 0, 10, 10], 0, 0);
    const s = surface(5, 5)!;
    expect(s.height).toBeCloseTo(5, 3);
    expect(s.slope).toBeCloseTo(45, 1);
    expect(surface(-1, 5)).toBeNull();
  });
});

describe('foliage generation paths', () => {
  it('match whether the density is sampled live or sent as one value per candidate', () => {
    const region: FoliageGenRegion = [-13, 7, 29, 41];
    const live = generateFoliageRegion(SETTINGS, region, context(blob));
    // As the main thread prepares a worker message: sample at the candidates, index by cell
    const cand = foliageCandidatePositions(SETTINGS, region);
    const density = new Float32Array(cand.cols * cand.rows);
    for (let k = 0; k < density.length; k++) {
      density[k] = blob(cand.positions[2 * k], cand.positions[2 * k + 1]);
    }
    const sent = generateFoliageRegion(
      SETTINGS,
      [cand.aligned[0], cand.aligned[1], cand.aligned[2] - 1e-6, cand.aligned[3] - 1e-6],
      context((_x, _z, i, j) => density[(j - cand.j0) * cand.cols + (i - cand.i0)])
    );
    expect(sent.region).toEqual(live.region);
    expect(rows(sent.instances)).toEqual(rows(live.instances));
  });
});

describe('foliage on any surface', () => {
  /** A step: a ledge at height 5 for x < 10, the ground at height 1 beyond, nothing past x 30 */
  const step = (x: number) =>
    x >= 30
      ? null
      : {
          height: x < 10 ? 5 : 1,
          slope: 0,
          normal: [0, 1, 0] as [number, number, number]
        };

  it('stores the height of what lies below, relative to the foliage origin', () => {
    const region: FoliageGenRegion = [0, 0, 40, 8];
    const out = rows(
      generateFoliageRegion(
        SETTINGS,
        region,
        context(() => 1, { surface: (x) => step(x), storeHeight: true, originY: 1 })
      ).instances
    );
    expect(out.length).toBeGreaterThan(0);
    for (const [x, , y] of out) {
      expect(x).toBeLessThan(30);
      // Surface height - origin + offset 0.25
      expect(y).toBeCloseTo(x < 10 ? 4.25 : 0.25, 5);
    }
  });

  it('gives the same instances from surfaces found per candidate, as the worker receives them', () => {
    const region: FoliageGenRegion = [-6, -2, 40, 12];
    const live = generateFoliageRegion(
      SETTINGS,
      region,
      context(blob, { surface: (x) => step(x), storeHeight: true })
    );
    // As the main thread prepares the worker message: one surface per candidate, NaN for none
    const cand = foliageCandidatePositions(SETTINGS, region);
    const surfaces = new Float32Array(cand.cols * cand.rows * 5).fill(Number.NaN);
    for (let k = 0; k < cand.cols * cand.rows; k++) {
      const s = step(cand.positions[2 * k]);
      if (s) {
        surfaces.set([s.height, s.slope, ...s.normal], k * 5);
      }
    }
    const sent = generateFoliageRegion(
      SETTINGS,
      [cand.aligned[0], cand.aligned[1], cand.aligned[2] - 1e-6, cand.aligned[3] - 1e-6],
      context(blob, {
        surface: precomputedSurface(surfaces, SETTINGS.spacing, cand.i0, cand.j0, cand.cols),
        storeHeight: true
      })
    );
    expect(live.instances.length).toBeGreaterThan(0);
    expect(rows(sent.instances)).toEqual(rows(live.instances));
  });
});
