/**
 * Shader-level checks for the water caustics feature.
 *
 * Nothing here renders. The value is in getting the shader builder to actually
 * emit source for both backends: the caustics code runs in a vertex shader
 * (photon splat) and inside the light loop (sampling), and a mistake in either
 * only shows up as a shader compile failure at runtime, which no other test in
 * the suite would catch.
 */

import type { AbstractDevice, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { ShaderHelper } from '../../../libs/scene/src/material/shader/helper';
import {
  LIGHT_TYPE_DIRECTIONAL,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_DEPTH
} from '../../../libs/scene/src/values';
import type { DrawContext } from '../../../libs/scene/src/render/drawable';
import type { WaveGenerator } from '../../../libs/scene/src/render/wavegenerator';
import {
  createCausticBlurShader,
  createCausticResolveShader,
  createCausticSplatShader
} from '../../../libs/scene/src/render/water_caustics';

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

/** A context the caustics code accepts, or rejects when `active` is false. */
function createMockContext(active: boolean, passType = RENDER_PASS_TYPE_LIGHT): DrawContext {
  return {
    waterCaustics: active,
    waterCausticLight: active ? ({} as never) : null,
    renderPass: { type: passType }
  } as unknown as DrawContext;
}

/** Builds a fragment shader that writes the caustic attenuation. */
function buildCausticSampler(type: (typeof DEVICE_TYPES)[number], ctx: DrawContext) {
  const pb = new ProgramBuilder(createMockDevice(type));
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
      if (ShaderHelper.usesWaterCaustics(ctx)) {
        ShaderHelper.declareWaterCausticUniforms(pb);
      }
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        const caustic = ShaderHelper.calculateWaterCaustic(
          this,
          this.$inputs.worldPos,
          pb.int(LIGHT_TYPE_DIRECTIONAL),
          pb.vec3(0, -1, 0),
          ctx
        );
        this.$outputs.color = pb.vec4(caustic ?? pb.vec3(1), 1);
      });
    }
  });
}

describe('water caustics sampling shader', () => {
  test.each(DEVICE_TYPES)('emits a compilable caustic lookup on %s', (type) => {
    const ret = buildCausticSampler(type, createMockContext(true));
    expect(ret).not.toBeNull();
    const [vertexSource, fragmentSource] = ret!;
    expect(vertexSource.length).toBeGreaterThan(0);
    // The lookup must survive as a real function, not be folded away.
    expect(fragmentSource).toContain('Z_calculateWaterCaustic');
    // Beer-Lambert transmittance along the light path, and the map lookup.
    expect(fragmentSource).toContain('exp');
    expect(fragmentSource).toContain('Z_UniformCausticMap');
  });

  test('produces no caustic code when the feature is off', () => {
    const ctx = createMockContext(false);
    expect(ShaderHelper.usesWaterCaustics(ctx)).toBe(false);
    const ret = buildCausticSampler('webgpu', ctx);
    expect(ret).not.toBeNull();
    expect(ret![1]).not.toContain('Z_calculateWaterCaustic');
    expect(ret![1]).not.toContain('Z_UniformCausticMap');
  });

  test('is confined to the light pass', () => {
    // A depth prepass has no lighting to modulate, and no light uniforms either.
    expect(ShaderHelper.usesWaterCaustics(createMockContext(true, RENDER_PASS_TYPE_DEPTH))).toBe(false);
    // No map was produced this frame.
    expect(ShaderHelper.usesWaterCaustics(createMockContext(false))).toBe(false);
  });

  test('gates on the light at runtime, not on which pass is building', () => {
    // Which light gets the caustics is a per-fragment decision, because a
    // shadow-casting sun reaches the opaque queue through the clustered path
    // (screen-space shadow mask on, the default) or a per-light additive pass
    // (mask off), and the shader is the same either way.
    const fragmentSource = buildCausticSampler('webgpu', createMockContext(true))![1];
    // Type test against the directional constant, and a direction match.
    expect(fragmentSource).toMatch(/lightType/);
    expect(fragmentSource).toMatch(/dot\(/);
  });

  test.each(DEVICE_TYPES)('projects with both half-extents on %s', (type) => {
    // The slice is fitted to the water, so its two axes have independent
    // half-extents and the map is square only in texels. Scaling both axes by
    // frameX.w compiles and looks right on any square slice - every scene where
    // the water fills the range - and silently stretches the pattern along one
    // axis on every other one.
    const fragmentSource = buildCausticSampler(type, createMockContext(true))![1];
    expect(fragmentSource).toContain('frameY');
    const body = fragmentSource.slice(fragmentSource.indexOf('Z_calculateWaterCaustic'));
    // Both reciprocals reach the projection, not just frameX's.
    expect(body).toMatch(/frameX\)?\.w/);
    expect(body).toMatch(/frameY\)?\.w/);
  });

  test.each(DEVICE_TYPES)('warps the map lookup but not the edge fade on %s', (type) => {
    const fragmentSource = buildCausticSampler(type, createMockContext(true))![1];
    expect(fragmentSource).toContain('Z_warpCausticNDC');
    // The texture lookup goes through the warp, because that is where the map's
    // texels are. The edge fade does not: the warp fixes both ends of [-1, 1],
    // so fading on the warped coordinate leaves the border in the same world
    // place while silently rescaling the band leading up to it - and the CPU
    // sized that band in meters. Both are two lines apart and read from the same
    // two vectors, so this pins which one each of them takes.
    const declOf = (name: string) =>
      fragmentSource.match(new RegExp(`\\b${name}\\b\\s*(?::[^=]*)?=([^;]*);`))?.[1] ?? '';
    const uvDecl = declOf('uv');
    const fadeDecl = declOf('ndcSq');
    expect(uvDecl).toContain('warpedNDC');
    expect(fadeDecl).toContain('mapNDC');
    expect(fadeDecl).not.toContain('warpedNDC');
  });

  test('returns null rather than a neutral expression when inactive', () => {
    const pb = new ProgramBuilder(createMockDevice('webgpu'));
    let result: unknown = 'unset';
    pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          result = ShaderHelper.calculateWaterCaustic(
            this,
            pb.vec3(0),
            pb.int(LIGHT_TYPE_DIRECTIONAL),
            pb.vec3(0, -1, 0),
            createMockContext(false)
          );
          this.$outputs.color = pb.vec4(1);
        });
      }
    });
    expect(result).toBeNull();
  });
});

/**
 * A wave generator that produces a displacement and a normal from a uniform and
 * an explicit-LOD texture fetch, which is what the real ones do. Only the shader
 * side is implemented; the splat pass never touches anything else.
 */
function createStubWaveGenerator(sampleTexture: boolean): WaveGenerator {
  return {
    getHash: () => `stub:${sampleTexture}`,
    setupUniforms(scope: PBGlobalScope, group: number) {
      const pb = scope.$builder;
      scope.stubWaveParams = pb.vec4().uniform(group);
      if (sampleTexture) {
        scope.stubWaveTexture = pb.tex2D().uniform(group);
      }
    },
    calcVertexPositionAndNormal(
      scope: PBInsideFunctionScope,
      inPos: PBShaderExp,
      outPos: PBShaderExp,
      outNormal: PBShaderExp
    ) {
      const pb = scope.$builder;
      // Out-parameters, the same shape the real generators use.
      pb.func(
        'stubCalcPositionAndNormal',
        [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out()],
        function () {
          // Animated off camera.elapsedTime, exactly like the FBM and Gerstner
          // generators. The splat pass has to have declared that field itself.
          this.outPos = pb.add(
            this.inPos,
            pb.vec3(0, pb.mul(this.stubWaveParams.x, ShaderHelper.getElapsedTime(this)), 0)
          );
          this.outNormal = pb.vec3(0, 1, 0);
        }
      );
      scope.stubCalcPositionAndNormal(inPos, outPos, outNormal);
    },
    calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp) {
      const pb = scope.$builder;
      if (sampleTexture) {
        // Explicit LOD: an implicit-derivative fetch here would be illegal in a
        // vertex shader, which is exactly what this test is guarding.
        const s = pb.textureSampleLevel(scope.stubWaveTexture, pb.mul(xz, 0.01), 0);
        return pb.normalize(pb.vec3(s.x, 1, s.y));
      }
      return pb.normalize(pb.vec3(scope.stubWaveParams.y, 1, scope.stubWaveParams.z));
    }
  } as unknown as WaveGenerator;
}

describe('water caustics splat shader', () => {
  test.each(DEVICE_TYPES)('builds the photon splat program on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const ret = pb.buildRender(createCausticSplatShader(createStubWaveGenerator(false)));
    expect(ret).not.toBeNull();
    const [vertexSource, fragmentSource] = ret!;
    // The whole photon transform lives in the vertex stage.
    expect(vertexSource).toContain('refract');
    expect(vertexSource).toContain('causticFrameX');
    expect(vertexSource).toContain('causticSplatParams');
    // The fragment stage only deposits the weight.
    expect(fragmentSource).not.toContain('refract');
  });

  test.each(DEVICE_TYPES)('samples wave data from the vertex stage on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const ret = pb.buildRender(createCausticSplatShader(createStubWaveGenerator(true)));
    expect(ret).not.toBeNull();
    const vertexSource = ret![0];
    expect(vertexSource).toContain('stubWaveTexture');
    // Explicit-LOD sampling only. WGSL forbids implicit derivatives outside the
    // fragment stage, and GLSL vertex shaders have no derivatives to use.
    const implicitSample = type === 'webgpu' ? /textureSample\(/ : /texture\(\s*stubWaveTexture/;
    expect(vertexSource).not.toMatch(implicitSample);
  });

  test.each(DEVICE_TYPES)('lays the photon grid out with both half-extents on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const vertexSource = pb.buildRender(createCausticSplatShader(createStubWaveGenerator(false)))![0];
    // Both the grid layout and the projection of the hit position have to use
    // the slice's own extent per axis; sharing frameX's silently skews the
    // photon grid against the map on any slice that is not square in meters.
    expect(vertexSource).toMatch(/causticFrameX\)?\.w/);
    expect(vertexSource).toMatch(/causticFrameY\)?\.w/);
  });

  test.each(DEVICE_TYPES)('lays the photon grid out in warped space on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const vertexSource = pb.buildRender(createCausticSplatShader(createStubWaveGenerator(false)))![0];
    // The grid is uniform in the space the map's texels live in and unwarped to
    // reach the plane; the hit is warped back on the way out. Both directions
    // have to be present, or calm water stops landing one photon per texel and
    // the map's normalisation to 1.0 goes with it.
    expect(vertexSource).toContain('Z_unwarpCausticNDC');
    expect(vertexSource).toContain('Z_warpCausticNDC');
  });

  test.each(DEVICE_TYPES)('builds the blur program on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const ret = pb.buildRender(createCausticBlurShader());
    expect(ret).not.toBeNull();
    expect(ret![1]).toContain('causticTexelSize');
  });
});

describe('water caustics temporal resolve shader', () => {
  test.each(DEVICE_TYPES)('builds the resolve program on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const ret = pb.buildRender(createCausticResolveShader());
    expect(ret).not.toBeNull();
    const fragmentSource = ret![1];
    // Reprojection needs both frames' slices; dropping either silently turns the
    // resolve into a plain blend that smears whenever the camera moves.
    for (const uniform of ['causticFrameX', 'causticPrevFrameX', 'causticPrevFrameY', 'causticPrevCenter']) {
      expect(fragmentSource).toContain(uniform);
    }
    expect(fragmentSource).toContain('causticHistory');
    // Both frames' second extents: reprojecting through frameX's alone puts the
    // history a growing distance off along y on any non-square slice.
    expect(fragmentSource).toMatch(/causticFrameY\)?\.w/);
    expect(fragmentSource).toMatch(/causticPrevFrameY\)?\.w/);
    // Leaves warped space to reach the world and re-enters it to land on the
    // history, since the two frames can differ in warp strength as well as in
    // slice. Using one strength for both drifts the history under any change.
    expect(fragmentSource).toContain('Z_unwarpCausticNDC');
    expect(fragmentSource).toContain('Z_warpCausticNDC');
  });

  test.each(DEVICE_TYPES)('bounds the history by the current neighbourhood on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const fragmentSource = pb.buildRender(createCausticResolveShader())![1];
    // Without the clamp a long blend smears the animated pattern instead of just
    // stabilising it, which is the whole reason the blend can be this long.
    expect(fragmentSource).toMatch(/clamp\s*\(/);
    // Eight neighbours plus the centre, and one history tap.
    const taps = fragmentSource.match(/textureSampleLevel|textureLod/g) ?? [];
    expect(taps.length).toBe(10);
  });

  test.each(DEVICE_TYPES)('maps NDC to UV the way receivers do on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    const fragmentSource = pb.buildRender(createCausticResolveShader())![1];
    // The resolve reads and writes the same map the light pass samples, so it has
    // to use that pass's `ndc * 0.5 + 0.5`. Inverting v here instead would put the
    // reprojection a full map-height out on one backend only, which is the shape
    // of bug that the even blur-pass count already hides once.
    expect(fragmentSource).not.toMatch(/1(\.0)?\s*-\s*\(?\s*\w*[uU][vV]/);
  });
});

describe('water caustics uniform declaration', () => {
  test.each(DEVICE_TYPES)('declares the map and its parameters on %s', (type) => {
    const pb = new ProgramBuilder(createMockDevice(type));
    let scope: PBGlobalScope | null = null;
    const ret = pb.buildRender({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
        });
      },
      fragment(pb) {
        ShaderHelper.declareWaterCausticUniforms(pb);
        scope = pb.getGlobalScope();
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.vec4(this.Z_UniformCausticParams.params.x);
        });
      }
    });
    expect(ret).not.toBeNull();
    expect(scope).not.toBeNull();
    expect(ret![1]).toContain('Z_UniformCausticParams');
  });
});
