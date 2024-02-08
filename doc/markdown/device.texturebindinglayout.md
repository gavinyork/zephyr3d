<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [TextureBindingLayout](doc/markdown/./device.texturebindinglayout.md)

## TextureBindingLayout interface

Binding layout of a texture for sampling

**Signature:**

```typescript
interface TextureBindingLayout 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [autoBindSampler](doc/markdown/./device.texturebindinglayout.autobindsampler.md) |  | string | name of the default sampler uniform when using WebGPU device |
|  [autoBindSamplerComparison](doc/markdown/./device.texturebindinglayout.autobindsamplercomparison.md) |  | string | name of the default comparison sampler uniform when using WebGPU device |
|  [multisampled](doc/markdown/./device.texturebindinglayout.multisampled.md) |  | boolean | Whether the textur is a multisampled texture |
|  [sampleType](doc/markdown/./device.texturebindinglayout.sampletype.md) |  | 'float' \| 'unfilterable-float' \| 'depth' \| 'sint' \| 'uint' | Sample type of the texture |
|  [viewDimension](doc/markdown/./device.texturebindinglayout.viewdimension.md) |  | '1d' \| '2d' \| '2d-array' \| 'cube' \| 'cube-array' \| '3d' | View dimension for the texture |
