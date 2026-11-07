# Tone Mapping

## Overview

**Tone mapping** is the process of converting **High Dynamic Range (HDR)** images into **Low Dynamic Range (LDR)** ones suitable for standard displays.  
Zephyr3D's tone mapping uses a fit of the **ACES (Academy Color Encoding System)** curve for a filmic color response and natural brightness compression.

---

## Properties

- `camera.toneMap`: `boolean` — Enables or disables tone mapping; on by default.  
- `camera.toneMapExposure`: `number` — Controls exposure compensation (brightness level); default `1`.  
- `camera.toneMapDither`: `boolean` — Adds slight dithering to the output, removing the banding that shallow gradients such as bloom halos show once quantized; on by default. Turn it off for pixel-exact captures, or pixel values vary slightly from frame to frame.

Tone mapping goes with HDR rendering (`camera.HDR`, on by default). Turn tone mapping off when HDR is off.

---

## Example

```javascript  
// Enable tone mapping  
camera.toneMap = true;  
// Adjust exposure  
camera.toneMapExposure = 1.5;  
```

> **How exposure is controlled depends on the lighting mode.** The `toneMapExposure` approach above
> applies to the default `legacy` lighting mode. In
> [physical lighting mode](en/lighting-physical.md), exposure is derived from the camera's aperture,
> shutter speed and ISO (the read-only `camera.exposure`), `toneMapExposure` is ignored, and tone
> mapping only applies the ACES curve.

<div class="showcase" case="tut-27" style="width:600px;height:500px"></div>

---

## Summary

Tone mapping ensures that HDR rendering results are accurately compressed for display devices without losing highlight or shadow details.  
The ACES‑based pipeline preserves wide dynamic range and cinematic color fidelity, making it ideal for realistic rendering or filmic visual styles.
