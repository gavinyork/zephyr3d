# Foliage

`FoliageSystem` scatters many copies of prefabs or models — trees, bushes, rocks — over a terrain and draws them in instanced batches. Each instance stores only a position on the ground, a rotation and a scale, so tens of thousands of trees cost little memory, and the instances follow the ground when the terrain is reshaped. Far instances can turn into baked impostor cards, and leaves can let the sun through from behind.

Grass is a different system, owned by the terrain itself: see [Runtime Terrain](en/terrain-runtime.md#grass). Use foliage for objects with real meshes, grass for dense ground cover.

> The code on this page comes from the runnable example embedded below (`tut-91`), with imports and application setup left out. The code in the Collision section is a fragment.

## A foliage system in code

<div class="showcase" case="tut-91"></div>

The example scatters pines over a procedural terrain, in patches of forest that stay off steep slopes. The sliders set the number of trees, the cull distance and the fade band, and the checkbox turns the trees' shadows on and off. Sliders apply when released. Orbit until the sun is behind the trees to see the crowns light up.

A foliage system is a scene node placed under a `ClipmapTerrain`. Each layer scatters one asset, given by its path in the [VFS](en/vfs.md):

<<< @/../src/tut-91/main.js#foliage

`FoliageSystem` and `FOLIAGE_INSTANCE_STRIDE` come from `@zephyr3d/scene`. `TREE_PREFAB` is `/assets/pine/pine.zprefab`, a prefab the example writes itself (see below). `addLayer` returns the index of the new layer, which the other methods of the system take. The asset is a prefab (`.zprefab`) or a model file such as `.glb`. The layer loads it by itself, asynchronously, so the trees show up once it has loaded. Every mesh in the asset is drawn for each instance, at its place relative to the asset's root.

Instances are placed with `setInstances`, `FOLIAGE_INSTANCE_STRIDE` (5) floats each. `forestDensity` is a noise function of the example, 0 to 1, low on steep slopes and in clearings, and `PRNG` is the seeded random number generator of `@zephyr3d/base`:

<<< @/../src/tut-91/main.js#scatter

| Float | Meaning |
| --- | --- |
| 0, 1 | x and z, in the space of the foliage system |
| 2 | Height above the ground; negative sinks the instance in |
| 3 | Rotation about the vertical axis, in radians |
| 4 | Uniform scale |

`setInstances` replaces the placed instances of the layer (the `'manual'` group, see below), and `addInstances` appends to them. Positions are in the space of the foliage system, which is meant to be translated only, not rotated or scaled. The height of each instance is read from the terrain the system sits under; without a terrain ancestor the height offset is the height itself.

Instances are drawn in square chunks of `chunkSize` (64 m by default). Each chunk is a [BatchGroup](en/instancing-intro.md) built on demand, and changing the instances of an area rebuilds only the chunks it touches. Smaller chunks cull more tightly; larger ones draw in fewer batches.

### The tree asset of the example

In a project the asset comes from the editor: an imported model, or a prefab saved from one. The example has no asset files, so it makes the tree from shapes and saves it as a prefab into an in-memory file system, which it gives the engine as its VFS:

<<< @/../src/tut-91/main.js#vfs

<<< @/../src/tut-91/main.js#prefab

`MemoryFS` comes from `@zephyr3d/base`. A mesh in a prefab refers to its primitive and material by asset path. So the shapes and materials are written as files first, in the `{ type: 'Default', data }` form the editor saves `.zmsh` and `.zmtl` files in, and `setAssetId` gives each its path. Then the node tree is serialized into the prefab form `{ type: 'SceneNode', data }` (see [Serialization](en/serialization.md)). A shape or material without an asset path is left out of the prefab, and the layer skips the mesh that used it, which loads without its primitive or material.

The terrain heights are set with `setHeights`:

<<< @/../src/tut-91/main.js#heights

The foliage system reads heights from the terrain's CPU copy of them, `terrain.heightData`. `setHeights` takes half floats (`float2half` is in `@zephyr3d/base`) and keeps that copy as it uploads them, so the trees can be placed at once (see Limits and pitfalls below).

## Painted and placed instances

A layer holds two groups of instances:

| Group | Comes from | Changed by |
| --- | --- | --- |
| Generated (painted) | The layer's density mask and its `generation` settings | Painting, erasing and regenerating in the editor |
| Manual (placed) | `setInstances` / `addInstances`, or the editor's scatter tool | The instance methods and erasing |

Painted instances are generated from candidates on a grid of `generation.spacing`, each jittered within its cell and given a threshold, rotation and scale drawn from a sequence seeded only by its cell and `generation.seed`. A candidate becomes an instance where the painted density is above its threshold and the slope and height filters pass. Painting denser therefore adds instances without moving the ones already there, and the same mask always gives the same forest.

Generation runs in the editor (see [Foliage Tools](en/editor/foliage-tools.md)); the instances it produces are saved with the scene. At run time, code places instances through the manual group. `paintMask` and `fillMaskCircle` change the density mask but do not generate instances by themselves.

The main `generation` settings:

| Setting | Effect |
| --- | --- |
| `spacing` | Roughly the closest two instances get. Smaller packs them tighter and costs more instances |
| `scaleRange`, `randomYaw` | Variation between copies |
| `slopeRange`, `heightRange` | Keep trees off cliffs, or above the water line |
| `surface` | `'terrain'` follows the ground; `'any'` lands on whatever has a collider below, such as rocks or buildings, and keeps that height |
| `placeScript` | An optional `function place(p, api, input)` that decides how likely a copy is at each candidate |

`alignToNormal` tilts instances with the slope: 0 keeps trees upright, 1 suits rocks that should lie on the ground.

## Distance: culling, impostors and fading

Every layer stops drawing beyond `cullDistance` (default 300 m). Between that and the camera, `impostor` swaps far instances for **octahedral impostors**: a camera-facing card showing the asset baked from many directions, with depth and normals so it is lit like the mesh. A forest of impostors costs a fraction of the meshes, and the meshes stay where they matter, near the camera.

| Setting | Effect |
| --- | --- |
| `impostorDistance` | Where meshes turn into cards (default 80 m). Nearer draws fewer meshes but makes the swap easier to spot |
| `impostorLod` | The level of detail the cards are baked from. Pick the level the meshes show around `impostorDistance`, so the swap keeps their look |
| `fadeDistance` | Width of the bands instances dither over instead of popping: across the impostor swap, and toward the cull distance (default 10 m, 0 to switch at once). Shadows fade with them |

Impostors are baked by the editor into `/assets/.impostor/`, one folder per asset and level of detail, and published with the project. A layer whose impostor has not been baked draws its meshes at every distance. To check a bake, `forceImpostor` shows every instance as a card, even up close, and `impostorDebug` shows one baked attribute instead of the lit colour.

The example has no baked impostor, so it only uses `cullDistance` and `fadeDistance`. Its controls change the layer like this:

<<< @/../src/tut-91/main.js#settings

Changing a setting of a layer, with `setLayerSettings` or a property of the layer itself (`foliage.getLayer(index).cullDistance = 200`), rebuilds every chunk of the system: a mesh node for each part of each instance. Changing instances rebuilds only the chunks they are in. With thousands of trees a rebuild takes a noticeable moment, so do not change settings every frame or while a slider is being dragged.

## Leaves: light from behind

Thin leaves glow when the sun is behind them. PBR materials turn this on with `foliageTransmission`; in the example the crowns use it:

<<< @/../src/tut-91/main.js#transmission

The colour is the light let through, multiplied by `foliageTransmissionTexture` when there is one. Light from the sky behind the leaf counts too, not only the sun. Leaf cards are single quads, so also set `cullMode = 'none'` on their material for the back faces to be drawn. In a material blueprint, connect `SubsurfaceColor` instead. Impostors bake the transmission as well, so far trees keep it.

## Collision

`collision` makes the instances static physics obstacles, for example so a vehicle cannot drive through trees:

```ts
foliage.setLayerSettings(pines, {
  collision: { shape: 'capsule', radius: 0.3 }
});
```

Sizes are in the asset's units and scale with each instance. Sizes left out are fitted to the bounds of the asset's meshes, which for a tree is its canopy, so give a trunk radius. With `shape: 'asset'`, the box, sphere, capsule and cylinder colliders on the asset's own nodes are used. See [Colliders](en/physics-colliders.md).

## Limits and pitfalls

- Per-instance distance culling, the impostor swap per instance and `fadeDistance` need GPU instance culling, which is WebGPU-only (`device.type === 'webgpu'`). On WebGL2 a whole chunk is hidden once all of it is past `cullDistance`, a whole chunk swaps to impostors once all of it is past the impostor distance, and instances pop instead of fading.
- The cost of dense forests is mostly geometry, in the main view and in every shadow cascade. Lower `cullDistance` first, use impostors, and turn `castShadow` off for small plants. Tens of thousands of trees need a discrete GPU.
- Instances stand on the terrain through its CPU copy of the heights, `terrain.heightData`. Terrains loaded from a scene and heights set with `setHeights` have it at once, and other `r16f`/`rgba16f` height maps get it from a GPU read back. Height maps in other formats, such as an `r32f` texture or an image, cannot be read back, and the instances stand at their height offset in the space of the foliage system instead of on the ground.
- Skinned and morphed meshes of an asset are skipped: they are neither scattered nor baked into impostors.
- Instances are positioned relative to the foliage system: rotating or scaling it is not supported.
- Changing `maskCellSize` keeps the painted values, so what was painted scales with it; regenerate the layers afterwards.
