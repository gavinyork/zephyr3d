<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [LightModel](doc/markdown/./scene.lightmodel.md) &gt; [setTextureOptions](doc/markdown/./scene.lightmodel.settextureoptions.md)

## LightModel.setTextureOptions() method

Adds a texture uniforms for the light model

**Signature:**

```typescript
setTextureOptions(name: string, tex: BaseTexture, sampler: TextureSampler, texCoord: number, texTransform: Matrix4x4): number;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  name | string | Name of the texture uniform |
|  tex | [BaseTexture](doc/markdown/./device.basetexture.md) | Texture to set |
|  sampler | [TextureSampler](doc/markdown/./device.texturesampler.md) | Sampler of the texture |
|  texCoord | number | Texture coordinate index of the texture |
|  texTransform | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | Transformation matrix for texture coordinates of the texture |

**Returns:**

number
