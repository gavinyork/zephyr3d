
# Overview

**Zephyr3D** is a browser-based 3D rendering framework that provides two sets of APIs and a fully integrated, WYSIWYG (What You See Is What You Get) visual editor.

## APIs

### Device API

The **Device API** provides a set of low-level abstraction interfaces that allow users to call WebGL, WebGL2, and WebGPU graphics APIs in a unified way.  
These interfaces cover most of the underlying graphics API capabilities, enabling easy cross-API rendering support.

One major challenge in cross-platform rendering is the difference between shader languages — WebGL and WebGL2 use **GLSL**, while WebGPU uses **WGSL**.  
To solve this problem, Zephyr3D provides a **dynamic shader generation system**. Users can write shaders directly in **native JavaScript**, and the framework will automatically generate the corresponding GLSL or WGSL code for each backend.  
This approach eliminates the need for complex string concatenation or extensive `#ifdef` preprocessing, offering high flexibility and clarity.

### Scene API

The **Scene API** is a high-level rendering framework built on top of the Device API.  
It serves both as a testing environment for the Device API and as a ready-to-use rendering system for application development.

Current features include:

**Rendering pipeline**

Forward+ pipeline organized as a render graph with automatic resource pooling and history
buffers for temporal effects. Clustered lighting, Hi-Z, depth prepass,
[GPU picking](./picking.html),
[geometry instancing](./instancing-intro.html), render bundles,
[multi-view rendering](./multi-views.html).

**Materials and lighting**

PBR (metallic-roughness and specular-glossiness), [image-based
lighting](./lighting-intro.html), physical lighting units,
Lambert/Blinn/Unlit, MToon for stylized shading, and a [mixin-based
system](./user-material.html) for custom materials.
[Material blueprints](./material-blueprint.html) author materials
as node graphs in the editor.

**Character rendering**

Skin with subsurface scattering profiles, eye material with socket occlusion, and hair as both
Kajiya-Kay and Marschner models with strand-level geometry expanded on the GPU.

**[Shadows](./shadow-intro.html)**

PCF (several variants), PCSS, ESM, VSM, SSM and DOM shadows, with cascaded shadow maps and
receiver bias control. Pick per light based on the quality/cost tradeoff you want.

**[Post-processing](./posteffect-intro.html)**

TAA, SSGI, SSR, SSAO, bloom, motion blur, FXAA, tonemapping, color grading, and separate
subsurface-scattering passes for skin.

**[Transparency](./oit.html)**

Three order-independent transparency backends: A-buffer (WebGPU), dual depth peeling, and
weighted blended.

**Terrain, sky and water**

[Clipmap terrain](./terrain-runtime.html) with runtime texturing and
grass layers, [atmospheric sky](./sky.html), and
[ocean water](./water.html) driven by FFT, Gerstner or FBM wave
generators.

**[Animation and simulation](./animation-intro.html)**

Skeletal and keyframe animation with blending, masks and an action controller.
[Inverse kinematics](./animation-ik.html) (CCD, FABRIK, two-bone),
[joint dynamics](./animation-joint-dynamics.html), spring chains, GPU
cloth, GPU hair simulation,
[morph targets](./animation-morph-target.html) and geometry caches.

**Asset pipeline**

glTF/GLB, FBX, Alembic and hair curve
[importers](./asset-loading.html), a
[prefab system](./serialization.html), [virtual file
system](./vfs.html), and
[reference-counted resources](./lifetime.html).


## Editor

The editor is itself built on the Scene and Device APIs. It covers scene editing, the content
browser, node-graph material blueprints, terrain sculpting and texturing, animation editing,
TypeScript scripting bound to scene entities, and a plugin API for custom tools and panels.

The **desktop build** (Electron) adds local project folders with persistent storage, an embedded
MCP server so AI agents can drive the editor directly, and a built-in LLM assistant. API keys are
stored locally, encrypted at rest.

## Where to start

If you are **building a 3D application in code**, just read these in order:

1. [Installation](en/installation.md) — figure out which packages you need
2. [Your First Application](en/first-app.md) — get the first frame on screen
3. [Adding Models and Materials](en/first-scene.md) — put things in the scene
4. [Shadows and Post-processing](en/first-polish.md) — make it look presentable

After that, go deeper into individual topics under "Using the Scene API" as needed.

If you would rather use a **visual workflow**, start with the
[editor overview](en/editor/overview.md).

If you are **writing your own renderer** and do not plan to use the engine's scene management, go
straight to the [low-level graphics API](en/device-intro.md).

