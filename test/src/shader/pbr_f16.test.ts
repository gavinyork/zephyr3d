import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { mixinPBRBRDF } from '../../../libs/scene/src/material/mixins/pbr/brdf';

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

function createBRDF() {
  const cls = mixinPBRBRDF(class Dummy {} as any);
  return new (cls as any)() as InstanceType<ReturnType<typeof mixinPBRBRDF>>;
}

function buildBRDFShader(type: 'webgpu' | 'webgl2', supportShaderF16: boolean) {
  const pb = new ProgramBuilder(createMockDevice(type, supportShaderF16));
  const brdf = createBRDF();
  const ret = pb.buildCompute({
    workgroupSize: [1, 1, 1],
    compute(pb) {
      pb.main(function () {
        this.$l.NoV = pb.float(0.5);
        this.$l.NoL = pb.float(0.5);
        this.$l.NoH = pb.float(0.5);
        this.$l.alphaRoughness = pb.float(0.25);
        this.$l.f0 = pb.vec3(0.04);
        this.$l.f90 = pb.vec3(1);
        this.$l.F = (brdf as any).fresnelSchlick(this, this.NoH, this.f0, this.f90);
        this.$l.D = (brdf as any).distributionGGX(this, this.NoH, this.alphaRoughness);
        this.$l.V = (brdf as any).visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
        this.$l.result = pb.mul(this.F, this.D, this.V);
      });
    }
  });
  if (!ret) {
    throw new Error(pb.lastError ?? 'BRDF shader build failed');
  }
  return ret[0];
}

describe('PBR BRDF f16 optimization', () => {
  test('webgpu with shader-f16 uses half precision variants', () => {
    const source = buildBRDFShader('webgpu', true);
    expect(source.startsWith('enable f16;\n')).toBe(true);
    expect(source).toContain('Z_fresnelSchlick_h');
    expect(source).toContain('Z_visGGX_h');
    expect(source).toContain('vec3<f16>');
    // distributionGGX intentionally stays f32
    expect(source).toContain('Z_distributionGGX');
    expect(source).not.toContain('Z_distributionGGX_h');
    // raised epsilon for the f16 visibility term
    expect(source).toContain('0.0001h');
  });

  test('webgpu without shader-f16 keeps f32 code path', () => {
    const source = buildBRDFShader('webgpu', false);
    expect(source).not.toContain('enable f16;');
    expect(source).not.toContain('f16');
    expect(source).toContain('Z_fresnelSchlick');
    expect(source).toContain('Z_visGGX');
    expect(source).not.toContain('Z_fresnelSchlick_h');
    expect(source).not.toContain('Z_visGGX_h');
  });

  test('webgl2 keeps f32 code path', () => {
    const source = buildBRDFShader('webgl2', false);
    expect(source).not.toContain('f16');
    expect(source).toContain('Z_fresnelSchlick');
    expect(source).toContain('Z_visGGX');
  });
});
