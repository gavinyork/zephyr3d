import { Disposable, Vector4 } from '@zephyr3d/base';
import { ProgramBuilder } from '@zephyr3d/device';
import { createNullDevice } from '@zephyr3d/backend-null';
import type {
  AbstractDevice,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBRenderOptions,
  PBShaderExp
} from '@zephyr3d/device';
import { ShoreWaveGenerator } from '../../../libs/scene/src/render/shore_wave_generator';
import type { WaveGenerator } from '../../../libs/scene/src/render/wavegenerator';
import type { FoamFieldSource } from '../../../libs/scene/src/render/water_foam';
import { WaterMaterial } from '../../../libs/scene/src/material/water';
import type { DrawContext } from '../../../libs/scene/src/render/drawable';
import { EnvHemisphericAmbient } from '../../../libs/scene/src/render/envlight';
import { PCFOPT } from '../../../libs/scene/src/shadow/pcf_opt';
import {
  LIGHT_TYPE_DIRECTIONAL,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT
} from '../../../libs/scene/src/values';
import * as api from '../../../libs/scene/src/app/api';

class BaseWaves extends Disposable implements WaveGenerator {
  version = 0;
  clone() {
    return new BaseWaves() as this;
  }
  setupUniforms() {}
  applyWaterBindGroup() {}
  calcClipmapTileAABB() {}
  update() {}
  getHash() {
    return 'swash-test';
  }
  needUpdate() {
    return false;
  }
  isOk() {
    return true;
  }
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ) {
    scope.$builder.func(
      'basePosition',
      [scope.$builder.vec3('p'), scope.$builder.vec3('position').out(), scope.$builder.vec3('normal').out()],
      function () {
        this.position = this.p;
        this.normal = this.$builder.vec3(0, 1, 0);
      }
    );
    scope.basePosition(inPos, outPos, outNormal);
  }
  calcFragmentNormal(_scope: PBInsideFunctionScope, _xz: PBShaderExp, normal: PBShaderExp) {
    return normal;
  }
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    _xz: PBShaderExp,
    normal: PBShaderExp,
    foamSample?: PBShaderExp
  ) {
    if (foamSample) {
      scope.$builder.func('baseFoamSample', [scope.$builder.vec3('fs').inout()], function () {
        this.fs = this.$builder.mul(this.fs, 0.5);
      });
      scope.baseFoamSample(foamSample);
    }
    return scope.$builder.vec4(normal, 0.5);
  }
}

const baseSource: FoamFieldSource = {
  foamSourceKey: 'swash-test',
  setupFoamSourceUniforms(scope: PBGlobalScope) {
    scope.ffDrift = scope.$builder.vec2().uniform(0);
  },
  applyFoamSourceBindGroup() {},
  calcFoamStep(scope, _xz, dt, _fadeRate, _prewarm, state) {
    const pb = scope.$builder;
    pb.func('baseFoamStep', [pb.float('dt'), pb.vec4('state').inout()], function () {
      this.state.x = pb.add(this.state.x, this.dt);
      this.$return(pb.vec4(this.ffDrift, this.dt, 0));
    });
    return scope.baseFoamStep(dt, state) as PBShaderExp;
  }
};

function createWaves() {
  return new ShoreWaveGenerator(
    new BaseWaves(),
    { height: 0.5, wavelength: 32, period: 4, zone: 40, sharpness: 0.8, lean: 0.5 },
    baseSource
  );
}

function build(type: 'webgl2' | 'webgpu', options: PBRenderOptions) {
  const device = {
    type,
    getDeviceCaps: () => ({
      shaderCaps: { supportShaderTextureLod: true },
      textureCaps: { supportHalfFloatColorBuffer: true }
    })
  } as unknown as AbstractDevice;
  const builder = new ProgramBuilder(device);
  const result = builder.buildRender(options);
  if (!result) {
    throw new Error(builder.lastError ?? 'Swash shader generation failed');
  }
  return { vertex: result[0], fragment: result[1] };
}

/** Exercise the real shader builder: swEvaluate's out arguments are shared by
 * mesh displacement, current/previous clocks, material coverage, and foam steps.
 * Generating both backends catches missing arguments and invalid out/inout
 * forwarding without duplicating the analytic swash formula in the test.
 */
describe.each(['webgl2', 'webgpu'] as const)('Swash shaders on %s', (type) => {
  test.each([false, true])('surface with foam texture sample: %s', (withFoamSample) => {
    const waves = createWaves();
    const source = build(type, {
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$outputs.xz = pb.vec2();
        this.$outputs.vn = pb.vec3();
        waves.setupUniforms(this, 0);
        pb.main(function () {
          this.$l.position = pb.vec3(0);
          this.$l.normal = pb.vec3(0);
          this.$l.previous = pb.vec3(0);
          waves.calcVertexPositionAndNormal(
            this,
            this.$inputs.pos,
            this.position,
            this.normal,
            pb.float(0.5)
          );
          waves.calcPrevVertexPosition(this, this.$inputs.pos, this.previous, pb.float(0.5));
          this.$builtins.position = pb.vec4(pb.add(this.position, this.previous), 1);
          this.$outputs.xz = this.$inputs.pos.xz;
          this.$outputs.vn = this.normal;
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        waves.setupUniforms(this, 0);
        pb.main(function () {
          this.$l.coverage = waves.calcSurfaceCoverage(this, this.$inputs.xz);
          this.$l.thickness = waves.calcSheetThickness(this, this.$inputs.xz);
          this.$l.groundMask = waves.calcFoamGroundMask(
            this,
            pb.vec3(this.$inputs.xz.x, 0, this.$inputs.xz.y)
          );
          this.$l.normal = waves.calcFragmentNormal(this, this.$inputs.xz, this.$inputs.vn);
          this.$l.foamSample = pb.vec3(1);
          this.$l.nf = waves.calcFragmentNormalAndFoam(
            this,
            this.$inputs.xz,
            this.normal,
            withFoamSample ? this.foamSample : undefined
          );
          this.$outputs.color = pb.add(
            this.nf,
            pb.vec4(this.foamSample, pb.add(this.coverage, this.thickness, this.groundMask))
          );
        });
      }
    });
    expect(source.vertex).toContain('swCalcPrevPosition');
    expect(source.fragment).toContain('swSurfaceCoverage');
    expect(source.fragment).toContain('swSheetThickness');
    expect(source.fragment).toMatch(
      type === 'webgpu'
        ? /fn swFoamGroundMask\(position\s*:\s*vec3<f32>[^\n]*->\s*f32/
        : /float swFoamGroundMask\(vec3 position\)/
    );
    expect(source.fragment).toContain(withFoamSample ? 'swCalcNormalAndFoamS' : 'swCalcNormalAndFoam');
    if (withFoamSample) {
      expect(source.fragment).toContain('baseFoamSample');
    }
    for (const stage of [source.vertex, source.fragment]) {
      const signature = stage.match(/swEvaluate\([^\n]+/)?.[0];
      expect(signature).toMatch(
        type === 'webgpu' ? /coverage\s*:\s*ptr<function\s*,\s*f32\s*>/ : /out float coverage/
      );
      expect(stage).toMatch(
        type === 'webgpu' ? /swEvaluate\([^\n]*,&coverage,/ : /swEvaluate\([^\n]*,coverage,/
      );
    }
  });

  test.each([false, true])('foam step forwards source state with deposition contact: %s', (withContact) => {
    const waves = createWaves();
    expect(waves.supportsFoamDeposition).toBe(true);
    const source = build(type, {
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        waves.setupFoamSourceUniforms(this);
        pb.main(function () {
          this.$l.state = pb.vec4(0, 0, 0, 1 / 30);
          this.$l.contact = pb.vec2(0);
          this.$l.step = waves.calcFoamStep(
            this,
            this.$builtins.fragCoord.xy,
            pb.float(1 / 30),
            pb.float(0.8),
            pb.bool(false),
            this.state,
            withContact ? this.contact : undefined
          );
          // Both signatures must coexist in a shader: a cached function for
          // the legacy call must not swallow the deposition out parameter.
          this.$l.legacyStep = withContact
            ? waves.calcFoamStep(
                this,
                this.$builtins.fragCoord.xy,
                pb.float(1 / 30),
                pb.float(0.8),
                pb.bool(false),
                this.state
              )
            : pb.vec4(0);
          this.$outputs.color = pb.add(
            this.step,
            this.legacyStep,
            this.state,
            pb.vec4(this.contact, this.contact)
          );
        });
      }
    });
    expect(source.fragment).toContain('baseFoamStep');
    const functionName = withContact ? 'swFoamDepositStep' : 'swFoamStep';
    const signature = source.fragment.match(new RegExp(`${functionName}\\([^\\n]+`))?.[0];
    expect(signature).toMatch(
      type === 'webgpu' ? /state\s*:\s*ptr<function\s*,\s*vec4<f32>\s*>/ : /inout vec4 state/
    );
    expect(source.fragment).toMatch(/baseFoamStep\(dt,state[,)]/);
    if (withContact) {
      expect(signature).toMatch(
        type === 'webgpu' ? /contact\s*:\s*ptr<function\s*,\s*vec2<f32>\s*>/ : /out vec2 contact/
      );
      expect(source.fragment).toMatch(
        type === 'webgpu' ? /swFoamDepositStep\([^\n]*,&contact,/ : /swFoamDepositStep\([^\n]*,contact\)/
      );
      const legacySignature = source.fragment.match(/swFoamStep\([^\n]+/)?.[0];
      expect(legacySignature).toBeDefined();
      expect(legacySignature).not.toContain('contact');
    } else {
      expect(signature).not.toContain('contact');
    }
  });
});

class TestWaterMaterial extends WaterMaterial {
  build(ctx: DrawContext) {
    const builder = new ProgramBuilder(ctx.device);
    const program = this._createProgram(builder, ctx, 0);
    if (!program) {
      throw new Error(builder.lastError ?? 'Water material shader generation failed');
    }
    return program;
  }
}

describe.each(['webgl2', 'webgpu'] as const)('Shore region debug material on %s', (type) => {
  test.each([
    ['color', false],
    ['color', true],
    ['depth', false],
    ['depth', true]
  ] as const)('%s pass shows the raw carrier with shore waves enabled: %s', async (pass, withShore) => {
    const device = await createNullDevice({ type });
    const deviceSpy = jest.spyOn(api, 'getDevice').mockReturnValue(device);
    try {
      const material = new TestWaterMaterial();
      material.infinite = true;
      material.waveGenerator = new BaseWaves();
      material.shoreWaveHeight = withShore ? 0.5 : 0;
      material.debugOutput = 'shoreRegions';
      const isColor = pass === 'color';
      const context = {
        device,
        materialFlags: 0,
        renderPass: {
          type: isColor ? RENDER_PASS_TYPE_LIGHT : RENDER_PASS_TYPE_DEPTH,
          motionVectorOnly: false,
          encodeDepth: false,
          renderBackface: false
        },
        motionVectors: !isColor,
        drawEnvLight: false,
        scene: { lightingMode: 'physical' },
        linearDepthTexture: isColor ? {} : undefined,
        sceneColorTexture: isColor ? {} : undefined
      } as unknown as DrawContext;
      const program = material.build(context);
      const vertex = program.getShaderSource('vertex')!;
      const fragment = program.getShaderSource('fragment')!;

      // Geometry classification must reveal the actual displaced carrier.
      // Wet coverage and projected-foam shading would hide its intersections
      // with the beach and make this diagnostic unable to locate a mesh seam.
      expect(fragment).not.toContain('swSurfaceCoverage');
      expect(fragment).not.toContain('discard');
      expect(fragment).not.toContain('zSamplePositionFromDepth');
      expect(fragment).not.toContain('swFoamGroundMask');
      expect(fragment).not.toContain('ffSample');
      expect(fragment).not.toMatch(/(?:texture\w*)\(\s*foamTex\b/);
      expect(fragment).not.toMatch(/(?:gl_FragDepth|zFragDepth)\s*=/);
      expect(fragment).not.toContain('@builtin(frag_depth)');
      if (withShore) {
        expect(vertex).toContain('swDisplace');
      } else {
        expect(vertex).not.toContain('swDisplace');
      }
      if (isColor && withShore) {
        expect(fragment).toContain('swDebugRegion');
      } else {
        expect(fragment).not.toContain('swDebugRegion');
      }
      if (!isColor) {
        expect(fragment).toContain('zMotionVector');
      }
    } finally {
      deviceSpy.mockRestore();
    }
  });
});

describe.each(['webgl2', 'webgpu'] as const)('Swash handover diagnostics on %s', (type) => {
  test.each([
    ['swashHandover', false],
    ['swashHandover', true],
    ['swashFoamSources', false],
    ['swashFoamSources', true],
    ['swashFoamCuts', false],
    ['swashFoamCuts', true]
  ] as const)('%s preserves production visibility with shore waves enabled: %s', async (mode, withShore) => {
    const device = await createNullDevice({ type });
    const deviceSpy = jest.spyOn(api, 'getDevice').mockReturnValue(device);
    try {
      const material = new TestWaterMaterial();
      material.infinite = true;
      material.refractionMode = 'offset';
      material.waveGenerator = new BaseWaves();
      material.shoreWaveHeight = withShore ? 0.5 : 0;
      material.debugOutput = mode;
      const context = {
        device,
        materialFlags: 0,
        renderPass: { type: RENDER_PASS_TYPE_LIGHT },
        drawEnvLight: false,
        scene: { lightingMode: 'physical' },
        linearDepthTexture: {},
        sceneColorTexture: {}
      } as unknown as DrawContext;
      const fragment = material.build(context).getShaderSource('fragment')!;

      // Unlike the geometry diagnostic, these channels must expose the same
      // wet-edge and projected-depth decisions as the normal foam rendering.
      expect(fragment).toContain('zSamplePositionFromDepth');
      expect(fragment).not.toContain('swDebugRegion');
      expect(fragment).not.toMatch(/\b(?:undefined|NaN)\b/);
      expect(fragment).toMatch(/texture\w*\(\s*foamTex\b/);
      if (withShore) {
        expect(fragment).toContain('swSurfaceCoverage');
        expect(fragment).toContain('discard');
        expect(fragment).toContain('swFoamGroundMask');
        expect(fragment).toContain('ffSampleDeposited');
        expect(fragment).toMatch(/(?:gl_FragDepth|zFragDepth) = mix\([^\n]*groundFoamWeight/);
      } else {
        expect(fragment).not.toContain('swSurfaceCoverage');
        expect(fragment).not.toContain('swFoamGroundMask');
        expect(fragment).not.toMatch(/(?:gl_FragDepth|zFragDepth)\s*=/);
      }
      if (mode === 'swashHandover') {
        expect(fragment).toMatch(
          /outColor[^=\n]*=\s*vec4(?:<f32>)?\(surfaceCoverage,groundWetCoverage,groundFoamWeight,1(?:\.0)?\)/
        );
        expect(fragment).toMatch(/groundWetCoverage[^;\n]*=\s*0(?:\.0)?;/);
        if (withShore) {
          expect(fragment).toMatch(/groundWetCoverage\s*=\s*groundWet;/);
        }
      } else if (mode === 'swashFoamSources') {
        expect(fragment).toMatch(
          /outColor[^=\n]*=\s*vec4(?:<f32>)?\(normal.w,groundMobileDensity,groundDepositedDensity,1(?:\.0)?\)/
        );
        expect(fragment).toMatch(/groundMobileDensity[^;\n]*=\s*0(?:\.0)?;/);
        expect(fragment).toMatch(/groundDepositedDensity[^;\n]*=\s*0(?:\.0)?;/);
        if (withShore) {
          expect(fragment).toMatch(/groundMobileDensity\s*=\s*[^;\n]*groundMobile.x[^;\n]*groundWet/);
          expect(fragment).toMatch(/groundDepositedDensity\s*=\s*deposited.x;/);
        }
      } else {
        expect(fragment).toMatch(/return vec3(?:<f32>)?\(foam,groundFoamOpacity,groundFoamWeight\)/);
        expect(fragment).toContain('waterWhiteFoam');
        expect(fragment).toMatch(/groundFoamOpacity[^;\n]*=\s*0(?:\.0)?;/);
        if (withShore) {
          expect(fragment).toMatch(/groundFoamOpacity\s*=\s*groundFoamWhite.x;/);
        }
      }
    } finally {
      deviceSpy.mockRestore();
    }
  });
});

describe.each(['webgl2', 'webgpu'] as const)(
  'Swash visibility and ground support diagnostics on %s',
  (type) => {
    test.each([
      ['foamField', false],
      ['foamField', true],
      ['swashVisibility', false],
      ['swashVisibility', true],
      ['swashGroundSupport', false],
      ['swashGroundSupport', true]
    ] as const)('%s reveals clipped beach pixels with shore waves enabled: %s', async (mode, withShore) => {
      const device = await createNullDevice({ type });
      const deviceSpy = jest.spyOn(api, 'getDevice').mockReturnValue(device);
      try {
        const material = new TestWaterMaterial();
        material.infinite = true;
        material.waveGenerator = new BaseWaves();
        material.shoreWaveHeight = withShore ? 0.5 : 0;
        material.debugOutput = mode;
        const context = {
          device,
          materialFlags: 0,
          renderPass: { type: RENDER_PASS_TYPE_LIGHT },
          drawEnvLight: false,
          scene: { lightingMode: 'physical' },
          linearDepthTexture: {},
          sceneColorTexture: {}
        } as unknown as DrawContext;
        const fragment = material.build(context).getShaderSource('fragment')!;
        expect(fragment).not.toContain('discard');
        expect(fragment).not.toMatch(/\b(?:undefined|NaN)\b/);
        expect(fragment).toContain('zSamplePositionFromDepth');
        if (mode === 'foamField') {
          expect(fragment).toMatch(/ffDebug[^;\n]*ffSample/);
          expect(fragment).toMatch(/outColor[^=\n]*=\s*vec4(?:<f32>)?\([^;\n]*ffDebug/);
        } else if (mode === 'swashVisibility') {
          expect(fragment).toMatch(
            /swashDiscard[^;\n]*surfaceCoverage[^;\n]*groundFoamDensity[^;\n]*groundFoamWeight/
          );
          expect(fragment).toMatch(
            /outColor[^=\n]*=\s*vec4(?:<f32>)?\([^;\n]*swashDiscard[^;\n]*visibilityDepthFail,groundFoamDensity,1(?:\.0)?\)/
          );
          expect(fragment).toMatch(/visibilityDepthFail[^;\n]*=\s*0(?:\.0)?;/);
        } else if (mode === 'swashGroundSupport') {
          expect(fragment).toMatch(
            /outColor[^=\n]*=\s*vec4(?:<f32>)?\((?:groundMask|0(?:\.0)?),groundFieldCoverage,groundWetCoverage,1(?:\.0)?\)/
          );
          expect(fragment).toMatch(/groundFieldCoverage[^;\n]*=\s*0(?:\.0)?;/);
          expect(fragment).toMatch(/groundWetCoverage[^;\n]*=\s*0(?:\.0)?;/);
          expect(fragment).not.toContain('visibilityDepthFail');
        }
        if (withShore) {
          expect(fragment).toContain('swSurfaceCoverage');
          if (mode === 'swashVisibility') {
            expect(fragment).toMatch(/visibilityDepthFail\s*=\s*[^;\n]*scenePos.w/);
          } else if (mode === 'swashGroundSupport') {
            expect(fragment).toMatch(/groundFieldCoverage\s*=\s*groundMobile.y;/);
            expect(fragment).toMatch(/groundWetCoverage\s*=\s*groundWet;/);
          }
          const depthAssignments = fragment.match(/(?:gl_FragDepth|zFragDepth)\s*=[^;\n]*;/g)!;
          expect(depthAssignments).toHaveLength(2);
          expect(depthAssignments[0]).toContain('groundFoamWeight');
          expect(depthAssignments[1]).toContain('scenePos.w');
          expect(depthAssignments[1]).not.toContain('mix(');
          // The diagnostic may move the carrier in front of the beach only
          // when the reconstructed point is valid beach ground, never the sky.
          expect(fragment).toMatch(
            /if\s*\([^\n]*scenePos.w[^\n]*groundMask[^\n]*\)\s*\{\s*(?:zFSOutputCpy\.)?(?:gl_FragDepth|zFragDepth)\s*=/
          );
        } else {
          expect(fragment).not.toContain('swFoamGroundMask');
          expect(fragment).not.toMatch(/(?:gl_FragDepth|zFragDepth)\s*=/);
        }
      } finally {
        deviceSpy.mockRestore();
      }
    });
  }
);

/** Run the opacity expression emitted by the real foam helper, avoiding a
 * second implementation of its nonlinear texture threshold in the regression.
 */
function foamOpacityFromShader(shader: string) {
  const definition = shader.match(/vec3 waterWhiteFoam\([^)]*\)\s*\{([^}]+)\}/);
  if (!definition) {
    throw new Error('No generated white foam function');
  }
  const body = definition[1];
  const returnStart = body.indexOf('return vec3(');
  if (returnStart < 0) {
    throw new Error('No generated white foam return');
  }
  const expressionStart = returnStart + 'return vec3('.length;
  let depth = 0;
  let expressionEnd = expressionStart;
  for (; expressionEnd < body.length; expressionEnd++) {
    const char = body[expressionEnd];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === ',' && depth === 0) {
      break;
    }
  }
  const prefix = body.slice(0, returnStart).replace(/\bfloat\s+/g, 'const ');
  const opacity = body.slice(expressionStart, expressionEnd);
  return new Function('clamp', `return function(density, tex, feather) { ${prefix} return ${opacity}; };`)(
    (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
  ) as (density: number, tex: { x: number }, feather: number) => number;
}

function groundDensityFromShader(shader: string) {
  const expression = shader.match(/groundFoamDensity\s*=\s*([^;\n]*groundMobile[^;\n]*);/)?.[1];
  if (!expression) {
    throw new Error('No generated ground foam density expression');
  }
  // The near-shore floor is outside these cases: it passes the density on.
  return new Function(
    'clamp',
    'max',
    'swNearShoreFoam',
    'scenePos',
    `return function(groundMobile, groundWet, deposited) { return ${expression}; };`
  )(
    (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
    Math.max,
    (_xz: unknown, density: number) => density,
    { xz: 0 }
  ) as (groundMobile: { x: number }, groundWet: number, deposited: { x: number }) => number;
}

/** Run the final scalar mask emitted for a valid point inside the grid.
 * Texture sampling is supplied by the test; bed matching, slope support and
 * shoreline behaviour all come from the actual generated GLSL expression.
 */
function groundMaskFromShader(shader: string) {
  const start = shader.indexOf('float swFoamGroundMask(vec3 position)');
  if (start < 0) {
    throw new Error('No generated ground support mask');
  }
  const bodyStart = shader.indexOf('{', start);
  let depth = 1;
  let bodyEnd = bodyStart + 1;
  for (; bodyEnd < shader.length && depth > 0; bodyEnd++) {
    if (shader[bodyEnd] === '{') {
      depth++;
    } else if (shader[bodyEnd] === '}') {
      depth--;
    }
  }
  const body = shader.slice(bodyStart + 1, bodyEnd - 1).replace(/\b\w+\.(swGrid|swWave)\b/g, '$1');
  const bed = body.match(/float bed\s*=\s*([^;\n]+);/)?.[1];
  const reach = body.match(/float reach\s*=\s*([^;\n]+);/)?.[1];
  const result = [...body.matchAll(/return\s+([^;\n]+);/g)].pop()?.[1];
  if (!bed || !reach || !result) {
    throw new Error('No generated ground support mask expressions');
  }
  return new Function(
    'clamp',
    'abs',
    'smoothstep',
    `return function(wl, position, swWave, swGrid, edge) {
      const bed = ${bed};
      const reach = ${reach};
      return ${result};
    };`
  )(
    (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
    Math.abs,
    (lo: number, hi: number, value: number) => {
      const t = Math.min(Math.max((value - lo) / (hi - lo), 0), 1);
      return t * t * (3 - 2 * t);
    }
  ) as (
    waterline: { x: number; y: number; z: number },
    position: { y: number },
    wave: { x: number },
    grid: { w: number },
    edge: number
  ) => number;
}

/** Execute the generated handover and clipping decisions at one carrier
 * sample P and the different beach sample Q behind it. The generated
 * expressions supply the coordinate choice and thresholds under test.
 */
function groundVisibilityFromShader(shader: string) {
  const thickness = shader.match(/groundHandoverThickness[^=\n]*=\s*([^;\n]+);/)?.[1];
  const weight = shader.match(/groundFoamWeight\s*=\s*([^;\n]*groundHandoverThickness[^;\n]*);/)?.[1];
  const discard = shader.match(/swashDiscard[^=\n]*=\s*([^;\n]+);/)?.[1];
  if (!thickness || !weight || !discard) {
    throw new Error('No generated carrier-coherent handover and discard expressions');
  }
  return new Function(
    'smoothstep',
    `return function(sheetThickness, groundThickness, surfaceCoverage, groundFoamDensity, groundMask, groundMobile) {
      const groundHandoverThickness = ${thickness};
      const groundFoamWeight = ${weight};
      const swashDiscard = ${discard};
      return { weight: groundFoamWeight, discard: swashDiscard };
    };`
  )((lo: number, hi: number, value: number) => {
    const t = Math.min(Math.max((value - lo) / (hi - lo), 0), 1);
    return t * t * (3 - 2 * t);
  }) as (
    carrierThickness: number,
    groundThickness: number,
    carrierCoverage: number,
    groundDensity: number,
    groundMask: number,
    groundField: { y: number }
  ) => { weight: number; discard: boolean };
}

/** Evaluate one colour channel of the emitted ground composite and handover.
 * Vector RGB arithmetic is componentwise here, so scalar inputs expose any
 * unwanted contribution from the sand without a software shader runtime.
 */
function groundBlendFromShader(shader: string) {
  const opacity = shader.match(/groundFoamOpacity\s*=\s*([^;\n]*groundFoamWhite[^;\n]*);/)?.[1];
  const bridge = shader.match(
    /groundFoamOpacity\s*=\s*([^;\n]*groundFoamOpacity[^;\n]*foamFade[^;\n]*);/
  )?.[1];
  const groundColor = shader.match(/vec3 groundColor\s*=\s*([^;\n]+);/)?.[1];
  const blend = shader.match(/finalColor\s*=\s*([^;\n]*groundColor[^;\n]*);/)?.[1];
  if (!opacity || !bridge || !groundColor || !blend) {
    throw new Error('No generated ground foam colour handover');
  }
  return new Function(
    'mix',
    'max',
    `return function(finalColor, groundBehind, groundFoamWhite, groundFoamRadiance, groundFoamWeight, foam, foamFade) {
      let groundFoamOpacity = ${opacity};
      groundFoamOpacity = ${bridge};
      const groundColor = ${groundColor};
      return { color: ${blend}, opacity: groundFoamOpacity };
    };`
  )((a: number, b: number, weight: number) => a * (1 - weight) + b * weight, Math.max) as (
    mobileColor: number,
    sandColor: number,
    groundWhite: { x: number },
    groundRadiance: number,
    weight: number,
    carrierFoam: number,
    carrierFade: number
  ) => { color: number; opacity: number };
}

describe.each(['webgl2', 'webgpu'] as const)('Deposited foam material on %s', (type) => {
  test.each(['color', 'depth', 'lit color'] as const)(
    '%s pass preserves separate wet and ground rendering',
    async (pass) => {
      const device = await createNullDevice({ type });
      const deviceSpy = jest.spyOn(api, 'getDevice').mockReturnValue(device);
      try {
        const material = new TestWaterMaterial();
        material.refractionMode = 'offset';
        material.waveGenerator = new BaseWaves();
        material.shoreWaveHeight = 0.5;
        const isColor = pass !== 'depth';
        const withLighting = pass === 'lit color';
        const shadowLight = {};
        const context = {
          device,
          materialFlags: 0,
          renderPass: {
            type: isColor ? RENDER_PASS_TYPE_LIGHT : RENDER_PASS_TYPE_DEPTH,
            motionVectorOnly: false,
            encodeDepth: false,
            renderBackface: false
          },
          motionVectors: pass === 'depth',
          drawEnvLight: withLighting,
          env: withLighting
            ? {
                light: {
                  envLight: new EnvHemisphericAmbient(new Vector4(1, 1, 1, 1), new Vector4(0.2, 0.2, 0.2, 1))
                }
              }
            : undefined,
          currentShadowLight: withLighting ? shadowLight : undefined,
          shadowMapInfo: withLighting
            ? new Map([
                [
                  shadowLight,
                  {
                    lightType: LIGHT_TYPE_DIRECTIONAL,
                    numShadowCascades: 1,
                    shadowMap: device.createTexture2D('d32f', 4, 4),
                    impl: new PCFOPT(3)
                  }
                ]
              ])
            : undefined,
          scene: { lightingMode: 'physical' },
          linearDepthTexture: isColor ? {} : undefined,
          sceneColorTexture: isColor ? {} : undefined
        } as unknown as DrawContext;
        const program = material.build(context);
        const fragment = program.getShaderSource('fragment')!;
        expect(fragment).toContain('swSurfaceCoverage');
        expect(fragment).toContain('discard');
        if (isColor) {
          expect(fragment).toContain('swFoamGroundMask');
          expect(fragment).toContain('ffSampleDeposited');
          expect(fragment).toContain('zSamplePositionFromDepth');
          expect(fragment).toContain(type === 'webgpu' ? '@builtin(frag_depth)' : 'gl_FragDepth');
          // Both conserved foam shares and the handover mask must refer to
          // the same ground point, even when the raised carrier projects far
          // from it at a grazing view angle.
          expect(fragment).toMatch(/groundMobile[^\n]*ffSample\(scenePos.xz[,)]/);
          expect(fragment).toMatch(/deposited[^\n]*ffSampleDeposited\(scenePos.xz[,)]/);
          expect(fragment).toMatch(/groundWet[^\n]*swSurfaceCoverage\(scenePos.xz[,)]/);
          expect(fragment).toMatch(/groundThickness[^\n]*swSheetThickness\(scenePos.xz[,)]/);
          const handoverThickness = fragment.match(/groundHandoverThickness[^=\n]*=\s*([^;\n]+);/)?.[1];
          expect(handoverThickness).toContain('sheetThickness');
          expect(handoverThickness).toContain('groundThickness');
          expect(handoverThickness).toMatch(/sheetThickness\s*>=\s*0(?:\.0)?/);
          expect(fragment).toMatch(/groundFoamWeight =[^;\n]*groundHandoverThickness/);
          expect(fragment).toMatch(
            /groundFoamWhite[^\n]*waterWhiteFoam\([^\n]*groundFoamDensity[^\n]*groundFoamSample/
          );
          expect(fragment).toMatch(/groundFoamOpacity = groundFoamWhite.x;/);
          expect(fragment).not.toMatch(/crestWhite =[^\n]*groundFoamWeight/);
          expect(fragment).toMatch(/finalColor = mix\(finalColor,groundColor,groundFoamWeight\);/);
          expect(fragment).toMatch(/(?:gl_FragDepth|zFragDepth) = mix\([^\n]*groundFoamWeight/);
          if (withLighting) {
            expect(fragment).toMatch(/Z_calculateShadow\(wPos.xyz,groundNormal,groundNoL[,)]/);
            expect(fragment).toMatch(/groundFoamRadiance[^\n]*groundShadow/);
            expect(fragment).toMatch(/groundFoamRadiance[^\n]*zHemisphericAmbient[^\n]*groundNormal.y/);
          }
        } else {
          expect(fragment).not.toContain('ffSampleDeposited');
          expect(fragment).not.toContain('zSamplePositionFromDepth');
          expect(fragment).toContain('zMotionVector');
        }
      } finally {
        deviceSpy.mockRestore();
      }
    }
  );
});

async function buildGroundFoamFragment() {
  const device = await createNullDevice({ type: 'webgl2' });
  const deviceSpy = jest.spyOn(api, 'getDevice').mockReturnValue(device);
  try {
    const material = new TestWaterMaterial();
    material.refractionMode = 'offset';
    material.waveGenerator = new BaseWaves();
    material.shoreWaveHeight = 0.5;
    const context = {
      device,
      materialFlags: 0,
      renderPass: { type: RENDER_PASS_TYPE_LIGHT },
      drawEnvLight: false,
      scene: { lightingMode: 'physical' },
      linearDepthTexture: {},
      sceneColorTexture: {}
    } as unknown as DrawContext;
    return material.build(context).getShaderSource('fragment')!;
  } finally {
    deviceSpy.mockRestore();
  }
}

test('the ground shows its foam imprint without stacking it on the water foam', async () => {
  const fragment = await buildGroundFoamFragment();
  const density = groundDensityFromShader(fragment);
  const opacity = foamOpacityFromShader(fragment);
  const texture = { x: 0.5 };
  const reveal = (mobile: number, deposited: number, wet = 1) =>
    opacity(density({ x: mobile }, wet, { x: deposited }), texture, 0.1);

  // The deposit is an imprint of the drifting foam (it does not drain it), so
  // an imprint up to the water's own density changes nothing while wet.
  for (const imprint of [0, 0.35, 0.7]) {
    expect(density({ x: 0.7 }, 1, { x: imprint })).toBe(0.7);
  }
  expect(reveal(0.35, 0.35)).toBe(reveal(0.35, 0));
  // A dry carrier cannot reveal mobile foam; the imprint remains visible.
  expect(reveal(0.7, 0, 0)).toBe(0);
  expect(reveal(0.7, 0.7, 0)).toBe(reveal(0.7, 0));
});

test('two complete white covers never expose sand during their colour handover', async () => {
  const blend = groundBlendFromShader(await buildGroundFoamFragment());
  for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
    expect(blend(1, 0.2, { x: 1 }, 1, weight, 0, 0).color).toBe(1);
  }
});

test('visible carrier foam fills a zero-opacity beach handover', async () => {
  const blend = groundBlendFromShader(await buildGroundFoamFragment());
  const handover = blend(1, 0.2, { x: 0 }, 1, 1, 1, 1);
  expect(handover.opacity).toBe(1);
  expect(handover.color).toBe(1);
});

test('zero carrier fade preserves deposited foam opacity', async () => {
  const blend = groundBlendFromShader(await buildGroundFoamFragment());
  const withoutCarrier = blend(0.1, 0.2, { x: 0.65 }, 0.65, 1, 0, 0);
  const withCarrier = blend(0.1, 0.2, { x: 0.65 }, 0.65, 1, 0.8, 0);
  expect(withCarrier.opacity).toBe(0.65);
  expect(withCarrier.color).toBe(withoutCarrier.color);
});

test('carrier opacity follows partial foam fade smoothly', async () => {
  const blend = groundBlendFromShader(await buildGroundFoamFragment());
  for (const fade of [0, 0.25, 0.5, 0.75, 1]) {
    const handover = blend(0.1, 0.2, { x: 0 }, 0.6 * fade, 1, 0.6, fade);
    expect(handover.opacity).toBeCloseTo(0.6 * fade);
    expect(handover.color).toBeCloseTo(0.2 * (1 - 0.6 * fade) + 0.6 * fade);
  }
});

test('ground handover uses the same carrier thickness as the wet-edge discard', async () => {
  const visibility = groundVisibilityFromShader(await buildGroundFoamFragment());
  const sample = (carrier: number, ground: number, coverage = 0, density = 0.7) =>
    visibility(carrier, ground, coverage, density, 1, { y: 1 });

  // At a grazing angle P can already be dry while Q is still deep water.
  // Using Q's thickness here removed the ground replacement and discarded
  // the entire pixel despite nonzero foam density at the projected ground.
  expect(sample(0, 0.1)).toEqual({ weight: 1, discard: false });
  expect(sample(0, 0.1, 0, 0)).toEqual({ weight: 1, discard: true });
  expect(sample(0.1, 0, 1)).toEqual({ weight: 0, discard: false });

  // Unsupported carrier samples retain the reconstructed-ground fallback.
  expect(sample(-1, 0)).toEqual({ weight: 1, discard: false });
  expect(sample(-1, 0.1)).toEqual({ weight: 0, discard: true });
  // Outside the shore-wave zone both thicknesses are unknown. A valid bed
  // must not replace the ordinary water, including where there is no foam.
  expect(sample(-1, -1, 1)).toEqual({ weight: 0, discard: false });
  expect(sample(-1, -1, 1, 0)).toEqual({ weight: 0, discard: false });
  for (const ground of [0, 0.035, 0.1]) {
    expect(sample(0.01, ground).weight).toBeCloseTo(1);
    expect(sample(0.035, ground).weight).toBeCloseTo(0.5);
    expect(sample(0.06, ground).weight).toBeCloseTo(0);
  }
});

test('valid beach support remains continuous across the static shoreline', async () => {
  const mask = groundMaskFromShader(await buildGroundFoamFragment());
  const support = (distance: number, offset = 0, slope = 8, edge = 0.5) => {
    const bed = -distance / slope;
    return mask({ x: distance, y: slope, z: bed }, { y: bed + offset }, { x: 0.5 }, { w: 0 }, edge);
  };

  // Foam's carrier and its reconstructed beach point lie on different XZs.
  // Crossing the rest-level shoreline must not erase a valid beach bed.
  for (const distance of [-0.01, 0, 0.01]) {
    expect(support(distance)).toBeCloseTo(1);
  }
  expect(support(-0.01)).toBeCloseTo(support(0.01));
  expect(support(0, 0.3)).toBe(0);
  expect(support(0, 0, 1)).toBe(0);
  expect(support(0, 0, 8, 0)).toBe(0);
  expect(support(-20)).toBe(0);
});
