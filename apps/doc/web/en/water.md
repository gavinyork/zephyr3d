# Water

`Water` is a scene node for rendering large animated water surfaces. It uses clipmap grids around the camera and a `WaterMaterial` that can sample scene color and scene depth for refraction and depth-based shading.

Use it for oceans, lakes, pools, rivers, or any broad surface where a tiled mesh would be inefficient.

## Basic Setup

```ts
import {
  FFTWaveGenerator,
  FBMWaveGenerator,
  GerstnerWaveGenerator,
  Water
} from '@zephyr3d/scene';
import { Vector2, Vector3 } from '@zephyr3d/base';

const water = new Water(scene);
water.parent = scene.rootNode;

// The X/Z scale controls the water region.
water.position.setXYZ(0, 0, 0);
water.scale.setXYZ(200, 1, 200);

water.gridScale = 1;
water.animationSpeed = 1;

const waves = new FBMWaveGenerator();
waves.amplitude = 0.8;
waves.frequency = 0.025;
waves.numOctaves = 5;
waves.wind = new Vector2(1, 0.35);

water.waveGenerator = waves;
```

`Water` derives its horizontal region from the node transform. Move the node to move the center of the water area, and scale X/Z to change its coverage.

<div class="showcase" case="tut-66"></div>

## Material Controls

The water material is available through `water.material`.

```ts
water.material.depthMulti = 0.08;
water.material.displace = 0.35;
water.material.refractionStrength = 0.25;
water.TAAStrength = 0.4;
```

Important controls:

| Property | Meaning |
| --- | --- |
| `gridScale` | Clipmap grid spacing in world units |
| `animationSpeed` | Multiplier for wave time |
| `wireframe` | Draw clipmap grid lines for debugging |
| `TAAStrength` | Temporal smoothing used by the water material |
| `material.depthMulti` | Depth falloff multiplier for water shading |
| `material.displace` | Refraction displacement strength |
| `material.refractionStrength` | How strongly scene color is refracted |

Because the material uses scene color and scene depth, water is rendered in the main scene pipeline. Keep transparent objects and post effects in mind when tuning the final look.

## Wave Generators

The `waveGenerator` property controls vertex displacement, normal calculation, foam data, and water feedback queries.

| Generator | Use |
| --- | --- |
| `FBMWaveGenerator` | Fast procedural waves, good default for stylized or general water |
| `GerstnerWaveGenerator` | Directional layered waves with manual control per wave |
| `FFTWaveGenerator` | Ocean-spectrum simulation, better for large ocean surfaces, more expensive |

### FBM Waves

```ts
const waves = new FBMWaveGenerator();
waves.amplitude = 1.2;
waves.frequency = 0.018;
waves.numOctaves = 6;
waves.wind = new Vector2(0.8, 0.4);

water.waveGenerator = waves;
```

### Gerstner Waves

```ts
const waves = new GerstnerWaveGenerator();
waves.numWaves = 4;

waves.setWaveDirection(0, 0.2);
waves.setWaveAmplitude(0, 0.4);
waves.setWaveLength(0, 18);
waves.setWaveSteepness(0, 0.6);

water.waveGenerator = waves;
```

### FFT Ocean

```ts
const waves = new FFTWaveGenerator();
waves.wind = new Vector2(32, 18);
waves.foamWidth = 0.4;
waves.foamContrast = 1.5;

water.waveGenerator = waves;
```

`FFTWaveGenerator` allocates GPU resources and is more suitable for wide ocean surfaces than small pools.

## Sampling the Water Surface

Use `getSurfacePoint()` when gameplay or tools need the displaced water height and normal.

```ts
const query = [new Vector3(10, 0, 12)];
const positions = [new Vector3()];
const normals = [new Vector3()];

await water.getSurfacePoint(query, positions, normals);

boat.position.y = positions[0].y;
// Use normals[0] in your own controller if the object should tilt with the wave.
```

The method runs a GPU feedback pass on the next frame, so it is asynchronous. Batch multiple query points into one call instead of calling it once per object.

## Serialization

`Water` is registered with the serialization system, including its material-related water parameters and the built-in `FBMWaveGenerator` / `FFTWaveGenerator` settings. This means editor-created water nodes and saved scene water settings can be restored through `loadScene()` or `instantiatePrefab()`.

`GerstnerWaveGenerator` can be used at runtime, but it is not currently one of the registered wave-generator types for serialized water nodes.

If you assign custom textures to the water material, make sure those textures have stable asset ids in the `ResourceManager` before serializing.

## Performance Notes

Use the largest `gridScale` that still gives enough near-camera detail. Keep the water region close to the visible play area, and avoid multiple overlapping ocean-sized water nodes unless each one is required.

For small decorative water, `FBMWaveGenerator` is usually sufficient. Use FFT water when the wave spectrum itself is part of the visual target.
