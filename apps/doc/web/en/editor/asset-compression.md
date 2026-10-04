# Asset Compression

The editor can ship textures and meshes in compressed form: textures as **KTX2** (Basis Universal), meshes as **quantized, meshopt-compressed** binary `.zmsh`. Compression reduces both what players download and what the GPU holds in memory.

Compression is **opt-in**. A texture or mesh is only compressed when its settings ask for it, so updating the engine or editor never changes how an existing project ships. Your source files are never modified: the editor derives compressed copies alongside them.

---

## Turning Compression On

### When Importing a Model

The import dialog has three options, all **off by default**:

| Option | Effect |
| --- | --- |
| **Compress Textures** | The model's textures are marked for compression |
| **Compress Vertices** | The model's meshes are marked for compression |
| **Generate LODs** | The model's meshes get [levels of detail](en/mesh-lod.md); **Min Triangles** (default 100) sets the fewest triangles a level may have, **Triangles Per Level** (default 0.5) the fraction each level keeps and **Pixel Error** (default 8) the switch distances, as in the mesh settings below. Set them here when a model has many meshes, rather than mesh by mesh afterwards |

The options only affect assets created by this import. Textures and meshes that already have settings keep them, so re-importing a model never undoes settings you tuned by hand.

### For Existing Assets

Right-click assets in the **Content Browser**:

- **Texture Settings...** on images
- **Mesh Settings...** on `.zmsh` meshes

Both accept multiple selected files. With several selected, only the fields you change are written to each of them; for example, setting a max size for twenty textures leaves each texture's own usage alone.

---

## Texture Settings

| Setting | Meaning |
| --- | --- |
| **Usage** | What the texture holds: Color (sRGB), Normal Map, Mask / Linear Data, HDR, or UI. Decides the color space and the default encoding |
| **Compression** | **Auto** picks from the usage; **ETC1S** is smallest; **UASTC** is highest quality; **None** ships the source image |
| **Quality** | Encoder quality and file size trade-off |
| **Max Size** | Downscales textures larger than this |
| **Generate Mipmaps** | Builds the mip chain during compression |

When a model is imported, each texture's usage is taken from the material slot that references it: a texture in a normal slot becomes a Normal Map, one in an sRGB color slot becomes Color, other data becomes Mask. Images added any other way are classified by file name (`_normal`, `_nrm`, `_orm`, `_roughness`, `_ao` and similar suffixes). Correct the usage if the guess is wrong; it matters for quality.

With **Auto**, color textures use ETC1S, while normal maps and masks use UASTC: block artifacts on a normal map are amplified by lighting, and packed mask channels would bleed into each other.

### ETC1S and UASTC Are Not GPU Formats

ETC1S and UASTC are Basis Universal's storage formats. One KTX2 file serves every device: when it loads, it is transcoded in a background worker to the best format the GPU supports (BC7 on desktop GPUs, ETC2 or ASTC on mobile, uncompressed RGBA8 as the last resort). You never pick a per-platform format.

The quality ceiling is set by the storage format: an ETC1S texture transcoded to BC7 still looks like ETC1S.

---

## Mesh Settings

| Setting | Meaning |
| --- | --- |
| **Compression** | **meshopt** stores the vertex data compressed and quantized; **None** ships the source mesh |
| **Normal Precision** | **12 bit** (default), **8 bit**, **16 bit**, or **Keep float** |

What compression does to each vertex attribute:

| Attribute | Stored as |
| --- | --- |
| Normals, tangents | Octahedral-encoded; 16-bit integers at 12 or 16 bit, 8-bit integers at 8 bit |
| Vertex colors in the 0–1 range | 8-bit; brighter (HDR) colors are kept as they are |
| Skin weights | 8-bit, renormalized so each vertex's weights still add up to exactly 1 |
| Positions, texture coordinates, skin indices | Unchanged |

Vertex order is always preserved, so skinning, morph targets and geometry caches keep working.

About normal precision: 8-bit normals are off by up to about 0.8 degrees, which shows as a slightly ragged light/shadow boundary on smooth, low-polygon surfaces such as car paint or ceramics. 12 bits (about 0.05 degrees) is visually exact and is the default. 8 bits saves the most GPU memory where that does not matter.

Parametric shapes created in the editor's primitive editor are tiny and are always shipped as they are.

---

## Levels of Detail (LOD)

The mesh settings dialog can also generate levels of detail, simplified versions a mesh switches to farther from the camera. They are independent of compression: levels of detail without compression are fine, the derived copy then holds the uncompressed vertex data plus the indices of every level. How levels are chosen at runtime is covered in [Levels of Detail (LOD)](en/mesh-lod.md).

| Setting | Meaning |
| --- | --- |
| **Generate LODs** | Generates levels of detail. Off by default |
| **Min Triangles** | Fewest triangles a level may have, default 100. The number of levels follows from it |
| **Triangles Per Level** | Fraction of the previous level's triangles each level keeps, default 0.5 |
| **Pixel Error** | Pixel error the automatic switch distances allow, default 8. Higher values switch to simpler levels closer to the camera |

How the levels are made:

- Every level is simplified straight from the source mesh to its triangle target (the source count times the fraction for level 1, times its square for level 2, and so on) with [meshoptimizer](https://github.com/zeux/meshoptimizer). Simplification takes normals into account and keeps texture seams.
- Simplification only writes new indices; **the vertex buffers and vertex order are unchanged**, so skinned meshes and meshes with morph targets can have levels too. The bone count is not reduced.
- Levels are added while the next one keeps at least Min Triangles triangles, up to 8 levels including the source. A mesh with too few triangles gets no levels and ships its source as it is. The dialog shows the triangle count of each level the settings aim for.
- When simplifying further removes no more triangles, or removes more than Min Triangles allows, no further levels are made, so a mesh may end up with fewer levels than the dialog estimates. Once the derived copy is ready, the dialog shows how many were made.
- Each level's switch distance comes from its simplification error, computed as UE's automatic LOD screen sizes: a level is used once its error projects to fewer than Pixel Error pixels on a 1920 pixel wide view with a 90 degree field of view.

Only triangle list meshes get levels of detail; meshes of other topologies ignore these settings.

---

## Where Settings Are Stored

Settings live in a `.zmeta` file next to the asset: `rock.png` has `rock.png.zmeta`.

- The Content Browser hides `.zmeta` files. Renaming, moving, copying or deleting an asset there carries its `.zmeta` along.
- An asset without a `.zmeta`, or with an unreadable one, is not compressed.
- `.zmeta` files are editor data. They are kept in the project and in project exports, but not shipped in builds.

If you move or delete files outside the editor, move or delete their `.zmeta` files too.

---

## Background Compression

Compression runs in the background:

- When a project opens, every asset set for compression whose compressed copy is missing is queued. Changing settings, or editing a source file, queues it again.
- The status bar shows progress, such as `Compressing assets 3/12: rock.png`. Failures are counted there and explained in the console.
- The editor itself loads the compressed copies, so what you see in the viewport is what players get.

The bottom line of the settings dialogs shows where an asset stands (the mesh settings dialog says `Derived copy`, as the copy may only add levels of detail), for example:

```
Compressed copy: 2048.0 KB -> 683 KB, in use in the editor
```

**in use in the editor** confirms the viewport is actually showing the compressed copy; good compression is hard to tell from the source by eye. **not loaded yet** means the copy is ready but the scene still shows what it loaded earlier: reopen the scene to switch over.

Compressed copies are cached under `/.cache/derived` in the project, keyed by the source content, the settings and the encoder version, so unchanged assets are never compressed twice. The cache is hidden in the Content Browser and left out of project exports. It can be deleted at any time and is rebuilt as needed.

---

## In Builds

**Build Project** ships the compressed copy of each asset set for compression, and the source file of everything else; see [Build & Deployment](en/editor/build-deploy.md). Scenes and scripts keep referencing source paths such as `/assets/rock.png`. The build lists which shipped file serves each of them in `asset-manifest.json`, and the engine reads that file at startup.

If your scripts read an image or mesh file directly, for example with `fetch()` or `VFS.readFile()`, rather than loading it through the resource manager, set that asset's compression to **None**, and for a mesh turn off Generate LODs: the source file of an asset with a derived copy is not in the build.

---

## Current Limitations

- Only PNG, JPEG and WebP images can be compressed; TGA, HDR and EXR images are shipped as they are.
- Normal maps are compressed with all three channels; two-channel normal map formats (BC5, EAC RG) are not used yet.
- Mesh positions and texture coordinates are not quantized.
- A scene that is already open keeps the assets it loaded; changed compression settings show after reopening it.
