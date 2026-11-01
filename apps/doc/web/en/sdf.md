# Mesh and Global SDF

A signed distance field stores the signed distance to the nearest mesh surface. Zephyr3D uses it for water interaction, soft shadows, DDGI, and other spatial queries. The SDF system is off by default; building the global field on the GPU requires WebGPU.

## Enable the scene field

```ts
scene.sdf.enabled = true;
scene.sdf.streamRadius = 256;
scene.sdf.uploadBudget = 4 * 1024 * 1024;
```

When enabled, the scene streams nearby `.zsdf` mesh assets into a shared atlas. The editor creates these files with **Mesh Settings > Bake SDF**. A mesh without a baked field is skipped. Code-created primitives can supply a runtime field with `scene.sdf.bakeField()` or `scene.sdf.setField()`.

Code-created `Primitive` objects can be baked at runtime. This is one-time CPU work; do not call it every frame:

```ts
await scene.sdf.bakeField(primitive, {
  resolutionScale: 1,
  unitScale: 1,
  twoSided: false
});
// Or bind MeshSDFData prepared elsewhere.
scene.sdf.setField(primitive, sdfData);
```

## Bake in the editor

When importing a model, enable **Bake Distance Fields** to create a default `.zsdf` for every mesh from that import. The progress dialog shows `Baking distance fields...`.

For an existing `.zmsh`, right-click it in the Content Browser and choose **Mesh Settings...**. Set **SDF Resolution**, **SDF Unit Scale**, and **SDF Two Sided** as needed, then click **Bake SDF**. Wait for `Baked ...` before using the field. Re-bake after changing the mesh or settings. `Mesh.sdfMode` selects runtime participation; it does not start a bake.

## Participation modes

```ts
mesh.sdfMode = 'static';  // buildings and other fixed geometry
mesh.sdfMode = 'dynamic'; // query at the current transform every frame
mesh.sdfMode = 'none';    // exclude the mesh
mesh.sdfMode = 'auto';    // default inference
```

`auto` resolves skinned, morphed, dynamic-rigidbody, and character-controller meshes to `dynamic`; other meshes resolve to `static`. Static instances are composited into the global field, while dynamic instances remain separate and are queried at their current transform.

## The global field

`scene.sdf.global` is a camera-centred, multi-level clipmap. It composites static fields and terrain incrementally by brick budget:

```ts
const globalSdf = scene.sdf.global;
if (globalSdf) globalSdf.brickBudget = 512;
```

Use `streamRadius` to trade atlas residency for coverage, and `uploadBudget` or `brickBudget` to trade convergence time for per-frame GPU/upload work. `scene.sdf.getStats()` reports resident assets, atlas occupancy, missing fields, and pending uploads.

Mesh fields require baked `.zsdf` data. The global field and features that depend on it are WebGPU-only; WebGL2 can load the scene but does not build the global field. Do not mark moving geometry as `static`, or the clipmap will contain stale occlusion.
