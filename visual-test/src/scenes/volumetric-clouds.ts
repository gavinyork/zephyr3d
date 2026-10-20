import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { DirectionalLight, getDevice } from '@zephyr3d/scene';
import type { CloudFormation, VolumetricCloudDebugView } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import type { SceneContext, VisualScene } from '../types';
import { bareScene, placeCamera } from './common';

type WeatherFixture = 'constant' | 'footprint' | 'generated';

interface CloudDiagnostic {
  name: string;
  description: string;
  weather?: WeatherFixture;
  cloudType?: number;
  debugView?: VolumetricCloudDebugView;
  slice?: number;
  detail?: number;
  shape?: number;
  formation?: CloudFormation;
  seed?: number;
  side?: boolean;
  sunElevation?: number;
  frames?: number;
  toneMapDither?: boolean;
  cacheResolution?: number;
  framesPerUpdate?: number;
}

const CLOUD_OVERRIDE_KEYS = [
  'coverage',
  'shapeStrength',
  'detailErosion',
  'detailBottomErosion',
  'baseHeightVariation',
  'weatherMapScale',
  'baseNoiseScale',
  'detailNoiseScale',
  'layerHeight',
  'layerBottomAltitude',
  'noiseSeed'
] as const;

function cloudOverrides(): Partial<Record<(typeof CLOUD_OVERRIDE_KEYS)[number], number>> {
  const raw = new URLSearchParams(location.search).get('cloudOverrides');
  if (!raw) {
    return {};
  }
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Cloud diagnostic overrides must be a JSON object');
  }
  const result: Partial<Record<(typeof CLOUD_OVERRIDE_KEYS)[number], number>> = {};
  for (const [key, number] of Object.entries(value)) {
    if (!CLOUD_OVERRIDE_KEYS.includes(key as (typeof CLOUD_OVERRIDE_KEYS)[number])) {
      throw new Error(`Unsupported cloud diagnostic override: ${key}`);
    }
    if (typeof number !== 'number' || !Number.isFinite(number)) {
      throw new Error(`Cloud diagnostic override ${key} must be finite`);
    }
    result[key as (typeof CLOUD_OVERRIDE_KEYS)[number]] = number;
  }
  return result;
}

/**
 * Weather fixtures are linear RGBA data, not images the user has to supply.
 * A footprint controls horizontal coverage only: no dome or height field is
 * baked into it. R and G match so channel selection cannot alter the fixture;
 * B is an explicit cloud type and A is one.
 */
export function createCloudWeatherFixture(kind: 'constant' | 'footprint', cloudType: number): Texture2D {
  const size = kind === 'constant' ? 1 : 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5);
      const t = Math.max(0, Math.min(1, (radius - 0.025) / (0.09 - 0.025)));
      const coverage = kind === 'constant' ? 255 : Math.round((1 - t * t * (3 - 2 * t)) * 255);
      const offset = (y * size + x) * 4;
      data[offset] = coverage;
      data[offset + 1] = coverage;
      data[offset + 2] = Math.round(Math.max(0, Math.min(1, cloudType)) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = getDevice().createTexture2D('rgba8unorm', size, size, {
    mipmapping: false,
    samplerOptions: { addressU: 'repeat', addressV: 'repeat', mipFilter: 'none' }
  });
  if (!texture) {
    throw new Error('Cloud weather fixture: texture creation failed');
  }
  texture.name = `CloudWeatherFixture(${kind},type=${cloudType})`;
  texture.update(data, 0, 0, size, size);
  return texture;
}

/**
 * Cloud-shaping diagnostic presets. Captures are diagnostic artifacts, not accepted visual baselines.
 * Periods are metres: 12 km base noise has an approximately 3 km first octave.
 */
export const CLOUD_SHAPING_PRESETS = {
  connected: { coverage: 0.4, weatherMapScale: 64000, baseNoiseScale: 12000 },
  isolated: { coverage: 0.5, weatherMapScale: 64000, baseNoiseScale: 12000 }
} as const;

function setupCloudDiagnostic({ scene, camera }: SceneContext, diagnostic: CloudDiagnostic) {
  bareScene(scene);
  scene.lightingMode = 'legacy';
  const sky = scene.env.sky;
  sky.skyType = 'scatter';
  sky.cameraHeightScale = 1;
  sky.atmosphereExposure = 1;
  sky.cloudMode = 'volumetric';
  sky.cloudDebugView = diagnostic.debugView ?? 'none';
  sky.cloudDebugSlice = diagnostic.slice ?? 0.5;
  sky.cloudDebugChannel = 1;

  const cloud = sky.volumetricCloud;
  const formation = diagnostic.formation ?? 'connected';
  const preset = CLOUD_SHAPING_PRESETS[formation];
  cloud.layerBottomAltitude = 2000;
  cloud.layerHeight = 5000;
  cloud.tracingMaxDistance = 50000;
  cloud.weatherMapScale = preset.weatherMapScale;
  cloud.baseNoiseScale = preset.baseNoiseScale;
  cloud.detailNoiseScale = 1200;
  cloud.coverage = preset.coverage;
  cloud.density = 0.03;
  cloud.shapeStrength = diagnostic.shape ?? 1;
  cloud.detailErosion = diagnostic.detail ?? 0.25;
  cloud.detailBottomErosion = 0.1;
  cloud.formation = formation;
  cloud.noiseSeed = diagnostic.seed ?? 0;
  cloud.wind = new Vector2(0, 0);
  cloud.anvilBias = 0;
  cloud.framesPerUpdate = diagnostic.framesPerUpdate ?? 4;
  cloud.cacheResolution = diagnostic.cacheResolution ?? 512;
  cloud.viewSampleCountScale = 2;
  cloud.shadowSampleCountScale = 1;
  for (const [key, value] of Object.entries(cloudOverrides())) {
    cloud[key as (typeof CLOUD_OVERRIDE_KEYS)[number]] = value;
  }

  const weather = diagnostic.weather ?? 'footprint';
  // The sky retains this fixture and disposes it with the scene.
  sky.cloudWeatherMap =
    weather === 'generated' ? null : createCloudWeatherFixture(weather, diagnostic.cloudType ?? 1);

  const sun = new DirectionalLight(scene);
  sun.sunLight = true;
  sun.color = new Vector4(1, 1, 1, 1);
  sun.intensity = 10;
  sun.lookAt(new Vector3(-1, diagnostic.sunElevation ?? 1, 1), Vector3.zero(), Vector3.axisPY());
  camera.near = 1;
  camera.far = 100000;
  camera.fovY = Math.PI / 3;
  camera.toneMapExposure = 1;
  camera.toneMapDither = diagnostic.toneMapDither ?? true;
  placeCamera(
    camera,
    diagnostic.side ? new Vector3(0, 100, 32000) : new Vector3(32000, 100, 50000),
    new Vector3(32000, 4500, 32000)
  );
}

function cloudDiagnostic(diagnostic: CloudDiagnostic): VisualScene {
  return {
    name: diagnostic.name,
    description: diagnostic.description,
    supports: (backend) => backend === 'webgpu',
    // Frame 1 initializes the quick sky maps. Ordinary scenes complete two
    // four-frame rounds before capture; the production-cache scene records its
    // initial map. Wind and anvil are off for deterministic comparison.
    frames: diagnostic.frames ?? (diagnostic.debugView ? 1 : 9),
    setup: (ctx) => setupCloudDiagnostic(ctx, diagnostic)
  };
}

/**
 * Opt-in diagnostics: excluded from the default regression registry until
 * their GPU captures have been inspected and image baselines accepted.
 */
export const CLOUD_SHAPING_SCENES: VisualScene[] = [
  cloudDiagnostic({
    name: 'cloud-profile-stratocumulus-xy',
    description: 'Constant type 0.5 weather: vertical height profile without noise shaping.',
    weather: 'constant',
    cloudType: 0.5,
    debugView: 'profileXY',
    shape: 0,
    detail: 0
  }),
  cloudDiagnostic({
    name: 'cloud-profile-cumulus-xy',
    description: 'Constant type 1 weather: cumulus bottom transition and top envelope.',
    weather: 'constant',
    debugView: 'profileXY',
    shape: 0,
    detail: 0
  }),
  cloudDiagnostic({
    name: 'cloud-base-density-xy',
    description: 'Single smooth weather footprint: vertical section before detail erosion.',
    debugView: 'baseDensityXY',
    detail: 0
  }),
  cloudDiagnostic({
    name: 'cloud-density-xy',
    description: 'Same footprint and seed: vertical density section after detail erosion.',
    debugView: 'densityXY'
  }),
  cloudDiagnostic({
    name: 'cloud-density-xz',
    description: 'Same footprint and seed: horizontal density section at one quarter layer height.',
    debugView: 'densityXZ',
    slice: 0.25
  }),
  cloudDiagnostic({
    name: 'cloud-controlled-base',
    description: 'Rendered single cumulus footprint with detail disabled.',
    detail: 0
  }),
  cloudDiagnostic({
    name: 'cloud-controlled-detail',
    description: 'Rendered same cumulus footprint with detail and protected cloud base.'
  }),
  cloudDiagnostic({
    name: 'cloud-dusk-initial',
    description: 'Low-sun cloud cache immediately after its quick rebuild.',
    weather: 'generated',
    formation: 'isolated',
    sunElevation: 0.06,
    frames: 1
  }),
  cloudDiagnostic({
    name: 'cloud-dusk-settled',
    description: 'Low-sun cloud cache after two full-quality rounds.',
    weather: 'generated',
    formation: 'isolated',
    sunElevation: 0.06
  }),
  cloudDiagnostic({
    name: 'cloud-dusk-settled-no-tonemap-dither',
    description: 'Low-sun cloud cache without display tonemap dithering.',
    weather: 'generated',
    formation: 'isolated',
    sunElevation: 0.06,
    toneMapDither: false
  }),
  cloudDiagnostic({
    name: 'cloud-dusk-default-cache',
    description: 'Low-sun cloud with the production cache resolution and update cadence.',
    weather: 'generated',
    formation: 'isolated',
    sunElevation: 0.06,
    frames: 1,
    framesPerUpdate: 64,
    cacheResolution: 768
  }),
  ...(['connected', 'isolated'] as const).flatMap((formation) =>
    [0, 1, 2].map((seed) =>
      cloudDiagnostic({
        name: `cloud-generated-${formation}-seed-${seed}`,
        description: `Generated ${formation} weather, fixed seed ${seed}: candidate large-cloud preset.`,
        weather: 'generated',
        formation,
        seed
      })
    )
  ),
  ...(['connected', 'isolated'] as const).flatMap((formation) =>
    [0, 1, 2].map((seed) =>
      cloudDiagnostic({
        name: `cloud-generated-${formation}-seed-${seed}-side`,
        description: `Same generated ${formation} weather and seed ${seed}, viewed from the west.`,
        weather: 'generated',
        formation,
        seed,
        side: true
      })
    )
  )
];
