// Generates the .zmsh fixtures for the zmsh-binary scene: one UV sphere written
// as a version 1 (JSON + base64, float normals) and a version 2 (binary,
// meshopt-encoded, 8-bit octahedral normals) primitive.
//
// Uses the container writer from the built scene package and meshoptimizer's
// own encoder, so the fixtures are what the editor's pipeline produces rather
// than a hand-rolled imitation. Run after building @zephyr3d/scene:
//
//   node tools/gen-zmsh-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MeshoptEncoder } from 'meshoptimizer/encoder';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'assets', 'zmsh');
const { writeZmshBinary } = await import(
  pathToFileURL(path.join(__dirname, '..', '..', 'libs', 'scene', 'dist', 'asset', 'zmsh_binary.js')).href
);

function sphere(radius, rings, segments) {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      positions.push(n[0] * radius, n[1] * radius, n[2] * radius);
      normals.push(...n);
      uvs.push(s / segments, r / rings);
    }
  }
  const indices = [];
  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    radius
  };
}

const u8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const b64 = (a) => Buffer.from(u8(a)).toString('base64');

await MeshoptEncoder.ready;
const mesh = sphere(0.8, 32, 48);
const vertexCount = mesh.positions.length / 3;
const box = {
  boxMin: [-mesh.radius, -mesh.radius, -mesh.radius],
  boxMax: [mesh.radius, mesh.radius, mesh.radius]
};
fs.mkdirSync(outDir, { recursive: true });

// Version 1: the JSON form SharedModel.writePrimitive produces
fs.writeFileSync(
  path.join(outDir, 'sphere-v1.zmsh'),
  JSON.stringify({
    type: 'Primitive',
    data: {
      vertices: {
        position: { format: 'position_f32x3', data: b64(mesh.positions) },
        normal: { format: 'normal_f32x3', data: b64(mesh.normals) },
        texCoord0: { format: 'tex0_f32x2', data: b64(mesh.uvs) }
      },
      indices: b64(mesh.indices),
      indexType: 'u16',
      indexCount: mesh.indices.length,
      type: 'triangle-list',
      ...box
    }
  })
);

// Version 2: normals through the octahedral filter (padded to 4 floats per vertex)
const normals4 = new Float32Array(vertexCount * 4);
for (let i = 0; i < vertexCount; i++) {
  normals4.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * 4);
}
const octNormals = MeshoptEncoder.encodeFilterOct(normals4, vertexCount, 4, 8);
const encode = (data, count, size, mode) => MeshoptEncoder.encodeGltfBuffer(data, count, size, mode, 1);
fs.writeFileSync(
  path.join(outDir, 'sphere-v2-meshopt.zmsh'),
  Buffer.from(
    writeZmshBinary(
      {
        primitiveType: 'triangle-list',
        vertexCount,
        indexCount: mesh.indices.length,
        ...box,
        encoding: 'meshopt',
        attributes: [
          { format: 'position_f32x3', byteStride: 12 },
          { format: 'normal_i8normx4', byteStride: 4, filter: 'OCTAHEDRAL' },
          { format: 'tex0_f32x2', byteStride: 8 }
        ],
        indices: { type: 'u16', mode: 'TRIANGLES' }
      },
      [
        encode(u8(mesh.positions), vertexCount, 12, 'ATTRIBUTES'),
        encode(octNormals, vertexCount, 4, 'ATTRIBUTES'),
        encode(u8(mesh.uvs), vertexCount, 8, 'ATTRIBUTES')
      ],
      encode(u8(mesh.indices), mesh.indices.length, 2, 'TRIANGLES')
    )
  )
);
for (const name of fs.readdirSync(outDir)) {
  console.log(`${name}: ${fs.statSync(path.join(outDir, name)).size} bytes`);
}
