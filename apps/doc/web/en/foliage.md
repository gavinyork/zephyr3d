# Foliage

`FoliageSystem` scatters many copies of prefabs or models — trees, bushes, rocks — over a terrain and draws them in instanced batches. Each instance stores only a position on the ground, a rotation and a scale, so tens of thousands of trees cost little memory, and the instances follow the ground when the terrain is reshaped. Far instances can turn into baked impostor cards, and leaves can let the sun through from behind.

Grass is a different system, owned by the terrain itself: see [Runtime Terrain](en/terrain-runtime.md#grass). Use foliage for objects with real meshes, grass for dense ground cover.

> The code on this page is a fragment: imports and application setup are left out.

## A foliage system in code

A foliage system is a scene node placed under a `ClipmapTerrain`. Each layer scatters one asset:

```ts
const foliage = new FoliageSystem(scene);
foliage.parent = terrain;

const pines = foliage.addLayer('/assets/trees/pine.zprefab', {
  cullDistance: 400,
  impostor: true,
  impostorDistance: 120
});

// Five floats per instance (FOLIAGE_INSTANCE_STRIDE): x, z, height above the ground,
// rotation about the vertical axis in radians, uniform scale
const data = new Float32Array(1000 * FOLIAGE_INSTANCE_STRIDE);
for (let i = 0; i < 1000; i++) {
  const o = i * FOLIAGE_INSTANCE_STRIDE;
  data[o + 0] = Math.random() * 512;
  data[o + 1] = Math.random() * 512;
  data[o + 2] = 0;
  data[o + 3] = Math.random() * Math.PI * 2;
  data[o + 4] = 0.8 + Math.random() * 0.4;
}
foliage.setInstances(pines, data);
```

`FoliageSystem` and `FOLIAGE_INSTANCE_STRIDE` come from `@zephyr3d/scene`. Positions are in the space of the foliage system, which is meant to be translated only, not rotated or scaled. The height of each instance is read from the terrain the system sits under; without a terrain ancestor the height offset is the height itself.

Instances are drawn in square chunks of `chunkSize` (64 m by default). Each chunk is a [BatchGroup](en/instancing-intro.md) built on demand, and changing the instances of an area rebuilds only the chunks it touches. Smaller chunks cull more tightly; larger ones draw in fewer batches.

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

## Leaves: light from behind

Thin leaves glow when the sun is behind them. PBR materials turn this on with `foliageTransmission`:

```ts
leafMaterial.foliageTransmission = true;
leafMaterial.foliageTransmissionColor = new Vector3(0.4, 0.6, 0.1);
```

The colour is the light let through, multiplied by `foliageTransmissionTexture` when there is one. Light from the sky behind the leaf counts too, not only the sun. In a material blueprint, connect `SubsurfaceColor` instead. Impostors bake the transmission as well, so far trees keep it.

## Collision

`collision` makes the instances static physics obstacles, for example so a vehicle cannot drive through trees:

```ts
foliage.setLayerSettings(pines, {
  collision: { shape: 'capsule', radius: 0.3 }
});
```

Sizes are in the asset's units and scale with each instance. Sizes left out are fitted to the bounds of the asset's meshes, which for a tree is its canopy, so give a trunk radius. With `shape: 'asset'`, the box, sphere, capsule and cylinder colliders on the asset's own nodes are used. See [Colliders](en/physics-colliders.md).

## Limits and pitfalls

- Per-instance distance culling, the impostor swap per instance and `fadeDistance` need GPU instance culling, which is WebGPU-only. On WebGL2 a whole chunk swaps to impostors once all of it is past the impostor distance, and instances pop instead of fading.
- The cost of dense forests is mostly geometry, in the main view and in every shadow cascade. Lower `cullDistance` first, use impostors, and turn `castShadow` off for small plants. Tens of thousands of trees need a discrete GPU.
- Animated meshes (skinned or with morph targets) are left out of impostor bakes.
- Instances are positioned relative to the foliage system: rotating or scaling it is not supported.
- Changing `maskCellSize` keeps the painted values, so what was painted scales with it; regenerate the layers afterwards.
