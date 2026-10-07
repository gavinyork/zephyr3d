import { Vector4 } from '@zephyr3d/base';
import {
  DirectionalLight,
  PHYSICAL_BAKE_EXPOSURE,
  PerspectiveCamera,
  Scene,
  ShaderHelper,
  SkyRenderer,
  Tonemap,
  calculatePhysicalExposure
} from '../../../libs/scene/src';
import type { DrawContext } from '../../../libs/scene/src';

/** ACES RRT+ODT fit, matching the Tonemap shader. */
function rrtAndOdtFit(v: number) {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / b;
}

/**
 * Reproduces the scalar tonemap chain for a neutral gray value. The ACES input/output matrices are
 * row-normalized, so a neutral value passes through them unchanged and the luminance can be
 * followed with the scalar fit alone.
 */
function tonemapNeutral(preExposedLuminance: number) {
  return rrtAndOdtFit(preExposedLuminance * Tonemap.ACES_INPUT_SCALE);
}

describe('Physical lighting calibration', () => {
  function makeCtx(scene: Scene, camera: PerspectiveCamera) {
    return { scene, camera, env: scene.env } as unknown as DrawContext;
  }

  test('renders an 18% gray card at Sunny 16 near middle gray, far below the half-float ceiling', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const camera = new PerspectiveCamera(scene);
    camera.aperture = 16;
    camera.shutterSpeed = 1 / 125;
    camera.ISO = 100;
    const ctx = makeCtx(scene, camera);

    const sun = new DirectionalLight(scene);
    sun.illuminance = 100000;
    sun.color = new Vector4(1, 1, 1, 1);

    // A Lambertian 18% gray card facing the sun: L = E * rho / pi.
    const albedo = 0.18;
    const illuminance = sun.diffuseAndIntensity.w;
    const luminance = (illuminance * albedo) / Math.PI;

    // The renderer pre-exposes on the CPU, so this is the value the HDR target receives.
    const preExposed = luminance * ShaderHelper.getPreExposure(ctx);

    // Well inside the half-float range, with headroom for specular highlights -- the whole point of
    // pre-exposing rather than storing raw cd/m².
    expect(preExposed).toBeLessThan(2);

    // ACES maps it into display range as a recognizable middle gray.
    const display = tonemapNeutral(preExposed);
    expect(display).toBeGreaterThan(0.1);
    expect(display).toBeLessThan(0.45);

    // A sunlit white surface is ~31,800 cd/m² before pre-exposure, one stop under the half-float
    // limit of 65,504; a specular highlight would overflow to Inf and spread black artifacts through
    // bloom. Pre-exposed, a 100x specular peak still fits comfortably.
    const whiteLuminance = illuminance / Math.PI;
    expect(whiteLuminance).toBeGreaterThan(30000);
    expect(whiteLuminance * ShaderHelper.getPreExposure(ctx) * 100).toBeLessThan(65504);
  });

  test('exposure behaves photographically: one stop halves the pre-exposed value', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const camera = new PerspectiveCamera(scene);
    camera.aperture = 16;
    camera.shutterSpeed = 1 / 125;
    camera.ISO = 100;
    const ctx = makeCtx(scene, camera);
    const base = ShaderHelper.getPreExposure(ctx);

    // Each of these is exactly one stop more light.
    camera.aperture = 16 / Math.SQRT2;
    expect(ShaderHelper.getPreExposure(ctx)).toBeCloseTo(base * 2, 6);

    camera.aperture = 16;
    camera.shutterSpeed = 1 / 62.5;
    expect(ShaderHelper.getPreExposure(ctx)).toBeCloseTo(base * 2, 6);

    camera.shutterSpeed = 1 / 125;
    camera.ISO = 200;
    expect(ShaderHelper.getPreExposure(ctx)).toBeCloseTo(base * 2, 6);

    camera.ISO = 100;
    camera.exposureCompensation = 1;
    expect(ShaderHelper.getPreExposure(ctx)).toBeCloseTo(base * 2, 6);
  });

  test('the sky, IBL and fog share one photometric anchor', () => {
    const scene = new Scene();
    scene.lightingMode = 'physical';
    const camera = new PerspectiveCamera(scene);
    camera.aperture = 16;
    camera.shutterSpeed = 1 / 125;
    camera.ISO = 100;
    const ctx = makeCtx(scene, camera);

    // Filament's IndirectLight default, in lux.
    expect(scene.env.light.intensity).toBe(30000);

    // envLightStrength converts the cached sky bake from its fixed storage exposure to the live
    // one. Every environment source is normalized into that single space before the IBL sees it
    // (the atmosphere emits photometric luminance; authored skyboxes are lifted by `intensity`),
    // which is what lets the IBL, SSR, SSGI and SSS passes consume it without knowing the sky type.
    const exposure = calculatePhysicalExposure(16, 1 / 125, 100);
    expect(PHYSICAL_BAKE_EXPOSURE).toBeCloseTo(exposure, 12);
    // The bake reference IS Sunny-16, so the ratio is exactly 1 at that setting.
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBeCloseTo(1, 10);

    // It tracks exposure and nothing else -- changing `intensity` re-bakes the cubemap rather than
    // rescaling this uniform, which is what keeps the cached bake exposure-independent.
    scene.env.light.intensity = 15000;
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBeCloseTo(1, 10);
    camera.exposureCompensation = 1;
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBeCloseTo(2, 10);
  });

  test('env light strength dims the IBL to zero in both lighting modes', () => {
    // Regression: physical mode ignored `strength` entirely, so there was no way to turn the IBL
    // down -- setting both it and `intensity` to 0 still uploaded 1.0 and the scene stayed lit.
    const scene = new Scene();
    const camera = new PerspectiveCamera(scene);
    camera.aperture = 16;
    camera.shutterSpeed = 1 / 125;
    camera.ISO = 100;
    const ctx = makeCtx(scene, camera);

    scene.lightingMode = 'physical';
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBeCloseTo(1, 10);
    scene.env.light.strength = 0.5;
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBeCloseTo(0.5, 10);
    scene.env.light.strength = 0;
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBe(0);

    // Legacy keeps `strength` as its sole, unscaled meaning.
    scene.lightingMode = 'legacy';
    scene.env.light.strength = 0.25;
    expect(ShaderHelper.getEnvLightLuminance(ctx)).toBeCloseTo(0.25, 10);
  });

  test('stores the sky bake in a range the environment cubemap can represent', () => {
    // Regression: the bake previously held raw photometric luminance. A 100,000 lux sun drove the
    // atmosphere to 100000 * 3.84 = 384,000, overflowing rg11b10uf (~65,024) and rgba16f (65,504) to
    // Inf. prefilterCubemap and the SH projection spread that Inf across the whole IBL, and bloom
    // turned it into NaN blocks on screen.
    const RG11B10UF_MAX = 65024;

    const scatterBake = 100000 * SkyRenderer.PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE * PHYSICAL_BAKE_EXPOSURE;
    expect(scatterBake).toBeCloseTo(10, 6);
    expect(scatterBake).toBeLessThan(RG11B10UF_MAX);

    // An authored skybox texel at full white, lifted by the default environment intensity.
    const skyboxBake = 1 * 30000 * PHYSICAL_BAKE_EXPOSURE;
    expect(skyboxBake).toBeLessThan(RG11B10UF_MAX);

    // Even an extreme sun stays representable.
    const extremeBake = 1000000 * SkyRenderer.PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE * PHYSICAL_BAKE_EXPOSURE;
    expect(extremeBake).toBeLessThan(RG11B10UF_MAX);
  });
});
