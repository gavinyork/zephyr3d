import {
  decodeMeshoptBufferViews,
  hasMeshoptBufferViews,
  isMeshoptFallbackBuffer
} from '../../../libs/loaders/src/gltf/meshopt';
import type { GLTFContent } from '../../../libs/loaders/src/gltf/gltf_importer';
import { ComponentType, GLTFAccessor } from '../../../libs/loaders/src/gltf/helpers';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

// Encoded offline with meshoptimizer 1.3 MeshoptEncoder.encodeGltfBuffer: a quad
// with u16 positions padded to 8 bytes (KHR_mesh_quantization), normals through
// encodeFilterOct(stride 4, 8 bits) and u16 triangle indices. Version 0 is the
// EXT_meshopt_compression bitstream, version 1 KHR_meshopt_compression.
const POSITIONS_RAW = 'AAAAAAAAAAD//wAAAAAAAAAA//8AAAAA/////+gDAAA=';
const INDICES_RAW = 'AAABAAIAAgABAAMA';
const NORMALS = [
  [0, 0, 1],
  [0.6, 0, 0.8],
  [0, -0.6, 0.8],
  [0.48, 0.6, 0.64]
];
const ENCODED = {
  v0: {
    positions: 'oAEZAAAAARkAAAABBAAAAAEEAAAAAQMAAAAvAQMAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    normals: 'oAE/AAAAbGtGAQ8AAABrxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfwA=',
    indices: '4fAQAHaHVmd4qYZliWiYAWkAAA=='
  },
  v1: {
    positions: 'obuvAAECAQAAAQAAAAAvAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAA==',
    normals: 'oa8AbGtGAABrxAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAA==',
    indices: '4fAQAHaHVmd4qYZliWiYAWkAAA=='
  }
};

function bytes(b64: string) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Builds a glTF whose three buffer views live compressed in buffer 0, with buffer 1 the fallback. */
function makeModel(extension: string, encoded: { positions: string; normals: string; indices: string }) {
  const parts = [bytes(encoded.positions), bytes(encoded.normals), bytes(encoded.indices)];
  const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  const offsets: number[] = [];
  let offset = 0;
  for (const p of parts) {
    offsets.push(offset);
    packed.set(p, offset);
    offset += p.length;
  }
  const compressed = (i: number, byteStride: number, count: number, mode: string, filter?: string) => ({
    [extension]: {
      buffer: 0,
      byteOffset: offsets[i],
      byteLength: parts[i].length,
      byteStride,
      count,
      mode,
      filter
    }
  });
  const gltf = {
    asset: { version: '2.0' },
    buffers: [
      { byteLength: packed.length },
      { byteLength: 76, extensions: { [extension]: { fallback: true } } }
    ],
    bufferViews: [
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: 32,
        byteStride: 8,
        extensions: compressed(0, 8, 4, 'ATTRIBUTES')
      },
      {
        buffer: 1,
        byteOffset: 32,
        byteLength: 16,
        byteStride: 4,
        extensions: compressed(1, 4, 4, 'ATTRIBUTES', 'OCTAHEDRAL')
      },
      { buffer: 1, byteOffset: 48, byteLength: 12, extensions: compressed(2, 2, 6, 'TRIANGLES') }
    ],
    // The fallback buffer is loaded as an empty placeholder, as the importer does
    _loadedBuffers: [packed.buffer, new ArrayBuffer(0)]
  } as unknown as GLTFContent;
  return gltf;
}

function viewBytes(gltf: GLTFContent, index: number) {
  const view = gltf.bufferViews![index];
  return new Uint8Array(gltf._loadedBuffers![view.buffer], view.byteOffset ?? 0, view.byteLength);
}

describe('glTF meshopt compression', () => {
  beforeAll(() => MeshoptDecoder.ready);

  for (const [extension, version] of [
    ['EXT_meshopt_compression', 'v0'],
    ['KHR_meshopt_compression', 'v1']
  ] as const) {
    test(`${extension} views decode back to the original bytes`, () => {
      const gltf = makeModel(extension, ENCODED[version]);
      expect(hasMeshoptBufferViews(gltf)).toBe(true);
      expect(isMeshoptFallbackBuffer(gltf.buffers![1])).toBe(true);
      expect(isMeshoptFallbackBuffer(gltf.buffers![0])).toBe(false);

      decodeMeshoptBufferViews(gltf, MeshoptDecoder);

      expect(Buffer.from(viewBytes(gltf, 0)).toString('base64')).toBe(POSITIONS_RAW);
      expect(Buffer.from(viewBytes(gltf, 2)).toString('base64')).toBe(INDICES_RAW);
      // Views now point at decoded buffers, never at the empty fallback
      for (const view of gltf.bufferViews!) {
        expect(view.buffer).toBeGreaterThan(1);
        expect(view.byteOffset).toBe(0);
      }
    });

    test(`${extension} octahedral normals read through a quantized accessor`, () => {
      const gltf = makeModel(extension, ENCODED[version]);
      decodeMeshoptBufferViews(gltf, MeshoptDecoder);
      // KHR_mesh_quantization normal: normalized BYTE VEC3 in a 4-byte stride
      const accessor = new GLTFAccessor({
        bufferView: 1,
        componentType: ComponentType.BYTE,
        normalized: true,
        count: 4,
        type: 'VEC3'
      } as never);
      const normals = accessor.getNormalizedDeinterlacedView(gltf)!;
      for (let i = 0; i < NORMALS.length; i++) {
        for (let c = 0; c < 3; c++) {
          // One 8-bit snorm step
          expect(Math.abs(normals[i * 3 + c] - NORMALS[i][c])).toBeLessThanOrEqual(1 / 127 + 1e-6);
        }
      }
    });
  }

  test('a model without the extension is left untouched', () => {
    const gltf = {
      bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 8 }],
      _loadedBuffers: [new ArrayBuffer(12)]
    } as unknown as GLTFContent;
    expect(hasMeshoptBufferViews(gltf)).toBe(false);
    decodeMeshoptBufferViews(gltf, MeshoptDecoder);
    expect(gltf.bufferViews![0]).toEqual({ buffer: 0, byteOffset: 4, byteLength: 8 });
  });
});
