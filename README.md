<div align="center">

  ![](https://cdn.zephyr3d.org/doc/assets/images/logo_theme.svg)

> A modern TypeScript rendering engine for the web — one codebase, WebGL / WebGL2 / WebGPU

[Documentation](https://zephyr3d.org/doc/) &nbsp;|&nbsp; [Demos](https://zephyr3d.org/en/demos.html) &nbsp;|&nbsp; [Online Editor](https://zephyr3d.org/editor/) &nbsp;|&nbsp; [API Reference](https://zephyr3d.org/doc/api/)

[![CI](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene?color=%235865f2&label=%40zephyr3d%2Fscene)](https://www.npmjs.com/package/@zephyr3d/scene)
[![License: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)

</div>

---

## What is Zephyr3D

Zephyr3D is a 3D rendering engine for the browser, written in TypeScript. It gives you two
levels to work at, and a visual editor on top of both:

- **Device API** — a graphics abstraction over WebGL, WebGL2 and WebGPU, including a shader
  system where you write shaders in TypeScript and the engine generates GLSL or WGSL per backend.
- **Scene API** — a complete renderer built on the Device API: scene graph, PBR materials,
  clustered lighting, shadows, character rendering, terrain, water, animation and post-processing,
  organized behind a render graph.
- **Editor** — a browser-based visual editor, plus an Electron desktop build with local projects
  and an embedded MCP server for agent-driven automation.

<div align="center">

<table>
<tr>
<td width="33%" align="center">
  <a href="https://zephyr3d.org/editor/?project=https%3A%2F%2Fcdn.zephyr3d.org%2Fdemos%2Ffloating&remote&open">
    <img src="https://cdn.zephyr3d.org/demos/thumbnails/floating.jpg" width="100%" alt="FFT ocean with buoyancy">
  </a>
  <sub><b>FFT ocean</b><br/>wave simulation + buoyancy</sub>
</td>
<td width="33%" align="center">
  <a href="https://zephyr3d.org/editor/?project=https%3A%2F%2Fcdn.zephyr3d.org%2Fdemos%2Fterrain&remote&open">
    <img src="https://cdn.zephyr3d.org/demos/thumbnails/walking.jpg" width="100%" alt="Clipmap terrain with grass">
  </a>
  <sub><b>Clipmap terrain</b><br/>runtime texturing + grass</sub>
</td>
<td width="33%" align="center">
  <a href="https://cdn.zephyr3d.org/demos/cardemo/index.html">
    <img src="https://cdn.zephyr3d.org/demos/thumbnails/car.jpg" width="100%" alt="PBR car rendering">
  </a>
  <sub><b>Car</b><br/>PBR + IBL + reflections</sub>
</td>
</tr>
<tr>
<td width="33%" align="center">
  <a href="https://zephyr3d.org/editor/?project=https%3A%2F%2Fcdn.zephyr3d.org%2Fdemos%2Flighting&remote&open">
    <img src="https://cdn.zephyr3d.org/demos/thumbnails/lighting.jpg" width="100%" alt="Clustered lighting with many lights">
  </a>
  <sub><b>Clustered lighting</b><br/>hundreds of dynamic lights</sub>
</td>
<td width="33%" align="center">
  <a href="https://cdn.zephyr3d.org/demos/oit/index.html">
    <img src="https://cdn.zephyr3d.org/demos/thumbnails/oit.jpg" width="100%" alt="Order-independent transparency">
  </a>
  <sub><b>Transparency</b><br/>order-independent blending</sub>
</td>
<td width="33%" align="center">
  <a href="https://zephyr3d.org/editor/?project=https%3A%2F%2Fcdn.zephyr3d.org%2Fdemos%2Fvrmdemo&remote&open">
    <img src="https://cdn.zephyr3d.org/demos/thumbnails/vrmdemo.jpg" width="100%" alt="VRM character rendering">
  </a>
  <sub><b>Characters</b><br/>VRM, skinning, blend shapes</sub>
</td>
</tr>
</table>

<sub>Click any image to run it live.</sub> &nbsp;·&nbsp; <a href="https://zephyr3d.org/en/demos.html"><b>All demos →</b></a>

</div>

---

## Quick start

```bash
npm install --save @zephyr3d/base @zephyr3d/scene @zephyr3d/backend-webgl @zephyr3d/backend-webgpu
```

A lit sphere you can orbit around:

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera, SphereShape,
  DirectionalLight, getInput, getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 0, 0, 1);
  new Mesh(scene, new SphereShape(), material);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
```

Real projects usually prefer WebGPU and fall back to WebGL — see
[Basic Framework](https://zephyr3d.org/doc/en/scene-basic.html) for backend selection, the HTML
scaffold and what each step does. Which packages you actually need depends on your case;
[Installation](https://zephyr3d.org/doc/en/installation.html) has the breakdown.

---

## Features

**Rendering pipeline**
Forward+ pipeline organized as a render graph with automatic resource pooling and history
buffers for temporal effects. Clustered lighting, Hi-Z, depth prepass,
[GPU picking](https://zephyr3d.org/doc/en/picking.html),
[geometry instancing](https://zephyr3d.org/doc/en/instancing-intro.html), render bundles,
[multi-view rendering](https://zephyr3d.org/doc/en/multi-views.html).

**Materials and lighting**
PBR (metallic-roughness and specular-glossiness), [image-based
lighting](https://zephyr3d.org/doc/en/lighting-intro.html), physical lighting units,
Lambert/Blinn/Unlit, MToon for stylized shading, and a [mixin-based
system](https://zephyr3d.org/doc/en/user-material.html) for custom materials.
[Material blueprints](https://zephyr3d.org/doc/en/editor/material-blueprint.html) author materials
as node graphs in the editor.

**Character rendering**
Skin with subsurface scattering profiles, eye material with socket occlusion, and hair as both
Kajiya-Kay and Marschner models with strand-level geometry expanded on the GPU. *(Guides for these
are written but not yet on the live doc site — see `apps/doc/web/en/material-skin.md`,
`material-hair.md` and `material-eye.md` in this repo.)*

**[Shadows](https://zephyr3d.org/doc/en/shadow-intro.html)**
PCF (several variants), PCSS, ESM, VSM, SSM and DOM shadows, with cascaded shadow maps and
receiver bias control. Pick per light based on the quality/cost tradeoff you want.

**[Post-processing](https://zephyr3d.org/doc/en/posteffect-intro.html)**
TAA, SSGI, SSR, SSAO, bloom, motion blur, FXAA, tonemapping, color grading, and separate
subsurface-scattering passes for skin.

**[Transparency](https://zephyr3d.org/doc/en/oit.html)**
Three order-independent transparency backends: A-buffer (WebGPU), dual depth peeling, and
weighted blended.

**Terrain, sky and water**
[Clipmap terrain](https://zephyr3d.org/doc/en/terrain-runtime.html) with runtime texturing and
grass layers, [atmospheric sky](https://zephyr3d.org/doc/en/sky.html), and
[ocean water](https://zephyr3d.org/doc/en/water.html) driven by FFT, Gerstner or FBM wave
generators.

**[Animation and simulation](https://zephyr3d.org/doc/en/animation-intro.html)**
Skeletal and keyframe animation with blending, masks and an action controller.
[Inverse kinematics](https://zephyr3d.org/doc/en/animation-ik.html) (CCD, FABRIK, two-bone),
[joint dynamics](https://zephyr3d.org/doc/en/animation-joint-dynamics.html), spring chains, GPU
cloth, GPU hair simulation,
[morph targets](https://zephyr3d.org/doc/en/animation-morph-target.html) and geometry caches.

**Asset pipeline**
glTF/GLB, FBX, Alembic and hair curve
[importers](https://zephyr3d.org/doc/en/asset-loading.html), a
[prefab system](https://zephyr3d.org/doc/en/serialization.html), [virtual file
system](https://zephyr3d.org/doc/en/vfs.html), and
[reference-counted resources](https://zephyr3d.org/doc/en/lifetime.html).

The [documentation](https://zephyr3d.org/doc/) covers these topic by topic — when to use each one,
how to tune it, and its backend limitations — rather than just listing properties.

---

## Shaders in TypeScript

Rather than maintaining parallel GLSL and WGSL sources, you describe the shader once in
TypeScript:

```ts
const program = device.buildRenderProgram({
  vertex(pb) {
    this.$inputs.pos = pb.vec3().attrib('position');
    this.$inputs.uv  = pb.vec2().attrib('texCoord0');
    this.$outputs.uv = pb.vec2();

    this.xform = pb.defineStruct([pb.mat4('mvpMatrix')])().uniform(0);

    pb.main(function () {
      this.$builtins.position =
        pb.mul(this.xform.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
      this.$outputs.uv = this.$inputs.uv;
    });
  },

  fragment(pb) {
    this.$outputs.color = pb.vec4();
    this.tex = pb.tex2D().uniform(0);

    pb.main(function () {
      this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);
    });
  }
});
```

From this single source the engine emits WebGL1 GLSL (attributes/varyings, classic uniforms),
WebGL2 GLSL (std140 UBOs, explicit outputs), WGSL, and the matching WebGPU bind group layouts
with computed buffer layouts. Bindings and shader code stay in sync, and you avoid hand-written
variants that drift apart.

The [Writing Shaders](https://zephyr3d.org/doc/en/shader.html) guide shows the generated output
side by side for each backend.

---

## Editor

<div align="center">

**[Try it in your browser →](https://zephyr3d.org/editor/)** &nbsp;·&nbsp;
**[Download the desktop build →](https://github.com/gavinyork/zephyr3d/releases)**

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Zephyr3D Web Editor">

</div>

The editor is itself built on the Scene and Device APIs. It covers scene editing, the content
browser, node-graph material blueprints, terrain sculpting and texturing, animation editing,
TypeScript scripting bound to scene entities, and a plugin API for custom tools and panels.

The **desktop build** (Electron) adds local project folders with persistent storage, an embedded
MCP server so AI agents can drive the editor directly, and a built-in LLM assistant. API keys are
stored locally, encrypted at rest.

Editor documentation: [overview](https://zephyr3d.org/doc/en/editor/overview.html) ·
[quick start](https://zephyr3d.org/doc/en/editor/getting-started.html) ·
[desktop editor](https://zephyr3d.org/doc/en/editor/desktop.html)

---

## Packages

The engine is split so you install only what you use. Packages are versioned independently.

| Package | Role |
|---|---|
| [`@zephyr3d/base`](https://www.npmjs.com/package/@zephyr3d/base) | Math, virtual file system, events, reference counting |
| [`@zephyr3d/device`](https://www.npmjs.com/package/@zephyr3d/device) | Graphics abstraction, shader generator, resource binding |
| [`@zephyr3d/backend-webgl`](https://www.npmjs.com/package/@zephyr3d/backend-webgl) | WebGL and WebGL2 backends |
| [`@zephyr3d/backend-webgpu`](https://www.npmjs.com/package/@zephyr3d/backend-webgpu) | WebGPU backend |
| [`@zephyr3d/scene`](https://www.npmjs.com/package/@zephyr3d/scene) | Scene graph, materials, lighting, shadows, animation, post FX |
| [`@zephyr3d/loaders`](https://www.npmjs.com/package/@zephyr3d/loaders) | glTF/GLB, FBX, Alembic, hair curve importers |
| [`@zephyr3d/imgui`](https://www.npmjs.com/package/@zephyr3d/imgui) | ImGui bindings for debug panels and tool UI |
| [`@zephyr3d/editor`](https://www.npmjs.com/package/@zephyr3d/editor) | Visual editor, desktop shell, plugin API types |

---

## Backend differences

The engine targets three graphics APIs and falls back silently when a capability is missing, so
test on your actual targets rather than assuming that error-free code means a feature is active.

- **WebGPU** — the full feature set, including compute shaders. Required for A-buffer OIT, DOM
  shadows, GPU cloth and hair simulation, and terrain shading cache.
- **WebGL2** — broad coverage, no compute shaders.
- **WebGL1** — supported for compatibility, with reduced features (no float depth, limited
  terrain layers, no instancing in some paths).

Zephyr3D also defaults to a **reverse-Z depth convention** for better far-distance precision,
selected once at load time via the `__ZEPHYR3D_REVERSE_Z__` build-time define. If you write custom
materials, use the depth constants exported from `@zephyr3d/base` (`DEPTH_CLEAR_VALUE`,
`DEPTH_COMPARE_DEFAULT`, ...) rather than hard-coding 0 or 1. Full details, including per-backend
behavior and the current limitation around oblique-clipped projections, are in
`apps/doc/web/en/reverse-z.md`.

---

## Documentation

| | |
|---|---|
| [Overview](https://zephyr3d.org/doc/en/intro.html) | What the engine is and where to start |
| [Installation](https://zephyr3d.org/doc/en/installation.html) | Which packages you need for your case |
| [Scene API guide](https://zephyr3d.org/doc/en/scene-basic.html) | Materials, lighting, shadows, animation, post FX, terrain, water |
| [Device API guide](https://zephyr3d.org/doc/en/device.html) | Writing your own renderer on the graphics abstraction |
| [Editor guide](https://zephyr3d.org/doc/en/editor/overview.html) | Visual workflow, scripting, plugins, publishing |
| [API reference](https://zephyr3d.org/doc/api/) | Generated from source |
| [Demos](https://zephyr3d.org/en/demos.html) | Ocean, terrain, car, clustered lighting, OIT, IK and more |

Documentation is available in [English](https://zephyr3d.org/doc/en/intro.html) and
[简体中文](https://zephyr3d.org/doc/zh-cn/intro.html).

> The published doc site currently lags this branch: guides for the render graph, character
> materials, SSGI, physical lighting and the getting-started walkthrough exist under
> `apps/doc/web/{en,zh-cn}/` but are not yet deployed.

---

## Status

Actively developed, maintained by one person. The engine is well past prototype — it drives its
own editor and a set of demos — but it has not reached 1.0 and APIs still change between minor
versions. Pin your versions.

It suits you if you are building custom tools or in-house editors, doing web rendering research,
or want to read a complete engine end to end. If you need long-term API stability guarantees
today, that is not something a project at this stage can promise.

Issues and pull requests are welcome.

---

## Support

Zephyr3D is developed in my free time. If the engine, the editor or the related write-ups have
been useful to you, you can support the work here:

**Ko-fi:** https://ko-fi.com/gavinyork2024

Support covers hosting and testing tools, and buys focused time for new features, performance
work, documentation and experimental rendering ideas. Trying Zephyr3D and sending feedback is
just as appreciated.

---

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
