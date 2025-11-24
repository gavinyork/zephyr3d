# Camera Post‑Processing

In the Zephyr3D engine, the `Camera` class integrates a flexible **Post‑Processing system** that performs various visual enhancement and compositing effects after the main scene rendering.  
All post‑processing effects are managed internally by a **Compositor**, and can be accessed and controlled directly through the `Camera` instance.  

---

## Overview

Post‑processing effects are applied after rendering the main scene, passing the framebuffer through a series of effect pipelines in sequence.  
Developers can enable or disable each feature as needed and adjust its parameters via corresponding properties.

The `Camera` class provides built‑in support for the following post‑processing effects:

| Post‑Processing Effect | Class Name | Purpose |
|-------------------------|-------------|----------|
| **Tonemapping** | `Tonemap` | Converts HDR results into a standard display color space. |
| **Fast Approximate Anti‑Aliasing (FXAA)** | `FXAA` | Smooths edges and reduces aliasing artifacts. |
| **Temporal Anti‑Aliasing (TAA)** | `TAA` | Uses inter‑frame jitter and accumulation buffers to eliminate high‑frequency noise. |
| **Bloom** | `Bloom` | Simulates a soft glow from bright areas of the image. |
| **Screen Space Reflections (SSR)** | `SSR` | Calculates view‑dependent reflections based on screen‑space data. |
| **Screen Space Ambient Occlusion (SSAO/SAO)** | `SAO` | Enhances contact shadows and spatial depth detail. |
| **Motion Blur** | `MotionBlur` | Simulates blur caused by camera or object motion. |

> Each post‑processing effect can be enabled or configured through the `Camera` properties,  
> such as `camera.bloom = true` or adjusting `camera.bloomIntensity`.
