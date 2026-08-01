import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { ShaderHelper } from '../../../libs/scene/src/material/shader/helper';
import { computeShadowMapDepth } from '../../../libs/scene/src/shaders/shadow';

/**
 * Depth-convention status-quo snapshots.
 *
 * These snapshots pin the exact generated shader source for every code path
 * that encodes a depth-direction assumption (depth range correction, depth
 * clamp emulation, depth linearization, far-plane tricks). Any refactoring
 * that claims to be behavior-preserving under the standard-Z convention must
 * keep these snapshots byte-identical.
 */

function createMockDevice(type: 'webgpu' | 'webgl2', clipSpaceZeroToOne?: boolean): AbstractDevice {
  return {
    type,
    clipSpaceZeroToOne: clipSpaceZeroToOne ?? type === 'webgpu',
    getDeviceCaps() {
      return {
        shaderCaps: {
          supportShaderF16: false
        }
      };
    }
  } as unknown as AbstractDevice;
}

const DEVICE_TYPES = ['webgpu', 'webgl2'] as const;

function buildMinimalRender(deviceType: (typeof DEVICE_TYPES)[number], emulateDepthClamp: boolean) {
  const pb = new ProgramBuilder(createMockDevice(deviceType));
  pb.emulateDepthClamp = emulateDepthClamp;
  return pb.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
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

describe('depth convention status-quo shader snapshots', () => {
  test.each([...DEVICE_TYPES])('depth range correction: minimal vertex/fragment (%s)', (deviceType) => {
    const ret = buildMinimalRender(deviceType, false);
    expect(ret).not.toBeNull();
    expect(ret![0]).toMatchSnapshot(`${deviceType}-minimal-vs`);
    expect(ret![1]).toMatchSnapshot(`${deviceType}-minimal-fs`);
  });

  test.each([...DEVICE_TYPES])('emulateDepthClamp vertex/fragment (%s)', (deviceType) => {
    const ret = buildMinimalRender(deviceType, true);
    expect(ret).not.toBeNull();
    expect(ret![0]).toMatchSnapshot(`${deviceType}-depthclamp-vs`);
    expect(ret![1]).toMatchSnapshot(`${deviceType}-depthclamp-fs`);
  });

  // Full clip-space correction matrix: device type x zero-to-one clip space
  // x emulateDepthClamp. Covers 'gl2zo' (standard/webgpu), 'zo2gl'
  // (reverse/webgl without EXT_clip_control) and 'none' paths.
  test.each([
    ['webgpu', true],
    ['webgl2', true],
    ['webgl2', false]
  ] as ['webgpu' | 'webgl2', boolean][])(
    'clip-space correction matrix (%s, zeroToOne=%s)',
    (deviceType, zeroToOne) => {
      for (const emulateDepthClamp of [false, true]) {
        const pb = new ProgramBuilder(createMockDevice(deviceType, zeroToOne));
        pb.emulateDepthClamp = emulateDepthClamp;
        const ret = pb.buildRender({
          vertex(pb) {
            this.$inputs.pos = pb.vec3().attrib('position');
            pb.main(function () {
              this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
            });
          },
          fragment(pb) {
            this.$outputs.color = pb.vec4();
            pb.main(function () {
              this.$outputs.color = pb.vec4(1);
            });
          }
        });
        expect(ret).not.toBeNull();
        expect(ret![0]).toMatchSnapshot(
          `${deviceType}-zo_${zeroToOne}-clamp_${emulateDepthClamp}-vs`
        );
      }
    }
  );

  test.each([...DEVICE_TYPES])('sky-style far plane push (z = w) (%s)', (deviceType) => {
    const pb = new ProgramBuilder(createMockDevice(deviceType));
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
          this.$builtins.position.z = this.$builtins.position.w;
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.vec4(1);
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![0]).toMatchSnapshot(`${deviceType}-sky-vs`);
  });

  test.each([...DEVICE_TYPES])('fullscreen quad at far plane (z = 1) (%s)', (deviceType) => {
    const pb = new ProgramBuilder(createMockDevice(deviceType));
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.vec4(1);
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![0]).toMatchSnapshot(`${deviceType}-fullscreen-vs`);
  });

  test.each([...DEVICE_TYPES])('ShaderHelper depth linearization trio (%s)', (deviceType) => {
    const pb = new ProgramBuilder(createMockDevice(deviceType));
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        });
      },
      fragment(pb) {
        this.nearFar = pb.vec2().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.d = pb.float(0.5);
          this.$l.lin = ShaderHelper.nonLinearDepthToLinear(this, this.d, this.nearFar);
          this.$l.nonlin = ShaderHelper.linearDepthToNonLinear(this, this.lin, this.nearFar);
          this.$l.norm = ShaderHelper.nonLinearDepthToLinearNormalized(this, this.d, this.nearFar);
          this.$outputs.color = pb.vec4(this.lin, this.nonlin, this.norm, 1);
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![1]).toMatchSnapshot(`${deviceType}-linearize-fs`);
  });

  test.each([...DEVICE_TYPES])('ShaderHelper.samplePositionFromDepth reconstruction (%s)', (deviceType) => {
    const pb = new ProgramBuilder(createMockDevice(deviceType));
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        });
      },
      fragment(pb) {
        this.depthTex = pb.tex2D().uniform(0);
        this.invViewProj = pb.mat4().uniform(0);
        this.nearFar = pb.vec2().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.uv = pb.vec2(0.5);
          this.$outputs.color = ShaderHelper.samplePositionFromDepth(
            this,
            this.depthTex,
            this.uv,
            this.invViewProj,
            this.nearFar
          );
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(ret![1]).toMatchSnapshot(`${deviceType}-reconstruct-fs`);
  });

  test.each([...DEVICE_TYPES])('computeShadowMapDepth native depth path (%s)', (deviceType) => {
    for (const emulateDepthClamp of [false, true]) {
      const pb = new ProgramBuilder(createMockDevice(deviceType));
      pb.emulateDepthClamp = emulateDepthClamp;
      const ret = pb.buildRender({
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.$outputs.worldPos = pb.vec3();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
            this.$outputs.worldPos = this.$inputs.pos;
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          pb.main(function () {
            this.$outputs.color = computeShadowMapDepth(this, this.$inputs.worldPos, 'd32f');
          });
        }
      });
      expect(ret).not.toBeNull();
      expect(ret![1]).toMatchSnapshot(`${deviceType}-shadowdepth-clamp_${emulateDepthClamp}-fs`);
    }
  });
});
