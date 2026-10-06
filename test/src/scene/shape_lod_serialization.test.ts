import { MemoryFS } from '@zephyr3d/base';
import { createNullDevice } from '@zephyr3d/backend-null';
import { BoxShape, ResourceManager, SphereShape } from '@zephyr3d/scene';
import * as api from '../../../libs/scene/src/app/api';

beforeAll(async () => {
  const device = await createNullDevice();
  jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
});

describe('shape level of detail settings', () => {
  it('stay off for a shape saved without them', async () => {
    const manager = new ResourceManager(new MemoryFS());
    for (const Ctor of [SphereShape, BoxShape]) {
      const shape = new Ctor();
      const restored = (await manager.deserializeObject<SphereShape>(
        null,
        await manager.serializeObject(shape)
      ))!;
      expect(restored.options.lod).toBeNull();
      expect(restored.lods.length).toBe(0);
    }
  });
});
