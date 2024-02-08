<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [getVertexBufferAttribTypeBySemantic](doc/markdown/./device.getvertexbufferattribtypebysemantic.md)

## getVertexBufferAttribTypeBySemantic() function

Get primitive type of a vertex attribute by specified vertex semantic

**Signature:**

```typescript
declare function getVertexBufferAttribTypeBySemantic(vertexBufferType: PBStructTypeInfo, semantic: VertexSemantic): PBPrimitiveTypeInfo;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  vertexBufferType | [PBStructTypeInfo](doc/markdown/./device.pbstructtypeinfo.md) | The structure type of the vertex buffer |
|  semantic | [VertexSemantic](doc/markdown/./device.vertexsemantic.md) | The vertex semantic |

**Returns:**

[PBPrimitiveTypeInfo](doc/markdown/./device.pbprimitivetypeinfo.md)

- The primitive type of the vertex attribute
