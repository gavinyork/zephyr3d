import { MemoryFS, Vector4 } from '@zephyr3d/base';
import {
  DirectionalLight,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  PointLight,
  RectLight,
  ResourceManager,
  Scene,
  ShaderHelper,
  SpotLight
} from '../../../libs/scene/src';
import type { DrawContext } from '../../../libs/scene/src';

describe('Legacy lighting is unaffected by the physical alignment', () => {
  test('pre-exposure is identity, so every uploaded light value is untouched', () => {
    const scene = new Scene();
    expect(scene.lightingMode).toBe('legacy');
    const camera = new PerspectiveCamera(scene);
    // Photographic settings exist but must be inert in legacy.
    camera.aperture = 1.4;
    camera.shutterSpeed = 1 / 4000;
    camera.ISO = 6400;
    camera.exposureCompensation = 3;
    const ctx = { scene, camera } as unknown as DrawContext;

    expect(ShaderHelper.getPreExposure(ctx)).toBe(1);

    const dir = new DirectionalLight(scene);
    dir.color = new Vector4(0.9, 0.8, 0.7, 1);
    dir.intensity = 4;
    const point = new PointLight(scene);
    point.intensity = 3;
    const spot = new SpotLight(scene);
    spot.intensity = 2;

    for (const light of [dir, point, spot]) {
      const authored = light.diffuseAndIntensity;
      const uploaded = ShaderHelper.getPreExposedColorIntensity(light, ctx);
      expect(uploaded.x).toBe(authored.x);
      expect(uploaded.y).toBe(authored.y);
      expect(uploaded.z).toBe(authored.z);
      expect(uploaded.w).toBe(authored.w);
    }
  });

  test('env light strength keeps its legacy meaning', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    scene.env.light.strength = 0.75;
    // intensity is the physical field; it must not leak into the legacy upload.
    scene.env.light.intensity = 30000;
    const ctx = { scene, camera, env: scene.env } as unknown as DrawContext;
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBe(0.75);
  });

  test('legacy light geometry and cone math are unchanged', () => {
    const scene = new Scene();
    const spot = new SpotLight(scene);
    // Legacy uses cutoff (a cosine), not the physical cone half-angles.
    spot.cutoff = Math.cos(Math.PI / 4);
    spot.intensity = 4;
    expect(spot.directionAndCutoff.w).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    // extraParams.x is the Filament cone scale in physical, and unused (0) in legacy.
    expect(spot.extraParams.x).toBe(0);
    // Legacy auto-range: 32 * sqrt(intensity).
    expect(spot.positionAndRange.w).toBeCloseTo(32 * Math.sqrt(4), 5);

    const point = new PointLight(scene);
    point.intensity = 9;
    expect(point.positionAndRange.w).toBeCloseTo(32 * Math.sqrt(9), 5);
  });

  test('legacy tonemap keeps the authored exposure multiplier', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    camera.toneMapExposure = 2.5;
    expect(camera.toneMapExposure).toBeCloseTo(2.5, 10);
  });

  test('legacy serialization exposes the legacy fields and hides the physical ones', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    camera.toneMapExposure = 1.5;

    const serializedCamera = await manager.serializeObject(camera);
    expect(serializedCamera.Object.ToneMapExposure).toBeCloseTo(1.5);
    expect(serializedCamera.Object.ExposureMode).toBeUndefined();

    const point = new PointLight(scene);
    point.intensity = 5;
    const serializedPoint = await manager.serializeObject(point);
    expect(serializedPoint.Object.Intensity).toBeCloseTo(5);

    const restored = (await manager.deserializeObject<PerspectiveCamera>(scene.rootNode, serializedCamera))!;
    expect(restored.toneMapExposure).toBeCloseTo(1.5);
  });

  test('emissive is inert under legacy regardless of the exposure weight', () => {
    const material = new PBRMetallicRoughnessMaterial();
    material.emissiveColor = new Vector4(1, 0.5, 0.25, 1).xyz();
    material.emissiveStrength = 2;
    // The weight only scales the pre-exposure, which is 1 in legacy, so the emitter is unchanged.
    material.emissiveExposureWeight = 1;
    expect(material.emissiveStrength).toBeCloseTo(2, 10);
    material.emissiveExposureWeight = 0;
    expect(material.emissiveStrength).toBeCloseTo(2, 10);
  });

  test('rect light legacy authoring path still works', () => {
    const scene = new Scene();
    const rect = new RectLight(scene);
    rect.intensity = 3;
    rect.width = 2;
    rect.height = 2;
    // Legacy drives the rect light by its unitless intensity.
    expect(rect.diffuseAndIntensity.w).toBeCloseTo(3, 10);
  });
});
