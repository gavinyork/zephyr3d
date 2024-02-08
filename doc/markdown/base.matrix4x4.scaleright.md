<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/base](doc/markdown/./base.md) &gt; [Matrix4x4](doc/markdown/./base.matrix4x4.md) &gt; [scaleRight](doc/markdown/./base.matrix4x4.scaleright.md)

## Matrix4x4.scaleRight() method

Post-scale a Matrix4x4 by a vector.

**Signature:**

```typescript
static scaleRight(m: Matrix4x4, s: Vector3, result?: Matrix4x4): Matrix4x4;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  m | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | The matrix that will be scaled. |
|  s | [Vector3](doc/markdown/./base.vector3.md) | The scale vector. |
|  result | [Matrix4x4](doc/markdown/./base.matrix4x4.md) | _(Optional)_ The output matrix (can be the same as m), if not specified, a new matrix will be created. |

**Returns:**

[Matrix4x4](doc/markdown/./base.matrix4x4.md)

The output matrix

## Remarks

result = m \* (scale matrix for s)
