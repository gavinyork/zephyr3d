# Adding Models and Materials

Picking up from the empty scene in [Your First Application](en/first-app.md), let's put something
in it.

## A mesh is a primitive plus a material

Visible objects in a scene are `Mesh` nodes, made of two parts:

- a **primitive** — vertex data, defining the shape;
- a **material** — defining how the surface responds to light.

Several primitives are built in: `BoxShape`, `SphereShape`, `PlaneShape`, `CylinderShape`,
`TorusShape`.

<<< @/../src/tut-5/main.js{22-36 js}

Note the directional light on lines 24–25. **Most materials render black with no light in the
scene**, so add lighting along with your objects.

A new mesh sits at the world origin, so the camera goes to `(0, 0, 4)` and uses `lookAt()` to face
it. `lookAt(eye, target, up)` is defined on `SceneNode`, so cameras and ordinary nodes — including
the directional light here — all have it.

<div class="showcase" case="tut-5"></div>

## Choosing a material

The engine ships many materials. Three are enough to start:

| Material | Use for |
| --- | --- |
| `UnlitMaterial` | Unlit; flat-color markers, helpers, effects |
| `LambertMaterial` | Simple diffuse, cheap; stylized or performance-sensitive scenes |
| `PBRMetallicRoughnessMaterial` | Physically based; the default choice for realistic looks |

There are also dedicated materials for skin, hair, eyes and cartoon shading (MToon), plus materials
authored with editor blueprints. Those can wait until the basics are familiar.

## Adding textures

A PBR material needs textures to show its strengths:

<<< @/../src/tut-6/main.js{27-45 js}

Higher `metallic` looks more like metal; higher `roughness` spreads the highlight out.

**Note that the normal map passes `linearColorSpace: true` and the color map does not.** This is not
a stylistic choice: a color map stores sRGB-encoded color that must be converted to linear space for
lighting, whereas normal maps, metallic-roughness maps, masks and height maps store **data** rather
than color, and an sRGB conversion gives wrong results. Forgetting it usually shows up as incorrect
bump direction and strength.

Texture loading is asynchronous and `fetchTexture()` returns a promise. Loaded resources are cached,
so the same path is not fetched twice.

## Loading models

Most objects in a real project come from model files rather than built-in primitives. There are two
paths:

1. **Load a prefab (recommended)** — import the model in the editor, save it as `.zprefab`, and load
   it at runtime with `instantiatePrefab()`.
2. **Load the source model directly** — install `@zephyr3d/loaders`, register an importer, and read
   glTF/GLB/FBX with `fetchModel()`.

The first is recommended: `@zephyr3d/scene` contains no model-format parsing code, so prefabs keep
those importers out of your bundle. A prefab also stores a serialized engine object graph, so
material tweaks, node properties and scripts authored in the editor come back with it. Use the second
path when you need to load arbitrary user-supplied models at runtime. See
[Resource Loading and Model Import](en/asset-loading.md).

<<< @/../src/tut-10/main.js{js}

Loading editor-produced assets **requires a configured VFS** (lines 18–21) — the path given to
`instantiatePrefab()` is a VFS path, not a URL, and `HttpFS` maps it onto an HTTP root here. Other
VFS implementations (in-memory, IndexedDB) are covered in [Virtual File System](en/vfs.md).

<div class="showcase" case="tut-10"></div>

## Organising the hierarchy

Nodes form a tree, and every node's transform is relative to its parent. Move a parent and all of its
descendants follow:

```javascript
child.parent = parent;
child.position.setXYZ(0, 2, 0);   // 2 units above parent
```

That mechanism, along with traversal, lookup, visibility and bounding volumes, is covered in
[Scene Graph and Nodes](en/scene-graph.md).

## Next

- [Shadows and Post-processing](en/first-polish.md) — making it look presentable
