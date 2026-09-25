import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { skinTransmission } from '../../../libs/scene/src/shaders/skin_brdf';

/**
 * Compile checks for the transmission BxDF.
 *
 * The transmission path only ever runs on WebGPU and only when a light opts
 * into it, so nothing in the ordinary test run or the sample scenes gets near
 * it — a codegen mistake here would surface as a black screen in the editor,
 * not as a failing test. These build the shader for real and assert the parts
 * that are easy to get wrong.
 */
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

function buildTransmissionShader(deviceType: 'webgpu' | 'webgl2') {
  const pb = new ProgramBuilder(createMockDevice(deviceType));
  return pb.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
      });
    },
    fragment(pb) {
      this.profileTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.texelSize = pb.vec2().uniform(0);
      this.profileId = pb.float().uniform(0);
      this.thickness = pb.float().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$l.n = pb.vec3(0, 0, 1);
        this.$l.v = pb.vec3(0, 0, 1);
        this.$l.l = pb.vec3(0, 1, 0);
        this.$l.t = skinTransmission(
          this,
          this.profileTex,
          this.texelSize,
          this.profileId,
          this.thickness,
          this.n,
          this.v,
          this.l
        );
        this.$outputs.color = pb.vec4(this.t, 1);
      });
    }
  });
}

describe('Skin transmission shader', () => {
  test('builds on WebGPU', () => {
    const program = buildTransmissionShader('webgpu');
    expect(program).toBeTruthy();
    expect(program![1]).toBeTruthy();
  });

  test('samples the profile table from the caller scope, not through a function parameter', () => {
    // A texture can be a shader function parameter, but on WebGPU its sampler
    // has to travel with it as a second parameter; a bare textureSampleLevel on
    // the parameter compiles to nothing usable. The table reads are therefore
    // emitted inline, and the only function the BxDF declares must take no
    // texture.
    const program = buildTransmissionShader('webgpu');
    const src = program![1];
    expect(src).toContain('lib_skinTransmissionPhase');
    const decl = src.slice(src.indexOf('fn lib_skinTransmissionPhase'));
    const signature = decl.slice(0, decl.indexOf('{'));
    expect(signature).not.toContain('texture_2d');
    expect(signature).not.toContain('sampler');
  });

  test('bends the view ray and evaluates the phase function', () => {
    // The two pieces of UE5's SubsurfaceProfileBxDF that are not just a table
    // read. Losing either leaves a plausible-looking but directionless glow.
    const src = buildTransmissionShader('webgpu')![1];
    expect(src).toContain('refract(');
    // ApproximateHG's numerator, 0.5 * (1 - g*g).
    expect(src).toMatch(/textureSampleLevel/);
  });

  test('builds on WebGL2 as well', () => {
    // The pipeline only enables transmission on WebGPU, but the BxDF itself has
    // no business being backend-specific, and a GLSL build failure here would
    // mean it had picked up a WGSL-only construct.
    const program = buildTransmissionShader('webgl2');
    expect(program).toBeTruthy();
  });
});
