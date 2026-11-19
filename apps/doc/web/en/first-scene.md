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

The path given to `instantiatePrefab()` is a VFS path, not a URL. The VFS comes from
`runtimeOptions.VFS` when the application is created; without it, the default is `new HttpFS('./')`,
which maps the VFS root to **the directory of the current page**: for a page at
`https://example.com/game/index.html`, `/assets/Duck.zprefab` requests
`https://example.com/game/assets/Duck.zprefab`. When the assets are deployed next to the page (which
is how the editor's **Build Project** lays out its output), the default works and nothing needs to
be configured.

The example above is the other case: the page lives on the docs site while the assets sit on a CDN
under a different domain, so lines 16–19 replace the VFS with an `HttpFS` pointing at the CDN
directory. Passing a URL to `instantiatePrefab()` would not be enough: the prefab references its
meshes and materials by VFS paths such as `/assets/Duck_mesh_0.zmsh`, which always resolve against
the VFS root, so the VFS root must correspond to the project root the assets came from. For
cross-origin loading the asset server must also allow cross-origin requests (CORS).

<div class="showcase" case="tut-10"></div>

### Loading from several domains at once

When resources are spread over several servers, use one `HttpFS` as the root and **mount** the
others at paths under it:

```javascript
const vfs = new HttpFS('./'); // the page's directory: scripts, configuration, ...
// Editor-produced assets on a CDN. Mounted at /assets, so the /assets/... references
// inside prefabs go to the CDN as well
await vfs.mount('/assets', new HttpFS('https://cdn.example.com/game/assets'));
// Textures on another server, accessed as /textures/...
await vfs.mount('/textures', new HttpFS('https://images.example.com/textures'));
```

A read uses the longest matching mount path and replaces that part with the path inside the mounted
file system; paths matching no mount go to the root file system. Pass this `vfs` as
`runtimeOptions.VFS`, or call `mount()` on `getEngine().VFS` at runtime.

Two ways that skip mounting:

- A **self-contained** single file such as a texture, a GLB model or a JSON file can be loaded by
  passing a full `https://` URL to the resource API. The engine requests that URL as-is, bypassing
  the VFS root.
- The loading options accept `overrideVFS`, which makes just that one load use another file system.

Neither works for prefabs and scenes: the other assets they reference are still loaded by VFS path
from the current VFS. See [Resource Loading](en/asset-loading.md) and
[Virtual File System](en/vfs.md#mounting-and-combining-file-systems).

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
