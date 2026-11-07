# Temporal Anti‑Aliasing (TAA)

## Overview

**Temporal Anti‑Aliasing (TAA)** is a time‑based anti‑aliasing algorithm that reduces jagged edges and shimmering by accumulating information across multiple frames.  
It uses sub‑pixel jittering and temporal feedback to combine previous frame data, effectively smoothing the image while maintaining detail.

---

## Properties

- `camera.TAA`: `boolean` — Enables or disables TAA.  
- `camera.TAADebug`: `number` — Debug flag used for implementation‑specific visualization or testing.

---

## Example

```javascript  
// Enable TAA anti‑aliasing  
camera.TAA = true;  
```

<div class="showcase" case="tut-51" style="width:600px;height:500px"></div>

---

## Material-side Controls

How much history TAA keeps for a pixel is decided by the material drawn there. `MeshMaterial` has these properties:

| Property | Default | Effect |
| --- | --- | --- |
| `TAAStrength` | `15/16` | **The share of history kept**, 0–1. The current frame weighs at least `1 - TAAStrength`. Higher is smoother but trails more in motion; 0 uses no history at all, so the jitter shows as is |
| `TAADisabled` | `false` | Keeps the material out of TAA accumulation entirely |
| `transparentMotionVector` | `false` | Lets a blended (translucent) material write motion vectors. Right for geometry that owns its pixels, such as hair and foliage cards; leave it off for truly see-through surfaces such as glass, where the background's motion should win |
| `alphaDither` | `false` | With alpha clipping on, uses frame-varying dithered coverage to emulate soft transparency, which TAA averages into translucency |

## Limits and Pitfalls

By symptom:

- **Moving objects trail**: lower the material's `TAAStrength`; for translucent objects without motion vectors, consider `transparentMotionVector`.
- **The image jitters or flickers with TAA on**: check whether the material's `TAAStrength` has been set very low (at 0 the per-frame sub-pixel jitter shows directly).
- **Translucent edges smear and follow the background**: translucent objects write no motion vectors by default, so TAA reprojects them with what is behind. Turn on `transparentMotionVector` for hair and foliage cards.

`camera.TAADebug` shows intermediate results: 0 off, 1 current color, 2 history color, 3 their difference, 4 off-screen reprojection, 5 final blend weight, 6 motion vectors, 7 the materials' TAA strength.

## Summary

TAA provides stable and smooth image quality by reusing temporal information between frames.  
It greatly reduces flickering and aliasing in motion and is ideal for high‑quality real‑time rendering when combined with post‑effects such as **Bloom** and **SSR**.
