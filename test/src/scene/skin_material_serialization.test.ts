import { MemoryFS, Vector4 } from '@zephyr3d/base';
import { Camera, DualDepthPeelingOIT, ResourceManager, Scene, SkinMaterial } from '../../../libs/scene/src';

describe('Skin material serialization', () => {
  test('round-trips SkinMaterial properties', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SkinMaterial();

    material.roughness = 0.4;
    material.specularF0 = 0.03;
    material.specularStrength = 0.17;
    material.dualLobeBlend = 0.6;
    material.narrowLobeRoughnessMod = 0.4;
    material.wideLobeRoughnessMod = 0.8;
    material.transmissionStrength = 0.8;
    material.transmissionPower = 6;
    material.albedoColor = new Vector4(0.8, 0.55, 0.48, 1);
    material.cullMode = 'none';
    material.vertexTangent = true;
    material.doubleSidedLighting = false;

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SkinMaterial>(null, serialized))!;

    expect(serialized.ClassName).toBe('SkinMaterial');
    const obj = serialized.Object as Record<string, any>;
    expect(obj).toMatchObject({
      Roughness: 0.4,
      SpecularF0: 0.03,
      SpecularStrength: 0.17,
      DualLobeBlend: 0.6,
      NarrowLobeRoughnessMod: 0.4,
      WideLobeRoughnessMod: 0.8,
      TransmissionStrength: 0.8,
      TransmissionPower: 6,
      vertexTangent: true,
      doubleSidedLighting: false
    });
    expect(restored).toBeInstanceOf(SkinMaterial);
    expect(restored.roughness).toBeCloseTo(0.4);
    expect(restored.specularF0).toBeCloseTo(0.03);
    expect(restored.specularStrength).toBeCloseTo(0.17);
    expect(restored.dualLobeBlend).toBeCloseTo(0.6);
    expect(restored.narrowLobeRoughnessMod).toBeCloseTo(0.4);
    expect(restored.wideLobeRoughnessMod).toBeCloseTo(0.8);
    expect(restored.transmissionStrength).toBeCloseTo(0.8);
    expect(restored.transmissionPower).toBeCloseTo(6);
    expect(restored.albedoColor.x).toBeCloseTo(0.8);
    expect(restored.cullMode).toBe('none');
    expect(restored.vertexTangent).toBe(true);
    expect(restored.doubleSidedLighting).toBe(false);
  });

  test('round-trips camera SkinSSS post-process settings', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.skinSSS = true;
    camera.skinSSSStrength = 1.2;
    camera.skinSSSOpacity = 0.12;
    camera.skinSSSSampleStep = 2.5;
    camera.skinSSSScatterRadius = 0.03;
    camera.skinSSSSmoothness = 0.6;
    camera.skinSSSDepthScale = 96;
    camera.skinSSSColorBoost = 1.1;

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(serialized.Object).toMatchObject({
      SkinSSSEnabled: true,
      SkinSSSStrength: 1.2,
      SkinSSSOpacity: 0.12,
      SkinSSSSampleStep: 2.5,
      SkinSSSScatterRadius: 0.03,
      SkinSSSSmoothness: 0.6,
      SkinSSSDepthScale: 96,
      SkinSSSColorBoost: 1.1
    });
    expect(restored.skinSSS).toBe(true);
    expect(restored.skinSSSStrength).toBeCloseTo(1.2);
  });

  test('round-trips camera dual depth peeling OIT mode', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.oitMode = 'dual-depth';

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(camera.oit).toBeInstanceOf(DualDepthPeelingOIT);
    expect(serialized.Object).toMatchObject({ OITMode: 'dual-depth' });
    expect(restored.oitMode).toBe('dual-depth');
    expect(restored.oit).toBeInstanceOf(DualDepthPeelingOIT);
  });
});
