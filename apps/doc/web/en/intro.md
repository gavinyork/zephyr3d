
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

- Scene management based on **Scene Graph**
- **Clustered lighting**
- **Physically Based Rendering (PBR)** and **Image-Based Lighting (IBL)**
- **Shadow Mapping** (PCF, ESM, VSM, CSM)
- **Skeletal and keyframe animation**
- **GPU instancing**
- **Terrain rendering**
- **Atmospheric rendering**
- **Water rendering**
- **Post-processing** (Tonemap, Bloom, TAA, FXAA, SSAO, etc.)
- **ImGui integration**

## Editor

The **Zephyr3D Editor** runs entirely in the browser — no installation required.  
It enables the interactive development of 3D web applications with real-time visualization.

### Main Features

- **Project Management**
  - Create, import, and export projects
  - One-click web app publishing

- **Scene Editing**
  - Object placement
  - Property editing
  - Terrain editing

- **Animation Editing**
  - Create and edit keyframe animations and animation tracks for scene nodes

- **Material Creation & Editing**
  - Design custom materials using a node-based editor (Blueprint system)

- **Scripting**
  - Write TypeScript scripts directly within the editor and bind them to scene entities

- **Asset Management**
  - Import external GLTF/GLB models
  - Prefab system support
  - Store project assets in **IndexedDB**

