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

The engine supports two OIT techniques:

1. **Weighted Blended OIT** — a high‑performance, weighted‑average‑based transparency blending method.  
2. **Per‑Pixel Linked List OIT (ABuffer OIT)** — a per‑pixel linked‑list approach with fully accurate depth sorting.

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

## Resource Management

When a **camera** is released, its associated **OIT resources** are automatically released as well.  
Manual disposal is generally unnecessary unless you reassign OIT objects explicitly.

---

## Performance and Recommendations

| Technique | Accuracy | Performance | Supported Platforms | Typical Use Cases | Recommendation |
|------------|-----------|-------------|---------------------|------------------|----------------|
| **Weighted Blended OIT** | Approximate | Excellent (high FPS) | WebGL / WebGL2 / WebGPU | General transparent objects, water, glass, particles | Default preferred method |
| **Per‑Pixel Linked List OIT** | Precise | High (more GPU memory) | WebGPU | Complex layered transparency, deep alpha blending | Use when maximum quality is required |

> Recommended Practices:  
> 1. Prefer **Weighted Blended OIT** for the best balance between performance and visual quality.  
> 2. Use **ABuffer OIT** when running on WebGPU with heavy transparent layering.  
> 3. When rendering **transparent instanced geometry**, enable OIT to avoid sorting artifacts.  
> 4. OIT integrates smoothly with **TAA**, **Bloom**, **SSR**, and other post‑processing effects.

---

## Summary

**Order‑Independent Transparency (OIT)** is an essential technology in modern real‑time rendering.  
It eliminates the dependency on rendering order for transparent objects,  
allowing visually correct transparency while maintaining high frame rate and flexibility.

- **Weighted Blended OIT**: performance‑oriented, approximate blending — ideal for most cases.  
- **ABuffer (Per‑Pixel Linked List) OIT**: quality‑oriented, pixel‑accurate blending — suited for advanced or cinematic scenes.  
- Proper use and resource handling ensure both reliable and efficient transparency rendering.

Through OIT, Zephyr3D achieves an ideal balance of **precision, performance, and usability**  
for all transparency rendering scenarios.
