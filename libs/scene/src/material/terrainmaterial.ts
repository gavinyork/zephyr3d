import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type {
  BindGroup,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { mixinLight } from './mixins/lit';
import { Application } from '../app';
import type { Clonable } from '@zephyr3d/base';
import { retainObject, Vector4 } from '@zephyr3d/base';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { ShaderHelper } from './shader/helper';
import { RENDER_PASS_TYPE_SHADOWMAP } from '../values';

/**
 * Terrain detail map information
 * @public
 */
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

/**
 * Terrain material options
 * @public
 */
export type TerrainMaterialOptions = {
  splatMap?: Texture2D;
  splatMapTexCoordIndex?: number;
  detailMaps?: TerrainDetailMapInfo;
};

/**
 * Terrain material class
 * @public
 */
export class TerrainMaterial
  extends applyMaterialMixins(MeshMaterial, mixinLight, mixinPBRMetallicRoughness)
  implements Clonable<TerrainMaterial>
{
  private static _metallicRoughnessGenerationProgram: GPUProgram = null;
  private static _metallicRoughnessGenerationBindGroup: BindGroup = null;
  private readonly _options: TerrainMaterialOptions;
  private readonly _uvScales: Float32Array<ArrayBuffer>;
  private readonly _numDetailMaps: number;
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
      retainObject(this._options.splatMap);
      const albedoTextures = this._options.detailMaps.albedoTextures;
      if (Array.isArray(albedoTextures)) {
        for (const tex of albedoTextures) {
          if (!tex) {
            throw new Error(`TerrainMaterial(): Invalid detail albedo texture`);
          }
          retainObject(tex);
          tex.samplerOptions = {
            addressU: 'repeat',
            addressV: 'repeat'
          };
        }
        this._numDetailMaps = albedoTextures.length;
      } else {
        albedoTextures.samplerOptions = {
          addressU: 'repeat',
          addressV: 'repeat'
        };
        retainObject(albedoTextures);
        this._numDetailMaps = albedoTextures.depth;
      }
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
        let m: number;
        if (Array.isArray(normalTextures)) {
          for (const tex of normalTextures) {
            if (!tex) {
              throw new Error(`TerrainMaterial(): Invalid detail normal texture`);
            }
            retainObject(tex);
            tex.samplerOptions = {
              addressU: 'repeat',
              addressV: 'repeat'
            };
          }
          m = normalTextures.length;
        } else {
          normalTextures.samplerOptions = {
            addressU: 'repeat',
            addressV: 'repeat'
          };
          retainObject(normalTextures);
          m = normalTextures.depth;
        }
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
    }
    this.metallicRoughnessTexture = this.generateMetallicRoughnessMap();
    this.metallicRoughnessTexCoordIndex = -1;
    this.albedoTexCoordIndex = -1;
    this.normalTexCoordIndex = -1;
  }
  clone(): TerrainMaterial {
    const other = new TerrainMaterial(this._options);
    other.copyFrom(this);
    return other;
  }
  get terrainInfo(): Vector4 {
    return this._terrainInfo;
  }
  set terrainInfo(val: Vector4) {
    this._terrainInfo = val;
    this.uniformChanged();
  }
  /**
   * {@inheritDoc MeshMaterial.isTransparentPass}
   * @override
   */
  isTransparentPass(_pass: number): boolean {
    return false;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;
  }
  /**
   * {@inheritDoc Material.supportInstancing}
   * @override
   */
  supportInstancing(): boolean {
    return false;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('terrainInfo', this._terrainInfo);
      if (this._options) {
        bindGroup.setValue('detailScales', this._uvScales);
        bindGroup.setTexture('splatMap', this._options.splatMap);
        if (Array.isArray(this._options.detailMaps.albedoTextures)) {
          for (let i = 0; i < this._numDetailMaps; i++) {
            bindGroup.setTexture(`detailAlbedoMap${i}`, this._options.detailMaps.albedoTextures[i]);
          }
        } else {
          bindGroup.setTexture('detailAlbedoMap', this._options.detailMaps.albedoTextures);
        }
        if (Array.isArray(this._options.detailMaps.normalTextures)) {
          for (let i = 0; i < this._numDetailMaps; i++) {
            bindGroup.setTexture(`detailNormalMap${i}`, this._options.detailMaps.normalTextures[i]);
          }
        } else {
          bindGroup.setTexture('detailNormalMap', this._options.detailMaps.normalTextures);
        }
      }
    }
  }
  getMetallicRoughnessTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.mapUV;
  };
  getNormalTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.mapUV;
  };
  getAlbedoTexCoord: (scope: PBInsideFunctionScope) => PBShaderExp = function (scope) {
    return scope.$inputs.mapUV;
  };
  calculateAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp {
    if (!this._options) {
      return super.calculateAlbedoColor(scope);
    }
    const that = this;
    const pb = scope.$builder;
    const funcName = 'getTerrainAlbedo';
    pb.func(funcName, [], function () {
      this.$l.mask = pb.textureSample(this.splatMap, this.$inputs.mapUV);
      this.$l.color = pb.vec3(0);
      const useTextureArray = !Array.isArray(that._options.detailMaps.albedoTextures);
      for (let i = 0; i < that._numDetailMaps; i++) {
        const uv = pb.mul(this.$inputs.mapUV, this.detailScales.at(i).x);
        const sample = useTextureArray
          ? pb.textureArraySample(this.detailAlbedoMap, uv, i).rgb
          : pb.textureSample(this[`detailAlbedoMap${i}`], uv).rgb;
        this.color = pb.add(this.color, pb.mul(sample, this.mask[i]));
      }
      this.$return(pb.vec4(this.color, 1));
    });
    return pb.getGlobalScope()[funcName]();
  }
  sampleDetailNormalMap(
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
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    if (this.needFragmentColor()) {
      scope.terrainInfo = pb.vec4().uniform(2);
      scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
      scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
      scope.$outputs.mapUV = pb.div(scope.oPos.xz, scope.terrainInfo.xy);
    }
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      if (this._options) {
        scope.detailScales = pb.vec4[this._numDetailMaps]().uniform(2);
        scope.splatMap = pb.tex2D().uniform(2);
        const useAlbedoTextureArray = !Array.isArray(that._options.detailMaps.albedoTextures);
        if (useAlbedoTextureArray) {
          scope.detailAlbedoMap = pb.tex2DArray().uniform(2);
        } else {
          for (let i = 0; i < that._numDetailMaps; i++) {
            scope[`detailAlbedoMap${i}`] = pb.tex2D().uniform(2);
          }
        }
        const useNormalTextureArray = !Array.isArray(that._options.detailMaps.normalTextures);
        if (useNormalTextureArray) {
          scope.detailNormalMap = pb.tex2DArray().uniform(2);
        } else {
          for (let i = 0; i < that._numDetailMaps; i++) {
            scope[`detailNormalMap${i}`] = pb.tex2D().uniform(2);
          }
        }
      }
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        scope.$inputs.worldNorm
      );
      let calcNormal = false;
      if (this._options && this._options.detailMaps.normalTextures) {
        scope.$l.detailMask = pb.textureSample(scope.splatMap, scope.$inputs.mapUV);
        if (Array.isArray(this._options.detailMaps.normalTextures)) {
          for (let i = 0; i < this._options.detailMaps.normalTextures.length; i++) {
            const tex = scope[`detailNormalMap${i}`];
            const scale = scope.detailScales.at(i).y;
            const texCoord = pb.mul(scope.$inputs.mapUV, scope.detailScales.at(i).x);
            scope.normalInfo.normal = pb.add(
              scope.normalInfo.normal,
              pb.mul(
                this.sampleDetailNormalMap(scope, tex, texCoord, scale, scope.normalInfo.TBN),
                scope.detailMask[i]
              )
            );
            calcNormal = true;
          }
        } else {
          const tex = scope.detailNormalMap;
          for (let i = 0; i < this._numDetailMaps; i++) {
            const scale = scope.detailScales.at(i).y;
            const texCoord = pb.mul(scope.$inputs.mapUV, scope.detailScales.at(i).x);
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
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.$inputs.worldPos,
        scope.normalInfo.normal,
        scope.viewVec,
        scope.albedo,
        scope.normalInfo.TBN
      );
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
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
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext): void {
    super.updateRenderStates(pass, stateSet, ctx);
    const isShadowMapPass = ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP;
    if (isShadowMapPass) {
      stateSet.useRasterizerState().setCullMode('front');
    } else {
      stateSet.defaultRasterizerState();
    }
  }
}
