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
> When importing model files (currently GLTF/GLB only), you should choose to import them as a **Prefab** so the engine can load and reuse them correctly.

> _Image placeholder: Content Browser UI_

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

<video src="https://cdn.zephyr3d.org/doc/assets/videos/remove-package-1080p.mp4" controls width="640">
  Your browser does not support the video tag.
</video>
