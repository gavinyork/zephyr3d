# Backend Support

> Code on this page is illustrative and omits imports and application setup.

Zephyr3D has two rendering backends: **WebGPU** and **WebGL2** (WebGL1 is no longer supported). Most features look the same on both. Some depend on compute shaders, storage buffers or indirect draws and are only available on WebGPU; on WebGL2 they degrade or switch off. This page lists every such feature and what it actually does on WebGL2, so you can weigh the trade-offs before settling on a target backend.

## Choosing and Detecting the Backend

[Your First Application](en/first-app.md) shows how to prefer WebGPU and fall back to WebGL2. At runtime, check the device type:

```ts
const isWebGPU = getDevice().type === 'webgpu';
```

When a feature from the table below that changes the picture is turned on under WebGL2, the engine logs a console warning, once per feature, in this form:

```
[zephyr3d] A-buffer OIT (Camera.oitMode) requires WebGPU; transparent objects fall back to sorted alpha blending.
```

Such a warning means the frame differs from WebGPU, and says why.

## Features That Look Different on WebGL2

| Feature | Turned on by | On WebGL2 |
| --- | --- | --- |
| A-buffer OIT | `camera.oitMode = 'abuffer'` | Falls back to distance-sorted alpha blending |
| Dual depth peeling OIT | `camera.oitMode = 'dual-depth'` | Depends on the device: works with `OES_draw_buffers_indexed` and `EXT_float_blend`, otherwise falls back to sorted blending |
| Screen-space subsurface diffusion | Using `SSSMaterial` | No diffusion, skin is lit without it; **transmission still applies** |
| Caustics on scene depth | `WaterMaterial.causticsSceneDepth` (on by default) | Caustics are projected onto the flat plane at `causticsDepth` and do not follow the bed |
| Terrain runtime virtual texture | `terrain.runtimeVirtualTexture = true` | Has no effect (reads back `false`); the terrain is shaded directly every frame |
| Procedural grass blades | `GrassRenderer.addLayer(..., 'blade')` | Blade layers are not drawn; card grass is unaffected |
| Deep opacity map (DOM) shadows | `light.shadow.mode = 'dom'` | Uses `'pcf'` instead |
| Hair strands | `Hair` node | Not drawn; the node and its data are kept |
| Hair strand dynamics | `hair.simulationEnabled = true` | Not simulated, strands stay in their rest pose (the hair itself is not drawn on WebGL2 either) |
| GPU cloth | `GPUClothComponent` | The cloth does not move; the component's `disabledReason` also says why |
| Render graph GPU timing | Render graph profiling | Every scope reports status `'unsupported'` |

`new VirtualTexture()` is the one that throws: it is a low-level object you create explicitly, and there is nothing on WebGL2 to fall back to.

## Fallbacks That Only Cost Performance

These run on the CPU or by other means on WebGL2. **The picture is the same as on WebGPU**, only slower, so they do not warn:

| Feature | WebGPU | WebGL2 |
| --- | --- | --- |
| `BatchGroup` instance culling and per-instance LOD (`gpuInstanceCulling`, on by default) | Per-instance culling and LOD selection on the GPU | Whole batches culled on the CPU, one batch per LOD level |
| Animation bank palette evaluation (`AnimationBankTrack`, `evaluation: 'auto'`) | Compute pass | CPU |
| Card grass placement | GPU | Generated per tile on the CPU |
| Grass occlusion culling (`GrassRenderer.occlusionCulling`) | Active | Inactive (card grass is placed on the CPU on WebGL2 and skips this step) |
| FFT ocean waves, Hi-Z generation | Compute shaders | Fragment shader implementations with identical results |

## Capacity Differences

Clustered lighting works on both backends, with lower limits on WebGL2: at most 255 lights in the scene and 16 per cluster (65535 lights and unbounded per-cluster lists on WebGPU). Beyond that the engine keeps the most significant lights by reach and output and drops the rest silently, without a warning, since the light count can change every frame. If a light-heavy scene must run on WebGL2, check it on WebGL2.

## Limitations and Pitfalls

- **No error does not mean it works.** None of the fallbacks above throws; the scene renders as usual. Check the result on the target backend and watch the console for `[zephyr3d]` warnings.
- **Serialized settings are not rewritten.** A scene saved with `oitMode = 'abuffer'` still reads `'abuffer'` when opened on WebGL2; only the rendering degrades, and the same scene renders as authored on WebGPU.
- Properties marked "WebGPU only" in the editor's property panel degrade in the same way when edited on WebGL2.
