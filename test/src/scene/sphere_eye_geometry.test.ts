import { SphereShape } from '../../../libs/scene/src/shapes/sphere';

function generate(eyeCompatible = false) {
  const vertices: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  SphereShape.generateData(
    { radius: 1, verticalDetail: 4, horizonalDetail: 8, eyeCompatible },
    vertices,
    normals,
    tangents,
    uvs,
    indices
  );
  return { vertices, normals, tangents, uvs, indices };
}

describe('SphereShape eye-compatible generation', () => {
  test('keeps the legacy equirectangular mapping by default', () => {
    const data = generate();
    // Equator, h=0 is the +Z point and lies on the legacy U seam.
    const vertex = 2 * 9;
    expect(data.vertices[vertex * 3]).toBeCloseTo(0);
    expect(data.vertices[vertex * 3 + 1]).toBeCloseTo(0);
    expect(data.vertices[vertex * 3 + 2]).toBeCloseTo(1);
    expect(data.uvs.slice(vertex * 2, vertex * 2 + 2)).toEqual([0, 0.5]);
    expect(data.tangents[vertex * 4]).toBeCloseTo(1);
    expect(data.tangents[vertex * 4 + 1]).toBeCloseTo(0);
    expect(data.tangents[vertex * 4 + 2]).toBeCloseTo(0);
    expect(data.tangents[vertex * 4 + 3]).toBe(1);
  });

  test('uses planar +Z UVs and +U tangents in eye-compatible mode', () => {
    const data = generate(true);
    // The front (+Z) point is the pupil centre in the eye projection.
    const frontVertex = 2 * 9;
    expect(data.vertices[frontVertex * 3]).toBeCloseTo(0);
    expect(data.vertices[frontVertex * 3 + 1]).toBeCloseTo(0);
    expect(data.vertices[frontVertex * 3 + 2]).toBeCloseTo(1);
    expect(data.uvs.slice(frontVertex * 2, frontVertex * 2 + 2)).toEqual([0.5, 0.5]);
    expect(data.tangents[frontVertex * 4]).toBeCloseTo(1);
    expect(data.tangents[frontVertex * 4 + 1]).toBeCloseTo(0);
    expect(data.tangents[frontVertex * 4 + 2]).toBeCloseTo(0);
    expect(data.tangents[frontVertex * 4 + 3]).toBe(1);

    // At 45 degrees around the front, +U remains the projected +X direction
    // instead of rotating with the sphere's azimuth.
    const diagonalVertex = frontVertex + 1;
    const uv = data.uvs.slice(diagonalVertex * 2, diagonalVertex * 2 + 2);
    const tangent = data.tangents.slice(diagonalVertex * 4, diagonalVertex * 4 + 4);
    expect(uv[0]).toBeCloseTo(0.5 + Math.SQRT1_2 * 0.5);
    expect(uv[1]).toBeCloseTo(0.5);
    expect(tangent[0]).toBeCloseTo(Math.SQRT1_2);
    expect(tangent[1]).toBeCloseTo(0);
    expect(tangent[2]).toBeCloseTo(-Math.SQRT1_2);
    expect(tangent[3]).toBe(1);
  });
});
