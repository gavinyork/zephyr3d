<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [ProgramBuilder](doc/markdown/./device.programbuilder.md) &gt; [mat2x4](doc/markdown/./device.programbuilder.mat2x4.md)

## ProgramBuilder.mat2x4 property

mat2x4 type variable constructors

**Signature:**

```typescript
mat2x4: {
        (): PBShaderExp;
        (name: string): PBShaderExp;
        (m00: number | PBShaderExp, m01: number | PBShaderExp, m02: number | PBShaderExp, m03: number | PBShaderExp, m10: number | PBShaderExp, m11: number | PBShaderExp, m12: number | PBShaderExp, m13: number | PBShaderExp): PBShaderExp;
        (m0: PBShaderExp, m1: PBShaderExp): PBShaderExp;
        ptr: ShaderTypeFunc;
        [dim: number]: ShaderTypeFunc;
    };
```