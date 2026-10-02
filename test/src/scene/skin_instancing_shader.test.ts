import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { ShaderHelper } from '../../../libs/scene/src/material/shader/helper';

function createMockDevice(type: 'webgpu' | 'webgl2'): AbstractDevice {
  return {
    type,
    clipSpaceZeroToOne: type === 'webgpu',
    getDeviceCaps() {
      return {
        shaderCaps: {
          supportShaderF16: false
        }
      };
    }
  } as unknown as AbstractDevice;
}

function buildSkinShader(type: 'webgpu' | 'webgl2', instanced: boolean) {
  const builder = new ProgramBuilder(createMockDevice(type));
  return builder.buildRender({
    vertex(pb) {
      ShaderHelper.vertexShaderDrawableStuff(this, true, false, instanced);
      const cameraStruct = pb.defineStruct([
        pb.mat4('unjitteredVPMatrix'),
        pb.mat4('prevUnjitteredVPMatrix'),
        pb.int('framestamp')
      ]);
      this.camera = cameraStruct().uniform(0);
      this.$inputs.zBlendIndices = pb.vec4().attrib('blendIndices');
      this.$inputs.zBlendWeights = pb.vec4().attrib('blendWeights');
      pb.main(function () {
        ShaderHelper.prepareSkinAnimation(this);
        this.$builtins.position = pb.vec4(ShaderHelper.resolveVertexPosition(this), 1);
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$outputs.color = pb.vec4(1);
      });
    }
  });
}

describe('skin palette base in skinning shaders', () => {
  for (const type of ['webgpu', 'webgl2'] as const) {
    test(`reads the palette base from a drawable uniform without instancing on ${type}`, () => {
      const result = buildSkinShader(type, false);
      expect(result).not.toBeNull();
      expect(result![0]).toContain(ShaderHelper.getSkinPaletteBaseUniformName());
    });

    test(`reads the palette base from instance data with instancing on ${type}`, () => {
      const result = buildSkinShader(type, true);
      expect(result).not.toBeNull();
      expect(result![0]).not.toContain(ShaderHelper.getSkinPaletteBaseUniformName());
      expect(result![0]).toContain(ShaderHelper.getInstanceDataUniformName());
    });
  }
});
