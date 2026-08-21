import { parseHairFile } from '../../../libs/loaders/src/hair/parser';
import {
  HAIR_ARRAY_COLORS,
  HAIR_ARRAY_POINTS,
  HAIR_ARRAY_SEGMENTS,
  HAIR_ARRAY_THICKNESS,
  HAIR_ARRAY_TRANSPARENCY,
  HAIR_ARRAY_UVS,
  HAIR_HEADER_SIZE
} from '../../../libs/loaders/src/hair/types';

/**
 * HAIR is a positional format: no names, no offsets, no padding. Nothing in a
 * file says where the point array starts - it starts wherever the segment array
 * happened to end - so a wrong assumption about any earlier field silently
 * reinterprets everything after it as plausible-looking floats. These tests
 * write the bytes by hand and read them back, which is the only way to pin a
 * layout that cannot check itself.
 */

/** A HAIR file to synthesise. Omitted arrays are left out of the file entirely. */
type HairFixture = {
  strandCount: number;
  pointCount: number;
  segments?: number[];
  points?: number[];
  thickness?: number[];
  transparency?: number[];
  colors?: number[];
  uvs?: number[];
  defaultSegments?: number;
  defaultThickness?: number;
  defaultTransparency?: number;
  defaultColor?: [number, number, number];
  info?: string;
  /** Overrides the signature, for the rejection test. */
  signature?: string;
  /** Cuts the file short after assembly, for the truncation test. */
  truncateTo?: number;
};

/** Writes the bytes of a HAIR file, exactly as `cyHairFile` lays them out. */
function buildHairFile(f: HairFixture): ArrayBuffer {
  let arrays = 0;
  if (f.segments) {
    arrays |= HAIR_ARRAY_SEGMENTS;
  }
  if (f.points) {
    arrays |= HAIR_ARRAY_POINTS;
  }
  if (f.thickness) {
    arrays |= HAIR_ARRAY_THICKNESS;
  }
  if (f.transparency) {
    arrays |= HAIR_ARRAY_TRANSPARENCY;
  }
  if (f.colors) {
    arrays |= HAIR_ARRAY_COLORS;
  }
  if (f.uvs) {
    arrays |= HAIR_ARRAY_UVS;
  }
  const floatArrays = [f.points, f.thickness, f.transparency, f.colors, f.uvs].filter(
    (a): a is number[] => !!a
  );
  const floatCount = floatArrays.reduce((sum, a) => sum + a.length, 0);
  const size = HAIR_HEADER_SIZE + (f.segments?.length ?? 0) * 2 + floatCount * 4;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  const signature = f.signature ?? 'HAIR';
  for (let i = 0; i < 4; i++) {
    view.setUint8(i, signature.charCodeAt(i) & 0xff);
  }
  view.setUint32(4, f.strandCount, true);
  view.setUint32(8, f.pointCount, true);
  view.setUint32(12, arrays, true);
  view.setUint32(16, f.defaultSegments ?? 0, true);
  view.setFloat32(20, f.defaultThickness ?? 0, true);
  view.setFloat32(24, f.defaultTransparency ?? 0, true);
  const colour = f.defaultColor ?? [0, 0, 0];
  view.setFloat32(28, colour[0], true);
  view.setFloat32(32, colour[1], true);
  view.setFloat32(36, colour[2], true);
  const info = f.info ?? '';
  for (let i = 0; i < info.length && i < 88; i++) {
    view.setUint8(40 + i, info.charCodeAt(i) & 0xff);
  }

  let cursor = HAIR_HEADER_SIZE;
  if (f.segments) {
    for (const s of f.segments) {
      view.setUint16(cursor, s, true);
      cursor += 2;
    }
  }
  for (const array of floatArrays) {
    for (const v of array) {
      view.setFloat32(cursor, v, true);
      cursor += 4;
    }
  }
  return f.truncateTo === undefined ? buffer : buffer.slice(0, f.truncateTo);
}

/** Three points per strand, values chosen so an off-by-one is visible. */
function ramp(count: number, stride: number, base = 0) {
  return Array.from({ length: count * stride }, (_, i) => base + i * 0.25);
}

describe('HAIR file parser', () => {
  it('decodes a file carrying every optional array', () => {
    const strandCount = 2;
    const segments = [2, 3];
    const pointCount = 3 + 4;
    const points = ramp(pointCount, 3);
    const thickness = ramp(pointCount, 1, 100);
    const transparency = ramp(pointCount, 1, 200);
    const colors = ramp(pointCount, 3, 300);
    const uvs = ramp(pointCount, 2, 400);
    const model = parseHairFile(
      buildHairFile({
        strandCount,
        pointCount,
        segments,
        points,
        thickness,
        transparency,
        colors,
        uvs,
        info: 'zephyr3d unit test'
      }),
      // Layout is what this case is about, so the axis conversion is switched
      // off and pinned separately below.
      { upAxis: 'y' }
    );

    expect(model.header.strandCount).toBe(strandCount);
    expect(model.header.pointCount).toBe(pointCount);
    expect(model.header.info).toBe('zephyr3d unit test');
    // A strand of N segments owns N+1 control points.
    expect(Array.from(model.numVertices)).toEqual([3, 4]);
    expect(model.totalPoints).toBe(pointCount);
    expect(Array.from(model.positions)).toEqual(points);
    expect(model.widthPerCurve).toBe(false);
    expect(Array.from(model.width!)).toEqual(thickness);
    expect(Array.from(model.transparency!)).toEqual(transparency);
    expect(Array.from(model.colors!)).toEqual(colors);
    expect(Array.from(model.uv!)).toEqual(uvs);
  });

  it('reads the point array correctly when the segment array leaves it unaligned', () => {
    // Three uint16 segments after a 128-byte header puts the point array on a
    // 2-byte boundary. A Float32Array view over the file buffer would throw
    // here; only a copy survives, which is what the parser does.
    const points = ramp(6, 3, 1);
    const model = parseHairFile(buildHairFile({ strandCount: 3, pointCount: 6, segments: [1, 1, 1], points }), {
      upAxis: 'y'
    });
    expect(Array.from(model.numVertices)).toEqual([2, 2, 2]);
    expect(Array.from(model.positions)).toEqual(points);
  });

  it('rotates Z-up control points into the engine Y-up frame by default', () => {
    // One point per axis, so a wrong axis or a wrong sign is named by the
    // assertion rather than hidden in a ramp. Z-up to Y-up is a -90 degree
    // rotation about X: (x, y, z) -> (x, z, -y).
    const model = parseHairFile(
      buildHairFile({
        strandCount: 1,
        pointCount: 4,
        segments: [3],
        points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]
      })
    );
    expect(model.sourceUpAxis).toBe('z');
    // Negating a zero produces -0, which toEqual treats as distinct from 0 and
    // which means nothing geometrically.
    const axes = Array.from(model.positions, (v) => (v === 0 ? 0 : v));
    expect(axes).toEqual([
      0, 0, 0,
      // +X is shared by both frames.
      1, 0, 0,
      // The source's +Y, its "forward", becomes -Z.
      0, 0, -1,
      // The source's +Z, its up, becomes +Y.
      0, 1, 0
    ]);
  });

  it('leaves control points alone when the source is already Y-up', () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const model = parseHairFile(
      buildHairFile({ strandCount: 1, pointCount: 4, segments: [3], points }),
      { upAxis: 'y' }
    );
    expect(model.sourceUpAxis).toBe('y');
    expect(Array.from(model.positions)).toEqual(points);
  });

  it('falls back to the header defaults when the optional arrays are absent', () => {
    const model = parseHairFile(
      buildHairFile({
        strandCount: 4,
        pointCount: 12,
        points: ramp(12, 3),
        defaultSegments: 2,
        // Powers of two, so a float32 round trip is exact and the assertions can
        // compare values rather than tolerances.
        defaultThickness: 0.0625,
        defaultTransparency: 0.25,
        defaultColor: [0.5, 0.25, 0.125]
      })
    );
    expect(Array.from(model.numVertices)).toEqual([3, 3, 3, 3]);
    // The default thickness becomes one value per strand, not one per point.
    expect(model.widthPerCurve).toBe(true);
    expect(Array.from(model.width!)).toEqual([0.0625, 0.0625, 0.0625, 0.0625]);
    expect(model.transparency).toBeNull();
    expect(model.colors).toBeNull();
    expect(model.uv).toBeNull();
    expect(model.header.defaultTransparency).toBe(0.25);
    expect(model.header.defaultColor).toEqual([0.5, 0.25, 0.125]);
  });

  it('rejects a file whose signature is not HAIR', () => {
    expect(() =>
      parseHairFile(
        buildHairFile({ strandCount: 1, pointCount: 2, segments: [1], points: ramp(2, 3), signature: 'ABC ' })
      )
    ).toThrow(/signature/i);
  });

  it('rejects a file shorter than the header', () => {
    expect(() => parseHairFile(new ArrayBuffer(64))).toThrow(/shorter than/i);
  });

  it('names the array that ran out when the file is truncated', () => {
    const bytes = buildHairFile({
      strandCount: 2,
      pointCount: 4,
      segments: [1, 1],
      points: ramp(4, 3),
      thickness: ramp(4, 1),
      truncateTo: HAIR_HEADER_SIZE + 4 + 4 * 3 * 4
    });
    expect(() => parseHairFile(bytes)).toThrow(/truncated.*thickness/i);
  });

  it('rejects a file whose segment counts disagree with the point count', () => {
    expect(() =>
      parseHairFile(
        // Segments imply 4 control points, the header claims 9.
        buildHairFile({ strandCount: 2, pointCount: 9, segments: [1, 1], points: ramp(9, 3) })
      )
    ).toThrow(/inconsistent/i);
  });

  it('rejects a file with no point array', () => {
    expect(() => parseHairFile(buildHairFile({ strandCount: 2, pointCount: 4, segments: [1, 1] }))).toThrow(
      /no point array/i
    );
  });
});
