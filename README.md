

<div align="center">

<img
    src="https://cdn.zephyr3d.org/doc/assets/images/logo_i.svg"
    style="display: block; width: 300px; margin: auto; margin-bottom: 0"
/>

> A modern TypeScript-based WebGL & WebGPU rendering engine  

[User Manual](https://zephyr3d.org/doc/) &nbsp;|&nbsp; [Online Editor](https://zephyr3d.org/editor/)

[![CI](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene?color=%235865f2)](https://www.npmjs.com/package/@zephyr3d/scene)
[![License: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)  

</div>

---

## Overview

**Zephyr3D** is a next-generation, TypeScript-based 3D rendering engine for browsers — offering unified WebGL/WebGPU rendering, programmable shader generation, and a full Web-based visual editor.  

> Lightweight · Modular · Developer-friendly · Visual creation empowered by code.

---

## Core Features

- Unified RHI — Seamlessly switch WebGL/WebGPU backends  
- TypeScript architecture — Safe, modular, IDE‑friendly  
- Scene System — PBR, IBL, Shadows, PostProcess  
- Built‑in Visual Editor — Scene authoring & scripting  
- Shader Builder — Generate GLSL/WGSL on the fly  
- Lightweight modules & npm‑ready  

---

## Zephyr3D Editor — *Web-based Visual Tool*

<div align="center">

**Try it Online → [Zephyr3D Editor](https://zephyr3d.org/editor/)**  
*(No install required — runs completely in the browser)*  

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Zephyr3D Web Editor">

</div>

**Highlights**
- 🧱 Scene, Material, Terrain editors  
- 🧩 TypeScript scripting & animation tools  
- 💡 Built with Zephyr3D Scene + Device APIs  
- 🚀 Instant preview & 1-click export  

---

## Architecture Overview

| Layer | Description |
|-------|--------------|
| **Base** | Math / VFS / Events / SmartPtr |
| **Device (RHI)** | Abstract graphics API layer |
| **Backend-WebGL / WebGPU** | Platform‑specific rendering backends |
| **Scene** | Scene system, materials, animation, post FX |
| **Editor** | Browser-native editor built atop Scene layer |

---

## Installation

```bash
npm install --save @zephyr3d/device
npm install --save @zephyr3d/backend-webgl
npm install --save @zephyr3d/backend-webgpu
npm install --save @zephyr3d/scene
```

Use with your preferred bundler (Vite / Webpack / Rollup).

---

## Example — Scene API

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera,
  SphereShape, DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const app = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

app.ready().then(() => {
  const scene = new Scene();
  new DirectionalLight(scene).lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
  const mat = new LambertMaterial();
  mat.albedoColor = new Vector4(0.9, 0.1, 0.1, 1);
  new Mesh(scene, new SphereShape(), mat);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI/3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0,0,4), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: Vector3.zero() });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);
  getEngine().setRenderable(scene, 0);
  app.run();
});
```

---

## Status

**Under Active Development**  
Zephyr3D is currently in early development and continuously evolving.  
Perfect for experiments, Web rendering research, and custom toolchains.  

---

## License

Zephyr3D is released under the [MIT License](https://opensource.org/licenses/MIT).  

---

<div align="center">

**© 2025 Zephyr3D — Built with 💙 in TypeScript for the Web3D world.**

</div>
