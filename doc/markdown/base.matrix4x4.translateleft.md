<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/base](doc/markdown/./base.md) &gt; [Matrix4x4](doc/markdown/./base.matrix4x4.md) &gt; [translateLeft](doc/markdown/./base.matrix4x4.translateleft.md)

## Matrix4x4.translateLeft() method

Pre-translate a Matrix4x4 by a vector.

**Signature:**

```typescript
static translateLeft(m: Matrix4x4, t: Vector3, result?: Matrix4x4): Matrix4x4;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  m | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | The matrix that will be translated. |
|  t | [Vector3](doc/markdown/./base.vector3.md) | The translate vector. |
|  result | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | _(Optional)_ The output matrix (can be the same as m), if not specified, a new matrix will be created. |

**Returns:**

[Matrix4x4](doc/markdown/./base.matrix4x4.md)

The output matrix

## Remarks

result = (translate matrix for t) \* m
