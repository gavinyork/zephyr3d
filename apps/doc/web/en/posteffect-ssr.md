# Screen Space Reflections (SSR)

## Overview

**Screen Space Reflections** (SSR) is a real‑time reflection technique based on screen‑space data.  
It analyzes **depth and normal information** from the current framebuffer to perform reflection ray tracing on visible pixels, producing high‑quality dynamic reflections.

Unlike traditional **Environment Mapping** or **Planar Reflection**, SSR does not require additional cube maps or reflection cameras.  
It operates purely from data available within the current screen space, making it relatively efficient and allowing **physically accurate real‑time reflections** on arbitrary surfaces.

---

## Basic Setup

### Enable / Disable SSR

- **Interface:** [Camera.SSR](/doc/markdown/./scene.camera.ssr)  
- **Type:** `boolean`  
- **Default:** `false`

Enable or disable the Screen Space Reflection effect.

```javascript  
// Enable SSR effect  
camera.SSR = true;  
```

### Enable HiZ Acceleration

- **Interface:** [Camera.HiZ](/doc/markdown/./scene.camera.hiz)  
- **Type:** `boolean`  
- **Default:** `false`

Enabling **HiZ (Hierarchical Z‑buffer)** can significantly improve the performance of SSR or occlusion computations.  
It uses a hierarchical depth‑pyramid structure to accelerate screen‑space ray tracing and is supported in **WebGL2** and **WebGPU** backends.

```javascript  
// Enable HiZ to improve SSR performance  
camera.HiZ = true;  
```

> When HiZ is enabled, some ray‑tracing parameters (such as `ssrStride` and `ssrMaxDistance`) are automatically ignored.

---

## Surface Properties and Ray‑Tracing Control

### Roughness Control

- **Interface:** [Camera.ssrMaxRoughness](/doc/markdown/./scene.camera.ssrmaxroughness)  
- **Range:** `0.0 ~ 1.0`  
- **Default:** `0.8`

Sets the maximum surface roughness threshold for SSR to apply.  
Only materials with roughness below this value will generate reflections.

```javascript  
// Enable SSR for surfaces with roughness below 0.9  
camera.ssrMaxRoughness = 0.9;  
```

---

### Ray‑Tracing Parameters

#### Step Stride

- **Interface:** [Camera.ssrStride](/doc/markdown/./scene.camera.ssrstride)  
- **Type:** `number`  
- **Default:** `2`

Defines the number of pixels each reflection ray advances per step in screen space.  
Smaller stride = higher accuracy but lower performance.

```javascript  
// Step forward 4 pixels per iteration  
camera.ssrStride = 4;  
```

> Ignored when HiZ acceleration is enabled.

---

#### Iteration Count

- **Interface:** [Camera.ssrIterations](/doc/markdown/./scene.camera.ssriterations)  
- **Type:** `number`  
- **Default:** `120`

Controls the maximum number of ray‑marching iterations per reflection ray.  
The product of *stride × iterations* determines the maximum tracing depth.  
Larger values improve quality but reduce performance.

```javascript  
// Trace each reflection ray up to 200 steps  
camera.ssrIterations = 200;  
```

---

#### Maximum Trace Distance

- **Interface:** [Camera.ssrMaxDistance](/doc/markdown/./scene.camera.ssrmaxdistance)  
- **Type:** `number`  
- **Default:** `100`

Specifies the maximum camera‑space distance that a reflection ray can travel.  
Higher values capture reflections from distant objects but at a performance cost.

```javascript  
// Max trace distance of 500 units  
camera.ssrMaxDistance = 500;  
```

---

#### Thickness Threshold

- **Interface:** [Camera.ssrThickness](/doc/markdown/./scene.camera.ssrthickness)  
- **Type:** `number`  
- **Default:** `0.5`

Defines the intersection thickness threshold to avoid ray penetration errors when detecting surface intersections.

```javascript  
// Adjust intersection thickness threshold  
camera.ssrThickness = 0.2;  
```

---

#### Automatic Thickness Calculation

- **Interface:** [Camera.ssrCalcThickness](/doc/markdown/./scene.camera.ssrcalcthickness)  
- **Type:** `boolean`  
- **Default:** `false`

When enabled, SSR automatically renders a double‑sided depth buffer to estimate the actual thickness of objects.  
It improves precision on complex geometries but increases GPU cost.  
Ignored when HiZ is active.

```javascript  
// Enable automatic thickness calculation  
camera.ssrCalcThickness = true;  
```

---

## Blur and Denoising Control

SSR often produces noisy reflections on rough surfaces or in high‑frequency scenes,  
so blur filtering is used to smooth the results.  
The engine supports Gaussian blur and depth‑aware bilateral filtering.

### Blur Scale

- **Interface:** [Camera.ssrBlurScale](/doc/markdown/./scene.camera.ssrblurscale)  
- **Type:** `number`  
- **Default:** `0.05`

Controls the overall blur radius.  
Larger values result in stronger blur and more detail loss.

```javascript  
camera.ssrBlurScale = 0.03;  
```

---

### Blur Depth Cutoff

- **Interface:** [Camera.ssrBlurDepthCutoff](/doc/markdown/./scene.camera.ssrblurdepthcutoff)  
- **Type:** `number`  
- **Default:** `2.0`

Defines the depth sensitivity used by the bilateral blur filter.  
Smaller values preserve edges more effectively, making the blur appear sharper.

```javascript  
camera.ssrBlurDepthCutoff = 4;  
```

---

### Blur Kernel Size

- **Interface:** [Camera.ssrBlurKernelSize](/doc/markdown/./scene.camera.ssrblurkernelsize)  
- **Type:** `number`  
- **Default:** `17`

Specifies the kernel size used in the blur operation.  
Larger kernels produce smoother results but have greater performance cost.

```javascript  
camera.ssrBlurKernelSize = 5;  
```

---

### Blur Standard Deviation

- **Interface:** [Camera.ssrBlurStdDev](/doc/markdown/./scene.camera.ssrblurstddev)  
- **Type:** `number`  
- **Default:** `10`

Controls the distribution width of the Gaussian weighting curve.  
Higher values create a wider, stronger blur.

```javascript  
camera.ssrBlurStdDev = 4;  
```

---

## Recommended Settings

| Target Effect | Suggested Parameters |
|----------------|----------------------|
| **High‑precision mirror reflection (metal)** | `stride = 2`, `iterations = 120`, `ssrMaxRoughness = 0.3`, disable auto thickness |
| **Soft reflection (water, glass)** | `blurScale = 0.05`, `blurKernelSize = 9`, `blurStdDev = 6` |
| **High‑performance mode (mobile)** | Enable `HiZ`, lower `iterations` to `60`, disable `calcThickness` |
| **High‑quality desktop rendering** | Enable `HiZ`, `blurKernelSize = 17`, `ssrBlurDepthCutoff = 1.5` |

---

## Example Configuration

```javascript  
// Example setup: metallic reflection + denoised blur  
camera.SSR = true;  
camera.HiZ = true;  
camera.ssrMaxRoughness = 0.6;  
camera.ssrIterations = 150;  
camera.ssrThickness = 0.4;  
camera.ssrBlurScale = 0.05;  
camera.ssrBlurKernelSize = 9;  
camera.ssrBlurStdDev = 6;  
```

<div class="showcase" case="tut-49"></div>

---

## Summary

Screen Space Reflections provide real‑time reflective feedback without requiring offline reflection maps or multiple camera passes,  
significantly enhancing realism on materials such as metal, glass, and water.

- SSR offers high‑quality real‑time reflections but is limited to visible screen regions.  
- **HiZ** acceleration and **blur/denoising** allow a balance between visual fidelity and performance.  
- When combined with **TAA**, **Bloom**, and other post‑processing effects, SSR delivers smoother and more believable results.

> It is recommended to enable SSR in scenes with frequent dynamic reflections (such as wet surfaces or realistic interiors)  
> and fine‑tune roughness and blur parameters to achieve the best visual outcome.
