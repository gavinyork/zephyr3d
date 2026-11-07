# Quick Start

## Open the Editor

- Online: [https://zephyr3d.org/editor/](https://zephyr3d.org/editor/)
- Desktop: download from [GitHub Releases](https://github.com/gavinyork/zephyr3d/releases); see [Desktop Editor](en/editor/desktop.md)

> **System Requirements (browser build)**
> - IndexedDB support  
> - WebGL2 or WebGPU support  
> - ES modules support  

### Create or Open a Project

On the home screen you can choose:

- **Create Project** – Create a new project. The project will be stored in IndexedDB.  
- **Open Project** – Open an existing project stored in IndexedDB.  
- **Open Remote Project** – Open a remote project in read‑only mode via URL (see below).  
- **Import Project** – Import a project from your local disk into IndexedDB.

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-main.png" width="1024"/>

### The Fastest Start: Example Scenes

After creating a project, choose `Scene > Create Example Scene...`, pick **Cornell Box**, **Buildings** or **Terrain**, adjust its parameters if you like, and confirm; the editor builds a complete example scene. Save the scene and press the run button on the toolbar to see it running in the browser. The global illumination in Cornell Box needs WebGPU.

### Opening a Remote Project

**Open Remote Project** reads a project directory published on a static server, and that directory must contain `filelist.json`. Export the project with `Project > Export Project`, unpack the zip on a static server, then enter the directory's URL in Open Remote Project.

A link can also be shared directly: `https://zephyr3d.org/editor/?project=<project directory URL>&remote&open` opens the project read-only in the editor.

### What You Can Do with a Project

Once a project is open, you can:

- Manage project assets  
- Edit scene content  
- Write and manage scripts  
- Configure project settings  
- Preview and publish your project  
