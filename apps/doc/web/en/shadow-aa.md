
# Shadow Anti-Aliasing

In **Zephyr3D**, real‑time shadows are implemented using **Shadow Maps**.  
Because shadow maps have finite resolution, the edges of shadows may appear **jagged or aliased**,  
especially in large scenes or when using low‑resolution maps.

To achieve smooth and natural shadow edges, several techniques can be used to reduce or eliminate aliasing:

1. **Increase the shadow map resolution**  
2. **Apply filtering methods (PCF, VSM, ESM)**  
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

In the example below:
- The upper half uses a **256‑pixel** shadow map.  
- The lower half uses a **1024‑pixel** shadow map.

<div class="showcase" case="tut-19" style="width:600px;height:800px"></div>

> **Tips:**
> - Higher resolution improves quality but adds GPU overhead.  
> - A size between **1024–2048 px** is usually a good balance between performance and quality.

---

## PCF (Percentage Closer Filtering)

**PCF** is the most common shadow anti‑aliasing method.  
It smooths edges by **sampling multiple nearby texels** in the shadow map  
and averaging their visibility results — essentially a **filtered softening**.

```javascript
// Enable PCF (optimized)
light.shadow.mode = 'pcf';
```

Example:  
The upper half of the screen uses PCF, while the lower half uses standard hard‑edge shadows.

<div class="showcase" case="tut-20" style="width:600px;height:800px"></div>

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

Example: upper half uses VSM, lower half uses standard shadow mapping.

<div class="showcase" case="tut-21" style="width:600px;height:800px;"></div>

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

Example: upper half uses ESM, lower half uses hard shadows.

<div class="showcase" case="tut-22" style="width:600px;height:800px;"></div>

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

Example:

<div class="showcase" case="tut-23" style="width:600px;height:800px;"></div>

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
| **VSM** | Statistical variance smoothing | Stable, noise‑free, supports blur | Possible light bleeding | 🟡 Medium |
| **ESM** | Exponential depth attenuation | Smooth, noise‑free, efficient | Sensitive to tuning | 🟢 High efficiency |
| **CSM** | Multi‑layer shadow maps by distance | High detail near camera | Complex to manage | 🔵 High |

---

By combining these methods appropriately—  
for instance, **PCF/VSM/ESM filtering**, **CSM segmentation**, or **distance limiting**—  
you can achieve a balanced compromise between **shadow quality**, **scene scale**, and **rendering performance**  
in Zephyr3D‑based real‑time rendering.
