import { getVertexAttribFormat, getVertexFormatSize } from '@zephyr3d/device';

// Formats compressed meshes ship with: quantized unit vectors for normals and
// tangents, normalized integer skin weights. Four components because 8- and
// 16-bit vertex formats exist only as pairs and quads.
describe('quantized vertex attribute formats', () => {
  test.each([
    ['normal', 'i8norm', 'normal_i8normx4', 4],
    ['normal', 'i16norm', 'normal_i16normx4', 8],
    ['tangent', 'i8norm', 'tangent_i8normx4', 4],
    ['tangent', 'i16norm', 'tangent_i16normx4', 8],
    ['blendWeights', 'u8norm', 'blendweights_u8normx4', 4],
    ['blendWeights', 'u16norm', 'blendweights_u16normx4', 8]
  ] as const)('%s as %s resolves to %s, %d bytes', (semantic, type, format, size) => {
    expect(getVertexAttribFormat(semantic, type, 4)).toBe(format);
    expect(getVertexFormatSize(format)).toBe(size);
  });
});
