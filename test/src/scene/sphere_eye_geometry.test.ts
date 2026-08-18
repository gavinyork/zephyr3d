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

  test('uses planar +Z UVs and concentric gaze-axis rings in eye-compatible mode', () => {
    const data = generate(true);
    // The front (+Z) pole is the pupil centre in the eye projection.
    const frontVertex = 0;
    expect(data.vertices[frontVertex * 3]).toBeCloseTo(0);
    expect(data.vertices[frontVertex * 3 + 1]).toBeCloseTo(0);
    expect(data.vertices[frontVertex * 3 + 2]).toBeCloseTo(1);
    expect(data.uvs.slice(frontVertex * 2, frontVertex * 2 + 2)).toEqual([0.5, 0.5]);
    expect(data.tangents[frontVertex * 4]).toBeCloseTo(1);
    expect(data.tangents[frontVertex * 4 + 1]).toBeCloseTo(0);
    expect(data.tangents[frontVertex * 4 + 2]).toBeCloseTo(0);
    expect(data.tangents[frontVertex * 4 + 3]).toBe(1);

    // At 45 degrees away from the front, +U remains the projected +X
    // direction instead of rotating with the sphere's azimuth.
    const diagonalVertex = 9;
    const uv = data.uvs.slice(diagonalVertex * 2, diagonalVertex * 2 + 2);
    const tangent = data.tangents.slice(diagonalVertex * 4, diagonalVertex * 4 + 4);
    expect(uv[0]).toBeCloseTo(0.5 + Math.SQRT1_2 * 0.5);
    expect(uv[1]).toBeCloseTo(0.5);
    expect(tangent[0]).toBeCloseTo(Math.SQRT1_2);
    expect(tangent[1]).toBeCloseTo(0);
    expect(tangent[2]).toBeCloseTo(-Math.SQRT1_2);
    expect(tangent[3]).toBe(1);
  });

  test('unwraps the rear hemisphere outside the iris disc', () => {
    const data = generate(true);
    const backVertex = 4 * 9;
    expect(data.vertices[backVertex * 3]).toBeCloseTo(0);
    expect(data.vertices[backVertex * 3 + 1]).toBeCloseTo(0);
    expect(data.vertices[backVertex * 3 + 2]).toBeCloseTo(-1);
    expect(data.uvs[backVertex * 2]).toBeCloseTo(1.5);
    expect(data.uvs[backVertex * 2 + 1]).toBeCloseTo(0.5);
    expect(data.tangents[backVertex * 4 + 3]).toBe(-1);

    for (let vertex = 0; vertex < data.vertices.length / 3; vertex++) {
      const z = data.vertices[vertex * 3 + 2];
      const u = data.uvs[vertex * 2];
      const v = data.uvs[vertex * 2 + 1];
      if (z < -1e-8) {
        expect(Math.hypot(u - 0.5, v - 0.5)).toBeGreaterThanOrEqual(0.5 - 1e-8);
      }
    }
  });

  test('keeps eye-compatible tangents normalized and perpendicular to the normal', () => {
    const data = generate(true);
    for (let vertex = 0; vertex < data.vertices.length / 3; vertex++) {
      const nx = data.normals[vertex * 3];
      const ny = data.normals[vertex * 3 + 1];
      const nz = data.normals[vertex * 3 + 2];
      const tx = data.tangents[vertex * 4];
      const ty = data.tangents[vertex * 4 + 1];
      const tz = data.tangents[vertex * 4 + 2];
      expect(Math.hypot(tx, ty, tz)).toBeCloseTo(1);
      expect(nx * tx + ny * ty + nz * tz).toBeCloseTo(0);
    }
  });
});
