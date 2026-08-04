import { MemoryFS } from '@zephyr3d/base';
import { Camera, ResourceManager, Scene } from '../../../libs/scene/src';

describe('SSGI configuration and serialization', () => {
  test('uses the documented high-quality defaults and resolves presets', () => {
    const scene = new Scene();
    const camera = new Camera(scene);

    expect(camera.SSGI).toBe(false);
    expect(camera.ssgiQualityPreset).toBe('quality');
    expect(camera.ssgiResolvedSettings).toEqual({
      halfRes: false,
      raysPerPixel: 2,
      maxSteps: 64,
      denoisePasses: 4
    });
    expect(camera.ssgiIntensity).toBeCloseTo(0.7);
    // Below 1 on purpose: SSGI irradiance already has sky occlusion subtracted,
    // so the AO multiply lands on a partly occluded diffuse term.
    expect(camera.ssgiAOIntensity).toBeCloseTo(0.8);
    expect(camera.ssgiAOPower).toBeCloseTo(1);
    // Occluding hits remove the sky in full by default; 0 reproduces the
    // pre-occlusion behaviour where only readable hits contributed.
    expect(camera.ssgiSkyOcclusion).toBeCloseTo(1);
    expect(camera.ssgiMaxDistance).toBeCloseTo(32);
    expect(camera.ssgiThickness).toBeCloseTo(0.5);
    expect(camera.ssgiStride).toBe(1);
    expect(camera.ssgiMaxRayIntensity).toBeCloseTo(10);
    expect(camera.ssgiTemporal).toBe(true);
    expect(camera.ssgiTemporalWeight).toBeCloseTo(0.94);
    expect(camera.ssgiDepthReject).toBeCloseTo(0.5);
    expect(camera.ssgiNormalReject).toBeCloseTo(0.75);
    expect(camera.ssgiHalfResolution).toBe(false);
    expect(camera.ssgiRaysPerPixel).toBe(2);
    expect(camera.ssgiMaxSteps).toBe(64);
    expect(camera.ssgiDenoisePasses).toBe(4);

    // Lighting is pre-exposed on the CPU, so the firefly clamp is mode-independent.
    scene.lightingMode = 'physical';
    expect(camera.ssgiMaxRayIntensity).toBeCloseTo(10);

    camera.ssgiQualityPreset = 'balanced';
    expect(camera.ssgiResolvedSettings).toEqual({
      halfRes: true,
      raysPerPixel: 1,
      maxSteps: 48,
      denoisePasses: 4
    });
    camera.ssgiQualityPreset = 'performance';
    expect(camera.ssgiResolvedSettings).toEqual({
      halfRes: true,
      raysPerPixel: 1,
      maxSteps: 24,
      denoisePasses: 4
    });
  });

  test('switches to custom when an individual quality setting changes', () => {
    const scene = new Scene();
    const camera = new Camera(scene);
    camera.ssgiQualityPreset = 'balanced';

    camera.ssgiRaysPerPixel = 2;
    camera.ssgiMaxSteps = 56;
    camera.ssgiDenoisePasses = 4;

    expect(camera.ssgiQualityPreset).toBe('custom');
    expect(camera.ssgiResolvedSettings).toEqual({
      halfRes: true,
      raysPerPixel: 2,
      maxSteps: 56,
      denoisePasses: 4
    });

    camera.ssgiQualityPreset = 'quality';
    expect(camera.ssgiResolvedSettings).toEqual({
      halfRes: false,
      raysPerPixel: 2,
      maxSteps: 64,
      denoisePasses: 4
    });
  });

  test('clamps sky occlusion to a normalized fraction', () => {
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.ssgiSkyOcclusion = 0.4;
    expect(camera.ssgiSkyOcclusion).toBeCloseTo(0.4);
    camera.ssgiSkyOcclusion = 2;
    expect(camera.ssgiSkyOcclusion).toBeCloseTo(1);
    camera.ssgiSkyOcclusion = -1;
    expect(camera.ssgiSkyOcclusion).toBe(0);
  });

  test('clamps the ambient occlusion controls', () => {
    const scene = new Scene();
    const camera = new Camera(scene);

    camera.ssgiAOIntensity = 0.5;
    expect(camera.ssgiAOIntensity).toBeCloseTo(0.5);
    camera.ssgiAOIntensity = 3;
    expect(camera.ssgiAOIntensity).toBeCloseTo(1);
    // 0 is a supported value, not a clamped floor: it takes the composite out of
    // the frame entirely and restores the plain pass-through.
    camera.ssgiAOIntensity = -1;
    expect(camera.ssgiAOIntensity).toBe(0);

    camera.ssgiAOPower = 2.5;
    expect(camera.ssgiAOPower).toBeCloseTo(2.5);
    // A zero exponent would flatten AO to a constant 1, so the setter keeps it
    // strictly positive.
    camera.ssgiAOPower = 0;
    expect(camera.ssgiAOPower).toBeCloseTo(0.01);
  });

  test('round-trips every camera SSGI editor property', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);
    camera.SSGI = true;
    camera.ssgiQualityPreset = 'balanced';
    camera.ssgiIntensity = 1.15;
    camera.ssgiAOIntensity = 0.45;
    camera.ssgiAOPower = 1.6;
    camera.ssgiSkyOcclusion = 0.65;
    camera.ssgiMaxDistance = 48;
    camera.ssgiThickness = 0.35;
    camera.ssgiStride = 2;
    camera.ssgiMaxRayIntensity = 7;
    camera.ssgiTemporal = true;
    camera.ssgiTemporalWeight = 0.91;
    camera.ssgiDepthReject = 0.3;
    camera.ssgiNormalReject = 0.82;

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(serialized.Object).toMatchObject({
      SSGIEnabled: true,
      SSGIQualityPreset: 'balanced',
      SSGIIntensity: 1.15,
      SSGIAOIntensity: 0.45,
      SSGIAOPower: 1.6,
      SSGISkyOcclusion: 0.65,
      SSGIMaxDistance: 48,
      SSGIThickness: 0.35,
      SSGIStride: 2,
      SSGIMaxRayIntensity: 7,
      SSGITemporalWeight: 0.91,
      SSGIDepthReject: 0.3,
      SSGINormalReject: 0.82
    });
    expect(restored.SSGI).toBe(true);
    expect(restored.ssgiQualityPreset).toBe('balanced');
    expect(restored.ssgiIntensity).toBeCloseTo(1.15);
    expect(restored.ssgiAOIntensity).toBeCloseTo(0.45);
    expect(restored.ssgiAOPower).toBeCloseTo(1.6);
    expect(restored.ssgiSkyOcclusion).toBeCloseTo(0.65);
    expect(restored.ssgiMaxDistance).toBeCloseTo(48);
    expect(restored.ssgiThickness).toBeCloseTo(0.35);
    expect(restored.ssgiStride).toBe(2);
    expect(restored.ssgiMaxRayIntensity).toBeCloseTo(7);
    expect(restored.ssgiTemporal).toBe(true);
    expect(restored.ssgiTemporalWeight).toBeCloseTo(0.91);
    expect(restored.ssgiDepthReject).toBeCloseTo(0.3);
    expect(restored.ssgiNormalReject).toBeCloseTo(0.82);
  });

  test('persists disabling temporal accumulation', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);
    camera.SSGI = true;
    camera.ssgiTemporal = false;

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(serialized.Object).toMatchObject({
      SSGIEnabled: true,
      SSGITemporalEnabled: false
    });
    expect(restored.ssgiTemporal).toBe(false);
  });

  test('round-trips custom trace and denoise settings', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    const camera = new Camera(scene);
    camera.SSGI = true;
    camera.ssgiQualityPreset = 'custom';
    camera.ssgiHalfResolution = true;
    camera.ssgiRaysPerPixel = 1;
    camera.ssgiMaxSteps = 72;
    camera.ssgiDenoisePasses = 2;

    const serialized = await manager.serializeObject(camera);
    const restored = (await manager.deserializeObject<Camera>(scene.rootNode, serialized))!;

    expect(serialized.Object).toMatchObject({
      SSGIQualityPreset: 'custom',
      SSGIHalfResolution: true,
      SSGIRaysPerPixel: 1,
      SSGIMaxSteps: 72,
      SSGIDenoisePasses: 2
    });
    expect(restored.ssgiQualityPreset).toBe('custom');
    expect(restored.ssgiResolvedSettings).toEqual({
      halfRes: true,
      raysPerPixel: 1,
      maxSteps: 72,
      denoisePasses: 2
    });
  });
});
