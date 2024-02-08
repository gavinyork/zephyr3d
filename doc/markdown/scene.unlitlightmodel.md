<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [UnlitLightModel](doc/markdown/./scene.unlitlightmodel.md)

## UnlitLightModel class

Unlit light model

**Signature:**

```typescript
declare class UnlitLightModel extends LightModel 
```
**Extends:** [LightModel](doc/markdown/./scene.lightmodel.md)

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [compositeSurfaceData(scope)](doc/markdown/./scene.unlitlightmodel.compositesurfacedata.md) | <code>protected</code> | Composite surface data to produce the final color |
|  [directBRDF(scope, lightDir, attenuation)](doc/markdown/./scene.unlitlightmodel.directbrdf.md) |  | Calculates BRDF for direct lighting for current fragment |
|  [envBRDF(envLight, scope)](doc/markdown/./scene.unlitlightmodel.envbrdf.md) |  | Calculates BRDF of environment lighting for current fragment |
|  [isNormalUsed()](doc/markdown/./scene.unlitlightmodel.isnormalused.md) |  | Checks if normal vector is being used |
|  [supportLighting()](doc/markdown/./scene.unlitlightmodel.supportlighting.md) |  | Whether the shading is effected by lights |
