# When You Need the Device API

Zephyr3d offers two APIs, and this chapter covers the lower-level one. **If your goal is to build a
3D application, the [Scene API](en/scene-basic.md) is the layer you want and this chapter can be
skipped.**

## How the two APIs relate

```
Your application
   │
   ├─── Scene API    (scene graph, materials, lighting, shadows, animation, post FX)
   │        │
   └────────┴─── Device API   (device, buffers, textures, shaders, draw calls)
                     │
              WebGL / WebGL2 / WebGPU
```

The Scene API is built on the Device API, and the two mix freely: build your scene with the Scene API
while using the Device API to write custom material shaders or insert your own render passes.

## When to read this chapter

- You are **writing your own renderer** and do not want the engine's scene management or pipeline.
- You are **writing a custom material** — material shaders are authored with the Device API's shader
  generator; see [Custom Materials](en/user-material.md).
- You are **writing a custom post-processing effect** or inserting a pass into the pipeline; see
  [Render Graph and Custom Passes](en/rendergraph.md).
- You want **compute shaders** (WebGPU only) for general-purpose GPU work.
- You want to understand how the engine works internally.

If you only need to load models, light them, play animations and add post effects, the Scene API
already wraps all of that and the higher-level interface is less work.

## What this chapter provides

The Device API abstracts WebGL, WebGL2 and WebGPU behind one interface covering most low-level
capabilities:

- **A unified device interface** — the same code runs on all three graphics APIs; see
  [Create Device](en/device.md).
- **Shaders written in JavaScript** — the biggest obstacle to cross-API rendering is that the shader
  languages differ (GLSL vs WGSL). The engine lets you describe shaders in plain JavaScript and
  generates backend-specific code from it: no string concatenation, no piles of `#ifdef`. See
  [Writing Shaders](en/shader.md).
- **Resource management** — [buffers](en/buffer.md), [textures](en/texture.md),
  [render states](en/renderstate.md) and [draw calls](en/drawcall.md).

## Backend capability differences

A unified interface does not mean identical capabilities. When writing cross-backend code:

| Capability | WebGL | WebGL2 | WebGPU |
| --- | --- | --- | --- |
| Compute shaders | No | No | Yes |
| Multiple render targets | Extension required | Yes | Yes |
| Float color buffers | Extension required | Extension dependent | Yes |
| Uniform buffers | No | Yes | Yes |

Query actual capabilities through `device.getDeviceCaps()`. **The engine usually falls back silently
when a capability is missing**, so test cross-backend code on your target devices.

## Suggested reading order

1. [Create Device](en/device.md) — device creation and the render loop
2. [Writing Shaders](en/shader.md) — the longest and most important section of this chapter
3. [Buffers](en/buffer.md) and [Textures](en/texture.md) — preparing resources
4. [Render States](en/renderstate.md) and [Drawing Primitives](en/drawcall.md) — submitting draws
5. [Examples](en/devicesamples.md) — complete runnable code
