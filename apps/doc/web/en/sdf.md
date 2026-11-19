# Mesh and Global SDF

A signed distance field stores, at every point, the distance to the nearest mesh surface, negative inside. Zephyr3D uses it for probe GI (DDGI), shore waves and water interaction, debug visualisation (`renderSceneSDFView()`, `SDFDebugMaterial`), and spatial queries in custom materials (`ShaderHelper.declareSceneSDF`). Shadows from direct lights do not use the SDF; they still come from shadow maps. The SDF system is off by default, and the global field that all of these read is built with compute shaders, so it requires WebGPU.

## A runnable example

The example below builds a few shapes in code, bakes their fields at run time and toggles the distance field debug view with the **Distance field** switch: on, the frame shows the global SDF itself; off, it shows the normally rendered scene. The panel lists the live counters of `scene.sdf.getStats()`. WebGL2 has no global field, so the switch is disabled there (see [Limits](#limits)).

<div class="showcase" case="tut-93"></div>

Turn the field on first:

<<< @/../src/tut-93/main.js#enable

Once enabled, the scene tracks every mesh whose `sdfMode` resolves to something other than `none` and streams the fields of those within `scene.sdf.streamRadius` of the camera (default 256 units) into a shared half-float atlas, nearest first, uploading at most `scene.sdf.uploadBudget` bytes per frame (default 4 MB). The atlas is 512×256×256 voxels (about 64 MB) by default; this scene needs far less, so it sets `atlasSize` smaller.

Meshes imported in the editor read their fields from baked `.zsdf` files (see [Bake in the editor](#bake-in-the-editor)). Shapes built in code have none, and a mesh without a field takes no part in the field. The example bakes them at load:

<<< @/../src/tut-93/main.js#bake

`scene.sdf.bakeField(primitive, options)` reads the primitive's full-detail triangles back from the GPU, bakes the field on the CPU (on the main thread) and hands it to `scene.sdf.setField()`. Call it once per primitive, never per frame. The field is stored in the primitive's local space and keyed by the primitive, so every mesh drawing that primitive, in any scene, shares it: the four pillars in the example cost one field. A field given at run time takes precedence over a baked `.zsdf`.

The options are those of `bakeMeshSDF`: `resolutionScale` (default 1), `unitScale` (world units one local unit spans, default 1), `twoSided` (thin open surfaces such as leaves or sails, default false), plus `signSamples`, `padding`, `maxResolution` and `minResolution`. To keep a large bake off the main thread, read the triangles with `readPrimitiveTriangles()`, run `bakeMeshSDF()` in a worker and pass the result to `setField()`:

```ts
scene.sdf.setField(primitive, sdfData); // sdfData: MeshSDFData from bakeMeshSDF()
```

### The distance field debug view

The debug view is drawn by `renderSceneSDFView()` (from `@zephyr3d/scene`), the same function behind the editor's **View > Distance Field**. It is called after the camera has rendered the scene; the example calls it from the render layer's `afterRender` hook (see [Render layers and render order](en/first-app.md#render-layers-and-render-order)):

<<< @/../src/tut-93/main.js#view

From the camera, it sphere-traces the global field for every pixel and overwrites the whole frame: pixels that hit a surface are grey, those that miss are blue, and both brighten with the number of tracing steps, so grazing silhouettes glow. Dynamic meshes are drawn too. Because it traces the global field rather than the meshes, the view shows exactly the geometry that DDGI, shore waves and the other users see: meshes without a field do not appear, and objects far from the camera, in the coarser levels, turn blobby.

The third argument selects the view mode. `'distance'` only needs the SDF; `'albedo'`, `'emissive'`, `'radiance'`, `'skyVisibility'` and `'irradiance'` show the GI voxel scene or probes at the hit point, need `scene.gi` enabled, and fall back to `'distance'` while that data is unavailable. Without a global field (SDF off, or WebGL2) it draws nothing and returns false.

To read the field's values across a plane, give a plane `SDFDebugMaterial`: warm outside geometry and cool inside, an isoline every `isoSpacing` units (default 0.25), a white line on surfaces, and magenta where there is no field to read. Set such a plane to `sdfMode = 'none'`, or it is counted as a participating instance that never becomes ready.

### Static and dynamic

The gold ring is moved by code every frame and set to `dynamic`:

<<< @/../src/tut-93/main.js#ring

With the debug view on, switch **Ring sdfMode** to `auto` or `static` and watch **Bricks last frame**: the clipmap is now rebuilt around the ring on every move. Then set **Brick budget** to 32: the coarse levels use up the budget first, so the finest level falls behind and the debug view keeps an imprint of the ring where it used to be. Untick **Move ring** to let it catch up. `none` removes the ring from the field: it disappears from the debug view while it stays visible in the normal frame.

### Counters

The readout comes from `scene.sdf.getStats()` and the global field's own `getStats()`:

<<< @/../src/tut-93/main.js#stats

`instances` counts the meshes taking part; `assets` the distinct fields they use; `readyInstances` those whose field is in the atlas and uploaded. A code-built mesh counts as an instance before its field is set, but does not become ready until then. `assetsMissing` counts mesh assets with no baked file, and `atlasFull` how often a field did not fit. `pendingUploads` is the number of fields waiting to upload, not a byte count.

## Bake in the editor

When importing a model, enable **Bake Distance Fields** to create a default `.zsdf` for every mesh from that import. The progress dialog shows `Baking distance fields...`. The option only applies to the new meshes of that import.

For an existing `.zmsh`, right-click it in the Content Browser and choose **Mesh Settings...**. Set **SDF Resolution** (the resolution scale), **SDF Unit Scale** (the world units one local mesh unit spans), and **SDF Two Sided** (for open thin surfaces such as leaves, cloth, or terrain skirts) as needed, then click **Bake SDF**. Wait for `Baked ...` before using the field. Re-bake after changing the mesh or settings. `Mesh.sdfMode` selects runtime participation; it does not start a bake.

Mesh field resolution follows world size: by default 20 voxels per world unit (through SDF Unit Scale), and at most 128 voxels per axis including a 2-voxel border (256 above a resolution scale of 1). Very large meshes lose precision as a result; split them into pieces before baking if needed. The same rules apply to `bakeField()`.

## Participation modes

```ts
mesh.sdfMode = 'static';  // buildings and other fixed geometry
mesh.sdfMode = 'dynamic'; // query at the current transform every frame
mesh.sdfMode = 'none';    // exclude the mesh
mesh.sdfMode = 'auto';    // default inference
```

`auto` resolves to `dynamic` for skinned and morphed meshes, and for meshes that, or any of whose ancestors, have a non-static rigid body (dynamic or kinematic) or a character controller; every other mesh resolves to `static`. `mesh.effectiveSDFMode` returns the resolved mode. Hidden meshes and meshes not in the scene take no part.

Static instances are composited into the global field. Dynamic instances stay out of it and are merged when the field is read, each at its current transform; only the 16 dynamic meshes nearest the camera are merged.

Meshes moved by scripts, keyframe animation or code are not covered by these rules, so `auto` resolves them to `static`. Set such meshes to `'dynamic'` yourself, as the example does for the ring.

## The global field

`scene.sdf.global` is a camera-centred, multi-level clipmap, composited on the GPU from the static fields and the terrain (the first `ClipmapTerrain` in the scene). It has 4 levels of 128³ voxels; the finest level has 0.25-unit voxels and spans ±16 units around the camera, and each further level doubles the voxel size and the reach, up to about ±128 units. All sizes are in scene units and are not converted by `scene.metersPerUnit`. Beyond the finest level's window the field is coarser: turn on the debug view in the example and zoom out, and the shapes turn blobby and less exact.

The field is updated in bricks of 8³ voxels: when the camera moves, the bricks that enter a level's window are rebuilt; when a static mesh appears, moves or goes away, the bricks around it are rebuilt in every level. At most `brickBudget` bricks (default 512) are composited per frame, coarsest level first. The global field's `getStats()` reports the bricks composited by the last update (`lastBricks`) and those still waiting (`dirtyBricks`).

<<< @/../src/tut-93/main.js#budget

## Tuning

- `streamRadius` trades atlas residency for coverage: a larger radius leaves fewer meshes without a field but needs more atlas space.
- `uploadBudget` and `brickBudget` trade convergence time for per-frame work: raising them shortens the time the field takes to settle after loading or a fast camera move, at the cost of upload bandwidth and GPU time.
- `atlasSize` sets the voxels per axis of the shared atlas. Fields that do not fit are left out with a warning that names the demand; raise `atlasSize`, lower `streamRadius` or bake at a lower resolution scale. Changing `atlasSize` empties the atlas and uploads again.

## Limits

- Mesh fields need baked `.zsdf` data or a field from `bakeField()`/`setField()`. Transparent areas of a material are not holes in the geometry.
- The global field and everything that reads it (DDGI, shore waves, `renderSceneSDFView()`, `SDFDebugMaterial`, `ShaderHelper.declareSceneSDF`) are WebGPU-only. On WebGL2 the fields still stream into the atlas and `getStats()` reports them, but `scene.sdf.global` is null and nothing reads them. Check `scene.sdf.global` (or `device.type === 'webgpu'`) before relying on it.
- Do not leave moving geometry `static`: every move dirties the bricks around the old and new position in all four levels, which costs brick budget each frame, and when the budget runs short the finer levels keep a stale copy of the mesh.
