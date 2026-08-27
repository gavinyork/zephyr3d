# Render Graph and Custom Render Passes

Scene rendering is driven by a **frame graph**: each frame first declares which passes are needed and
which resources each one reads and writes, then the executor compiles that, allocates textures and
runs the passes in dependency order.

This is the supported extension point for inserting custom render passes. **If you only want the
built-in post effects, you do not need this page** — properties like `camera.bloom` and `camera.SSR`
already wrap them; see [Post-processing](en/posteffect-intro.md).

Typical reasons to read this page:

- inserting a custom pass (outlines, volumetric light, custom GBuffer processing);
- reading intermediate render products (depth, scene color, Hi-Z) for your own computation;
- implementing a temporal effect that needs resources preserved across frames.

## Pipelines and modules

The frame graph is not written by hand. It is assembled from a **pipeline** (`RenderPipeline`) holding
a sequence of **modules** (`RenderModule`), each contributing its own passes.

The default pipeline is built by `createForwardPlusPipeline()` and contains 13 modules in this order:

| # | Module `type` | Responsibility |
| --- | --- | --- |
| 1 | `SkyUpdate` | Update sky / atmosphere LUTs |
| 2 | `ClusterLights` | Light assignment for clustered lighting |
| 3 | `GPUPicking` | GPU picking |
| 4 | `ShadowMaps` | Render each light's shadow map |
| 5 | `DepthPrepass` | Depth prepass |
| 6 | `ShadowMaskPass` | Screen-space shadow mask |
| 7 | `TransmissionDepthForSSR` | Transmissive depth for SSR |
| 8 | `HiZ` | Build the hierarchical depth buffer |
| 9 | `SSSProfile` | Subsurface scattering profiles |
| 10 | `SceneColorGrab` | Grab scene color for refraction |
| 11 | `LightPass` | Main lighting pass |
| 12 | `SkyPass` | Sky and fog |
| 13 | `CompositeTail` | Post-processing chain and final composite |

These modules are available through `ForwardPlusModules`, e.g. `ForwardPlusModules.LightPass`.

## Giving a camera its own pipeline

When `camera.renderPipeline` is `null` (the default) the shared default pipeline is used. Assigning
your own pipeline changes rendering for that one camera:

```javascript
import { createForwardPlusPipeline, ForwardPlusModules } from '@zephyr3d/scene';

camera.renderPipeline = createForwardPlusPipeline().insertAfter(
  ForwardPlusModules.SkyPass,
  myOutlineModule
);
```

::: warning Do not mutate the shared default pipeline
`getDefaultForwardPlusPipeline()` returns a **globally shared instance**, and changing it affects every
camera using the default. To customise, build a new one with `createForwardPlusPipeline()` or `clone()`
an existing pipeline.
:::

Pipeline editing methods: `append`, `prepend`, `insertBefore`, `insertAfter`, `replace`, `remove`,
`get`, `has`, `clone`.

::: tip Prefer passing the module object rather than a string anchor
These methods accept either a string or a module object as the anchor, and strings are matched against
a module's `type`. Note that the keys of `ForwardPlusModules` are not always identical to the `type` —
`ForwardPlusModules.ShadowMask` has the type `'ShadowMaskPass'`, so `insertAfter('ShadowMask', ...)`
throws "no module with type". **Passing the `ForwardPlusModules.ShadowMask` object avoids the issue
entirely.**
:::

A few rules worth knowing:

- **`type` must be unique within a pipeline**; inserting a duplicate throws.
- `remove()` and `replace()` only **detach** a module without destroying it. Call
  `pipeline.disposeModule(module)` to release it. `pipeline.dispose()` detaches and disposes every
  module it owns.
- A disposed pipeline can no longer be edited.
- `clone()` **throws** for a module that defines `attach`/`detach`/`dispose` but no `clone()`, because a
  stateful module cannot be copied safely. Stateless modules (none of those three callbacks) are shared
  by reference, which is safe.

## Writing a module

`RenderModule` has only three required members:

```typescript
interface RenderModule {
  // Stable identifier used by pipeline editing methods
  readonly type: string;
  // Decide per frame whether this module participates
  prepare(context): { enabled: boolean; requirements?: FrameResourceRequirements };
  // Add passes to the graph and publish outputs
  setup(context): void;
}
```

Optional members: `reads` / `writes` (dependency declarations, below), `attach` / `detach` (called when
a pipeline takes or releases ownership), `dispose` (release owned resources) and `clone` (used by
`RenderPipeline.clone()`).

Returning `{ enabled: false }` from `prepare()` means the module contributes no passes that frame. The
"should this run" decision belongs in `prepare()` rather than `setup()` because module ordering is
resolved before `setup()` runs.

## Declaring dependencies

Modules do not reference each other directly. They communicate through named resources on the
**blackboard**:

```javascript
const myModule = {
  type: 'MyOutline',
  // I need scene color and linear depth
  reads: [
    { resource: FrameResources.SceneColor, version: 'current' },
    { resource: FrameResources.LinearDepth }
  ],
  // I write scene color back
  writes: [FrameResources.SceneColor],
  prepare: () => ({ enabled: true }),
  setup(fg) {
    // ...
  }
};
```

Each `reads` entry may specify:

- `resource` — the blackboard resource key;
- `version` — `'current'` (default, read the current version) or `'final'` (read the final version,
  which **may reorder the module** after that resource's last writer);
- `optional` — false by default. When true the resource is allowed to have no enabled writer.

**These declarations affect actual execution order**, which is not necessarily the order you authored
in the pipeline. Do not rely on authored order for correctness — express dependencies through
`reads`/`writes`.

## The context object

The context passed to `prepare()` and `setup()` carries everything needed to build the frame:

| Field | Purpose |
| --- | --- |
| `graph` | The frame graph being built; call `addPass()` on it |
| `ctx` | The frame `DrawContext`: camera, scene, device, `renderWidth` / `renderHeight`, ... |
| `blackboard` | Named resource registry modules use to pass handles around |
| `renderQueue` | The culled render queue for this frame |
| `history` | Cross-frame history resource manager, **may be null** |
| `ordering` | Ordering-token chain for side-effect passes |
| `backbuffer` | The imported backbuffer handle (the graph sink) |
| `finalFramebuffer` | External framebuffer for this frame, null when rendering to screen |
| `options` | Feature toggles derived from scene/camera state (Forward+ specific) |

Blackboard interface: `get(key)` returns the resource or `null`, `expect(key)` throws when missing,
`has(key)` tests presence, and `set(key, handle)` publishes.

Built-in keys live in `FrameResources`; the common ones are `SceneColor`, `LinearDepth`,
`SceneDepthAttachment`, `SceneNormal`, `SceneRoughness`, `MotionVector`, `HiZ`, `ShadowMask` and
`PresentedColor`, plus several subsurface-scattering entries.

Two deserve attention:

- **`PresentedColor`** — the final presented color. **The last registration becomes the graph sink.**
- **`SceneColorNoFog`** — scene color before height fog is composited. Screen-space passes should read
  this instead of `SceneColor`, because fog along the camera-to-hit ray is unrelated to the path those
  passes integrate; sampling it would tint hits with the fog color and feed back into the next frame.
  It is only published when fog is present and something consumes it.

> The type name `RenderModuleContext` is deprecated in favour of `ForwardPlusModuleContext`. The
> pipeline-agnostic base contract is `RenderContext`.

## Adding a pass

Add passes inside `setup()` with `graph.addPass()`. The `builder` given to the setup callback provides:

| Method | Purpose |
| --- | --- |
| `read(handle)` | Declare a read of a resource |
| `write(handle, options?)` | Write and return a handle to the new version |
| `createTexture(desc)` | Create a transient texture produced by this pass |
| `createFramebuffer(desc)` | Create a graph-managed framebuffer, inferring attachment dependencies |
| `createToken(name?)` | Create a logical ordering token with no resource dependency |
| `sideEffect()` | Mark this pass as non-cullable |
| `setExecute(fn)` | Set the execution callback |
| `addSubpass(name, fn)` | Add an ordered subpass (mutually exclusive with `setExecute`) |

In a `createTexture()` descriptor only `format` is required. The rest are optional: `label`,
`allocationKey` (identity used to prefer the same pooled texture across executions), `sizeMode`
(default `'backbuffer-relative'`), `width` / `height` (scale factors in relative mode, default 1),
`mipLevels` and `arrayLayers`.

**A pass no output depends on gets culled.** If your pass only has side effects (writing to an external
texture, say), call `builder.sideEffect()` to keep it.

::: warning A pass cannot sample and render the same texture
`builder.write(handle)` returns a **new version handle**, but physically it is still the same texture.
So "read sceneColor, process, write back to sceneColor" makes the driver report a feedback loop and
drop the draw. When processing an existing texture, allocate the output with `createTexture()` and
publish that new handle on the blackboard instead.
:::

The execution callback resolves handles into real device objects:

```javascript
builder.setExecute((rgCtx) => {
  const tex = rgCtx.getTexture(someHandle);
  const fb = rgCtx.getFramebuffer(fbHandle);
  // issue the actual draws here
});
```

## A complete module

Here is a complete, runnable example: a module that reads linear depth, detects depth
discontinuities and composites outlines over the scene colour. The module itself
(declarations, `prepare`, `setup`) looks like this:

<<< @/../src/tut-70/main.js{113-186 js}

Key points:

- `reads` / `writes` declare the dependencies the graph uses to place this module;
- `LinearDepth` is reliably published by the depth prepass, yet it is fetched with `get()`
  rather than `expect()` and the module returns early when absent — degrading beats throwing;
- **the output is allocated with `createTexture()` rather than written in place with**
  **`builder.write(sceneColor)`.** A pass cannot sample and render to the same texture:
  `write()` hands back a new version handle, but physically it is still the same texture and the
  driver rejects it as a feedback loop. This is the easiest mistake to make when authoring a pass;
- finally the new handle is `set()` back on the blackboard, so `SkyPass` and `CompositeTail` see
  the outlined result.

Installing it on a camera:

<<< @/../src/tut-70/main.js{217-233 js}

This inserts after `LightPass`, so outlines are drawn before sky and fog are composited. Inserting
after `SkyPass` instead would draw them on top of the sky. Placement depends on which stage of the
image you need to read.

Setting `renderPipeline` back to `null` returns to the default pipeline without the module, which is
how the demo toggles the comparison:

<div class="showcase" case="tut-70"></div>

## Rendering scene geometry in a custom pass

If your pass needs to render scene objects rather than only do fullscreen work, use
`createSceneRenderer()` instead of walking the scene graph yourself — it handles culling, render
queues, and material and lighting bindings correctly.

It is created during **execution**, and needs both the frame's `DrawContext` and the current pass's
execute context:

```javascript
builder.setExecute((rgCtx) => {
  const sr = createSceneRenderer(ctx, rgCtx);
  const fb = rgCtx.getFramebuffer(myFramebufferHandle);

  // Cull into a pass-scoped render queue, optionally filtering drawables
  const queue = sr.cull(ctx.camera, (drawable) => drawable !== someExcludedMesh);

  // Render the whole queue, or just part of it
  sr.renderScene(fb, queue);
});
```

Available render methods: `renderScene()` (opaque plus transparent), `renderOpaque()`,
`renderTransparent()` and `renderDepth()` (linear depth).

A queue from `cull()` is scoped to the current pass and released when it ends. For a queue that should
survive across frames (static geometry whose contents do not change), use `createPersistentQueue()` and
manage its lifetime yourself; `createQueue()` builds a queue manually.

## History resources for temporal effects

Effects that read the previous frame's result (TAA, SSR and SSGI all do) cannot use ordinary transient
textures, because those return to the pool at end of frame. Cross-frame resources are managed by
`HistoryResourceManager`, reached through the context's `history` field:

```javascript
setup(fg) {
  const history = fg.history;   // may be null
  if (!history) {
    return;                      // history resources are unavailable for this camera
  }
  // Import last frame's texture; returns null when size/format are incompatible
  // (right after a resize, for instance)
  const prevHandle = history.importPreviousIfCompatible(
    fg.graph,
    'myEffectHistory',
    desc,
    { width: fg.ctx.renderWidth, height: fg.ctx.renderHeight }
  );
  // Handle the "no history" branch; never assume prevHandle exists
}
```

Both a `null` `history` and a `null` return from `importPreviousIfCompatible()` must be handled —
**resolution changes, camera switches and the first frame all invalidate history**, and this is where
temporal effects most often break.

Built-in history names are defined in `RGHistoryResources` (`taaColor`, `ssrReflect`,
`ssgiSceneColor`, ...). Custom effects should use their own names to avoid clashing.

## See also

- [Post-processing](en/posteffect-intro.md) — the built-in effects, enough in most cases
- [Custom Materials](en/user-material.md) — changing shading without touching the pipeline
- [Multi-view Rendering](en/multi-views.md) — rendering one camera multiple times
