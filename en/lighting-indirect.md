
# Indirect Lighting

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

IBL computes indirect lighting by integrating an **HDR environment texture** over the spherical domain,  
pre‑calculating the *radiance* and *irradiance* distributions used in PBR shading.  
It provides realistic environmental reflections and energy exchange between objects and their surroundings.

**IBL Characteristics:**
- Designed for **PBR materials**;
- Simulates realistic environmental reflection and diffuse lighting;
- Works with both skyboxes and atmospheric skies as the environment source;
- Supports both precomputed and dynamically updated radiance/irradiance maps.

**Setup Procedure:**

1. Set `scene.env.light.type = 'ibl'`;  
2. Provide an HDR panoramic image for the environment;  
3. Convert the panoramic image into a cube‑map texture;  
4. Set the sky type (e.g. `'skybox'`) and assign the sky texture.

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
> - Both **skybox** and **atmospheric scattering skies** can drive IBL.  
> - Commonly used with **PBRMetallicRoughnessMaterial**.  
> - You can dynamically swap sky textures to achieve environment matching effects.

<div class="showcase" case="tut-14" style="width:600px;height:800px;"></div>

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

<div class="showcase" case="tut-15" style="width:600px;height:800px;"></div>

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

## Summary

| Ambient Type | Characteristics | Suitable Materials | Typical Use | Performance |
|---------------|-----------------|--------------------|--------------|-------------|
| **IBL** | HDR‑based indirect reflection & diffuse lighting | PBR | Realistic / reflective environments | Higher |
| **Hemispheric** | Interpolated upper/lower hemisphere lighting | Lambert / Unlit | Mobile, stylized, or simple scenes | Very High |
| **None** | No indirect lighting, direct lights only | Any | FX, dark scenes, artistic control | Highest |

---

By choosing an appropriate ambient lighting mode,  
you can balance **visual realism** and **performance** effectively within Zephyr3D.
