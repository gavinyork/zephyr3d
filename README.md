<div align="center">

  ![](https://cdn.zephyr3d.org/doc/assets/images/logo_theme.svg)

### Bringing advanced real-time rendering techniques to the browser.

A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering,<br/>
a single-source shader system, and a visual editor.

[Documentation](https://zephyr3d.org/doc/) &nbsp;|&nbsp; [Demos](https://zephyr3d.org/en/demos.html) &nbsp;|&nbsp; [Online Editor](https://zephyr3d.org/editor/) &nbsp;|&nbsp; [API Reference](https://zephyr3d.org/doc/api/)

[![CI](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene?color=%235865f2&label=%40zephyr3d%2Fscene)](https://www.npmjs.com/package/@zephyr3d/scene)
[![License: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)

<br/>

[![Star this repo](https://img.shields.io/github/stars/gavinyork/zephyr3d?style=social&label=Star)](https://github.com/gavinyork/zephyr3d)
&nbsp;
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/gavinyork)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/gavinyork2024)

</div>

---

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
npm install --save @zephyr3d/base @zephyr3d/scene @zephyr3d/backend-webgpu @zephyr3d/backend-webgl
```

A lit sphere you can orbit around. It runs on WebGPU when the browser supports it and falls
back to WebGL2 otherwise:

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera, SphereShape,
  DirectionalLight, getInput, getEngine
} from '@zephyr3d/scene';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2,
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

[Basic Framework](https://zephyr3d.org/doc/en/scene-basic.html) walks through the HTML scaffold and
what each step does. Which packages you actually need depends on your case;
[Installation](https://zephyr3d.org/doc/en/installation.html) has the breakdown.

---

## Rendering techniques

Most of the engine's depth goes into a few areas that are usually hard to get on the web.

**Characters**
Skin with subsurface scattering and transmission, an eye material with socket occlusion, and hair
with Kajiya-Kay and Marschner shading, expanded into strands on the GPU and simulated in compute
shaders. MToon and VRM support for stylized characters.

**Natural environments**
[Ocean water](https://zephyr3d.org/doc/en/water.html) driven by FFT, Gerstner or FBM waves, with
caustics, refraction and interaction with floating objects.
[Clipmap terrain](https://zephyr3d.org/doc/en/terrain-runtime.html) with runtime texturing,
virtual texturing and grass layers. [Atmospheric sky](https://zephyr3d.org/doc/en/sky.html) and
height fog.

**[Shadows](https://zephyr3d.org/doc/en/shadow-intro.html) and [transparency](https://zephyr3d.org/doc/en/oit.html)**
PCF (several variants), PCSS, ESM, VSM, SSM and DOM shadows, with cascaded shadow maps and contact
shadows — pick per light based on the quality/cost tradeoff you want. Three order-independent
transparency backends: A-buffer (WebGPU), dual depth peeling, and weighted blended.

**Lighting and [post-processing](https://zephyr3d.org/doc/en/posteffect-intro.html)**
PBR materials (metallic-roughness and specular-glossiness) with
[image-based lighting](https://zephyr3d.org/doc/en/lighting-intro.html) and physical lighting
units, clustered lighting for hundreds of dynamic lights, and rect area lights. TAA, SSGI, SSR,
SSAO, bloom, motion blur, tonemapping and color grading.

### Also in the box

- **Pipeline** — Forward+ renderer organized as a render graph with automatic resource pooling and
  history buffers. Hi-Z, depth prepass, [GPU picking](https://zephyr3d.org/doc/en/picking.html),
  [instancing](https://zephyr3d.org/doc/en/instancing-intro.html) with GPU culling, mesh LOD,
  render bundles, [multi-view rendering](https://zephyr3d.org/doc/en/multi-views.html).
- **Materials** — Lambert/Blinn/Unlit, a [mixin-based system](https://zephyr3d.org/doc/en/user-material.html)
  for custom materials, and [material blueprints](https://zephyr3d.org/doc/en/editor/material-blueprint.html)
  authored as node graphs in the editor.
- **[Animation and simulation](https://zephyr3d.org/doc/en/animation-intro.html)** — skeletal and
  keyframe animation with blending, masks and an action controller;
  [inverse kinematics](https://zephyr3d.org/doc/en/animation-ik.html) (CCD, FABRIK, two-bone),
  [joint dynamics](https://zephyr3d.org/doc/en/animation-joint-dynamics.html), spring chains, GPU
  cloth, [morph targets](https://zephyr3d.org/doc/en/animation-morph-target.html) and geometry caches.
- **Assets** — glTF/GLB, FBX, Alembic and hair curve
  [importers](https://zephyr3d.org/doc/en/asset-loading.html), KTX2 texture compression, a
  [prefab system](https://zephyr3d.org/doc/en/serialization.html), a
  [virtual file system](https://zephyr3d.org/doc/en/vfs.html), and
  [reference-counted resources](https://zephyr3d.org/doc/en/lifetime.html).

The [documentation](https://zephyr3d.org/doc/) covers these topic by topic — when to use each one,
how to tune it, and its backend limitations — rather than just listing properties.

---

## One shader source, two backends

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

From this single source the engine emits WGSL and WebGL2 GLSL (std140 UBOs, explicit outputs),
together with the matching WebGPU bind group layouts and computed buffer layouts. Bindings and
shader code stay in sync, and you avoid hand-written variants that drift apart.

The [Writing Shaders](https://zephyr3d.org/doc/en/shader.html) guide shows the generated output
side by side for each backend.

---

## A visual editor built on the engine

<div align="center">

**[Try it in your browser →](https://zephyr3d.org/editor/)** &nbsp;·&nbsp;
**[Download the desktop build →](https://github.com/gavinyork/zephyr3d/releases)**

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Zephyr3D Web Editor">

</div>

The editor is itself built on the Scene and Device APIs, so what you see in it is what the engine
renders. It covers scene editing, the content browser, node-graph material blueprints, terrain
sculpting and texturing, animation editing, TypeScript scripting bound to scene entities, and a
plugin API for custom tools and panels.

The **desktop build** (Electron) adds local project folders with persistent storage, an embedded
MCP server that lets AI agents and external tools drive the editor, and a built-in LLM assistant.
API keys are stored locally, encrypted at rest.

Editor documentation: [overview](https://zephyr3d.org/doc/en/editor/overview.html) ·
[quick start](https://zephyr3d.org/doc/en/editor/getting-started.html) ·
[desktop editor](https://zephyr3d.org/doc/en/editor/desktop.html)

---

## Is it a good fit?

**Zephyr3D is a good fit if you are**

- building a web project that needs character, water or terrain rendering beyond what
  general-purpose libraries offer out of the box;
- building custom tools or an in-house editor, and want an engine whose source you can follow
  end to end;
- doing web rendering research, or learning how a complete engine is put together.

**It may not be the right choice yet if**

- you depend on a large third-party ecosystem of plugins, loaders and community examples;
- your scenes rely on bounce light indoors — there is no baked or probe-based global illumination
  yet, only screen-space GI. Probe-based GI is planned after 1.0;
- you need long-term API stability guarantees today (see [Status](#status)).
---

## Support

Zephyr3D is developed and maintained by one person in their free time — the engine, the editor,
the documentation and the demos are all unpaid work. If any of it has been useful to you,
sponsorship is what pays for hosting, CI and testing hardware, and buys focused blocks of time
for new features, performance work and documentation.

<div align="center">

[![Sponsor on GitHub](https://img.shields.io/badge/GitHub_Sponsors-%E2%9D%A4_Sponsor-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/gavinyork)
&nbsp;
[![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-Buy_me_a_coffee-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/gavinyork2024)

</div>

Ways to help that cost nothing, but matter just as much:

- **Star the repo** — it is the main signal that keeps the project visible.
- **Ask and answer in [Discussions](https://github.com/gavinyork/zephyr3d/discussions)** — real
  usage questions shape the docs and the roadmap.
- **Report what breaks**, with a minimal reproduction if you can. For a rendering engine, a
  screenshot plus the backend and GPU you are on is worth a lot.
- **Tell people** when a demo or a write-up helped — that reach is how a project like this finds
  the people who end up sponsoring it.

For **commercial use, integration help or a support arrangement**, open a thread in
[Discussions](https://github.com/gavinyork/zephyr3d/discussions) or write to
`gavinyork2024@outlook.com` so we can talk about what you need.

---

## Packages

The engine is split so you install only what you use. Packages are versioned independently.

| Package | Role |
|---|---|
| [`@zephyr3d/base`](https://www.npmjs.com/package/@zephyr3d/base) | Math, virtual file system, events, reference counting |
| [`@zephyr3d/device`](https://www.npmjs.com/package/@zephyr3d/device) | Graphics abstraction, shader generator, resource binding |
| [`@zephyr3d/backend-webgl`](https://www.npmjs.com/package/@zephyr3d/backend-webgl) | WebGL2 backend |
| [`@zephyr3d/backend-webgpu`](https://www.npmjs.com/package/@zephyr3d/backend-webgpu) | WebGPU backend |
| [`@zephyr3d/scene`](https://www.npmjs.com/package/@zephyr3d/scene) | Scene graph, materials, lighting, shadows, animation, post FX |
| [`@zephyr3d/loaders`](https://www.npmjs.com/package/@zephyr3d/loaders) | glTF/GLB, FBX, Alembic, hair curve importers |
| [`@zephyr3d/imgui`](https://www.npmjs.com/package/@zephyr3d/imgui) | ImGui bindings for debug panels and tool UI |
| [`@zephyr3d/modelgen`](https://www.npmjs.com/package/@zephyr3d/modelgen) | Dependency-free procedural mesh generation |
| [`@zephyr3d/procgen`](https://www.npmjs.com/package/@zephyr3d/procgen) | Procedural scene generation (shape grammar, wave function collapse) |
| [`@zephyr3d/editor`](https://www.npmjs.com/package/@zephyr3d/editor) | Visual editor, desktop shell, plugin API types |

---

## Backend differences

The engine targets two graphics APIs and falls back silently when a capability is missing, so
test on your actual targets rather than assuming that error-free code means a feature is active.

- **WebGPU** — the full feature set, including compute shaders. Required for A-buffer OIT, DOM
  shadows, GPU cloth and hair simulation, and terrain shading cache.
- **WebGL2** — broad coverage, no compute shaders. WebGL1 is no longer supported.

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

---

## Status

Actively developed, maintained by one person. The engine is well past prototype — it drives its
own editor and a set of demos — but it has not reached 1.0 and APIs still change between minor
versions. Pin your versions.

Every change runs through unit tests and a visual regression suite that renders reference scenes
on both WebGPU and WebGL2 in CI. The 1.0 release will mark a stable core API with a documented
deprecation policy; until then, long-term API stability is not something this project can promise.

Questions and design discussions are best raised in
[Discussions](https://github.com/gavinyork/zephyr3d/discussions); bugs and confirmed feature
requests belong in the issue tracker. If you want to send a pull request, read
[CONTRIBUTING.md](CONTRIBUTING.md) first — it explains where the project is and is not ready to
take outside code.

---

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
