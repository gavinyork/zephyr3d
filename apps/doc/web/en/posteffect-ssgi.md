# Screen Space Global Illumination (SSGI)

SSGI estimates diffuse indirect lighting from screen-space depth, normals, and the previous opaque linear-HDR SceneColor. It stores incoming irradiance; material albedo, metallic and Fresnel remain in the next frame's Lighting/BRDF, so no SceneAlbedo MRT is required.

## Enabling SSGI

Both the camera and the IBL environment must opt in:

```ts
scene.env.light.type = 'ibl';
scene.env.light.allowSSGI = true;
camera.SSGI = true;
```

The camera must use HDR, SSGI intensity must be greater than zero, and the IBL must provide both radiance and irradiance data. The device must also support renderable half-float textures, at least two draw buffers, and a 16-byte-per-sample color-attachment budget. WebGPU uses motion vectors, Hi-Z, historical SceneColor and the full temporal filter. WebGL uses linear marching, IBL miss fallback, spatial filtering and same-pixel depth/normal history validation without the motion-vector temporal filter.

## Quality presets

| Preset | Resolution | Rays/pixel | Max steps | A-trous passes |
| --- | --- | ---: | ---: | ---: |
| `quality` | Full | 2 | 64 | 3 |
| `balanced` | Half | 1 | 48 | 2 |
| `performance` | Half | 1 | 24 | 1 |
| `custom` | Configurable | 1–4 | 1–256 | 0–5 |

```ts
camera.ssgiQualityPreset = 'quality';
```

The `custom` preset exposes trace resolution, SPP, maximum steps and denoise passes independently:

```ts
camera.ssgiQualityPreset = 'custom';
camera.ssgiHalfResolution = true;
camera.ssgiRaysPerPixel = 2;
camera.ssgiMaxSteps = 48;
camera.ssgiDenoisePasses = 2;
```

Changing any custom setting through the API also switches the preset to `custom` automatically.

## Controls

| Property | Default | Purpose |
| --- | ---: | --- |
| `ssgiIntensity` | `0.7` | Strength of screen-space hits relative to IBL; misses preserve IBL |
| `ssgiMaxDistance` | `32` | Maximum view-space trace distance |
| `ssgiThickness` | `0.5` | Depth-intersection thickness |
| `ssgiStride` | `1` | Pixel stride for the linear marcher |
| `ssgiMaxRayIntensity` | `10` | Firefly clamp on screen-space radiance before the control-variate correction |
| `ssgiTemporal` | `true` | Enables temporal accumulation |
| `ssgiTemporalWeight` | `0.94` | Maximum valid-history weight after warm-up |
| `ssgiDepthReject` | `0.5` | Reprojection depth threshold in scene units |
| `ssgiNormalReject` | `0.75` | Reprojection normal-dot threshold |

