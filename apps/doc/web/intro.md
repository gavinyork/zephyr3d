# Introduction

Zephyr3d is a set of APIs for 3D rendering in the browser.<br>
It is a thin wrapper for WebGL and WebGPU and provides a unified interface to access these two APIs.<br>
The most important feature is that it allows you to write shaders in javascript without knowing GLSL and WGSL.<br>
In addition, Zephyr3d provides a built-in rendering framework powered by this set of APIs.

## Low level API features

- Unified API interface for WebGL1/WebGL2/WebGPU device
- GPU computing support for WebGPU device
- Writing shaders directly using javascript without knowing the GLSL/WGSL language
- Shaders are totally generated on the fly
- Take care of the different coordinate systems of WebGL and WebGPU

## High level framework features

- Physically based rendering with IBL support
- Importing of GLTF models
- Importing of JPG/PNG/DDS/HDR textures
- Loose-octree based geometry culling and picking
- Skeletal animation and keyframe animation
- Automatically geometry instancing
- ChunkedLOD based terrain rendering
- Linear/Exp/Exp2 fogging
- HDR rendering
- Shadow maps with PCF/ESM/VSM support
- Cascaded shadow maps
- Built-in imgui integration

## Examples

Check out the [Examples](/examples/index.html).

