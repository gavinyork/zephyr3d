# Terrain

Terrain rendering is a crucial feature for outdoor scenes, and we currently utilize a terrain system based on the ChunkedLOD algorithm, which supports the rendering of terrains of fixed sizes.

However, our current terrain system has certain limitations:

1. The terrain resolution is confined to (2^N+1)x(2^N+1).
2. It lacks support for dynamic loading, making it unsuitable for rendering infinite or very large terrains. We recommend keeping the map resolution at or below 1025x1025.
3. It can support no more than four levels of detail textures.

Rendering the terrain requires the following data:

1. Height Map Data, which stores the height of each coordinate within the terrain. This is usually exported from terrain creation tools as a grayscale image or raw data.
2. Terrain Surface Normals are automatically calculated by the system upon importing the height map, so there's no need to provide this.
3. Detail Textures. We currently support no more than four layers of detail textures and their corresponding normal maps, with each layer's tiling size being individually adjustable. We use PBR (Physically Based Rendering) for terrain, allowing each detail texture to have its own metallicity and roughness settings.
4. Splat Maps store the weight of each detail texture layer in the RGBA channels, usually exported from terrain creation tools.

Vegetation:

We support the distribution of grass vegetation based on the weight distribution of detail textures. To generate grass meshes automatically, you only need to provide the grass texture, distribution density, and billboard size.

```javascript

// Terrain resolution, which must be 2 to the Nth power plus one
const TERRAIN_WIDTH = 257;
const TERRAIN_HEIGHT = 257;
// The maximum height of a terrain, which is typically exported by the terrain authoring tool
const maxHeight = 62;
// Loading the heightmap, the RAW file contains the normalized 16-bit integer height values
const arrayBuffer = await assetManager.fetchBinaryData('assets/map/heightmap.raw');
const heightsInt16 = new Uint16Array(arrayBuffer);
// The height value of the 16-bit integer is converted to a floating-point value in the range of 0 to 1
const heightmap = new Float32Array(TERRAIN_WIDTH * TERRAIN_HEIGHT);
for (let i = 0; i < TERRAIN_WIDTH * TERRAIN_HEIGHT; i++) {
  heightmap = heightsInt16[i] / 65535;
}
// Load SplatMap
const splatMap = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/splatmap.tga', { linearColorSpace: true });
// Detail Texture 1
const detailAlbedo0 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/detail1.jpg', { linearColorSpace: false });
const detailNormal0 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/detail1_norm.jpg', { linearColorSpace: true });
// Detail Texture 2
const detailAlbedo1 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/detail2.jpg', { linearColorSpace: false });
const detailNormal1 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/detail2_norm.jpg', { linearColorSpace: true });
// Detail Texture 3
const detailAlbedo2 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/detail3.jpg', { linearColorSpace: false });
const detailNormal2 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/maps/map1/detail3_norm.jpg', { linearColorSpace: true });
// Grass blade textures
const grass1 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/grass1.dds');
const grass2 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/grass2.dds');

// Create the terrain
const terrain = new Terrain(scene);
/*
  Initialize the terrain with a heightmap
  parameter 1：Terrain resolution at X axis
  parameter 2：Terrain resolution at Z axis
  parameter 3: Height data
  parameter 4：The XYZ axis of the terrain is scaled. Use this parameter if you need to scale the terrain. If you use a node's scale transform, it will cause terrain normals and terrain LODs to be calculated incorrectly.
  parameter 5：The resolution of each patch must also be 2 to the Nth power plus one. The higher the value, the smaller the LOD effect, resulting in a higher number of vertices, but greatly reducing the DrawCall.
  parameter 6：Detail texture settings
*/
terrain.create(TERRAIN_WIDTH, TERRAIN_HEIGHT, heightmap, new Vector3(1, maxHeight, 1), 33, {
  // Weight map
  splatMap: splatMap,
  // Detail textures
  detailMaps: {
    // List of detail color maps, no more than 4
    albedoTextures: [detailAlbedo0, detailAlbedo1, detailAlbedo2],
    // List of detail normal maps, no more than 4
    normalTextures: [detailNormal0, detailNormal1, detailNormal2],
    // Tiling parameters for each detail texture, the higher the value, the denser it is
    uvScale: [30, 30, 30],
    // The normals of each detail normal texture are scaled, with smaller values and flatter normals
    normalScale: [0.5, 0.5, 0.5],
    // The metalness of each detail texture, if not given, defaults to 0
    metallic: [0, 0, 0],
    // The roughness of each detail texture, if not given, defaults to 1
    roughness: [0.95, 0.9, 0.7],
    // Two layers of grass are distributed in the first layer of details.
    grass: [[{
      // Billboard width
      bladeWidth: 2,
      // Billboard height
      bladeHeigh: 2,
      // Density, distributed at a rate of 1.5 per unit area.
      density: 1.5,
      offset: -0.1,
      texture: grass1
    }, {
      bladeWidth: 2,
      bladeHeigh: 3,
      density: 0.1,
      offset: -0.02,
      texture: grass2
    }]]
  }
});

```

The terrain is made up of a height map, allowing us to obtain the elevation of any point within it.

The following code demonstrates how to use terrain height to ensure the camera's minimum position is above the ground level.

```javascript

// Adjust the camera position in every frame.
myApp.on('tick', ev => {
  camera.updateController();
  // Determine the camera's position in the world coordinate system.
  const cameraPos = camera.getWorldPosition();
  // Convert the camera's location to the terrain coordinate system
  const terrainSpacePos = terrain.worldToThis(cameraPos);
  // Obtain the height value of a point based on its x and z coordinates
  const height = terrain.getElevation(terrainSpacePos.x, terrainSpacePos.z);
  // Ensure the camera's height is not less than 3 units above the terrain surface.
  if (terrainSpacePos.y < height + 3) {
    terrainSpacePos.y = height + 3;
    // Recalculate the position back to the camera's parent space.
    camera.position = terrain.thisToOther(camera.parent, terrainSpacePos);
  }
  camera.render(scene);
});

```

A simpler way to achieve the above functionality is to make the camera a child node of the terrain. This way, the camera's position is within the terrain space, eliminating the need for further conversion.

```javascript

// Set camera to be a child node of the terrain
camera.parent = terrain

myApp.on('tick', ev => {
  camera.updateController();

  // The camera is positioned within the terrain coordinate system and can be directly utilized.
  const height = terrain.getElevation(camera.position.x, camera.position.z);
  // Fix camera's location
  if (camera.position.y < height + 3) {
    camera.position.y = height + 3;
  }
  camera.render(scene, compositor);
});

```

The example demonstrates rendering a small terrain of 257x257 dimensions, utilizing three layers of detail textures. It features an FPS camera controller, requiring the use of the WSAD keys and the mouse for navigation. Pressing the spacebar toggles the grid display.

<div class="showcase" case="tut-31"></div>

