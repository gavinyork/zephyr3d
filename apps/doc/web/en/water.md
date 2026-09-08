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
water.material.refractionScale = 1;
water.material.reflectionStrength = 0.8;
water.TAAStrength = 0.4;
```

Important controls:

| Property | Meaning |
| --- | --- |
| `gridScale` | Clipmap grid spacing in world units |
| `animationSpeed` | Multiplier for wave time |
| `wireframe` | Draw clipmap grid lines for debugging |
| `TAAStrength` | Temporal smoothing used by the water material |
| `material.refractionScale` | Artistic scale on the refracted offset; 1 is physical, 0 disables it |
| `material.reflectionStrength` | Scale on the Fresnel reflectance; 1 is physical, lower shows more of what is underwater |

Underwater refraction is not a normal-driven push of the screen UV: the view ray is bent by Snell's law, followed to whatever is behind the water, and the hit point is projected back to the screen. The incidence angle, the water depth and the perspective foreshortening all fall out of that, so `refractionScale` is a stylisation knob rather than a strength that has to be tuned - the default of 1 is already the physical amount.

Because the material uses scene color and scene depth, water is rendered in the main scene pipeline. Keep transparent objects and post effects in mind when tuning the final look.

## The Water Medium

The water's color comes from two coefficients: **absorption** and **scattering**, both per-meter, per-RGB-channel physical coefficients (units 1/m).

```ts
// Clear pool water: low absorption and low scattering, the floor stays visible.
water.material.absorption = new Vector3(0.08, 0.03, 0.02);
water.material.scattering = new Vector3(0.01, 0.02, 0.03);

// Turbid sea water: high scattering gives a milky blue body.
// water.material.absorption = new Vector3(0.4, 0.14, 0.09);
// water.material.scattering = new Vector3(0.06, 0.12, 0.15);
```

- **Absorption** (`absorption`) sets how fast light dies out in the body. Higher and deeper means less transmitted light and a darker body.
- **Scattering** (`scattering`) sets how much light the body throws back toward the eye. Higher means a milkier, more opaque body - but also one that glows from within.
- `absorptionScale` / `scatteringScale` are global multipliers for quick turbidity adjustment without touching the per-channel color.
- `mediumMode` can be `physical` (default, Beer-Lambert) or `ramp` (the legacy gradient textures, kept only for scenes tuned against them).

The medium is **shared everywhere**: refraction, caustics, directional scattering and refraction blur all read the same `absorption` / `scattering` coefficients, so changing them affects all of those at once rather than one in isolation.

## Refraction

Refraction makes what is underwater land in the right place. The material has a `refractionMode`:

- **`march` (default)**: bends the view ray by Snell's law and marches it against the scene depth buffer in `REFRACT_MARCH_STEPS` steps, taking the first crossing. The hit point tracks the submerged object - it does not drift, and silhouettes do not tear. The cost is 24 depth-texture reads per water pixel.
- **`offset` (cheap mode)**: no depth search - it displaces the screen UV by the wave normal alone. All the marching goes away, but the water refracts to the *wrong* point: a submerged silhouette smears instead of holding still. Reach for it on hardware that cannot afford the march.

```ts
// Low-end: drop the depth search for performance.
water.material.refractionMode = 'offset';
water.material.cheapRefractionDepth = 1;
```

`cheapRefractionDepth` (meters) is only used by `offset`; it is the depth the cheap mode *assumes* the water is, which sets how strong the distortion looks. It is deliberately a constant rather than the measured distance to the bottom: scaling the offset by that distance would paint a second copy of anything breaking the surface.

## Caustics

Caustics are the web of focused sunlight the surface casts onto submerged geometry. They need a **shadow-casting directional light** and a WebGL2/WebGPU device; the pass switches itself off when either is missing.

```ts
water.causticsEnabled = true;
water.causticsDepth = 4;      // Focal depth (meters); set it near the receiving surface (pool floor / sea bed)
water.causticsRange = 60;     // Furthest the caustic map reaches (meters); the map is fitted to the water in range
water.causticsIntensity = 1;  // Caustic contrast; 0 leaves the light unmodulated
```

- `causticsDepth`: the depth where caustics are sharpest. Photons are splatted onto a horizontal plane at this depth; receivers away from it are progressively defocused rather than displaced, so set it to the depth that should show the sharpest pattern.
- `causticsRange`: a cap on how far from the camera the map reaches, not a fixed extent - the map is fitted to the water within it, so water smaller than the range gets the whole map. Raise it to light more of the scene at the cost of resolution.
- `causticsSceneDepth`: whether photons land on the scene instead of on the focal plane. Default `true`; on WebGPU it reuses the sun's shadow cascade as the scene-depth map, so it costs no extra geometry pass. On WebGL2 it degrades to the plane, where `causticsDepth` *is* the receiver depth. On either backend, set `causticsDepth` to the depth most receiving geometry sits at.
- `causticsIntensity`: the contrast strength. `0` leaves the light unmodulated; `1` is the default physical amount.
- `causticsFadeDistance`: width (meters) of the band the pattern fades out over at the map edge; `0` derives it from `causticsRange`.
- If the water surface sits **above** the pool walls (say surface at y=4, floor at y=0), caustics shift by `depth / tan(sun elevation)`, which leaves a blank band between the caustic boundary and the wall shadows. Keeping the surface at the rim and letting the water region cover the full receiving area keeps the caustics and shadows aligned.

## Directional Scattering

Directional scattering gives the body a direction-dependent color: it is evaluated per light, so a shadow falling on the water darkens the water itself and a low sun tints the column the way it tints everything else. Without it the body is lit by the environment irradiance alone, which has no direction.

```ts
water.material.sunScatteringIntensity = 1;  // 1 = the physical amount the medium implies; 0 disables it
water.material.scatterAnisotropy = 0.7;     // Mean cosine of a single scattering event, [0, 0.95]
```

- `sunScatteringIntensity`: how strongly sunlight scattered out of the column reaches the eye. `1` is the physical value the medium coefficients imply; anything else is deliberate exaggeration.
- `scatterAnisotropy`: the phase-function anisotropy. `0` scatters equally in all directions; `0.7` (default) is near measured sea water. It blends toward isotropic as the column gets optically thick (the effect of multiple scattering), so the visible anisotropy is always below this number.

## Refraction Blur

As the optical depth grows, what you see through the water blurs: scattering deflects the transmitted ray by a small angle at every event, so the image arriving at the surface is a convolution whose width grows with the optical depth.

```ts
water.material.refractionBlur = 1;  // 1 = the width the medium implies; 0 keeps the background sharp at any depth
```

The width is derived from the scattering coefficient and the path length; `refractionBlur` is a stylisation factor rather than the magnitude itself. It costs nothing on its own - it just selects a mip of the refraction background, which is generated regardless. Clear pool water stays essentially sharp; turbid water is a smudge a few meters down. That difference is one of the main ways clear pools and open seas read apart.

## Foam

Foam renders surface folding - a breaking crest - as a diffuse white layer. The wave generator reports where the surface has folded over itself; the material maps that into a coverage fraction.

```ts
water.material.foamAmount = 1;      // 0 disables foam
water.material.foamFalloff = 1.5;   // Above 1, light folding produces no foam; only a genuinely broken crest shows
water.material.foamColor = new Vector3(0.92, 0.95, 0.97);
```

- `foamAmount`: scales the folding amount into a coverage fraction; 0 disables foam.
- `foamFalloff`: a power applied to foam coverage before it is scaled. Above 1 it pushes light folding toward no foam at all, so only a crest that has genuinely broken shows - which is what keeps a windy sea from turning uniformly white.
- `foamColor`: the diffuse albedo of the foam. Slightly off-white and slightly blue (water plus air); a pure white one reads as snow.
- Foam is a **lit** surface: it suppresses the specular underneath it and the light coming up through the column, and responds to the sun and the ambient the way a matte surface does.

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

`FFTWaveGenerator` allocates GPU resources and is more suitable for wide ocean surfaces than small pools. Its spectrum is built from three cascades (`setWaveLength` / `setWaveStrength` / `setWaveCroppiness`); `foamWidth` / `foamContrast` control foam width and contrast. It works on WebGPU and WebGL2 (with half-float color-buffer support); on other devices the water silently falls back to flat - no waves.

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

- **Small decorative water**: `FBMWaveGenerator` is usually sufficient.
- **Oceans / broad swells**: use `FFTWaveGenerator`, especially when you want foam or folded crests. It allocates several FFT textures and updates every frame; the GPU cost rises quickly with resolution.
- **Low-end hardware**: set `refractionMode` to `offset` to drop the march's 24 depth reads per pixel.
- **Caustics**: need a shadow-casting directional light. If you do not want them, keep `causticsEnabled = false` to skip the photon launch and temporal accumulation entirely.
- **Refraction blur / directional scattering**: nearly free, and they pull a lot of look from the medium coefficients.
