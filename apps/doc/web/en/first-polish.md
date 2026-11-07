# Shadows and Post-processing

Once the scene has objects in it, shadows and post-processing are the two most direct ways to lift
image quality. This page covers getting them working; parameter details and per-effect tradeoffs live
in the dedicated topic pages.

## Enabling shadows

Shadows are controlled from both the light and the mesh side:

<<< @/../src/tut-16/main.js{28-35 js}

- `light.castShadow = true` — makes that light cast shadows. Directional, point, spot and rect lights
  all support it.
- `mesh.castShadow` — controls whether an individual mesh casts a shadow. It **defaults to true**, so
  you normally only set it explicitly to exclude something.

`shadow.depthBias` removes the self-shadowing stripes known as shadow acne. Too small leaves stripes,
too large detaches the shadow from the object (peter-panning), so it needs tuning against your scene
scale.

<div class="showcase" case="tut-16"></div>

If the scene has many shadow casters that never move, register them as static casters so the engine
can cache their shadows instead of recomputing every frame:

```javascript
light.shadow.shadowRegion.addStaticCaster(box);
```

Shadow mode selection (PCF/PCSS/VSM/ESM/CSM), soft-shadow quality and cascade configuration are
covered in [Shadow Anti-aliasing](en/shadow-aa.md).

## Enabling post-processing

Post effects live on the camera, and the common ones are plain property switches:

```javascript
// HDR rendering + tone mapping
camera.HDR = true;
camera.toneMap = true;
camera.toneMapExposure = 1.1;

// Bloom
camera.bloom = true;
camera.bloomThreshold = 0.85;
camera.bloomIntensity = 1.2;

// Anti-aliasing: FXAA is cheap; TAA looks better and is turned on with camera.TAA = true
camera.FXAA = true;
```

**Tone mapping is almost always something you want on.** Lighting is computed in high dynamic range,
and writing that out directly blows out bright areas. It is especially visible with the atmospheric
scattering sky, whose computed luminance far exceeds display range.

<div class="showcase" case="tut-27"></div>

The example above has two buttons that turn tone mapping on and off, so you can compare the two directly.

Per-effect parameters are covered in [Post-processing](en/posteffect-intro.md). For a custom chain,
append your own `AbstractPostEffect` instances to `camera.compositor`.

## Adding ambient light

Scenes have ambient (indirect) lighting by default: `scene.env.light.type` defaults to `'ibl'`, lit every frame from the current sky (the atmospheric scattering sky by default), so no extra texture is needed. Shadowed areas only go pitch black when ambient light is turned off and only direct lights remain.

```javascript
// Default: image-based lighting from the sky; a sky box texture can be used instead, see Indirect lighting
scene.env.light.type = 'ibl';

// Or hemispheric sky light, which is cheaper
scene.env.light.type = 'hemisphere';

// Ambient strength, default 1
scene.env.light.strength = 0.6;
```

The shadow example above (tut-16) turns ambient light off (`scene.env.light.type = 'none'`) to isolate
the contribution of the light itself. **Real projects normally want both direct and ambient lighting.** See
[Indirect lighting](en/lighting-indirect.md).

## A reasonable starting point

Putting it together, a realistic-looking scene can start from this and be tuned from there. The sky type, ambient light type, HDR and tone mapping are already the defaults; they are spelled out to make the intent explicit:

```javascript
// Environment
scene.env.sky.skyType = 'scatter';       // atmospheric scattering sky
scene.env.light.type = 'ibl';            // ambient lighting
scene.env.light.strength = 0.6;

// Main light + shadows
const sun = new DirectionalLight(scene);
sun.lookAt(new Vector3(0, 15, -10), Vector3.zero(), Vector3.axisPY());
sun.castShadow = true;

// Camera post-processing
camera.HDR = true;
camera.toneMap = true;
camera.bloom = true;
camera.FXAA = true;
```

## Next

That completes the getting-started track. From here, go deeper as needed:

- [Basic Framework](en/scene-basic.md) — application lifecycle, input middleware, frame events in full
- [Meshes and Materials](en/mesh-material.md) — manual vertex data
- [Geometry Instancing](en/instancing-intro.md) — material instancing and batching
- [Lighting](en/lighting-intro.md) / [Shadows](en/shadow-intro.md) / [Post-processing](en/posteffect-intro.md)
- [Animation](en/animation-intro.md) — skeletal animation, keyframes, blending and orchestration
- [Using the Editor](en/editor/overview.md) — the visual workflow for authoring assets and scenes
