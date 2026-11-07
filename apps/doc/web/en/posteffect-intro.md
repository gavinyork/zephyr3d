# Camera Post-Processing

The `Camera` class integrates a post-processing chain that runs after the main scene render. Effects are managed by the camera's internal `Compositor`, and the common effects can be enabled directly through camera properties.

## Overview

Post-processing effects read the rendered framebuffer and produce a new image. Most application code should use the built-in camera properties, such as `camera.bloom = true` or `camera.bloomIntensity = 1.2`.

Built-in effects:

| Effect | How to enable | Purpose |
| --- | --- | --- |
| Tonemapping | `camera.toneMap` | Converts HDR scene color to display color |
| FXAA | `camera.FXAA` | Fast edge smoothing |
| TAA | `camera.TAA` | Temporal antialiasing with jitter and accumulation |
| Bloom | `camera.bloom` | Glow from bright areas |
| SSR | `camera.SSR` | Screen-space reflections |
| SSGI | `camera.SSGI` | Screen-space diffuse global illumination using opaque HDR history |
| SSAO/SAO | `camera.SSAO` | Screen-space ambient occlusion |
| Motion Blur | `camera.motionBlur` | Blur from camera or object motion |
| Skin SSS | No switch: enabled automatically when an `SSSMaterial` is drawn (`PostSSS`, WebGPU only) | Skin subsurface scattering; see [Skin and Subsurface Scattering](en/material-skin.md) |
| Color Adjust | `camera.colorAdjust` | Saturation, contrast, hue, and sharpen adjustment |
| Grayscale | `camera.compositor.appendPostEffect(new Grayscale())` | Grayscale conversion for custom compositor chains |

## Camera Properties

The camera owns the commonly used effect instances and appends them to its compositor automatically. Typical usage:

```ts
camera.HDR = true;
camera.toneMap = true;
camera.toneMapExposure = 1.1;

camera.bloom = true;
camera.bloomThreshold = 0.85;
camera.bloomIntensity = 1.2;

camera.FXAA = true;
camera.TAA = true;
camera.motionBlur = true;
camera.motionBlurStrength = 0.5;
```

For custom post-processing chains, use `camera.compositor` and append your own `AbstractPostEffect` instances.
