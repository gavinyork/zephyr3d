import { MeshoptDecoder } from 'meshoptimizer/decoder';
import {
  decodeZmshBinary,
  isZmshBinary,
  readZmshBinary,
  writeZmshBinary,
  ZMSH_MAGIC
} from '../../../libs/scene/src/asset/zmsh_binary';

// Same fixture as gltf_meshopt.test.ts: a quad encoded offline with meshoptimizer
// 1.3 encodeGltfBuffer, version 1 (the KHR_meshopt_compression bitstream).
const POSITIONS_RAW = 'AAAAAAAAAAD//wAAAAAAAAAA//8AAAAA/////+gDAAA=';
const INDICES_RAW = 'AAABAAIAAgABAAMA';
const NORMALS = [
  [0, 0, 1],
  [0.6, 0, 0.8],
  [0, -0.6, 0.8],
  [0.48, 0.6, 0.64]
];
const ENCODED = {
  positions: 'obuvAAECAQAAAQAAAAAvAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAA==',
  normals: 'oa8AbGtGAABrxAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAA==',
  indices: '4fAQAHaHVmd4qYZliWiYAWkAAA=='
};

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
const b64 = (u8: Uint8Array) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');

const baseHeader = {
  primitiveType: 'triangle-list' as const,
  vertexCount: 4,
  indexCount: 6,
  boxMin: [0, 0, 0] as [number, number, number],
  boxMax: [1, 1, 0] as [number, number, number]
};

describe('binary .zmsh', () => {
  beforeAll(() => MeshoptDecoder.ready);

  test('raw streams round-trip and keep their byte order', () => {
    const file = writeZmshBinary(
      {
        ...baseHeader,
        encoding: 'none',
        attributes: [{ format: 'position_u16x4', byteStride: 8 }],
        indices: { type: 'u16', mode: 'TRIANGLES' }
      },
      [bytes(POSITIONS_RAW)],
      bytes(INDICES_RAW)
    );
    expect(isZmshBinary(file)).toBe(true);
    expect(new DataView(file).getUint32(0, true)).toBe(ZMSH_MAGIC);
    const { header, vertexData, indexData } = decodeZmshBinary(file, null);
    expect(header.boxMax).toEqual([1, 1, 0]);
    expect(header.attributes[0].offset % 4).toBe(0);
    expect(b64(vertexData[0])).toBe(POSITIONS_RAW);
    expect(Array.from(indexData!)).toEqual([0, 1, 2, 2, 1, 3]);
  });

  test('meshopt streams decode to the source data, including filtered normals', () => {
    const file = writeZmshBinary(
      {
        ...baseHeader,
        encoding: 'meshopt',
        attributes: [
          { format: 'position_u16x4', byteStride: 8 },
          { format: 'normal_i8normx4', byteStride: 4, filter: 'OCTAHEDRAL' }
        ],
        indices: { type: 'u16', mode: 'TRIANGLES' }
      },
      [bytes(ENCODED.positions), bytes(ENCODED.normals)],
      bytes(ENCODED.indices)
    );
    const { vertexData, indexData } = decodeZmshBinary(file, MeshoptDecoder);
    expect(b64(vertexData[0])).toBe(POSITIONS_RAW);
    expect(b64(new Uint8Array(indexData!.buffer, indexData!.byteOffset, indexData!.byteLength))).toBe(
      INDICES_RAW
    );
    const normals = new Int8Array(vertexData[1].buffer, vertexData[1].byteOffset, 16);
    NORMALS.forEach((n, i) => {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(normals[i * 4 + c] / 127 - n[c])).toBeLessThanOrEqual(1 / 127 + 1e-6);
      }
    });
  });

  test('meshopt files without a decoder, JSON files and truncated files are rejected', () => {
    const file = writeZmshBinary(
      {
        ...baseHeader,
        encoding: 'meshopt',
        attributes: [{ format: 'position_u16x4', byteStride: 8 }],
        indices: null
      },
      [bytes(ENCODED.positions)],
      null
    );
    expect(() => decodeZmshBinary(file, null)).toThrow(/decoder/);
    const json = new TextEncoder().encode(JSON.stringify({ type: 'Primitive', data: {} })).buffer;
    expect(isZmshBinary(json)).toBe(false);
    expect(() => readZmshBinary(file.slice(0, file.byteLength - 8))).toThrow(/Truncated/);
  });
});
