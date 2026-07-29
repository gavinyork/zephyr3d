# Screen Space Global Illumination (SSGI)

SSGI estimates diffuse indirect lighting from screen-space depth, normals, and the opaque linear-HDR SceneColor. It stores incoming irradiance; material albedo, metallic and Fresnel remain in the next frame's Lighting/BRDF, so no SceneAlbedo MRT is required.

A ray reports its outcome as occluded, escaped, or indeterminate. Occlusion and radiance are tracked separately: a hit removes the sky for that direction (see `ssgiSkyOcclusion`) and independently adds the blocker's screen colour as its outgoing radiance, so a hit can never subtract sky without contributing its own bounce. The marcher only ever stops on-screen, so that colour is always available; the screen-border, near-self and backface vetoes that bound reflection artifacts do not apply to diffuse transport and therefore do not gate occlusion. A hit whose reprojection into the previous frame fails falls back to this frame's colour rather than to unoccluded IBL. Rays whose outcome the depth buffer cannot resolve — they left the screen or ran out of iterations behind geometry — are excluded from the average instead of counted as unoccluded sky.

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
| `ssgiIntensity` | `0.7` | Strength of screen-space hits relative to IBL, and the upper bound on how far sky occlusion can darken a pixel; misses preserve IBL |
| `ssgiSkyOcclusion` | `1` | How much environment irradiance an occluding hit removes. `1` is physically complete occlusion; lower values dim the sky less than the geometry implies. Only the removal is scaled — bounce light measured at the hit is always kept, so lowering this brightens without discarding indirect light |
| `ssgiMaxDistance` | `32` | Maximum view-space trace distance |
| `ssgiThickness` | `0.5` | Depth-intersection thickness |
| `ssgiStride` | `1` | Pixel stride for the linear marcher |
| `ssgiMaxRayIntensity` | `10` | Firefly clamp on screen-space radiance before the control-variate correction |
| `ssgiTemporal` | `true` | Enables temporal accumulation |
| `ssgiTemporalWeight` | `0.94` | Maximum valid-history weight after warm-up |
| `ssgiDepthReject` | `0.5` | Reprojection depth threshold in scene units |
| `ssgiNormalReject` | `0.75` | Reprojection normal-dot threshold |

