import { planMeshStreams, quantizeSkinWeights } from '../../../utility/editor/src/helpers/meshquantize';
import type { SourceStream } from '../../../utility/editor/src/helpers/meshquantize';

const f32 = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);

function stream(semantic: string, format: string, values: number[]): SourceStream {
  return { semantic, format, data: f32(values) };
}

const POSITIONS = stream('position', 'position_f32x3', [0, 0, 0, 1, 0, 0, 0, 1, 0]);

describe('mesh quantization plan', () => {
  test('normals and tangents go octahedral, 8 bits to snorm8 and 12 or 16 bits to snorm16', () => {
    const normals = stream('normal', 'normal_f32x3', [0, 0, 2, 0, 3, 0, 0, 0, 0]);
    const tangents = stream('tangent', 'tangent_f32x4', [1, 0, 0, -1, 0, 1, 0, 1, 0, 0, 1, 1]);
    const eight = planMeshStreams([POSITIONS, normals, tangents], 8).plans;
    expect(eight[1]).toMatchObject({ kind: 'octahedral', format: 'normal_i8normx4', byteStride: 4, bits: 8 });
    const twelve = planMeshStreams([POSITIONS, normals, tangents], 12).plans;
    expect(twelve[1]).toMatchObject({ format: 'normal_i16normx4', byteStride: 8, bits: 12 });
    expect(twelve[2]).toMatchObject({ format: 'tangent_i16normx4', byteStride: 8 });
    const n = (twelve[1] as { vectors: Float32Array }).vectors;
    // Normalized, and a zero-length normal still becomes a valid unit vector
    expect(Array.from(n.subarray(0, 8))).toEqual([0, 0, 1, 1, 0, 1, 0, 1]);
    expect(Array.from(n.subarray(8, 12))).toEqual([0, 0, 1, 1]);
    // The tangent sign survives in w
    const t = (twelve[2] as { vectors: Float32Array }).vectors;
    expect([t[3], t[7], t[11]]).toEqual([-1, 1, 1]);
  });

  test('normals stay float when quantization is off, and positions and UVs are always kept', () => {
    const normals = stream('normal', 'normal_f32x3', [0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = stream('texCoord0', 'tex0_f32x2', [0, 0, 1, 0, 0, 1]);
    const { vertexCount, plans } = planMeshStreams([POSITIONS, normals, uvs], 0);
    expect(vertexCount).toBe(3);
    expect(plans.map((p) => p.kind)).toEqual(['copy', 'copy', 'copy']);
    expect(plans.map((p) => p.format)).toEqual(['position_f32x3', 'normal_f32x3', 'tex0_f32x2']);
  });

  test('vertex colours become unorm8 only when they fit in [0, 1]', () => {
    const ldr = stream('diffuse', 'diffuse_f32x3', [0, 0.5, 1, 1, 1, 1, 0, 0, 0]);
    expect(planMeshStreams([POSITIONS, ldr], 12).plans[1]).toMatchObject({
      kind: 'color',
      format: 'diffuse_u8normx4'
    });
    const hdr = stream('diffuse', 'diffuse_f32x4', [0, 0, 4, 1, 1, 1, 1, 1, 0, 0, 0, 1]);
    expect(planMeshStreams([POSITIONS, hdr], 12).plans[1]).toMatchObject({
      kind: 'copy',
      format: 'diffuse_f32x4'
    });
  });

  test('skin weights sum to exactly 255 after quantization', () => {
    // Thirds round to 85 each; the fourth weight is zero
    const q = quantizeSkinWeights(
      new Float32Array([1 / 3, 1 / 3, 1 / 3, 0, 0.7, 0.2, 0.05, 0.05, 2, 1, 1, 0]),
      3
    );
    for (let i = 0; i < 3; i++) {
      expect(q[i * 4] + q[i * 4 + 1] + q[i * 4 + 2] + q[i * 4 + 3]).toBe(255);
    }
    // Thirds: 85 + 85 + 85 = 255 already, nothing adjusted
    expect(Array.from(q.subarray(0, 4))).toEqual([85, 85, 85, 0]);
    // 0.7/0.2/0.05/0.05 rounds to 179 + 51 + 13 + 13 = 256; the largest absorbs the excess
    expect(Array.from(q.subarray(4, 8))).toEqual([178, 51, 13, 13]);
    // Unnormalized input is normalized first: 2/1/1 of 4 rounds to 128 + 64 + 64 = 256
    expect(Array.from(q.subarray(8, 12))).toEqual([127, 64, 64, 0]);
    // All-zero weights stay zero rather than being invented
    expect(Array.from(quantizeSkinWeights(new Float32Array(4), 1))).toEqual([0, 0, 0, 0]);
  });

  test('meshes meshopt cannot encode, or with inconsistent streams, are rejected', () => {
    const odd = { semantic: 'texCoord1', format: 'tex1_u16x2', data: new Uint8Array(3 * 4) };
    expect(() => planMeshStreams([POSITIONS, odd], 12)).not.toThrow();
    const unaligned = { semantic: 'texCoord1', format: 'tex1_u8normx2', data: new Uint8Array(3 * 2) };
    expect(() => planMeshStreams([POSITIONS, unaligned], 12)).toThrow(/stride/);
    const short = stream('normal', 'normal_f32x3', [0, 0, 1]);
    expect(() => planMeshStreams([POSITIONS, short], 12)).toThrow(/vertices/);
    expect(() => planMeshStreams([short], 12)).toThrow(/position/);
  });
});
