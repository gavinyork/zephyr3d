<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [EnvironmentLighting](doc/markdown/./scene.environmentlighting.md)

## EnvironmentLighting class

Base class for any kind of environment light

**Signature:**

```typescript
declare abstract class EnvironmentLighting 
```

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [getIrradiance(scope, normal)](doc/markdown/./scene.environmentlighting.getirradiance.md) | <code>abstract</code> | Get irradiance for a fragment |
|  [getRadiance(scope, refl, roughness)](doc/markdown/./scene.environmentlighting.getradiance.md) | <code>abstract</code> | Get radiance for a fragment |
|  [getType()](doc/markdown/./scene.environmentlighting.gettype.md) | <code>abstract</code> | The environment light type |
|  [hasIrradiance()](doc/markdown/./scene.environmentlighting.hasirradiance.md) | <code>abstract</code> | Returns whether this environment lighting supports diffuse light |
|  [hasRadiance()](doc/markdown/./scene.environmentlighting.hasradiance.md) | <code>abstract</code> | Returns whether this environment lighting supports reflective light |
|  [initShaderBindings(pb)](doc/markdown/./scene.environmentlighting.initshaderbindings.md) | <code>abstract</code> | Initialize shader bindings |
|  [isConstant()](doc/markdown/./scene.environmentlighting.isconstant.md) |  | Whether this is an instance of EnvConstantAmbient |
|  [isHemispheric()](doc/markdown/./scene.environmentlighting.ishemispheric.md) |  | Whether this is an instance of EnvHemisphericAmbient |
|  [isIBL()](doc/markdown/./scene.environmentlighting.isibl.md) |  | Whether this is an instance of EnvIBL |
|  [updateBindGroup(bg)](doc/markdown/./scene.environmentlighting.updatebindgroup.md) | <code>abstract</code> | Updates the uniform values |
