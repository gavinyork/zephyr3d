# Performance Optimization

> Code on this page is illustrative and omits imports and application setup.

This page covers the tools Zephyr3D offers to make an application render faster, load faster and use less memory: **instanced rendering**, **BatchGroup batching**, **texture compression**, **vertex compression** and **mesh levels of detail (LOD)**. For each one it explains what it saves, what it costs or cannot do, and how to use it in the editor and from code.

---

## Instanced Rendering

### What It Does

Meshes that share the same primitive and instances of the same material are drawn together in one instanced draw call instead of one call each. Each mesh still has its own transform and its own material instance values (colors, scalars), which are packed into per-instance data. This cuts the CPU cost of issuing draw calls, which is usually what limits scenes with many repeated objects: vegetation, rocks, props, modular buildings.

Batching is automatic: the render queue groups the visible meshes every frame. A mesh joins a batch when:

- its material is a **material instance**, created with `material.createInstance()`; meshes using the material itself are drawn one by one;
- it shares the **same primitive** and the **same core material** with the other meshes;
- it has no morph targets, and if skinned, at most 4 bone influences per vertex;
- the device is WebGL2 or WebGPU (WebGL1 has no instancing).

### In the Editor

Select a mesh and turn on **Geometry Instance** in its properties: the mesh then uses an instance of its material and joins batches with the other meshes doing the same.

### From Code

```ts
const shape = new BoxShape();
const material = new PBRMetallicRoughnessMaterial();
for (let i = 0; i < 1000; i++) {
  // Same primitive, an instance of the same material: one draw call for all of them
  const mesh = new Mesh(scene, shape, material.createInstance());
  mesh.position.setXYZ(Math.random() * 100, 0, Math.random() * 100);
  // Per-instance values do not break the batch
  mesh.material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
}
```

Loaded models do not use instancing by default. Ask for it when loading:

```ts
const tree = await getEngine().resourceManager.fetchModel('/models/tree.glb', scene, {
  enableInstancing: true
});
```

### Limitations

- The CPU still culls and sorts every mesh every frame. With many thousands of meshes this per-mesh work becomes the bottleneck; use a [BatchGroup](#batchgroup-batching) for them.
- Instances in one batch are drawn in one call, so transparent instances cannot be sorted back to front. Use [order-independent transparency](en/oit.md) for them.
- Per-instance data lives in uniform buffers of 64 KB; a large batch is split into several draw calls automatically.
- Meshes with levels of detail form one batch per level in use, so LOD adds draw calls.

See [Geometry Instancing](en/instancing-intro.md) for more.

---

## BatchGroup Batching

### What It Does

A `BatchGroup` caches the batches of the meshes below it instead of rebuilding them every frame. The CPU no longer culls, sorts or packs each of these meshes per frame; it treats the group as one object. On WebGPU the cached draws are also recorded into render bundles, which replay with almost no CPU cost.

On WebGPU the group additionally works on the GPU (property `gpuInstanceCulling`, on by default):

- **GPU instance culling**: before each view draws, a compute pass removes the instances that view cannot see, for the main camera and for every shadow cascade.
- **GPU level of detail selection**: when the device supports `indirect-first-instance`, the same pass selects the level of detail of each instance, so meshes switching levels do not rebuild the cached batches.

Moving meshes and changing their material instance values update the cached batches in place. The cache is only rebuilt when the group's content changes: meshes added or removed, shown or hidden, or given another primitive or material.

### In the Editor

In the scene hierarchy, right-click a node and choose **Create Batch Group**, then drag meshes under it. For best results the meshes should use **Geometry Instance**, so that they batch with each other.

### From Code

```ts
const group = new BatchGroup(scene);
for (let i = 0; i < 10000; i++) {
  const rock = new Mesh(scene, rockShape, rockMaterial.createInstance());
  rock.parent = group;
  rock.position.setXYZ(Math.random() * 500, 0, Math.random() * 500);
}
// WebGPU: per-instance GPU culling and LOD selection (default true)
group.gpuInstanceCulling = true;
```

### Limitations

- Content changes rebuild the whole group's cache: do not add, remove or hide meshes of a group every frame. Keep frequently changing objects outside batch groups.
- Without GPU culling (WebGL, or `gpuInstanceCulling` off), a visible group draws all of its meshes, including those outside the view. Split very large areas into several groups so whole groups can be culled.
- On WebGL, and for meshes the GPU path does not cover, levels of detail are selected on the CPU per mesh, and a mesh switching level rebuilds the cache; hysteresis keeps this rare.
- GPU level selection has no hysteresis: a mesh right at a switch distance may flip between two levels as the camera moves.

---

## Texture Compression

### What It Does

Textures are usually the largest part of both the download and GPU memory. Compressed textures stay compressed on the GPU: a block-compressed texture takes a quarter to an eighth of the memory of RGBA8 and needs correspondingly less bandwidth when sampled, which also speeds up rendering. Zephyr3D uses **KTX2** files encoded with **Basis Universal**: one file serves every device and is transcoded at load time to the best format the GPU supports (BC7 or BC1/BC3 on desktop, ETC2 or ASTC on mobile, RGBA8 as the last resort).

| Storage format | Use |
| --- | --- |
| ETC1S | Smallest files; color textures |
| UASTC | Highest quality; normal maps, masks, packed channels |

### In the Editor

- When importing a model, check **Compress Textures**.
- For textures already in the project, right-click them in the Content Browser and choose **Texture Settings...**: set the usage, the compression (**Auto** picks ETC1S for color and UASTC for normals and masks), the quality, a maximum size and mipmaps.

The editor encodes in the background, previews the compressed result in the viewport, and builds ship the KTX2 copies. See [Asset Compression](en/editor/asset-compression.md).

### From Code

Load KTX2 files like any other texture; encode them beforehand with tools such as `basisu` or `toktx`:

```ts
const albedo = await getEngine().resourceManager.fetchTexture('/textures/rock-albedo.ktx2');
const normal = await getEngine().resourceManager.fetchTexture('/textures/rock-normal.ktx2', {
  linearColorSpace: true
});
```

glTF models with `KHR_texture_basisu` load their KTX2 textures automatically. Editor builds are served through the asset manifest, so code loading `/assets/rock.png` gets the compressed copy unchanged; see [Asset Loading](en/asset-loading.md).

### Limitations

- Compression is lossy; ETC1S shows block artifacts on gradients and on normal maps. Choose the usage and format per texture.
- Transcoding happens at load time in a web worker; the transcoder is downloaded the first time a KTX2 texture loads.
- The editor compresses PNG, JPEG and WebP only; TGA, HDR and EXR ship as they are.
- Two-channel normal map formats (BC5, EAC RG) are not used yet.

---

## Vertex Compression

### What It Does

Vertex compression shrinks mesh files, and with quantized attributes the vertex buffers on the GPU as well:

- The editor stores meshes as binary `.zmsh` files compressed with **meshopt**, with normals and tangents octahedral-encoded to 8 or 16-bit integers, vertex colors and skin weights to 8 bits. Smaller vertices take less GPU memory and less bandwidth when drawn.
- At runtime the glTF importer reads `EXT_meshopt_compression` / `KHR_meshopt_compression`, `KHR_draco_mesh_compression` and `KHR_mesh_quantization`.

### In the Editor

- When importing a model, check **Compress Vertices**.
- For meshes already in the project, right-click `.zmsh` files and choose **Mesh Settings...**, then set **Compression** to **meshopt** and pick the **Normal Precision** (12 bit by default, visually exact).

### From Code

Compress glTF files with tools such as `gltfpack` (meshopt and quantization) or `gltf-transform` (Draco or meshopt), then load them as usual; the decoders ship with the engine:

```ts
const model = await getEngine().resourceManager.fetchModel('/models/city.glb', scene);
```

### Limitations

- Decoding costs CPU time at load, in proportion to the mesh size; meshopt decodes much faster than Draco.
- Draco only reduces the download: its data is decoded to full precision. GPU memory only shrinks with quantized attributes (`KHR_mesh_quantization`, or the editor's meshopt encoding).
- The editor does not quantize positions and texture coordinates.
- 8-bit normals show on smooth, low-polygon surfaces; keep the 12-bit default unless memory matters more.

---

## Mesh Levels of Detail (LOD)

### What It Does

A mesh with levels of detail switches to simplified versions of itself as it gets smaller on screen, so distant objects cost fewer triangles and vertices, in the main view and in shadow maps alike. Levels are index ranges over the mesh's own vertices: skinned meshes and morph targets keep working at every level.

### In the Editor

- When importing a model, check **Generate LODs** and set **Min Triangles**, **Triangles Per Level** and **Pixel Error**.
- For meshes already in the project, open **Mesh Settings...** and turn on **Generate LODs**. Levels are generated in the background and shipped in the build.
- Shape assets (spheres, boxes, ...) have **GenerateLODs** among their properties.
- Mesh nodes have **ForcedLod** and **MinLod** to pin or limit levels.

### From Code

```ts
// Generate levels while loading a model
const model = await getEngine().resourceManager.fetchModel('/models/tree.glb', scene, {
  generateLods: true // or { lodMinTriangles: 200, lodReduction: 0.5, lodPixelError: 8 }
});

// Shapes generate levels along with their geometry
const sphere = new SphereShape({ radius: 1, verticalDetail: 32, horizonalDetail: 64, lod: {
  lodMinTriangles: 100, lodReduction: 0.5, lodPixelError: 8
} });

// Switch to coarser levels sooner on low-end devices
camera.lodDistanceScale = 2;
```

See [Levels of Detail](en/mesh-lod.md) for `SharedModel.generateLods`, setting levels by hand, and the debug views.

### Limitations

- LOD reduces triangles, not memory: all levels stay loaded, and the indices of every level are added.
- Levels switch directly, without a cross-fade, so a switch can pop visibly; if it shows, lower Pixel Error or `camera.lodDistanceScale` so levels switch farther away.
- Simplification ignores bone weights and does not reduce the bone count.
- Only triangle list meshes get levels. Generating at load time runs on the main thread and takes time for large models; prefer generating in the editor, which ships the levels with no load-time cost.
- Instanced meshes form one batch per level in use, so more draw calls; in a BatchGroup on WebGPU, levels are selected per instance on the GPU instead.

