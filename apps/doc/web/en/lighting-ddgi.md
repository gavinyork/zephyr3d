# SDF-based DDGI

Dynamic diffuse global illumination (DDGI) traces probe rays through the scene SDF and interpolates probe irradiance and visibility on surfaces. Zephyr3D combines a voxel material field with a multi-level probe clipmap, which suits moving cameras in medium-sized indoor and outdoor scenes.

## Enable it

```ts
scene.sdf.enabled = true;
scene.gi.enabled = true;

scene.gi.probeSpacing = 1;
scene.gi.probeGrid = [32, 16, 32];
scene.gi.probeLevels = 4;
scene.gi.probeRays = 128;
scene.gi.probeBudget = 4096;
```

Enabling `scene.gi` keeps the scene SDF enabled. Only static meshes with baked fields enter the voxel material field; set `scene.gi.terrainAlbedo` when terrain data does not provide an albedo yet.

`probeSpacing` controls near-field detail, `probeLevels` expands coverage, `probeRays` improves per-probe quality, and `probeBudget` controls updates per frame. A higher `probeHysteresis` reduces noise but slows changes. Increase `probeNormalBias` or `probeViewBias` when leakage appears, then verify that the SDF is closed and the scene scale is correct.

Keep `updateMode = 'continuous'` for changing scenes. A converged volume can be saved and frozen:

```ts
const state = await scene.gi.exportProbeState();
scene.gi.importProbeState(state); // imports also select frozen mode
scene.gi.updateMode = 'frozen';
```

DDGI, the global SDF, and voxel lighting are WebGPU-only. The first frames wait for SDF streaming, voxelization, and probe convergence. Use `scene.gi.getStats()` and `scene.sdf.getStats()` to inspect support, updates, missing fields, and residency. `atlasSize`, `voxelizeBudget`, and `lightingSlicesPerFrame` are the main memory and update-cost controls.
