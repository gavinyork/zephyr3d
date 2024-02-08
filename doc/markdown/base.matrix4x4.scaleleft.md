<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/base](doc/markdown/./base.md) &gt; [Matrix4x4](doc/markdown/./base.matrix4x4.md) &gt; [scaleLeft](doc/markdown/./base.matrix4x4.scaleleft.md)

## Matrix4x4.scaleLeft() method

Pre-scale a Matrix4x4 by a vector.

**Signature:**

```typescript
static scaleLeft(m: Matrix4x4, s: Vector3, result?: Matrix4x4): Matrix4x4;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  m | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | The matrix that will be translated. |
|  s | [Vector3](doc/markdown/./base.vector3.md) | The scale vector. |
|  result | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | _(Optional)_ The output matrix (can be the same as m), if not specified, a new matrix will be created. |

**Returns:**

[Matrix4x4](doc/markdown/./base.matrix4x4.md)

The output matrix

## Remarks

result = (scale matrix for s) \* m
