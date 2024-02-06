import { Matrix4x4, Vector3, Vector4 } from "@zephyr3d/base";
import type { IMeshMaterial } from "../meshmaterial";
import type { AbstractDevice, BindGroup, PBFunctionScope, PBGlobalScope, PBInsideFunctionScope, PBShaderExp, Texture2D, TextureSampler } from "@zephyr3d/device";
import type { DrawContext } from "../../render";
import { Application } from "../../app";
import { RENDER_PASS_TYPE_FORWARD } from "../../values";

export interface IMixinPBR {
}

function mixinPBR<T extends IMeshMaterial>(BaseCls: { new(...args: any[]): T }) {
  if ((BaseCls as any).pbrMixed) {
    return BaseCls as { new(...args: any[]): T & IMixinPBR };
  }
  const FEATURE_PBR_OCCLUSION = 'z-feature-pbr-occlusion';
  const FEATURE_PBR_OCCLUSION_TEXCOORD_INDEX = 'z-feature-pbr-occlusion-texcoord-index';
  const FEATURE_PBR_OCCLUSION_TEX_MATRIX = 'z-feature-pbr-occlusion-tex-matrix';
  const FEATURE_PBR_SHEEN = 'z-feature-pbr-sheen';
  const FEATURE_PBR_SHEEN_USE_LUT = 'z-feature-pbr-sheen-use-lut';
  const FEATURE_PBR_SHEEN_COLOR_MAP = 'z-feature-pbr-sheen-color-map';
  const FEATURE_PBR_SHEEN_COLOR_TEXCOORD_INDEX = 'z-feature-pbr-occlusion-texcoord-index';
  const FEATURE_PBR_SHEEN_COLOR_TEX_MATRIX = 'z-feature-pbr-occlusion-tex-matrix';
  const FEATURE_PBR_SHEEN_ROUGHNESS_MAP = 'z-feature-pbr-sheen-roughness-map';
  const FEATURE_PBR_SHEEN_ROUGHNESS_TEXCOORD_INDEX = 'z-feature-pbr-sheen-roughness-texcoord-index';
  const FEATURE_PBR_SHEEN_ROUGHNESS_TEX_MATRIX = 'z-feature-pbr-sheen-roughness-tex-matrix';
  const FEATURE_PBR_CLEARCOAT = 'z-feature-pbr-clearcoat';
  const FEATURE_PBR_CLEARCOAT_INTENSITY_MAP = 'z-feature-pbr-clearcoat-intensity-map';
  const FEATURE_PBR_CLEARCOAT_INTENSITY_TEXCOORD_INDEX = 'z-feature-pbr-clearcoat-intensity-texcoord-index';
  const FEATURE_PBR_CLEARCOAT_INTENSITY_TEX_MATRIX = 'z-feature-pbr-clearcoat-intensity-tex-matrix';
  const FEATURE_PBR_CLEARCOAT_NORMAL_MAP = 'z-feature-pbr-clearcoat-normal-map';
  const FEATURE_PBR_CLEARCOAT_NORMAL_TEXCOORD_INDEX = 'z-feature-pbr-clearcoat-normal-texcoord-index';
  const FEATURE_PBR_CLEARCOAT_NORMAL_TEX_MATRIX = 'z-feature-pbr-clearcoat-normal-tex-matrix';
  const FEATURE_PBR_CLEARCOAT_ROUGHNESS_MAP = 'z-feature-pbr-clearcoat-roughness-map';
  const FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEXCOORD_INDEX = 'z-feature-pbr-clearcoat-roughness-texcoord-index';
  const FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEX_MATRIX = 'z-feature-pbr-clearcoat-roughness-tex-matrix';
  return class extends (BaseCls as { new(...args: any[]): IMeshMaterial }) {
    static pbrMixed = true;
    private static ggxLut: Texture2D = null;
    private _f0: Vector4;
    private _occlusionStrength: number;
    private _sheenFactor: Vector4;
    private _sheenLut: Texture2D;
    private _sheenColorMap: Texture2D;
    private _sheenColorMapSampler: TextureSampler;
    private _sheenColorTexCoordIndex: number;
    private _sheenColorTexMatrix: Matrix4x4;
    private _sheenRoughnessMap: Texture2D;
    private _sheenRoughnessMapSampler: TextureSampler;
    private _sheenRoughnessTexCoordIndex: number;
    private _sheenRoughnessTexMatrix: Matrix4x4;
    private _clearcoatFactor: Vector4;
    private _ccIntensityMap: Texture2D;
    private _ccIntensityMapSampler: TextureSampler;
    private _ccIntensityTexCoordIndex: number;
    private _ccIntensityTexMatrix: Matrix4x4;
    private _ccNormalMap: Texture2D;
    private _ccNormalMapSampler: TextureSampler;
    private _ccNormalTexCoordIndex: number;
    private _ccNormalTexMatrix: Matrix4x4;
    private _ccRoughnessMap: Texture2D;
    private _ccRoughnessMapSampler: TextureSampler;
    private _ccRoughnessTexCoordIndex: number;
    private _ccRoughnessTexMatrix: Matrix4x4;
    private _occlusionMap: Texture2D;
    private _occlusionMapSampler: TextureSampler;
    private _occlusionTexCoordIndex: number;
    private _occlusionTexMatrix: Matrix4x4;
    constructor(...args: any[]) {
      super(...args);
      this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
      this._sheenFactor = Vector4.zero();
      this._sheenLut = null;
      this._sheenColorMap = null;
      this._sheenColorMapSampler = null;
      this._sheenColorTexCoordIndex = 0;
      this._sheenColorTexMatrix = null;
      this._sheenRoughnessMap = null;
      this._sheenRoughnessMapSampler = null;
      this._sheenRoughnessTexCoordIndex = 0;
      this._sheenRoughnessTexMatrix = null;
      this._clearcoatFactor = new Vector4(0, 0, 1, 0);
      this._ccIntensityMap = null;
      this._ccIntensityMapSampler = null;
      this._ccIntensityTexCoordIndex = 0;
      this._ccIntensityTexMatrix = null;
      this._ccNormalMap = null;
      this._ccNormalMapSampler = null;
      this._ccNormalTexCoordIndex = 0;
      this._ccNormalTexMatrix = null;
      this._ccRoughnessMap = null;
      this._ccRoughnessMapSampler = null;
      this._ccRoughnessTexCoordIndex = 0;
      this._ccRoughnessTexMatrix = null;
      this._occlusionStrength = 1;
      this._occlusionMap = null;
      this._occlusionMapSampler = null;
      this._occlusionTexCoordIndex = 0;
      this._occlusionTexMatrix = null;
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
        if (this.occlusionMap) {
          this.optionChanged(false);
        }
      }
    }
    /** The occlusion texture */
    get occlusionMap(): Texture2D {
      return this._occlusionMap;
    }
    set occlusionMap(tex: Texture2D) {
      if (tex !== this._occlusionMap) {
        this._occlusionMap = tex ?? null;
        this.useFeature(FEATURE_PBR_OCCLUSION, !!this._occlusionMap);
        if (this._occlusionMap) {
          this.useFeature(FEATURE_PBR_OCCLUSION_TEXCOORD_INDEX, this._occlusionTexCoordIndex);
          this.useFeature(FEATURE_PBR_OCCLUSION_TEX_MATRIX, !!this._occlusionTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** Occlusion texture sampler */
    get occlusionTextureSampler(): TextureSampler {
      return this._occlusionMapSampler;
    }
    set occlusionTextureSampler(sampler: TextureSampler) {
      this._occlusionMapSampler = sampler ?? null;
    }
    /** Occlusion texture coordinate index */
    get occlusionTexCoordIndex(): number {
      return this._occlusionTexCoordIndex;
    }
    set occlusionTexCoordIndex(val: number) {
      if (val !== this._occlusionTexCoordIndex) {
        this._occlusionTexCoordIndex = val;
        if (this._occlusionMap) {
          this.useFeature(FEATURE_PBR_OCCLUSION_TEXCOORD_INDEX, this._occlusionTexCoordIndex);
        }
      }
    }
    /** Occlusion texture coordinate transform matrix */
    get occlusionTexMatrix(): Matrix4x4 {
      return this._occlusionTexMatrix;
    }
    set occlusionTexMatrix(val: Matrix4x4) {
      if (val !== this._occlusionTexMatrix) {
        this._occlusionTexMatrix = val;
        if (this._occlusionMap) {
          this.useFeature(FEATURE_PBR_OCCLUSION_TEX_MATRIX, !!this._occlusionTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    get clearcoat(): boolean {
      return this.featureUsed(FEATURE_PBR_CLEARCOAT, RENDER_PASS_TYPE_FORWARD);
    }
    set clearcoat(val: boolean) {
      this.useFeature(FEATURE_PBR_CLEARCOAT, !!val);
      if (!!val) {
        this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_MAP, !!this._ccIntensityMap);
        if (this._ccIntensityMap) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_TEXCOORD_INDEX, this._ccIntensityTexCoordIndex);
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_TEX_MATRIX, !!this._ccIntensityTexMatrix);
        }
        this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_MAP, !!this._ccNormalMap);
        if (this._ccNormalMap) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_TEXCOORD_INDEX, this._ccNormalTexCoordIndex);
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_TEX_MATRIX, !!this._ccNormalTexMatrix);
        }
        this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_MAP, !!this._ccRoughnessMap);
        if (this._ccRoughnessMap) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEXCOORD_INDEX, this._ccRoughnessTexCoordIndex);
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEX_MATRIX, !!this._ccRoughnessTexMatrix);
        }
      }
    }
    /** Intensity of clearcoat lighting */
    get clearcoatIntensity(): number {
      return this._clearcoatFactor.x;
    }
    set clearcoatIntensity(val: number) {
      if (val !== this._clearcoatFactor.x) {
        this._clearcoatFactor.x = val;
        if (this.clearcoat) {
          this.optionChanged(false);
        }
      }
    }
    /** Roughness factor of clearcoat lighting */
    get clearcoatRoughnessFactor(): number {
      return this._clearcoatFactor.y;
    }
    set clearcoatRoughnessFactor(val: number) {
      if (val !== this._clearcoatFactor.y) {
        this._clearcoatFactor.y = val;
        if (this.clearcoat) {
          this.optionChanged(false);
        }
      }
    }
    /** Normal scale of clearcoat lighting */
    get clearcoatNormalScale(): number {
      return this._clearcoatFactor.z;
    }
    set clearcoatNormalScale(val: number) {
      if (val !== this._clearcoatFactor.z) {
        this._clearcoatFactor.z = val;
        if (this.clearcoat) {
          this.optionChanged(false);
        }
      }
    }
    /** The clearcoat intensity texture */
    get clearcoatIntensityMap(): Texture2D {
      return this._ccIntensityMap;
    }
    set clearcoatIntensityMap(tex: Texture2D) {
      if (tex !== this._ccIntensityMap) {
        this._ccIntensityMap = tex ?? null;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_MAP, !!this._ccIntensityMap);
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_TEXCOORD_INDEX, this._ccIntensityTexCoordIndex);
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_TEX_MATRIX, !!this._ccIntensityTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** Sheen texture sampler */
    get clearcoatIntensitySampler(): TextureSampler {
      return this._ccIntensityMapSampler;
    }
    set clearcoatIntensitySampler(sampler: TextureSampler) {
      this._ccIntensityMapSampler = sampler ?? null;
    }
    /** Sheen color texture coordinate index */
    get clearcoatIntensityTexCoordIndex(): number {
      return this._ccIntensityTexCoordIndex;
    }
    set clearcoatIntensityTexCoordIndex(val: number) {
      if (val !== this._ccIntensityTexCoordIndex) {
        this._ccIntensityTexCoordIndex = val;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_TEXCOORD_INDEX, this._ccIntensityTexCoordIndex);
        }
      }
    }
    /** Sheen color texture coordinate transform matrix */
    get clearcoatIntensityTexMatrix(): Matrix4x4 {
      return this._ccIntensityTexMatrix;
    }
    set clearcoatIntensityTexMatrix(val: Matrix4x4) {
      if (val !== this._ccIntensityTexMatrix) {
        this._ccIntensityTexMatrix = val;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_INTENSITY_TEX_MATRIX, !!this._ccIntensityTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** The clearcoat normal texture */
    get clearcoatNormalMap(): Texture2D {
      return this._ccNormalMap;
    }
    set clearcoatNormalMap(tex: Texture2D) {
      if (tex !== this._ccNormalMap) {
        this._ccNormalMap = tex ?? null;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_MAP, !!this._ccNormalMap);
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_TEXCOORD_INDEX, this._ccNormalTexCoordIndex);
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_TEX_MATRIX, !!this._ccNormalTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** clearcoat normal texture sampler */
    get clearcoatNormalSampler(): TextureSampler {
      return this._ccNormalMapSampler;
    }
    set clearcoatNormalSampler(sampler: TextureSampler) {
      this._ccNormalMapSampler = sampler ?? null;
    }
    /** clearcoat normal texture coordinate index */
    get clearcoatNormalTexCoordIndex(): number {
      return this._ccNormalTexCoordIndex;
    }
    set clearcoatNormalTexCoordIndex(val: number) {
      if (val !== this._ccNormalTexCoordIndex) {
        this._ccNormalTexCoordIndex = val;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_TEXCOORD_INDEX, this._ccNormalTexCoordIndex);
        }
      }
    }
    /** clearcoat normal texture coordinate transform matrix */
    get clearcoatNormalTexMatrix(): Matrix4x4 {
      return this._ccNormalTexMatrix;
    }
    set clearcoatNormalTexMatrix(val: Matrix4x4) {
      if (val !== this._ccNormalTexMatrix) {
        this._ccNormalTexMatrix = val;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_NORMAL_TEX_MATRIX, !!this._ccNormalTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** The clearcoat roughness texture */
    get clearcoatRoughnessMap(): Texture2D {
      return this._ccRoughnessMap;
    }
    set clearcoatRoughnessMap(tex: Texture2D) {
      if (tex !== this._ccRoughnessMap) {
        this._ccRoughnessMap = tex ?? null;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_MAP, !!this._ccRoughnessMap);
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEXCOORD_INDEX, this._ccRoughnessTexCoordIndex);
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEX_MATRIX, !!this._ccRoughnessTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** clearcoat roughness texture sampler */
    get clearcoatRoughnessSampler(): TextureSampler {
      return this._ccRoughnessMapSampler;
    }
    set clearcoatRoughnessSampler(sampler: TextureSampler) {
      this._ccRoughnessMapSampler = sampler ?? null;
    }
    /** clearcoat roughness texture coordinate index */
    get clearcoatRoughnessTexCoordIndex(): number {
      return this._ccRoughnessTexCoordIndex;
    }
    set clearcoatRoughnessTexCoordIndex(val: number) {
      if (val !== this._ccRoughnessTexCoordIndex) {
        this._ccRoughnessTexCoordIndex = val;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEXCOORD_INDEX, this._ccRoughnessTexCoordIndex);
        }
      }
    }
    /** clearcoat roughness texture coordinate transform matrix */
    get clearcoatRoughnessTexMatrix(): Matrix4x4 {
      return this._ccRoughnessTexMatrix;
    }
    set clearcoatRoughnessTexMatrix(val: Matrix4x4) {
      if (val !== this._ccRoughnessTexMatrix) {
        this._ccRoughnessTexMatrix = val;
        if (this.clearcoat) {
          this.useFeature(FEATURE_PBR_CLEARCOAT_ROUGHNESS_TEX_MATRIX, !!this._ccRoughnessTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** true if clearcoat is being used */
    get sheen(): boolean {
      return this.featureUsed(FEATURE_PBR_SHEEN, RENDER_PASS_TYPE_FORWARD);
    }
    set sheen(val: boolean) {
      this.useFeature(FEATURE_PBR_SHEEN, !!val);
      if (!!val) {
        this.useFeature(FEATURE_PBR_SHEEN_USE_LUT, !!this._sheenLut);
        this.useFeature(FEATURE_PBR_SHEEN_COLOR_MAP, !!this._sheenColorMap);
        if (this._sheenColorMap) {
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_TEXCOORD_INDEX, this._sheenColorTexCoordIndex);
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_TEX_MATRIX, !!this._sheenColorTexMatrix);
        }
        this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_MAP, !!this._sheenRoughnessMap);
        if (this._sheenRoughnessMap) {
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_TEXCOORD_INDEX, this._sheenRoughnessTexCoordIndex);
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_TEX_MATRIX, !!this._sheenRoughnessTexMatrix);
        }
      }
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
        if (this.sheen) {
          this.optionChanged(false);
        }
      }
    }
    /** Roughness factor for sheen lighting */
    get sheenRoughnessFactor(): number {
      return this._sheenFactor.w;
    }
    set sheenRoughnessFactor(val: number) {
      if (val !== this._sheenFactor.w) {
        this._sheenFactor.w = val;
        if (this.sheen) {
          this.optionChanged(false);
        }
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
    /** The sheen color texture */
    get sheenColorMap(): Texture2D {
      return this._sheenColorMap;
    }
    set sheenColorMap(tex: Texture2D) {
      if (tex !== this._sheenColorMap) {
        this._sheenColorMap = tex ?? null;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_MAP, !!this._sheenColorMap);
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_TEXCOORD_INDEX, this._sheenColorTexCoordIndex);
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_TEX_MATRIX, !!this._sheenColorTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** Sheen texture sampler */
    get sheenColorTextureSampler(): TextureSampler {
      return this._sheenColorMapSampler;
    }
    set sheenColorTextureSampler(sampler: TextureSampler) {
      this._sheenColorMapSampler = sampler ?? null;
    }
    /** Sheen color texture coordinate index */
    get sheenColorTexCoordIndex(): number {
      return this._sheenColorTexCoordIndex;
    }
    set sheenColorTexCoordIndex(val: number) {
      if (val !== this._sheenColorTexCoordIndex) {
        this._sheenColorTexCoordIndex = val;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_TEXCOORD_INDEX, this._sheenColorTexCoordIndex);
        }
      }
    }
    /** Sheen color texture coordinate transform matrix */
    get sheenColorTexMatrix(): Matrix4x4 {
      return this._sheenColorTexMatrix;
    }
    set sheenColorTexMatrix(val: Matrix4x4) {
      if (val !== this._sheenColorTexMatrix) {
        this._sheenColorTexMatrix = val;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_COLOR_TEX_MATRIX, !!this._sheenColorTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** The sheen roughness texture */
    get sheenRoughnessMap(): Texture2D {
      return this._sheenRoughnessMap;
    }
    set sheenRoughnessMap(tex: Texture2D) {
      if (tex !== this._sheenRoughnessMap) {
        this._sheenRoughnessMap = tex ?? null;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_MAP, !!this._sheenRoughnessMap);
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_TEXCOORD_INDEX, this._sheenRoughnessTexCoordIndex);
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_TEX_MATRIX, !!this._sheenRoughnessTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** Sheen roughness texture sampler */
    get sheenRoughnessTextureSampler(): TextureSampler {
      return this._sheenRoughnessMapSampler;
    }
    set sheenRoughnessTextureSampler(sampler: TextureSampler) {
      this._sheenRoughnessMapSampler = sampler ?? null;
    }
    /** Sheen roughness texture coordinate index */
    get sheenRougnessTexCoordIndex(): number {
      return this._sheenRoughnessTexCoordIndex;
    }
    set sheenRoughnessTexCoordIndex(val: number) {
      if (val !== this._sheenRoughnessTexCoordIndex) {
        this._sheenRoughnessTexCoordIndex = val;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_TEXCOORD_INDEX, this._sheenRoughnessTexCoordIndex);
        }
      }
    }
    /** Sheen roughness texture coordinate transform matrix */
    get sheenRoughnessTexMatrix(): Matrix4x4 {
      return this._sheenRoughnessTexMatrix;
    }
    set sheenRoughnessTexMatrix(val: Matrix4x4) {
      if (val !== this._sheenRoughnessTexMatrix) {
        this._sheenRoughnessTexMatrix = val;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_ROUGHNESS_TEX_MATRIX, !!this._sheenRoughnessTexMatrix);
          this.optionChanged(false);
        }
      }
    }
    /** @internal */
    static getGGXLUT() {
      if (!this.ggxLut) {
        this.ggxLut = this.createGGXLUT(1024);
      }
      return this.ggxLut;
    }
    /** @internal */
    static createGGXLUT(size: number) {
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
                })
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
              this.n = pb.compOr(pb.sal(pb.compAnd(this.n, 0x55555555), 1), pb.sar(pb.compAnd(this.n, 0xAAAAAAAA), 1));
              this.n = pb.compOr(pb.sal(pb.compAnd(this.n, 0x33333333), 2), pb.sar(pb.compAnd(this.n, 0xCCCCCCCC), 2));
              this.n = pb.compOr(pb.sal(pb.compAnd(this.n, 0x0F0F0F0F), 4), pb.sar(pb.compAnd(this.n, 0xF0F0F0F0), 4));
              this.n = pb.compOr(pb.sal(pb.compAnd(this.n, 0x00FF00FF), 8), pb.sar(pb.compAnd(this.n, 0xFF00FF00), 8));
              this.$return(pb.mul(pb.float(this.n), 2.3283064365386963e-10));
            });
            pb.func('hammersley2d', [pb.int('i'), pb.int('N')], function () {
              this.$return(pb.vec2(pb.div(pb.float(this.i), pb.float(this.N)), this.radicalInverse_VdC(pb.uint(this.i))));
            });
          }
          pb.func('generateTBN', [pb.vec3('normal')], function () {
            this.$l.bitangent = pb.vec3(0, 1, 0);
            this.$l.NoU = this.normal.y;
            this.$l.epsl = 0.0000001;
            this.$if(pb.lessThanEqual(pb.sub(1, pb.abs(this.normal.y)), this.epsl), function () {
              this.bitangent = this.$choice(pb.greaterThan(this.normal.y, 0), pb.vec3(0, 0, 1), pb.vec3(0, 0, -1));
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
            this.$return(pb.div(pb.mul(pb.add(this.invR, 2), pb.pow(this.sin2h, pb.mul(this.invR, 0.5))), Math.PI * 2));
          });
          pb.func('smithGGXCorrelated', [pb.float('NoV'), pb.float('NoL'), pb.float('roughness')], function () {
            this.$l.a2 = pb.mul(this.roughness, this.roughness, this.roughness, this.roughness);
            this.$l.GGXV = pb.mul(this.NoL, pb.sqrt(pb.add(pb.mul(this.NoV, this.NoV, pb.sub(1, this.a2)), this.a2)));
            this.$l.GGXL = pb.mul(this.NoV, pb.sqrt(pb.add(pb.mul(this.NoL, this.NoL, pb.sub(1, this.a2)), this.a2)));
            this.$return(pb.div(0.5, pb.add(this.GGXV, this.GGXL)));
          });
          pb.func('V_Ashikhmin', [pb.float('NdotL'), pb.float('NdotV')], function () {
            this.$return(pb.clamp(pb.div(1, pb.mul(pb.sub(pb.add(this.NdotL, this.NdotV), pb.mul(this.NdotL, this.NdotV)), 4)), 0, 1));
          });
          pb.func('importanceSample', [pb.vec2('xi'), pb.vec3('normal'), pb.float('roughness'), pb.vec3('ggx').out(), pb.vec3('charlie').out()], function () {
            this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
            this.$l.cosTheta = pb.clamp(pb.sqrt(pb.div(pb.sub(1, this.xi.y), pb.add(1, pb.mul(pb.sub(pb.mul(this.alphaRoughness, this.alphaRoughness), 1), this.xi.y)))), 0, 1);
            this.$l.sinTheta = pb.sqrt(pb.sub(1, pb.mul(this.cosTheta, this.cosTheta)));
            this.$l.phi = pb.mul(this.xi.x, Math.PI * 2);
            this.$l.TBN = this.generateTBN(this.normal);
            this.$l.localSpaceDir = pb.normalize(pb.vec3(pb.mul(this.sinTheta, pb.cos(this.phi)), pb.mul(this.sinTheta, pb.sin(this.phi)), this.cosTheta));
            this.ggx = pb.mul(this.TBN, this.localSpaceDir);
            this.sinTheta = pb.pow(this.xi.y, pb.div(this.alphaRoughness, pb.add(pb.mul(this.alphaRoughness, 2), 1)));
            this.cosTheta = pb.sqrt(pb.sub(1, pb.mul(this.sinTheta, this.sinTheta)));
            this.localSpaceDir = pb.normalize(pb.vec3(pb.mul(this.sinTheta, pb.cos(this.phi)), pb.mul(this.sinTheta, pb.sin(this.phi)), this.cosTheta));
            this.charlie = pb.mul(this.TBN, this.localSpaceDir);
          });
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
                this.$l.pdf = pb.div(pb.mul(this.smithGGXCorrelated(this.NoV, this.ggxNoL, this.roughness), this.ggxVoH, this.ggxNoL), this.ggxNoH);
                this.$l.Fc = pb.pow(pb.sub(1, this.ggxVoH), 5);
                this.a = pb.add(this.a, pb.mul(pb.sub(1, this.Fc), this.pdf));
                this.b = pb.add(this.b, pb.mul(this.Fc, this.pdf));
              });
              this.$if(pb.greaterThan(this.charlieNoL, 0), function () {
                this.$l.sheenDistribution = this.D_Charlie(this.roughness, this.charlieNoH);
                this.$l.sheenVis = this.V_Ashikhmin(this.charlieNoL, this.NoV);
                this.c = pb.add(this.c, pb.mul(this.sheenVis, this.sheenDistribution, this.charlieNoL, this.charlieVoH));
              });
            });
            this.$return(pb.div(pb.vec3(pb.mul(this.a, 4), pb.mul(this.b, 4), pb.mul(this.c, 8 * Math.PI)), SAMPLE_COUNT));
          });
          pb.main(function () {
            this.$outputs.color = pb.vec4(this.integrateBRDF(this.$inputs.uv.x, this.$inputs.uv.y), 1);
          });
        }
      });
      const vertexLayout = device.createVertexLayout({
        vertexBuffers: [{ buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])) }]
      });
      const rs = device.createRenderStateSet();
      rs.useRasterizerState().setCullMode('none');
      rs.useDepthState().enableTest(false).enableWrite(false);
      const tex = device.createTexture2D('rgba8unorm', size, size, { noMipmap: true });
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
    vertexShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.vertexShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
      }
    }
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
      }
    }
  } as unknown as { new(...args: any[]): T & IMixinPBR };
}

export { mixinPBR };
