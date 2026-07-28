import { MemoryFS, Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../../../libs/scene/src';
import {
  DirectionalLight,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  PointLight,
  RectLight,
  ResourceManager,
  Scene,
  ShaderHelper,
  SkyRenderer,
  SpotLight,
  Tonemap,
  calculateEV100,
  calculatePhysicalExposure,
  calculateVerticalFov
} from '../../../libs/scene/src';

describe('Physical lighting and camera units', () => {
  test('matches the ACESLegacy input calibration in both lighting modes', () => {
    // Filament's ACESLegacy tone mapper pre-scales its input by 1/0.6 before the RRT+ODT fit.
    // This is a property of the curve, not of the exposure, so it applies unconditionally.
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

  test('keeps light color and intensity strictly separate in both lighting modes', () => {
    const scene = new Scene();
    const light = new PointLight(scene);
    light.color = new Vector4(1, 0, 0, 1);
    light.intensity = 3;

    expect(scene.lightingMode).toBe('legacy');
    expect(scene.metersPerUnit).toBe(1);
    expect(light.diffuseAndIntensity.x).toBe(1);
    expect(light.diffuseAndIntensity.w).toBe(3);

    // Physical stores the authored color verbatim, like Filament. Normalizing a saturated primary
    // by its Rec.709 luminance would inflate the channel by ~4.7x here (1 / 0.2126) and up to
    // ~13.8x for pure blue, overflowing the half-float lighting target.
    scene.lightingMode = 'physical';
    light.luminousIntensity = 100;
    const physicalColor = light.diffuseAndIntensity;
    expect(physicalColor.x).toBe(1);
    expect(physicalColor.y).toBe(0);
    expect(physicalColor.z).toBe(0);
    expect(physicalColor.w).toBeCloseTo(100, 10);
  });

  test('preserves sun transmittance dimming in physical mode', () => {
    // SkyRenderer.update() folds atmospheric transmittance into the sun's color. Normalizing that
    // color by its luminance would cancel the magnitude and leave only the hue shift, so a sunset
    // would stay at full brightness. Keeping the color verbatim preserves the dimming.
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const sun = new DirectionalLight(scene);
    sun.illuminance = 100000;

    sun.color = new Vector4(1, 1, 1, 1);
    const noon = sun.diffuseAndIntensity;
    const noonLuminance = noon.x * 0.2126 + noon.y * 0.7152 + noon.z * 0.0722;

    // A low sun: heavy attenuation, reddened.
    sun.color = new Vector4(0.6, 0.3, 0.1, 1);
    const sunset = sun.diffuseAndIntensity;
    const sunsetLuminance = sunset.x * 0.2126 + sunset.y * 0.7152 + sunset.z * 0.0722;

    expect(sunsetLuminance).toBeLessThan(noonLuminance);
    // The photometric intensity is untouched; only the color carries the transmittance.
    expect(sunset.w).toBeCloseTo(noon.w, 6);
  });

  test('converts luminous power to intensity with Filament point and spot formulas', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';

    // Point: I = phi / (4 pi)
    const point = new PointLight(scene);
    point.luminousPower = 4 * Math.PI * 25;
    expect(point.luminousIntensity).toBeCloseTo(25, 10);
    expect(point.luminousPower).toBeCloseTo(4 * Math.PI * 25, 10);

    // Focused spot: I = phi / (2 pi (1 - cos(outer)))
    const spot = new SpotLight(scene);
    spot.outerConeAngle = Math.PI / 6;
    const cone = 2 * Math.PI * (1 - Math.cos(Math.PI / 6));
    spot.luminousPower = cone * 500;
    expect(spot.luminousIntensity).toBeCloseTo(500, 10);
    expect(spot.luminousPower).toBeCloseTo(cone * 500, 10);
  });

  test('packs the spot cone attenuation as Filament scale/offset and survives inner == outer', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const spot = new SpotLight(scene);
    spot.outerConeAngle = Math.PI / 4;
    spot.innerConeAngle = Math.PI / 8;

    const cosOuter = Math.cos(Math.PI / 4);
    const cosInner = Math.cos(Math.PI / 8);
    const expectedScale = 1 / (cosInner - cosOuter);
    expect(spot.extraParams.x).toBeCloseTo(expectedScale, 4);
    expect(spot.extraParams.y).toBeCloseTo(-cosOuter * expectedScale, 4);
    // saturate(cd * scale + offset) must reach 1 at the inner cone and 0 at the outer cone.
    expect(cosInner * spot.extraParams.x + spot.extraParams.y).toBeCloseTo(1, 4);
    expect(cosOuter * spot.extraParams.x + spot.extraParams.y).toBeCloseTo(0, 4);

    // A degenerate cone must stay finite: Filament floors the denominator at 1/1024.
    spot.innerConeAngle = spot.outerConeAngle;
    expect(Number.isFinite(spot.extraParams.x)).toBe(true);
    expect(spot.extraParams.x).toBeCloseTo(1024, 0);
  });

  test('clamps spot cone half-angles to Filament limits', () => {
    const scene = new Scene();
    const spot = new SpotLight(scene);
    spot.outerConeAngle = 0;
    expect(spot.outerConeAngle).toBeCloseTo((0.5 * Math.PI) / 180, 10);
    spot.outerConeAngle = Math.PI;
    expect(spot.outerConeAngle).toBeCloseTo(Math.PI * 0.5, 10);
    spot.innerConeAngle = Math.PI;
    expect(spot.innerConeAngle).toBeCloseTo(spot.outerConeAngle, 10);
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
    scene.env.light.intensity = 25000;

    const serializedScene = await manager.serializeObject(scene);
    const restoredScene = (await manager.deserializeObject<Scene>(null, serializedScene))!;
    expect(serializedScene.Object).toMatchObject({
      LightingMode: 'physical',
      MetersPerUnit: 0.01,
      EnvLightIntensity: 25000
    });
    expect(restoredScene.lightingMode).toBe('physical');
    expect(restoredScene.metersPerUnit).toBeCloseTo(0.01);
    expect(restoredScene.env.light.intensity).toBeCloseTo(25000);

    const camera = new PerspectiveCamera(scene);
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

  test('relates rect light luminance and luminous flux by the Lambertian area law', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const rect = new RectLight(scene);
    rect.width = 2;
    rect.height = 0.5;
    rect.luminance = 750;

    // phi = L * pi * area, one-sided Lambertian.
    expect(rect.luminousFlux).toBeCloseTo(750 * Math.PI * 1, 6);
    rect.luminousFlux = 1000 * Math.PI;
    expect(rect.luminance).toBeCloseTo(1000, 6);

    // Scene units must not change the photometric relation.
    scene.metersPerUnit = 0.01;
    const area = 2 * 0.5 * 0.01 * 0.01;
    expect(rect.luminousFlux).toBeCloseTo(rect.luminance * Math.PI * area, 6);
  });

  test('exposes emissive as a photometric luminance with an exposure weight', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new PBRMetallicRoughnessMaterial();

    // Default follows exposure, matching Filament's emissive.w default.
    expect(material.emissiveExposureWeight).toBe(1);
    // Physical emissive is a cd/m² luminance, so the strength must not be capped at 1.
    material.emissiveStrength = 5000;
    expect(material.emissiveStrength).toBeCloseTo(5000, 6);
    material.emissiveExposureWeight = 0;
    expect(material.emissiveExposureWeight).toBe(0);
    material.emissiveExposureWeight = 5;
    expect(material.emissiveExposureWeight).toBe(1);
    material.emissiveExposureWeight = -1;
    expect(material.emissiveExposureWeight).toBe(0);

    material.emissiveExposureWeight = 0.25;
    const serialized = await manager.serializeObject(material);
    expect(serialized.Object).toMatchObject({
      EmissiveStrength: 5000,
      EmissiveExposureWeight: 0.25
    });
    const restored = (await manager.deserializeObject<PBRMetallicRoughnessMaterial>(null, serialized))!;
    expect(restored.emissiveStrength).toBeCloseTo(5000, 6);
    expect(restored.emissiveExposureWeight).toBeCloseTo(0.25, 6);
  });

  test('anchors the atmosphere normalization to the physical daylight reference', () => {
    // PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE maps the photometric daylight reference (100,000 lux at
    // Sunny 16) onto the atmosphere model's authored sun input of 10. The LUTs are baked
    // exposure-independently, so at the reference exposure the sky lands on the legacy value.
    const referenceExposure = calculatePhysicalExposure(16, 1 / 125, 100);
    expect(100000 * SkyRenderer.PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE * referenceExposure).toBeCloseTo(10, 6);
    // The retired fog anchor stays documented as the reciprocal of that reference exposure; fog now
    // derives its luminance from EnvLightWrapper.intensity instead.
    expect(SkyRenderer.FOG_PHYSICAL_LUMINANCE).toBeCloseTo(1 / referenceExposure, 6);
  });

  test('pre-exposes light intensity without touching the color, and leaves legacy unscaled', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const camera = new PerspectiveCamera(scene);
    camera.aperture = 16;
    camera.shutterSpeed = 1 / 125;
    camera.ISO = 100;
    const light = new DirectionalLight(scene);
    light.color = new Vector4(1, 0.5, 0.25, 1);
    light.illuminance = 100000;

    const ctx = { scene, camera } as unknown as DrawContext;
    const preExposed = ShaderHelper.getPreExposedColorIntensity(light, ctx);
    // Color is passed through verbatim (Filament's FScene::prepareDynamicLights).
    expect(preExposed.x).toBeCloseTo(light.diffuseAndIntensity.x, 10);
    expect(preExposed.y).toBeCloseTo(light.diffuseAndIntensity.y, 10);
    expect(preExposed.z).toBeCloseTo(light.diffuseAndIntensity.z, 10);
    // Only the intensity carries exposure, landing the HDR buffer near 1.0.
    expect(preExposed.w).toBeCloseTo(light.diffuseAndIntensity.w * camera.exposure, 6);
    expect(preExposed.w).toBeCloseTo(100000 / 38400, 6);
    // The light's own cached vector must stay authored (it is shared across cameras).
    expect(light.diffuseAndIntensity.w).toBeCloseTo(100000, 6);

    scene.lightingMode = 'legacy';
    expect(ShaderHelper.getPreExposure(ctx)).toBe(1);
    expect(ShaderHelper.getPreExposedColorIntensity(light, ctx).w).toBeCloseTo(
      light.diffuseAndIntensity.w,
      10
    );
  });
});
