import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';

function createMockDevice(type: 'webgpu' | 'webgl2', supportShaderF16: boolean): AbstractDevice {
  return {
    type,
    getDeviceCaps() {
      return {
        shaderCaps: {
          supportShaderF16
        }
      };
    }
  } as unknown as AbstractDevice;
}

function createWebGPUProgramBuilder(supportShaderF16 = true) {
  return new ProgramBuilder(createMockDevice('webgpu', supportShaderF16));
}

describe('shader-f16 support for WGSL backend', () => {
  test('f16 compute shader emits enable directive, f16 types and literals', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [64, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.a = pb.half(0.5);
          this.$l.b = pb.hvec2(1, 2);
          this.$l.c = pb.hvec3(this.b, this.a);
          this.$l.d = pb.hvec4(pb.mul(this.c, pb.half(2)), this.a);
          this.$l.e = pb.dot(this.d.xy, this.b);
        });
      }
    });
    expect(ret).not.toBeNull();
    const source = ret![0];
    expect(source.startsWith('enable f16;\n')).toBe(true);
    expect(source).toContain('f16');
    expect(source).toContain('vec2<f16>');
    expect(source).toContain('vec3<f16>');
    expect(source).toContain('vec4<f16>');
    expect(source).toContain('0.5h');
  });

  test('shader without f16 does not emit enable directive', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [64, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.a = pb.vec4(0.5);
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![0]).not.toContain('enable f16;');
  });

  test('f16 literal assignment to f16 variable emits h suffix', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.a = pb.half();
          this.a = 0.25;
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![0]).toContain('0.25h');
  });

  test('f16 and f32 conversion constructors work', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.f = pb.vec3(1, 2, 3);
          this.$l.h = pb.hvec3(this.f);
          this.$l.g = pb.vec3(this.h);
          this.$l.s = pb.float(pb.half(this.g.x));
        });
      }
    });
    expect(ret).not.toBeNull();
    const source = ret![0];
    expect(source).toContain('vec3<f16>(');
    expect(source).toContain('f16(');
  });

  test('f16 varying propagates enable directive to fragment stage', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.color = pb.hvec4();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
          this.$outputs.color = pb.hvec4(1);
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$outputs.outColor = pb.vec4(this.$inputs.color);
        });
      }
    });
    expect(ret).not.toBeNull();
    const [vs, fs] = ret!;
    expect(vs.startsWith('enable f16;\n')).toBe(true);
    expect(fs.startsWith('enable f16;\n')).toBe(true);
    expect(vs).toContain('vec4<f16>');
  });

  test('vertex-only f16 usage does not emit enable directive in fragment stage', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        pb.main(function () {
          this.$l.h = pb.half(0.5);
          this.$builtins.position = pb.vec4(this.$inputs.pos, pb.float(this.h));
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$outputs.outColor = pb.vec4(1);
        });
      }
    });
    expect(ret).not.toBeNull();
    const [vs, fs] = ret!;
    expect(vs.startsWith('enable f16;\n')).toBe(true);
    expect(fs).not.toContain('enable f16;');
  });

  test('f16 builtin function overloads work', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.v = pb.hvec3(1);
          this.$l.a = pb.normalize(this.v);
          this.$l.b = pb.clamp(this.v, pb.hvec3(0), pb.hvec3(1));
          this.$l.c = pb.saturate(this.v);
          this.$l.d = pb.sin(this.v);
          this.$l.e = pb.length(this.v);
          this.$l.f = pb.mix(this.v, this.a, pb.half(0.5));
          this.$l.g = pb.add(this.v, pb.half(0.25));
          this.$l.h = pb.max(this.v, this.a);
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![0].startsWith('enable f16;\n')).toBe(true);
  });

  test('constructing f16 throws when device does not support shader-f16', () => {
    const pb = createWebGPUProgramBuilder(false);
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.a = pb.half(0.5);
        });
      }
    });
    expect(ret).toBeNull();
    expect(pb.lastError).toContain('not support');
  });

  test('constructing f16 throws on webgl2 device', () => {
    const pb = new ProgramBuilder(createMockDevice('webgl2', false));
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.a = pb.half(0.5);
        });
      }
    });
    expect(ret).toBeNull();
  });

  test('mixing f16 and f32 in binary operation throws', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.h = pb.hvec2(1);
          this.$l.f = pb.vec2(1);
          this.$l.r = pb.add(this.h, this.f);
        });
      }
    });
    expect(ret).toBeNull();
  });

  test('f16 uniform declaration throws', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        this.someUniform = pb.hvec4().uniform(0);
        pb.main(function () {
          this.$l.a = this.someUniform;
        });
      }
    });
    expect(ret).toBeNull();
    expect(pb.lastError).toContain('f16 types are not allowed');
  });

  test('f16 swizzle preserves f16 type', () => {
    const pb = createWebGPUProgramBuilder();
    const ret = pb.buildCompute({
      workgroupSize: [1, 1, 1],
      compute(pb) {
        pb.main(function () {
          this.$l.v = pb.hvec4(1);
          this.$l.s = this.v.xyz;
          this.$l.t = pb.hvec3(0);
          this.t = this.s;
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![0]).toContain('vec3<f16>');
  });
});
