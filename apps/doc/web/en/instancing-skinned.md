# Skinned Mesh Instancing

Skinned meshes can participate in geometry instancing. On WebGPU, each instance writes its bone matrices to the shared skin palette atlas and an indirect draw reads the palette for that instance. Many characters can therefore share one mesh while playing different animations.

## Minimal use

Use the same rules as ordinary instancing: instances should share a `Primitive` and material, and use compatible skeleton layouts and skin spaces. Clone the loaded model and give each node its own animation controller:

```ts
const model = await getEngine().resourceManager.fetchModel('/characters/worker.glb', scene);

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
- Meshes with morph targets, and meshes with more than 4 bone influences per vertex, are not batched.
- `BatchGroup.gpuInstanceCulling` is enabled by default. Keep it on for large groups that are only partly visible.
- Instancing reduces draw submission overhead, but every instance still updates its bone matrices. Reduce animation frequency or bone count when animation updates dominate.

## GPU animation

The approach above cuts draw calls, but every instance still evaluates its skeletal animation on the CPU each frame. With many characters, turn on `AnimationSet.gpuAnimation` (off by default):

```ts
actor.animationSet.gpuAnimation = true;
```

The playback API and animation events stay the same. While an instance has **exactly one clip active, animating only the joints**, the engine poses it from baked poses instead: each model's clips are baked once and shared by all its instances, on WebGPU the poses are evaluated in a compute pass, and the meshes stay batchable.

Frames that do not meet those conditions fall back to the regular path without a visible jump: cross fades and other blends of clips, skeleton modifiers such as IK and joint dynamics, GPU cloth, and nodes attached below joints (which follow the joint nodes). In the editor, outside play mode, animation always takes the regular path.

Joint nodes are not moved while baked poses play, so code reading joint transforms sees them as they were when the baked poses took over. `animationSet.isPlayingOnGpu` tells whether baked poses are in use.

**Characters whose bones you control are not a fit for GPU animation.**

- An instance whose skeleton has IK, joint dynamics (bone physics) or any other skeleton modifier always takes the regular path and evaluates its bones on the CPU every frame. It is still drawn together with other compatible instances, so draw calls do not grow, but the bone work is not saved, and `gpuAnimation` gains nothing for it.
- Changing joint node transforms directly from code (not through a skeleton modifier) is not detected by the engine. While baked poses play, the meshes do not read the joint nodes, so such changes **silently have no effect**. To control joints from code, either turn `gpuAnimation` off for that instance, or write the control as a `SkeletonModifier` attached with `rig.modifiers.push()` (see [IK](en/animation-ik.md)); the engine then takes the regular path by itself.

## LOD and SDF

Skinned meshes can also use Mesh LOD. With `Mesh.sdfMode = 'auto'`, a skinned or morphed mesh is treated as a dynamic SDF instance and is not cached as static global-SDF geometry.

## Troubleshooting

If draw calls do not fall, verify that primitives and materials are shared and that instances use compatible skin spaces. Replacing a primitive, material, or skeleton layout every frame rebuilds the batch.
