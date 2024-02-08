import type { Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { applyMaterialMixins, type IMeshMaterial } from '../meshmaterial';
import { Application } from '../../app';
import { RENDER_PASS_TYPE_FORWARD } from '../../values';
import { mixinTextureProps } from './texture';
import { ShaderFramework } from '../../shaders';
import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  Texture2D
} from '@zephyr3d/device';
import type { DrawContext } from '../../render';

let ggxLut: Texture2D = null;
function getGGXLUT() {
  if (!ggxLut) {
    ggxLut = createGGXLUT(1024);
  }
  return ggxLut;
}
function createGGXLUT(size: number) {
  const device = Application.instance.device;
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        if (device.type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      const SAMPLE_COUNT = 1024;
      if (device.type === 'webgl') {
        pb.func('radicalInverse_VdC', [pb.int('bits')], function () {
          this.$l.rand = pb.float(0);
          this.$l.denom = pb.float(1);
          this.$l.invBase = pb.float(0.5);
          this.$l.n = this.bits;
          this.$for(pb.int('i'), 0, 32, function () {
            this.denom = pb.mul(this.denom, 2);
            this.rand = pb.add(this.rand, pb.div(pb.mod(pb.float(this.n), 2), this.denom));
            this.n = pb.div(this.n, 2);
            this.$if(pb.equal(this.n, 0), function () {
              this.$break();
            });
          });
          this.$return(this.rand);
        });
        pb.func('hammersley2d', [pb.int('i'), pb.int('N')], function () {
          this.$return(pb.vec2(pb.div(pb.float(this.i), pb.float(this.N)), this.radicalInverse_VdC(this.i)));
        });
      } else {
        pb.func('radicalInverse_VdC', [pb.uint('bits')], function () {
          this.$l.n = this.bits;
          this.n = pb.compOr(pb.sal(this.n, 16), pb.sar(this.n, 16));
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x55555555), 1),
            pb.sar(pb.compAnd(this.n, 0xaaaaaaaa), 1)
          );
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x33333333), 2),
            pb.sar(pb.compAnd(this.n, 0xcccccccc), 2)
          );
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x0f0f0f0f), 4),
            pb.sar(pb.compAnd(this.n, 0xf0f0f0f0), 4)
          );
          this.n = pb.compOr(
            pb.sal(pb.compAnd(this.n, 0x00ff00ff), 8),
            pb.sar(pb.compAnd(this.n, 0xff00ff00), 8)
          );
          this.$return(pb.mul(pb.float(this.n), 2.3283064365386963e-10));
        });
        pb.func('hammersley2d', [pb.int('i'), pb.int('N')], function () {
          this.$return(
            pb.vec2(pb.div(pb.float(this.i), pb.float(this.N)), this.radicalInverse_VdC(pb.uint(this.i)))
          );
        });
      }
      pb.func('generateTBN', [pb.vec3('normal')], function () {
        this.$l.bitangent = pb.vec3(0, 1, 0);
        this.$l.NoU = this.normal.y;
        this.$l.epsl = 0.0000001;
        this.$if(pb.lessThanEqual(pb.sub(1, pb.abs(this.normal.y)), this.epsl), function () {
          this.bitangent = this.$choice(
            pb.greaterThan(this.normal.y, 0),
            pb.vec3(0, 0, 1),
            pb.vec3(0, 0, -1)
          );
        });
        this.$l.tangent = pb.normalize(pb.cross(this.bitangent, this.normal));
        this.bitangent = pb.cross(this.normal, this.tangent);
        this.$return(pb.mat3(this.tangent, this.bitangent, this.normal));
      });
      pb.func('D_Charlie', [pb.float('sheenRoughness'), pb.float('NdotH')], function () {
        this.$l.roughness = pb.max(this.sheenRoughness, 0.000001);
        this.$l.invR = pb.div(1, this.roughness);
        this.$l.cos2h = pb.mul(this.NdotH, this.NdotH);
        this.$l.sin2h = pb.sub(1, this.cos2h);
        this.$return(
          pb.div(pb.mul(pb.add(this.invR, 2), pb.pow(this.sin2h, pb.mul(this.invR, 0.5))), Math.PI * 2)
        );
      });
      pb.func('smithGGXCorrelated', [pb.float('NoV'), pb.float('NoL'), pb.float('roughness')], function () {
        this.$l.a2 = pb.mul(this.roughness, this.roughness, this.roughness, this.roughness);
        this.$l.GGXV = pb.mul(
          this.NoL,
          pb.sqrt(pb.add(pb.mul(this.NoV, this.NoV, pb.sub(1, this.a2)), this.a2))
        );
        this.$l.GGXL = pb.mul(
          this.NoV,
          pb.sqrt(pb.add(pb.mul(this.NoL, this.NoL, pb.sub(1, this.a2)), this.a2))
        );
        this.$return(pb.div(0.5, pb.add(this.GGXV, this.GGXL)));
      });
      pb.func('V_Ashikhmin', [pb.float('NdotL'), pb.float('NdotV')], function () {
        this.$return(
          pb.clamp(
            pb.div(1, pb.mul(pb.sub(pb.add(this.NdotL, this.NdotV), pb.mul(this.NdotL, this.NdotV)), 4)),
            0,
            1
          )
        );
      });
      pb.func(
        'importanceSample',
        [
          pb.vec2('xi'),
          pb.vec3('normal'),
          pb.float('roughness'),
          pb.vec3('ggx').out(),
          pb.vec3('charlie').out()
        ],
        function () {
          this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
          this.$l.cosTheta = pb.clamp(
            pb.sqrt(
              pb.div(
                pb.sub(1, this.xi.y),
                pb.add(1, pb.mul(pb.sub(pb.mul(this.alphaRoughness, this.alphaRoughness), 1), this.xi.y))
              )
            ),
            0,
            1
          );
          this.$l.sinTheta = pb.sqrt(pb.sub(1, pb.mul(this.cosTheta, this.cosTheta)));
          this.$l.phi = pb.mul(this.xi.x, Math.PI * 2);
          this.$l.TBN = this.generateTBN(this.normal);
          this.$l.localSpaceDir = pb.normalize(
            pb.vec3(
              pb.mul(this.sinTheta, pb.cos(this.phi)),
              pb.mul(this.sinTheta, pb.sin(this.phi)),
              this.cosTheta
            )
          );
          this.ggx = pb.mul(this.TBN, this.localSpaceDir);
          this.sinTheta = pb.pow(
            this.xi.y,
            pb.div(this.alphaRoughness, pb.add(pb.mul(this.alphaRoughness, 2), 1))
          );
          this.cosTheta = pb.sqrt(pb.sub(1, pb.mul(this.sinTheta, this.sinTheta)));
          this.localSpaceDir = pb.normalize(
            pb.vec3(
              pb.mul(this.sinTheta, pb.cos(this.phi)),
              pb.mul(this.sinTheta, pb.sin(this.phi)),
              this.cosTheta
            )
          );
          this.charlie = pb.mul(this.TBN, this.localSpaceDir);
        }
      );
      pb.func('integrateBRDF', [pb.float('NoV'), pb.float('roughness')], function () {
        this.$l.V = pb.vec3(pb.sub(1, pb.mul(this.NoV, this.NoV)), 0, this.NoV);
        this.$l.a = pb.float(0);
        this.$l.b = pb.float(0);
        this.$l.c = pb.float(0);
        this.$l.n = pb.vec3(0, 0, 1);
        this.$for(pb.int('i'), 0, SAMPLE_COUNT, function () {
          this.$l.xi = this.hammersley2d(this.i, SAMPLE_COUNT);
          this.$l.ggxSample = pb.vec3();
          this.$l.charlieSample = pb.vec3();
          this.importanceSample(this.xi, this.n, this.roughness, this.ggxSample, this.charlieSample);
          this.$l.ggxL = pb.normalize(pb.reflect(pb.neg(this.V), this.ggxSample.xyz));
          this.$l.ggxNoL = pb.clamp(this.ggxL.z, 0, 1);
          this.$l.ggxNoH = pb.clamp(this.ggxSample.z, 0, 1);
          this.$l.ggxVoH = pb.clamp(pb.dot(this.V, this.ggxSample.xyz), 0, 1);
          this.$l.charlieL = pb.normalize(pb.reflect(pb.neg(this.V), this.charlieSample.xyz));
          this.$l.charlieNoL = pb.clamp(this.charlieL.z, 0, 1);
          this.$l.charlieNoH = pb.clamp(this.charlieSample.z, 0, 1);
          this.$l.charlieVoH = pb.clamp(pb.dot(this.V, this.charlieSample.xyz), 0, 1);
          this.$if(pb.greaterThan(this.ggxNoL, 0), function () {
            this.$l.pdf = pb.div(
              pb.mul(
                this.smithGGXCorrelated(this.NoV, this.ggxNoL, this.roughness),
                this.ggxVoH,
                this.ggxNoL
              ),
              this.ggxNoH
            );
            this.$l.Fc = pb.pow(pb.sub(1, this.ggxVoH), 5);
            this.a = pb.add(this.a, pb.mul(pb.sub(1, this.Fc), this.pdf));
            this.b = pb.add(this.b, pb.mul(this.Fc, this.pdf));
          });
          this.$if(pb.greaterThan(this.charlieNoL, 0), function () {
            this.$l.sheenDistribution = this.D_Charlie(this.roughness, this.charlieNoH);
            this.$l.sheenVis = this.V_Ashikhmin(this.charlieNoL, this.NoV);
            this.c = pb.add(
              this.c,
              pb.mul(this.sheenVis, this.sheenDistribution, this.charlieNoL, this.charlieVoH)
            );
          });
        });
        this.$return(
          pb.div(pb.vec3(pb.mul(this.a, 4), pb.mul(this.b, 4), pb.mul(this.c, 8 * Math.PI)), SAMPLE_COUNT)
        );
      });
      pb.main(function () {
        this.$outputs.color = pb.vec4(this.integrateBRDF(this.$inputs.uv.x, this.$inputs.uv.y), 1);
      });
    }
  });
  const vertexLayout = device.createVertexLayout({
    vertexBuffers: [
      { buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])) }
    ]
  });
  const rs = device.createRenderStateSet();
  rs.useRasterizerState().setCullMode('none');
  rs.useDepthState().enableTest(false).enableWrite(false);
  const tex = device.createTexture2D('rgba8unorm', size, size, { samplerOptions: { mipFilter: 'none' } });
  tex.name = 'GGXLUT';
  const fb = device.createFrameBuffer([tex], null);
  device.pushDeviceStates();
  device.setProgram(program);
  device.setVertexLayout(vertexLayout);
  device.setRenderStates(rs);
  device.setFramebuffer(fb);
  device.draw('triangle-strip', 0, 4);
  device.popDeviceStates();
  fb.dispose();
  vertexLayout.dispose();
  program.dispose();
  return tex;
}

export interface IMixinPBR {
  ior: number;
  occlusionStrength: number;
  clearcoat: boolean;
  clearcoatIntensity: number;
  clearcoatRoughnessFactor: number;
  clearcoatNormalScale: number;
  sheen: boolean;
  sheenColorFactor: Vector3;
  sheenRoughnessFactor: number;
  sheenLut: Texture2D;
}

export type PBRTextureNames = [
  'occlusion',
  'cheenColor',
  'sheenRoughness',
  'clearcoatIntensity',
  'clearcoatNormal',
  'clearcoatRoughness'
];
export type PBRToMixedTextureType<T> = T extends [infer First, ...infer Rest]
  ? [
      First extends string ? ReturnType<typeof mixinTextureProps<First>> : never,
      ...PBRToMixedTextureType<Rest>
    ]
  : [];

export type TT = ReturnType<
  typeof applyMaterialMixins<PBRToMixedTextureType<PBRTextureNames>, { new (...args: any[]): IMeshMaterial }>
>;

function mixinPBR<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).pbrMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinPBR } & TT;
  }
  const S = applyMaterialMixins(
    BaseCls as { new (...args: any[]): IMeshMaterial },
    mixinTextureProps('occlusion'),
    mixinTextureProps('sheenColor'),
    mixinTextureProps('sheenRoughness'),
    mixinTextureProps('clearcoatIntensity'),
    mixinTextureProps('clearcoatNormal'),
    mixinTextureProps('clearcoatRoughness')
  );
  const FEATURE_PBR_CLEARCOAT = 'FEATURE_PBR_CLEARCOAT';
  const FEATURE_PBR_SHEEN = 'FEATURE_PBR_SHEEN';
  const FEATURE_PBR_SHEEN_USE_LUT = 'FEATURE_PBR_SHEEN_USE_LUT';
  return class extends S {
    static pbrMixed = true;
    private static ggxLut: Texture2D = null;
    private _f0: Vector4;
    private _occlusionStrength: number;
    private _sheenFactor: Vector4;
    private _sheenLut: Texture2D;
    private _clearcoatFactor: Vector4;
    constructor(...args: any[]) {
      super(...args);
      this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
      this._sheenFactor = Vector4.zero();
      this._sheenLut = null;
      this._clearcoatFactor = new Vector4(0, 0, 1, 0);
      this._occlusionStrength = 1;
    }
    /** ior value */
    get ior(): number {
      return this._f0.w;
    }
    set ior(val: number) {
      if (val !== this._f0.w) {
        let k = (val - 1) / (val + 1);
        k *= k;
        this._f0.setXYZW(k, k, k, val);
        this.optionChanged(false);
      }
    }
    /** occlusion strength */
    get occlusionStrength(): number {
      return this._occlusionStrength;
    }
    set occlusionStrength(val: number) {
      if (this._occlusionStrength !== val) {
        this._occlusionStrength = val;
        this.optionChanged(false);
      }
    }
    get clearcoat(): boolean {
      return this.featureUsed(FEATURE_PBR_CLEARCOAT, RENDER_PASS_TYPE_FORWARD);
    }
    set clearcoat(val: boolean) {
      this.useFeature(FEATURE_PBR_CLEARCOAT, !!val);
    }
    /** Intensity of clearcoat lighting */
    get clearcoatIntensity(): number {
      return this._clearcoatFactor.x;
    }
    set clearcoatIntensity(val: number) {
      if (val !== this._clearcoatFactor.x) {
        this._clearcoatFactor.x = val;
        this.optionChanged(false);
      }
    }
    /** Roughness factor of clearcoat lighting */
    get clearcoatRoughnessFactor(): number {
      return this._clearcoatFactor.y;
    }
    set clearcoatRoughnessFactor(val: number) {
      if (val !== this._clearcoatFactor.y) {
        this._clearcoatFactor.y = val;
        this.optionChanged(false);
      }
    }
    /** Normal scale of clearcoat lighting */
    get clearcoatNormalScale(): number {
      return this._clearcoatFactor.z;
    }
    set clearcoatNormalScale(val: number) {
      if (val !== this._clearcoatFactor.z) {
        this._clearcoatFactor.z = val;
        this.optionChanged(false);
      }
    }
    /** true if sheen lighting is being used */
    get sheen(): boolean {
      return this.featureUsed(FEATURE_PBR_SHEEN, RENDER_PASS_TYPE_FORWARD);
    }
    set sheen(val: boolean) {
      this.useFeature(FEATURE_PBR_SHEEN, !!val);
    }
    /** Color factor for sheen lighting */
    get sheenColorFactor(): Vector3 {
      return this._sheenFactor.xyz();
    }
    set sheenColorFactor(val: Vector3) {
      if (val.x !== this._sheenFactor.x || val.y !== this._sheenFactor.y || val.z !== this._sheenFactor.z) {
        this._sheenFactor.x = val.x;
        this._sheenFactor.y = val.y;
        this._sheenFactor.z = val.z;
        this.optionChanged(false);
      }
    }
    /** Roughness factor for sheen lighting */
    get sheenRoughnessFactor(): number {
      return this._sheenFactor.w;
    }
    set sheenRoughnessFactor(val: number) {
      if (val !== this._sheenFactor.w) {
        this._sheenFactor.w = val;
        this.optionChanged(false);
      }
    }
    /** Lut texture for sheen lighting */
    get sheenLut(): Texture2D {
      return this._sheenLut;
    }
    set sheenLut(tex: Texture2D) {
      if (this._sheenLut !== tex) {
        this._sheenLut = tex;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_USE_LUT, !!this._sheenLut);
          this.optionChanged(false);
        }
      }
    }
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
        if (ctx.drawEnvLight) {
          scope.$g.kkGGXLut = pb.tex2D().uniform(2);
        }
        scope.$g.kkF0 = scope.$builder.vec4().uniform(2);
        if (this.occlusionTexture) {
          scope.$g.kkOcclusionStrength = pb.float().uniform(2);
        }
        if (this.sheen) {
          scope.$g.kkSheenFactor = pb.vec4().uniform(2);
        }
        if (this.clearcoat) {
          scope.$g.kkClearcoatFactor = pb.vec4().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('kkGGXLut', getGGXLUT());
        }
        bindGroup.setValue('kkF0', this._f0);
        if (this.occlusionTexture) {
          bindGroup.setValue(
            'kkOcclusionStrength',
            this._occlusionStrength < 0 ? 0 : this._occlusionStrength > 1 ? 1 : this._occlusionStrength
          );
        }
        if (this.sheen) {
          bindGroup.setValue('kkSheenFactor', this._sheenFactor);
        }
        if (this.clearcoat) {
          bindGroup.setValue('kkClearcoatFactor', this._clearcoatFactor);
        }
      }
    }
    getSurfaceDataStructType(pb: ProgramBuilder, ctx: DrawContext) {
      return pb.defineStruct([
        pb.vec4('diffuse'),
        pb.vec4('normal'),
        pb.vec3('viewVec'),
        pb.float('NdotV'),
        pb.mat3('TBN'),
        pb.float('f0'),
        pb.float('f90'),
        pb.float('occlusion'),
        pb.vec3('radiance'),
        pb.vec3('irradiance'),
        ...(ctx.drawEnvLight ? [pb.vec4('ggxLutSample')] : []),
        ...(this.clearcoat
          ? [
              pb.vec4('clearcoatFactor'),
              pb.vec3('clearcoatNormal'),
              pb.float('clearcoatNdotV'),
              pb.float('clearcoatFresnel')
            ]
          : [])
      ]);
    }
    fillSurfaceData(scope: PBInsideFunctionScope, surfaceData: PBShaderExp) {}
    getF0(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.kkF0;
    }
    getF90(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.$builder.vec3(1);
    }
    calculateOcclusion(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      const envStrength = ShaderFramework.getEnvLightStrength(scope);
      if (this.occlusionTexture) {
        const strength = scope.kkOcclusionStrength;
        const texCoord = this.getOcclusionTexCoord(scope);
        const texture = this.getOcclusionTextureUniform(scope);
        return pb.mul(pb.mix(pb.sub(1, strength), 1, pb.textureSample(texture, texCoord).r), envStrength);
      } else {
        return envStrength;
      }
    }
    calculateClearcoatFactor(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      const clearcoatIntensityFactor = this.clearcoatIntensityTexture
        ? pb.textureSample(
            this.getClearcoatIntensityTextureUniform(scope),
            this.getClearcoatIntensityTexCoord(scope)
          ).r
        : pb.float(1);
      const clearcoatRoughnessFactor = this.clearcoatRoughnessTexture
        ? pb.textureSample(
            this.getClearcoatRoughnessTextureUniform(scope),
            this.getClearcoatRoughnessTexCoord(scope)
          ).g
        : pb.float(1);
      return pb.vec4(
        pb.mul(scope.kkClearcoatFactor.x, clearcoatIntensityFactor),
        pb.clamp(pb.mul(scope.kkClearcoatFactor.y, clearcoatRoughnessFactor), 0, 1),
        scope.kkClearcoatFactor.z,
        1
      );
    }
    calculateClearcoatNormalAndNoV(
      scope: PBInsideFunctionScope,
      TBN: PBShaderExp,
      viewVec: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      if (this.clearcoatNormalTexture) {
        const normalSample = pb.sub(
          pb.mul(
            pb.textureSample(
              this.getClearcoatNormalTextureUniform(scope),
              this.getClearcoatNormalTexCoord(scope)
            ).rgb,
            2
          ),
          pb.vec3(1)
        );
        const factor = pb.vec3(scope.kkClearcoatFactor.zz, 1);
        const normal = pb.normalize(pb.mul(TBN, pb.mul(normalSample, factor)));
        const NoV = pb.clamp(pb.dot(normal, viewVec), 0.0001, 1);
        return pb.vec4(normal, NoV);
      } else {
        const normal = TBN[2];
        const NoV = pb.clamp(pb.dot(normal, viewVec), 0.0001, 1);
        return pb.vec4(normal, NoV);
      }
    }
    sampleGGXLut(scope: PBInsideFunctionScope, NoV: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      return pb.clamp(pb.textureSample(scope.kkGGXLut, pb.vec2(NoV, roughness)), pb.vec4(0), pb.vec4(1));
    }
    calculateSpecularIBL(
      scope: PBInsideFunctionScope,
      brdf: PBShaderExp,
      f0: PBShaderExp,
      radiance: PBShaderExp,
      NoV: PBShaderExp,
      roughness: PBShaderExp,
      specularWeight: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkPBRCalcSpecularIBL';
      pb.func(
        funcName,
        [
          pb.vec4('brdf'),
          pb.vec3('f0'),
          pb.vec3('radiance'),
          pb.float('NdotV'),
          pb.float('roughness'),
          pb.float('specularWeight')
        ],
        function () {
          this.$l.f_ab = this.brdf.rg;
          this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
          this.$l.k_S = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NdotV), 5)));
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
          this.$return(pb.mul(this.radiance, this.FssEss, this.specularWeight));
        }
      );
      return pb.getGlobalScope()[funcName](brdf, f0, radiance, NoV, roughness, specularWeight);
    }
    calculateDiffuseIBL(
      scope: PBInsideFunctionScope,
      brdf: PBShaderExp,
      f0: PBShaderExp,
      diffuse: PBShaderExp,
      irradiance: PBShaderExp,
      NoV: PBShaderExp,
      roughness: PBShaderExp,
      specularWeight: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkPBRCalcDiffuseIBL';
      pb.func(
        funcName,
        [
          pb.vec4('brdf'),
          pb.vec3('f0'),
          pb.vec3('diffuse'),
          pb.vec3('irradiance'),
          pb.float('NdotV'),
          pb.float('roughness'),
          pb.float('specularWeight')
        ],
        function () {
          this.$l.f_ab = this.brdf.rg;
          this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
          this.$l.k_S = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NdotV), 5)));
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x, this.specularWeight), pb.vec3(this.f_ab.y));
          this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
          this.$l.F_avg = pb.mul(
            pb.add(this.f0, pb.div(pb.sub(pb.vec3(1), this.f0), 21)),
            this.specularWeight
          );
          this.$l.FmsEms = pb.div(
            pb.mul(this.FssEss, this.F_avg, this.Ems),
            pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems))
          );
          this.$l.k_D = pb.mul(this.diffuse, pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms));
          this.$return(pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance));
        }
      );
      return pb.getGlobalScope()[funcName](brdf, f0, diffuse, irradiance, NoV, roughness, specularWeight);
    }
  } as unknown as { new (...args: any[]): T & IMixinPBR } & TT;
}

export { mixinPBR };
