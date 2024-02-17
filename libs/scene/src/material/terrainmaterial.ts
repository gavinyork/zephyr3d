import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type {
  BindGroup,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { mixinPBRMetallicRoughness } from './mixins/pbr/metallicroughness';
import { mixinLight } from './mixins/lit';
import { Application } from '../app';
import { Vector4 } from '@zephyr3d/base';
import { drawFullscreenQuad } from '../render/helper';

export type TerrainDetailMapInfo = {
  albedoTextures: Texture2DArray | Texture2D[];
  uvScale: number[];
  metallic?: number[];
  roughness?: number[];
  normalScale?: number[];
  normalTextures?: Texture2DArray | Texture2D[];
  albedoTexCoordIndex?: number | number[];
  normalTexCoordIndex?: number | number[];
  grass?: {
    texture?: Texture2D;
    bladeWidth?: number;
    bladeHeigh?: number;
    density?: number;
    offset?: number;
  }[][];
};

export type TerrainMaterialOptions = {
  splatMap?: Texture2D;
  splatMapTexCoordIndex?: number;
  detailMaps?: TerrainDetailMapInfo;
};

export class TerrainMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRMetallicRoughness
) {
  private static _metallicRoughnessGenerationProgram: GPUProgram = null;
  private static _metallicRoughnessGenerationBindGroup: BindGroup = null;
  private _options: TerrainMaterialOptions;
  private _uvScales: Float32Array;
  private _numDetailMaps: number;
  private _terrainInfo: Vector4;
  constructor(options?: TerrainMaterialOptions) {
    super();
    this.normalMapMode = 'object-space';
    this._options = null;
    this._numDetailMaps = 0;
    this._uvScales = null;
    this._terrainInfo = null;
    if (options && options.splatMap && options.detailMaps && options.detailMaps.albedoTextures) {
      this._options = Object.assign({}, options);
      const albedoTextures = this._options.detailMaps.albedoTextures;
      this._numDetailMaps = Array.isArray(albedoTextures) ? albedoTextures.length : albedoTextures.depth;
      if (!this._numDetailMaps) {
        throw new Error(`TerrainMaterial(): Invalid detail textures`);
      }
      if (this._numDetailMaps > 4) {
        throw new Error(`TerrainMaterial(): The maximum detail levels is 4`);
      }
      if (
        !this._options.detailMaps.uvScale ||
        this._options.detailMaps.uvScale.length !== this._numDetailMaps
      ) {
        throw new Error(`TerrainMaterial(): Invalid uv scale`);
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
          throw new Error(`TerrainMaterial(): Invalid metallic values`);
        }
        for (let i = 0; i < this._numDetailMaps; i++) {
          this._uvScales[i * 4 + 2] = this._options.detailMaps.metallic[i];
        }
      }
      if (this._options.detailMaps.roughness) {
        if (this._options.detailMaps.roughness.length !== this._numDetailMaps) {
          throw new Error(`TerrainMaterial(): Invalid roughness values`);
        }
        for (let i = 0; i < this._numDetailMaps; i++) {
          this._uvScales[i * 4 + 3] = this._options.detailMaps.roughness[i];
        }
      }
      const normalTextures = options.detailMaps.normalTextures;
      if (normalTextures) {
        const m = Array.isArray(normalTextures) ? normalTextures.length : normalTextures.depth;
        if (m !== this._numDetailMaps) {
          throw new Error(
            `TerrainMaterial(): The number of normal textures not match the number of albedo textures`
          );
        }
        if (options.detailMaps.normalScale) {
          if (options.detailMaps.normalScale.length !== this._numDetailMaps) {
            throw new Error(`TerrainMaterial(): Invalid normal scale`);
          }
          for (let i = 0; i < this._numDetailMaps; i++) {
            this._uvScales[i * 4 + 1] = options.detailMaps.normalScale[i];
          }
        }
      }
      this._options = Object.assign({}, options);
      if (Array.isArray(albedoTextures)) {
        for (let i = 0; i < albedoTextures.length; i++) {
          if (!albedoTextures[i]) {
            throw new Error(`TerrainMaterial(): Invalid detail albedo texture`);
          }
          albedoTextures[i].samplerOptions = {
            addressU: 'repeat',
            addressV: 'repeat'
          };
        }
      } else {
        albedoTextures.samplerOptions = {
          addressU: 'repeat',
          addressV: 'repeat'
        };
      }
      if (Array.isArray(normalTextures)) {
        for (let i = 0; i < normalTextures.length; i++) {
          if (!normalTextures[i]) {
            throw new Error(`TerrainMaterial(): Invalid detail normal texture`);
          }
          normalTextures[i].samplerOptions = {
            addressU: 'repeat',
            addressV: 'repeat'
          };
        }
      } else if (normalTextures) {
        normalTextures.samplerOptions = {
          addressU: 'repeat',
          addressV: 'repeat'
        };
      }
    }
    this.vertexNormal = true;
    this.metallicRoughnessTexture = this.generateMetallicRoughnessMap();
    this.metallicRoughnessTexCoordIndex = -1;
    this.albedoTexCoordIndex = -1;
    this.normalTexCoordIndex = -1;
  }
  get terrainInfo(): Vector4 {
    return this._terrainInfo;
  }
  set terrainInfo(val: Vector4) {
    this._terrainInfo = val;
    this.optionChanged(false);
  }
  /**
   * {@inheritDoc Material.isTransparent}
   * @override
   */
  isTransparent(): boolean {
    return false;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
    super.applyUniformValues(bindGroup, ctx);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('terrainInfo', this._terrainInfo);
      if (this._options) {
        bindGroup.setValue('kkDetailScales', this._uvScales);
        bindGroup.setTexture('kkSplatMap', this._options.splatMap);
        if (Array.isArray(this._options.detailMaps.albedoTextures)) {
          for (let i = 0; i < this._numDetailMaps; i++) {
            bindGroup.setTexture(`kkDetailAlbedoMap${i}`, this._options.detailMaps.albedoTextures[i]);
          }
        } else {
          bindGroup.setTexture('kkDetailAlbedoMap', this._options.detailMaps.albedoTextures);
        }
        if (Array.isArray(this._options.detailMaps.normalTextures)) {
          for (let i = 0; i < this._numDetailMaps; i++) {
            bindGroup.setTexture(`kkDetailNormalMap${i}`, this._options.detailMaps.normalTextures[i]);
          }
        } else {
          bindGroup.setTexture('kkDetailNormalMap', this._options.detailMaps.normalTextures);
        }
      }
    }
  }
  /** @ts-ignore */
  getMetallicRoughnessTexCoord(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$inputs.mapUV;
  }
  /** @ts-ignore */
  getNormalTexCoord(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$inputs.mapUV;
  }
  /** @ts-ignore */
  getAlbedoTexCoord(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$inputs.mapUV;
  }
  calculateAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp {
    if (!this._options) {
      return super.calculateAlbedoColor(scope);
    }
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainAlbedo';
    pb.func(funcName, [], function () {
      this.$l.mask = pb.textureSample(this.kkSplatMap, this.$inputs.mapUV);
      this.$l.color = pb.vec3(0);
      const useTextureArray = !Array.isArray(that._options.detailMaps.albedoTextures);
      for (let i = 0; i < that._numDetailMaps; i++) {
        const uv = pb.mul(this.$inputs.mapUV, this.kkDetailScales.at(i).x);
        const sample = useTextureArray
          ? pb.textureArraySample(this.kkDetailAlbedoMap, uv, i).rgb
          : pb.textureSample(this[`kkDetailAlbedoMap${i}`], uv).rgb;
        this.color = pb.add(this.color, pb.mul(sample, this.mask[i]));
      }
      this.$return(pb.vec4(this.color, 1));
    });
    return pb.getGlobalScope()[funcName]();
  }
  sampleNormalMapWithTBN(
    scope: PBInsideFunctionScope,
    tex: PBShaderExp,
    texCoord: PBShaderExp,
    normalScale: PBShaderExp,
    TBN: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const pixel = pb.sub(pb.mul(pb.textureSample(tex, texCoord).rgb, 2), pb.vec3(1));
    const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(normalScale).xx, 1));
    return pb.normalize(pb.mul(TBN, normalTex));
  }
  calculateNormalAndTBN(scope: PBInsideFunctionScope): PBShaderExp {
    scope.$l.normalInfo = super.calculateNormalAndTBN(scope);
    const pb = scope.$builder;
    let calcNormal = false;
    if (this._options && this._options.detailMaps.normalTextures) {
      scope.$l.detailMask = pb.textureSample(scope.kkSplatMap, scope.$inputs.mapUV);
      if (Array.isArray(this._options.detailMaps.normalTextures)) {
        for (let i = 0; i < this._options.detailMaps.normalTextures.length; i++) {
          const tex = scope[`kkDetailNormalMap${i}`];
          const scale = scope.kkDetailScales.at(i).y;
          const texCoord = pb.mul(scope.$inputs.mapUV, scope.kkDetailScales.at(i).x);
          scope.normalInfo.normal = pb.add(
            scope.normalInfo.normal,
            pb.mul(
              this.sampleNormalMapWithTBN(scope, tex, texCoord, scale, scope.normalInfo.TBN),
              scope.detailMask[i]
            )
          );
          calcNormal = true;
        }
      } else {
        const tex = scope.kkDetailNormalMap;
        for (let i = 0; i < this._numDetailMaps; i++) {
          const scale = scope.kkDetailScales.at(i).y;
          const texCoord = pb.mul(scope.$inputs.mapUV, scope.kkDetailScales.at(i).x);
          const pixel = pb.sub(pb.mul(pb.textureArraySample(tex, texCoord, i).rgb, 2), pb.vec3(1));
          const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(scale).xx, 1));
          const detailNormal = pb.normalize(pb.mul(scope.normalInfo.TBN, normalTex));
          scope.normalInfo.normal = pb.add(
            scope.normalInfo.normal,
            pb.mul(detailNormal, scope.detailMask[i])
          );
          calcNormal = true;
        }
      }
    }
    if (calcNormal) {
      scope.normalInfo.normal = pb.normalize(scope.normalInfo.normal);
    }
    return scope.normalInfo;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.zPos = pb.vec3().attrib('position');
    if (this.needFragmentColor()) {
      scope.$g.terrainInfo = pb.vec4().uniform(2);
      scope.$outputs.mapUV = pb.div(scope.$inputs.zPos.xz, scope.terrainInfo.xy);
    }
    this.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      if (this._options) {
        scope.$g.kkDetailScales = pb.vec4[this._numDetailMaps]().uniform(2);
        scope.$g.kkSplatMap = pb.tex2D().uniform(2);
        const useAlbedoTextureArray = !Array.isArray(that._options.detailMaps.albedoTextures);
        if (useAlbedoTextureArray) {
          scope.$g.kkDetailAlbedoMap = pb.tex2DArray().uniform(2);
        } else {
          for (let i = 0; i < that._numDetailMaps; i++) {
            scope.$g[`kkDetailAlbedoMap${i}`] = pb.tex2D().uniform(2);
          }
        }
        const useNormalTextureArray = !Array.isArray(that._options.detailMaps.normalTextures);
        if (useNormalTextureArray) {
          scope.$g.kkDetailNormalMap = pb.tex2DArray().uniform(2);
        } else {
          for (let i = 0; i < that._numDetailMaps; i++) {
            scope.$g[`kkDetailNormalMap${i}`] = pb.tex2D().uniform(2);
          }
        }
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.normalInfo = this.calculateNormalAndTBN(scope);
      scope.$l.normal = scope.normalInfo.normal;
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.pbrData = this.getCommonData(scope, scope.albedo, scope.viewVec, scope.normalInfo.TBN);
      scope.$l.lightingColor = pb.vec3(0);
      scope.$l.emissiveColor = this.calculateEmissiveColor(scope);
      this.indirectLighting(scope, scope.normal, scope.viewVec, scope.pbrData, scope.lightingColor);
      this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, shadow) {
        this.$l.diffuse = pb.vec3();
        this.$l.specular = pb.vec3();
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
        this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
        if (shadow) {
          this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.NoL));
        }
        that.directLighting(
          this,
          this.lightDir,
          this.lightColor,
          this.normal,
          this.viewVec,
          this.pbrData,
          this.lightingColor
        );
      });
      scope.$l.litColor = pb.add(scope.lightingColor, scope.emissiveColor);
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
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
    if (!TerrainMaterial._metallicRoughnessGenerationProgram) {
      TerrainMaterial._metallicRoughnessGenerationProgram = device.buildRenderProgram({
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
          this.$outputs.outColor = pb.vec4();
          this.roughness = pb.vec4().uniform(0);
          this.metallic = pb.vec4().uniform(0);
          this.splatMap = pb.tex2D().uniform(0);
          pb.main(function () {
            this.weights = pb.textureSample(this.splatMap, this.$inputs.uv);
            this.roughnessValue = pb.dot(this.weights, this.roughness);
            this.metallicValue = pb.dot(this.weights, this.metallic);
            this.$outputs.outColor = pb.vec4(0, this.roughnessValue, this.metallicValue, 1);
          });
        }
      });
      TerrainMaterial._metallicRoughnessGenerationBindGroup = device.createBindGroup(
        TerrainMaterial._metallicRoughnessGenerationProgram.bindGroupLayouts[0]
      );
    }
    const roughnessValues = Vector4.one();
    const metallicValues = Vector4.zero();
    for (let i = 0; i < this._numDetailMaps; i++) {
      metallicValues[i] = this._uvScales[i * 4 + 2];
      roughnessValues[i] = this._uvScales[i * 4 + 3];
    }
    const tex = device.createTexture2D(
      'rgba8unorm',
      this._options.splatMap.width,
      this._options.splatMap.height
    );
    tex.name = 'TerrainMetallicRoughnessMap';
    const program = TerrainMaterial._metallicRoughnessGenerationProgram;
    const bindgroup = TerrainMaterial._metallicRoughnessGenerationBindGroup;
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
