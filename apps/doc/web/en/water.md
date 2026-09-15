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

| Property | Meaning |
| --- | --- |
| `gridScale` | Clipmap grid spacing in world units. Use the largest value that still gives enough near-camera detail |
| `animationSpeed` | Multiplier for wave time |
| `wireframe` | Draw clipmap grid lines for debugging |
| `TAAStrength` | Temporal smoothing used by the water. Raise it when the surface shimmers or sparkles, lower it if you see trailing |
| `refractionScale` | Artistic scale on the refracted offset. 1 is physical, 0 disables it, above 1 exaggerates |
| `reflectionStrength` | Scale on the Fresnel reflectance. 1 is physical; water reflects almost everything at a grazing angle, so lowering this trades reflection away for visibility of what is underwater |

Because the material uses scene color and scene depth, water is rendered in the main scene pipeline. Keep transparent objects and post effects in mind when tuning the final look.

## The Water Medium

The water's color comes from two coefficients, **absorption** and **scattering**, both per-meter, per-RGB-channel physical coefficients (units 1/m).

```ts
// Clear pool water: low absorption and low scattering, the floor stays visible.
water.absorption = new Vector3(0.08, 0.03, 0.02);
water.scattering = new Vector3(0.01, 0.02, 0.03);

// Turbid sea water: high scattering gives a milky blue body.
// water.absorption = new Vector3(0.4, 0.14, 0.09);
// water.scattering = new Vector3(0.06, 0.12, 0.15);
```

| Property | Meaning |
| --- | --- |
| `absorption` | How fast light dies out in the body. Higher, and deeper, means less transmitted light and a darker body |
| `scattering` | How much light the body throws back toward the eye. Higher means a milkier, more opaque body - but also one that glows from within |
| `absorptionScale` / `scatteringScale` | Global multipliers for quick turbidity adjustment without touching the per-channel color |
| `mediumMode` | `physical` (default) or `ramp`. `ramp` is the legacy gradient-texture path, kept only for scenes tuned against it |

These coefficients are **shared**: refraction, caustics, directional scattering and refraction blur all read the same values, so changing them affects all of those at once.

## Refraction

`refractionMode` decides how what is underwater is located.

| Value | Effect and cost |
| --- | --- |
| `march` (default) | Submerged objects land in the right place: they do not drift and silhouettes do not tear. Costs around 24 depth-texture reads per water pixel |
| `offset` | No depth search. The direction and magnitude of the refraction are roughly right but the landing point is not, so a submerged silhouette smears instead of holding still. Reach for it on hardware that cannot afford `march` |

```ts
// Low-end: drop the depth search for performance.
water.refractionMode = 'offset';
water.cheapRefractionDepth = 1;
```

`cheapRefractionDepth` (meters) is used only by `offset`. It is the depth the cheap mode assumes the water is, which sets how strong the distortion looks.

## Caustics

Caustics are the web of focused sunlight the surface casts onto submerged geometry. They need a **shadow-casting directional light** and a WebGL2/WebGPU device; the pass switches itself off when either is missing.

```ts
water.causticsEnabled = true;
water.causticsDepth = 4;
water.causticsRange = 60;
water.causticsIntensity = 1;
```

| Property | Meaning |
| --- | --- |
| `causticsEnabled` | Master switch. Keep it `false` when you do not want caustics to skip the photon launch and temporal accumulation entirely |
| `causticsDepth` | The depth (meters) where caustics are sharpest. Receivers away from it are progressively **defocused** rather than displaced, so set it to the depth most receiving geometry - pool floor, sea bed - sits at |
| `causticsRange` | How far from the camera the caustic map reaches (meters). A cap rather than a fixed extent: the map is fitted to the water actually within it. Raise it to light more of the scene at the cost of resolution |
| `causticsIntensity` | Caustic contrast. 0 leaves the light unmodulated, 1 is the default physical amount |
| `causticsSceneDepth` | Land photons on the real scene instead of on a flat focal plane. Default `true`; free on WebGPU, degrades to the plane on WebGL2, where `causticsDepth` *is* the receiver depth |
| `causticsFadeDistance` | Width (meters) of the band the pattern fades out over at the map edge. 0 derives it from `causticsRange` |

## Directional Scattering

Directional scattering gives the body a **direction-dependent** color: it is evaluated per light, so a shadow falling on the water darkens the water itself and a low sun tints it. Without it the body is lit by the environment alone and loses its sense of direction.

```ts
water.sunScatteringIntensity = 1;
water.scatterAnisotropy = 0.7;
```

| Property | Meaning |
| --- | --- |
| `sunScatteringIntensity` | How strongly sunlight scattered out of the column reaches the eye. 1 is the physical value the medium coefficients imply, 0 disables it, higher is deliberate exaggeration |
| `scatterAnisotropy` | Phase-function anisotropy, in [0, 0.95]. 0 scatters equally in all directions; 0.7 (default) is near measured sea water. Thicker water blends toward isotropic, so the **visible anisotropy is always below this number** |

## Subsurface Scattering

Subsurface scattering is what makes a **backlit wave crest glow**: sunlight enters the far side of the crest and scatters out through the thin wall of water towards the eye. 

```ts
water.subsurfaceIntensity = 0.5;
water.subsurfaceCrestHeight = 1.5;
water.subsurfaceTint = new Vector3(0.86, 0.98, 0.71);
```

| Property | Meaning |
| --- | --- |
| `subsurfaceIntensity` | Strength of the glow. 0 disables it. An authored magnitude that is not scaled by the light's intensity, so it stays put when the sun is brightened. Directional lights only |
| `subsurfaceTint` | Color of the glow before the crest gate tints it with the medium's extinction. The default is a warm yellow-green: the gate removes red in the troughs, and the tint keeps some on the crests so they read as sunlight through water rather than as colored milk |
| `subsurfaceCrestHeight` | Height above the still-water level, in meters, over which the lit wall of a crest thins by a factor of e. Crests are thin and glow; troughs see the full path through the medium and keep only a tinted trace |

## Underwater

Move the camera below the surface and the water takes over the whole frame: the medium is applied to the scene, the sky is replaced by water, and the surface itself is read from below. Nothing needs enabling - the camera entering a water region is what switches it on.

```ts
water.underwaterEnabled = true;
water.underwaterAmbientIntensity = 1;
water.underwaterGodRays = true;
```

| Property | Meaning |
| --- | --- |
| `underwaterEnabled` | Master switch, default `true`. Turn it off for a water body the camera is never meant to enter |
| `underwaterAmbientIntensity` | Scale on the downwelling sky light filling the column. This is what the water fades to in the distance, so it sets how bright the underwater haze reads |
| `underwaterGodRays` | Shafts of sunlight through the column, default `true` |
| `underwaterGodRayIntensity` | Shaft strength, 1 for the value the medium implies |
| `underwaterGodRaySteps` | Samples per view ray, default 24. Raise it when the shafts read as grain rather than as beams |
| `underwaterGodRayShadow` | Let geometry standing in the water break the shafts. Default `false`; costs a shadow map lookup per march step |
| `underwaterHysteresis` | Half-width (meters) of the dead band around the surface the submerged test uses |

> Tthe underwater medium reaches **opaque geometry only**.
>
> The submerged test is against the water's **rest plane**, not the displaced surface, so a camera within a wave height of the surface may disagree with what the waves are doing. .

## Refraction Blur

The more turbid and the deeper the water, the more what you see through it blurs.

```ts
water.material.refractionBlur = 1;
```

`refractionBlur` is a multiplier on that blur: 1 is the amount the medium coefficients imply, 0 keeps the background sharp at any depth. The width also follows the `scattering` coefficient and the path length, so changing the medium changes the blur. The effect is nearly free. Clear pool water stays essentially sharp while turbid water is a smudge a few meters down, which is one of the main ways the two read apart.

## Crest Foam

Crest foam comes from the surface folding over at a breaking wave. The `waveGenerator` supplies the folding data and the material maps it into a coverage fraction.

```ts
water.material.foamAmount = 1;
water.material.foamFalloff = 1.5;
water.material.foamColor = new Vector3(0.92, 0.95, 0.97);
```

| Property | Meaning |
| --- | --- |
| `foamAmount` | Scales the folding amount into a coverage fraction. 0 disables crest foam |
| `foamFalloff` | A power applied to the coverage. Above 1 it pushes light folding toward no foam at all, so only a genuinely broken crest shows - which is what keeps a windy sea from turning uniformly white |
| `foamColor` | Diffuse albedo of the foam, shared with shoreline foam. Slightly off-white and slightly blue (water plus air); a pure white one reads as snow |

Foam is a **lit** surface: it suppresses the specular underneath it and the light coming up through the column, and responds to the sun and the ambient the way a matte surface does.

## Shoreline Foam

Shoreline foam is the white water that collects where the surface comes close to something solid: the waterline on a shelving bed, and the collar where a piling, a hull or a rock breaks the surface. It is independent of crest foam and switches on separately.

It is **off by default** and needs WebGL2 or WebGPU; on WebGL1 the parameters have no effect.

```ts
water.shoreFoamAmount = 1;
water.shoreFoamDepth = 0.5;
water.shoreFoamWashAmount = 0.5;
```

| Property | Meaning |
| --- | --- |
| `shoreFoamAmount` | Coverage strength. 0 disables it (default), which also removes its cost |
| `shoreFoamDepth` | How far the band reaches from the solid surface (meters). Over a bed that is a depth of water; against something vertical like a piling or a hull it is the horizontal distance to its side, and one value serves both. How wide that is on screen depends on the geometry: a thin line on a steep drop-off, a broad stretch on a flat shelf |
| `shoreFoamFalloff` | Falloff across the band. Above 1 it pushes coverage toward the contact line and keeps the outer edge thin and broken |
| `shoreFoamScale` | Size of the foam clumps, as **cycles across the band**. 2.5 puts a couple of clumps across it. Being relative to the band width rather than an absolute frequency, one value reads the same on a shoreline metres across and on a collar a handspan wide |
| `shoreFoamWashAmount` | How far the waterline runs up and back, as a fraction of `shoreFoamDepth`. 0 leaves a static rim; this is what makes the band read as surf rather than as a decal. Above 1 the band closes completely at the bottom of the cycle, which looks like the foam blinking out |
| `shoreFoamWashSpeed` | Run-up cycles per second. This is swell rather than wind waves, so well under 1 |
| `shoreFoamWashScale` | Spatial frequency of the run-up phase (cycles per meter). At 0 the whole waterline rises and falls in lockstep, which reads as the water level itself changing; a cycle every few tens of meters breaks a long shoreline into sections that run out of step with one another |

The color comes from `material.foamColor`, shared with crest foam.

The effect is derived from what the camera can see, which sets its limits:

- Foam near an object disappears once that object leaves the frame
- An object hidden behind something in the foreground produces no foam
- An object only a few pixels wide on screen - a cable, a railing - may produce no foam at all. Lowering `shoreFoamDepth` helps

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
- **Low-end hardware**: set `refractionMode` to `offset` to drop the 24 depth reads per pixel.
- **Caustics**: need a shadow-casting directional light. Keep `causticsEnabled = false` when you do not want them.
- **Shoreline foam**: adds around a dozen depth samples per water pixel and a second channel to the scene's depth pyramid. Keep `shoreFoamAmount = 0` when you do not want it.
- **Refraction blur / directional scattering**: nearly free, and they pull a lot of look from the medium coefficients.
- **Underwater**: costs nothing while the camera is above the surface - the pass is not built into the frame at all. Once submerged it is two full-screen draws, plus `underwaterGodRaySteps` caustic-map samples per pixel when the shafts are on, and the same number of shadow map lookups again when `underwaterGodRayShadow` is. Lower the step count before turning the shafts off.
