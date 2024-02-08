<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [Blitter](doc/markdown/./scene.blitter.md)

## Blitter class

Base class for any kind of blitters

**Signature:**

```typescript
declare abstract class Blitter 
```

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)()](doc/markdown/./scene.blitter._constructor_.md) |  | Creates an instance of Blitter |

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [destRect](doc/markdown/./scene.blitter.destrect.md) |  | number\[\] | Destination rectangle |
|  [hash](doc/markdown/./scene.blitter.hash.md) | <code>readonly</code> | string | Program hash code |
|  [renderStates](doc/markdown/./scene.blitter.renderstates.md) |  | [RenderStateSet](doc/markdown/./device.renderstateset.md) | Render states used to do the blitting |
|  [scissor](doc/markdown/./scene.blitter.scissor.md) |  | number\[\] | Scissor rect |
|  [srgbOut](doc/markdown/./scene.blitter.srgbout.md) |  | boolean | Whether output color value in gamma color space |
|  [viewport](doc/markdown/./scene.blitter.viewport.md) |  | number\[\] | Viewport |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [blit(source, dest, sampler)](doc/markdown/./scene.blitter.blit.md) |  | Blits a 2D texture to 2D texture or frame buffer |
|  [blit(source, dest, layer, sampler)](doc/markdown/./scene.blitter.blit_1.md) |  | Blits a 2D texture to given layer of a 2D array texture |
|  [blit(source, dest, sampler)](doc/markdown/./scene.blitter.blit_2.md) |  | Blits a 2d array texture to another 2d array texture |
|  [blit(source, dest, layer, sampler)](doc/markdown/./scene.blitter.blit_3.md) |  | Blits given layer of a 2d array texture to a 2d texture or frame buffer |
|  [blit(source, dest, sampler)](doc/markdown/./scene.blitter.blit_4.md) |  | Blits a cube texture to another cube texture |
|  [blit(source, dest, face, sampler)](doc/markdown/./scene.blitter.blit_5.md) |  | Blits given face of a cube texture to a 2d texture or frame buffer |
|  [calcHash()](doc/markdown/./scene.blitter.calchash.md) | <p><code>protected</code></p><p><code>abstract</code></p> | Calculates the hash code |
|  [filter(scope, type, srcTex, srcUV, srcLayer, sampeType)](doc/markdown/./scene.blitter.filter.md) | <code>abstract</code> | Calculates the destination texel by the source texel |
|  [invalidateHash()](doc/markdown/./scene.blitter.invalidatehash.md) |  | Force the hash code to be regenerated |
|  [readTexel(scope, type, srcTex, uv, srcLayer, sampleType)](doc/markdown/./scene.blitter.readtexel.md) |  | Reads a texel from the source texture |
|  [setUniforms(bindGroup, sourceTex)](doc/markdown/./scene.blitter.setuniforms.md) |  | Update uniforms of the bind group |
|  [setup(scope, type)](doc/markdown/./scene.blitter.setup.md) |  | Initialize uniforms of the blit program |
|  [writeTexel(scope, type, uv, texel)](doc/markdown/./scene.blitter.writetexel.md) |  | Writes a texel to destination texture |
