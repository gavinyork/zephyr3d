import {
  convertCurvesToZHair,
  detectCurveFormat
} from '../../../libs/loaders/src/curves/zhair_convert';
import {
  parseZHair,
  readZHairFloats,
  readZHairUints
} from '../../../libs/scene/src/asset/loaders/zhair/zhair_format';
import { loadZHairStrandSources } from '../../../libs/scene/src/asset/loaders/zhair/zhair_loader';
import { buildAlembicArchive, helixCurves } from '../../../visual-test/src/scenes/alembic-fixture';
import { buildHairFile } from '../../../visual-test/src/scenes/hair-fixture';

/**
 * The editor's import step is the only thing standing between a source archive
 * and the asset every scene will load from then on. If it drops a channel or
 * mis-scales a unit, the source is still on disk but nothing downstream will say
 * so - the groom simply renders wrong, and the archive it came from is no longer
 * being read.
 *
 * These run the real conversion over the same synthetic archives the visual
 * scenes use, so both halves of the pipeline are pinned against one fixture.
 *
 * A hazard when picking fixture sizes: the Alembic reader identifies property
 * blocks structurally, by element count against the topology, because an archive
 * does not name them per property. The fixture writes a 12-float `.selfBnds`
 * placeholder, so a strand count of 12 makes that block look like a per-curve
 * width, and a total point count of 12 makes it collide with the topology and
 * drops the object entirely. Sizes here avoid 12 on both counts.
 */

describe('curve archive to zhair conversion', () => {
  it('detects containers by content rather than by extension', () => {
    const set = helixCurves(4, 6);
    expect(detectCurveFormat(buildAlembicArchive([set]))).toBe('alembic');
    expect(detectCurveFormat(buildHairFile(set))).toBe('hair');
    expect(detectCurveFormat(new ArrayBuffer(4))).toBeNull();
    expect(detectCurveFormat(new TextEncoder().encode('not an archive at all').buffer)).toBeNull();
    expect(() => convertCurvesToZHair(new ArrayBuffer(16))).toThrow(/neither an Alembic archive nor a HAIR/);
  });

  it('carries Alembic strands through unchanged', () => {
    const set = helixCurves(5, 8);
    const parsed = parseZHair(convertCurvesToZHair(buildAlembicArchive([set]), { sourcePath: 'hair.abc' }));

    expect(parsed.content.sourceFormat).toBe('alembic');
    expect(parsed.content.sourcePath).toBe('hair.abc');
    // Maya authors in centimetres, and nothing else in the pipeline knows that.
    expect(parsed.content.unitScale).toBeCloseTo(0.01);

    const json = parsed.content.strandSets[0];
    expect(json.strandCount).toBe(5);
    expect(json.pointCount).toBe(40);
    expect(Array.from(readZHairUints(parsed, json.pointCounts))).toEqual(Array.from(set.numVertices));

    // Positions have to survive bit for bit: this is now the only copy that the
    // engine will ever read.
    const positions = readZHairFloats(parsed, json.positions)!;
    expect(positions.length).toBe(set.positions.length);
    for (let i = 0; i < positions.length; i++) {
      expect(positions[i]).toBeCloseTo(set.positions[i], 5);
    }
    const widths = readZHairFloats(parsed, json.widths)!;
    for (let i = 0; i < widths.length; i++) {
      expect(widths[i]).toBeCloseTo(set.width[i], 6);
    }
  });

  it('keeps every curve object as its own strand set', () => {
    const a = helixCurves(5, 4);
    const b = helixCurves(7, 4);
    b.name = 'SecondGroup';
    const parsed = parseZHair(convertCurvesToZHair(buildAlembicArchive([a, b])));

    // An XGen export routinely carries several spline descriptions; collapsing
    // them at conversion time would lose which strands belong together.
    expect(parsed.content.strandSets.map((s) => s.strandCount)).toEqual([5, 7]);
    expect(parsed.content.strandSets[1].name).toBe('SecondGroup');
  });

  it('records no unit for HAIR files, which carry none', () => {
    const parsed = parseZHair(convertCurvesToZHair(buildHairFile(helixCurves(4, 5))));
    expect(parsed.content.sourceFormat).toBe('hair');
    // Guessing a scale for a format that records none would be arbitrary; the
    // node's transform is where the number belongs, in the open.
    expect(parsed.content.unitScale).toBe(1);
  });

  it('applies the HAIR up axis at conversion time', () => {
    const set = helixCurves(3, 5);
    const bytes = buildHairFile(set);
    const asY = parseZHair(convertCurvesToZHair(bytes, { upAxis: 'y' }));
    const asZ = parseZHair(convertCurvesToZHair(bytes, { upAxis: 'z' }));

    const yPositions = readZHairFloats(asY, asY.content.strandSets[0].positions)!;
    const zPositions = readZHairFloats(asZ, asZ.content.strandSets[0].positions)!;
    // Z-up is the cyHairFile convention, so the two must differ - the rotation is
    // baked into the points rather than left for a node transform, because the
    // GPU path reads the point buffer without consulting any matrix.
    expect(Array.from(zPositions)).not.toEqual(Array.from(yPositions));
    expect(asY.content.strandSets[0].pointCount).toBe(asZ.content.strandSets[0].pointCount);
  });

  it('feeds the GPU strand path end to end', () => {
    const set = helixCurves(15, 6);
    const parsed = parseZHair(convertCurvesToZHair(buildAlembicArchive([set])));
    const sources = loadZHairStrandSources(parsed, { strandStride: 3 });

    expect(sources).toHaveLength(1);
    const source = sources[0];
    expect(source.pointCounts.length).toBe(5);
    // The file's unit scale reaches the strand source, which is what applies it.
    expect(source.scale).toBeCloseTo(0.01);
    let points = 0;
    for (let i = 0; i < source.pointCounts.length; i++) {
      points += source.pointCounts[i];
    }
    expect(source.positions.length).toBe(points * 3);
    expect(source.widths!.length).toBe(points);
  });
});
