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

<div class="showcase" case="tut-51" style="width:600px;height:800px;"></div>

---

## Summary

TAA provides stable and smooth image quality by reusing temporal information between frames.  
It greatly reduces flickering and aliasing in motion and is ideal for high‑quality real‑time rendering when combined with post‑effects such as **Bloom** and **SSR**.
