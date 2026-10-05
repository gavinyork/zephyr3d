import { createNullDevice } from '@zephyr3d/backend-null';
import { Primitive, readPrimitiveIndices, readPrimitiveTriangles } from '@zephyr3d/scene';
import * as api from '../../../libs/scene/src/app/api';

beforeAll(async () => {
  jest.spyOn(api, 'getDevice').mockReturnValue((await createNullDevice()) as any);
});

/** Two quads sharing nothing: LOD 0 is both (12 indices), LOD 1 the second alone. */
function twoLevelPrimitive() {
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer(
    'position_f32x3',
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 5, 1, 5, 6, 1, 5, 6, 1, 6, 5, 1, 6])
  );
  const lod0 = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6];
  const lod1 = [4, 6, 5, 4, 7, 6];
  primitive.createAndSetIndexBuffer(new Uint16Array([...lod0, ...lod1]));
  primitive.primitiveType = 'triangle-list';
  primitive.indexStart = 0;
  primitive.indexCount = lod0.length;
  primitive.lods = [{ indexStart: lod0.length, indexCount: lod1.length, screenSize: 0.1 } as any];
  return primitive;
}

describe('primitive read back', () => {
  it('reads only the full-detail range of an index buffer holding several levels', async () => {
    const indices = await readPrimitiveIndices(twoLevelPrimitive());
    expect(Array.from(indices)).toEqual([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
  });

  it('reads a level of detail with only the vertices it uses', async () => {
    const { positions, indices } = await readPrimitiveTriangles(twoLevelPrimitive(), 1);
    expect(Array.from(indices)).toEqual([0, 1, 2, 0, 3, 1]);
    expect(positions.length).toBe(12);
    expect(Array.from(positions.subarray(0, 3))).toEqual([5, 1, 5]);
  });

  it('refuses primitives that are not triangle lists', async () => {
    const primitive = twoLevelPrimitive();
    primitive.primitiveType = 'line-list';
    await expect(readPrimitiveIndices(primitive)).rejects.toThrow(/triangle-list/);
  });
});
