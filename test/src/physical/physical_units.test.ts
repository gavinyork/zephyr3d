import { MemoryFS, Vector4 } from '@zephyr3d/base';
import {
  DirectionalLight,
  PerspectiveCamera,
  PointLight,
  RectLight,
  ResourceManager,
  Scene,
  SkyRenderer,
  SpotLight,
  Tonemap,
  calculateEV100,
  calculatePhysicalExposure,
  calculateVerticalFov
} from '../../../libs/scene/src';

describe('Physical lighting and camera units', () => {
  test('keeps ACES input calibration independent of exposure mode', () => {
    expect(Tonemap.ACES_INPUT_SCALE).toBeCloseTo(1 / 0.6, 12);
  });

  test('normalizes physical daylight for the atmospheric scattering model', () => {
    const sunny16Exposure = calculatePhysicalExposure(16, 1 / 125, 100);
    const normalizedSunInput = 100000 * sunny16Exposure * SkyRenderer.PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE;
    expect(normalizedSunInput).toBeCloseTo(10, 12);
  });

  test('calculates photographic EV100 and exposure compensation', () => {
    const ev100 = calculateEV100(16, 1 / 125, 100);
    expect(ev100).toBeCloseTo(Math.log2(32000), 10);

    const exposure = calculatePhysicalExposure(16, 1 / 125, 100);
    expect(exposure).toBeCloseTo(1 / (1.2 * Math.pow(2, ev100)), 12);
    expect(calculatePhysicalExposure(16, 1 / 125, 100, 1)).toBeCloseTo(exposure * 2, 12);
  });

  test('derives vertical field of view from focal length and sensor fit', () => {
    const verticalFit = calculateVerticalFov(50, 36, 24, 1.5, 'vertical');
    const horizontalFit = calculateVerticalFov(50, 36, 24, 1.5, 'horizontal');
    const expected = 2 * Math.atan(24 / (2 * 50));

    expect(verticalFit).toBeCloseTo(expected, 12);
    expect(horizontalFit).toBeCloseTo(expected, 12);

    const camera = new PerspectiveCamera(null, Math.PI / 3, 0.1, 1000, 1.5);
    expect(camera.projectionMode).toBe('fov');
    expect(camera.effectiveFovY).toBeCloseTo(Math.PI / 3, 12);
    camera.projectionMode = 'physical';
    camera.focalLengthMm = 50;
    camera.sensorWidthMm = 36;
    camera.sensorHeightMm = 24;
    camera.sensorFit = 'horizontal';
    expect(camera.effectiveFovY).toBeCloseTo(expected, 12);
  });

  test('keeps inverse-square photometry invariant when scene units change', () => {
    const scene = new Scene();
    const light = new PointLight(scene);
    scene.lightingMode = 'physical';
    light.luminousIntensity = 100;

    scene.metersPerUnit = 1;
    const intensityAtMeters = light.diffuseAndIntensity.w;
    const illuminanceAtTwoMeters = intensityAtMeters / (2 * 2);
    expect(intensityAtMeters).toBeCloseTo(100, 10);
    expect(illuminanceAtTwoMeters).toBeCloseTo(25, 10);

    scene.metersPerUnit = 0.01;
    const intensityAtCentimeters = light.diffuseAndIntensity.w;
    const twoMetersInSceneUnits = 2 / scene.metersPerUnit;
    const rescaledIlluminance = intensityAtCentimeters / (twoMetersInSceneUnits * twoMetersInSceneUnits);
    expect(intensityAtCentimeters).toBeCloseTo(1000000, 6);
    expect(rescaledIlluminance).toBeCloseTo(25, 10);
  });

  test('normalizes physical light color by Rec.709 luminance without changing legacy output', () => {
    const scene = new Scene();
    const light = new PointLight(scene);
    light.color = new Vector4(1, 0, 0, 1);
    light.intensity = 3;

    expect(scene.lightingMode).toBe('legacy');
    expect(scene.metersPerUnit).toBe(1);
    expect(light.diffuseAndIntensity.x).toBe(1);
    expect(light.diffuseAndIntensity.w).toBe(3);

    scene.lightingMode = 'physical';
    light.luminousIntensity = 100;
    const physicalColor = light.diffuseAndIntensity;
    const luminance = physicalColor.x * 0.2126 + physicalColor.y * 0.7152 + physicalColor.z * 0.0722;
    expect(luminance).toBeCloseTo(1, 6);
    expect(physicalColor.w).toBeCloseTo(100, 10);
  });

  test('loads scene data without physical fields in legacy mode', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    scene.lightingMode = 'physical';
    scene.metersPerUnit = 0.01;
    const serialized = await manager.serializeObject(scene);
    delete serialized.Object.LightingMode;
    delete serialized.Object.MetersPerUnit;

    const restored = (await manager.deserializeObject<Scene>(null, serialized))!;
    expect(restored.lightingMode).toBe('legacy');
    expect(restored.metersPerUnit).toBe(1);
  });

  test('round-trips physical scene, light and camera properties', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const scene = new Scene();
    scene.lightingMode = 'physical';
    scene.metersPerUnit = 0.01;
    scene.env.light.radianceScale = 2.5;

    const serializedScene = await manager.serializeObject(scene);
    const restoredScene = (await manager.deserializeObject<Scene>(null, serializedScene))!;
    expect(serializedScene.Object).toMatchObject({
      LightingMode: 'physical',
      MetersPerUnit: 0.01,
      EnvLightRadianceScale: 2.5
    });
    expect(restoredScene.lightingMode).toBe('physical');
    expect(restoredScene.metersPerUnit).toBeCloseTo(0.01);
    expect(restoredScene.env.light.radianceScale).toBeCloseTo(2.5);

    const camera = new PerspectiveCamera(scene);
    camera.exposureMode = 'manual';
    camera.aperture = 8;
    camera.shutterSpeed = 1 / 250;
    camera.ISO = 200;
    camera.exposureCompensation = 1;
    camera.toneMapExposure = 2;
    camera.projectionMode = 'physical';
    camera.focalLengthMm = 85;
    camera.sensorWidthMm = 36;
    camera.sensorHeightMm = 24;
    camera.sensorFit = 'vertical';

    const serializedCamera = await manager.serializeObject(camera);
    const restoredCamera = (await manager.deserializeObject<PerspectiveCamera>(
      scene.rootNode,
      serializedCamera
    ))!;
    expect(serializedCamera.Object).toMatchObject({
      Aperture: 8,
      ShutterSpeed: 1 / 250,
      ISO: 200,
      ExposureCompensation: 1,
      ToneMapExposure: 2,
      ProjectionMode: 'physical',
      FocalLength: 85,
      SensorFit: 'vertical'
    });
    expect(restoredCamera.aperture).toBeCloseTo(8);
    expect(restoredCamera.exposureMode).toBe('manual');
    expect(restoredCamera.shutterSpeed).toBeCloseTo(1 / 250);
    expect(restoredCamera.ISO).toBeCloseTo(200);
    expect(restoredCamera.exposureCompensation).toBeCloseTo(1);
    expect(restoredCamera.projectionMode).toBe('physical');
    expect(restoredCamera.focalLengthMm).toBeCloseTo(85);
    expect(restoredCamera.sensorFit).toBe('vertical');

    const directional = new DirectionalLight(scene);
    directional.illuminance = 120000;
    const point = new PointLight(scene);
    point.intensity = 7;
    point.luminousIntensity = 250;
    const spot = new SpotLight(scene);
    spot.luminousIntensity = 500;
    spot.outerConeAngle = Math.PI / 6;
    spot.innerConeAngle = Math.PI / 12;
    const rect = new RectLight(scene);
    rect.luminance = 750;

    const serializedDirectional = await manager.serializeObject(directional);
    const serializedPoint = await manager.serializeObject(point);
    const serializedSpot = await manager.serializeObject(spot);
    const serializedRect = await manager.serializeObject(rect);
    expect(serializedDirectional.Object).toMatchObject({ Illuminance: 120000 });
    expect(serializedPoint.Object).toMatchObject({ Intensity: 7, LuminousIntensity: 250 });
    expect(serializedSpot.Object).toMatchObject({ LuminousIntensity: 500 });
    expect(serializedSpot.Object.PhysicalInnerConeAngle).toBeCloseTo(15);
    expect(serializedSpot.Object.PhysicalOuterConeAngle).toBeCloseTo(30);
    expect(serializedRect.Object).toMatchObject({ Luminance: 750 });
  });
});
