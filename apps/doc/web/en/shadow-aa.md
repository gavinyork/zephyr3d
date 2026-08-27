
# Shadow Anti-Aliasing

> Code on this page is illustrative and omits imports and application setup. See the embedded
> live demos for complete runnable examples.

In **Zephyr3D**, real‑time shadows are implemented using **Shadow Maps**.  
Because shadow maps have finite resolution, the edges of shadows may appear **jagged or aliased**,  
especially in large scenes or when using low‑resolution maps.

To achieve smooth and natural shadow edges, several techniques can be used to reduce or eliminate aliasing:

1. **Increase the shadow map resolution**  
2. **Apply filtering methods (PCF, PCSS, VSM, ESM)**
3. **Use Cascaded Shadow Maps (CSM)**  
4. **Optimize shadow distance and bounding region**

Below you’ll find a detailed explanation of each technique and how to use them in Zephyr3D.

---

## Increasing Shadow Map Resolution

The simplest approach is to increase the **shadow map resolution**.  
Higher resolution provides denser sampling and smoother shadow edges,  
but it also increases memory usage and rendering cost.

You can control the shadow map size through **`light.shadow.shadowMapSize`**:

```javascript
// Set the shadow map resolution in pixels
light.shadow.shadowMapSize = 1024;
```

The example below lets you switch between **256 px** and **1024 px** shadow maps.

<div class="showcase" case="tut-19" style="width:600px;height:500px"></div>

> **Tips:**
> - Higher resolution improves quality but adds GPU overhead.  
> - A size between **1024–2048 px** is usually a good balance between performance and quality.

---

## PCF (Percentage Closer Filtering)

**PCF** is the most common shadow anti‑aliasing method.  
It smooths edges by **sampling multiple nearby texels** in the shadow map  
and averaging their visibility results — essentially a **filtered softening**.

```javascript
// Enable PCF
light.shadow.mode = 'pcf';
```

Parameters:

| Parameter | Description |
|-----------|-------------|
| `pcfKernelSize` | PCF sampling kernel size. Supported values are `3`, `5`, and `7`. Larger kernels produce softer edges, but cost more samples and make shadows blurrier. |

Example: use the buttons to switch between PCF-filtered shadows and standard hard-edge shadows.

<div class="showcase" case="tut-20" style="width:600px;height:500px"></div>

---

## PCSS (Percentage-Closer Soft Shadows)

**PCSS** is a soft-shadow extension of PCF.
It first searches the shadow map for blockers, estimates the penumbra size from the depth difference between the receiver and those blockers,
then applies variable-radius filtering. This keeps contact shadows sharper while making shadows softer as the receiver moves farther from the blocker.

```javascript
// Enable PCSS shadow mode
light.shadow.mode = 'pcss';
```

Parameters:

| Parameter | Description |
|-----------|-------------|
| `pcssLightRadius` | Apparent light radius, measured in shadow-map texels. Larger values create wider penumbrae and softer shadows; `0` mostly collapses the result toward hard filtering. |
| `pcssBlockerSampleCount` | Number of samples used for blocker search, clamped to `1`–`64`. Higher values make blocker estimation more stable, but increase search cost. |
| `pcssFilterSampleCount` | Number of samples used for the final soft-shadow filter, clamped to `1`–`64`. Higher values reduce noise and smooth the edge, but increase fragment shading cost. |
| `pcssMaxFilterRadius` | Maximum filter radius in shadow-map texels. Caps penumbra growth to avoid overly wide shadows and excessive sample coverage. |
| `pcssTemporalJitter` | Rotates the PCSS sampling pattern over frames for TAA accumulation. This can make soft shadows smoother with TAA enabled, but may add slight temporal noise without TAA. |

Example: use the buttons to switch between PCSS soft shadows and hard shadows.

<div class="showcase" case="tut-65" style="width:600px;height:500px"></div>

---

## VSM (Variance Shadow Mapping)

**VSM** reduces aliasing using **statistical variance**.  
Each pixel in the shadow map stores both the **mean** and **mean‑square** of depth values,  
allowing the renderer to compute the **shadow probability** from variance, generating smooth transitions.

```javascript
// Enable VSM shadow mode
light.shadow.mode = 'vsm';
```

**Characteristics:**
- Produces soft, noise‑free shadow transitions;  
- Works well with glossy and reflective surfaces;  
- Supports adjustable blur radius;  
- May suffer from **light bleeding**, which can be mitigated by tuning bias or thresholds.

Parameters:

| Parameter | Description |
|-----------|-------------|
| `vsmBlurKernelSize` | Kernel size of the VSM post blur. Larger kernels produce smoother edges, but increase the blur pass sampling cost. |
| `vsmBlurRadius` | Blur radius for VSM. Larger values widen the transition band; values that are too large can remove contact-shadow detail. |
| `vsmDarkness` | Shadow darkness and light-bleeding suppression for VSM. Higher values make shadows darker and reduce bleeding, but can compress soft transitions. |

Example: use the buttons to switch between VSM shadows and traditional hard-edge shadow mapping.

<div class="showcase" case="tut-21" style="width:600px;height:500px;"></div>

---

## ESM (Exponential Shadow Mapping)

**ESM** models the depth difference using an **exponential decay function**.  
By applying exponential falloff to shadow depth comparisons,  
it generates smooth and stable transitions at shadow boundaries.

```javascript
// Enable ESM shadow mode
light.shadow.mode = 'esm';
```

**Advantages:**
- Produces very soft edge transitions;  
- Little to no noise;  
- Computationally efficient.

**Note:**  
The exponential factor should be tuned per scene  
to avoid overly wide or faint shadow falloff.

Parameters:

| Parameter | Description |
|-----------|-------------|
| `esmDepthScale` | Exponential depth scale. Higher values make falloff steeper, producing sharper and stronger shadows; lower values create wider transitions that can look faint. |
| `esmBlur` | Enables the ESM post blur. When enabled, edges can be softened further; when disabled, the renderer uses the direct exponential shadow result. |
| `esmLogSpace` | Runs ESM blur in log space. This is usually more stable and helps avoid numerical issues from very large or very small exponential values. |
| `esmBlurKernelSize` | ESM blur kernel size, used only when `esmBlur` is `true`. Larger kernels are smoother, but cost more samples. |
| `esmBlurRadius` | ESM blur radius, used only when `esmBlur` is `true`. Larger values create wider, softer shadow edges. |

Example: use the buttons to switch between ESM shadows and hard shadows.

<div class="showcase" case="tut-22" style="width:600px;height:500px;"></div>

---

## CSM (Cascaded Shadow Mapping)

**CSM (Cascaded Shadow Map)** improves shadow precision across large camera frustums  
by dividing the frustum into multiple segments and assigning each one a dedicated shadow map.

How it works:
- Split the camera’s view frustum along depth into several regions (typically 3–4).  
- Render an individual shadow map for each segment.  
- Near segments have higher resolution; far ones are coarser.

**Best used for:**
- Large outdoor scenes and terrains;  
- Third‑person or free‑camera systems requiring stable shadows over distance.

Example: use the buttons to switch between 4-cascade CSM and single-cascade hard shadows.

<div class="showcase" case="tut-23" style="width:600px;height:500px;"></div>

---

## Limiting Shadow Distance

If shadow coverage is too large,  
even CSM may not be able to maintain sufficient detail distribution.  
A common optimization is to **limit the maximum shadow distance**,  
fading shadows smoothly beyond a specified range.

```javascript
// Limit the effective shadow range (world‑space distance)
light.shadow.shadowDistance = 500;
```

Recommended for:
- Large outdoor environments;  
- Improving performance and reducing unused map area;  
- Automatically disabling distant shadows.

---

## Defining Shadow Region

`ShadowRegion` is used to tighten the world‑space coverage of directional light shadow maps.  
The final region used for rendering is `shadowRegion.region`, which is the union of:

- `manualRegion`: the AABB assigned with `setRegion(aabb)`;
- `staticRegion`: snapshots captured from static casters added with `addStaticCaster(node)`;
- `dynamicRegion`: tracked bounds from dynamic casters added with `addDynamicCaster(node)`, rebuilt when their `bvchanged` event fires.

If the final region is empty, directional shadows fall back to the whole scene bounding box.  
Keeping this region tight lets the same shadow map resolution cover less world space, improving edge precision.

```javascript
// Compute the bounding box of all shadow‑casting nodes
const aabb = new AABB();
aabb.beginExtend();

scene.rootNode.iterate((node) => {
  if ((node.isMesh() || node.isClipmapTerrain()) && node.castShadow) {
    const bbox = node.getWorldBoundingVolume()?.toAABB();
    if (bbox) {
      aabb.extend(bbox.minPoint);
      aabb.extend(bbox.maxPoint);
    }
  }
});

// Restrict the shadow map usage to this region
light.shadow.shadowRegion.setRegion(aabb);
```

For objects that do not move, you can add their current world bounds as static snapshots.  
For moving objects, or objects whose bounds can change, use dynamic casters:

`addStaticCaster()` and `addDynamicCaster()` only accept Mesh or ClipmapTerrain nodes; the node still needs `castShadow` enabled to render into shadow maps.

```javascript
const shadowRegion = light.shadow.shadowRegion;

// Static caster: captures the current world-space AABB once
shadowRegion.addStaticCaster(building);

// Dynamic caster: updates ShadowRegion when the node bounds change
shadowRegion.addDynamicCaster(character);

// Remove a single caster, or clear all tracked casters
shadowRegion.removeCaster(character);
shadowRegion.clearCasters();
```

> **Editor Tip:**  
> In the Zephyr3D Editor, the manual AABB of ShadowRegion can be edited visually,  
> allowing precise control over the area that needs directional shadows and reducing wasted shadow map coverage.

---

## Shadow Anti‑Aliasing Method Comparison

| Technique | Core Mechanism | Advantages | Drawbacks | Performance Cost |
|------------|----------------|-------------|------------|------------------|
| **Higher Resolution** | Increase sampling density | Simple and direct | High memory usage | 🟠 Medium |
| **PCF** | Multi‑sample averaging | Easy to use, no extra storage | Slightly blurry edges | 🟡 Medium‑High |
| **PCSS** | Blocker search + variable-radius PCF | Sharp contact shadows with softer distant penumbrae | Many samples, may need TAA for stability | 🔵 High |
| **VSM** | Statistical variance smoothing | Stable, noise‑free, supports blur | Possible light bleeding | 🟡 Medium |
| **ESM** | Exponential depth attenuation | Smooth, noise‑free, efficient | Sensitive to tuning | 🟢 High efficiency |
| **CSM** | Multi‑layer shadow maps by distance | High detail near camera | Complex to manage | 🔵 High |
| **hard** | Single sample, no filtering | Cheapest | Visibly aliased edges | 🟢 Lowest |
| **dom** | Records fractional occlusion through a medium | Soft light bleed for hair and other fine geometry | **WebGPU only**; falls back to `pcf` elsewhere | 🔵 High |

---

By combining these methods appropriately—  
for instance, **PCF/PCSS/VSM/ESM filtering**, **CSM segmentation**, or **distance limiting**—
you can achieve a balanced compromise between **shadow quality**, **scene scale**, and **rendering performance**  
in Zephyr3D‑based real‑time rendering.


> `mode` also accepts `'hard'` (no filtering) and `'dom'` (Deep Opacity Map, for hair — see
> [Hair Rendering](en/material-hair.md)). Two further values, `'pcf-pd'` and `'pcf-opt'`, are
> **deprecated**; use `'pcf'` instead.
>
> `light.shadow.applyQualityPreset(preset)` configures a whole set of parameters at once, with
> `'character-small'` and `'outdoor-large'` available.
