
# Mesh

A **Mesh** is a renderable object composed of vertex data and materials.

We use the `Mesh` object to represent a mesh.  
Constructing a `Mesh` object requires three parameters — **scene**, **primitive**, and **material**:  
- **scene**: the scene object to which the mesh will be added after creation.  
- **primitive**: the vertex data for the mesh. You can use the built‑in shapes `SphereShape`, `BoxShape`, `PlaneShape`, and `CylinderShape` to create spheres, boxes, planes, or cylinders, or you can manually fill your own data.  
- **material**: the material for this mesh. The general-purpose materials are *Unlit* (non‑lit),
  Lambert/Blinn and PBR, and the examples on this page all use those. Beyond them there are several
  dedicated materials: [skin](en/material-skin.md), hair and eyes for character rendering, MToon for
  cartoon shading, terrain and foliage materials, and materials authored with editor blueprints.

---

## Using Predefined Meshes

The system provides several predefined geometric primitives such as a box, sphere, cylinder, and plane.

The following example creates a sphere mesh and assigns it a Lambert material.  
A directional light is added to illuminate the object (lighting will be discussed in later sections).

<<< @/../src/tut-5/main.js{js}

The three essential steps are on lines 28–31: create a `LambertMaterial`, set its `albedoColor`,
and hand the primitive and material to `new Mesh(scene, primitive, material)`.

A new mesh sits at the world origin by default, which is why line 35 puts the camera at `(0, 0, 4)`
looking at the origin. `lookAt(eye, target, up)` is defined on `SceneNode`, so cameras and ordinary
nodes both have it — line 25 uses the same method to orient the directional light.

<div class="showcase" case="tut-5"></div>

Next, we'll assign a PBR material to the sphere and add texture maps.

Textures are loaded with
[`ResourceManager.fetchTexture()`](/doc/markdown/./scene.resourcemanager.fetchtexture), which takes
a URL plus an optional [options object](/doc/markdown/./scene.texturefetchoptions) and returns a
promise. Results are cached — requesting the same path again will not re-fetch it.

<<< @/../src/tut-6/main.js{27-47 js}

`PBRMetallicRoughnessMaterial` describes a surface with the metallic/roughness workflow: higher
`metallic` looks more like metal, higher `roughness` spreads the highlight out.

**Note that the normal map on lines 40–42 passes `linearColorSpace: true` while the color map does
not.** This is not a stylistic choice: a color map stores sRGB-encoded color and must be converted
to linear space for lighting, whereas normal maps, metallic-roughness maps, masks and height maps
store **data** rather than color, and applying an sRGB conversion to them gives wrong results.
Forgetting this option usually shows up as incorrect bump direction and strength.

<div class="showcase" case="tut-6"></div>

---

## Loading Existing Materials

When using the editor workflow, you can create custom materials in the editor (`.zmtl`) and load
them at runtime with
[`ResourceManager.fetchMaterial()`](/doc/markdown/./scene.resourcemanager.fetchmaterial).

<<< @/../src/tut-50/main.js{js}

Compared with the earlier examples, this one adds `runtimeOptions.VFS` on lines 18–21. **Loading
editor-produced assets requires a configured VFS**, because the path in
`fetchMaterial('/assets/earth.zmtl')` is a VFS path rather than a URL — here `HttpFS` maps it onto
an HTTP root. Other VFS implementations (in-memory, IndexedDB) are covered in
[Virtual File System](en/vfs.md).

Note that the material loads asynchronously, so `new Mesh(...)` happens inside `then()` (line 34).

<div class="showcase" case="tut-50"></div>

---

## Manually Filling Vertex Data

To create a mesh manually, you need to create vertex buffers and index buffers,
upload the data, and assign them to a mesh primitive.

The example below manually creates a simple triangle mesh using an Unlit material.

<<< @/../src/tut-9/main.js{24-44 js}

Worth noting:

- A vertex buffer's **purpose is determined by its name**, not by extra arguments.
  `'position_f32x3'` means position data as three float32s; `'diffuse_u8normx4'` means vertex color
  as four normalized uint8s. The name encodes both semantics and data format, and the engine derives
  the vertex layout from it.
- Vertex colors require explicitly enabling `material.vertexColor = true` (line 28); otherwise the
  attribute takes no part in shading.
- A triangle has a single face, so the wrong winding order gets back-face culled and nothing appears.
  This example sidesteps that with `material.cullMode = 'none'` (line 26).

<div class="showcase" case="tut-9"></div>

---

## Loading Models

In real projects the most common way to create meshes is loading an existing model. There are two
paths:

1. **Load a prefab (recommended)** — import the model in the editor, save it as a Zephyr3D prefab
   (`.zprefab`), and load it at runtime with `instantiatePrefab()`.
2. **Load the source model directly** — install `@zephyr3d/loaders`, register the matching importer,
   and read glTF/GLB/FBX files with `fetchModel()`.

The first path is recommended: `@zephyr3d/scene` itself contains no model-format parsing code, so
going through prefabs keeps those importers out of your bundle. A prefab also stores a serialized
engine object graph, so material tweaks, node properties and scripts you set up in the editor are
restored with it. Use the second path when you need to load arbitrary user-supplied model files at
runtime. The tradeoff is covered in detail in
[Resource Loading and Model Import](en/asset-loading.md).

Here is the prefab example:

<<< @/../src/tut-10/main.js{js}

`instantiatePrefab(parent, path)` instantiates the prefab under the given parent node and returns the
instantiated root, which you can transform like any other node (line 32).

<div class="showcase" case="tut-10"></div>
