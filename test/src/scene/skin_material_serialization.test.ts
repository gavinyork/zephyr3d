import { MemoryFS, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Camera,
  DualDepthPeelingOIT,
  ResourceManager,
  Scene,
  SkinMaterial,
  SkinProfile
} from '../../../libs/scene/src';

describe('Skin material serialization', () => {
  test('round-trips SkinMaterial properties', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SkinMaterial();

    material.roughness = 0.4;
    material.specularF0 = 0.03;
    material.transmissionStrength = 0.8;
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
      TransmissionStrength: 0.8,
      vertexTangent: true,
      doubleSidedLighting: false
    });
    expect(restored).toBeInstanceOf(SkinMaterial);
    expect(restored.roughness).toBeCloseTo(0.4);
    expect(restored.specularF0).toBeCloseTo(0.03);
    expect(restored.transmissionStrength).toBeCloseTo(0.8);
    expect(restored.albedoColor.x).toBeCloseTo(0.8);
    expect(restored.cullMode).toBe('none');
    expect(restored.vertexTangent).toBe(true);
    expect(restored.doubleSidedLighting).toBe(false);
  });

  test('round-trips the transmission parameters of a profile', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const profile = new SkinProfile('skin');
    profile.scatteringDistribution = -0.4;
    profile.ior = 1.32;
    profile.extinctionScale = 2.5;
    profile.transmissionTint = new Vector3(0.9, 0.3, 0.22);

    const serialized = await manager.serializeObject(profile);
    const restored = (await manager.deserializeObject<SkinProfile>(null, serialized))!;

    expect(restored.scatteringDistribution).toBeCloseTo(-0.4);
    expect(restored.ior).toBeCloseTo(1.32);
    expect(restored.extinctionScale).toBeCloseTo(2.5);
    expect(restored.transmissionTint.y).toBeCloseTo(0.3);
    profile.dispose();
    restored.dispose();
  });

  test('round-trips the material subsurface profile', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SkinMaterial();
    const profile = new SkinProfile('skin_dark');
    profile.meanFreePathDistance = 0.017;
    profile.surfaceAlbedo = new Vector3(0.71, 0.46, 0.37);
    profile.lobeMix = 0.22;
    material.subsurfaceProfile = profile;

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SkinMaterial>(null, serialized))!;

    expect(restored.subsurfaceProfile).toBeInstanceOf(SkinProfile);
    expect(restored.subsurfaceProfile!.preset).toBe('skin_dark');
    expect(restored.subsurfaceProfile!.meanFreePathDistance).toBeCloseTo(0.017);
    expect(restored.subsurfaceProfile!.surfaceAlbedo.x).toBeCloseTo(0.71);
    expect(restored.subsurfaceProfile!.lobeMix).toBeCloseTo(0.22);
    // A deserialized profile takes its own table slot rather than aliasing the
    // one it was saved from.
    expect(restored.subsurfaceProfile!.id).not.toBe(profile.id);
    profile.dispose();
    restored.subsurfaceProfile!.dispose();
  });

  test('a null profile falls back to the shared default', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SkinMaterial();
    expect(material.subsurfaceProfile).toBeNull();

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SkinMaterial>(null, serialized))!;

    expect(restored.subsurfaceProfile).toBeNull();
  });

  test('round-trips camera SkinSSS post-process settings', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.skinSSS = true;
    camera.skinSSSDebugOutput = 'sampleRadius';

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(serialized.Object).toMatchObject({
      SkinSSSEnabled: true,
      SkinSSSDebugOutput: 'sampleRadius'
    });
    expect(restored.skinSSS).toBe(true);
    // The debug selection is held on the camera, not only forwarded to the post
    // effect, so it survives a round trip even though the effect is created lazily.
    expect(restored.skinSSSDebugOutput).toBe('sampleRadius');
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
