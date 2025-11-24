
# Terrain Editing

The terrain editor is used to create, modify, and beautify terrain in scenes, including terrain height variations, surface textures, and grass vegetation distribution.

---

## Creating Terrain

- Select `Add → Terrain` from the main menu, then place the terrain at an appropriate position in the scene.
- Adjust the terrain resolution in the Properties panel (usually should match the heightmap resolution).

<video src="https://cdn.zephyr3d.org/doc/assets/videos/create-terrain.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

---

## Terrain Brushes

Terrain brushes are used for WYSIWYG painting on terrain, including height modification, texture painting, and grass planting.
Before using any brush, please:

- Select the terrain to edit in the scene;
- Click the edit button in the toolbar to open the terrain editing panel;

**Common Brush Parameters**

All types of brushes typically include some common parameters:

- Brush Shape: Can be selected from the shape list.
- Brush Size: Affects the area of effect; larger values mean wider affected areas.
- Brush Angle: Affects the rotation angle of the brush's effect on the terrain.
- Brush Strength: Affects the intensity of each stroke; larger values produce more noticeable changes.

> Operation Tip: Hold down the left mouse button and drag on the terrain to paint.

### Height Brush

The height brush is used to sculpt hills, valleys, plateaus, and other terrain features.

**Height Brush Modes**:

- Raise: Continuously increases terrain height.
- Lower: Continuously decreases terrain height.
- Smooth: Softens terrain details, eliminating sharp height changes.
- Flatten: Flattens the surrounding terrain height to match the height at the brush position.
- Thermal Erosion: Simulates mountain "dulling" caused by rock sliding.
- Hydraulic Erosion: Simulates gullies and valleys formed by water flow erosion, transport, and deposition.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/height-brush.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

### Texture Brush

The texture brush is used to "paint" different surface materials on the terrain, such as: soil, grass, stone, snow, etc.

1. **Terrain Coloring Principle**

When rendering terrain, the engine typically uses two types of texture data:

  - Detail Map:
    - "Real patterns" directly applied to the surface, such as grass blades in a lawn, particles in mud, or cracks in stone.
    - Repeated and tiled at a certain scale on the surface to represent detail texture when viewed up close.
    - Generally, one type of surface material corresponds to one diffuse map and normal map, etc.
  - Splat Map (Blend Weight Texture):
    - Can be understood as a weight map that "controls which detail texture is used for which part of the ground."
    - Uses RGBA four channels:
      - R channel controls the weight of "Texture A" on the ground;
      - G channel controls "Texture B";
      - B channel controls "Texture C";
      - A channel controls "Texture D".
    - The RGBA values of each pixel determine the blend ratio of 4 textures at that location.
    - The texture brush essentially edits the channel values of these Splat textures.

2. **Preparing Detail Textures**

Before using the brush to paint surface textures, you need to add detail textures (currently the engine supports up to 8 detail textures per terrain).

- Import detail texture images as assets;
- Select the `texture` brush in the terrain editing panel;
- Drag and drop detail albedo textures from the Assets view into the `Detail Albedo` list;
- Drag and drop detail normal textures from the Assets view into the `Detail Normal` list (can be omitted if there's no normal map);

3. **Painting Textures on the Surface**

- Click on a texture in the `Detail Albedo` list;
- Adjust appropriate brush size, strength, and other parameters;
- Use the mouse to paint this texture on the terrain;

<video src="https://cdn.zephyr3d.org/doc/assets/videos/texture-brush.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

### Grass Brush

The grass brush is used to batch plant grass clumps, wildflowers, and other vegetation on the terrain.

1. **Preparing Grass Textures**

Before painting grass, you need to add grass textures.

- Import grass texture images as assets;
- Select the `grass` brush in the terrain panel;
- Drag and drop grass textures from the Assets view into the `Grass Textures` list;

2. **Painting Grass on the Surface**

- Click on a grass texture in `Grass Textures`;
- Adjust appropriate brush size, strength, and other parameters;
- Use the mouse to paint grass on the terrain;

<video src="https://cdn.zephyr3d.org/doc/assets/videos/grass-brush.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

### Erase Grass Brush

If the grass is painted too densely, you can use the `erase grass` brush to remove it. The operation method is the same as the `grass` brush.
