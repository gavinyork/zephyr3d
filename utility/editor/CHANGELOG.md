# Change Log - @zephyr3d/editor

This log was last generated on Fri, 06 Nov 2026 12:12:00 GMT and should not be manually modified.

## 0.4.0
Fri, 06 Nov 2026 12:12:00 GMT

### Minor changes

- Drop the WebGL1 target; projects targeting WebGL now use WebGL2.
- Opt-in asset compression: per-texture .zmeta settings, KTX2 textures and meshopt meshes built in a background derived data cache and shipped through an asset manifest.
- Generate mesh levels of detail by minimum triangle count at import; add wireframe and LOD coloration views to the View menu.
- Builds show an HTML loading screen until the startup scene is drawn.
- Add rigid body physics: Add Physics presets with undo, outlines of colliders, joints and wheels, scene physics settings with a collision layer editor, simulation in Play and Preview, and builds that ship the physics engine only when a project uses it.
- Extend the MCP tools to terrain (height sampling, scripted height/splat/grass generation, detail and grass layers), node_create for every Add menu class, foliage, physics presets, SDF bake and queries, water interaction, GI probe and voxel queries, the pipeline recorder, frame timing and preview console logs.
- Add foliage editing: a layer list, a density mask painting brush and deterministic regeneration.
- Add WebGPU compute erosion brushes with persistent hydraulic flow and wind sediment transport. Collider outlines are now hidden by default behind View > Show Colliders.
- Add the Bake SDF dialog (Mesh Settings > Bake SDF) and the Distance Field view.
- Record the pipelines a project preview uses into pipeline-cache.json, ship it with builds and compile it on the loading screen before the startup scene starts.
- Show a default loading screen with the engine logo and progress in builds and previews, and preload the assets each scene requests.
- Add Create Example Scene (Cornell Box, Buildings, Terrain).

### Patches

- Add serializable GPU cloth component.

## 0.3.16
Mon, 14 Sep 2026 20:07:40 GMT

### Patches

- Support retarget reference pose configuration for skeletons; fix humanoid retargeting of root and pelvis position; fix external retarget pose bone namespace matching.
- Fix the plugin menu not refreshing when a project is first opened.
- Improve resource service handling and import option dialogs

## 0.3.15
Tue, 01 Sep 2026 07:54:12 GMT

### Patches

- Material workflow: switch a material instance's parent material, clone materials, material preview toggle, resizable instance property panel, HDR color parameter editing, and instance sync after parent material hot reload.
- Add editor support for the eye and hair materials.
- Assets: drag scene nodes into the asset window to create prefabs, drag .zmsh geometry into the scene, export default zmsh primitives to GLB, clone primitives, and a unified import source-reference toggle with FBX reference mode.
- Project settings: morph target limit and active morph upload limit, skin influence limit (with runtime downgrade notice).
- A batch of UI/interaction fixes: asset tree expansion state and occasional jump back to root, first-click focus in property panel text fields, script panel conditional visibility and duplicate array entries, Shift to batch expand/collapse, Ctrl+D duplicate, AABB editing, hidden dev-server child process window, and plugin unload lifecycle.

## 0.3.14
Thu, 06 Aug 2026 08:52:56 GMT

### Patches

- Store terrain grass as density maps instead of per-instance data

## 0.3.13
Tue, 04 Aug 2026 10:43:23 GMT

### Patches

- Improve LLM/MCP

## 0.3.12
Sun, 19 Jul 2026 16:11:50 GMT

### Patches

- Add profiler window for render graph GPU timings

## 0.3.11
Thu, 16 Jul 2026 11:10:12 GMT

### Patches

- Upgrade engine version

## 0.3.10
Sat, 11 Jul 2026 13:49:41 GMT

### Patches

- Adjust camera when editing primitive

## 0.3.9
Fri, 10 Jul 2026 09:44:15 GMT

### Patches

- Add primitive editor
- Fix PCSS for point light

## 0.3.8
Mon, 06 Jul 2026 06:18:13 GMT

### Patches

- Add graph profiler

## 0.3.7
Thu, 02 Jul 2026 20:22:25 GMT

### Patches

- Add icon for macOS version of editor

## 0.3.6
Thu, 02 Jul 2026 18:25:31 GMT

### Patches

- Update electron builder configurations.

## 0.3.5
Thu, 25 Jun 2026 08:26:57 GMT

### Patches

- Fix external library not working

## 0.3.4
Tue, 23 Jun 2026 16:50:23 GMT

### Patches

- Improve editor workflow

## 0.3.3
Thu, 04 Jun 2026 07:58:17 GMT

### Patches

- Integrate new loader API
- Fix project compilation error

## 0.3.2
Tue, 19 May 2026 07:41:46 GMT

### Patches

- Fix custom input doesnot correctly handle double-click
- Add text node support

## 0.3.1
Tue, 12 May 2026 11:06:29 GMT

### Patches

- Add README.md

## 0.3.0
Tue, 12 May 2026 03:53:58 GMT

### Minor changes

- Add standalone version by electron

### Patches

- Add in-editor LLM support

## 0.2.0
Wed, 29 Apr 2026 18:55:40 GMT

### Minor changes

- Add plugin system

## 0.1.1
Mon, 04 Nov 2024 16:19:45 GMT

_Initial release_

