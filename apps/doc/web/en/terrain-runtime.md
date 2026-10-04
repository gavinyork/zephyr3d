# Runtime Terrain

> Code on this page is illustrative and omits imports and application setup. See the embedded live demo for a complete runnable example.

`ClipmapTerrain` renders large outdoor ground from a height map: the mesh around the camera is a clipmap whose cells grow with distance, so a terrain of any size costs about the same to draw. Its surface is blended from up to several detail texture layers through a splat map, and each terrain carries a grass renderer with textured grass cards and, on WebGPU, procedural geometry grass.

This page covers runtime use from code. Brushes and painting are covered in [Terrain Tools](en/editor/terrain-tools.md).

---

## Creating Terrain

```ts
const terrain = new ClipmapTerrain(scene, 512, 512, 64);
terrain.position.setXYZ(0, 0, 0);
terrain.castShadow = true;
```

| Argument | Meaning |
| --- | --- |
| `scene` | Scene that owns the terrain |
| `sizeX` | Terrain width in world units |
| `sizeZ` | Terrain depth in world units |
| `clipMapTileSize` | Tile resolution of the clipmap rings; larger tiles mean more triangles near the camera |

The terrain starts at the node's X/Z position and extends along +X/+Z by `sizeX * scale.x` and `sizeZ * scale.z`. Heights come from the height map, scaled by the node's Y scale. `terrain.worldRegion` gives the covered area as (minX, minZ, maxX, maxZ).

---

## Height Maps

The terrain creates a height texture of `sizeX × sizeZ` texels. Replace it with a loaded one:

```ts
terrain.heightMap = await getEngine().resourceManager.fetchTexture('/terrain/height.png', {
  linearColorSpace: true
});
terrain.setSize(1024, 1024);
```

Setting `heightMap` updates the height range used for culling and bounds. Code that writes into the height texture itself must then call `terrain.updateBoundingBox()` and `terrain.updateHeightPyramid()` (the pyramid drives grass occlusion culling), and `terrain.invalidateRuntimeVirtualTexture()` for the changed area when the [runtime virtual texture](#runtime-virtual-texture) is on, since its pages hold the surface normal.

---

## Detail Layers and Splat Maps

The surface is blended from detail layers, each an albedo texture with an optional normal map. The splat map stores how much of each layer covers each point; it is normally painted with the editor's texture brush and can be replaced from code with `material.setSplatMap()`.

```ts
const material = terrain.material;
material.numDetailMaps = 2;

material.setDetailMap(0, await getEngine().resourceManager.fetchTexture('/terrain/grass.png'));
material.setDetailNormalMap(
  0,
  await getEngine().resourceManager.fetchTexture('/terrain/grass-n.png', { linearColorSpace: true })
);
material.setDetailMapUVScale(0, 24);
material.setDetailMapRoughness(0, 0.8);

material.setDetailMap(1, await getEngine().resourceManager.fetchTexture('/terrain/rock.png'));
material.setDetailMapUVScale(1, 12);
material.setDetailMapRoughness(1, 0.95);
```

`numDetailMaps` is limited by `terrain.MAX_DETAIL_MAP_COUNT`. Without the runtime virtual texture, every pixel samples every layer, so each layer adds to the shading cost of the whole terrain.

### Hex Tiling

A texture repeated across a large area shows its repetition. Hex tiling (Mikkelsen, *Practical Real-Time Hex-Tiling*, 2022) samples each layer on a grid of hexagons, each turned and scaled at random, and blends them so the seams do not show:

```ts
material.setDetailMapHexTiling(0, true);
// rotation, scale, contrast, each 0 to 1 (MaterialX hextiledimage inputs)
material.setDetailMapHexParams(0, 1, 0.5, 0.5);
```

| Parameter | Effect |
| --- | --- |
| rotation | How much each tile is turned at random; 1 allows any angle. Lower it for textures with a direction, such as strata |
| scale | How much each tile is resized at random; 1 allows 0.5 to 2 times |
| contrast | How much the brighter tile wins at seams; higher values give crisper transitions |

Hex tiling takes three samples per layer instead of one. With the runtime virtual texture that cost is paid once per page rather than per pixel, so the two work well together. It is not available on WebGL1.

---

## Runtime Virtual Texture

With many detail layers, blending all of them at every pixel every frame becomes the main cost of the terrain. The runtime virtual texture (RVT) blends the layers once into pages of a large virtual texture, holding the base color, the world-space normal and the roughness, and the terrain then shades with a single lookup. Only the pages the camera needs are filled, at the resolution it needs; pages are refilled when the surface under them changes.

```ts
// WebGPU only; ignored elsewhere
terrain.runtimeVirtualTexture = true;

// Or with options
terrain.setRuntimeVirtualTexture({
  virtualSize: 32768, // texels along the longer side of the terrain
  pageSize: 128,
  atlasSize: 4096, // physical pages: 4096² texels in two RGBA8 planes, 128 MB
  allocBudget: 16 // pages filled per update
});
```

In the editor, turn on **RuntimeVirtualTexture** in the terrain's properties. Painting with the editor brushes refills the affected pages automatically.

When to use it, and what it costs:

- Shading cost no longer grows with the number of layers or with hex tiling. The more layers, the more it saves.
- `virtualSize` sets the sharpness of the blended surface: the terrain's longer side spans that many texels at the finest level. Detail textures repeating more finely than that are blurred by the page resolution.
- The physical atlas is allocated up front: 128 MB with the default 4096 size. Lower `atlasSize` on devices short of memory; too small an atlas cannot hold all the pages a view needs and falls back to coarser ones.
- Pages are filled over several frames (`allocBudget` per update): after a camera cut or a fast flight, the surface may show coarser pages for a moment.
- Code that writes into the splat map or the height map must call `terrain.invalidateRuntimeVirtualTexture(x0, z0, x1, z1)` with the changed world XZ rectangle, or without arguments for the whole terrain. Changing textures or layer parameters through the material is picked up automatically.
- `terrain.runtimeVirtualTextureData` exposes the virtual texture for inspection (`stats`, `renderDebugTexture()`).

---

## Grass

Each terrain owns a `grassRenderer` holding grass layers. A layer is one of two kinds:

| Kind | What it draws | Backends | Use for |
| --- | --- | --- | --- |
| `'card'` (default) | Textured, alpha-tested cards | All | Flowers, weeds, sparse vegetation, anything defined by a texture |
| `'blade'` | Procedural geometry blades, curved and lit per blade, no texture needed | WebGPU only | Dense lawns and meadows |

Geometry blades: each blade is a cubic Bézier curve built in the vertex shader from a few parameters per blade, grouped into clumps that share height, direction and color, and bent by the scene's wind. Unlike cards they need no alpha test, so they keep the depth prepass efficient and stay sharp up close.

### Density Maps

Both kinds are placed the same way. Each layer has a **density map**, one byte per texel (0 = no grass, 255 = full density), covering the whole terrain. Blades are derived from it deterministically: the same density data always gives the same placement, and blades follow the terrain height.

```ts
const grassTexture = await getEngine().resourceManager.fetchTexture('/terrain/grass-card.png');
const cards = terrain.grassRenderer.addLayer(0.12, 0.8, grassTexture);
const layer = terrain.grassRenderer.getLayer(cards);

// Paint density, then regenerate the region
const w = layer.densityMapWidth;
for (let z = 10; z < 20; z++) {
  for (let x = 10; x < 20; x++) {
    layer.densityMap[z * w + x] = 255;
  }
}
layer.updateDensityRegion(10, 10, 20, 20);
```

Density texel (x, z) covers the terrain region `[x/w..(x+1)/w, z/h..(z+1)/h]`. `cellsPerTexel` sets how many placement cells a texel has per axis; a texel holds at most its square in blades. Batch density writes and call `updateDensityRegion()` once per edit; `setDensityData(w, h, cellsPerTexel, data)` replaces the whole map.

<div class="showcase" case="tut-69"></div>

### Geometry Blades

```ts
// Blade width and height; no texture needed
const blades = terrain.grassRenderer.addLayer(0.04, 0.6, null, 'blade');
const meadow = terrain.grassRenderer.getLayer(blades);

meadow.rootColor = new Vector4(0.12, 0.2, 0.05, 1);
meadow.tipColor = new Vector4(0.55, 0.65, 0.25, 1);
meadow.tilt = 0.3; // how far blades lean over
meadow.bend = 0.4; // how much they arch
meadow.clumpSize = 0.5; // world units
meadow.clumpSameDirection = 0.6; // comb each clump one way
meadow.lodDistance = 30; // switch to the low detail level here
```

The parameters, all with defaults that give a plausible lawn, fall into groups:

| Group | Properties | Effect |
| --- | --- | --- |
| Shape | `tilt`, `bend`, `taper`, `tipDetail`, `heightRandomness`, `widthRandomness`, `tiltRandomness`, `bendRandomness` | Lean, arch and outline of each blade, and how much they vary |
| Clumps | `clumpSize`, `clumpHeightVariation`, `clumpPull`, `clumpSameDirection`, `clumpFaceAway`, `clumpColorVariation` | Breaks the field into patches: tufts, combed areas, color variation |
| Color and lighting | `rootColor`, `tipColor`, `colorMap`, `rootOcclusion`, `roundness`, `transmissionColor` | Gradient or texture from root to tip, darkening at the root, curved shading, light glowing through backlit blades |
| Distance | `viewThickening`, `farNormalStart`, `farNormalEnd`, `farRoughness`, `lodDistance` | Keeps fields full at low angles and calm in the distance; `lodDistance` switches to a quarter as many, wider blades |
| Wind | `windFacing`, `windLean`, `swayAmplitude`, `swaySpeed` | How the blades respond to the scene wind; card layers have `windLean`, `swayAmplitude` and `swaySpeed` too |

Both kinds of grass sway in the scene-wide wind:

```ts
const wind = scene.env.wind;
wind.direction = 45; // degrees on the ground, 0 blows toward +X
wind.strength = 1;
wind.gustStrength = 0.5;
wind.gustScale = 20;
```

Geometry blades cast shadows from the sun into the two nearest cascades of its shadow map (`grassRenderer.castShadow`, on by default; the terrain must cast shadows too), fading out over `grassRenderer.shadowFadeFraction` of the last of them. Farther away, grass casts no shadow of its own; screen-space contact shadows and ambient occlusion, when enabled, darken it there.

In the editor, the grass brush's **Add Blade Layer** button adds a geometry layer, whose settings appear in the brush panel when it is selected.

### Draw Distance and Culling

| Setting | Effect |
| --- | --- |
| `layer.drawDistance` | Blades are not drawn beyond this distance (default 150) and shrink into the ground over the last quarter of it; 0 draws them at any distance |
| `layer.farDensity` | Card layers: fraction of blades still drawn at the draw distance (default 0.25); the remaining ones widen to keep the ground covered |
| `grassRenderer.occlusionCulling` | WebGPU: skips grass hidden behind the terrain itself (default on). Only the terrain occludes; buildings do not |
| `grassRenderer.occlusionDebug` | Draws the grass occlusion culling would skip in red instead |

On WebGPU, blades are placed on the GPU around the camera every frame, from the density map, with frustum and terrain occlusion culling; there is no per-tile CPU work. On WebGL, card blades are generated in CPU tiles when the density changes, and `farDensity` only shrinks the dropped blades instead of skipping them.

### Choosing a Kind

- Geometry blades need WebGPU. On other backends a blade layer is not drawn, with a warning in the console; give WebGL users a card layer if grass matters there.
- Cards are cheaper per blade and can show any texture, but their alpha test defeats early depth rejection, so dense card grass is expensive to fill. Prefer blades for dense coverage, cards for sparse flowers and weeds.
- Card layers do not cast shadows.

---

## Debugging

```ts
camera.wireframe = true; // every object, terrain included; needs debug views, see Levels of Detail
terrain.wireframe = true; // the terrain alone, always available
terrain.material.debugMode = 'vertex_normal';
```

`TerrainDebugMode` lists the debug outputs: `none`, `vertex_normal`, `detail_normal`, `tangent`, `uv`, `bitangent` and `albedo`.

---

## Serialization

`ClipmapTerrain`, its material (layers, hex tiling), the runtime virtual texture switch, and the asset ids of its height map, splat map and grass data are serialized with the scene, which is how terrain edited in the editor is saved and restored. Grass layers keep their kind and blade parameters.

For terrain generated at runtime, assign stable asset ids to the generated height, splat and grass resources before saving the scene.

---

## Performance

- The clipmap keeps the triangle count roughly constant; `clipMapTileSize` trades near detail for vertex cost.
- Detail layers multiply the per-pixel cost; on WebGPU turn on the runtime virtual texture once there are more than a few layers or hex tiling is used.
- Grass costs grow with density and draw distance. Lower `drawDistance` first, then density; for blade layers, a shorter `lodDistance` cuts distant geometry.
- Height map resolution beyond the terrain size in world units rarely adds visible detail.

For engine-wide techniques see [Performance Optimization](en/performance.md).
