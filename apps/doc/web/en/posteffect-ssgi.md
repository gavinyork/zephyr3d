# Screen Space Global Illumination (SSGI)

## Overview

**Screen Space Global Illumination** (SSGI) is a real-time technique that simulates indirect lighting effects using screen-space data.  
It analyzes **depth, normals, and scene color** from the current framebuffer to estimate how light bounces between surfaces, adding ambient occlusion and color bleeding effects to create more realistic lighting.

Unlike traditional **Image-Based Lighting (IBL)** alone, which provides static environment lighting, SSGI dynamically captures light bouncing from visible geometry in the scene. This means a red wall can cast a reddish tint onto nearby white surfaces, or bright objects can illuminate their surroundings — all computed in real time from what's visible on screen.

---

## Advantages

- **Dynamic indirect lighting**: Captures light bouncing between surfaces based on their actual colors and positions in the current frame
- **No pre-baking required**: Works with fully dynamic scenes without needing lightmap baking or precomputation
- **Ambient occlusion**: Naturally darkens areas where geometry blocks ambient light
- **Color bleeding**: Surfaces pick up color tints from nearby objects, enhancing realism
- **Performance**: Relatively efficient compared to full ray-traced global illumination

---

## Limitations

- **Screen-space only**: Can only use information visible in the current frame — objects outside the view or behind the camera cannot contribute lighting
- **Missing geometry**: Occluded or off-screen surfaces don't affect the result, which can cause lighting to "pop" as the camera moves
- **Limited ray distance**: Traces are limited to a maximum distance to maintain performance, so large-scale indirect lighting may be incomplete
- **Noise and artifacts**: The technique uses sampling and approximations, requiring temporal and spatial filtering to reduce noise
- **Performance cost**: Still computationally expensive compared to static IBL, requiring careful tuning for different hardware

---

## Enabling SSGI

Both the camera and the IBL environment must opt in:

```ts
scene.env.light.type = 'ibl';
camera.SSGI = true;
```

The camera must use HDR, SSGI intensity must be greater than zero, and the IBL must provide both radiance and irradiance data. The device must also support renderable half-float textures, at least two draw buffers, and a 16-byte-per-sample color-attachment budget. 

<div class="showcase" case="tut-68"></div>

**Backend differences:**
- **WebGPU**: Uses motion vectors, Hi-Z acceleration, historical scene color and full temporal filtering for higher quality
- **WebGL**: Uses linear ray marching with spatial filtering and same-pixel history validation

---

## Quality Presets

| Preset | Resolution | Rays/pixel | Max steps | Denoise passes |
| --- | --- | ---: | ---: | ---: |
| `quality` | Full | 2 | 64 | 3 |
| `balanced` | Half | 1 | 48 | 2 |
| `performance` | Half | 1 | 24 | 1 |
| `custom` | Configurable | 1–4 | 1–256 | 0–5 |

```ts
camera.ssgiQualityPreset = 'quality';
```

The `custom` preset exposes trace resolution, samples per pixel (SPP), maximum steps and denoise passes independently:

```ts
camera.ssgiQualityPreset = 'custom';
camera.ssgiHalfResolution = true;
camera.ssgiRaysPerPixel = 2;
camera.ssgiMaxSteps = 48;
camera.ssgiDenoisePasses = 2;
```

Changing any custom setting through the API automatically switches the preset to `custom`.

---

## Controls

| Property | Default | Purpose |
| --- | ---: | --- |
| `ssgiIntensity` | `0.7` | Strength of screen-space indirect lighting relative to IBL. Controls how much SSGI affects the final image |
| `ssgiSkyOcclusion` | `1` | How much occluding geometry blocks environment light. `1` is full physical occlusion; lower values reduce darkening |
| `ssgiMaxDistance` | `32` | Maximum view-space trace distance. Larger values capture more distant bounces but cost more performance |
| `ssgiThickness` | `0.5` | Depth intersection thickness for ray hits |
| `ssgiStride` | `1` | Pixel stride for linear ray marching (WebGL only) |
| `ssgiMaxRayIntensity` | `10` | Clamps overly bright samples to reduce firefly artifacts |
| `ssgiTemporal` | `true` | Enables temporal accumulation to reduce noise |
| `ssgiTemporalWeight` | `0.94` | Maximum history weight for temporal filtering after stabilization |
| `ssgiDepthReject` | `0.5` | Depth threshold for rejecting invalid temporal reprojection |
| `ssgiNormalReject` | `0.75` | Normal similarity threshold for temporal reprojection |

---

## Performance Tips

- Start with the **`balanced`** preset and adjust from there
- Use **half resolution** (`ssgiHalfResolution = true`) for significant performance gains with minimal visual loss
- Enable **Hi-Z** (`camera.HiZ = true`) on WebGPU for faster ray tracing
- Reduce `ssgiRaysPerPixel` if you have strong temporal filtering
- Lower `ssgiMaxSteps` in scenes with simple geometry or limited depth complexity
