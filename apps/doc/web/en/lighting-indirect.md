
# Indirect Lighting

This page covers ambient lighting (IBL and hemispheric light) and DDGI, dynamic diffuse global illumination from scene geometry.

> Code on this page is illustrative and omits imports and application setup. See the embedded
> live demos for complete runnable examples.

In **Zephyr3D**, a scene supports only a single **ambient light source**,  
which simulates indirect illumination from the surrounding environment.

The ambient light is configured through `scene.env.light`,  
and its type is defined by the property `scene.env.light.type`.

Available types include:

| Value | Description |
|:--------|:------------|
| `'ibl'` | *Image-Based Lighting*, suitable for PBR materials |
| `'hemisphere'` | *Hemispheric Sky Light*, a simplified ambient lighting model |
| `'none'` | No ambient lighting |

The default value is `'ibl'`.  
If set to `'none'`, the scene disables all ambient lighting, leaving only direct lighting sources (e.g., directional or point lights).

---

## IBL (Image-Based Lighting)

**Concept Overview:**

IBL uses the scene's sky as the light source, integrating it over the spherical domain and  
pre‑calculating the *radiance* and *irradiance* distributions used in PBR shading.  
It provides realistic environmental reflections and energy exchange between objects and their surroundings.

**IBL Characteristics:**
- Designed for **PBR materials**;
- Simulates realistic environmental reflection and diffuse lighting;
- The light source is the current sky: both skyboxes and atmospheric scattering skies can drive IBL;
- With the scattering sky, the lighting is re-baked automatically when the sun direction or color changes, so ambient light follows the time of day.

**Setup Procedure:**

1. Set `scene.env.light.type = 'ibl'` (this is the default);  
2. Set the sky type; `scene.env.sky.skyType` must not be `'none'`:
   - `'scatter'`: atmospheric scattering sky. No texture needed; the lighting follows the sun direction in real time;
   - `'skybox'`: skybox. Requires a cube map, loaded directly or converted from an HDR panorama.

The scattering sky needs no assets at all:

```javascript
scene.env.sky.skyType = 'scatter';
scene.env.light.type = 'ibl';
```

For a skybox, the example below converts an HDR panorama into a cube map and uses it as the skybox:

```javascript
// Load an HDR panorama and create IBL lighting
getEngine().resourceManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr')
  .then(tex => {
    // Create a cube map (512x512, RGBA16F precision)
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);

    // Convert panorama (equirectangular projection → cube map)
    panoramaToCubemap(tex, skyMap);

    // Configure skybox
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;

    // Enable Image-Based Lighting
    scene.env.light.type = 'ibl';
  });
```

> **Notes:**
> - IBL requires a *sky source* to evaluate environment reflections,  
>   meaning `scene.env.sky.skyType` must **not** be `'none'`.  
> - Commonly used with **PBRMetallicRoughnessMaterial**.  
> - Swapping the skybox texture, or moving the sun under the scattering sky, updates the ambient lighting accordingly.

The example below lets you toggle IBL ambient lighting with the buttons in the top-left corner.

<div class="showcase" case="tut-14" style="width:600px;height:500px;"></div>

---

## HemisphericLight

**Concept Overview:**

A *Hemispheric Light* is a simplified approximation of natural ambient illumination.  
It assumes objects receive blueish diffuse light from the **sky hemisphere** above,  
and reflected grayish or brownish light from the **ground** below.  
The resulting ambient color is determined by interpolating between the two colors based on each surface normal’s orientation.

This method is easy to compute and real‑time friendly,  
ideal for non‑PBR materials or performance‑sensitive scenes.

**Usage:**

```javascript
// Set ambient light type to Hemispheric
scene.env.light.type = 'hemisphere';

// Define sky color (ambientUp): bluish tone for upper hemisphere
scene.env.light.ambientUp = new Vector4(0.3, 0.6, 1.0, 1.0);

// Define ground color (ambientDown): grayish tone for ground reflection
scene.env.light.ambientDown = new Vector4(0.2, 0.2, 0.2, 1.0);
```

> **Tips:**
> - Hemispheric lighting does not rely on a skybox.  
> - It only affects the **ambient** contribution of materials.  
> - For PBR materials, the effect is approximate—use **IBL** for physically accurate reflections.

The example below lets you toggle hemispheric ambient lighting with the buttons in the top-left corner.

<div class="showcase" case="tut-15" style="width:600px;height:500px;"></div>

---

## Disabling Ambient Lighting

If you want the scene to use only direct lighting sources  
(such as directional, point, or spot lights) without environmental contribution,  
you can disable ambient lighting entirely:

```javascript
scene.env.light.type = 'none';
```

After disabling:
- PBR materials will no longer receive environment reflections or irradiance;  
- Non‑PBR materials respond only to direct lighting;  
- The scene will appear with higher contrast—suitable for stylized or spotlight‑focused scenes.

---

## SDF-based DDGI

**Concept Overview:**

The ambient modes above know nothing about scene geometry: corners do not darken, and a red wall does not tint the white wall next to it.
DDGI (Dynamic Diffuse Global Illumination) places probes in the scene, traces probe rays through the scene SDF, and interpolates probe irradiance and visibility on surfaces,
giving diffuse indirect light that follows lights and geometry in real time.
Zephyr3D combines a voxel material field with a multi-level probe clipmap, which suits moving cameras in medium-sized indoor and outdoor scenes.

DDGI adds to `scene.env.light` rather than being one of its types, and also works with `scene.env.light.type = 'none'`.

**Example: Cornell box**

The example below is the classic Cornell box: a roughly 20 m white box with a red left wall and a green right wall, lit only by a rectangular area light on the ceiling.
Ambient light and the sky are off, so everything beyond direct light comes from DDGI. Toggle GI with the buttons in the top-left corner:
with it on, shadows are no longer black, and the blocks and ceiling pick up red and green from the side walls.

The scene is a project built and published in the editor; the page only loads and starts it. SDF and GI are enabled in the scene properties,
and the fields of the walls and blocks were baked to `.zsdf` in the editor with **Mesh Settings > Bake SDF** (see [Mesh and Global SDF](sdf.md)),
so they stream in at run time with no `scene.sdf.bakeField()` call.

```typescript
// Keep the probes running and only scale their light, so switching back is instant
const intensity = scene.gi.intensity > 0 ? scene.gi.intensity : 1;
const setGI = (enabled: boolean) => {
  scene.gi.intensity = enabled ? intensity : 0;
  // ...update the button state
};
btnOff.addEventListener('click', () => setGI(false));
btnOn.addEventListener('click', () => setGI(true));
```

<div class="showcase" case="tut-88"></div>

> The first seconds wait for asset loading, voxelization, and probe convergence; they are not the final image.

**Enable it:**

```ts
scene.sdf.enabled = true;
scene.gi.enabled = true;

scene.gi.probeSpacing = 1;
scene.gi.probeGrid = [32, 16, 32];
scene.gi.probeLevels = 4;
scene.gi.probeRays = 128;
scene.gi.probeBudget = 4096;
```

Enabling `scene.gi` keeps the scene SDF enabled. Only static meshes with a field (a baked asset or `bakeField()`) enter the voxel material field; set `scene.gi.terrainAlbedo` when terrain data does not provide an albedo yet.

**Convergence and quality:**

`probeSpacing` controls near-field detail, `probeLevels` expands coverage, `probeRays` improves per-probe quality, and `probeBudget` controls updates per frame. A higher `probeHysteresis` reduces noise but slows changes. Increase `probeNormalBias` or `probeViewBias` when leakage appears, then verify that the SDF is closed and the scene scale is correct.

Keep `updateMode = 'continuous'` for changing scenes. A converged volume can be saved and frozen:

```ts
const state = await scene.gi.exportProbeState();
scene.gi.importProbeState(state); // imports also select frozen mode
scene.gi.updateMode = 'frozen';
```

> **Limits and diagnostics:**
> - DDGI, the global SDF, and voxel lighting are WebGPU-only; on WebGL2 `scene.gi.enabled` builds no lighting.
> - The first frames wait for SDF streaming, voxelization, and probe convergence.
> - Use `scene.gi.getStats()` and `scene.sdf.getStats()` to inspect support, updates, missing fields, and residency.
> - `atlasSize`, `voxelizeBudget`, and `lightingSlicesPerFrame` are the main memory and update-cost controls.

---

## Summary

| Ambient Type | Characteristics | Suitable Materials | Typical Use | Performance |
|---------------|-----------------|--------------------|--------------|-------------|
| **IBL** | HDR‑based indirect reflection & diffuse lighting | PBR | Realistic / reflective environments | Higher |
| **Hemispheric** | Interpolated upper/lower hemisphere lighting | Lambert / Unlit | Mobile, stylized, or simple scenes | Very High |
| **None** | No indirect lighting, direct lights only | Any | FX, dark scenes, artistic control | Highest |

DDGI can be added on top of any of these for diffuse indirect light that follows scene geometry; it is WebGPU-only and the most expensive.

---

By choosing an appropriate ambient lighting mode,  
you can balance **visual realism** and **performance** effectively within Zephyr3D.
