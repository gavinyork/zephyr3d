<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [PBShaderExp](doc/markdown/./device.pbshaderexp.md)

## PBShaderExp class

Base class for a expression in the shader

**Signature:**

```typescript
declare class PBShaderExp extends Proxiable<PBShaderExp> 
```
**Extends:** [Proxiable](doc/markdown/./device.proxiable.md)<!-- -->&lt;[PBShaderExp](doc/markdown/./device.pbshaderexp.md)<!-- -->&gt;

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [$group](doc/markdown/./device.pbshaderexp._group.md) |  | number |  |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [at(index)](doc/markdown/./device.pbshaderexp.at.md) |  | Get element in the array by index |
|  [attrib(attr)](doc/markdown/./device.pbshaderexp.attrib.md) |  | Point out that the variable is a input vertex attribute |
|  [getTypeName()](doc/markdown/./device.pbshaderexp.gettypename.md) |  | Get type name of this variable |
|  [highp()](doc/markdown/./device.pbshaderexp.highp.md) |  | Point out that the variable should be in high precision |
|  [inout()](doc/markdown/./device.pbshaderexp.inout.md) |  |  |
|  [isVector()](doc/markdown/./device.pbshaderexp.isvector.md) |  | Determine if this variable is of vector type |
|  [lowp()](doc/markdown/./device.pbshaderexp.lowp.md) |  | Points out that the variable should be in low precision |
|  [mediump()](doc/markdown/./device.pbshaderexp.mediump.md) |  | Points out that the variable should be in medium precision |
|  [numComponents()](doc/markdown/./device.pbshaderexp.numcomponents.md) |  | Get vector component count of the variable if this variable is of vector type |
|  [out()](doc/markdown/./device.pbshaderexp.out.md) |  |  |
|  [sampleType(type)](doc/markdown/./device.pbshaderexp.sampletype.md) |  | Set sample type for the variable if the variable is of type texture |
|  [setAt(index, val)](doc/markdown/./device.pbshaderexp.setat.md) |  | Set element in the array by index |
|  [storage(group)](doc/markdown/./device.pbshaderexp.storage.md) |  | Point out that the variable should be in storage address space |
|  [storageBuffer(group)](doc/markdown/./device.pbshaderexp.storagebuffer.md) |  | Point out that the variable should be a storage buffer |
|  [tag(args)](doc/markdown/./device.pbshaderexp.tag.md) |  | Create tags for the variable |
|  [uniform(group)](doc/markdown/./device.pbshaderexp.uniform.md) |  | Point out that the variable should be in uniform address space |
|  [uniformBuffer(group)](doc/markdown/./device.pbshaderexp.uniformbuffer.md) |  | Point out that the variable should be an uniform buffer |
|  [workgroup()](doc/markdown/./device.pbshaderexp.workgroup.md) |  | Point out that the variable should be in workgroup address space |
