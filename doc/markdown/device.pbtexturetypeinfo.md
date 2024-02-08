<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [PBTextureTypeInfo](doc/markdown/./device.pbtexturetypeinfo.md)

## PBTextureTypeInfo class

The texture type info

**Signature:**

```typescript
declare class PBTextureTypeInfo extends PBTypeInfo<TextureTypeDetail> 
```
**Extends:** [PBTypeInfo](doc/markdown/./device.pbtypeinfo.md)<!-- -->&lt;[TextureTypeDetail](doc/markdown/./device.texturetypedetail.md)<!-- -->&gt;

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)(textureType, texelFormat, readable, writable)](doc/markdown/./device.pbtexturetypeinfo._constructor_.md) |  | Constructs a new instance of the <code>PBTextureTypeInfo</code> class |

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [readable](doc/markdown/./device.pbtexturetypeinfo.readable.md) | <code>readonly</code> | boolean | Returns true if this is a readable storage texture type |
|  [storageTexelFormat](doc/markdown/./device.pbtexturetypeinfo.storagetexelformat.md) | <code>readonly</code> | [TextureFormat](doc/markdown/./device.textureformat.md) | Get texture format if this is a storage texture |
|  [textureType](doc/markdown/./device.pbtexturetypeinfo.texturetype.md) | <code>readonly</code> | [PBTextureType](doc/markdown/./device.pbtexturetype.md) | Get the texture type |
|  [writable](doc/markdown/./device.pbtexturetypeinfo.writable.md) | <code>readonly</code> | boolean | Returns true if this is a writable storage texture type |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [is2DTexture()](doc/markdown/./device.pbtexturetypeinfo.is2dtexture.md) |  | Returns true if this is a 2D texture type |
|  [is3DTexture()](doc/markdown/./device.pbtexturetypeinfo.is3dtexture.md) |  | Returns true if this is a 3D texture type |
|  [isArrayTexture()](doc/markdown/./device.pbtexturetypeinfo.isarraytexture.md) |  | Returns true if this is an array texture type |
|  [isCubeTexture()](doc/markdown/./device.pbtexturetypeinfo.iscubetexture.md) |  | Returns true if this is a cube texture type |
|  [isDepthTexture()](doc/markdown/./device.pbtexturetypeinfo.isdepthtexture.md) |  | Return s true if this is a depth texture type |
|  [isExternalTexture()](doc/markdown/./device.pbtexturetypeinfo.isexternaltexture.md) |  | Returns true if this is an external texture type |
|  [isIntTexture()](doc/markdown/./device.pbtexturetypeinfo.isinttexture.md) |  | Returns true if the texture format is of type integer |
|  [isMultisampledTexture()](doc/markdown/./device.pbtexturetypeinfo.ismultisampledtexture.md) |  | Returns true if this is a multisampled texture type |
|  [isStorageTexture()](doc/markdown/./device.pbtexturetypeinfo.isstoragetexture.md) |  | Returns true if this is a storage texture type |
|  [isUIntTexture()](doc/markdown/./device.pbtexturetypeinfo.isuinttexture.md) |  | Returns true if the texture format is of type unsigned integer |
|  [toBufferLayout(offset)](doc/markdown/./device.pbtexturetypeinfo.tobufferlayout.md) |  | Creates a buffer layout from this type |
