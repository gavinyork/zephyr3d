<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [ShaderFramework](doc/markdown/./scene.shaderframework.md)

## ShaderFramework class

Helper shader functions for the builtin material system

**Signature:**

```typescript
declare class ShaderFramework 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [BILLBOARD\_SPHERICAL](doc/markdown/./scene.shaderframework.billboard_spherical.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [BILLBOARD\_SYLINDRAL](doc/markdown/./scene.shaderframework.billboard_sylindral.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [FOG\_TYPE\_EXP](doc/markdown/./scene.shaderframework.fog_type_exp.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [FOG\_TYPE\_EXP2](doc/markdown/./scene.shaderframework.fog_type_exp2.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [FOG\_TYPE\_LINEAR](doc/markdown/./scene.shaderframework.fog_type_linear.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [FOG\_TYPE\_NONE](doc/markdown/./scene.shaderframework.fog_type_none.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [FOG\_TYPE\_SCATTER](doc/markdown/./scene.shaderframework.fog_type_scatter.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_BONE\_MATRICIES](doc/markdown/./scene.shaderframework.usage_bone_matricies.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_BONE\_TEXTURE\_SIZE](doc/markdown/./scene.shaderframework.usage_bone_texture_size.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_INV\_BIND\_MATRIX](doc/markdown/./scene.shaderframework.usage_inv_bind_matrix.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_VERTEX\_COLOR](doc/markdown/./scene.shaderframework.usage_vertex_color.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_WORLD\_BINORMAL](doc/markdown/./scene.shaderframework.usage_world_binormal.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_WORLD\_MATRIX](doc/markdown/./scene.shaderframework.usage_world_matrix.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_WORLD\_NORMAL](doc/markdown/./scene.shaderframework.usage_world_normal.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_WORLD\_POSITION](doc/markdown/./scene.shaderframework.usage_world_position.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [USAGE\_WORLD\_TANGENT](doc/markdown/./scene.shaderframework.usage_world_tangent.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [applyFog(scope, color, ctx)](doc/markdown/./scene.shaderframework.applyfog.md) | <code>static</code> |  |
|  [computeFogFactor(scope, viewDir, fogType, fogParams)](doc/markdown/./scene.shaderframework.computefogfactor.md) | <code>static</code> | Computes the fog factor for a given view vector |
|  [computeFogFactorForType(scope, viewDir, fogParams, fogType)](doc/markdown/./scene.shaderframework.computefogfactorfortype.md) | <code>static</code> | Computes the fog factor with given type for a given view vector |
|  [discardIfClipped(scope)](doc/markdown/./scene.shaderframework.discardifclipped.md) | <code>static</code> | Discard the fragment if it was clipped by the clip plane |
|  [ftransform(scope, billboardMode)](doc/markdown/./scene.shaderframework.ftransform.md) | <code>static</code> | Transform vertex position to the clip space and calcuate the world normal and tangent frame if needed |
|  [getAerialPerspectiveLUT(scope)](doc/markdown/./scene.shaderframework.getaerialperspectivelut.md) | <code>static</code> | Gets the aerial perspective LUT |
|  [getCameraClipPlane(scope)](doc/markdown/./scene.shaderframework.getcameraclipplane.md) | <code>static</code> | Gets the clip plane |
|  [getCameraClipPlaneFlag(scope)](doc/markdown/./scene.shaderframework.getcameraclipplaneflag.md) | <code>static</code> | Gets the clip plane flag |
|  [getCameraParams(scope)](doc/markdown/./scene.shaderframework.getcameraparams.md) | <code>static</code> | Gets the uniform variable of type vec4 which holds the camera parameters |
|  [getCameraPosition(scope)](doc/markdown/./scene.shaderframework.getcameraposition.md) | <code>static</code> | Gets the uniform variable of type vec3 which holds the camera position |
|  [getCameraRotationMatrix(scope)](doc/markdown/./scene.shaderframework.getcamerarotationmatrix.md) | <code>static</code> | Gets the uniform variable of type mat4 which holds the view projection matrix of current camera |
|  [getEnvLightStrength(scope)](doc/markdown/./scene.shaderframework.getenvlightstrength.md) | <code>static</code> | Gets the uniform variable of type float which holds the strength of the environment light |
|  [getFogColor(scope)](doc/markdown/./scene.shaderframework.getfogcolor.md) | <code>static</code> | Gets the uniform variable of type vec4 which holds the fog color |
|  [getFogParams(scope)](doc/markdown/./scene.shaderframework.getfogparams.md) | <code>static</code> | Gets the uniform variable of type vec4 which holds the fog parameters |
|  [getFogType(scope)](doc/markdown/./scene.shaderframework.getfogtype.md) | <code>static</code> | Gets the uniform variable of type vec4 which holds the fog color |
|  [getViewProjectionMatrix(scope)](doc/markdown/./scene.shaderframework.getviewprojectionmatrix.md) | <code>static</code> | Gets the uniform variable of type mat4 which holds the view projection matrix of current camera |
|  [getWorldBinormal(scope)](doc/markdown/./scene.shaderframework.getworldbinormal.md) | <code>static</code> | Gets the varying input value of type vec3 which holds the world binormal vector of current fragment |
|  [getWorldMatrix(scope)](doc/markdown/./scene.shaderframework.getworldmatrix.md) | <code>static</code> | Gets the uniform variable of type mat4 which holds the world matrix of current object to be drawn |
|  [getWorldNormal(scope)](doc/markdown/./scene.shaderframework.getworldnormal.md) | <code>static</code> | Gets the varying input value of type vec3 which holds the world normal of current fragment |
|  [getWorldPosition(scope)](doc/markdown/./scene.shaderframework.getworldposition.md) | <code>static</code> | Gets the varying input value of type vec4 which holds the world position of current fragment |
|  [getWorldTangent(scope)](doc/markdown/./scene.shaderframework.getworldtangent.md) | <code>static</code> | Gets the varying input value of type vec3 which holds the world tangent vector of current fragment |
|  [getWorldUnit(scope)](doc/markdown/./scene.shaderframework.getworldunit.md) | <code>static</code> | Gets the world unit |
|  [prepareFragmentShader(pb, ctx)](doc/markdown/./scene.shaderframework.preparefragmentshader.md) | <code>static</code> | Prepares the fragment shader which is going to be used in our material system |
|  [prepareVertexShader(pb, ctx)](doc/markdown/./scene.shaderframework.preparevertexshader.md) | <code>static</code> | Prepares the vertex shader which is going to be used in our material system |
|  [setClipSpacePosition(scope, pos)](doc/markdown/./scene.shaderframework.setclipspaceposition.md) | <code>static</code> | Sets the clip space position in vertex shader |
