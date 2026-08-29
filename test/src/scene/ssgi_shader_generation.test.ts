import { ProgramBuilder } from '../../../libs/device/src';
import { SSGI } from '../../../libs/scene/src/posteffect/ssgi';
import { EnvShIBL } from '../../../libs/scene/src/render/envlight';

function createShaderContext(type: 'webgl' | 'webgpu') {
  const device: any = {
    type,
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'SSGI shader generation failed');
      }
      return {
        bindGroupLayouts: result[2],
        name: '',
        vertexSource: result[0],
        fragmentSource: result[1]
      };
    }
  };
  const envLight = {
    initShaderBindings: () => {},
    getRadiance: (scope: any) => scope.$builder.vec3(0.25),
    getIrradiance: (scope: any) => scope.$builder.vec3(0.5)
  };
  return {
    device,
    camera: {
      ssgiResolvedSettings: {
        halfRes: false,
        raysPerPixel: 2,
        maxSteps: 64,
        denoisePasses: 3
      }
    },
    env: {
      light: {
        envLight
      }
    }
  } as any;
}

function buildSSGIHistoryRepairProgram(type: 'webgl' | 'webgl2' | 'webgpu') {
  const device: any = { type };
  const builder = new ProgramBuilder(device);
  const envLight = Object.create(EnvShIBL.prototype) as EnvShIBL;
  Object.defineProperty(envLight, 'irradianceSHFB', { value: null });
  const ctx = {
    device,
    SSGI: true,
    SSGIIrradianceHistoryTexture: {},
    SSGISurfaceHistoryTexture: {},
    motionVectorTexture: type === 'webgl' ? null : {},
    linearDepthTexture: {}
  } as any;
  const result = builder.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
      });
    },
    fragment(pb) {
      this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = pb.vec4[9]().uniformBuffer(0);
      this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW] = pb.vec3().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_IRRADIANCE] = pb.tex2D().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_SURFACE] = pb.tex2D().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_CURRENT_DEPTH] = pb.tex2D().uniform(0);
      if (type !== 'webgl') {
        this[EnvShIBL.UNIFORM_NAME_SSGI_MOTION] = pb.tex2D().uniform(0);
      }
      this[EnvShIBL.UNIFORM_NAME_SSGI_TARGET_SIZE] = pb.vec2().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_REPROJECTION] = pb.vec4().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_VIEW_TO_PREV_CLIP] = pb.mat4().uniform(0);
      this[EnvShIBL.UNIFORM_NAME_SSGI_INV_PROJECTION] = pb.mat4().uniform(0);
      const lightStruct = pb.defineStruct([pb.float('envLightStrength')]);
      this.light = lightStruct().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        const irradiance = envLight.getIrradiance(this as any, pb.vec3(0, 1, 0) as any, ctx) as any;
        this.$outputs.color = pb.vec4(irradiance, 1);
      });
    }
  });
  if (!result) {
    throw new Error(builder.lastError ?? 'SSGI history repair shader generation failed');
  }
  return result;
}

describe('SSGI shader generation', () => {
  test.each(['webgpu', 'webgl'] as const)('builds every %s shader variant', (type) => {
    const ctx = createShaderContext(type);
    const effect = new SSGI() as any;

    const traceProgram = effect.createTraceProgram(ctx, type === 'webgpu', false);
    expect(traceProgram).toBeTruthy();
    expect(traceProgram.fragmentSource).toContain('hitFinite');
    expect(traceProgram.fragmentSource).toContain('screenRadianceFinite');
    expect(traceProgram.fragmentSource).toContain('boundedIrradiance');
    // Visibility must stay separate from radiance validity, and the average must
    // run over resolved rays so indeterminate ones do not read as unoccluded sky.
    expect(traceProgram.fragmentSource).toContain('occluded');
    expect(traceProgram.fragmentSource).toContain('determinateCount');
    expect(traceProgram.fragmentSource).toContain('escapedSum');
    // Measured bounce light must survive independently of the sky removal, so an
    // occluding hit can never subtract the sky without adding its own radiance.
    expect(traceProgram.fragmentSource).toContain('bounceGain');
    expect(traceProgram.fragmentSource).toContain('skyLoss');
    const temporalProgram = effect.createTemporalProgram(ctx, false);
    expect(temporalProgram).toBeTruthy();
    expect(temporalProgram.fragmentSource).toContain('boundedLuminance');
    if (type === 'webgpu') {
      const historyTraceProgram = effect.createTraceProgram(ctx, true, true);
      expect(historyTraceProgram).toBeTruthy();
      // Failed reprojection must fall back to this frame's colour, not to IBL.
      expect(historyTraceProgram.fragmentSource).toContain('currentColorTex');
      expect(historyTraceProgram.fragmentSource).toContain('previousColorTex');
      expect(effect.createTemporalProgram(ctx, true)).toBeTruthy();
    }
    const atrousProgram = effect.createAtrousProgram(ctx);
    expect(atrousProgram).toBeTruthy();
    // Short-history pixels have to widen the kernel instead of preserving noise.
    expect(atrousProgram.fragmentSource).toContain('historyConfidence');
    expect(atrousProgram.fragmentSource).toContain('effStep');
    expect(effect.createSurfaceProgram(ctx)).toBeTruthy();
    expect(effect.createUpsampleProgram(ctx)).toBeTruthy();
    expect(effect.createCompositeProgram(ctx, false)).toBeTruthy();
    expect(effect.createCompositeProgram(ctx, true)).toBeTruthy();
  });

  test.each(['webgpu', 'webgl'] as const)('traces ambient occlusion alongside %s irradiance', (type) => {
    const ctx = createShaderContext(type);
    const effect = new SSGI() as any;

    // AO must be derived from the same visibility the sky removal uses, averaged
    // over the resolved rays so an indeterminate one cannot read as unoccluded.
    const traceProgram = effect.createTraceProgram(ctx, type === 'webgpu', false);
    expect(traceProgram.fragmentSource).toContain('occludedSum');
    expect(traceProgram.fragmentSource).toContain('determinateCount');

    // Every stage between the trace and the composite has to carry the channel,
    // otherwise the AO silently reverts to the unfiltered trace output.
    const temporalProgram = effect.createTemporalProgram(ctx, false);
    expect(temporalProgram.fragmentSource).toContain('currentAOTex');
    if (type === 'webgpu') {
      const temporalHistoryProgram = effect.createTemporalProgram(ctx, true);
      expect(temporalHistoryProgram.fragmentSource).toContain('previousAOTex');
      // AO accumulates on the irradiance's validity, and is neighborhood-clamped
      // against its own extents rather than the radiance ones.
      expect(temporalHistoryProgram.fragmentSource).toContain('aoNeighborhoodMin');
    }
    expect(effect.createAtrousProgram(ctx).fragmentSource).toContain('aoSourceTex');
    expect(effect.createUpsampleProgram(ctx).fragmentSource).toContain('aoSourceTex');

    // The composite is what replaces the standalone SAO pass.
    const compositeProgram = effect.createCompositeProgram(ctx, false);
    expect(compositeProgram.fragmentSource).toContain('finalAO');
  });

  // The a-trous edge-stopping weights ride an SVGF ramp: historyConfidence 0 is
  // the relaxed end (wide kernel, loose normal and luminance tests), 1 is the
  // sharp end. A path with no temporal resolve has moments.z pinned at 1 and can
  // never converge, so it has to sit at the relaxed end - it is the noisiest
  // input the filter ever receives. Sending it to the sharp end instead gives the
  // worst input the narrowest kernel and an eighth of the luminance tolerance,
  // which reads as heavy surviving Monte Carlo noise.
  test.each(['webgpu', 'webgl'] as const)('ramps %s denoising toward relaxed without history', (type) => {
    const ctx = createShaderContext(type);
    const effect = new SSGI() as any;
    const src: string = effect.createAtrousProgram(ctx).fragmentSource;
    // WGSL declares `let historyConfidence: f32 = ...` and GLSL
    // `float historyConfidence = ...`, so match on the guard instead of on `=`.
    // denoiseParams.x is what the JS side sets to 0 on the paths that never
    // accumulate history.
    const rampLine = src
      .split('\n')
      .find((line) => line.includes('historyConfidence') && line.includes('denoiseParams.x > 0.0'));
    expect(rampLine).toBeTruthy();
    if (type === 'webgpu') {
      // WGSL select() takes the false value first.
      expect(rampLine).toContain('select(0.0,');
    } else {
      expect(rampLine!.trimEnd().endsWith(': 0.0;')).toBe(true);
    }

    // The ramp itself must stay oriented relaxed -> sharp, otherwise a
    // confidence of 0 would no longer mean "widen and loosen".
    expect(src).toContain('mix(2.0,1.0,historyConfidence)');
    expect(src).toContain('mix(8.0,1.0,historyConfidence)');
  });

  test.each(['webgpu', 'webgl2', 'webgl'] as const)('builds %s lighting history repair', (type) => {
    expect(buildSSGIHistoryRepairProgram(type)).toBeTruthy();
  });

  // 'webgl' is WebGL1 and 'webgl2' is WebGL2 - only the former lacks motion
  // vectors and Hi-Z, so WebGL2 has to take the same temporal, multi-bounce path
  // as WebGPU rather than the degraded single-frame one.
  test('requests the temporal inputs on every backend except WebGL1', () => {
    const effect = new SSGI();
    const ctxOf = (type: string) => ({ SSGI: true, device: { type } }) as any;
    for (const type of ['webgpu', 'webgl2']) {
      expect(effect.requireMotionVectorTexture(ctxOf(type))).toBe(true);
      expect(effect.requireHiZTexture(ctxOf(type))).toBe(true);
    }
    expect(effect.requireMotionVectorTexture(ctxOf('webgl'))).toBe(false);
    expect(effect.requireHiZTexture(ctxOf('webgl'))).toBe(false);
  });

  // The lighting-pass reprojection assumes previousUV === uv when there are no
  // motion vectors, which is only correct for a static camera. WebGL1 has no
  // choice; every other backend must have the real motion vectors before the
  // history is consumed, otherwise a moving camera reads stale irradiance.
  test.each([
    ['webgpu', true],
    ['webgl2', true],
    ['webgl', false]
  ] as const)('requires motion vectors before consuming SSGI history on %s', (type, needsMotion) => {
    const ctx = (motionVectorTexture: unknown) =>
      ({
        device: { type },
        SSGI: true,
        SSGIIrradianceHistoryTexture: {},
        SSGISurfaceHistoryTexture: {},
        motionVectorTexture,
        linearDepthTexture: {}
      }) as any;
    expect(EnvShIBL.hasSSGIHistory(ctx({}))).toBe(true);
    expect(EnvShIBL.hasSSGIHistory(ctx(null))).toBe(!needsMotion);
  });
});
