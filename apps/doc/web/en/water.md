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

> 1.0 removes the legacy gradient-texture medium: `mediumMode`, `scatterRampTexture` and `absorptionRampTexture` are gone, and the medium comes from the two coefficients above alone.

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

Caustics are the web of focused sunlight the surface casts onto submerged geometry. They need a **shadow-casting directional light** and a WebGL2/WebGPU device; the pass switches itself off when either is missing, and also when the sun is close to the horizon.

```ts
water.causticsEnabled = true;
water.causticsDepth = 4;
water.causticsRange = 60;
water.causticsIntensity = 1;
```

| Property | Meaning |
| --- | --- |
| `causticsEnabled` | Master switch, default `true`. Set it to `false` when you do not want caustics, to skip the photon launch and temporal accumulation entirely. The underwater light shafts read the caustic map, so they disappear with it |
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
| `underwaterGodRays` | Shafts of sunlight through the column, default `true`. Needs caustics: with `causticsEnabled = false` there are no shafts |
| `underwaterGodRayIntensity` | Shaft strength, 1 for the value the medium implies |
| `underwaterGodRaySteps` | Samples per view ray, default 24. Raise it when the shafts read as grain rather than as beams |
| `underwaterGodRayShadow` | Let geometry standing in the water break the shafts. Default `false`; costs a shadow map lookup per march step |
| `underwaterHysteresis` | Half-width (meters) of the dead band around the surface the submerged test uses |

> The underwater medium reaches **opaque geometry only**.
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

Foam left by breaking crests on open water does not vanish at once; it drifts with the wind and fades:

| Property | Default | Meaning |
| --- | --- | --- |
| `foamFadeRate` | `0.8` | How fast the foam fades, per second. Lower leaves longer white trails behind breaking waves |
| `foamTrailStrength` | `1` | How much foam breaking crests leave behind to drift and fade. 0 keeps foam only while a crest breaks |
| `foamDrift` | `0.03` | Share of the wind speed the foam drifts at, about 0.03 in nature |
| `foamFieldSize` | `128` | Side in metres of the finest level of the foam field around the camera. Coarser levels reach eight times as far; beyond them foam shows only while crests break |

Foam is a **lit** surface: it suppresses the specular underneath it and the light coming up through the column, and responds to the sun and the ambient the way a matte surface does.

## Shore Waves

Shore waves are the wave trains that roll in from open water, steepen in the shallows, break and run up the beach. They are layered over the waves of the `waveGenerator`; whatever the shape of the coast, the crests come in square to it, and boats and other floating objects ride them.

**Off by default**; they turn on when `shoreWaveHeight` is greater than 0. WebGPU only.

```ts
water.shoreWaveHeight = 0.6; // crest-to-trough height in metres, 0 for none
water.shoreWavePeriod = 6;   // seconds between successive waves
water.shoreWaveLength = 8;   // crest spacing in metres at the outer edge of the zone, bunching up shoreward
water.shoreWaveZone = 20;    // how far out from the waterline the waves rise, in metres
```

| Property | Default | Meaning |
| --- | --- | --- |
| `shoreWaveHeight` | `0` | Crest-to-trough height in metres. 0 turns the shore waves off, and the shore field and foam work with them |
| `shoreWaveLength` | `8` | Distance in metres between crests at the outer edge of the zone; they bunch up towards the shore |
| `shoreWavePeriod` | `6` | Seconds between successive waves |
| `shoreWaveZone` | `20` | How far out from the waterline the waves rise, in metres |
| `shoreWaveSharpness` | `0.7` | How sharp the crests become at the shore, 0 for a sine and towards 1 for a cusp |
| `shoreWaveLean` | `0.5` | How far the crests lean towards the shore, 0 for upright, 1 for a steep front face |
| `shoreWaveIrregularity` | `0.6` | 0 for parallel crests a fixed wavelength apart; higher gives each wave a period and a bend of its own |

ShoreWave reads the shoreline from the height map of the scene's first terrain, in four levels around the camera, each twice the size of the one before, covering 1024 m square with the waves fading out from about 450 m, matching the foam field; props and piers on the beach do not bend the waves. Foam against walls still comes from the scene SDF, within about 50 m of the camera, so it needs the scene SDF enabled. Without a terrain the waves fall back to the scene SDF too, with the same 50 m reach. WebGPU only. Select `Shore field levels` (`'shoreLevels'`) to see which level answers where: red, green, blue and yellow from the nearest, blending where levels hand over and darkening towards the edge of the farthest; light and dark bands every 2 m of the distance to the waterline should run on unbroken across the handovers.

### Shore Foam

Shore-wave foam rises and falls with the waves: each broken wave carries a sheet of white water shoreward that fades behind the crest, runs up the beach with the swash, and stays on the sand to fade away once the water drains. The foam in the water and on the beach is one foam field; the shallower the water, the less the foam drifts and the slower it fades, so the beach foam and the sea foam form one sheet.

| Property | Default | Meaning |
| --- | --- | --- |
| `shoreWaveFoamStrength` | `1` | How much foam the breaking shore waves make |
| `shoreWaveFoamCoverage` | `0.55` | How much of the shore waves makes foam, 0..1, higher for more |
| `shoreWaveShallowFoamDepth` | `0.65` | Water shallower than this many metres makes foam |
| `shoreWaveShallowFoamStrength` | `2` | How much foam shallow water makes |
| `surfFoamDuration` | `1.5` | How long, in seconds, the foam of each breaking wave lasts. Higher gives longer white trails behind the crests and foam that stays longer on the sand |
| `foamSettleDepth` | `0.02` | Water depth in metres below which foam stops drifting and stays where it is until it fades. Higher widens the band of foam lying in the shallows and on the beach |
| `foamDriftDepth` | `0.3` | Water depth in metres above which foam drifts freely; in between, the shallower the water the slower it drifts |
| `settledFoamFade` | `0.25` | How fast foam resting in the shallows and on the sand fades compared with open water. Lower leaves it on the beach longer after each wave drains; 1 fades it as fast as at sea |

Where water hits walls, rocks and piers standing in it, it rings them with foam. Wall foam only appears while the shore waves are on, and comes from the scene SDF (see above).

| Property | Default | Meaning |
| --- | --- | --- |
| `wallFoamStrength` | `1` | Opacity of the wall foam, 0..1 |
| `wallFoamMinSpeed` | `0.2` | Speed in metres per second the water has to hit a wall at before it makes any foam |
| `wallFoamMaxSpeed` | `1.5` | Speed in metres per second at which water hitting a wall makes the most foam |
| `wallFoamDrift` | `0.3` | Speed in metres per second the foam drifts out from the wall at; higher for a wider ring |

### Debug Views

Select `Shore regions (geometry)` under `Debug Output` in the editor, or set `water.debugOutput = 'shoreRegions'`, to inspect the coastal geometry. Blue marks base water, cyan the offshore ShoreWave region, orange the wet inland swash, and magenta the dry inland carrier. The fade from blue to a coastal color shows the ShoreWave envelope weight. ShoreWave and base water share one displaced mesh; the colors identify regions rather than separate meshes.

This view bypasses wet-edge clipping, foam shading, and projected-ground depth correction in both color and depth passes. It preserves the actual geometry and terrain occlusion, revealing dry carrier surfaces that normal rendering hides. Combine it with `wireframe` to inspect mesh coverage. Select `None` (`'none'`) to restore normal rendering.

Three RGB views keep normal wet clipping and ground-depth handling for diagnosing swash foam. `swashHandover` shows carrier wet coverage in red, reconstructed ground wet coverage in green, and ground replacement weight in blue. `swashFoamSources` shows surface foam density in red, the foam field's density at the ground in green, and the breaking waves' foam on the wet ground in blue. `swashFoamCuts` shows the surface foam opacity after texture cutting in red, the ground foam opacity in green, and the replacement weight in blue. Compare these views at the same paused wave phase to locate a break between density, texture cutting, and final handover. Temporarily set `animationSpeed` to 0 to pause the waves, then restore its original value.

`swashVisibility` reveals fragments normally clipped or hidden: red marks wet-edge discard, green marks a selected depth behind the opaque surface, and blue shows projected ground foam density. `swashGroundSupport` shows the beach-bed mask in red, foam-field coverage in green, and ground wet coverage in blue. Both bypass wet-edge clipping and draw at the ground depth where the beach-bed mask is valid. Use them to distinguish a missing mesh from rejected shading support; they intentionally reveal dry carrier pixels.

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

`FFTWaveGenerator` allocates GPU resources and is more suitable for wide ocean surfaces than small pools. Its spectrum is built from three cascades whose sizes follow the wind speed (`getWaveLength` reports them), each with its own `setWaveStrength` / `setWaveCroppiness`; `foamWidth` / `foamContrast` control foam width and contrast. It works on WebGPU and WebGL2 (with half-float color-buffer support); on other devices the water silently falls back to flat - no waves.

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

## Water Interaction

`WaterInteraction`: ripples from something dropped in, the wake behind a hull, the slap of a foot. It is a 2D wave equation integrated on the GPU over a square window of the surface.

```ts
import { WaterInteraction, WaterDisturber } from '@zephyr3d/scene';

const interaction = new WaterInteraction();
interaction.windowSize = 64;   // metres covered by the field
interaction.resolution = 512;  // texels per side, 12.5 cm here
interaction.waveSpeed = 1.5;   // m/s, clamped to what the grid can integrate stably
interaction.damping = 1;       // 1/s
water.interaction = interaction;

// A stone: one impulse. Negative pushes the surface down.
interaction.addImpulse(x, z, 1 /* radius, m */, -0.25 /* peak, m */);

// Things in the water follow a node with a sphere, capsule or box footprint.
const hull = new WaterDisturber(boatNode, 'box');
hull.size = new Vector3(1.6, 1, 3.6);
hull.strength = 0.15;
interaction.addDisturber(hull);

const piling = new WaterDisturber(pilingNode, 'capsule');
piling.radius = 0.35;
piling.halfLength = 6;
piling.blocking = true; // waves stop at it and reflect
interaction.addDisturber(piling);
```

A disturber injects the change in the water column its shape displaces since the previous frame. Something at rest leaves the water alone; something moving pushes water down ahead of itself and lets it up behind, which is what a wake is; something dropping in pushes down all over its footprint. A `blocking` disturber is also an obstacle: waves stop at its footprint and reflect off it.

The window follows the water the camera is looking at by default (`followMode: 'camera'`), can follow a node (`'node'` with `followNode`) for a first-person view, or stay put (`'fixed'` with `center`) for a pool or a pond. A band inside the window edge absorbs outgoing waves so the edge never shows; the `interaction` debug output shows the field on its own and dims everything outside the window.

Disturbances also lay down foam - where a shape moves, where a stone lands, along the steep fast crests of the field's own waves - which fades at `foamDecay` and is drawn with the same look as the crest and shoreline foam. `interaction.foamAmount` is the coverage made per second where the water is churned to the full, default 3, and 0 turns this foam off; `foamDecay` (default 0.6, in 1/s) sets how fast it fades.

The field needs a filterable float or half-float render target; `interaction.isOk()` reports whether the device has one, and the water falls back to the wave generator alone when it does not. Tutorial `tut-75` drives a boat through the field and floats a buoy on the result.

### Floating Objects

`WaterSurfaceSampler` batches height queries over a fixed lattice and interpolates between them, so a whole scene of floating objects costs one surface query per batch. `BuoyancyVolume` turns a height function into a buoyant force and torque for a box-shaped hull, independent of what integrates them; `FloatingBody` is a small rigid body around it for applications without a physics library.

```ts
import { WaterSurfaceSampler, FloatingBody } from '@zephyr3d/scene';

const sampler = new WaterSurfaceSampler(water, { spacing: 2, cols: 25, rows: 25, updateHz: 30 });
const buoy = new FloatingBody({
  node: buoyNode,
  size: new Vector3(1.3, 1.3, 1.3),
  mass: 200,
  submergedFraction: 0.5
});
buoy.reset(10, 4, water.position.y);

app.on('tick', (deltaMs) => {
  const delta = deltaMs / 1000;
  sampler.update(delta);
  const level = water.position.y;
  buoy.update(delta, (x, z) => sampler.sampleWorldYRaw(x, z) - level, level);
});
```

A rigid body should read `sampleWorldYRaw`; the eased `sampleWorldY` is for objects placed directly at the surface height. With a physics library, call `BuoyancyVolume.computeForces()` from its step and apply the force and torque to the body instead.

<div class="showcase" case="tut-75"></div>

Buoyancy sampling excludes all WaterDisturber wakes by default, retaining ambient waves and external addImpulse waves to prevent feedback oscillations. Rendering still includes all waves. Set WaterSurfaceSampler includeDisturbers: true for the complete visual surface. Water.getSurfacePoint queries the complete surface by default; pass false as its fourth argument to exclude wakes. Interaction maintains an additional texture pair and simulation pass for the external field.

## Serialization

`Water` is registered with the serialization system, including its material-related water parameters, the built-in `FBMWaveGenerator` / `FFTWaveGenerator` settings, and its `WaterInteraction` with the disturbers registered on it (each disturber records the persistent id of the node it follows and binds to it when the scene has loaded). This means editor-created water nodes and saved scene water settings can be restored through `loadScene()` or `instantiatePrefab()`.

`GerstnerWaveGenerator` can be used at runtime, but it is not currently one of the registered wave-generator types for serialized water nodes.

If you assign custom textures to the water material, make sure those textures have stable asset ids in the `ResourceManager` before serializing.

## Performance Notes

Use the largest `gridScale` that still gives enough near-camera detail. Keep the water region close to the visible play area, and avoid multiple overlapping ocean-sized water nodes unless each one is required.

- **Small decorative water**: `FBMWaveGenerator` is usually sufficient.
- **Oceans / broad swells**: use `FFTWaveGenerator`, especially when you want foam or folded crests. It allocates several FFT textures and updates every frame; the GPU cost rises quickly with resolution.
- **Low-end hardware**: set `refractionMode` to `offset` to drop the 24 depth reads per pixel.
- **Caustics**: need a shadow-casting directional light, and are on by default. Set `causticsEnabled = false` when you do not want them.
- **Shore waves**: once on, the shore field (the terrain height map in four levels, or the scene SDF) is maintained every frame and the foam field simulated with it. With `shoreWaveHeight = 0` (the default) none of this runs.
- **Refraction blur / directional scattering**: nearly free, and they pull a lot of look from the medium coefficients.
- **Underwater**: costs nothing while the camera is above the surface - the pass is not built into the frame at all. Once submerged it is two full-screen draws, plus `underwaterGodRaySteps` caustic-map samples per pixel when the shafts are on, and the same number of shadow map lookups again when `underwaterGodRayShadow` is. Lower the step count before turning the shafts off.
