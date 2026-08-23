import {
  encodeZHair,
  parseZHair,
  isZHair,
  readZHairFloats,
  readZHairUints,
  ZHAIR_VERSION,
  type ZHairStrandSetSource
} from '../../../libs/scene/src/asset/loaders/zhair/zhair_format';
import {
  loadZHairStrandSources,
  mergeHairStrandSources
} from '../../../libs/scene/src/asset/loaders/zhair/zhair_loader';

/**
 * `.zhair` exists so a groom is parsed once rather than every time a scene
 * loads, which means the file is the only copy of geometry that took minutes to
 * decode from its source archive. A silent layout error there is expensive in a
 * way a rendering bug is not: it corrupts an asset rather than a frame.
 *
 * The manifest carries a byte offset for every array, so the failure mode to
 * guard against is an offset that is self-consistent but wrong - one array read
 * at another's position still yields plausible floats. These tests round-trip
 * known values and assert on the values themselves, not just on shapes.
 */

/** Builds a strand set whose every value is derived from its index. */
function makeStrandSet(name: string, strandCount: number, pointsPerStrand: number, seed = 0) {
  const pointCount = strandCount * pointsPerStrand;
  const positions = new Float32Array(pointCount * 3);
  const pointCounts = new Uint32Array(strandCount);
  const widths = new Float32Array(pointCount);
  const uv = new Float32Array(strandCount * 2);
  for (let s = 0; s < strandCount; s++) {
    pointCounts[s] = pointsPerStrand;
    uv[s * 2] = seed + s / 100;
    uv[s * 2 + 1] = seed + s / 200;
    for (let i = 0; i < pointsPerStrand; i++) {
      const p = s * pointsPerStrand + i;
      positions[p * 3] = seed + s;
      positions[p * 3 + 1] = seed + i;
      positions[p * 3 + 2] = seed + s * 0.5 + i * 0.25;
      widths[p] = 0.001 + p * 1e-5;
    }
  }
  const set: ZHairStrandSetSource = { name, positions, pointCounts, widths, uv };
  return set;
}

describe('zhair container', () => {
  test('round-trips a strand set value for value', () => {
    const set = makeStrandSet('Curves0', 5, 4);
    const buffer = encodeZHair([set], { unitScale: 0.01, sourceFormat: 'alembic', sourcePath: '/a/hair.abc' });

    expect(isZHair(buffer)).toBe(true);
    const parsed = parseZHair(buffer);
    expect(parsed.content.version).toBe(ZHAIR_VERSION);
    expect(parsed.content.unitScale).toBeCloseTo(0.01);
    expect(parsed.content.sourceFormat).toBe('alembic');
    expect(parsed.content.sourcePath).toBe('/a/hair.abc');
    expect(parsed.content.strandSets).toHaveLength(1);

    const json = parsed.content.strandSets[0];
    expect(json.name).toBe('Curves0');
    expect(json.strandCount).toBe(5);
    expect(json.pointCount).toBe(20);

    expect(Array.from(readZHairUints(parsed, json.pointCounts))).toEqual(Array.from(set.pointCounts));
    expect(Array.from(readZHairFloats(parsed, json.positions)!)).toEqual(Array.from(set.positions));
    expect(Array.from(readZHairFloats(parsed, json.widths)!)).toEqual(Array.from(set.widths!));
    expect(Array.from(readZHairFloats(parsed, json.uv)!)).toEqual(Array.from(set.uv!));
  });

  test('records bounds in unscaled source units', () => {
    const positions = new Float32Array([1, 2, 3, -4, 5, -6, 7, -8, 9]);
    const buffer = encodeZHair([{ positions, pointCounts: new Uint32Array([3]) }], { unitScale: 0.01 });
    // Bounds describe the stored points, so a reader can size a node without
    // touching the payload; applying unitScale is the reader's job.
    expect(parseZHair(buffer).content.strandSets[0].bounds).toEqual([-4, -8, -6, 7, 5, 9]);
  });

  test('keeps strand sets independent', () => {
    const a = makeStrandSet('A', 3, 2, 0);
    const b = makeStrandSet('B', 2, 5, 100);
    const parsed = parseZHair(encodeZHair([a, b]));

    expect(parsed.content.strandSets.map((s) => s.name)).toEqual(['A', 'B']);
    // The second set's arrays sit after the first's in one shared payload, which
    // is exactly where an off-by-one in the layout pass would show up.
    expect(Array.from(readZHairFloats(parsed, parsed.content.strandSets[1].positions)!)).toEqual(
      Array.from(b.positions)
    );
    expect(Array.from(readZHairFloats(parsed, parsed.content.strandSets[0].positions)!)).toEqual(
      Array.from(a.positions)
    );
  });

  test('carries the per-point channels a .hair file may hold', () => {
    const set = makeStrandSet('C', 2, 3);
    set.colors = new Float32Array(6 * 3).map((_, i) => i / 10);
    set.transparency = new Float32Array(6).map((_, i) => i / 6);
    const parsed = parseZHair(encodeZHair([set]));
    const json = parsed.content.strandSets[0];

    expect(Array.from(readZHairFloats(parsed, json.colors)!)).toEqual(Array.from(set.colors));
    expect(Array.from(readZHairFloats(parsed, json.transparency)!)).toEqual(Array.from(set.transparency));
  });

  test('omits absent channels from the manifest', () => {
    const parsed = parseZHair(
      encodeZHair([{ positions: new Float32Array(9), pointCounts: new Uint32Array([3]) }])
    );
    const json = parsed.content.strandSets[0];
    expect(json.widths).toBeUndefined();
    expect(json.uv).toBeUndefined();
    expect(json.colors).toBeUndefined();
    expect(readZHairFloats(parsed, json.widths)).toBeNull();
  });

  test('marks per-strand width and per-point uv in the manifest', () => {
    const perStrand = parseZHair(
      encodeZHair([
        {
          positions: new Float32Array(18),
          pointCounts: new Uint32Array([3, 3]),
          widths: new Float32Array([0.1, 0.2]),
          widthPerStrand: true,
          uv: new Float32Array(12),
          uvPerPoint: true
        }
      ])
    ).content.strandSets[0];
    expect(perStrand.widthPerStrand).toBe(true);
    expect(perStrand.uvPerPoint).toBe(true);
    expect(perStrand.widths!.length).toBe(2 * 4);
    expect(perStrand.uv!.length).toBe(6 * 2 * 4);
  });

  test('trims source arrays to what the topology declares', () => {
    // Importers hand over views into larger buffers routinely. Writing the extra
    // values would make the file disagree with its own point count.
    const positions = new Float32Array(30);
    positions[0] = 7;
    const parsed = parseZHair(encodeZHair([{ positions, pointCounts: new Uint32Array([2]) }]));
    const stored = readZHairFloats(parsed, parsed.content.strandSets[0].positions)!;
    expect(stored.length).toBe(6);
    expect(stored[0]).toBe(7);
  });

  test('rejects files it cannot trust', () => {
    const good = encodeZHair([makeStrandSet('X', 2, 2)]);

    expect(isZHair(new ArrayBuffer(4))).toBe(false);
    expect(() => parseZHair(new ArrayBuffer(64))).toThrow(/not a zhair file/);

    const wrongVersion = good.slice(0);
    new DataView(wrongVersion).setUint32(4, 99, true);
    expect(() => parseZHair(wrongVersion)).toThrow(/unsupported zhair version/);

    // A file cut short mid-manifest still has a valid magic and version, so the
    // length field is the only thing that can catch it.
    expect(() => parseZHair(good.slice(0, 20))).toThrow(/truncated manifest/);

    expect(() => encodeZHair([])).toThrow(/no strand sets/);
    expect(() =>
      encodeZHair([{ positions: new Float32Array(3), pointCounts: new Uint32Array([4]) }])
    ).toThrow(/topology needs 4/);
  });
});

describe('zhair loading', () => {
  test('applies the file unit scale unless overridden', () => {
    const parsed = parseZHair(encodeZHair([makeStrandSet('A', 2, 3)], { unitScale: 0.01 }));

    expect(loadZHairStrandSources(parsed)[0].scale).toBeCloseTo(0.01);
    expect(loadZHairStrandSources(parsed, { scale: 2 })[0].scale).toBe(2);
    expect(loadZHairStrandSources(parsed, { widthScale: 3 })[0].widthScale).toBe(3);
  });

  test('decimates by stride, spread across the groom', () => {
    const parsed = parseZHair(encodeZHair([makeStrandSet('A', 10, 4)]));
    const kept = loadZHairStrandSources(parsed, { strandStride: 3 })[0];

    // Strands 0, 3, 6, 9 - a stride rather than a leading slice, so the kept
    // strands stay spread over the whole scalp instead of leaving a bald patch.
    expect(kept.pointCounts.length).toBe(4);
    expect(kept.positions.length).toBe(4 * 4 * 3);
    // Position x encodes the source strand index, which is what pins that the
    // right strands survived rather than merely the right number of them.
    expect([0, 4, 8, 12].map((p) => kept.positions[p * 3])).toEqual([0, 3, 6, 9]);
  });

  test('widens the stride further to honour maxStrands', () => {
    const parsed = parseZHair(encodeZHair([makeStrandSet('A', 100, 2)]));
    const kept = loadZHairStrandSources(parsed, { maxStrands: 10 })[0];
    expect(kept.pointCounts.length).toBeLessThanOrEqual(10);
    expect(kept.pointCounts.length).toBeGreaterThan(0);
  });

  test('decimation carries the matching width and uv values', () => {
    const set = makeStrandSet('A', 6, 2);
    const parsed = parseZHair(encodeZHair([set]));
    const kept = loadZHairStrandSources(parsed, { strandStride: 2 })[0];

    // Strands 0, 2, 4: per-point width comes from their own points, per-strand
    // uv from their own index. Reading either against the pre-decimation index
    // would still produce plausible numbers, so the values are asserted.
    expect(Array.from(kept.uv!)).toEqual([0, 0, 0.02, 0.01, 0.04, 0.02].map((v) => expect.closeTo(v, 5)));
    expect(kept.widths![0]).toBeCloseTo(set.widths![0], 8);
    expect(kept.widths![2]).toBeCloseTo(set.widths![4], 8);
    expect(kept.widths![4]).toBeCloseTo(set.widths![8], 8);
  });

  test('returns the arrays untouched when nothing is decimated', () => {
    const set = makeStrandSet('A', 4, 3);
    const parsed = parseZHair(encodeZHair([set]));
    const kept = loadZHairStrandSources(parsed, { strandStride: 1 })[0];
    expect(Array.from(kept.positions)).toEqual(Array.from(set.positions));
  });

  test('merges sets into one draw, baking per-source scale in', () => {
    const merged = mergeHairStrandSources([
      {
        positions: new Float32Array([1, 0, 0, 2, 0, 0]),
        pointCounts: new Uint32Array([2]),
        widths: new Float32Array([0.5, 0.5]),
        uv: new Float32Array([0.25, 0.75]),
        scale: 2
      },
      {
        positions: new Float32Array([3, 0, 0, 4, 0, 0, 5, 0, 0]),
        pointCounts: new Uint32Array([3]),
        widths: new Float32Array([0.25, 0.25, 0.25]),
        uv: new Float32Array([0.5, 0.5]),
        scale: 10
      }
    ])!;

    expect(Array.from(merged.pointCounts)).toEqual([2, 3]);
    // Each set converts by its own scale, then the merged source declares scale
    // 1 so nothing converts twice.
    expect(Array.from(merged.positions)).toEqual([2, 0, 0, 4, 0, 0, 30, 0, 0, 40, 0, 0, 50, 0, 0]);
    expect(merged.scale).toBe(1);
    expect(merged.widthScale).toBe(1);
    // Width is a length in the same unit as position, so it converts alongside.
    expect(Array.from(merged.widths!)).toEqual([1, 1, 2.5, 2.5, 2.5]);
    // A per-strand uv is expanded to per-point, which is the layout
    // HairStrandData infers from the array length.
    expect(merged.widthPerStrand).toBe(false);
    expect(Array.from(merged.uv!)).toEqual([0.25, 0.75, 0.25, 0.75, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  test('drops a channel no merge input agrees on', () => {
    const merged = mergeHairStrandSources([
      { positions: new Float32Array(6), pointCounts: new Uint32Array([2]), widths: new Float32Array([1, 1]) },
      { positions: new Float32Array(6), pointCounts: new Uint32Array([2]) }
    ])!;
    // Half a width array would read as zero for the set that lacked one, which
    // is worse than falling back to the default width everywhere.
    expect(merged.widths).toBeNull();
  });

  test('merging one set is a pass-through', () => {
    const only = { positions: new Float32Array(6), pointCounts: new Uint32Array([2]), scale: 5 };
    expect(mergeHairStrandSources([only])).toBe(only);
    expect(mergeHairStrandSources([])).toBeNull();
  });
});
