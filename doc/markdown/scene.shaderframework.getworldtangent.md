<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [ShaderFramework](doc/markdown/./scene.shaderframework.md) &gt; [getWorldTangent](doc/markdown/./scene.shaderframework.getworldtangent.md)

## ShaderFramework.getWorldTangent() method

Gets the varying input value of type vec3 which holds the world tangent vector of current fragment

**Signature:**

```typescript
static getWorldTangent(scope: PBInsideFunctionScope): PBShaderExp;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  scope | [PBInsideFunctionScope](doc/markdown/./device.pbinsidefunctionscope.md) | Current shader scope |

**Returns:**

[PBShaderExp](doc/markdown/./device.pbshaderexp.md)

The world tangent vector of current fragment

## Remarks

This function can only be used in the fragment shader
