import { MemoryFS } from '@zephyr3d/base';
import {
  Material,
  PBRBluePrintMaterial,
  PBRBluePrintMaterialInstance,
  PBRMetallicRoughnessMaterial,
  ResourceManager
} from '@zephyr3d/scene';

describe('Normal map Y flip', () => {
  test('PBR material should default to an unflipped normal map and copy the setting', () => {
    const source = new PBRMetallicRoughnessMaterial();
    expect(source.normalFlipY).toBe(false);

    source.normalScale = 1.75;
    source.normalFlipY = true;
    const copy = new PBRMetallicRoughnessMaterial();
    const baseCopyFrom = jest.spyOn(Material.prototype, 'copyFrom').mockImplementation(() => undefined);
    try {
      copy.copyFrom(source);
    } finally {
      baseCopyFrom.mockRestore();
    }

    expect(copy.normalScale).toBe(1.75);
    expect(copy.normalFlipY).toBe(true);
  });

  test('PBR material should serialize and restore normal map controls', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const source = new PBRMetallicRoughnessMaterial();
    source.normalScale = 2.25;
    source.normalFlipY = true;

    const props = await manager.serializeObjectProps(source);
    expect(props.NormalScale).toBe(2.25);
    expect(props.NormalFlipY).toBe(true);

    const restored = new PBRMetallicRoughnessMaterial();
    await manager.deserializeObjectProps(restored, props);
    expect(restored.normalScale).toBe(2.25);
    expect(restored.normalFlipY).toBe(true);
  });

  test('ordinary PBR parameter changes should sync without copying the whole material', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const path = '/materials/skin.zmtl';
    const source = new PBRMetallicRoughnessMaterial();
    const sceneMaterial = new PBRMetallicRoughnessMaterial();
    manager.setAssetId(source, path);
    manager.trackMaterialReference(sceneMaterial, path);

    source.roughness = 0.35;
    source.normalScale = 0.6;
    source.normalFlipY = true;
    const cls = manager.getClassByConstructor(PBRMetallicRoughnessMaterial)!;
    const props = manager.getAllPropertiesByClass(cls);
    const copyFrom = jest.spyOn(sceneMaterial, 'copyFrom').mockImplementation(() => undefined);
    for (const name of ['Roughness', 'NormalScale', 'NormalFlipY']) {
      await manager.syncMaterialPropertyReferences(source, props.find((prop) => prop.name === name)!);
    }

    expect(sceneMaterial.roughness).toBeCloseTo(0.35);
    expect(sceneMaterial.normalScale).toBeCloseTo(0.6);
    expect(sceneMaterial.normalFlipY).toBe(true);
    expect(copyFrom).not.toHaveBeenCalled();
    copyFrom.mockRestore();
  });

  test('ordinary PBR parameter changes should refresh tracked instance uniform buffers', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const path = '/materials/instanced-skin.zmtl';
    const source = new PBRMetallicRoughnessMaterial();
    const values = { roughness: 1, metallic: 1 };
    const sceneInstance = Object.create(source) as PBRMetallicRoughnessMaterial & {
      $isInstance: true;
      getInstancedUniforms(): Array<{ name: string }>;
    };
    Object.defineProperties(sceneInstance, {
      $isInstance: { value: true },
      coreMaterial: { value: source },
      getInstancedUniforms: {
        value: () => [{ name: 'Roughness' }, { name: 'Metallic' }]
      },
      roughness: {
        get: () => values.roughness,
        set: (value: number) => {
          values.roughness = value;
        }
      },
      metallic: {
        get: () => values.metallic,
        set: (value: number) => {
          values.metallic = value;
        }
      }
    });
    manager.setAssetId(source, path);
    manager.trackMaterialReference(sceneInstance, path);

    source.roughness = 0.42;
    source.metallic = 0.3;
    const cls = manager.getClassByConstructor(PBRMetallicRoughnessMaterial)!;
    const props = manager.getAllPropertiesByClass(cls);
    await manager.syncMaterialPropertyReferences(source, props.find((prop) => prop.name === 'Roughness')!);
    await manager.syncMaterialPropertyReferences(source, props.find((prop) => prop.name === 'Metallic')!);

    expect(values.roughness).toBeCloseTo(0.42);
    expect(values.metallic).toBeCloseTo(0.3);
  });

  test('Blueprint material instance should inherit and preserve overridden normal map controls', () => {
    const parent = new PBRBluePrintMaterial();
    parent.normalScale = 1.5;
    parent.normalFlipY = true;
    const instance = new PBRBluePrintMaterialInstance(parent, '/materials/parent.zmtl');

    expect(instance.normalScale).toBe(1.5);
    expect(instance.normalFlipY).toBe(true);

    instance.normalScale = 0.75;
    instance.normalFlipY = false;
    instance.markMaterialPropertyOverridden('NormalScale');
    instance.markMaterialPropertyOverridden('NormalFlipY');
    parent.normalScale = 2.5;
    parent.normalFlipY = true;
    instance.syncInheritedUniforms();

    expect(instance.normalScale).toBe(0.75);
    expect(instance.normalFlipY).toBe(false);
  });
});
