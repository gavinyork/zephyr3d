# User defined materials

## Introduction

The material plays a crucial role in the rendering effect of objects. The engine's material system provides PBR (metallic-roughness and specular-glossiness workflows), Unlit, Blinn and Lambert, plus dedicated materials such as skin (`SSSMaterial`), hair, eyes and MToon; in the editor, [material blueprints](en/editor/material-blueprint.md) author materials as node graphs. To achieve more diverse rendering effects, the material system also offers interfaces for custom material creation. These custom materials can be applied to any Mesh object.

## Prerequisites

The engine uses JavaScript to write shaders. Before attempting to create custom materials, ensure you are familiar with this area. For more information, refer to: [Writing Shaders](en/shader.md). 

## Rendering process

Before you start creating custom materials, it's essential to understand the engine's rendering process. Rendering a scene involves several passes:

1. DepthPass

  The scene always starts with a depth prepass, which produces the depth buffer and data later effects need (such as motion vectors). DepthPass only renders opaque objects. Shadows on opaque objects are then computed in screen space into a shadow mask, which the lighting pass reads.

2. ShadowMapPass

  For each light source in the scene that casts shadows, a ShadowMap is rendered.

3. LightingPass

  Depending on the number of light sources and whether they cast shadows, the scene is rendered once or multiple times. Each shadow-casting light source is rendered separately, while non-shadow-casting light sources are rendered together using Clustered Lighting technology.

4. Sky, Fog, and Post-Processing

Custom materials require proper handling of DepthPass, ShadowMapPass, and LightingPass. There is also the OBJECT_COLOR pass used for picking, and a voxelization pass while probe GI is on; a material that should take part in GI overrides `supportsVoxelization()` to return true.

## Creating Custom Materials

[MeshMaterial](/doc/markdown/./scene.meshmaterial) serves as the base class for all Mesh materials,
After inheriting from MeshMaterial,custom materials may need to override some class methods:

  - [MeshMaterial.supportLighting()](/doc/markdown/./scene.meshmaterial.supportlighting)

    Returns true if the material is affected by lighting; otherwise, it's considered a non-illuminated material. It returns false on `MeshMaterial`, and true once `mixinLight` is mixed in.

  - [MeshMaterial.getQueueType()](/doc/markdown/./scene.meshmaterial.getqueuetype)

    Returns [QUEUE_OPAQUE](/doc/markdown/./scene.queue_opaque) if the material should be rendered during the opaque phase,
    or [QUEUE_TRANSPARENT](/doc/markdown/./scene.queue_transparent) if it should be rendered during the transparent phase.

  - [MeshMaterial.isTransparentPass(pass)](/doc/markdown/./scene.meshmaterial.istransparent)

    Indicates whether a specific pass of the material is semi-transparent by returning true. 
    This affects how the Shader processes the alpha channel. By default, this function determines
    transparency based on the [blendMode](/doc/markdown/./scene.meshmaterial.blendmode) property;
    it returns false if blendMode is 'none', otherwise true.

  - [MeshMaterial.applyUniformValues(bindGroup, ctx, pass)](/doc/markdown/./scene.meshmaterial.applyuniformvalues)

    Used to upload uniform constants required for a specified pass of the material. If you've defined new uniform constants in your custom material, you'll need to override this function. Remember to call its default implementation when overriding.

    **Note**: it only runs after the material's parameters change (call `this.uniformChanged()` after changing them), not every frame. **Values that change every frame** (data that follows the camera, say) belong in `applyUniforms(bindGroup, ctx, needUpdate, pass)`: override it, call the default implementation first, then set those values outside the `needUpdate` check. For time-based animation, read the time in the shader with `ShaderHelper.getElapsedTime(scope)` instead of uploading it.

  - [MeshMaterial.vertexShader(scope)](/doc/markdown/./scene.meshmaterial.vertexshader)

    Here you must provide the vertex shader implementation for the material, and this method must be overridden. Ensure to call its default implementation when overriding.

  - [MeshMaterial.fragmentShader(scope)](/doc/markdown/./scene.meshmaterial.fragmentshader)

    This is where the fragment shader implementation for the material goes, which also requires overriding. Make sure to call its default implementation when overriding.

  - [MeshMaterial.updateRenderStates(pass, stateSet, ctx)](/doc/markdown/./scene.meshmaterial.updaterenderstates)

    Will be called before the objects that uses this material being rendered. When overriding, you must call its default implementation.
    
  - [MeshMaterial.apply(ctx)](/doc/markdown/./scene.material.apply)

    Will be called while applying the material. it sets up Shaders and uniform constants as needed. When overriding, you must call its default implementation.


The [ShaderHelper](/doc/markdown/./scene.shaderhelper) class provides numerous utility functions necessary for writing materials.

> **Naming**: shader variable names go into the generated WGSL/GLSL unchanged; the engine does not rename them. WGSL reserved words (such as `set`, `pass`, `from`, `filter`, `sample`, `type`, `target`) and GLSL reserved words (such as `input`, `output`, `filter`, `sample`) cannot be used as variable names, or the program fails to compile. Watch out for materials only tested on WebGL2: the problem may only show up on WebGPU. Multi-word names are the safest.

## System desgin

The engine's material system employs a Mixin design pattern to facilitate the sharing of components.
Once components are mixed in, they inject relevant properties and methods into the custom material, 
potentially altering some of the material's default behaviors.

Custom materials can incorporate one or more components by calling the [applyMaterialMixins](/doc/markdown/./scene.applymaterialmixins) method.

For instance, to mix in the mixinLambert lighting model component, the class needs to be defined as follows:

```javascript

class MyMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  // Material implementation
}

```
