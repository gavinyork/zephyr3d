# Skinned Mesh Instancing

Skinned meshes are batched like static ones. Instances of a character model that share its primitives and use instances of its materials are drawn in one instanced draw call, and each instance reads its own bone matrices from a texture shared by all skinned meshes, the skin palette atlas. A crowd can therefore play many different animations for a few draw calls, on WebGL2 as well as on WebGPU. Instancing does not reduce the animation work, though: every instance still poses its skeleton on the CPU each frame, unless [GPU animation](#gpu-animation) plays its clips from baked poses.

> The code on this page comes from the runnable example embedded below (`tut-92`), with imports and application setup left out.

## A crowd in code

<div class="showcase" case="tut-92"></div>

The example fills a grid with copies of a Mixamo character, each playing an idle, walk or run clip at its own speed and phase. The list sets the size of the crowd, the first checkbox turns `gpuAnimation` on and off for every actor, and the second puts a hat on one actor in four (see [GPU animation](#gpu-animation)). The panel shows how many actors are posed from baked poses, the draw calls of the whole frame (shadow maps and post-processing included), which barely change with the size of the crowd, and the CPU time of a frame, which shows what `gpuAnimation` saves.

### One model, many instances

Each actor is a separate instance of the model, loaded with `enableInstancing`:

<<< @/../src/tut-92/main.js#actor

`fetchModel` downloads and parses a model file once and keeps the data while instances of it exist, so every later call only builds nodes, and all instances share the model's primitives and materials. `enableInstancing: true` gives each mesh an instance of its material (`createInstance()`). **Without it the meshes use the material itself and are not batched at all**: every actor then costs a draw call per mesh and per pass.

`play()` returns the playback; setting its `normalizedTime` starts the actor at another point of the clip, and together with the `speedRatio` option this keeps the crowd from moving in lockstep. Nothing else is needed for batching: the render queue groups the visible meshes every frame.

`SceneNode.clone()` creates instances too. It is asynchronous: it serializes the node and builds a copy from the data. A node loaded from a model file is rebuilt from that file and then given the properties that differ, such as its transform, material instances and `gpuAnimation`; clips added to it at runtime are not among them, so a clone does not have them. For a crowd, calling `fetchModel` once per instance is cheaper.

### Clips from separate files

Clips stored in the model file come with every instance, and all instances share their keys. Clips added at runtime belong to a single `AnimationSet`. Here the clips come from separate files and are retargeted to the character with `copyHumanoidAnimationFrom` (see [Skeletal Animation Retargeting](en/animation-skeleton.md#skeletal-animation-retargeting)), once, onto a hidden instance used as a template:

<<< @/../src/tut-92/main.js#clips

Retargeting onto every actor would also work, but it copies all keys for each actor and takes noticeable time per clip. Instead, each actor gets tracks of its own that reuse the interpolators of the template's tracks, which hold the keys:

<<< @/../src/tut-92/main.js#share

The track classes come from `@zephyr3d/scene`. The tracks must be new objects, since a track belongs to one clip, and they target the actor's own joints; only the keys are shared. Two instances of one model have the same node tree, so the example pairs their nodes in traversal order and their rigs by index in `animationSet.rigs`; `addSkeleton` takes the `persistentId` of the actor's rig.

## Conditions and cost

- Batching needs material instances: load models with `enableInstancing: true`, use `material.createInstance()` for meshes built in code, or turn on **Geometry Instance** in the editor.
- Meshes form one batch when they share the primitive and the core material. Skinned meshes must also have the same skin space, the transform from the skeleton's reference node to the mesh, which all instances of one model have. Mirrored instances (negative scale) are batched separately.
- Meshes with morph targets, and meshes with more than 4 bone influences per vertex, are not batched.
- Batches are drawn as instanced draw calls on WebGL2 and WebGPU alike. In a `BatchGroup` on WebGPU, `gpuInstanceCulling` (on by default) also culls each instance in a compute pass for every view, and the batches are drawn indirectly; keep it on for large groups that are only partly visible. See [BatchGroup Batching](en/performance.md#batchgroup-batching).
- Per-instance data is packed into 64 KB uniform buffers, so a large batch is split into several draw calls of a few hundred instances each.
- Instancing reduces draw calls, not animation work: every instance still poses its skeleton and writes its bone palette each frame. GPU animation, below, takes most of that off the CPU.

## GPU animation

Batching cuts draw calls, but every instance still evaluates its skeletal animation on the CPU each frame. With many characters, turn on `AnimationSet.gpuAnimation` (off by default); the example sets it on each actor in `createActor` above.

The playback API and animation events stay the same. While an instance has **exactly one clip active, animating only the joints**, the engine poses it from baked poses instead:

- A clip is baked the first time an instance plays it, sampled at 30 frames per second; poses between samples are interpolated. Expect a short hitch at that moment.
- The baked clips are shared by all instances created from the same model file or prefab, such as the actors of the example, which all come from one `fetchModel` URL. A model built in code bakes its own. Shared clips are looked up by name, so instances of one model must not give one name to different clips.
- On WebGPU the poses are evaluated in a compute pass. On WebGL2 they are evaluated on the CPU, one bone palette per instance, which still saves posing the joint nodes. The meshes stay batched on both.

Frames that do not meet those conditions fall back to the regular path without a visible jump: cross fades and other blends of clips, skeleton modifiers such as IK and joint dynamics, GPU cloth, and nodes attached below joints (which follow the joint nodes). In the editor, outside play mode, animation always takes the regular path. The hats of the example show the last case:

<<< @/../src/tut-92/main.js#hats

Joint nodes are not moved while baked poses play, so code reading joint transforms sees them as they were when the baked poses took over. `animationSet.isPlayingOnGpu` tells whether baked poses are in use, on WebGL2 as well, where they are evaluated on the CPU. The example counts it for the panel, next to the draw calls of the frame:

<<< @/../src/tut-92/main.js#stats

`getDevice().frameInfo.drawCalls` counts the draw calls of the current frame, so the example reads it in the `afterRender` hook of `setRenderable`, after the scene is drawn.

**Characters whose bones you control are not a fit for GPU animation.**

- An instance whose skeleton has IK, joint dynamics (bone physics) or any other skeleton modifier always takes the regular path and evaluates its bones on the CPU every frame. It is still drawn together with other compatible instances, so draw calls do not grow, but the bone work is not saved, and `gpuAnimation` gains nothing for it.
- Changing joint node transforms directly from code (not through a skeleton modifier) is not detected by the engine. While baked poses play, the meshes do not read the joint nodes, so such changes **silently have no effect**. To control joints from code, either turn `gpuAnimation` off for that instance, or write the control as a `SkeletonModifier` attached with `rig.modifiers.push()` (see [IK](en/animation-ik.md)); the engine then takes the regular path by itself.

## LOD and SDF

Skinned meshes can also use Mesh LOD. With `Mesh.sdfMode = 'auto'`, a skinned or morphed mesh is treated as a dynamic SDF instance and is not cached as static global-SDF geometry.

## Troubleshooting

If draw calls do not fall, first check that the meshes use material instances (`enableInstancing` when loading), then that the instances share primitives and core materials and have the same skin space, and that no mesh has morph targets or more than 4 bone influences per vertex. In a `BatchGroup`, giving a mesh another primitive or material rebuilds the cached batches; do not do it every frame.

If `isPlayingOnGpu` stays false with `gpuAnimation` on, check the fallback conditions above: more than one clip playing, a skeleton modifier on the rig, GPU cloth, or a node attached below a joint.
