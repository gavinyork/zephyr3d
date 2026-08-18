import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { EyeMaterial } from '../../../libs/scene/src';

/**
 * Codegen guards for {@link EyeMaterial}'s contact occlusion term.
 *
 * The term reaches for two things the rest of the material never touches -
 * screen-space derivatives and a loop of depth taps - and both come with
 * placement rules that a type checker cannot see. WGSL only permits derivatives
 * in uniform control flow, and the term takes an early exit for distant eyes, so
 * `dpdx`/`dpdy` have to be emitted before that branch or the shader is invalid
 * on WebGPU while still compiling fine on WebGL. These tests build the shader
 * against a mock device so that ordering is checked without a GPU.
 */

function createMockDevice(type: 'webgpu' | 'webgl2' | 'webgl'): AbstractDevice {
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

function buildContactAOShader(deviceType: 'webgpu' | 'webgl2' | 'webgl', temporalJitter = false) {
  const pb = new ProgramBuilder(createMockDevice(deviceType));
  const material = new EyeMaterial();
  material.contactAO = true;
  material.contactAOTemporalJitter = temporalJitter;
  return pb.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      this.$outputs.worldPos = pb.vec3();
      pb.main(function () {
        this.$outputs.worldPos = this.$inputs.pos;
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
      });
    },
    fragment(pb) {
      // The members of the engine camera struct the term actually reads.
      const cameraStruct = pb.defineStruct([
        pb.mat4('viewMatrix'),
        pb.mat4('projectionMatrix'),
        pb.vec4('params'),
        pb.vec2('renderSize'),
        pb.int('framestamp')
      ]);
      this.camera = cameraStruct().uniform(0);
      // Name must match ShaderHelper's UNIFORM_NAME_LINEAR_DEPTH_MAP.
      this.Z_UniformLinearDepth = pb.tex2D().uniform(0);
      this.zEyeContactAORange = pb.vec4().uniform(2);
      this.zEyeContactAORadius = pb.float().uniform(2);
      this.zEyeContactAOStrength = pb.float().uniform(2);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$l.ao = (material as any).contactAOTerm(this);
        this.$outputs.color = pb.vec4(pb.vec3(this.ao), 1);
      });
    }
  });
}

describe('Eye material contact occlusion codegen', () => {
  for (const deviceType of ['webgpu', 'webgl2', 'webgl'] as const) {
    test(`emits a valid fragment shader on ${deviceType}`, () => {
      const [, fs] = buildContactAOShader(deviceType) as unknown as [string, string];
      expect(fs).toBeTruthy();
      expect(fs).toContain('Z_eyeContactAO');

      const body = fs.slice(fs.indexOf('Z_eyeContactAO'));
      const derivative = deviceType === 'webgpu' ? 'dpdx' : 'dFdx';
      const derivativeAt = body.indexOf(derivative);
      const earlyReturnAt = body.indexOf('return');
      expect(derivativeAt).toBeGreaterThanOrEqual(0);
      expect(earlyReturnAt).toBeGreaterThanOrEqual(0);
      // The derivative must precede the distance fade's early exit; past it the
      // control flow is no longer uniform.
      expect(derivativeAt).toBeLessThan(earlyReturnAt);
    });

    test(`emits a valid fragment shader with temporal jitter on ${deviceType}`, () => {
      const [, fs] = buildContactAOShader(deviceType, true) as unknown as [string, string];
      expect(fs).toBeTruthy();
      expect(fs).toContain('Z_eyeContactAO');
      expect(fs).toContain('framestamp');

      const body = fs.slice(fs.indexOf('Z_eyeContactAO'));
      const derivative = deviceType === 'webgpu' ? 'dpdx' : 'dFdx';
      const derivativeAt = body.indexOf(derivative);
      const earlyReturnAt = body.indexOf('return');
      expect(derivativeAt).toBeGreaterThanOrEqual(0);
      expect(earlyReturnAt).toBeGreaterThanOrEqual(0);
      expect(derivativeAt).toBeLessThan(earlyReturnAt);
    });
  }

  test('the term is omitted entirely when no depth prepass is bound', () => {    const pb = new ProgramBuilder(createMockDevice('webgpu'));
    const material = new EyeMaterial();
    material.contactAO = true;
    const [, fs] = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.worldPos = pb.vec3();
        pb.main(function () {
          this.$outputs.worldPos = this.$inputs.pos;
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.ao = (material as any).contactAOTerm(this);
          this.$outputs.color = pb.vec4(pb.vec3(this.ao), 1);
        });
      }
    }) as unknown as [string, string];
    expect(fs).toBeTruthy();
    expect(fs).not.toContain('Z_eyeContactAO');
  });
});
