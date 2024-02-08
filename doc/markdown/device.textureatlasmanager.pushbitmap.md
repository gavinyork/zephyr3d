<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [TextureAtlasManager](doc/markdown/./device.textureatlasmanager.md) &gt; [pushBitmap](doc/markdown/./device.textureatlasmanager.pushbitmap.md)

## TextureAtlasManager.pushBitmap() method

Inserts a bitmap to the atlas texture

**Signature:**

```typescript
pushBitmap(key: string, bitmap: ImageData | ImageBitmap): AtlasInfo;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  key | string | Key of the atlas |
|  bitmap | ImageData \| ImageBitmap | The bitmap object |

**Returns:**

[AtlasInfo](doc/markdown/./device.atlasinfo.md)

The atals info or null if insert failed
