<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [PBRLightModelMR](doc/markdown/./scene.pbrlightmodelmr.md)

## PBRLightModelMR class

Metallic-Roughness PBR light model

**Signature:**

```typescript
declare class PBRLightModelMR extends PBRLightModelBase 
```
**Extends:** [PBRLightModelBase](doc/markdown/./scene.pbrlightmodelbase.md)

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)()](doc/markdown/./scene.pbrlightmodelmr._constructor_.md) |  | Creates an instance of PBRLightModelMR |

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [metallic](doc/markdown/./scene.pbrlightmodelmr.metallic.md) |  | number | The metallic factor |
|  [metallicIndex](doc/markdown/./scene.pbrlightmodelmr.metallicindex.md) |  | number | index of the metallic channel in the metallic-roughness texture |
|  [metallicMap](doc/markdown/./scene.pbrlightmodelmr.metallicmap.md) | <code>readonly</code> | [Texture2D](doc/markdown/./device.texture2d.md) | The metallic-roughness texture |
|  [metallicMapTexCoord](doc/markdown/./scene.pbrlightmodelmr.metallicmaptexcoord.md) | <code>readonly</code> | number | Texture coordinate index of the metallic-roughness texture |
|  [metallicSampler](doc/markdown/./scene.pbrlightmodelmr.metallicsampler.md) | <code>readonly</code> | [TextureSampler](doc/markdown/./device.texturesampler.md) | Sampler of the metallic-roughness texture |
|  [roughness](doc/markdown/./scene.pbrlightmodelmr.roughness.md) |  | number | The roughness factor |
|  [roughnessIndex](doc/markdown/./scene.pbrlightmodelmr.roughnessindex.md) |  | number | index of the roughness channel in the metallic-roughness texture |
|  [specularColorMap](doc/markdown/./scene.pbrlightmodelmr.specularcolormap.md) | <code>readonly</code> | [Texture2D](doc/markdown/./device.texture2d.md) | The specular color texture |
|  [specularColorMapTexCoord](doc/markdown/./scene.pbrlightmodelmr.specularcolormaptexcoord.md) | <code>readonly</code> | number | Texture coordinate index of the specular color texture |
|  [specularColorSampler](doc/markdown/./scene.pbrlightmodelmr.specularcolorsampler.md) | <code>readonly</code> | [TextureSampler](doc/markdown/./device.texturesampler.md) | Sampler of the specular color texture |
|  [specularFactor](doc/markdown/./scene.pbrlightmodelmr.specularfactor.md) |  | [Vector4](doc/markdown/./base.vector4.md) | The specular factor |
|  [specularMap](doc/markdown/./scene.pbrlightmodelmr.specularmap.md) | <code>readonly</code> | [Texture2D](doc/markdown/./device.texture2d.md) | The specular texture |
|  [specularMapTexCoord](doc/markdown/./scene.pbrlightmodelmr.specularmaptexcoord.md) | <code>readonly</code> | number | Texture coordinate index of the specular texture |
|  [specularSampler](doc/markdown/./scene.pbrlightmodelmr.specularsampler.md) | <code>readonly</code> | [TextureSampler](doc/markdown/./device.texturesampler.md) | Sampler of the specular texture |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [applyUniforms(bindGroup, ctx)](doc/markdown/./scene.pbrlightmodelmr.applyuniforms.md) |  | Updates uniforms of the shader program |
|  [calculateHash()](doc/markdown/./scene.pbrlightmodelmr.calculatehash.md) |  | Calculates the hash code of the shader program |
|  [createSurfaceDataType(env)](doc/markdown/./scene.pbrlightmodelmr.createsurfacedatatype.md) | <code>protected</code> | Creates the surface data type |
|  [fillSurfaceData(scope, envLight)](doc/markdown/./scene.pbrlightmodelmr.fillsurfacedata.md) | <code>protected</code> | Initial fill the surface data of current fragment |
|  [isTextureUsed(name)](doc/markdown/./scene.pbrlightmodelmr.istextureused.md) |  | Check if specified texture is being used |
|  [setMetallicMap(tex, sampler, texCoordIndex, texTransform)](doc/markdown/./scene.pbrlightmodelmr.setmetallicmap.md) |  | Sets the metallic-roughness texture |
|  [setSpecularColorMap(tex, sampler, texCoordIndex, texTransform)](doc/markdown/./scene.pbrlightmodelmr.setspecularcolormap.md) |  | Sets the specular color texture |
|  [setSpecularMap(tex, sampler, texCoordIndex, texTransform)](doc/markdown/./scene.pbrlightmodelmr.setspecularmap.md) |  | Sets the specular texture |
|  [setupUniforms(scope, ctx)](doc/markdown/./scene.pbrlightmodelmr.setupuniforms.md) |  | Setup uniforms of the shader program |
