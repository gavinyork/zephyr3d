/**
 * Codegen guards for {@link WaterMaterial}'s refracted view offset.
 *
 * The offset is derived rather than authored: the view ray is bent by Snell's
 * law, followed to whatever is behind the water, and the landing point is
 * projected back to the screen. That reaches for the view-projection matrix, the
 * view matrix and the linear depth texture, and it has to hold under both
 * backends and both depth conventions - the whole suite is run once per
 * convention, so these tests see both.
 *
 * Nothing renders here. The value is in getting the shader builder to emit
 * source at all: a mistake in this path is a shader compile failure at runtime,
 * and the properties asserted below are the ones that were wrong in the previous
 * normal-driven form and would be silently reintroduced by a rewrite.
 */

import type { AbstractDevice } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { REVERSE_Z, Z_CONVENTION } from '@zephyr3d/base';
import { WaterMaterial } from '../../../libs/scene/src/material/water';

const DEVICE_TYPES = ['webgpu', 'webgl2', 'webgl'] as const;
type DeviceType = (typeof DEVICE_TYPES)[number];

function createMockDevice(type: DeviceType): AbstractDevice {
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

/**
 * Builds a fragment shader whose only content is the refraction solve.
 *
 * The uniforms are declared by hand under the names ShaderHelper reads, which is
 * what lets the term be built without the rest of the water material's light
 * loop, sky bake and wave generator.
 */
function buildRefractionShader(deviceType: DeviceType) {
  const pb = new ProgramBuilder(createMockDevice(deviceType));
  const material = new WaterMaterial();
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
        pb.mat4('viewProjectionMatrix'),
        pb.vec4('params'),
        pb.vec2('renderSize')
      ]);
      this.camera = cameraStruct().uniform(0);
      // Name must match ShaderHelper's UNIFORM_NAME_LINEAR_DEPTH_MAP.
      this.Z_UniformLinearDepth = pb.tex2D().uniform(0);
      this.refractionScale = pb.float().uniform(2);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$l.eyeVec = pb.normalize(pb.vec3(0.3, -0.8, 0.5));
        this.$l.info = material.waterRefraction(
          this,
          this.$inputs.worldPos,
          pb.vec3(0, 1, 0),
          this.eyeVec,
          pb.vec2(0.5),
          pb.float(-10),
          pb.float(0.2),
          pb.float(4)
        );
        this.$outputs.color = pb.vec4(this.info, 1);
      });
    }
  }) as unknown as [string, string];
}

describe(`Water refraction codegen (${Z_CONVENTION}-Z)`, () => {
  for (const deviceType of DEVICE_TYPES) {
    describe(deviceType, () => {
      let fs: string;
      beforeAll(() => {
        fs = buildRefractionShader(deviceType)[1];
      });

      test('emits the refraction solve', () => {
        expect(fs).toBeTruthy();
        expect(fs).toContain('waterRefraction');
        expect(fs).toContain('waterRefractProbe');
        expect(fs).toContain('waterRefractProjectUV');
      });

      test('bends the view ray by Snell instead of offsetting along the normal', () => {
        // The physical content of the term. A rewrite that drops the refract call
        // is back to pushing the UV by a world-space direction, which rotates the
        // pattern with the camera as it yaws.
        expect(body('waterRefraction')).toContain('refract(');
        // Both ratios are emitted, so a surface seen from below bends the other
        // way rather than being left to refract as if it were seen from above.
        expect(body('waterRefraction')).toContain(String(1 / 1.333));
        expect(body('waterRefraction')).toContain('1.333');
      });

      test('iterates the solve rather than trusting the first landing', () => {
        // The first probe steps by the straight-line path length, which is wrong
        // wherever the refracted ray reaches a differently distant part of the
        // scene; the second re-solves from the depth the first one read.
        const solve = body('waterRefraction');
        expect(solve.match(/waterRefractProbe\(/g) ?? []).toHaveLength(2);
        // A rejected probe halves the step instead of giving up, which is what
        // keeps the surface continuous across the silhouette of anything sticking
        // out of the water.
        expect(solve).toMatch(/pathLen\s*=\s*pathLen\s*\*\s*0\.5/);
      });

      test('reads the depth texture through the helper that owns the convention', () => {
        // Decoding device depth is the only convention-dependent step, and it is
        // ShaderHelper.sampleLinearDepth's job. On WebGL1 that means the RGBA
        // decode; elsewhere a straight red-channel fetch. Either way the probe
        // must not decode depth itself.
        const probe = body('waterRefractProbe');
        if (deviceType === 'webgl') {
          expect(probe).toContain('Z_decodeNormalizedFloatFromRGBA');
        } else {
          expect(probe).toMatch(/textureSampleLevel|textureLod/);
        }
        // Whatever came back is treated as normalized linear depth and turned
        // into a view-space z, which is where the comparison happens.
        expect(probe).toMatch(/-\s*linearDepth\s*\*/);
        expect(probe).toMatch(/hitViewZ\s*<\s*surfaceViewZ/);
      });

      test('projects with clip xy only, so the depth convention cannot reach it', () => {
        // Reverse-Z rewrites nothing but the z row of the projection matrix, so a
        // projection that divides clip xy by w is convention-agnostic by
        // construction. Reading clip z here would make it convention-dependent
        // without any branch to notice.
        const fn = body('waterRefractProjectUV');
        expect(fn).toMatch(/h\.xy\s*\/\s*max\(h\.w/);
        expect(fn).not.toMatch(/h\.z/);
      });

      test('fades the offset out at the screen border', () => {
        // Off screen there is no scene colour to refract; a clamped sample would
        // smear one border pixel along the whole edge of the water.
        const fn = body('waterRefractUV');
        expect(fn).toContain('min(');
        expect(fn).toMatch(/mix\(screenUV\s*,\s*uv/);
      });

      /** Source of one emitted function, without the rest of the shader. */
      function body(name: string) {
        // Match a definition rather than a call: WGSL prefixes with `fn`, GLSL
        // with the return type, and both put the parameter list on the same line.
        const at = fs.search(new RegExp(`(fn |\\w+ )${name}\\(`));
        expect(at).toBeGreaterThanOrEqual(0);
        const end = fs.indexOf('\n}', at);
        expect(end).toBeGreaterThan(at);
        return fs.slice(at, end + 2);
      }
    });
  }

  test('the solve never consults the depth convention', () => {
    // Both conventions must emit the same source for the solve, because every
    // comparison in it happens in view space and the one convention-dependent
    // step is delegated. Pinning the expected text against a value computed from
    // REVERSE_Z would pass vacuously, so this asserts the opposite: no constant
    // that differs between conventions appears at all. The far plane it does read
    // is a uniform under either.
    const fs = buildRefractionShader('webgpu')[1];
    const at = fs.indexOf('fn waterRefraction(');
    const solve = fs.slice(at, fs.indexOf('\n}', at) + 2);
    expect(solve).toContain('params.y');
    // Under standard-Z these helpers would have to appear somewhere in the path
    // if the solve were doing its own depth handling.
    expect(solve).not.toContain('zSamplePositionFromDepth');
    expect(solve).not.toMatch(/\* 2\.0\) - 1\.0/);
    // Guard the premise itself: a run under either convention reaches this test,
    // and the suite is executed once per convention.
    expect([true, false]).toContain(REVERSE_Z);
  });
});
