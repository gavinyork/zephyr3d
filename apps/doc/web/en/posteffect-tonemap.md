# Tone Mapping

## Overview

**Tone mapping** is the process of converting **High Dynamic Range (HDR)** images into **Low Dynamic Range (LDR)** ones suitable for standard displays.  
Zephyr3D's tone mapping system uses the **ACES (Academy Color Encoding System)** to ensure physically‑based color response and natural brightness compression.

---

## Properties

- `camera.toneMap`: `boolean` — Enables or disables tone mapping.  
- `camera.toneMapExposure`: `number` — Controls exposure compensation (brightness level).

---

## Example

```javascript  
// Enable tone mapping  
camera.toneMap = true;  
// Adjust exposure  
camera.toneMapExposure = 1.5;  
```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

---

## Summary

Tone mapping ensures that HDR rendering results are accurately compressed for display devices without losing highlight or shadow details.  
The ACES‑based pipeline preserves wide dynamic range and cinematic color fidelity, making it ideal for realistic rendering or filmic visual styles.
