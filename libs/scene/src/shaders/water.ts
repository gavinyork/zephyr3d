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
        /*
        this.$l.xz = pb.mul(
          pb.add(
            this.offset,
            pb.mul(pb.mul(this.modelMatrix, pb.vec4(this.$inputs.position, 1)).xy, this.scale)
          ),
          this.gridScale
        );
        */
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
export function createProgramPostFFT2(
  useComputeShader = false,
  threadGroupSize: number,
  targetFormat: TextureFormat = 'rgba32f',
  limit?: 4 | 2
) {
  function getComputeFunc(useComputeShader: boolean, fmt: TextureFormat) {
    return function (this: PBGlobalScope, pb: ProgramBuilder) {
      this.N2 = pb.float().uniform(0);
      if (useComputeShader) {
        this.output =
          fmt === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
        this.ifft = pb.tex2DArray().uniform(0);
      } else {
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
      }
      if (pb.getDevice().type === 'webgl') {
        this.ifftTexSize = pb.vec2().uniform(0);
      }
      pb.main(function () {
        this.$l.fragPos = getFragCoord(this, useComputeShader);
        this.$l.p = pb.float(pb.add(this.fragPos.x, this.fragPos.y));
        this.$l.s = pb.sub(pb.mul(pb.sub(1, pb.mod(this.p, 2)), 2), 1);
        this.$l.m = pb.mul(this.s, this.N2);
        if (pb.getDevice().type === 'webgl') {
          this.$l.uv = pb.div(pb.vec2(this.fragPos), this.ifftTexSize);
          if (!limit || limit === 4) {
            this.$outputs.dx_hy_dz_dxdz0 = pb.mul(pb.textureSampleLevel(this.ifft0, this.uv, 0), this.m);
            this.$outputs.sx_sz_dxdx_dzdz0 = pb.mul(pb.textureSampleLevel(this.ifft1, this.uv, 0), this.m);
            this.$outputs.dx_hy_dz_dxdz1 = pb.mul(pb.textureSampleLevel(this.ifft2, this.uv, 0), this.m);
            this.$outputs.sx_sz_dxdx_dzdz1 = pb.mul(pb.textureSampleLevel(this.ifft3, this.uv, 0), this.m);
          }
          if (!limit || limit === 2) {
            this.$outputs.dx_hy_dz_dxdz2 = pb.mul(pb.textureSampleLevel(this.ifft4, this.uv, 0), this.m);
            this.$outputs.sx_sz_dxdx_dzdz2 = pb.mul(pb.textureSampleLevel(this.ifft5, this.uv, 0), this.m);
          }
        } else if (useComputeShader) {
          this.$l.uv = pb.ivec2(this.fragPos);
          for (let i = 0; i < 6; i++) {
            pb.textureArrayStore(
              this.output,
              this.$builtins.globalInvocationId.xy,
              i,
              pb.mul(pb.textureArrayLoad(this.ifft, this.uv, i, 0), this.m)
            );
          }
        } else {
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
  program.name = '@Water_PostFFT2';
  return program;
}

/** @internal */
export function createProgramHk(
  useComputeShader = false,
  threadGroupSize = 8,
  targetFormat: TextureFormat = 'rgba32f',
  limit?: 4 | 2
) {
  function getComputeFunc(useComputeShader = false, fmt: TextureFormat) {
    return function (this: PBGlobalScope, pb: ProgramBuilder) {
      if (useComputeShader) {
        this.spectrum =
          fmt === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
      } else {
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
      }
      this.resolution = pb.int().uniform(0);
      this.sizes = pb.vec4().uniform(0);
      this.t = pb.float().uniform(0);
      if (useComputeShader) {
        this.h0Texture = pb.tex2DArray().uniform(0);
      } else {
        if (!limit || limit === 4) {
          this.h0Texture0 = pb.tex2D().uniform(0);
          this.h0Texture1 = pb.tex2D().uniform(0);
        }
        if (!limit || limit === 2) {
          this.h0Texture2 = pb.tex2D().uniform(0);
        }
      }
      if (pb.getDevice().type === 'webgl') {
        this.h0TexSize = pb.vec2().uniform(0);
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
            if (pb.getDevice().type === 'webgl') {
              this.$l.h0Texel = pb.textureSampleLevel(
                this[`h0Texture${x}`],
                pb.div(pb.vec2(this.fragCoord), this.h0TexSize),
                0
              );
            } else if (useComputeShader) {
              this.$l.h0Texel = pb.textureArrayLoad(this.h0Texture, this.fragCoord, x, 0);
            } else {
              this.$l.h0Texel = pb.textureLoad(this[`h0Texture${x}`], this.fragCoord, 0);
            }
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
        this.fragXY = pb.ivec2(getFragCoord(this, useComputeShader));
        this.$l.x = pb.vec2(pb.sub(this.fragXY, pb.ivec2(pb.div(this.resolution, 2))));
        if (useComputeShader || !limit || limit === 4) {
          this.$l.s0 = pb.vec4();
          this.$l.s1 = pb.vec4();
          this.$l.s2 = pb.vec4();
          this.$l.s3 = pb.vec4();
          this.$l.spec0 = this.getSpectrum0(this.x, this.sizes.x, this.fragXY);
          this.$l.spec1 = this.getSpectrum1(this.x, this.sizes.y, this.fragXY);
          this.compressSpectrum(this.spec0, this.s0, this.s1);
          this.compressSpectrum(this.spec1, this.s2, this.s3);
          if (useComputeShader) {
            pb.textureArrayStore(this.spectrum, this.$builtins.globalInvocationId.xy, 0, this.s0);
            pb.textureArrayStore(this.spectrum, this.$builtins.globalInvocationId.xy, 1, this.s1);
            pb.textureArrayStore(this.spectrum, this.$builtins.globalInvocationId.xy, 2, this.s2);
            pb.textureArrayStore(this.spectrum, this.$builtins.globalInvocationId.xy, 3, this.s3);
          } else {
            this.$outputs.spectrum0 = this.s0;
            this.$outputs.spectrum1 = this.s1;
            this.$outputs.spectrum2 = this.s2;
            this.$outputs.spectrum3 = this.s3;
          }
        }
        if (useComputeShader || !limit || limit === 2) {
          this.$l.s4 = pb.vec4();
          this.$l.s5 = pb.vec4();
          this.$l.spec2 = this.getSpectrum2(this.x, this.sizes.z, this.fragXY);
          this.compressSpectrum(this.spec2, this.s4, this.s5);
          if (useComputeShader) {
            pb.textureArrayStore(this.spectrum, this.$builtins.globalInvocationId.xy, 4, this.s4);
            pb.textureArrayStore(this.spectrum, this.$builtins.globalInvocationId.xy, 5, this.s5);
          } else {
            this.$outputs.spectrum4 = this.s4;
            this.$outputs.spectrum5 = this.s5;
          }
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
      pb.func('gauss', [pb.ivec2('fragCoord')], function () {
        this.$l.uv = pb.div(pb.vec2(this.fragCoord), pb.float(this.resolution));
        this.$l.noise0 = pb.textureSampleLevel(this.noise, this.uv, 0).rg;
        this.$l.noise1 = pb.textureSampleLevel(this.noise, pb.neg(this.uv), 0).rg;
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
      pb.func('phillips', [pb.vec2('k'), pb.float('A'), pb.float('minK'), pb.float('maxK')], function () {
        this.$l.k2 = pb.dot(this.k, this.k);
        this.$if(
          pb.or(
            pb.lessThanEqual(this.k2, pb.mul(this.minK, this.minK)),
            pb.greaterThanEqual(this.k2, pb.mul(this.maxK, this.maxK))
          ),
          function () {
            this.$return(pb.vec4(0));
          }
        );
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
        this.$l.rnd = this.gauss(pb.ivec2(getFragCoord(this, useComputeShader)));
        if (useComputeShader) {
          pb.textureArrayStore(
            this.spectrum,
            this.$builtins.globalInvocationId.xy,
            0,
            pb.mul(
              this.phillips(
                pb.div(this.k, this.cascade0.x),
                this.cascade0.y,
                this.cascade0.z,
                this.cascade0.w
              ),
              this.rnd
            )
          );
          pb.textureArrayStore(
            this.spectrum,
            this.$builtins.globalInvocationId.xy,
            1,
            pb.mul(
              this.phillips(
                pb.div(this.k, this.cascade1.x),
                this.cascade1.y,
                this.cascade1.z,
                this.cascade1.w
              ),
              this.rnd
            )
          );
          pb.textureArrayStore(
            this.spectrum,
            this.$builtins.globalInvocationId.xy,
            2,
            pb.mul(
              this.phillips(
                pb.div(this.k, this.cascade2.x),
                this.cascade2.y,
                this.cascade2.z,
                this.cascade2.w
              ),
              this.rnd
            )
          );
        } else {
          this.$outputs.spectrum0 = pb.mul(
            this.phillips(pb.div(this.k, this.cascade0.x), this.cascade0.y, this.cascade0.z, this.cascade0.w),
            this.rnd
          );
          this.$outputs.spectrum1 = pb.mul(
            this.phillips(pb.div(this.k, this.cascade1.x), this.cascade1.y, this.cascade1.z, this.cascade1.w),
            this.rnd
          );
          this.$outputs.spectrum2 = pb.mul(
            this.phillips(pb.div(this.k, this.cascade2.x), this.cascade2.y, this.cascade2.z, this.cascade2.w),
            this.rnd
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
export function createProgramFFT2V(
  useComputeShader = false,
  threadGroupSize: number,
  targetFormat: TextureFormat = 'rgba32f',
  limit?: 4 | 2
) {
  function getComputeFunc(useComputeShader: boolean, fmt: TextureFormat) {
    return function (this: PBGlobalScope, pb: ProgramBuilder) {
      if (useComputeShader) {
        this.spectrum = pb.tex2DArray().sampleType('unfilterable-float').uniform(0);
        this.ifft =
          fmt === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
      } else {
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
      }
      this.butterfly = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      if (pb.getDevice().type === 'webgl') {
        this.texSize = pb.vec4().uniform(0);
      }
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
      pb.func('scale', [Complex('a'), pb.float('v')], function () {
        this.$return(Complex(pb.mul(this.a.re, this.v), pb.mul(this.a.im, this.v)));
      });
      for (let x = 0; x <= 5; x++) {
        if (x < 4 && limit === 2) {
          continue;
        }
        if (x > 3 && limit === 4) {
          continue;
        }
        pb.func(`twiddle${x}`, [pb.vec4('texelButt'), pb.int('x')], function () {
          if (pb.getDevice().type === 'webgl') {
            this.$l.texelA = pb.textureSampleLevel(
              this[`spectrum${x}`],
              pb.div(pb.vec2(pb.float(this.x), this.texelButt.b), this.texSize.xy),
              0
            );
            this.$l.texelB = pb.textureSampleLevel(
              this[`spectrum${x}`],
              pb.div(pb.vec2(pb.float(this.x), this.texelButt.a), this.texSize.xy),
              0
            );
          } else if (useComputeShader) {
            this.$l.texelA = pb.textureArrayLoad(
              this.spectrum,
              pb.ivec2(this.x, pb.int(this.texelButt.b)),
              x,
              0
            );
            this.$l.texelB = pb.textureArrayLoad(
              this.spectrum,
              pb.ivec2(this.x, pb.int(this.texelButt.a)),
              x,
              0
            );
          } else {
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
          }
          this.$l.w = Complex(this.texelButt.r, this.texelButt.g);
          this.$l.a1 = Complex(this.texelA.x, this.texelA.y);
          this.$l.b1 = Complex(this.texelB.x, this.texelB.y);
          this.$l.r1 = this.scale(this.add(this.a1, this.mul(this.b1, this.w)), 0.5);
          this.$l.a2 = Complex(this.texelA.z, this.texelA.w);
          this.$l.b2 = Complex(this.texelB.z, this.texelB.w);
          this.$l.r2 = this.scale(this.add(this.a2, this.mul(this.b2, this.w)), 0.5);
          this.$return(pb.vec4(this.r1.re, this.r1.im, this.r2.re, this.r2.im));
        });
      }
      pb.main(function () {
        this.$l.x = pb.int(getFragCoord(this, useComputeShader).x);
        this.$l.y = pb.int(getFragCoord(this, useComputeShader).y);
        if (pb.getDevice().type === 'webgl') {
          this.$l.texelButt = pb.textureSampleLevel(
            this.butterfly,
            pb.div(pb.vec2(pb.float(this.phase), pb.float(this.y)), this.texSize.zw),
            0
          );
        } else {
          this.$l.texelButt = pb.textureLoad(this.butterfly, pb.ivec2(this.phase, this.y), 0);
        }
        if (useComputeShader) {
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            0,
            this.twiddle0(this.texelButt, this.x)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            1,
            this.twiddle1(this.texelButt, this.x)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            2,
            this.twiddle2(this.texelButt, this.x)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            3,
            this.twiddle3(this.texelButt, this.x)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            4,
            this.twiddle4(this.texelButt, this.x)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            5,
            this.twiddle5(this.texelButt, this.x)
          );
        } else {
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
  program.name = '@Water_PreFFT2';
  return program;
}

/** @internal */
export function createProgramFFT2H(
  useComputeShader = false,
  threadGroupSize: number,
  targetFormat: TextureFormat = 'rgba32f',
  limit?: 4 | 2
) {
  function getComputeFunc(useComputeShader: boolean, fmt: TextureFormat) {
    return function (this: PBGlobalScope, pb: ProgramBuilder) {
      if (useComputeShader) {
        this.spectrum = pb.tex2DArray().sampleType('unfilterable-float').uniform(0);
        this.ifft =
          fmt === 'rgba32f'
            ? pb.texStorage2DArray.rgba32float().storage(0)
            : pb.texStorage2DArray.rgba16float().storage(0);
      } else {
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
      }
      this.butterfly = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.phase = pb.int().uniform(0);
      if (pb.getDevice().type === 'webgl') {
        this.texSize = pb.vec4().uniform(0);
      }
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
      pb.func('scale', [Complex('a'), pb.float('v')], function () {
        this.$return(Complex(pb.mul(this.a.re, this.v), pb.mul(this.a.im, this.v)));
      });
      for (let x = 0; x <= 5; x++) {
        if (x < 4 && limit === 2) {
          continue;
        }
        if (x > 3 && limit === 4) {
          continue;
        }
        pb.func(`twiddle${x}`, [pb.vec4('texelButt'), pb.int('y')], function () {
          if (pb.getDevice().type === 'webgl') {
            this.$l.texelA = pb.textureSampleLevel(
              this[`spectrum${x}`],
              pb.div(pb.vec2(this.texelButt.b, pb.float(this.y)), this.texSize.xy),
              0
            );
            this.$l.texelB = pb.textureSampleLevel(
              this[`spectrum${x}`],
              pb.div(pb.vec2(this.texelButt.a, pb.float(this.y)), this.texSize.xy),
              0
            );
          } else if (useComputeShader) {
            this.$l.texelA = pb.textureArrayLoad(
              this.spectrum,
              pb.ivec2(pb.int(this.texelButt.b), this.y),
              x,
              0
            );
            this.$l.texelB = pb.textureArrayLoad(
              this.spectrum,
              pb.ivec2(pb.int(this.texelButt.a), this.y),
              x,
              0
            );
          } else {
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
          }
          this.$l.w = Complex(this.texelButt.r, this.texelButt.g);
          this.$l.a1 = Complex(this.texelA.x, this.texelA.y);
          this.$l.b1 = Complex(this.texelB.x, this.texelB.y);
          this.$l.r1 = this.scale(this.add(this.a1, this.mul(this.b1, this.w)), 0.5);
          this.$l.a2 = Complex(this.texelA.z, this.texelA.w);
          this.$l.b2 = Complex(this.texelB.z, this.texelB.w);
          this.$l.r2 = this.scale(this.add(this.a2, this.mul(this.b2, this.w)), 0.5);
          this.$return(pb.vec4(this.r1.re, this.r1.im, this.r2.re, this.r2.im));
        });
      }
      pb.main(function () {
        this.$l.x = pb.int(getFragCoord(this, useComputeShader).x);
        this.$l.y = pb.int(getFragCoord(this, useComputeShader).y);
        if (pb.getDevice().type === 'webgl') {
          this.$l.texelButt = pb.textureSampleLevel(
            this.butterfly,
            pb.div(pb.vec2(pb.float(this.phase), pb.float(this.x)), this.texSize.zw),
            0
          );
        } else {
          this.$l.texelButt = pb.textureLoad(this.butterfly, pb.ivec2(this.phase, this.x), 0);
        }
        if (useComputeShader) {
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            0,
            this.twiddle0(this.texelButt, this.y)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            1,
            this.twiddle1(this.texelButt, this.y)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            2,
            this.twiddle2(this.texelButt, this.y)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            3,
            this.twiddle3(this.texelButt, this.y)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            4,
            this.twiddle4(this.texelButt, this.y)
          );
          pb.textureArrayStore(
            this.ifft,
            this.$builtins.globalInvocationId.xy,
            5,
            this.twiddle5(this.texelButt, this.y)
          );
        } else {
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
  program.name = '@Water_FFT2H';
  return program;
}
