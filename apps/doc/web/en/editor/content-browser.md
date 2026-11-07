# Asset Management

## Content Browser

Project assets are stored in IndexedDB and displayed in a virtual file system, similar to the folder view in Windows Explorer.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/content-browser-1080p.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

> **Note**  
> The `/assets/@builtins` directory is read‑only and contains engine‑built‑in assets.  
> It is not managed or modified by the user.

---

## Importing Assets

You can import assets by dragging files directly from your operating system into the **Content Browser**.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/import-asset.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

> **Note**  
> Uploaded model files (glTF/GLB, VRM/VRMA, FBX, OBJ) must be imported with **Import as Prefab** for the engine to load them; **Copy to project** only copies the original file into the project. Importing as a prefab offers three more options: **Rebuild prefab** and **Rebuild material** regenerate an existing prefab or material, and **Source Reference** only applies to single-file models with morph targets (GLB/VRM/FBX): the source file is copied into the project as well, and morph target data is rebuilt from it on demand instead of being stored in the generated mesh assets.
>
> Hair curves (Alembic `.abc`, `.hair`) dropped into the asset view open a separate hair import dialog that converts them to a `.zhair` asset for `HairNode`.

The model import dialog also offers **Compress Textures**, **Compress Vertices** and **Generate LODs**, all off by default. They mark the imported textures and meshes for compressed shipping or levels of detail; see [Asset Compression](en/editor/asset-compression.md). Settings for assets already in the project are under **Texture Settings...** and **Mesh Settings...** in the right-click menu.

---

## Managing Third‑Party Libraries

### Installing an `npm` Package

1. In the **Content Browser**, click the `📦` button to install an npm package.  
2. Enter the package name (you can include a version specifier).  
3. The system uses **esm.sh** to automatically pull the package as an ESM module.  
4. You can then import and use it directly in your scripts.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/install-package.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

### Removing an `npm` Package

1. Open **Project → Project Settings** from the menu.  
2. In the npm package list, right‑click the package you want to remove and choose **Remove**.

<video src="https://cdn.zephyr3d.org/doc/assets/videos/remove-package.mp4" controls width="640">
  Your browser does not support the video tag.
</video>
