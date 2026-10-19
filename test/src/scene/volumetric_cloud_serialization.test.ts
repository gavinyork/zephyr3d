import { MemoryFS } from '@zephyr3d/base';
import { createNullDevice } from '@zephyr3d/backend-null';
import { ResourceManager, Scene, VolumetricCloud } from '../../../libs/scene/src';
import * as api from '../../../libs/scene/src/app/api';

beforeAll(async () => {
  const device = await createNullDevice();
  jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
});

describe('volumetric cloud shaping controls', () => {
  it.each(['shapeStrength', 'detailBottomErosion'] as const)(
    'clamps %s and invalidates the cache only when its effective value changes',
    (key) => {
      const cloud = new VolumetricCloud();
      expect(cloud[key]).toBe(1);
      const version = cloud.version;
      cloud[key] = 2;
      expect(cloud[key]).toBe(1);
      expect(cloud.version).toBe(version);

      cloud[key] = 0.4;
      expect(cloud[key]).toBe(0.4);
      expect(cloud.version).toBe(version + 1);
      cloud[key] = 0.4;
      expect(cloud.version).toBe(version + 1);

      cloud[key] = -1;
      expect(cloud[key]).toBe(0);
      expect(cloud.version).toBe(version + 2);
      cloud[key] = -2;
      expect(cloud.version).toBe(version + 2);
    }
  );

  it('round-trips shaping controls through scene serialization', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    scene.env.sky.skyType = 'scatter';
    scene.env.sky.cloudMode = 'volumetric';
    scene.env.sky.volumetricCloud.shapeStrength = 0.45;
    scene.env.sky.volumetricCloud.detailBottomErosion = 0.15;
    scene.env.sky.cloudDebugView = 'densityXZ';
    scene.env.sky.cloudDebugSlice = 0.35;

    const serialized = await manager.serializeObject(scene);
    expect(serialized.Object).toMatchObject({
      VolumetricCloudShapeStrength: 0.45,
      VolumetricCloudDetailBottomErosion: 0.15,
      VolumetricCloudDebugView: 'densityXZ',
      VolumetricCloudDebugSlice: 0.35
    });
    const restored = (await manager.deserializeObject<Scene>(null, serialized))!;
    expect(restored.env.sky.volumetricCloud.shapeStrength).toBe(0.45);
    expect(restored.env.sky.volumetricCloud.detailBottomErosion).toBe(0.15);
    expect(restored.env.sky.cloudDebugView).toBe('densityXZ');
    expect(restored.env.sky.cloudDebugSlice).toBe(0.35);
    restored.dispose();
    scene.dispose();
  });

  it('uses neutral shaping controls when loading older scene data', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    scene.env.sky.skyType = 'scatter';
    scene.env.sky.cloudMode = 'volumetric';
    scene.env.sky.volumetricCloud.shapeStrength = 0.45;
    scene.env.sky.volumetricCloud.detailBottomErosion = 0.15;

    const serialized = await manager.serializeObject(scene);
    delete serialized.Object.VolumetricCloudShapeStrength;
    delete serialized.Object.VolumetricCloudDetailBottomErosion;
    const restored = (await manager.deserializeObject<Scene>(null, serialized))!;
    expect(restored.env.sky.volumetricCloud.shapeStrength).toBe(1);
    expect(restored.env.sky.volumetricCloud.detailBottomErosion).toBe(1);
    restored.dispose();
    scene.dispose();
  });
});
