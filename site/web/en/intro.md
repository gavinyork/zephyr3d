# Introduction

Zephyr3d is a 3D rendering framework for browsers, developed in TypeScript. It primarily consists of two sets of APIs: the Device API and the Scene API.

## Device API

DeviceAPI offers a set of low-level abstract encapsulation interfaces that allow users to invoke the WebGL, WebGL2, and WebGPU graphics interfaces in exactly the same way. These interfaces encompass most of the capabilities of the underlying APIs, facilitating easy support for cross-API graphics rendering. One of the main challenges of cross-platform rendering is the difference in shader languages; WebGL and WebGL2 use GLSL, while WebGPU uses WGSL. To unify the writing of shaders, we have implemented a dynamic Shader generation feature. Users can write Shaders in native javaScript, and for different backends, the system automatically generates the corresponding shader code. This eliminates the need for cumbersome string concatenation and extensive use of #ifdef, offering high flexibility.

## Scene API

SceneAPI is a high-level rendering framework built on top of DeviceAPI, serving both as a test environment for DeviceAPI and as a direct tool for graphics development. Currently, SceneAPI has implemented features including:

- Octree Scene Management
- Clustered Lighting Culling
- Physically Based Rendering (PBR) and Image-Based Lighting (IBL)
- ShadowMap(PCF/ESM/VSM/CSM)
- Skeletal and Keyframe Animation
- GPU Instance Rendering
- Imporing GLTF/GLB models
- Chunk Level of Detail (LOD) Terrain
- Atmospheric Rendering, Dynamic 2D Clouds
- FFT Water Rendering
- Post-processing Techniques (Tonemap, Bloom, FXAA, SAO, etc.)
- ImGui Integration

SceneAPI is still in the early stages of development and is not recommended for use in official projects.
