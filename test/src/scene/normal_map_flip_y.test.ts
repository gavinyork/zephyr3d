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
