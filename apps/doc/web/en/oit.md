# Order‑Independent Transparency (OIT)

## Overview

In a traditional rendering pipeline, **transparent objects must be rendered from back to front**.  
Failing to do so often causes visual artifacts due to incorrect blending order.  
However, in complex scenes—or in situations where depth sorting is difficult  
(such as overlapping particles, water surfaces, or intersecting translucent geometry)—  
this approach introduces significant CPU overhead and may still fail to produce correct results.

To solve this problem, Zephyr3D implements **Order‑Independent Transparency (OIT)** technology.  
OIT allows transparent fragments to be correctly blended **without explicit sorting**,  
achieving a balance between visual quality and rendering performance.

The engine supports three OIT techniques:

1. **Weighted Blended OIT** — a high‑performance, weighted‑average‑based transparency blending method.  
2. **Per‑Pixel Linked List OIT (ABuffer OIT)** — a per‑pixel linked‑list approach with fully accurate depth sorting.  
3. **Dual Depth Peeling OIT** — a layer‑peeling approach whose accuracy and compatibility sit between the two.

> Code on this page is illustrative and omits imports and application setup. See the embedded live
> demo for a complete runnable example.

---

## Weighted Blended OIT

### Principle

**Weighted Blended OIT** is a transparency technique based on **weighted blending**.  
During the fragment shading stage, each fragment’s color and transparency are weighted,  
and all fragments are later composited through weighted accumulation in a post‑processing phase.  

This method requires no fragment sorting or linked‑list construction,  
making it extremely fast and ideal for real‑time rendering, dynamic scenes,  
and resource‑limited platforms such as mobile devices and WebGL environments.

### Pros and Cons

**Advantages:**
- Simple to implement and highly performant.  
- Maintains good visual quality even in complex transparent scenes.  
- Compatible with many post‑processing effects (Bloom, TAA, etc.).

**Disadvantages:**
- Approximate algorithm — not perfectly accurate in all cases.  
- Slight color bias or blending deviation may occur in areas with many overlapping layers.

### Supported Platforms

Supported on **WebGL / WebGL2 / WebGPU** devices.

### Example

```javascript  
// Enable Weighted Blended OIT for the camera to render transparent objects  
camera.oit = new WeightedBlendedOIT();  
```

This approach is suitable for most transparent surfaces such as **glass, water, vegetation, particles**, etc.

> Tip  
> When Weighted Blended OIT is enabled, **manual sorting of transparent objects is not required**.


---

## Per‑Pixel Linked List OIT (ABuffer OIT)

### Principle

**Per‑Pixel Linked List OIT** (also known as **ABuffer OIT**) is a high‑precision transparency technique  
based on per‑pixel linked storage.  
During rendering, a linked list is created for each pixel,  
storing the color and depth information of all transparent fragments hitting that pixel.  
In the composition stage, fragments are precisely sorted by depth and blended,  
producing a perfectly accurate transparency result.

### Pros and Cons

**Advantages:**
- Produces results identical to traditional back‑to‑front rendering order.  
- Maintains full accuracy even in deeply layered transparent scenes.  
- Fully compatible with lighting, reflection, and post‑processing systems.

**Disadvantages:**
- Requires more GPU memory and processing resources.  
- Unsuitable for low‑end or performance‑critical applications.

### Supported Platforms

Available only on **WebGPU** devices.

### Example

```javascript  
// Enable Per‑Pixel Linked List OIT (ABuffer OIT) for transparent rendering  
// The constructor parameter specifies the maximum supported transparency layers per pixel (default is 16)  
camera.oit = new ABufferOIT(20);  
```

> Recommendation  
> For scenes containing a large number of overlapping transparent layers  
> (such as volumetric effects, fog, or glass facades),  
> increase the layer count (e.g., 24 or 32) to achieve better visual quality.  
> Note that higher values will increase memory and performance cost.

---

## Dual Depth Peeling OIT

### Principle

**Dual depth peeling** strips both the nearest and the farthest remaining transparent layer in a
single pass, so each pass resolves two layers. After a number of iterations the accumulated front and
back colors are composited. Unlike ABuffer it needs no per‑pixel linked list storage, and unlike
weighted blending it produces layer‑accurate results.

The layer count comes from the constructor argument; fragments beyond that count are not blended
correctly, so accuracy depends on the number of iterations you allow.

### Supported Platforms

The device must provide multiple render targets (at least 3), per‑target blending, min/max blend
equations and blendable floating‑point color buffers. **WebGL1 does not qualify**; WebGL2 depends on
the implementation, and WebGPU generally supports it.

When those capabilities are missing, `supportDevice()` returns false and transparent geometry
**silently falls back to sorted alpha blending** without raising an error — so verify on your target
platform that it is actually active.

### Example

```javascript
// The argument is the number of peel iterations after the initialization pass; default is 8
camera.oit = new DualDepthPeelingOIT(8);
```

You can also select a mode by string through `camera.oitMode`, where the three techniques map to
`'weighted'`, `'abuffer'` and `'dual-depth'` (`'none'` disables OIT):

```javascript
camera.oitMode = 'dual-depth';
```

---

## Comparing the Modes

The demo below contains several intersecting transparent spheres and a torus whose blend order
changes continuously as they animate. You can switch between all four modes to compare them —
with OIT off, the blend-order artifacts are clearly visible.

The example prefers a WebGPU device and falls back to WebGL2 and then WebGL, showing the active
device type in the UI. **Modes the current device cannot run are greyed out** — ABuffer is
unavailable on WebGL2, for instance.

<div class="showcase" case="tut-67"></div>

---

## Resource Management

When a **camera** is released, its associated **OIT resources** are automatically released as well.  
Manual disposal is generally unnecessary unless you reassign OIT objects explicitly.

---

## Performance and Recommendations

| Technique | `oitMode` | Accuracy | Performance | Supported Platforms | Recommendation |
|------------|-----------|-----------|-------------|---------------------|----------------|
| **Weighted Blended OIT** | `'weighted'` | Approximate | Excellent (high FPS) | WebGL / WebGL2 / WebGPU | Default preferred method |
| **Dual Depth Peeling OIT** | `'dual-depth'` | Layer‑accurate, bounded by peel count | Moderate (slower with more passes) | WebGL2 / WebGPU (capability‑gated) | When weighted is not accurate enough but ABuffer is impractical |
| **Per‑Pixel Linked List OIT** | `'abuffer'` | Precise | High (more GPU memory) | WebGPU | Use when maximum quality is required |

> Recommended Practices:  
> 1. Prefer **Weighted Blended OIT** for the best balance between performance and visual quality.  
> 2. Use **ABuffer OIT** when running on WebGPU with heavy transparent layering.  
> 3. For needs in between, try **Dual Depth Peeling**, keeping in mind that it silently falls back to sorted blending when capabilities are missing.  
> 4. When rendering **transparent instanced geometry**, enable OIT to avoid sorting artifacts.  
> 5. OIT integrates smoothly with **TAA**, **Bloom**, **SSR**, and other post‑processing effects.

---

## Summary

**Order‑Independent Transparency (OIT)** is an essential technology in modern real‑time rendering.  
It eliminates the dependency on rendering order for transparent objects,  
allowing visually correct transparency while maintaining high frame rate and flexibility.

- **Weighted Blended OIT**: performance‑oriented, approximate blending — ideal for most cases.  
- **Dual Depth Peeling OIT**: layer peeling, accuracy bounded by the peel count, silently falls back to sorted blending when unsupported.  
- **ABuffer (Per‑Pixel Linked List) OIT**: quality‑oriented, pixel‑accurate blending — suited for advanced or cinematic scenes.

Through OIT, Zephyr3D achieves an ideal balance of **precision, performance, and usability**  
for all transparency rendering scenarios.
