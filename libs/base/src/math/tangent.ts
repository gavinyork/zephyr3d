/**
 * Calculate the tangent vector of a triangle mesh.
 * @param vertices - The mesh vertices.
 * @param normals - The mesh normals.
 * @param texcoords - The mesh texture coordinates.
 * @param indices - The vertex indices.
 * @param withHandedness - Calculate handedness if true.
 * @returns The tangent vector.
 */
export function calculateTangentVectors(
  vertices: number[],
  normals: number[],
  texcoords: number[],
  indices: number[],
  withHandedness: boolean
): number[] {
  const numTangentCompnents = withHandedness ? 4 : 3;
  const tangents = Array.from({
    length: (vertices.length / 3) * numTangentCompnents
  }).map(() => 0);
  const bitangents = Array.from({ length: vertices.length }).map(() => 0);
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i + 0];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];
    const v0x = vertices[i0 * 3 + 0];
    const v0y = vertices[i0 * 3 + 1];
    const v0z = vertices[i0 * 3 + 2];
    const t0s = texcoords[i0 * 2 + 0];
    const t0t = texcoords[i0 * 2 + 1];
    const v1x = vertices[i1 * 3 + 0];
    const v1y = vertices[i1 * 3 + 1];
    const v1z = vertices[i1 * 3 + 2];
    const t1s = texcoords[i1 * 2 + 0];
    const t1t = texcoords[i1 * 2 + 1];
    const v2x = vertices[i2 * 3 + 0];
    const v2y = vertices[i2 * 3 + 1];
    const v2z = vertices[i2 * 3 + 2];
    const t2s = texcoords[i2 * 2 + 0];
    const t2t = texcoords[i2 * 2 + 1];
    const x1 = v1x - v0x;
    const y1 = v1y - v0y;
    const z1 = v1z - v0z;
    const x2 = v2x - v0x;
    const y2 = v2y - v0y;
    const z2 = v2z - v0z;
    const s1 = t1s - t0s;
    const t1 = t1t - t0t;
    const s2 = t2s - t0s;
    const t2 = t2t - t0t;
    const r = 1 / (s1 * t2 - s2 * t1);
    const sd1 = (t2 * x1 - t1 * x2) * r;
    const sd2 = (t2 * y1 - t1 * y2) * r;
    const sd3 = (t2 * z1 - t1 * z2) * r;
    const td1 = (s1 * x2 - s2 * x1) * r;
    const td2 = (s1 * y2 - s2 * y1) * r;
    const td3 = (s1 * z2 - s2 * z1) * r;
    tangents[i0 * numTangentCompnents + 0] += sd1;
    tangents[i0 * numTangentCompnents + 1] += sd2;
    tangents[i0 * numTangentCompnents + 2] += sd3;
    bitangents[i0 * 3 + 0] += td1;
    bitangents[i0 * 3 + 1] += td2;
    bitangents[i0 * 3 + 2] += td3;
  }
  for (let i = 0; i < vertices.length / 3; i++) {
    const n0 = normals[i * 3 + 0];
    const n1 = normals[i * 3 + 1];
    const n2 = normals[i * 3 + 2];
    let t0 = tangents[i * numTangentCompnents + 0];
    let t1 = tangents[i * numTangentCompnents + 1];
    let t2 = tangents[i * numTangentCompnents + 2];
    const b0 = bitangents[i * 3 + 0];
    const b1 = bitangents[i * 3 + 1];
    const b2 = bitangents[i * 3 + 2];
    const dot = n0 * t0 + n1 * t1 + n2 * t2;
    t0 -= n0 * dot;
    t1 -= n1 * dot;
    t2 -= n2 * dot;
    const l = Math.hypot(t0, t1, t2);
    t0 /= l;
    t1 /= l;
    t2 /= l;
    tangents[i * numTangentCompnents + 0] = t0;
    tangents[i * numTangentCompnents + 1] = t1;
    tangents[i * numTangentCompnents + 2] = t2;
    if (withHandedness) {
      const cross0 = n1 * t2 - n2 * t1;
      const cross1 = n2 * t0 - n0 * t2;
      const cross2 = n0 * t1 - n1 * t0;
      tangents[i * numTangentCompnents + 3] = cross0 * b0 + cross1 * b1 + cross2 * b2 < 0 ? -1 : 1;
    }
  }
  return tangents;
}
