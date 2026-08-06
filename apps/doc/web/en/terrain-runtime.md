# Runtime Terrain

`ClipmapTerrain` is the runtime terrain node used by Zephyr3D. It renders large terrain with clipmap LOD, height maps, splat maps, detail textures, normal maps, and an integrated grass renderer.

This page covers runtime use from code. Editor brush workflows are covered in the editor terrain tools page.

## Creating Terrain

```ts
import { ClipmapTerrain } from '@zephyr3d/scene';

const terrain = new ClipmapTerrain(scene, 512, 512, 64);
terrain.parent = scene.rootNode;
terrain.position.setXYZ(0, 0, 0);
terrain.castShadow = true;
```

Constructor arguments:

| Argument | Meaning |
| --- | --- |
| `scene` | Scene that owns the terrain |
| `sizeX` | Terrain width in world units |
| `sizeZ` | Terrain depth in world units |
| `clipMapTileSize` | Tile resolution used by the clipmap renderer |

The terrain region starts at the node's X/Z position and extends along positive X/Z by `sizeX * scale.x` and `sizeZ * scale.z`. Height comes from the height map and the node's Y scale.

## Height Maps

`ClipmapTerrain` creates a height texture automatically. You can replace it with a loaded texture:

```ts
const heightMap = await getEngine().resourceManager.fetchTexture('/terrain/height.png', {
  linearColorSpace: true
});

terrain.heightMap = heightMap;
terrain.setSize(1024, 1024);
```

When height data changes, the terrain updates its internal min/max data for culling and world bounds. If you edit the height texture manually, call the relevant terrain update path after changing texture data.

## Detail Textures and Splat Maps

Terrain material settings live on `terrain.material`.

```ts
const material = terrain.material;

material.numDetailMaps = 2;
material.setDetailMap(0, await getEngine().resourceManager.fetchTexture('/terrain/grass.png'));
material.setDetailNormalMap(0, await getEngine().resourceManager.fetchTexture('/terrain/grass-n.png', {
  linearColorSpace: true
}));
material.setDetailMapUVScale(0, 24);
material.setDetailMapRoughness(0, 0.8);

material.setDetailMap(1, await getEngine().resourceManager.fetchTexture('/terrain/rock.png'));
material.setDetailMapUVScale(1, 12);
material.setDetailMapRoughness(1, 0.95);
```

`numDetailMaps` is limited by `terrain.MAX_DETAIL_MAP_COUNT`. The splat map selects how detail layers are blended over the terrain. Splat maps are normally authored by the editor terrain brush, but can also be assigned from code through `material.setSplatMap()`.

## Debugging

Use `wireframe` and material debug modes when tuning terrain data:

```ts
terrain.wireframe = true;
terrain.material.debugMode = 'vertex_normal';
```

The available debug modes are defined by `TerrainDebugMode`: `none`, `vertex_normal`, `detail_normal`, `tangent`, `uv`, `bitangent`, and `albedo`. Use them to inspect the data that feeds terrain shading when building tooling.

## Grass Renderer

Each terrain owns a `grassRenderer`. Grass is stored in layers, and each layer can have its own blade size and albedo texture.

Grass distribution is authored as a per-layer **density map** — one byte per texel (0 = no grass, 255 = full density) covering the whole terrain region. Individual blade instances are derived data: the engine generates them from the density map with a deterministic hash, so the same density data always produces the same blade placement, and blades follow the terrain height automatically.

```ts
const grassTexture = await getEngine().resourceManager.fetchTexture('/terrain/grass-blade.png');
const layerIndex = terrain.grassRenderer.addLayer(0.12, 0.8, grassTexture);
const layer = terrain.grassRenderer.getLayer(layerIndex);

// Paint density directly into the density map, then regenerate the affected region
const w = layer.densityMapWidth;
const h = layer.densityMapHeight;
for (let z = 10; z < 20; z++) {
  for (let x = 10; x < 20; x++) {
    layer.densityMap[z * w + x] = 255;
  }
}
layer.updateDensityRegion(10, 10, 20, 20);
```

Only the tiles overlapping the updated region are regenerated, so incremental edits are cheap. Batch your density writes and call `updateDensityRegion()` once per edit; avoid full-map updates every frame.

Common methods:

| Method / property | Use |
| --- | --- |
| `addLayer(width, height, texture)` | Add a grass layer |
| `setGrassTexture(layer, texture)` | Change a layer texture |
| `setBladeSize(layer, width, height)` | Change blade geometry |
| `getLayer(index).densityMap` | Density data, one byte per texel |
| `getLayer(index).densityMapWidth/Height` | Density map dimensions |
| `getLayer(index).cellsPerTexel` | Placement cells per texel per axis; max blades per texel is its square |
| `getLayer(index).updateDensityRegion(x0, z0, x1, z1)` | Regenerate blades for a texel region after editing the density map |
| `getLayer(index).setDensityData(w, h, cells, data)` | Replace the whole density map |

Density map texel (x, z) covers the normalized terrain region `[x/w..(x+1)/w, z/h..(z+1)/h]`; blade world positions and rotations are derived deterministically from the density.

The following demo builds a procedural terrain and authors grass through the density map (grass grows on gentle slopes below a height limit):

<div class="showcase" case="tut-69"></div>

## Serialization

`ClipmapTerrain`, its material, height-map asset id, splat-map asset id, and grass asset id are part of the serialization system. This is why terrain edited in the editor can be saved and restored as part of a scene.

For runtime-generated terrain tools, assign stable asset ids to generated height/splat/grass resources before saving the scene.

## Performance Notes

Use clipmap terrain for large outdoor surfaces. For small static surfaces, a regular `Mesh` may be simpler.

Keep the height-map resolution aligned with the terrain size and expected detail. Too much detail texture variety increases material cost; too many grass instances increases draw and culling cost.
