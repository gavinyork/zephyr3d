import { MemoryFS, Vector4 } from '@zephyr3d/base';
import { Camera, DualDepthPeelingOIT, ResourceManager, Scene, SkinMaterial } from '../../../libs/scene/src';

describe('Skin material serialization', () => {
  test('round-trips SkinMaterial properties', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SkinMaterial();

    material.shininess = 96;
    material.specularStrength = 0.17;
    material.diffuseWrap = 0.36;
    material.diffuseSoftness = 0.62;
    material.scatterWrap = 0.82;
    material.scatterStrength = 0.91;
    material.scatterColor = new Vector4(0.98, 0.34, 0.22, 1);
    material.transmissionStrength = 0.8;
    material.transmissionPower = 6;
    material.shadowTint = new Vector4(0.86, 0.45, 0.6, 1);
    material.brightening = 0.25;
    material.albedoColor = new Vector4(0.8, 0.55, 0.48, 1);
    material.cullMode = 'none';
    material.vertexTangent = true;
    material.doubleSidedLighting = false;

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SkinMaterial>(null, serialized))!;

    expect(serialized.ClassName).toBe('SkinMaterial');
    const serializedObject = serialized.Object as Record<string, any>;
    expect(serializedObject).toMatchObject({
      Shininess: 96,
      SpecularStrength: 0.17,
      DiffuseWrap: 0.36,
      DiffuseSoftness: 0.62,
      ScatterWrap: 0.82,
      ScatterStrength: 0.91,
      TransmissionStrength: 0.8,
      TransmissionPower: 6,
      Brightening: 0.25,
      vertexTangent: true,
      doubleSidedLighting: false
    });
    expect(serializedObject.ScatterColor[0]).toBeCloseTo(0.98);
    expect(serializedObject.ScatterColor[1]).toBeCloseTo(0.34);
    expect(serializedObject.ScatterColor[2]).toBeCloseTo(0.22);
    expect(serializedObject.ScatterColor[3]).toBeCloseTo(1);
    expect(serializedObject.AlbedoColor[0]).toBeCloseTo(0.8);
    expect(serializedObject.AlbedoColor[1]).toBeCloseTo(0.55);
    expect(serializedObject.AlbedoColor[2]).toBeCloseTo(0.48);
    expect(serializedObject.AlbedoColor[3]).toBeCloseTo(1);
    expect(restored).toBeInstanceOf(SkinMaterial);
    expect(restored.shininess).toBeCloseTo(96);
    expect(restored.specularStrength).toBeCloseTo(0.17);
    expect(restored.diffuseWrap).toBeCloseTo(0.36);
    expect(restored.diffuseSoftness).toBeCloseTo(0.62);
    expect(restored.scatterWrap).toBeCloseTo(0.82);
    expect(restored.scatterStrength).toBeCloseTo(0.91);
    expect(restored.transmissionStrength).toBeCloseTo(0.8);
    expect(restored.transmissionPower).toBeCloseTo(6);
    expect(restored.shadowTint.x).toBeCloseTo(0.86);
    expect(restored.shadowTint.y).toBeCloseTo(0.45);
    expect(restored.shadowTint.z).toBeCloseTo(0.6);
    expect(restored.brightening).toBeCloseTo(0.25);
    expect(restored.scatterColor.x).toBeCloseTo(0.98);
    expect(restored.scatterColor.y).toBeCloseTo(0.34);
    expect(restored.scatterColor.z).toBeCloseTo(0.22);
    expect(restored.albedoColor.x).toBeCloseTo(0.8);
    expect(restored.albedoColor.y).toBeCloseTo(0.55);
    expect(restored.albedoColor.z).toBeCloseTo(0.48);
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
    expect(restored.skinSSSOpacity).toBeCloseTo(0.12);
    expect(restored.skinSSSSampleStep).toBeCloseTo(2.5);
    expect(restored.skinSSSScatterRadius).toBeCloseTo(0.03);
    expect(restored.skinSSSSmoothness).toBeCloseTo(0.6);
    expect(restored.skinSSSDepthScale).toBeCloseTo(96);
    expect(restored.skinSSSColorBoost).toBeCloseTo(1.1);
  });

  test('round-trips camera dual depth peeling OIT mode', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.oitMode = 'dual-depth';

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(camera.oit).toBeInstanceOf(DualDepthPeelingOIT);
    expect(serialized.Object).toMatchObject({
      OITMode: 'dual-depth'
    });
    expect(restored.oitMode).toBe('dual-depth');
    expect(restored.oit).toBeInstanceOf(DualDepthPeelingOIT);
  });
});
