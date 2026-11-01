# Volumetric Clouds

The atmospheric sky supports the default `procedural` 2D clouds and WebGPU ray-marched `volumetric` clouds. Volumetric clouds have a finite layer, self-shadowing, and an approximation of multiple scattering, at the cost of noise volumes and a sky-cache update.

## Enable

```ts
const sky = scene.env.sky;
sky.skyType = 'scatter';
sky.cloudMode = 'volumetric';

const clouds = sky.volumetricCloud;
clouds.layerBottomAltitude = 5000;
clouds.layerHeight = 10000;
clouds.coverage = 0.45;
clouds.density = 0.03;
clouds.wind.setXY(10, 0);
clouds.framesPerUpdate = 64;
clouds.cacheResolution = 768;
```

Distances are in metres. `coverage` controls the amount of cloud, `density` its thickness, and `baseHeightVariation`, `formation`, and the noise scales shape the field. `viewSampleCountScale` and `shadowSampleCountScale` improve ray quality while increasing cost.

The engine generates weather, base-noise, and detail-noise resources by default. For authored results, assign slice atlases to `sky.cloudWeatherMap`, `sky.cloudBaseNoise`, and `sky.cloudDetailNoise`. The sky cache updates over `framesPerUpdate` frames; lower values respond faster but cost more per frame.

Use `sky.cloudDebugView = 'weather'` (or `baseNoise`, `detailNoise`, `densityXY`, and related views) to inspect the generated resources.

Volumetric mode is WebGPU-only. Other backends fall back to `effectiveCloudMode === 'procedural'`. It requires `skyType = 'scatter'`, is not scene geometry, and does not participate in Mesh LOD, SDF, or physics. Keep cloud altitudes and `scene.metersPerUnit` in the same world scale.
