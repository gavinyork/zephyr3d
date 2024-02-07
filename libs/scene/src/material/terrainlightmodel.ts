import type { BindGroup, GPUProgram, PBGlobalScope, PBInsideFunctionScope, PBShaderExp, Texture2D, Texture2DArray } from "@zephyr3d/device";
import { PBRLightModelMR } from "./lightmodel";
import { Vector4 } from "@zephyr3d/base";
import { RENDER_PASS_TYPE_FORWARD } from "../values";
import { Application } from "../app";
import { drawFullscreenQuad } from "../render/helper";
import type { DrawContext, EnvironmentLighting } from "../render";

export type TerrainDetailMapInfo = {
  albedoTextures: Texture2DArray|Texture2D[],
  uvScale: number[],
  metallic?: number[],
  roughness?: number[],
  normalScale?: number[],
  normalTextures?: Texture2DArray|Texture2D[],
  albedoTexCoordIndex?: number|number[],
  normalTexCoordIndex?: number|number[],
  grass?: {
    texture?: Texture2D,
    bladeWidth?: number,
    bladeHeigh?: number,
    density?: number,
    offset?: number
  }[][]
};

export type TerrainLightModelOptions = {
  splatMap?: Texture2D,
  splatMapTexCoordIndex?: number,
  detailMaps?: TerrainDetailMapInfo
};


const TEX_NAME_SPLATMAP = 'splat';
const TEX_NAME_DETAIL_COLOR = 'detailColor';
const TEX_NAME_DETAIL_NORMAL = 'detailNormal';

export class TerrainLightModel extends PBRLightModelMR {
  private static _metallicRoughnessGenerationProgram: GPUProgram = null;
  private static _metallicRoughnessGenerationBindGroup: BindGroup = null;
  private _options: TerrainLightModelOptions;
  private _uvScales: Float32Array;
  private _numDetailMaps: number;
  constructor(options?: TerrainLightModelOptions) {
    super();
    this._normalMapMode = 'object-space';
    this._options = null;
    this._numDetailMaps = 0;
    this._uvScales = null;
    if (options && options.splatMap && options.detailMaps && options.detailMaps.albedoTextures) {
      this._options = Object.assign({}, options);
      const albedoTextures = this._options.detailMaps.albedoTextures;
      this._numDetailMaps = Array.isArray(albedoTextures) ? albedoTextures.length : albedoTextures.depth;
      if (!this._numDetailMaps) {
        throw new Error(`TerrainLightModel(): Invalid detail textures`);
      }
      if (this._numDetailMaps > 4) {
        throw new Error(`TerrainLightModel(): The maximum detail levels is 4`);
      }
      if (!this._options.detailMaps.uvScale || this._options.detailMaps.uvScale.length !== this._numDetailMaps) {
        throw new Error(`TerrainLightModel(): Invalid uv scale`);
      }
      this._uvScales = new Float32Array(this._numDetailMaps * 4);
      for (let i = 0; i < this._numDetailMaps; i++) {
        this._uvScales[i * 4] = this._options.detailMaps.uvScale[i];
        this._uvScales[i * 4 + 1] = 1;
        this._uvScales[i * 4 + 2] = 0.01;
        this._uvScales[i * 4 + 3] = 0.99;
      }
      if (this._options.detailMaps.metallic) {
        if (this._options.detailMaps.metallic.length !== this._numDetailMaps) {
          throw new Error(`TerrainLightModel(): Invalid metallic values`);
        }
        for (let i = 0; i < this._numDetailMaps; i++) {
          this._uvScales[i * 4 + 2] = this._options.detailMaps.metallic[i];
        }
      }
      if (this._options.detailMaps.roughness) {
        if (this._options.detailMaps.roughness.length !== this._numDetailMaps) {
          throw new Error(`TerrainLightModel(): Invalid roughness values`);
        }
        for (let i = 0; i < this._numDetailMaps; i++) {
          this._uvScales[i * 4 + 3] = this._options.detailMaps.roughness[i];
        }
      }
      const normalTextures = options.detailMaps.normalTextures;
      if (normalTextures) {
        const m = Array.isArray(normalTextures) ? normalTextures.length : normalTextures.depth;
        if (m !== this._numDetailMaps) {
          throw new Error(`TerrainLightModel(): The number of normal textures not match the number of albedo textures`);
        }
        if (options.detailMaps.normalScale) {
          if (options.detailMaps.normalScale.length !== this._numDetailMaps) {
            throw new Error(`TerrainLightModel(): Invalid normal scale`);
          }
          for (let i = 0; i < this._numDetailMaps; i++) {
            this._uvScales[i * 4 + 1] = options.detailMaps.normalScale[i];
          }
        }
      }
      this._options = Object.assign({}, options);
      this._options.splatMapTexCoordIndex = this.setTextureOptions(TEX_NAME_SPLATMAP, this._options.splatMap, null, 0, null);
      if (Array.isArray(albedoTextures)) {
        this._options.detailMaps.albedoTexCoordIndex = [];
        for (let i = 0; i < albedoTextures.length; i++) {
          if (!albedoTextures[i]) {
            throw new Error(`TerrainLightModel(): Invalid detail albedo texture`);
          }
          this._options.detailMaps.albedoTexCoordIndex[i] = this.setTextureOptions(`${TEX_NAME_DETAIL_COLOR}${i}`, albedoTextures[i], null, -1, null);
          albedoTextures[i].samplerOptions = {
            addressU: 'repeat',
            addressV: 'repeat'
          };
        }
      } else {
        this._options.detailMaps.albedoTexCoordIndex = this.setTextureOptions(TEX_NAME_DETAIL_COLOR, albedoTextures, null, -1, null);
        albedoTextures.samplerOptions = {
          addressU: 'repeat',
          addressV: 'repeat'
        }
      }
      if (Array.isArray(normalTextures)) {
        this._options.detailMaps.normalTexCoordIndex = [];
        for (let i = 0; i < normalTextures.length; i++) {
          if (!normalTextures[i]) {
            throw new Error(`TerrainLightModel(): Invalid detail normal texture`);
          }
          this._options.detailMaps.normalTexCoordIndex[i] = this.setTextureOptions(`${TEX_NAME_DETAIL_NORMAL}${i}`, normalTextures[i], null, -1, null);
          normalTextures[i].samplerOptions = {
            addressU: 'repeat',
            addressV: 'repeat'
          };
        }
      } else if (normalTextures) {
        this._options.detailMaps.normalTexCoordIndex = this.setTextureOptions(TEX_NAME_DETAIL_NORMAL, normalTextures, null, -1, null);
        normalTextures.samplerOptions = {
          addressU: 'repeat',
          addressV: 'repeat'
        }
      }
    }
    this.setMetallicMap(this.generateMetallicRoughnessMap(), null, -1);
  }
  setupUniforms(scope: PBGlobalScope, ctx: DrawContext) {
    super.setupUniforms(scope, ctx);
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment' && this._options) {
      scope.detailScales = pb.vec4[this._numDetailMaps]().uniform(2);
    }
  }
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    super.applyUniforms(bindGroup, ctx);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      if (this._options) {
        bindGroup.setValue('detailScales', this._uvScales);
      }
    }
  }
  protected fillSurfaceData(scope: PBInsideFunctionScope, envLight: EnvironmentLighting) {
    super.fillSurfaceData(scope, envLight);
  }
  calculateAlbedo(scope: PBInsideFunctionScope): PBShaderExp {
    if (!this._options) {
      return super.calculateAlbedo(scope);
    }
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainAlbedo';
    pb.func(funcName, [], function () {
      this.$l.mask = pb.textureSample(this[that.getTextureUniformName(TEX_NAME_SPLATMAP)], this.$inputs[`texcoord${that._options.splatMapTexCoordIndex}`])
      this.$l.color = pb.vec3(0);
      const useTextureArray = !Array.isArray(that._options.detailMaps.albedoTextures);
      for (let i = 0; i < that._numDetailMaps; i++) {
        const texCoordIndex = useTextureArray ? that._options.detailMaps.albedoTexCoordIndex : that._options.detailMaps.albedoTexCoordIndex[i];
        const uv = pb.mul(this.$inputs[`texcoord${texCoordIndex}`], this.detailScales.at(i).x);
        const sample = useTextureArray
          ? pb.textureArraySample(this[that.getTextureUniformName(TEX_NAME_DETAIL_COLOR)], uv, i).rgb
          : pb.textureSample(this[that.getTextureUniformName(`${TEX_NAME_DETAIL_COLOR}${i}`)], uv).rgb;
        this.color = pb.add(this.color, pb.mul(sample, this.mask[i]));
      }
      this.$return(pb.vec4(this.color, 1));
    });
    return pb.getGlobalScope()[funcName]();
  }
  calculateNormal(
    scope: PBInsideFunctionScope,
    worldPosition: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ): PBShaderExp {
    scope.$l.terrainBaseNormal = super.calculateNormal(scope, worldPosition, worldNormal, worldTangent, worldBinormal);
    const pb = scope.$builder;
    let calcNormal = false;
    if (this._options && this._options.detailMaps.normalTextures) {
      if (Array.isArray(this._options.detailMaps.normalTextures)) {
        for (let i = 0; i < this._options.detailMaps.normalTextures.length; i++) {
          const tex = scope[this.getTextureUniformName(`${TEX_NAME_DETAIL_NORMAL}${i}`)];
          const scale = scope.detailScales.at(i).y;
          const texCoord = pb.mul(scope.$inputs[`texcoord${this._options.detailMaps.normalTexCoordIndex[i]}`], scope.detailScales.at(i).x);
          scope.terrainBaseNormal.normal = pb.add(scope.terrainBaseNormal.normal, this.sampleNormalMapWithTBN(scope, tex, texCoord, scale, scope.terrainBaseNormal.TBN));
          calcNormal = true;
        }
      } else {
        const tex = scope[this.getTextureUniformName(TEX_NAME_DETAIL_NORMAL)];
        for (let i = 0; i < this._numDetailMaps; i++) {
          const scale = scope.detailScales.at(i).y;
          const texCoord = pb.mul(scope.$inputs[`texcoord${this._options.detailMaps.normalTexCoordIndex}`], scope.detailScales.at(i).x);
          const pixel = pb.sub(pb.mul(pb.textureArraySample(tex, texCoord, i).rgb, 2), pb.vec3(1));
          const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(scale).xx, 1));
          const detailNormal = pb.normalize(pb.mul(scope.terrainBaseNormal.TBN, normalTex));
          scope.terrainBaseNormal.normal = pb.add(scope.terrainBaseNormal.normal, detailNormal);
          calcNormal = true;
        }
      }
    }
    if (calcNormal) {
      scope.terrainBaseNormal.normal = pb.normalize(scope.terrainBaseNormal.normal);
    }
    return scope.terrainBaseNormal;
  }
  generateMetallicRoughnessMap(): Texture2D {
    const device = Application.instance.device;
    if (!this._options) {
      const tex = device.createTexture2D('rgba8unorm', 1, 1, {
        samplerOptions: { mipFilter: 'none' }
      });
      tex.update(new Uint8Array([0, 1, 0, 0]), 0, 0, 1, 1);
      tex.name = 'TerrainMetallicRoughnessMap';
      return tex;
    }
    if (!TerrainLightModel._metallicRoughnessGenerationProgram) {
      TerrainLightModel._metallicRoughnessGenerationProgram = device.buildRenderProgram({
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
        fragment(pb){
          this.$outputs.outColor = pb.vec4();
          this.roughness = pb.vec4().uniform(0);
          this.metallic = pb.vec4().uniform(0);
          this.splatMap = pb.tex2D().uniform(0);
          pb.main(function(){
            this.weights = pb.textureSample(this.splatMap, this.$inputs.uv);
            this.roughnessValue = pb.dot(this.weights, this.roughness);
            this.metallicValue = pb.dot(this.weights, this.metallic);
            this.$outputs.outColor = pb.vec4(0, this.roughnessValue, this.metallicValue, 1);
          });
        }
      });
      TerrainLightModel._metallicRoughnessGenerationBindGroup = device.createBindGroup(TerrainLightModel._metallicRoughnessGenerationProgram.bindGroupLayouts[0]);
    }
    const roughnessValues = Vector4.one();
    const metallicValues = Vector4.zero();
    for (let i = 0; i < this._numDetailMaps; i++) {
      metallicValues[i] = this._uvScales[i * 4 + 2];
      roughnessValues[i] = this._uvScales[i * 4 + 3];
    }
    const tex = device.createTexture2D('rgba8unorm', this._options.splatMap.width, this._options.splatMap.height);
    tex.name = 'TerrainMetallicRoughnessMap';
    const program = TerrainLightModel._metallicRoughnessGenerationProgram;
    const bindgroup = TerrainLightModel._metallicRoughnessGenerationBindGroup;
    bindgroup.setValue('roughness', roughnessValues);
    bindgroup.setValue('metallic', metallicValues);
    bindgroup.setTexture('splatMap', this._options.splatMap);
    const fb = device.createFrameBuffer([tex], null);
    device.pushDeviceStates();
    device.setFramebuffer(fb);
    device.setProgram(program);
    device.setBindGroup(0, bindgroup);
    drawFullscreenQuad();
    device.popDeviceStates();
    fb.dispose();
    return tex;
  }
}
