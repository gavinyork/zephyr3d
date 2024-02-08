<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [LightModel](doc/markdown/./scene.lightmodel.md) &gt; [calculateTexCoordNoInput](doc/markdown/./scene.lightmodel.calculatetexcoordnoinput.md)

## LightModel.calculateTexCoordNoInput() method

Calculates the texture coordinate of current fragment by given texture coordinate value

**Signature:**

```typescript
calculateTexCoordNoInput(scope: PBInsideFunctionScope, index: number, value: PBShaderExp): PBShaderExp;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  scope | [PBInsideFunctionScope](doc/markdown/./device.pbinsidefunctionscope.md) | The shader scope |
|  index | number | The texture coordinate index |
|  value | [PBShaderExp](doc/markdown/./device.pbshaderexp.md) |  |

**Returns:**

[PBShaderExp](doc/markdown/./device.pbshaderexp.md)

The texture coordinate
