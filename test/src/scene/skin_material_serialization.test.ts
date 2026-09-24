import { MemoryFS, Vector3, Vector4 } from '@zephyr3d/base';
import { Camera, DualDepthPeelingOIT, ResourceManager, Scene, SSSMaterial } from '../../../libs/scene/src';

describe('Skin material serialization', () => {
  test('round-trips SSSMaterial properties', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SSSMaterial();

    material.roughness = 0.4;
    material.specularF0 = 0.03;
    material.transmissionStrength = 0.8;
    material.albedoColor = new Vector4(0.8, 0.55, 0.48, 1);
    material.cullMode = 'none';
    material.vertexTangent = true;
    material.doubleSidedLighting = false;

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SSSMaterial>(null, serialized))!;

    expect(serialized.ClassName).toBe('SSSMaterial');
    const obj = serialized.Object as Record<string, any>;
    expect(obj).toMatchObject({
      Roughness: 0.4,
      SpecularF0: 0.03,
      TransmissionStrength: 0.8,
      vertexTangent: true,
      doubleSidedLighting: false
    });
    expect(restored).toBeInstanceOf(SSSMaterial);
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
    const material = new SSSMaterial();
    const profile = material.subsurfaceProfile;
    profile.preset = 'skin';
    profile.scatteringDistribution = -0.4;
    profile.ior = 1.32;
    profile.extinctionScale = 2.5;
    profile.transmissionTint = new Vector3(0.9, 0.3, 0.22);

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SSSMaterial>(null, serialized))!;

    expect(restored.subsurfaceProfile.scatteringDistribution).toBeCloseTo(-0.4);
    expect(restored.subsurfaceProfile.ior).toBeCloseTo(1.32);
    expect(restored.subsurfaceProfile.extinctionScale).toBeCloseTo(2.5);
    expect(restored.subsurfaceProfile.transmissionTint.y).toBeCloseTo(0.3);
    material.dispose();
    restored.dispose();
  });

  test('round-trips the material subsurface profile', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SSSMaterial();
    const profile = material.subsurfaceProfile;
    profile.preset = 'skin_dark';
    profile.meanFreePathDistance = 0.017;
    profile.surfaceAlbedo = new Vector3(0.71, 0.46, 0.37);
    profile.lobeMix = 0.22;

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SSSMaterial>(null, serialized))!;

    expect(restored.subsurfaceProfile.preset).toBe('skin_dark');
    expect(restored.subsurfaceProfile.meanFreePathDistance).toBeCloseTo(0.017);
    expect(restored.subsurfaceProfile.surfaceAlbedo.x).toBeCloseTo(0.71);
    expect(restored.subsurfaceProfile.lobeMix).toBeCloseTo(0.22);
    // The restored material keeps the profile it built in its constructor; the
    // values are written into it rather than a fresh instance replacing it.
    // Deserializing used to construct one per load, and since nothing released
    // them the 256-row table filled up over an editing session.
    expect(restored.subsurfaceProfile.id).not.toBe(profile.id);
    material.dispose();
    restored.dispose();
  });

  test('deserializing writes into the material own profile instance', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SSSMaterial();
    material.subsurfaceProfile.preset = 'jade';
    material.subsurfaceProfile.meanFreePathDistance = 0.031;

    const serialized = await manager.serializeObject(material);
    const target = new SSSMaterial();
    const targetProfile = target.subsurfaceProfile;
    const targetId = targetProfile.id;
    await manager.deserializeObjectProps(target, (serialized as any).Object);

    // Same object, same table row, new values - which is what keeps the id the
    // depth prepass writes in agreement with the row the diffusion reads.
    expect(target.subsurfaceProfile).toBe(targetProfile);
    expect(target.subsurfaceProfile.id).toBe(targetId);
    expect(target.subsurfaceProfile.preset).toBe('jade');
    expect(target.subsurfaceProfile.meanFreePathDistance).toBeCloseTo(0.031);
    material.dispose();
    target.dispose();
  });

  test('a material with no saved profile keeps its own defaults', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new SSSMaterial();

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<SSSMaterial>(null, serialized))!;

    // Profiles are no longer nullable, so a scene saved before they became
    // owned - where this field is absent or null - restores to the material's
    // own default rather than to nothing.
    expect(restored.subsurfaceProfile).toBeTruthy();
    expect(restored.subsurfaceProfile.preset).toBe('skin');
    material.dispose();
    restored.dispose();
  });

  test('round-trips the camera PostSSS debug selection', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.postSSSDebugOutput = 'sampleRadius';

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    // Whether the diffusion runs is derived from the render queue, so there is
    // no enable flag to save - only the debug selection.
    expect(serialized.Object).toMatchObject({ PostSSSDebugOutput: 'sampleRadius' });
    expect(serialized.Object).not.toHaveProperty('PostSSSEnabled');
    // The selection is held on the camera, not only forwarded to the post
    // effect, so it survives a round trip even though the effect is created lazily.
    expect(restored.postSSSDebugOutput).toBe('sampleRadius');
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
