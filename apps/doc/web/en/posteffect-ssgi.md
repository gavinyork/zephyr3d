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

## Frame pipeline

1. LightPass reprojects the previous denoised SSGI irradiance. Invalid depth/normal reprojection falls back to diffuse IBL; specular IBL is unchanged.
2. Cosine-weighted diffuse rays trace the current opaque HDR scene.
3. Hits sample previous SceneColor at `previousHitUV = hitUV - motionVector(hitUV)` and validate the hit surface by depth and normal. Low-confidence hits blend with directional EnvLight radiance; the cosine-weighted estimate is multiplied by π before it is stored as irradiance.
4. Temporal filtering performs depth/normal rejection, neighborhood clipping and luminance-moment accumulation.
5. Variance-guided cross-bilateral a-trous filtering removes residual noise. Half-resolution presets use a joint bilateral upsample.
6. SceneColor, irradiance, surface and moments are committed as independent SSGI histories.

SSGI runs before SSR, transparency, tone mapping, TAA and FXAA. Its histories are independent from TAA and SSR.

## Quality presets

| Preset | Resolution | Rays/pixel | Max steps | A-trous passes |
| --- | --- | ---: | ---: | ---: |
| `quality` | Full | 2 | 64 | 3 |
| `balanced` | Half | 1 | 48 | 2 |
| `performance` | Half | 1 | 24 | 1 |

```ts
camera.ssgiQualityPreset = 'quality';
```

## Controls

| Property | Default | Purpose |
| --- | ---: | --- |
| `ssgiIntensity` | `0.7` | Strength of screen-space hits relative to IBL; misses preserve IBL |
| `ssgiMaxDistance` | `32` | Maximum view-space trace distance |
| `ssgiThickness` | `0.5` | Depth-intersection thickness |
| `ssgiStride` | `1` | Pixel stride for the linear marcher |
| `ssgiMaxRayIntensity` | `10` | Firefly clamp before temporal accumulation |
| `ssgiTemporal` | `true` | Enables temporal accumulation |
| `ssgiTemporalWeight` | `0.94` | Weight of valid history |
| `ssgiDepthReject` | `0.5` | Reprojection depth threshold in scene units |
| `ssgiNormalReject` | `0.75` | Reprojection normal-dot threshold |

All controls are serialized and appear in the editor under `PostProcessing/SSGI` and `Environment/IBL`.

## Limitations

Off-screen, occluded, or invalid historical information cannot produce a screen-space hit and falls back to IBL. Rapid visibility changes, very thin geometry, and large camera cuts may temporarily reduce history confidence.
