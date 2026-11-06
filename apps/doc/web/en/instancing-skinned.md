# Skinned Mesh Instancing

Skinned meshes can participate in geometry instancing. On WebGPU, each instance writes its bone matrices to the shared skin palette atlas and an indirect draw reads the palette for that instance. Many characters can therefore share one mesh while playing different animations.

## Minimal use

Use the same rules as ordinary instancing: instances should share a `Primitive` and material, and use compatible skeleton layouts and skin spaces. Clone the loaded model and give each node its own animation controller:

```ts
const model = await engine.resourceManager.fetchModel('/characters/worker.glb', scene);

for (let i = 0; i < 100; i++) {
  const actor = await model.clone();
  actor.position.setXYZ((i % 10) * 2, 0, Math.floor(i / 10) * 2);
  actor.animationSet.playAnimation(i % 2 ? 'walk' : 'idle');
}
```

Compatible skinned meshes are placed in the render queue's skin instance list. Each instance keeps its own bone palette; the shared primitive is never modified by animation.

## Conditions and cost

- The indirect GPU batching path is WebGPU-only. WebGL2 can still render skinned meshes, but uses the regular instance list.
- Different skeleton layouts, materials, or skin spaces split batches.
- `BatchGroup.gpuInstanceCulling` is enabled by default. Keep it on for large groups that are only partly visible.
- Instancing reduces draw submission overhead, but every instance still updates its bone matrices. Reduce animation frequency or bone count when animation updates dominate.

Skinned meshes can also use Mesh LOD. With `Mesh.sdfMode = 'auto'`, a skinned or morphed mesh is treated as a dynamic SDF instance and is not cached as static global-SDF geometry.

If draw calls do not fall, verify that primitives and materials are shared and that instances use compatible skin spaces. Replacing a primitive, material, or skeleton layout every frame rebuilds the batch.
