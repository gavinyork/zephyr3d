// copy from: https://github.com/codeagent/webgl-ocean/

import type {
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  TextureFormat
} from '@zephyr3d/device';
import type { WaveGenerator } from '../render/wavegenerator';
import { getDevice } from '../app/api';

function getFragCoord(scope: PBGlobalScope, useComputeShader: boolean) {
  return useComputeShader ? scope.$builtins.globalInvocationId.xy : scope.$builtins.fragCoord.xy;
}

/** @internal */
export type WaterVertexFunc = (
  this: WaterShaderImpl,
  scope: PBInsideFunctionScope,
  pos: PBShaderExp,
  xz: PBShaderExp,
  waveGenerator: WaveGenerator
) => void;

/** @internal */
export type WaterShadingFunc = (
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  worldNormal: PBShaderExp,
  foamFactor: PBShaderExp,
  discardable: PBShaderExp,
  waveGenerator: WaveGenerator
) => PBShaderExp;

/** @internal */
export type WaterSetupUniformFunc = (this: WaterShaderImpl, scope: PBGlobalScope) => void;

/** @internal */
export class WaterShaderImpl {
  private readonly _vertexFunc: WaterVertexFunc;
  private readonly _shadingFunc: WaterShadingFunc;
  private readonly _setupUniformsFunc: WaterSetupUniformFunc;
  constructor(
    setupUniformsFunc: WaterSetupUniformFunc,
    vertexFunc: WaterVertexFunc,
    shadingFunc: WaterShadingFunc
  ) {
    this._vertexFunc = vertexFunc;
    this._shadingFunc = shadingFunc;
    this._setupUniformsFunc = setupUniformsFunc;
  }
  setupUniforms(scope: PBGlobalScope) {
    this._setupUniformsFunc?.call(this, scope);
  }
  vertex(scope: PBInsideFunctionScope, pos: PBShaderExp, xz: PBShaderExp, waveGenerator: WaveGenerator) {
    this._vertexFunc?.call(this, scope, pos, xz, waveGenerator);
  }
  getVertexNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, useComputeShader: boolean) {
    const pb = scope.$builder;
    pb.func('getVertexNormal', [pb.vec2('xz')], function () {
      this.$l.uv0 = pb.div(this.xz, this.sizes.x);
      this.$l.uv1 = pb.div(this.xz, this.sizes.y);
      this.$l.uv2 = pb.div(this.xz, this.sizes.z);
      if (useComputeShader) {
        this.$l._sx_sz_dxdx_dzdz0 = pb.textureArraySampleLevel(this.dataTexture, this.uv0, 1, 0);
        this.$l._sx_sz_dxdx_dzdz1 = pb.textureArraySampleLevel(this.dataTexture, this.uv1, 3, 0);
        this.$l._sx_sz_dxdx_dzdz2 = pb.textureArraySampleLevel(this.dataTexture, this.uv2, 5, 0);
      } else {
        this.$l._sx_sz_dxdx_dzdz0 = pb.textureSampleLevel(this.sx_sz_dxdx_dzdz0, this.uv0, 0);
        this.$l._sx_sz_dxdx_dzdz1 = pb.textureSampleLevel(this.sx_sz_dxdx_dzdz1, this.uv1, 0);
        this.$l._sx_sz_dxdx_dzdz2 = pb.textureSampleLevel(this.sx_sz_dxdx_dzdz2, this.uv2, 0);
      }
      this.$l.sx = pb.add(this._sx_sz_dxdx_dzdz0.x, this._sx_sz_dxdx_dzdz1.x, this._sx_sz_dxdx_dzdz2.x);
      this.$l.sz = pb.add(this._sx_sz_dxdx_dzdz0.y, this._sx_sz_dxdx_dzdz1.y, this._sx_sz_dxdx_dzdz2.y);
      this.$l.dxdx_dzdz = pb.add(
        pb.mul(this._sx_sz_dxdx_dzdz0.zw, this.croppinesses.x),
        pb.mul(this._sx_sz_dxdx_dzdz1.zw, this.croppinesses.y),
        pb.mul(this._sx_sz_dxdx_dzdz2.zw, this.croppinesses.z)
      );
      this.$l.slope = pb.vec2(
        pb.div(this.sx, pb.add(1.0, this.dxdx_dzdz.x)),
        pb.div(this.sz, pb.add(1.0, this.dxdx_dzdz.y))
      );
      this.$l.normal = pb.normalize(pb.vec3(pb.neg(this.slope.x), 1.0, pb.neg(this.slope.y)));
      this.$return(this.normal);
    });
    return scope.getVertexNormal(xz) as PBShaderExp;
  }
  shading(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    foamFactor: PBShaderExp,
    discardable: PBShaderExp,
    waveGenerator: WaveGenerator
  ) {
    return this._shadingFunc?.call(
      this,
      scope,
      worldPos,
      worldNormal,
      foamFactor,
      discardable,
      waveGenerator
    );
  }
}

/** @internal */
export function createProgramOcean(waveGenerator: WaveGenerator, shadingImpl: WaterShaderImpl) {
  const program = getDevice().buildRenderProgram({
    vertex(pb) {
      this.$inputs.position = pb.vec3().attrib('position');
      this.$outputs.outPos = pb.vec3();
      this.$outputs.outNormal = pb.vec3();
      this.$outputs.outXZ = pb.vec2();
      this.flip = pb.int().uniform(0);
      this.viewProjMatrix = pb.mat4().uniform(0);
      this.worldMatrix = pb.mat4().uniform(1);
      this.level = pb.float().uniform(0);
      shadingImpl.setupUniforms(this);
      waveGenerator.setupUniforms(this, 0);
      pb.main(function () {
        this.$l.xz = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.position, 1)).xy;
        this.$l.outPos = pb.vec3();
        this.$l.outNormal = pb.vec3();
        waveGenerator.calcVertexPositionAndNormal(
          this,
          pb.vec3(this.xz.x, this.level, this.xz.y),
          this.outPos,
          this.outNormal
        );
        this.$outputs.outPos = this.outPos;
        this.$outputs.outNormal = this.outNormal;
        this.$outputs.outXZ = this.xz;
        this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.$outputs.outPos, 1));
        this.$if(pb.notEqual(this.flip, 0), function () {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        });
        shadingImpl.vertex(this, this.$outputs.outPos, this.$outputs.outXZ, waveGenerator);
      });
    },
    fragment(pb) {
      this.$outputs.outColor = pb.vec4();
      this.pos = pb.vec3().uniform(0);
      this.region = pb.vec4().uniform(0);
      shadingImpl.setupUniforms(this);
      waveGenerator.setupUniforms(this, 0);
      pb.main(function () {
        this.$l.discardable = pb.or(
          pb.any(pb.lessThan(this.$inputs.outXZ, this.region.xy)),
          pb.any(pb.greaterThan(this.$inputs.outXZ, this.region.zw))
        );
        this.$l.n = waveGenerator.calcFragmentNormalAndFoam(this, this.$inputs.outXZ, this.$inputs.outNormal);
        this.$outputs.outColor =
          shadingImpl.shading(
            this,
            this.$inputs.outPos,
            this.n.xyz,
            this.n.w,
            this.discardable,
            waveGenerator
          ) ?? pb.vec4(pb.add(pb.mul(this.n.xyz, 0.5), pb.vec3(0.5)), 1);
      });
    }
  })!;
  program.name = '@Ocean_Render';
  return program;
}

/** @internal */
export function createProgramPostFFT2(limit?: 4 | 2) {
  const program = getDevice().buildRenderProgram({
    vertex(pb) {
      this.$inputs.position = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.position, 1);
      });
    },
    fragment(pb) {
      if (!limit || limit === 4) {
        this.$outputs.dx_hy_dz_dxdz0 = pb.vec4();
        this.$outputs.sx_sz_dxdx_dzdz0 = pb.vec4();
        this.$outputs.dx_hy_dz_dxdz1 = pb.vec4();
        this.$outputs.sx_sz_dxdx_dzdz1 = pb.vec4();
        this.ifft0 = pb.tex2D().uniform(0);
        this.ifft1 = pb.tex2D().uniform(0);
        this.ifft2 = pb.tex2D().uniform(0);
        this.ifft3 = pb.tex2D().uniform(0);
      }
      if (!limit || limit === 2) {
        this.$outputs.dx_hy_dz_dxdz2 = pb.vec4();
        this.$outputs.sx_sz_dxdx_dzdz2 = pb.vec4();
        this.ifft4 = pb.tex2D().uniform(0);
        this.ifft5 = pb.tex2D().uniform(0);
      }
      pb.main(function () {
        this.$l.fragPos = getFragCoord(this, false);
        this.$l.p = pb.float(pb.add(this.fragPos.x, this.fragPos.y));
        // (-1)^(x+y) undoes the spectrum being centred at resolution/2. The
        // transform is left unnormalized (see the butterfly passes), so this
        // is the only factor applied here.
        this.$l.m = pb.sub(pb.mul(pb.sub(1, pb.mod(this.p, 2)), 2), 1);
        this.$l.uv = pb.ivec2(this.fragPos);
        if (!limit || limit === 4) {
          this.$outputs.dx_hy_dz_dxdz0 = pb.mul(pb.textureLoad(this.ifft0, this.uv, 0), this.m);
          this.$outputs.sx_sz_dxdx_dzdz0 = pb.mul(pb.textureLoad(this.ifft1, this.uv, 0), this.m);
          this.$outputs.dx_hy_dz_dxdz1 = pb.mul(pb.textureLoad(this.ifft2, this.uv, 0), this.m);
          this.$outputs.sx_sz_dxdx_dzdz1 = pb.mul(pb.textureLoad(this.ifft3, this.uv, 0), this.m);
        }
        if (!limit || limit === 2) {
          this.$outputs.dx_hy_dz_dxdz2 = pb.mul(pb.textureLoad(this.ifft4, this.uv, 0), this.m);
          this.$outputs.sx_sz_dxdx_dzdz2 = pb.mul(pb.textureLoad(this.ifft5, this.uv, 0), this.m);
        }
      });
    }
  })!;
  program.name = '@Water_PostFFT2';
  return program;
}

/** @internal */
export function createProgramHk(limit?: 4 | 2) {
  const program = getDevice().buildRenderProgram({
    vertex(pb) {
      this.$inputs.position = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.position, 1);
      });
    },
    fragment(pb) {
      if (!limit || limit === 4) {
        this.$outputs.spectrum0 = pb.vec4();
        this.$outputs.spectrum1 = pb.vec4();
        this.$outputs.spectrum2 = pb.vec4();
        this.$outputs.spectrum3 = pb.vec4();
      }
      if (!limit || limit === 2) {
        this.$outputs.spectrum4 = pb.vec4();
        this.$outputs.spectrum5 = pb.vec4();
      }
      this.resolution = pb.int().uniform(0);
      this.sizes = pb.vec4().uniform(0);
      this.t = pb.float().uniform(0);
      if (!limit || limit === 4) {
        this.h0Texture0 = pb.tex2D().uniform(0);
        this.h0Texture1 = pb.tex2D().uniform(0);
      }
      if (!limit || limit === 2) {
        this.h0Texture2 = pb.tex2D().uniform(0);
      }
      this.RATIO = pb.float(0.618033989036);
      this.g = pb.float(9.81);
      const Complex = pb.defineStruct([pb.float('re'), pb.float('im')], 'Complex');
      const Spectrum = pb.defineStruct(
        [
          Complex('dx'),
          Complex('hy'),
          Complex('dz'),
          Complex('sx'),
          Complex('sz'),
          Complex('dxdx'),
          Complex('dxdz'),
          Complex('dzdz')
        ],
        'Spectrum'
      );
      pb.func('add', [Complex('a'), Complex('b')], function () {
        this.$return(Complex(pb.add(this.a.re, this.b.re), pb.add(this.a.im, this.b.im)));
      });
      pb.func('mul', [Complex('a'), Complex('b')], function () {
        this.$return(
          Complex(
            pb.sub(pb.mul(this.a.re, this.b.re), pb.mul(this.a.im, this.b.im)),
            pb.add(pb.mul(this.a.re, this.b.im), pb.mul(this.a.im, this.b.re))
          )
        );
      });
      pb.func('eix', [pb.float('x')], function () {
        this.$return(Complex(pb.cos(this.x), pb.sin(this.x)));
      });
      pb.func('conj', [Complex('a')], function () {
        this.$return(Complex(this.a.re, pb.neg(this.a.im)));
      });
      pb.func('scale', [Complex('a'), pb.float('v')], function () {
        this.$return(Complex(pb.mul(this.a.re, this.v), pb.mul(this.a.im, this.v)));
      });
      pb.func('negate', [Complex('a')], function () {
        this.$return(Complex(pb.neg(this.a.re), pb.neg(this.a.im)));
      });
      for (let x = 0; x <= 2; x++) {
        if (x < 2 && limit === 2) {
          continue;
        }
        if (x === 2 && limit === 4) {
          continue;
        }
        pb.func(`getSpectrum${x}`, [pb.vec2('x'), pb.float('size'), pb.ivec2('fragCoord')], function () {
          this.$l.hy = Complex(0, 0);
          this.$l.sx = Complex(0, 0);
          this.$l.sz = Complex(0, 0);
          this.$l.dx = Complex(0, 0);
          this.$l.dz = Complex(0, 0);
          this.$l.dxdx = Complex(0, 0);
          this.$l.dxdz = Complex(0, 0);
          this.$l.dzdz = Complex(0, 0);
          this.$if(pb.lessThanEqual(this.size, 1e-3), function () {
            this.$return(
              Spectrum(this.dx, this.hy, this.dz, this.sx, this.sz, this.dxdx, this.dxdz, this.dzdz)
            );
          });
          this.$l.k = pb.mul(this.x, pb.div(Math.PI * 2, this.size));
          this.$l.kLen = pb.length(this.k);
          this.$if(pb.greaterThan(this.kLen, 1e-6), function () {
            this.$l.w = pb.sqrt(pb.mul(this.kLen, this.g));
            this.$l.h0Texel = pb.textureLoad(this[`h0Texture${x}`], this.fragCoord, 0);
            this.$l.e = this.eix(pb.mul(this.w, this.t));
            this.$l.h0 = Complex(this.h0Texel.x, this.h0Texel.y);
            this.$l.h0MinConj = Complex(this.h0Texel.z, this.h0Texel.w);
            this.hy = this.add(this.mul(this.h0, this.e), this.mul(this.h0MinConj, this.conj(this.e)));
            this.$if(pb.notEqual(this.fragCoord.x, 0), function () {
              this.sx = this.mul(Complex(0, this.k.x), this.hy);
              this.dx = this.mul(Complex(0, pb.div(pb.neg(this.k.x), this.kLen)), this.hy);
              this.dxdx = this.scale(this.hy, pb.div(pb.mul(this.k.x, this.k.x), this.kLen));
            });
            this.$if(pb.notEqual(this.fragCoord.y, 0), function () {
              this.sz = this.mul(Complex(0, this.k.y), this.hy);
              this.dz = this.mul(Complex(0, pb.div(pb.neg(this.k.y), this.kLen)), this.hy);
              this.dzdz = this.scale(this.hy, pb.div(pb.mul(this.k.y, this.k.y), this.kLen));
              this.$if(pb.notEqual(this.fragCoord.x, 0), function () {
                this.dxdz = this.scale(this.hy, pb.div(pb.mul(this.k.x, this.k.y), this.kLen));
              });
            });
          });
          this.$return(
            Spectrum(this.dx, this.hy, this.dz, this.sx, this.sz, this.dxdx, this.dxdz, this.dzdz)
          );
        });
      }
      pb.func(
        'compressSpectrum',
        [Spectrum('spec'), pb.vec4('part0').out(), pb.vec4('part1').out()],
        function () {
          this.$l.i = Complex(0, 1);
          this.$l.dx_hy = this.add(this.spec.dx, this.mul(this.i, this.spec.hy));
          this.$l.dz_dxdz = this.add(this.spec.dz, this.mul(this.i, this.spec.dxdz));
          this.$l.sx_sz = this.add(this.spec.sx, this.mul(this.i, this.spec.sz));
          this.$l.dxdx_dzdz = this.add(this.spec.dxdx, this.mul(this.i, this.spec.dzdz));
          this.part0 = pb.vec4(this.dx_hy.re, this.dx_hy.im, this.dz_dxdz.re, this.dz_dxdz.im);
          this.part1 = pb.vec4(this.sx_sz.re, this.sx_sz.im, this.dxdx_dzdz.re, this.dxdx_dzdz.im);
        }
      );
      pb.main(function () {
        this.fragXY = pb.ivec2(getFragCoord(this, false));
        this.$l.x = pb.vec2(pb.sub(this.fragXY, pb.ivec2(pb.div(this.resolution, 2))));
        if (!limit || limit === 4) {
          this.$l.s0 = pb.vec4();
          this.$l.s1 = pb.vec4();
          this.$l.s2 = pb.vec4();
          this.$l.s3 = pb.vec4();
          this.$l.spec0 = this.getSpectrum0(this.x, this.sizes.x, this.fragXY);
          this.$l.spec1 = this.getSpectrum1(this.x, this.sizes.y, this.fragXY);
          this.compressSpectrum(this.spec0, this.s0, this.s1);
          this.compressSpectrum(this.spec1, this.s2, this.s3);
          this.$outputs.spectrum0 = this.s0;
          this.$outputs.spectrum1 = this.s1;
          this.$outputs.spectrum2 = this.s2;
          this.$outputs.spectrum3 = this.s3;
        }
        if (!limit || limit === 2) {
          this.$l.s4 = pb.vec4();
          this.$l.s5 = pb.vec4();
          this.$l.spec2 = this.getSpectrum2(this.x, this.sizes.z, this.fragXY);
          this.compressSpectrum(this.spec2, this.s4, this.s5);
          this.$outputs.spectrum4 = this.s4;
          this.$outputs.spectrum5 = this.s5;
        }
      });
    }
  })!;
  program.name = '@Water_Hk';
  return program;
}

/** @internal */
export function createProgramH0(
  useComputeShader = false,
  threadGroupSize = 8,
  targetFormat: TextureFormat = 'rgba32f'
) {
  function getComputeFunc(useComputeShader = false, fmt: TextureFormat) {
    return function (this: PBGlobalScope, pb: ProgramBuilder) {
      if (useComputeShader) {
        this.spectrum =
          fmt === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
      } else {
        this.$outputs.spectrum0 = pb.vec4();
        this.$outputs.spectrum1 = pb.vec4();
        this.$outputs.spectrum2 = pb.vec4();
      }
      this.noise = pb.tex2D().uniform(0);
      this.resolution = pb.int().uniform(0);
      this.wind = pb.vec2().uniform(0);
      this.alignment = pb.float().uniform(0);
      this.g = pb.float(9.81);
      this.cascade0 = pb.vec4().uniform(0);
      this.cascade1 = pb.vec4().uniform(0);
      this.cascade2 = pb.vec4().uniform(0);
      // Gaussian pair for k and -k. `offset` (texels) gives each cascade a noise of
      // its own, so the cascades' phases are independent.
      pb.func('gauss', [pb.ivec2('fragCoord'), pb.ivec2('offset')], function () {
        this.$l.uv = pb.div(pb.vec2(pb.add(this.fragCoord, this.offset)), pb.float(this.resolution));
        this.$l.uvNeg = pb.div(pb.vec2(pb.sub(this.offset, this.fragCoord)), pb.float(this.resolution));
        this.$l.noise0 = pb.textureSampleLevel(this.noise, this.uv, 0).rg;
        this.$l.noise1 = pb.textureSampleLevel(this.noise, this.uvNeg, 0).rg;
        this.$l.u0 = pb.mul(this.noise0.x, Math.PI * 2);
        this.$l.v0 = pb.sqrt(pb.mul(pb.log(this.noise0.y), -2));
        this.$l.u1 = pb.mul(this.noise1.x, Math.PI * 2);
        this.$l.v1 = pb.sqrt(pb.mul(pb.log(this.noise1.y), -2));
        this.$return(
          pb.vec4(
            pb.mul(this.v0, pb.cos(this.u0)),
            pb.mul(this.v0, pb.sin(this.u0)),
            pb.mul(this.v1, pb.cos(this.u1)),
            pb.mul(pb.neg(this.v1), pb.sin(this.u1))
          )
        );
      });
      // Phillips spectrum over the cascade's band: zero inside the square
      // |kx|, |ky| < minK the larger cascades cover.
      pb.func('phillips', [pb.vec2('k'), pb.float('A'), pb.float('minK')], function () {
        this.$l.k2 = pb.dot(this.k, this.k);
        this.$if(pb.all(pb.lessThan(pb.abs(this.k), pb.vec2(this.minK))), function () {
          this.$return(pb.vec4(0));
        });
        this.$l.L = pb.div(pb.dot(this.wind, this.wind), this.g);
        this.$l.L2 = pb.mul(this.L, this.L);
        this.$l.h0k = pb.mul(
          pb.div(pb.div(this.A, this.k2), this.k2),
          pb.exp(pb.div(-1, pb.mul(this.k2, this.L2))),
          0.5
        );
        this.$l.h0mk = this.h0k;
        this.$if(pb.greaterThan(this.alignment, 0), function () {
          this.h0k = pb.mul(
            this.h0k,
            pb.pow(pb.max(0, pb.dot(pb.normalize(this.wind), pb.normalize(this.k))), this.alignment)
          );
          this.h0mk = pb.mul(
            this.h0mk,
            pb.pow(pb.max(0, pb.dot(pb.normalize(this.wind), pb.normalize(pb.neg(this.k)))), this.alignment)
          );
        });
        this.$return(pb.sqrt(pb.vec4(this.h0k, this.h0k, this.h0mk, this.h0mk)));
      });
      pb.main(function () {
        this.$l.x = pb.vec2(
          pb.sub(pb.ivec2(getFragCoord(this, useComputeShader)), pb.ivec2(pb.div(this.resolution, 2)))
        );
        this.$l.k = pb.mul(pb.vec2(Math.PI * 2), this.x);
        this.$l.coord = pb.ivec2(getFragCoord(this, useComputeShader));
        this.$l.rnd0 = this.gauss(this.coord, pb.ivec2(0, 0));
        this.$l.rnd1 = this.gauss(this.coord, pb.ivec2(73, 151));
        this.$l.rnd2 = this.gauss(this.coord, pb.ivec2(157, 41));
        if (useComputeShader) {
          pb.textureArrayStore(
            this.spectrum,
            this.$builtins.globalInvocationId.xy,
            0,
            pb.mul(
              this.phillips(pb.div(this.k, this.cascade0.x), this.cascade0.y, this.cascade0.z),
              this.rnd0
            )
          );
          pb.textureArrayStore(
            this.spectrum,
            this.$builtins.globalInvocationId.xy,
            1,
            pb.mul(
              this.phillips(pb.div(this.k, this.cascade1.x), this.cascade1.y, this.cascade1.z),
              this.rnd1
            )
          );
          pb.textureArrayStore(
            this.spectrum,
            this.$builtins.globalInvocationId.xy,
            2,
            pb.mul(
              this.phillips(pb.div(this.k, this.cascade2.x), this.cascade2.y, this.cascade2.z),
              this.rnd2
            )
          );
        } else {
          this.$outputs.spectrum0 = pb.mul(
            this.phillips(pb.div(this.k, this.cascade0.x), this.cascade0.y, this.cascade0.z),
            this.rnd0
          );
          this.$outputs.spectrum1 = pb.mul(
            this.phillips(pb.div(this.k, this.cascade1.x), this.cascade1.y, this.cascade1.z),
            this.rnd1
          );
          this.$outputs.spectrum2 = pb.mul(
            this.phillips(pb.div(this.k, this.cascade2.x), this.cascade2.y, this.cascade2.z),
            this.rnd2
          );
        }
      });
    };
  }
  let program: GPUProgram;
  if (useComputeShader) {
    program = getDevice().buildComputeProgram({
      workgroupSize: [threadGroupSize, threadGroupSize, 1],
      compute: getComputeFunc(useComputeShader, targetFormat)
    })!;
  } else {
    program = getDevice().buildRenderProgram({
      vertex(pb) {
        this.$inputs.position = pb.vec3().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.position, 1);
        });
      },
      fragment: getComputeFunc(useComputeShader, targetFormat)
    })!;
  }
  program.name = '@Water_H0';
  return program;
}

/** @internal */
export function createProgramFFT2V(limit?: 4 | 2) {
  const program = getDevice().buildRenderProgram({
    vertex(pb) {
      this.$inputs.position = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.position, 1);
      });
    },
    fragment(pb) {
      if (!limit || limit === 4) {
        this.$outputs.ifft0 = pb.vec4();
        this.$outputs.ifft1 = pb.vec4();
        this.$outputs.ifft2 = pb.vec4();
        this.$outputs.ifft3 = pb.vec4();
        this.spectrum0 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum1 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum2 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum3 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      }
      if (!limit || limit === 2) {
        this.$outputs.ifft4 = pb.vec4();
        this.$outputs.ifft5 = pb.vec4();
        this.spectrum4 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum5 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      }
      this.butterfly = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.phase = pb.int().uniform(0);
      const Complex = pb.defineStruct([pb.float('re'), pb.float('im')], 'Complex');
      pb.func('add', [Complex('a'), Complex('b')], function () {
        this.$return(Complex(pb.add(this.a.re, this.b.re), pb.add(this.a.im, this.b.im)));
      });
      pb.func('mul', [Complex('a'), Complex('b')], function () {
        this.$return(
          Complex(
            pb.sub(pb.mul(this.a.re, this.b.re), pb.mul(this.a.im, this.b.im)),
            pb.add(pb.mul(this.a.re, this.b.im), pb.mul(this.a.im, this.b.re))
          )
        );
      });
      for (let x = 0; x <= 5; x++) {
        if (x < 4 && limit === 2) {
          continue;
        }
        if (x > 3 && limit === 4) {
          continue;
        }
        pb.func(`twiddle${x}`, [pb.vec4('texelButt'), pb.int('x')], function () {
          this.$l.texelA = pb.textureLoad(
            this[`spectrum${x}`],
            pb.ivec2(this.x, pb.int(this.texelButt.b)),
            0
          );
          this.$l.texelB = pb.textureLoad(
            this[`spectrum${x}`],
            pb.ivec2(this.x, pb.int(this.texelButt.a)),
            0
          );
          this.$l.w = Complex(this.texelButt.r, this.texelButt.g);
          this.$l.a1 = Complex(this.texelA.x, this.texelA.y);
          this.$l.b1 = Complex(this.texelB.x, this.texelB.y);
          // Unnormalized butterfly: per-stage 0.5 scaling would push fp16
          // intermediates into the subnormal range; unscaled they stay at metre scale.
          this.$l.r1 = this.add(this.a1, this.mul(this.b1, this.w));
          this.$l.a2 = Complex(this.texelA.z, this.texelA.w);
          this.$l.b2 = Complex(this.texelB.z, this.texelB.w);
          this.$l.r2 = this.add(this.a2, this.mul(this.b2, this.w));
          this.$return(pb.vec4(this.r1.re, this.r1.im, this.r2.re, this.r2.im));
        });
      }
      pb.main(function () {
        this.$l.x = pb.int(getFragCoord(this, false).x);
        this.$l.y = pb.int(getFragCoord(this, false).y);
        this.$l.texelButt = pb.textureLoad(this.butterfly, pb.ivec2(this.phase, this.y), 0);
        if (!limit || limit === 4) {
          this.$outputs.ifft0 = this.twiddle0(this.texelButt, this.x);
          this.$outputs.ifft1 = this.twiddle1(this.texelButt, this.x);
          this.$outputs.ifft2 = this.twiddle2(this.texelButt, this.x);
          this.$outputs.ifft3 = this.twiddle3(this.texelButt, this.x);
        }
        if (!limit || limit === 2) {
          this.$outputs.ifft4 = this.twiddle4(this.texelButt, this.x);
          this.$outputs.ifft5 = this.twiddle5(this.texelButt, this.x);
        }
      });
    }
  })!;
  program.name = '@Water_FFT2V';
  return program;
}

/** @internal */
export function createProgramFFT2H(limit?: 4 | 2) {
  const program = getDevice().buildRenderProgram({
    vertex(pb) {
      this.$inputs.position = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.position, 1);
      });
    },
    fragment(pb) {
      if (!limit || limit === 4) {
        this.$outputs.ifft0 = pb.vec4();
        this.$outputs.ifft1 = pb.vec4();
        this.$outputs.ifft2 = pb.vec4();
        this.$outputs.ifft3 = pb.vec4();
        this.spectrum0 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum1 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum2 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum3 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      }
      if (!limit || limit === 2) {
        this.$outputs.ifft4 = pb.vec4();
        this.$outputs.ifft5 = pb.vec4();
        this.spectrum4 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.spectrum5 = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      }
      this.butterfly = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.phase = pb.int().uniform(0);
      const Complex = pb.defineStruct([pb.float('re'), pb.float('im')], 'Complex');
      pb.func('add', [Complex('a'), Complex('b')], function () {
        this.$return(Complex(pb.add(this.a.re, this.b.re), pb.add(this.a.im, this.b.im)));
      });
      pb.func('mul', [Complex('a'), Complex('b')], function () {
        this.$return(
          Complex(
            pb.sub(pb.mul(this.a.re, this.b.re), pb.mul(this.a.im, this.b.im)),
            pb.add(pb.mul(this.a.re, this.b.im), pb.mul(this.a.im, this.b.re))
          )
        );
      });
      for (let x = 0; x <= 5; x++) {
        if (x < 4 && limit === 2) {
          continue;
        }
        if (x > 3 && limit === 4) {
          continue;
        }
        pb.func(`twiddle${x}`, [pb.vec4('texelButt'), pb.int('y')], function () {
          this.$l.texelA = pb.textureLoad(
            this[`spectrum${x}`],
            pb.ivec2(pb.int(this.texelButt.b), this.y),
            0
          );
          this.$l.texelB = pb.textureLoad(
            this[`spectrum${x}`],
            pb.ivec2(pb.int(this.texelButt.a), this.y),
            0
          );
          this.$l.w = Complex(this.texelButt.r, this.texelButt.g);
          this.$l.a1 = Complex(this.texelA.x, this.texelA.y);
          this.$l.b1 = Complex(this.texelB.x, this.texelB.y);
          // Unnormalized butterfly: per-stage 0.5 scaling would push fp16
          // intermediates into the subnormal range; unscaled they stay at metre scale.
          this.$l.r1 = this.add(this.a1, this.mul(this.b1, this.w));
          this.$l.a2 = Complex(this.texelA.z, this.texelA.w);
          this.$l.b2 = Complex(this.texelB.z, this.texelB.w);
          this.$l.r2 = this.add(this.a2, this.mul(this.b2, this.w));
          this.$return(pb.vec4(this.r1.re, this.r1.im, this.r2.re, this.r2.im));
        });
      }
      pb.main(function () {
        this.$l.x = pb.int(getFragCoord(this, false).x);
        this.$l.y = pb.int(getFragCoord(this, false).y);
        this.$l.texelButt = pb.textureLoad(this.butterfly, pb.ivec2(this.phase, this.x), 0);
        if (!limit || limit === 4) {
          this.$outputs.ifft0 = this.twiddle0(this.texelButt, this.y);
          this.$outputs.ifft1 = this.twiddle1(this.texelButt, this.y);
          this.$outputs.ifft2 = this.twiddle2(this.texelButt, this.y);
          this.$outputs.ifft3 = this.twiddle3(this.texelButt, this.y);
        }
        if (!limit || limit === 2) {
          this.$outputs.ifft4 = this.twiddle4(this.texelButt, this.y);
          this.$outputs.ifft5 = this.twiddle5(this.texelButt, this.y);
        }
      });
    }
  })!;
  program.name = '@Water_FFT2H';
  return program;
}

/**
 * Radix of the group shared transform for each line length it supports: the
 * length is a power of it, and the length over it, the threads of a workgroup,
 * stays within the 256 every device allows.
 */
const FFT_RADIX: Readonly<Record<number, number>> = {
  16: 4,
  32: 2,
  64: 8,
  128: 2,
  256: 4,
  512: 8,
  1024: 4
};
/** Group shared memory the transform keeps within, the least a device offers */
const FFT_SHARED_BYTES = 16384;
/** Shared memory banks the exchange is padded for */
const FFT_SHARED_BANKS = 32;

/**
 * Whether the compute transform supports the given resolution.
 * @internal
 */
export function isFFTComputeResolution(resolution: number) {
  return !!FFT_RADIX[resolution];
}

/**
 * Inverse FFT of the ocean spectrum along one axis in a single dispatch.
 *
 * One workgroup transforms one line of one cascade: the line stays in the
 * registers of its threads, which exchange it through group shared memory
 * between the radix stages, a Stockham transform after Govindaraju et al. 2008,
 * "High Performance Discrete Fourier Transforms on Graphics Processors". Thread
 * t holds the elements t + r * N / R, r < R, loading and storing them in natural
 * order. The exchange is padded against bank conflicts where it writes with a
 * stride below the bank count.
 *
 * Dispatched as (resolution, 3, 1) workgroups, the second index the cascade. The
 * horizontal pass builds the spectrum at time `t` from h0 as it loads each row,
 * and writes the transformed rows to layers 2c and 2c + 1 of `rows`. The vertical
 * pass transforms the columns of those, multiplies by (-1)^(x+y) to undo the
 * centring of the spectrum, and writes the fields to `output`. As in the
 * fragment path the transform is F(n) = sum f(k) exp(+2 pi i n k / N),
 * unnormalized.
 * @internal
 */
export function createProgramFFTCompute(
  resolution: number,
  horizontal: boolean,
  targetFormat: TextureFormat = 'rgba16f'
) {
  const N = resolution;
  const R = FFT_RADIX[N];
  if (!R) {
    throw new Error(`FFTWaveGenerator: resolution ${N} must be a power of 2 within [16, 1024] on WebGPU`);
  }
  const T = N / R;
  // Write strides of the exchanges, one after each radix stage but the last
  const strides = [1];
  for (let ns = R; ns < T; ns *= R) {
    strides.push(ns);
  }
  const bankSkip = (stride: number) => (stride < FFT_SHARED_BANKS ? stride : 0);
  const sharedLength = Math.max(
    ...strides.map((stride) => N + Math.floor((N - 1) / FFT_SHARED_BANKS) * bankSkip(stride))
  );
  // Each element is 8 floats, two vec4s of two complex values each; the exchange
  // moves as many of them per round as the shared memory holds
  let channels = 4;
  while (channels > 1 && channels * sharedLength * 4 > FFT_SHARED_BYTES) {
    channels >>= 1;
  }
  const program = getDevice().buildComputeProgram({
    workgroupSize: [T, 1, 1],
    compute(pb) {
      if (horizontal) {
        this.h0Texture = pb.tex2DArray().uniform(0);
        this.t = pb.float().uniform(0);
        this.sizes = pb.vec4().uniform(0);
        this.rows =
          targetFormat === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
      } else {
        this.rows = pb.tex2DArray().sampleType('unfilterable-float').uniform(0);
        this.output =
          targetFormat === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
      }
      for (let c = 0; c < channels; c++) {
        this[`fftShared${c}`] = pb.float[sharedLength]().workgroup();
      }
      // i times each of the two complex values in v
      pb.func('fftMulI', [pb.vec4('v')], function () {
        this.$return(pb.vec4(pb.neg(this.v.y), this.v.x, pb.neg(this.v.w), this.v.z));
      });
      // Each of the two complex values in v times w
      pb.func('fftMul', [pb.vec4('v'), pb.vec2('w')], function () {
        this.$return(
          pb.add(
            pb.mul(this.v, this.w.x),
            pb.mul(this.v.yxwz, pb.vec4(pb.neg(this.w.y), this.w.y, pb.neg(this.w.y), this.w.y))
          )
        );
      });
      pb.func('fftMul2', [pb.vec2('a'), pb.vec2('b')], function () {
        this.$return(
          pb.vec2(
            pb.sub(pb.mul(this.a.x, this.b.x), pb.mul(this.a.y, this.b.y)),
            pb.add(pb.mul(this.a.x, this.b.y), pb.mul(this.a.y, this.b.x))
          )
        );
      });
      if (horizontal) {
        // Spectrum of one cascade at a texel, as dx + i hy, dz + i dxdz and
        // sx + i sz, dxdx + i dzdz: two real fields per complex one
        pb.func(
          'fftSpectrum',
          [pb.ivec2('coord'), pb.int('cascade'), pb.vec4('part0').out(), pb.vec4('part1').out()],
          function () {
            this.part0 = pb.vec4(0);
            this.part1 = pb.vec4(0);
            this.$l.size = this.sizes.at(this.cascade);
            this.$if(pb.greaterThan(this.size, 1e-3), function () {
              this.$l.k = pb.mul(
                pb.vec2(pb.sub(this.coord, pb.ivec2(N / 2))),
                pb.div(Math.PI * 2, this.size)
              );
              this.$l.kLen = pb.length(this.k);
              this.$if(pb.greaterThan(this.kLen, 1e-6), function () {
                this.$l.phase = pb.mul(pb.sqrt(pb.mul(this.kLen, 9.81)), this.t);
                this.$l.e = pb.vec2(pb.cos(this.phase), pb.sin(this.phase));
                // h(k, t) = h0(k) e^(iwt) + conj(h0(-k)) e^(-iwt), conj(h0(-k)) in zw
                this.$l.h0 = pb.textureArrayLoad(this.h0Texture, this.coord, this.cascade, 0);
                this.$l.hy = pb.add(
                  this.fftMul2(this.h0.xy, this.e),
                  this.fftMul2(this.h0.zw, pb.vec2(this.e.x, pb.neg(this.e.y)))
                );
                this.$l.ihy = pb.vec2(pb.neg(this.hy.y), this.hy.x);
                this.$l.dx = pb.vec2(0);
                this.$l.dz = pb.vec2(0);
                this.$l.sx = pb.vec2(0);
                this.$l.sz = pb.vec2(0);
                this.$l.dxdx = pb.vec2(0);
                this.$l.dzdz = pb.vec2(0);
                this.$l.dxdz = pb.vec2(0);
                // The Nyquist column and row keep no odd derivative
                this.$if(pb.notEqual(this.coord.x, 0), function () {
                  this.sx = pb.mul(this.ihy, this.k.x);
                  this.dx = pb.mul(this.ihy, pb.div(pb.neg(this.k.x), this.kLen));
                  this.dxdx = pb.mul(this.hy, pb.div(pb.mul(this.k.x, this.k.x), this.kLen));
                });
                this.$if(pb.notEqual(this.coord.y, 0), function () {
                  this.sz = pb.mul(this.ihy, this.k.y);
                  this.dz = pb.mul(this.ihy, pb.div(pb.neg(this.k.y), this.kLen));
                  this.dzdz = pb.mul(this.hy, pb.div(pb.mul(this.k.y, this.k.y), this.kLen));
                  this.$if(pb.notEqual(this.coord.x, 0), function () {
                    this.dxdz = pb.mul(this.hy, pb.div(pb.mul(this.k.x, this.k.y), this.kLen));
                  });
                });
                this.part0 = pb.vec4(
                  pb.sub(this.dx.x, this.hy.y),
                  pb.add(this.dx.y, this.hy.x),
                  pb.sub(this.dz.x, this.dxdz.y),
                  pb.add(this.dz.y, this.dxdz.x)
                );
                this.part1 = pb.vec4(
                  pb.sub(this.sx.x, this.sz.y),
                  pb.add(this.sx.y, this.sz.x),
                  pb.sub(this.dxdx.x, this.dzdz.y),
                  pb.add(this.dxdx.y, this.dzdz.x)
                );
              });
            });
          }
        );
      }
      pb.main(function () {
        const scope = this;
        let numTemps = 0;
        const temp = (value: PBShaderExp) => {
          const name = `fftTemp${numTemps++}`;
          scope.$l[name] = value;
          return scope[name] as PBShaderExp;
        };
        const dataName = (part: number, r: number) => `fftData${part}_${r}`;
        const data = (part: number, r: number) => scope[dataName(part, r)] as PBShaderExp;
        const setData = (part: number, r: number, value: PBShaderExp) => {
          scope[dataName(part, r)] = value;
        };
        this.$l.thread = this.$builtins.localInvocationId.x;
        this.$l.line = this.$builtins.workGroupId.x;
        this.$l.cascade = pb.int(this.$builtins.workGroupId.y);
        this.$l.layer = pb.mul(this.cascade, 2);
        for (let r = 0; r < R; r++) {
          this.$l[`fftPos${r}`] = pb.add(this.thread, r * T);
          const pos = this[`fftPos${r}`];
          if (horizontal) {
            this.$l[dataName(0, r)] = pb.vec4();
            this.$l[dataName(1, r)] = pb.vec4();
            this.fftSpectrum(pb.ivec2(pb.int(pos), pb.int(this.line)), this.cascade, data(0, r), data(1, r));
          } else {
            const coord = pb.ivec2(pb.int(this.line), pb.int(pos));
            this.$l[dataName(0, r)] = pb.textureArrayLoad(this.rows, coord, this.layer, 0);
            this.$l[dataName(1, r)] = pb.textureArrayLoad(this.rows, coord, pb.add(this.layer, 1), 0);
          }
        }
        // Radix R transform of the elements of each part, returning temporaries
        const radix4 = (v: PBShaderExp[]) => {
          const a0 = temp(pb.add(v[0], v[2]));
          const a1 = temp(pb.add(v[1], v[3]));
          const a2 = temp(pb.sub(v[0], v[2]));
          const a3 = temp(this.fftMulI(pb.sub(v[1], v[3])));
          return [pb.add(a0, a1), pb.add(a2, a3), pb.sub(a0, a1), pb.sub(a2, a3)].map(temp);
        };
        const radix = (v: PBShaderExp[]) => {
          if (R === 2) {
            return [pb.add(v[0], v[1]), pb.sub(v[0], v[1])].map(temp);
          }
          if (R === 4) {
            return radix4(v);
          }
          const even = radix4([v[0], v[2], v[4], v[6]]);
          const odd = radix4([v[1], v[3], v[5], v[7]]);
          const t1 = temp(this.fftMul(odd[1], pb.vec2(Math.SQRT1_2, Math.SQRT1_2)));
          const t2 = temp(this.fftMulI(odd[2]));
          const t3 = temp(this.fftMul(odd[3], pb.vec2(-Math.SQRT1_2, Math.SQRT1_2)));
          return [
            pb.add(even[0], odd[0]),
            pb.add(even[1], t1),
            pb.add(even[2], t2),
            pb.add(even[3], t3),
            pb.sub(even[0], odd[0]),
            pb.sub(even[1], t1),
            pb.sub(even[2], t2),
            pb.sub(even[3], t3)
          ].map(temp);
        };
        const radixStage = () => {
          for (let part = 0; part < 2; part++) {
            const result = radix(Array.from({ length: R }, (_, r) => data(part, r)));
            result.forEach((value, r) => setData(part, r, value));
          }
        };
        // Twiddles of the stage merging transforms of length ns
        const twiddleStage = (ns: number) => {
          const angle = temp(pb.mul(pb.float(pb.mod(this.thread, ns)), (Math.PI * 2) / (ns * R)));
          const step = temp(pb.vec2(pb.cos(angle), pb.sin(angle)));
          let twiddle = step;
          for (let r = 1; r < R; r++) {
            for (let part = 0; part < 2; part++) {
              setData(part, r, this.fftMul(data(part, r), twiddle));
            }
            if (r < R - 1) {
              twiddle = temp(this.fftMul2(twiddle, step));
            }
          }
        };
        const sharedIndex = (i: PBShaderExp, skip: number) =>
          skip > 0 ? temp(pb.add(i, pb.mul(pb.div(i, FFT_SHARED_BANKS), skip))) : i;
        let needBarrier = false;
        // Element r of a thread goes to writeBase + r * stride, and comes back from
        // thread + r * T
        const exchange = (writeBase: PBShaderExp, stride: number) => {
          const skip = bankSkip(stride);
          const writeAt = Array.from({ length: R }, (_, r) =>
            sharedIndex(temp(pb.add(writeBase, r * stride)), skip)
          );
          const readAt = Array.from({ length: R }, (_, r) => sharedIndex(this[`fftPos${r}`], skip));
          const read = [0, 1].map(() => Array.from({ length: R }, () => [] as PBShaderExp[]));
          for (let first = 0; first < 8; first += channels) {
            if (needBarrier) {
              pb.workgroupBarrier();
            }
            needBarrier = true;
            for (let r = 0; r < R; r++) {
              for (let c = 0; c < channels; c++) {
                const ch = first + c;
                this[`fftShared${c}`].setAt(writeAt[r], data(ch >> 2, r)['xyzw'[ch & 3]]);
              }
            }
            pb.workgroupBarrier();
            for (let r = 0; r < R; r++) {
              for (let c = 0; c < channels; c++) {
                const ch = first + c;
                read[ch >> 2][r][ch & 3] = temp(this[`fftShared${c}`].at(readAt[r]));
              }
            }
            // A part is replaced once all its channels are back
            if ((first + channels) % 4 === 0) {
              const part = (first + channels) / 4 - 1;
              for (let r = 0; r < R; r++) {
                setData(
                  part,
                  r,
                  pb.vec4(read[part][r][0], read[part][r][1], read[part][r][2], read[part][r][3])
                );
              }
            }
          }
        };
        radixStage();
        exchange(pb.mul(this.thread, R), 1);
        let ns = R;
        for (; ns < T; ns *= R) {
          twiddleStage(ns);
          radixStage();
          exchange(temp(pb.add(pb.mul(pb.div(this.thread, ns), ns * R), pb.mod(this.thread, ns))), ns);
        }
        twiddleStage(ns);
        radixStage();
        for (let r = 0; r < R; r++) {
          const pos = this[`fftPos${r}`];
          if (horizontal) {
            const coord = pb.uvec2(pos, this.line);
            pb.textureArrayStore(this.rows, coord, this.layer, data(0, r));
            pb.textureArrayStore(this.rows, coord, pb.add(this.layer, 1), data(1, r));
          } else {
            const coord = pb.uvec2(this.line, pos);
            const sign = temp(pb.sub(1, pb.mul(pb.float(pb.mod(pb.add(this.line, pos), 2)), 2)));
            pb.textureArrayStore(this.output, coord, this.layer, pb.mul(data(0, r), sign));
            pb.textureArrayStore(this.output, coord, pb.add(this.layer, 1), pb.mul(data(1, r), sign));
          }
        }
      });
    }
  })!;
  program.name = horizontal ? '@Water_FFTRows' : '@Water_FFTColumns';
  return program;
}
