/**
 * Shader-level checks for the water material's two refraction modes.
 *
 * The cheap mode exists to remove work, so what has to be pinned is an absence:
 * the emitted shader must not contain the depth-buffer search, because a variant
 * that still carries it costs the same as the accurate one while looking worse.
 * Reading the source is the only way to see that - a rendered image would show
 * the mode is different without showing that it is cheaper.
 */

import type { AbstractDevice, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { WaterMaterial } from '../../../libs/scene/src/material/water';
import type { WaterRefractionMode } from '../../../libs/scene/src/material/water';

const DEVICE_TYPES = ['webgpu', 'webgl2'] as const;

function createMockDevice(type: (typeof DEVICE_TYPES)[number]): AbstractDevice {
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
 * Builds a fragment shader calling `waterRefraction` in the requested mode.
 *
 * The uniforms and helpers it reaches for are declared by hand rather than by
 * running the material's own `fragmentShader`, which would need a wave
 * generator, a draw context and a real device. What is under test is the body of
 * the refraction code, which depends only on the mode.
 */
function buildRefraction(type: (typeof DEVICE_TYPES)[number], mode: WaterRefractionMode) {
  const pb = new ProgramBuilder(createMockDevice(type));
  const material = new WaterMaterial();
  material.refractionMode = mode;
  return pb.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
      });
    },
    fragment(this: PBGlobalScope, pb) {
      // The refraction code reaches for the engine's global camera uniforms
      // through ShaderHelper. Only the members it actually touches are declared
      // here - standing up the real global bind group would need a device, a
      // draw context and a render pass, none of which change the code emitted.
      const cameraStruct = pb.defineStruct([
        pb.vec4('position'),
        pb.mat4('viewProjectionMatrix'),
        pb.mat4('invViewProjectionMatrix'),
        pb.mat4('viewMatrix'),
        pb.vec4('params')
      ]);
      this.camera = cameraStruct().uniform(0);
      // The accurate mode reads the scene depth once per march step. Declared
      // under the engine's own name so ShaderHelper finds it; the cheap mode
      // never touches it, which is the point of the test below.
      this.Z_UniformLinearDepth = pb.tex2D().uniform(0);
      this.refractionScale = pb.float().uniform(0);
      this.worldPos = pb.vec3().uniform(0);
      this.normal = pb.vec3().uniform(0);
      this.eyeVecNorm = pb.vec3().uniform(0);
      this.screenUV = pb.vec2().uniform(0);
      this.geom = pb.vec4().uniform(0);
      this.straightWorldPos = pb.vec3().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function (this: PBInsideFunctionScope) {
        const result = material.waterRefraction(
          this,
          this.worldPos,
          this.normal,
          this.eyeVecNorm,
          this.screenUV,
          this.geom.x,
          this.geom.y,
          this.straightWorldPos,
          this.geom.z
        ) as PBShaderExp;
        this.$outputs.color = pb.vec4(result, 1);
      });
    }
  });
}

describe('water refraction modes', () => {
  test.each(DEVICE_TYPES)('both modes compile on %s', (type) => {
    for (const mode of ['march', 'offset'] as const) {
      const ret = buildRefraction(type, mode);
      expect(ret).not.toBeNull();
      const [, fragmentSource] = ret!;
      expect(fragmentSource).toContain('waterRefraction');
    }
  });

  test.each(DEVICE_TYPES)('the cheap mode emits no depth search on %s', (type) => {
    const [, cheap] = buildRefraction(type, 'offset')!;
    // The march and its per-step helper are the cost this mode exists to avoid.
    // A dead function is not good enough: it still drags the depth texture and
    // the view/projection matrices into the bind group.
    expect(cheap).not.toContain('waterRefractMarch');
    expect(cheap).not.toContain('waterRefractStep');
    // And the accurate one must still have them, or this test proves nothing.
    const [, accurate] = buildRefraction(type, 'march')!;
    expect(accurate).toContain('waterRefractMarch');
    expect(accurate).toContain('waterRefractStep');
  });

  test.each(DEVICE_TYPES)('the cheap mode keeps the shared projection on %s', (type) => {
    // The offset is still a real projection of a world-space point, not a
    // screen-space fudge along the normal: that is what makes it track the view
    // direction and the perspective rather than rotating with the camera.
    const [, cheap] = buildRefraction(type, 'offset')!;
    expect(cheap).toContain('waterRefractProjectUV');
    // The border fade has to survive too, or the sample smears the edge pixel
    // along the whole waterline once the offset pushes it off screen.
    expect(cheap).toContain('waterRefractUV');
  });

  test('the cheap mode is strictly smaller', () => {
    // A blunt but honest measure: if the cheap variant is not shorter, the
    // gating has stopped doing anything.
    const [, cheap] = buildRefraction('webgpu', 'offset')!;
    const [, accurate] = buildRefraction('webgpu', 'march')!;
    expect(cheap.length).toBeLessThan(accurate.length);
  });

  test('the mode is a shader variant, not a uniform', () => {
    // Two materials differing only in mode must not share a compiled program,
    // or one of them renders with the other's code.
    const a = new WaterMaterial();
    const b = new WaterMaterial();
    b.refractionMode = 'offset';
    expect(a.refractionMode).toBe('march');
    expect(b.refractionMode).toBe('offset');
    expect((b as unknown as { _createHash(): string })._createHash()).not.toBe(
      (a as unknown as { _createHash(): string })._createHash()
    );
  });

  test('march is the default', () => {
    // The cheap mode is opt-in: a scene that says nothing gets the correct one.
    expect(new WaterMaterial().refractionMode).toBe('march');
  });
});
