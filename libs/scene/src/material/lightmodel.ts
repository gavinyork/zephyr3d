import type { Vector3} from '@zephyr3d/base';
import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  Texture2D,
  BaseTexture,
  TextureSampler,
  PBInsideFunctionScope,
  PBShaderExp,
  PBGlobalScope,
  AbstractDevice} from '@zephyr3d/device';
import {
  PBStructTypeInfo,
  PBPrimitiveType,
  PBPrimitiveTypeInfo
} from '@zephyr3d/device';
import type { EnvironmentLighting } from '../render/envlight';
import { calculateTBN, calculateTBNWithNormal } from '../shaders/misc';
import { Material } from './material';
import { fresnelSchlick, directClearcoatLighting, directLighting, directSheenLighting } from '../shaders/pbr';
import { ShaderFramework } from '../shaders/framework';
import { Application } from '../app';
import type { DrawContext } from '../render/drawable';

const typeF32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32);
const typeF32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC3);
const typeF32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4);
const typeMat3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3);

type TexCoordChannel = {
  srcLocation: number;
  transform: Matrix4x4;
};

type TextureOptions = {
  texture: BaseTexture;
  texCoordIndex: number;
  sampler: TextureSampler;
};

const identTexTransform = Matrix4x4.identity();
const TEX_NAME_ALBEDO = 'albedo';
const TEX_NAME_NORMAL = 'normal';
const TEX_NAME_EMISSIVE = 'emissive';
const TEX_NAME_OCCLUSION = 'occlusion';
const TEX_NAME_SPECULAR = 'specular';
const TEX_NAME_SPECULAR_COLOR = 'specularColor';
const TEX_NAME_METALLIC = 'metallic';
const TEX_NAME_SHEEN_COLOR = 'sheenColor';
const TEX_NAME_SHEEN_ROUGHNESS = 'sheenRoughness';
const TEX_NAME_SHEEN_LUT = 'sheenLut';
const TEX_NAME_CLEARCOAT_INTENSITY = 'clearcoatIntensity';
const TEX_NAME_CLEARCOAT_ROUGHNESS = 'clearcoatRoughness';
const TEX_NAME_CLEARCOAT_NORMAL = 'clearcoatNormal';

/**
 * Normal map mode
 * @public
 */
export type NormalMapMode = 'object-space'|'tangent-space';

/**
 * Base class for any kind of light model
 * @public
 */
export abstract class LightModel {
  /** @internal */
  protected static readonly funcNameBRDFEnvConstantAmbient = 'libLM_envConstantAmbient';
  /** @internal */
  protected static readonly funcNameBRDFEnvHemispheric = 'libLM_envHemispheric';
  /** @internal */
  protected static readonly uniformAlbedoColor = 'libLM_USAGE_albedoColor';
  /** @internal */
  protected static readonly uniformNormalScale = 'libLM_USAGE_normalScale';
  /** @internal */
  protected static readonly uniformEmissiveFactor = 'libLM_USAGE_emissiveFactor';
  /** @internal */
  private static readonly funcNameCalcAlbedo = 'libLM_calcAlbedo';
  /** @internal */
  protected _doubleSideLighting: boolean;
  /** @internal */
  protected _albedo: Vector4;
  /** @internal */
  protected _normalScale: number;
  /** @internal */
  protected _normalMapMode: NormalMapMode;
  /** @internal */
  protected _emissiveFactor: Vector4;
  /** @internal */
  protected _hash: string;
  /** @internal */
  protected _hashVersion: number;
  /** @internal */
  protected _uniformVersion: number;
  /** @internal */
  protected _bindGroupTagList: WeakMap<BindGroup, [number, number]>;
  /** @internal */
  protected _texCoordChannels: TexCoordChannel[];
  /** @internal */
  protected _textureOptions: Record<string, TextureOptions>;
  /** @internal */
  protected _surfaceDataType: PBStructTypeInfo;
  /**
   * Creates an instance of LightModel
   */
  constructor() {
    this._albedo = Vector4.one();
    this._doubleSideLighting = true;
    this._normalScale = 1;
    this._normalMapMode = 'tangent-space';
    this._emissiveFactor = new Vector4(0, 0, 0, 1);
    this._hash = null;
    this._hashVersion = 0;
    this._uniformVersion = 0;
    this._bindGroupTagList = new WeakMap();
    this._texCoordChannels = [];
    this._textureOptions = {};
    this._surfaceDataType = null;
  }
  /**
   * Gets the data structure of surface data
   * @param env - environment lighting object
   * @returns The data structure of surface data
   */
  getSurfaceDataType(env: EnvironmentLighting): PBStructTypeInfo {
    return this.createSurfaceDataType(env);
  }
  /** Whether enable double side lighting */
  get doubleSideLighting(): boolean {
    return this._doubleSideLighting;
  }
  set doubleSideLighting(val: boolean) {
    if (this._doubleSideLighting !== !!val) {
      this._doubleSideLighting = !!val;
      this.optionChanged(true);
    }
  }
  /** The albedo color */
  get albedo(): Vector4 {
    return this._albedo;
  }
  set albedo(val: Vector4) {
    if (!val.equalsTo(this._albedo)) {
      this._albedo.set(val);
      this.optionChanged(false);
    }
  }
  /** The albedo texture */
  get albedoMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_ALBEDO]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the albedo texture */
  get albedoSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_ALBEDO]?.sampler ?? null;
  }
  /** Texture coordinate index of the albedo texture */
  get albedoMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_ALBEDO]?.texCoordIndex ?? null;
  }
  /**
   * Gets the texture transform matrix for given texture coordinate index.
   * @param texCoordIndex - The texture coordinate index
   * @returns Texture transform matrix
   */
  getTexCoordTransform(texCoordIndex: number): Matrix4x4 {
    return this._texCoordChannels[texCoordIndex]?.transform ?? null;
  }
  /**
   * Sets the texture transform matrix for given texture coordinate index.
   * @param texCoordIndex - The texture coordinate index.
   * @param transform - Texture transform matrix, if null, the identity matrix will be set.
   */
  setTexCoordTransform(texCoordIndex: number, transform: Matrix4x4) {
    if (!this._texCoordChannels[texCoordIndex]) {
      console.error(`setTexCoordTransform(): texCoordIndex ${texCoordIndex} not in use`);
    } else {
      this._texCoordChannels[texCoordIndex].transform = transform ?? identTexTransform;
      this.optionChanged(false);
    }
  }
  /**
   * Sets the albedo texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setAlbedoMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_ALBEDO, tex, sampler, texCoordIndex, texTransform);
  }
  /** The normal texture */
  get normalMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_NORMAL]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the normal texture */
  get normalSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_NORMAL]?.sampler ?? null;
  }
  /** Texture coordinate index of the normal texture */
  get normalMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_NORMAL]?.texCoordIndex ?? null;
  }
  /**
   * Sets the normal texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setNormalMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_NORMAL, tex, sampler, texCoordIndex, texTransform);
  }
  /** Scale value of normal for normal mapping */
  get normalScale(): number {
    return this._normalScale;
  }
  set normalScale(val: number) {
    if (val !== this._normalScale) {
      this._normalScale = val;
      if (this.normalMap) {
        this.optionChanged(false);
      }
    }
  }
  /** The emission texture */
  get emissiveMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_EMISSIVE]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the emission texture */
  get emissiveSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_EMISSIVE]?.sampler ?? null;
  }
  /** Texture coordinate index of the emission texture */
  get emissiveMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_EMISSIVE]?.texCoordIndex ?? null;
  }
  /**
   * Sets the emission texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setEmissiveMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_EMISSIVE, tex, sampler, texCoordIndex, texTransform);
  }
  /** The emission color */
  get emissiveColor(): Vector3 {
    return this._emissiveFactor.xyz();
  }
  set emissiveColor(val: Vector3) {
    if (
      val.x !== this._emissiveFactor.x ||
      val.y !== this._emissiveFactor.y ||
      val.z !== this._emissiveFactor.z
    ) {
      this._emissiveFactor.x = val.x;
      this._emissiveFactor.y = val.y;
      this._emissiveFactor.z = val.z;
      this.optionChanged(false);
    }
  }
  /** Strength of emission */
  get emissiveStrength(): number {
    return this._emissiveFactor.w;
  }
  set emissiveStrength(val: number) {
    if (this._emissiveFactor.w !== val) {
      this._emissiveFactor.w = val;
      this.optionChanged(false);
    }
  }
  /**
   * Adds a texture uniforms for the light model
   * @param name - Name of the texture uniform
   * @param tex - Texture to set
   * @param sampler - Sampler of the texture
   * @param texCoord - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setTextureOptions(
    name: string,
    tex: BaseTexture,
    sampler: TextureSampler,
    texCoord: number,
    texTransform: Matrix4x4
  ): number {
    tex = tex ?? null;
    let info = this._textureOptions[name];
    if (!tex) {
      if (info) {
        delete this._textureOptions[name];
        this.optionChanged(true);
      }
      return;
    }
    if (!info) {
      info = {
        texture: null,
        texCoordIndex: null,
        sampler: null
      };
      this._textureOptions[name] = info;
    }
    sampler = sampler ?? null;
    texTransform = texTransform || identTexTransform;
    let uniformChanged = false;
    let hashChanged = false;
    if (info.texture !== tex) {
      hashChanged ||= !info.texture || !tex;
      info.texture = tex;
    }
    if (info.sampler !== sampler) {
      uniformChanged ||= !!info.texture;
      info.sampler = sampler;
    }
    const index = this.addTexCoordChannel(texCoord, texTransform);
    if (index !== info.texCoordIndex) {
      info.texCoordIndex = index;
      uniformChanged ||= !!info.texture;
    }
    if (uniformChanged || hashChanged) {
      this.optionChanged(hashChanged);
    }
    return index;
  }
  /**
   * Calculates the hash code of the shader program
   * @returns The hash code of the shader program
   */
  calculateHash(): string {
    const texChannelHash = this._texCoordChannels.map((val) => val.srcLocation).join('');
    const albedoHash = this.albedoMap ? this.albedoMapTexCoord + 1 : 0;
    const normalHash = this.normalMap ? `${this.normalMapTexCoord + 1}:${this._normalMapMode === 'tangent-space' ? 1 : 0}` : 0;
    const emissiveHash = this.emissiveMap ? this.emissiveMapTexCoord + 1 : 0;
    return `${texChannelHash}_${albedoHash}_${normalHash}_${emissiveHash}`;
  }
  /**
   * Setup uniforms of the shader program
   * @param scope - The shader scope
   * @param ctx - The drawing context
   */
  setupUniforms(scope: PBGlobalScope, ctx: DrawContext) {
    const pb = scope.$builder;
    const that = this;
    if (pb.shaderKind === 'vertex') {
      for (let i = 0; i < that._texCoordChannels.length; i++) {
        scope[`lm_texTransform${i}`] = pb.mat4().uniform(2);
      }
    } else {
      scope.lm_albedo = pb.vec4().uniform(2).tag(LightModel.uniformAlbedoColor);
      if (this.normalMap) {
        scope.lm_normalScale = pb.float().uniform(2).tag(LightModel.uniformNormalScale);
      }
      scope.lm_emissiveFactor = pb.vec4().uniform(2).tag(LightModel.uniformEmissiveFactor);
      scope.surfaceData = pb.defineStructByType(that.getSurfaceDataType(ctx.drawEnvLight ? ctx.env.light.envLight : null))();
      this.setupTextureUniforms(scope);
    }
  }
  /**
   * Updates uniforms of the shader program
   * @param bindGroup - The bind group
   * @param ctx - The drawing context
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext) {
    for (let i = 0; i < this._texCoordChannels.length; i++) {
      bindGroup.setValue(`lm_texTransform${i}`, this._texCoordChannels[i].transform);
    }
    bindGroup.setValue('lm_albedo', this._albedo);
    if (this.normalMap) {
      bindGroup.setValue('lm_normalScale', this._normalScale);
    }
    bindGroup.setValue('lm_emissiveFactor', this._emissiveFactor);
    this.applyTextureUniforms(bindGroup);
  }
  /**
   * Retreives the surface data of the material
   * @param scope - The shader scope
   * @param envLight - The environment lighting object
   * @param worldPos - World space position of current fragment
   * @param worldNormal - World space normal of current fragment
   * @param worldTangent - World space tangent of current fragment
   * @param worldBinormal - World space binormal of current fragment
   * @returns The surface data
   */
  getSurfaceData(
    scope: PBInsideFunctionScope,
    envLight: EnvironmentLighting,
    worldPos: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ) {
    const funcNameGetSurfaceData = 'lib_getSurfaceData';
    const pb = scope.$builder;
    const that = this;
    const args = [worldPos.xyz];
    const params = [pb.vec3('worldPos')];
    if (worldNormal) {
      params.push(pb.vec3('worldNormal'));
      args.push(worldNormal);
      if (worldTangent) {
        params.push(pb.vec3('worldTangent'), pb.vec3('worldBinormal'));
        args.push(worldTangent, worldBinormal);
      }
    }
    pb.func(funcNameGetSurfaceData, params, function () {
      this.$l.normalInfo = that.calculateNormal(
        this,
        this.worldPos,
        worldNormal ? this.worldNormal : null,
        worldTangent ? this.worldTangent : null,
        worldTangent ? this.worldBinormal : null
      );
      this.surfaceData.TBN = this.normalInfo.TBN;
      this.surfaceData.normal = this.normalInfo.normal;
      this.surfaceData.viewVec = pb.normalize(
        pb.sub(ShaderFramework.getCameraPosition(this), this.worldPos)
      );
      this.surfaceData.NdotV = pb.clamp(
        pb.dot(this.surfaceData.normal, this.surfaceData.viewVec),
        0.0001,
        1
      );
      this.surfaceData.diffuse = that.calculateAlbedo(this);
      this.surfaceData.accumDiffuse = pb.vec3(0);
      this.surfaceData.accumSpecular = pb.vec3(0);
      this.surfaceData.accumEmissive = that.calculateEmissive(this);
      this.surfaceData.accumColor = pb.vec3(0);
      that.fillSurfaceData(this, envLight);
    });
    pb.getGlobalScope()[funcNameGetSurfaceData](...args);
  }
  /**
   * Gets the name of a texture uniform by given key
   * @param key - key of the texture
   * @returns Name of the texture uniform
   */
  getTextureUniformName(key: string) {
    return `lm_${key}_Map`;
  }
  /**
   * Calculates the texture coordinate of current fragment by given texture coordinate index
   * @param scope - The shader scope
   * @param index - The texture coordinate index
   * @returns The texture coordinate
   */
  calculateTexCoord(scope: PBInsideFunctionScope, index: number): PBShaderExp {
    return scope.$builder.mul(
      scope[`lm_texTransform${index}`],
      scope.$builder.vec4(scope.$inputs[`texcoord${this._texCoordChannels[index].srcLocation}`], 0, 1)
    ).xy;
  }
  /**
   * Calculates the texture coordinate of current fragment by given texture coordinate value
   * @param scope - The shader scope
   * @param index - The texture coordinate index
   * @returns The texture coordinate
   */
  calculateTexCoordNoInput(scope: PBInsideFunctionScope, index: number, value: PBShaderExp): PBShaderExp {
    return scope.$builder.mul(
      scope[`lm_texTransform${index}`],
      scope.$builder.vec4(value, 0, 1)
    ).xy;
  }
  /**
   * Calculates the emissive color for current fragment
   * @param scope - The shader scope
   * @returns The emissive color
   */
  calculateEmissive(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    const emissiveMap = scope[this.getTextureUniformName(TEX_NAME_EMISSIVE)];
    const emissiveFactor = scope.$query(LightModel.uniformEmissiveFactor);
    if (emissiveFactor) {
      const emissiveColor = pb.mul(emissiveFactor.rgb, emissiveFactor.a);
      if (emissiveMap) {
        const emissiveTexCoord = scope.$inputs[`texcoord${this.emissiveMapTexCoord}`];
        return pb.mul(pb.textureSample(emissiveMap, emissiveTexCoord).rgb, emissiveColor).rgb;
      } else {
        return emissiveColor;
      }
    } else {
      return pb.vec3(0);
    }
  }
  /**
   * Calculates the albedo color for current fragment
   * @param scope - The shader scope
   * @returns The albedo color
   */
  calculateAlbedo(scope: PBInsideFunctionScope): PBShaderExp {
    const that = this;
    const pb = scope.$builder;
    pb.func(LightModel.funcNameCalcAlbedo, [], function () {
      const diffuseMap = this[that.getTextureUniformName(TEX_NAME_ALBEDO)];
      const texCoord = diffuseMap && this.$inputs[`texcoord${that.albedoMapTexCoord}`];
      const vertexColor = scope.$query(ShaderFramework.USAGE_VERTEX_COLOR);
      let val = scope.$query(LightModel.uniformAlbedoColor);
      if (diffuseMap && texCoord) {
        const tex = pb.textureSample(diffuseMap, texCoord);
        val = pb.mul(val, tex);
      }
      if (vertexColor) {
        val = pb.mul(val, vertexColor);
      }
      this.$return(val);
    });
    return pb.getGlobalScope()[LightModel.funcNameCalcAlbedo]();
  }
  /**
   * Samples tangent space normal map and then convert it to object space
   * @param scope - The shader scope
   * @param tex - Normal map
   * @param texCoord - Sample texture coordinate
   * @param normalScale - The normal scale
   * @param TBN - The TBN matrix
   * @returns Object space normal
   */
  sampleNormalMapWithTBN(scope: PBInsideFunctionScope, tex: PBShaderExp, texCoord: PBShaderExp, normalScale: PBShaderExp, TBN: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const pixel = pb.sub(pb.mul(pb.textureSample(tex, texCoord).rgb, 2), pb.vec3(1));
    const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(normalScale).xx, 1));
    return pb.normalize(pb.mul(TBN, normalTex));
  }
  /**
   * Samples object space normal map
   * @param scope - The shader scope
   * @param tex - Normal map
   * @param texCoord - Sample texture coordinate
   * @param normalScale - The normal scale
   * @returns Object space normal
   */
  sampleNormalMap(scope: PBInsideFunctionScope, tex: PBShaderExp, texCoord: PBShaderExp, normalScale: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const pixel = pb.sub(pb.mul(pb.textureSample(tex, texCoord).rgb, 2), pb.vec3(1));
    const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(normalScale).xx, 1));
    return pb.normalize(normalTex);
  }
  /**
   * Calculate pixel normal by given TBN matrix
   * @param scope - The shader scope
   * @param TBN - TBN matrix
   * @returns Calculated pixel normal
   */
  calculateNormalWithTBN(scope: PBInsideFunctionScope, texCoord: PBShaderExp, TBN: PBShaderExp): PBShaderExp {
    return this.normalMap
      ? this._normalMapMode === 'tangent-space'
        ? this.sampleNormalMapWithTBN(
            scope, scope[this.getTextureUniformName(TEX_NAME_NORMAL)],
            texCoord,
            scope.$query(LightModel.uniformNormalScale) || scope.$builder.float(1),
            TBN)
        : this.sampleNormalMap(
            scope, scope[this.getTextureUniformName(TEX_NAME_NORMAL)],
            texCoord,
            scope.$query(LightModel.uniformNormalScale) || scope.$builder.float(1),
          )
      : TBN[2];
  }
  /**
   * Calculate the normal vector for current fragment
   * @param scope - The shader scope
   * @param worldPosition - World space position of current fragment
   * @param worldNormal - World space normal of current fragment
   * @param worldTangent - World space tangent of current fragment
   * @param worldBinormal - World space binormal of current fragment
   * @returns Normal vector for current fragment
   */
  calculateNormal(
    scope: PBInsideFunctionScope,
    worldPosition: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const uv = this.normalMap
      ? scope.$inputs[`texcoord${this.normalMapTexCoord}`] ?? pb.vec2(0)
      : this.albedoMap
        ? scope.$inputs[`texcoord${this.albedoMapTexCoord}`] ?? pb.vec2(0)
        : pb.vec2(0);
    let TBN: PBShaderExp;
    if (!worldNormal) {
      TBN = calculateTBN(scope, worldPosition, uv, this._doubleSideLighting);
    } else if (!worldTangent) {
      TBN = calculateTBNWithNormal(scope, worldPosition, worldNormal, uv, this._doubleSideLighting);
    } else {
      TBN = pb.mat3(pb.normalize(worldTangent), pb.normalize(worldBinormal), pb.normalize(worldNormal));
    }
    return this.calculatePixelNormal(scope, TBN);
  }
  /**
   * Whether the shading is effected by lights
   */
  abstract supportLighting(): boolean;
  /**
   * Calculates BRDF of environment lighting for current fragment
   * @param envLight - The environment lighting object
   * @param scope - The shader scope
   */
  abstract envBRDF(
    envLight: EnvironmentLighting,
    scope: PBInsideFunctionScope
  ): void;
  /**
   * Calculates BRDF for direct lighting for current fragment
   * @param scope - The shader scope
   * @param lightDir - Vector from the light position to current fragment
   * @param attenuation - Attenuation of the light
   */
  abstract directBRDF(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    attenuation: PBShaderExp
  ): void;
  /**
   * Calculates the final color of current fragment by composing individual light contribution
   * @param scope - The shader scope
   * @returns The final fragment color
   */
  finalComposite(scope: PBInsideFunctionScope): PBShaderExp {
    const funcNameFinalComposite = 'lib_finalComposite';
    const pb = scope.$builder;
    const that = this;
    pb.func(
      funcNameFinalComposite,
      [],
      function () {
        this.surfaceData.accumColor = pb.add(
          this.surfaceData.accumDiffuse,
          this.surfaceData.accumSpecular,
          this.surfaceData.accumEmissive
        );
        that.compositeSurfaceData(this);
        this.$return(Material.debugChannel ? this.surfaceData.debugColor : pb.vec4(this.surfaceData.accumColor, this.surfaceData.diffuse.a));
      }
    );
    return pb.getGlobalScope()[funcNameFinalComposite]();
  }
  /**
   * Gets the shader hash
   * @returns shader hash
   */
  getHash(): string {
    if (this._hash === null) {
      this._hash = `${this.constructor.name}_${this.calculateHash()}`;
    }
    return this._hash;
  }
  /**
   * Peeks the shader hash
   * @returns shader hash
   */
  peekHash(): string {
    return this._hash;
  }
  /**
   * Composite surface data to produce the final color
   * @param scope - The shader scope
   */
  protected compositeSurfaceData(scope: PBInsideFunctionScope) {
    // to be overriden
    const pb = scope.$builder;
    switch(Material.debugChannel) {
      case 'normal': {
        scope.surfaceData.debugColor = pb.vec4(pb.add(pb.mul(scope.surfaceData.TBN[2], 0.5), pb.vec3(0.5)), 1);
        break;
      }
      case 'tangent': {
        scope.surfaceData.debugColor = pb.vec4(pb.add(pb.mul(scope.surfaceData.TBN[0], 0.5), pb.vec3(0.5)), 1);
        break;
      }
      case 'binormal': {
        scope.surfaceData.debugColor = pb.vec4(pb.add(pb.mul(scope.surfaceData.TBN[1], 0.5), pb.vec3(0.5)), 1);
        break;
      }
      case 'shadingNormal': {
        scope.surfaceData.debugColor = pb.vec4(pb.add(pb.mul(scope.surfaceData.normal, 0.5), pb.vec3(0.5)), 1);
        break;
      }
    }
  }
  /**
   * Creates the surface data type
   * @param env - The environment lighting object
   * @returns The surface data type
   */
  protected createSurfaceDataType(env: EnvironmentLighting): PBStructTypeInfo {
    const debugColor = Material.debugChannel ? [{
      name: 'debugColor',
      type: typeF32Vec4
    }] : [];
    return new PBStructTypeInfo('', 'default', [
      {
        name: 'diffuse',
        type: typeF32Vec4
      },
      {
        name: 'normal',
        type: typeF32Vec3
      },
      {
        name: 'viewVec',
        type: typeF32Vec3
      },
      {
        name: 'NdotV',
        type: typeF32
      },
      {
        name: 'TBN',
        type: typeMat3
      },
      {
        name: 'accumDiffuse',
        type: typeF32Vec3
      },
      {
        name: 'accumSpecular',
        type: typeF32Vec3
      },
      {
        name: 'accumEmissive',
        type: typeF32Vec3
      },
      {
        name: 'accumColor',
        type: typeF32Vec3
      },
      ...debugColor
    ]);
  }
  /**
   * Check if specified texture is being used
   * @param name - The texture name
   * @returns true if the texture is being used
   */
  isTextureUsed(name: string): boolean {
    return !!this._textureOptions[name]?.texture;
  }
  /**
   * Initial fill the surface data of current fragment
   * @param scope - The shader scope
   * @param envLight - The environment lighting object
   */
  protected fillSurfaceData(
    scope: PBInsideFunctionScope,
    envLight: EnvironmentLighting
  ) {
    // to be overriden
    if (Material.debugChannel) {
      scope.surfaceData.debugColor = scope.$builder.vec4(scope.surfaceData.diffuse.rgb, 1);
    }
  }
  /**
   * Update all texture uniforms
   * @param bindGroup - The bind group
   */
  protected applyTextureUniforms(bindGroup: BindGroup) {
    for (const k in this._textureOptions) {
      if (this.isTextureUsed(k)) {
        const uniformName = this.getTextureUniformName(k);
        const info = this._textureOptions[k];
        bindGroup.setTexture(uniformName, info.texture, info.sampler);
      }
    }
  }
  /**
   * Setup all texture uniforms
   * @param scope - The shader scope
   */
  protected setupTextureUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    for (const k in this._textureOptions) {
      if (this.isTextureUsed(k)) {
        const uniformName = this.getTextureUniformName(k);
        const texture = this._textureOptions[k].texture;
        let exp: PBShaderExp;
        if (texture.isTexture2D()) {
          exp = pb.tex2D().uniform(2);
        } else if (texture.isTextureCube()) {
          exp = pb.texCube().uniform(2);
        } else if (texture.isTexture3D()) {
          exp = pb.tex3D().uniform(2);
        } else if (texture.isTexture2DArray()) {
          exp = pb.tex2DArray().uniform(2);
        } else if (texture.isTextureVideo()) {
          exp = pb.texExternal().uniform(2);
        } else {
          throw new Error('Unsupported light model texture type');
        }
        if (!texture.isFilterable()) {
          exp.sampleType('unfilterable-float');
        }
        scope[uniformName] = exp;
      }
    }
  }
  /** @internal */
  protected addTexCoordChannel(srcLocation: number, transform?: Matrix4x4): number {
    transform = transform || Matrix4x4.identity();
    let index = this._texCoordChannels.findIndex(
      (val) => val.srcLocation === srcLocation && val.transform.equalsTo(transform)
    );
    if (index < 0) {
      index = this._texCoordChannels.length;
      this._texCoordChannels.push({
        srcLocation,
        transform: new Matrix4x4(transform)
      });
    }
    return index;
  }
  /** @internal */
  protected calculatePixelNormal(scope: PBInsideFunctionScope, TBN: PBShaderExp): PBShaderExp {
    const pixelNormal = this.calculateNormalWithTBN(scope, scope.$inputs[`texcoord${this.normalMapTexCoord}`], TBN);
    const pb = scope.$builder;
    return pb.defineStruct([pb.mat3('TBN'), pb.vec3('normal')])(TBN, pixelNormal)
  }
  /**
   * Notifies that the options has changed
   * @param changeHash - true if the shader need to be rebuild
   */
  protected optionChanged(changeHash: boolean) {
    this._uniformVersion++;
    if (changeHash) {
      this._hash = null;
      this._surfaceDataType = null;
      this._hashVersion++;
    }
  }
  /**
   * Checks if the specified texture coordinate index is being used
   * @param texCoordIndex - The texture coordinate index
   * @returns true if the texture coordinate index is being used
   */
  isTexCoordIndexUsed(texCoordIndex: number): boolean {
    return typeof this._texCoordChannels[texCoordIndex]?.srcLocation === 'number';
  }
  /**
   * Checks if the specified texture coordinate location is being used
   * @param loc - The texture coordinate location
   * @returns true if the texture coordinate location is being used
   */
  isTexCoordSrcLocationUsed(loc: number): boolean {
    return this._texCoordChannels.findIndex((val) => val.srcLocation === loc) >= 0;
  }
  /**
   * Gets the location of a given texture coordinate index
   * @param texCoordIndex - The texture coordinate index
   * @returns The location of the given texture coordinate index
   */
  getTexCoordSrcLocation(texCoordIndex: number) {
    return this._texCoordChannels[texCoordIndex].srcLocation;
  }
  /**
   * Checks if normal vector is being used
   * @returns true if normal vector is being used
   */
  isNormalUsed(): boolean {
    return true;
  }
  /**
   * Updates uniforms of the shader program if needed
   * @param bindGroup - The bind group
   * @param ctx - The drawing context
   */
  applyUniformsIfOutdated(bindGroup: BindGroup, ctx: DrawContext) {
    const tags = this._bindGroupTagList.get(bindGroup);
    if (!tags || tags[0] !== this._uniformVersion || tags[1] !== bindGroup.cid) {
      if (tags) {
        tags[0] = this._uniformVersion;
        tags[1] = bindGroup.cid;
      } else {
        this._bindGroupTagList.set(bindGroup, [this._uniformVersion, bindGroup.cid]);
      }
      this.applyUniforms(bindGroup, ctx);
    }
  }
}

/**
 * Unlit light model
 * @public
 */
export class UnlitLightModel extends LightModel {
  /**
   * {@inheritDoc LightModel.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return false;
  }
  /**
   * {@inheritDoc LightModel.envBRDF}
   * @override
   */
  envBRDF(envLight: EnvironmentLighting, scope: PBInsideFunctionScope): void {}
  /**
   * {@inheritDoc LightModel.directBRDF}
   * @override
   */
  directBRDF(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    attenuation: PBShaderExp
  ): void {}
  /**
   * {@inheritDoc LightModel.isNormalUsed}
   * @override
   */
  isNormalUsed(): boolean {
    return false;
  }
  /**
   * {@inheritDoc LightModel.compositeSurfaceData}
   * @override
   */
  protected compositeSurfaceData(scope: PBInsideFunctionScope) {
    scope.surfaceData.accumColor = scope.surfaceData.diffuse.rgb;
    super.compositeSurfaceData(scope);
  }
}

/**
 * Lambert light model
 * @public
 */
export class LambertLightModel extends LightModel {
  protected static readonly funcNameBRDFEnvIBL = 'lib_lambertLM_envIBL';
  protected static readonly funcNameBRDFDirect = 'lib_lambertLM_direct';
  /**
   * {@inheritDoc LightModel.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;
  }
  /**
   * {@inheritDoc LightModel.envBRDF}
   * @override
   */
  envBRDF(envLight: EnvironmentLighting, scope: PBInsideFunctionScope): void {
    const pb = scope.$builder;
    if (envLight?.hasIrradiance()) {
      scope.surfaceData.accumDiffuse = pb.add(scope.surfaceData.accumDiffuse, pb.mul(envLight.getIrradiance(scope, scope.surfaceData.normal).rgb, scope.surfaceData.diffuse.rgb, ShaderFramework.getEnvLightStrength(scope)));
    }
  }
  /**
   * {@inheritDoc LightModel.directBRDF}
   * @override
   */
  directBRDF(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    attenuation: PBShaderExp
  ): void {
    const pb = scope.$builder;
    pb.func(
      LambertLightModel.funcNameBRDFDirect,
      [pb.vec3('attenuation')],
      function () {
        this.surfaceData.accumDiffuse = pb.add(
          this.surfaceData.accumDiffuse,
          pb.mul(this.surfaceData.diffuse.rgb, this.attenuation)
        );
      }
    );
    pb.getGlobalScope()[LambertLightModel.funcNameBRDFDirect](attenuation);
  }
}

/**
 * Blinn-phong light model
 * @public
 */
export class BlinnLightModel extends LightModel {
  protected static readonly funcNameBRDFEnvIBL = 'lib_blinnLM_envIBL';
  protected static readonly funcNameBRDFDirect = 'lib_blinnLM_direct';
  /** @internal */
  protected _shininess: number;
  /**
   * Creates an instance of BlinnLightModel
   */
  constructor() {
    super();
    this._shininess = 32;
  }
  /** Shininess */
  get shininess(): number {
    return this._shininess;
  }
  set shininess(val: number) {
    this._shininess = val;
  }
  /**
   * {@inheritDoc LightModel.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;
  }
  /**
   * {@inheritDoc LightModel.setupUniforms}
   * @override
   */
  setupUniforms(scope: PBGlobalScope, ctx: DrawContext): void {
    super.setupUniforms(scope, ctx);
    if (scope.$builder.shaderKind === 'fragment') {
      scope.shininess = scope.$builder.float().uniform(2);
    }
  }
  /**
   * {@inheritDoc LightModel.applyUniforms}
   * @override
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext) {
    super.applyUniforms(bindGroup, ctx);
    bindGroup.setValue('shininess', this._shininess);
  }
  /**
   * {@inheritDoc LightModel.envBRDF}
   * @override
   */
  envBRDF(envLight: EnvironmentLighting, scope: PBInsideFunctionScope): void {
    const pb = scope.$builder;
    if (envLight?.hasIrradiance()) {
      scope.surfaceData.accumDiffuse = pb.add(scope.surfaceData.accumDiffuse, pb.mul(envLight.getIrradiance(scope, scope.surfaceData.normal).rgb, scope.surfaceData.diffuse.rgb, ShaderFramework.getEnvLightStrength(scope)));
    }
    /*
    if (envLight?.hasRadiance()) {
      const refl = pb.reflect(pb.neg(scope.surfaceData.viewVec), scope.surfaceData.normal);
      const roughness = pb.sub(1, pb.clamp(pb.div(scope.shininess, 64), 0, 1));
      scope.surfaceData.accumSpecular = pb.add(scope.surfaceData.accumSpecular, envLight.getRadiance(scope, refl, roughness));
    }
    */
  }
  /**
   * {@inheritDoc LightModel.directBRDF}
   * @override
   */
  directBRDF(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    attenuation: PBShaderExp
  ): void {
    const pb = scope.$builder;
    pb.func(
      BlinnLightModel.funcNameBRDFDirect,
      [pb.vec3('lightDir'), pb.vec3('attenuation')],
      function () {
        this.$l.halfVec = pb.normalize(pb.sub(this.surfaceData.viewVec, this.lightDir));
        this.$l.NdotH = pb.clamp(pb.dot(this.surfaceData.normal, this.halfVec), 0, 1);
        this.$l.outDiffuse = pb.mul(this.surfaceData.diffuse.rgb, this.attenuation);
        this.$l.outSpecular = pb.mul(this.attenuation, pb.pow(this.NdotH, this.shininess));
        this.surfaceData.accumSpecular = pb.add(this.surfaceData.accumSpecular, this.outSpecular);
        this.surfaceData.accumDiffuse = pb.add(this.surfaceData.accumDiffuse, this.outDiffuse);
      }
    );
    pb.getGlobalScope()[BlinnLightModel.funcNameBRDFDirect](lightDir, attenuation);
  }
}

/**
 * Base class for PBR light model
 * @public
 */
export abstract class PBRLightModelBase extends LightModel {
  /** @internal */
  private static readonly funcNameCalcPBRLight = 'lib_PBRLM_calcPBRLight';
  /** @internal */
  private static readonly funcNameIllumEnvLight = 'lib_PBRLM_illumEnvLight_pbr';
  /** @internal */
  private static readonly uniformF0 = 'PBRLM_f0';
  /** @internal */
  private static readonly uniformOcclusionStrength = 'PBRLM_occlusionStrength';
  /** @internal */
  protected static readonly uniformSheenFactor = 'lib_PBRLM_sheenFactor';
  /** @internal */
  protected static readonly uniformClearcoatFactor = 'lib_PBRLM_clearcoatFactor';
  /** @internal */
  protected static readonly uniformClearcoatNormalScale = 'lib_PBRLM_clearcoatNormalScale';
  /** @internal */
  protected static ggxLut: Texture2D = null;
  /** @internal */
  protected _f0: Vector4;
  /** @internal */
  protected _occlusionStrength: number;
  /** @internal */
  protected _sheen: boolean;
  /** @internal */
  protected _sheenFactor: Vector4;
  /** @internal */
  protected _clearcoat: boolean;
  /** @internal */
  protected _clearcoatFactor: Vector4;
  /** @internal */
  static getGGXLUT() {
    if (!this.ggxLut) {
      this.ggxLut = this.createGGXLUT(Application.instance.device, 1024);
    }
    return this.ggxLut;
  }
  /** @internal */
  static createGGXLUT(device: AbstractDevice, size: number) {
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
        pb.func('generateTBN', [pb.vec3('normal')], function(){
          this.$l.bitangent = pb.vec3(0, 1, 0);
          this.$l.NoU = this.normal.y;
          this.$l.epsl = 0.0000001;
          this.$if(pb.lessThanEqual(pb.sub(1, pb.abs(this.normal.y)), this.epsl), function(){
            this.bitangent = this.$choice(pb.greaterThan(this.normal.y, 0), pb.vec3(0, 0, 1), pb.vec3(0, 0, -1));
          });
          this.$l.tangent = pb.normalize(pb.cross(this.bitangent, this.normal));
          this.bitangent = pb.cross(this.normal, this.tangent);
          this.$return(pb.mat3(this.tangent, this.bitangent, this.normal));
        });
        pb.func('D_Charlie', [pb.float('sheenRoughness'), pb.float('NdotH')], function(){
          this.$l.roughness = pb.max(this.sheenRoughness, 0.000001);
          this.$l.invR = pb.div(1, this.roughness);
          this.$l.cos2h = pb.mul(this.NdotH, this.NdotH);
          this.$l.sin2h = pb.sub(1, this.cos2h);
          this.$return(pb.div(pb.mul(pb.add(this.invR, 2), pb.pow(this.sin2h, pb.mul(this.invR, 0.5))), Math.PI * 2));
        });
        pb.func('smithGGXCorrelated', [pb.float('NoV'), pb.float('NoL'), pb.float('roughness')], function(){
          this.$l.a2 = pb.mul(this.roughness, this.roughness, this.roughness, this.roughness);
          this.$l.GGXV = pb.mul(this.NoL, pb.sqrt(pb.add(pb.mul(this.NoV, this.NoV, pb.sub(1, this.a2)), this.a2)));
          this.$l.GGXL = pb.mul(this.NoV, pb.sqrt(pb.add(pb.mul(this.NoL, this.NoL, pb.sub(1, this.a2)), this.a2)));
          this.$return(pb.div(0.5, pb.add(this.GGXV, this.GGXL)));
        });
        pb.func('V_Ashikhmin', [pb.float('NdotL'), pb.float('NdotV')], function(){
          this.$return(pb.clamp(pb.div(1, pb.mul(pb.sub(pb.add(this.NdotL, this.NdotV), pb.mul(this.NdotL, this.NdotV)), 4)), 0, 1));
        });
        pb.func('importanceSample', [pb.vec2('xi'), pb.vec3('normal'), pb.float('roughness'), pb.vec3('ggx').out(), pb.vec3('charlie').out()], function(){
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
        pb.func('integrateBRDF', [pb.float('NoV'), pb.float('roughness')], function(){
          this.$l.V = pb.vec3(pb.sub(1, pb.mul(this.NoV, this.NoV)), 0, this.NoV);
          this.$l.a = pb.float(0);
          this.$l.b = pb.float(0);
          this.$l.c = pb.float(0);
          this.$l.n = pb.vec3(0, 0, 1);
          this.$for(pb.int('i'), 0, SAMPLE_COUNT, function(){
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
            this.$if(pb.greaterThan(this.ggxNoL, 0), function(){
              this.$l.pdf = pb.div(pb.mul(this.smithGGXCorrelated(this.NoV, this.ggxNoL, this.roughness), this.ggxVoH, this.ggxNoL), this.ggxNoH);
              this.$l.Fc = pb.pow(pb.sub(1, this.ggxVoH), 5);
              this.a = pb.add(this.a, pb.mul(pb.sub(1, this.Fc), this.pdf));
              this.b = pb.add(this.b, pb.mul(this.Fc, this.pdf));
            });
            this.$if(pb.greaterThan(this.charlieNoL, 0), function(){
              this.$l.sheenDistribution = this.D_Charlie(this.roughness, this.charlieNoH);
              this.$l.sheenVis = this.V_Ashikhmin(this.charlieNoL, this.NoV);
              this.c = pb.add(this.c, pb.mul(this.sheenVis, this.sheenDistribution, this.charlieNoL, this.charlieVoH));
            });
          });
          this.$return(pb.div(pb.vec3(pb.mul(this.a, 4), pb.mul(this.b, 4), pb.mul(this.c, 8 * Math.PI)), SAMPLE_COUNT));
        });
        pb.main(function(){
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
  /**
   * Creates an instance of PBRLightModelBase
   */
  constructor() {
    super();
    this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
    this._sheen = false;
    this._sheenFactor = Vector4.zero();
    this._clearcoat = false;
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
      if (this.occlusionMap) {
        this.optionChanged(false);
      }
    }
  }
  /** The occlusion texture */
  get occlusionMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_OCCLUSION]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the occlusion texture */
  get occlusionSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_OCCLUSION]?.sampler ?? null;
  }
  /** Texture coordinate index of the occlusion texture */
  get occlusionMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_OCCLUSION]?.texCoordIndex ?? null;
  }
  /**
   * Sets the occlusion texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setOcclusionMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_OCCLUSION, tex, sampler, texCoordIndex, texTransform);
  }
  /** true if sheen lighting is being used */
  get useSheen(): boolean {
    return this._sheen;
  }
  set useSheen(val: boolean) {
    if (this._sheen !== !!val) {
      this._sheen = !!val;
      this.optionChanged(true);
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
      if (this._sheen) {
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
      if (this._sheen) {
        this.optionChanged(false);
      }
    }
  }
  /** Lut texture for sheen lighting */
  get sheenLut(): Texture2D {
    return (this._textureOptions[TEX_NAME_SHEEN_LUT]?.texture as Texture2D) ?? null;
  }
  /**
   * Sets the lut texture for sheen lighting
   * @param tex - The texture to set
   */
  setSheenLut(tex: Texture2D) {
    this.setTextureOptions(TEX_NAME_SHEEN_LUT, tex, null, 0, null);
  }
  /** The sheen color texture */
  get sheenColorMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_SHEEN_COLOR]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the sheen color texture */
  get sheenColorSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_SHEEN_COLOR]?.sampler ?? null;
  }
  /** Texture coordinate index of the sheen color texture */
  get sheenColorMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_SHEEN_COLOR]?.texCoordIndex ?? null;
  }
  /**
   * Sets the sheen color texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setSheenColorMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_SHEEN_COLOR, tex, sampler, texCoordIndex, texTransform);
  }
  /** The sheen roughness texture */
  get sheenRoughnessMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_SHEEN_ROUGHNESS]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the sheen roughness texture */
  get sheenRoughnessSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_SHEEN_ROUGHNESS]?.sampler ?? null;
  }
  get sheenRoughnessMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_SHEEN_ROUGHNESS]?.texCoordIndex ?? null;
  }
  /**
   * Sets the sheen roughness texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setSheenRoughnessMap(
    tex: Texture2D,
    sampler: TextureSampler,
    texCoordIndex: number,
    texTransform?: Matrix4x4
  ) {
    this.setTextureOptions(TEX_NAME_SHEEN_ROUGHNESS, tex, sampler, texCoordIndex, texTransform);
  }
  /** true if the clearcoat lighting is enabled */
  get useClearcoat(): boolean {
    return this._clearcoat;
  }
  set useClearcoat(val: boolean) {
    if (this._clearcoat !== !!val) {
      this._clearcoat = !!val;
      this.optionChanged(true);
    }
  }
  /** Intensity of clearcoat lighting */
  get clearcoatIntensity(): number {
    return this._clearcoatFactor.x;
  }
  set clearcoatIntensity(val: number) {
    if (val !== this._clearcoatFactor.x) {
      this._clearcoatFactor.x = val;
      if (this._clearcoat) {
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
      if (this._clearcoat) {
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
      if (this._clearcoat) {
        this.optionChanged(false);
      }
    }
  }
  /** The clearcoat intensity texture  */
  get clearcoatIntensityMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_CLEARCOAT_INTENSITY]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the clearcoat intensity texture */
  get clearcoatIntensitySampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_CLEARCOAT_INTENSITY]?.sampler ?? null;
  }
  /** Texture coordinate index of the clearcoat intensity texture */
  get clearcoatIntensityMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_CLEARCOAT_INTENSITY]?.texCoordIndex ?? null;
  }
  /**
   * Sets the clearcoat intensity texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrox for texture coordinates of the texture
   */
  setClearcoatIntensityMap(
    tex: Texture2D,
    sampler: TextureSampler,
    texCoordIndex: number,
    texTransform?: Matrix4x4
  ) {
    this.setTextureOptions(TEX_NAME_CLEARCOAT_INTENSITY, tex, sampler, texCoordIndex, texTransform);
  }
  /** The clearcoat roughness texture */
  get clearcoatRoughnessMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_CLEARCOAT_ROUGHNESS]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the clearcoat roughness texture */
  get clearcoatRoughnessSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_CLEARCOAT_ROUGHNESS]?.sampler ?? null;
  }
  /** Texture coordinate index of the clearcoat roughness texture */
  get clearcoatRoughnessMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_CLEARCOAT_ROUGHNESS]?.texCoordIndex ?? null;
  }
  /**
   * Sets the clearcoat roughness texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setClearcoatRoughnessMap(
    tex: Texture2D,
    sampler: TextureSampler,
    texCoordIndex: number,
    texTransform?: Matrix4x4
  ) {
    this.setTextureOptions(TEX_NAME_CLEARCOAT_ROUGHNESS, tex, sampler, texCoordIndex, texTransform);
  }
  /** The clearcoat normal texture */
  get clearcoatNormalMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_CLEARCOAT_NORMAL]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the clearcoat normal texture */
  get clearcoatNormalSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_CLEARCOAT_NORMAL]?.sampler ?? null;
  }
  /** Texture coordinate index of the clearcoat normal texture */
  get clearcoatNormalMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_CLEARCOAT_NORMAL]?.texCoordIndex ?? null;
  }
  /**
   * Sets the clearcoat normal texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setClearcoatNormalMap(
    tex: Texture2D,
    sampler: TextureSampler,
    texCoordIndex: number,
    texTransform?: Matrix4x4
  ) {
    this.setTextureOptions(TEX_NAME_CLEARCOAT_NORMAL, tex, sampler, texCoordIndex, texTransform);
  }
  /**
   * {@inheritDoc LightModel.calculateHash}
   * @override
   */
  calculateHash(): string {
    const occlusionHash = this.occlusionMap ? this.occlusionMapTexCoord + 1 : 0;
    const ccIntensityHash = this.clearcoatIntensityMap ? this.clearcoatIntensityMapTexCoord + 1 : 0;
    const ccRoughnessHash = this.clearcoatRoughnessMap ? this.clearcoatRoughnessMapTexCoord + 1 : 0;
    const ccNormalHash = this.clearcoatNormalMap ? this.clearcoatNormalMapTexCoord + 1 : 0;
    const ccHash = this.useClearcoat ? `(${ccIntensityHash}-${ccRoughnessHash}-${ccNormalHash})` : '';
    const sheenColorHash = this.sheenColorMap ? this.sheenColorMapTexCoord + 1 : 0;
    const sheenRoughnessHash = this.sheenRoughnessMap ? this.sheenRoughnessMapTexCoord + 1 : 0;
    const sheenHash = this.useSheen ? `(${sheenColorHash}-${sheenRoughnessHash})` : '';
    return `${super.calculateHash()}_${occlusionHash}_${sheenHash}_${ccHash}`;
  }
  /**
   * {@inheritDoc LightModel.setupUniforms}
   * @override
   */
  setupUniforms(scope: PBGlobalScope, ctx: DrawContext): void {
    super.setupUniforms(scope, ctx);
    if (scope.$builder.shaderKind === 'fragment') {
      if (ctx.drawEnvLight) {
        scope.ggxLut = scope.$builder.tex2D().uniform(2);
      }
      scope.lm_f0 = scope.$builder.vec4().uniform(2).tag(PBRLightModelBase.uniformF0);
      if (this.occlusionMap) {
        scope.lm_occlusionStrength = scope.$builder
          .float()
          .uniform(2)
          .tag(PBRLightModelBase.uniformOcclusionStrength);
      }
      if (this._sheen) {
        scope.lm_sheenFactor = scope.$builder.vec4().uniform(2).tag(PBRLightModelBase.uniformSheenFactor);
      }
      if (this._clearcoat) {
        scope.lm_clearcoatFactor = scope.$builder
          .vec4()
          .uniform(2)
          .tag(PBRLightModelBase.uniformClearcoatFactor);
      }
    }
  }
  /**
   * {@inheritDoc LightModel.applyUniforms}
   * @override
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext) {
    super.applyUniforms(bindGroup, ctx);
    if (ctx.drawEnvLight) {
      bindGroup.setTexture('ggxLut', PBRLightModelBase.getGGXLUT());
    }
    bindGroup.setValue('lm_f0', this._f0);
    if (this.occlusionMap) {
      bindGroup.setValue('lm_occlusionStrength', this._occlusionStrength);
    }
    if (this._sheen) {
      bindGroup.setValue('lm_sheenFactor', this._sheenFactor);
    }
    if (this._clearcoat) {
      bindGroup.setValue('lm_clearcoatFactor', this._clearcoatFactor);
    }
  }
  /**
   * {@inheritDoc LightModel.createSurfaceDataType}
   * @override
   */
  protected createSurfaceDataType(env: EnvironmentLighting): PBStructTypeInfo {
    const type = super.createSurfaceDataType(env);
    const props = [
      {
        name: 'metallic',
        type: typeF32
      },
      {
        name: 'roughness',
        type: typeF32
      },
      {
        name: 'f0',
        type: typeF32Vec4
      },
      {
        name: 'f90',
        type: typeF32Vec3
      },
      {
        name: 'occlusion',
        type: typeF32Vec4
      },
      {
        name: 'irradiance',
        type: typeF32Vec3
      },
      {
        name: 'radiance',
        type: typeF32Vec3
      },
    ];
    if (env) {
      props.push({
        name: 'ggxLutSample',
        type: typeF32Vec4
      });
    }
    if (this._sheen) {
      props.push(
        {
          name: 'sheenColor',
          type: typeF32Vec3
        },
        {
          name: 'sheenRoughness',
          type: typeF32
        },
        {
          name: 'sheenAlbedoScaling',
          type: typeF32
        },
        {
          name: 'sheenContrib',
          type: typeF32Vec3
        },
      );
    }
    if (this._clearcoat) {
      props.push(
        {
          name: 'clearcoatFactor',
          type: typeF32Vec4
        },
        {
          name: 'clearcoatNormal',
          type: typeF32Vec3
        },
        {
          name: 'clearcoatNdotV',
          type: typeF32
        },
        {
          name: 'clearcoatFresnel',
          type: typeF32Vec3
        },
        {
          name: 'clearcoatContrib',
          type: typeF32Vec3
        },
        {
          name: 'radianceClearcoat',
          type: typeF32Vec3
        }
      );
      if (env) {
        props.push({
          name: 'clearcoatGGXLutSample',
          type: typeF32Vec4
        });
      }
    }
    return props.length > 0 ? type.extends('', props) : type;
  }
  /**
   * {@inheritDoc LightModel.fillSurfaceData}
   * @override
   */
  protected fillSurfaceData(
    scope: PBInsideFunctionScope,
    envLight: EnvironmentLighting
  ) {
    super.fillSurfaceData(scope, envLight);
    const funcNameFillSurfaceDataPBRCommon = 'lib_fillSurfaceDataPBRCommon';
    const pb = scope.$builder;
    const that = this;
    pb.func(
      funcNameFillSurfaceDataPBRCommon,
      [],
      function () {
        this.surfaceData.f0 = this.$query(PBRLightModelBase.uniformF0);
        this.surfaceData.f90 = pb.vec3(1);
        const strength = ShaderFramework.getEnvLightStrength(this);
        if (that.occlusionMap) {
          const occlusionStrength = this.$query(PBRLightModelBase.uniformOcclusionStrength);
          const texCoord = this.$inputs[`texcoord${that.occlusionMapTexCoord ?? that.albedoMapTexCoord}`];
          this.surfaceData.occlusion = pb.textureSample(
            this[that.getTextureUniformName(TEX_NAME_OCCLUSION)],
            texCoord
          );
          this.surfaceData.occlusion.r = pb.mul(
            pb.add(pb.mul(occlusionStrength, pb.sub(this.surfaceData.occlusion.r, 1)), 1),
            strength
          );
        } else {
          this.surfaceData.occlusion = pb.vec4(strength);
        }
        if (that.useClearcoat) {
          this.surfaceData.clearcoatFactor = this.$query(PBRLightModelBase.uniformClearcoatFactor);
          if (that.clearcoatNormalMap) {
            const clearcoatNormalMap = this[that.getTextureUniformName(TEX_NAME_CLEARCOAT_NORMAL)];
            const texCoord =
              this.$inputs[`texcoord${that.clearcoatNormalMapTexCoord ?? that.albedoMapTexCoord}`];
            this.$l.ccNormal = pb.sub(
              pb.mul(pb.textureSample(clearcoatNormalMap, texCoord).rgb, 2),
              pb.vec3(1)
            );
            this.ccNormal = pb.mul(
              this.ccNormal,
              pb.vec3(this.surfaceData.clearcoatFactor.z, this.surfaceData.clearcoatFactor.z, 1)
            );
            this.surfaceData.clearcoatNormal = pb.normalize(pb.mul(this.surfaceData.TBN, this.ccNormal));
            this.surfaceData.clearcoatNdotV = pb.clamp(
              pb.dot(this.surfaceData.clearcoatNormal, this.surfaceData.viewVec),
              0.0001,
              1
            );
          } else {
            this.surfaceData.clearcoatNormal = this.surfaceData.TBN[2];
            this.surfaceData.clearcoatNdotV = this.surfaceData.NdotV;
          }
          if (that.clearcoatIntensityMap) {
            const clearcoatIntensityMap = this[that.getTextureUniformName(TEX_NAME_CLEARCOAT_INTENSITY)];
            const texCoord =
              this.$inputs[`texcoord${that.clearcoatIntensityMapTexCoord ?? that.albedoMapTexCoord}`];
            this.surfaceData.clearcoatFactor.x = pb.mul(
              this.surfaceData.clearcoatFactor.x,
              pb.textureSample(clearcoatIntensityMap, texCoord).r
            );
          }
          if (that.clearcoatRoughnessMap) {
            const clearcoatRoughnessMap = this[that.getTextureUniformName(TEX_NAME_CLEARCOAT_ROUGHNESS)];
            const texCoord =
              this.$inputs[`texcoord${that.clearcoatRoughnessMapTexCoord ?? that.albedoMapTexCoord}`];
            this.surfaceData.clearcoatFactor.y = pb.mul(
              this.surfaceData.clearcoatFactor.y,
              pb.textureSample(clearcoatRoughnessMap, texCoord).g
            );
          }
          this.surfaceData.clearcoatFactor.y = pb.clamp(this.surfaceData.clearcoatFactor.y, 0, 1);
          this.surfaceData.clearcoatContrib = pb.vec3(0);
          if (envLight) {
            this.surfaceData.clearcoatGGXLutSample = pb.clamp(pb.textureSample(this.ggxLut, pb.vec2(this.surfaceData.NdotV, this.surfaceData.clearcoatFactor.y)), pb.vec4(0), pb.vec4(1));
          }
          // clearcoatFresnel/radianceClearcoat will be set after f0 and f90 are set
        }
        if (that._sheen) {
          this.$l.sheenColor = this.$query(PBRLightModelBase.uniformSheenFactor).rgb;
          this.$l.sheenRoughness = this.$query(PBRLightModelBase.uniformSheenFactor).a;
          if (that.sheenColorMap) {
            const sheenColorMap = this[that.getTextureUniformName(TEX_NAME_SHEEN_COLOR)];
            const texCoord =
              this.$inputs[`texcoord${that.sheenColorMapTexCoord ?? that.albedoMapTexCoord}`];
            this.$l.sheenColor = pb.mul(this.$l.sheenColor, pb.textureSample(sheenColorMap, texCoord).rgb);
          }
          if (that.sheenRoughnessMap) {
            const sheenRoughnessMap = this[that.getTextureUniformName(TEX_NAME_SHEEN_ROUGHNESS)];
            const texCoord =
              this.$inputs[`texcoord${that.sheenRoughnessMapTexCoord ?? that.albedoMapTexCoord}`];
            this.$l.sheenRoughness = pb.mul(
              this.$l.sheenRoughness,
              pb.textureSample(sheenRoughnessMap, texCoord).a
            );
          }
          if (that.sheenLut) {
            const sheenLut = this[that.getTextureUniformName(TEX_NAME_SHEEN_LUT)];
            this.$l.sheenDFG = pb.textureSample(
              sheenLut,
              pb.vec2(this.surfaceData.NdotV, this.sheenRoughness)
            ).b;
          } else {
            this.$l.sheenDFG = 0.157;
          }
          this.surfaceData.sheenAlbedoScaling = pb.sub(
            1,
            pb.mul(pb.max(pb.max(this.sheenColor.r, this.sheenColor.g), this.sheenColor.b), this.sheenDFG)
          );
          this.surfaceData.sheenColor = this.sheenColor;
          this.surfaceData.sheenRoughness = this.sheenRoughness;
          this.surfaceData.sheenContrib = pb.vec3(0);
          /*
          this.$l.k = pb.clamp(pb.textureSample(this.ggxLut, pb.vec2(this.surfaceData.NdotV, this.surfaceData.sheenRoughness)), pb.vec4(0), pb.vec4(1)).b;
          this.surfaceData.sheenAlbedoScaling = pb.sub(1, pb.mul(this.k, pb.max(pb.max(this.surfaceData.sheenColor.r, this.surfaceData.sheenColor.g), this.surfaceData.sheenColor.b)));
          */
        }
      }
    );
    pb.getGlobalScope()[funcNameFillSurfaceDataPBRCommon]();
  }
  protected iblSpecular(scope: PBInsideFunctionScope, brdf: PBShaderExp, f0: PBShaderExp, radiance: PBShaderExp, NdotV: PBShaderExp|number, roughness: PBShaderExp|number, specularWeight: PBShaderExp|number): PBShaderExp {
    const pb = scope.$builder;
    const funcName = 'lib_PBRLM_iblspecular_pbr';
    pb.func(
      funcName,
      [pb.vec4('brdf'), pb.vec3('f0'), pb.vec3('radiance'), pb.float('NdotV'), pb.float('roughness'), pb.float('specularWeight')],
      function () {
        this.$l.f_ab = this.brdf.rg;
        this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
        this.$l.k_S = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NdotV), 5)));
        this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
        this.$return(pb.mul(this.radiance, this.FssEss, this.specularWeight));
      }
    );
    return pb.getGlobalScope()[funcName](brdf, f0, radiance, NdotV, roughness, specularWeight);
  }
  protected iblDiffuse(scope: PBInsideFunctionScope, brdf: PBShaderExp, f0: PBShaderExp, diffuse: PBShaderExp, irradiance: PBShaderExp, NdotV: PBShaderExp|number, roughness: PBShaderExp|number, specularWeight: PBShaderExp|number): PBShaderExp {
    const pb = scope.$builder;
    const funcName = 'lib_PBRLM_ibldiffuse_pbr';
    pb.func(
      funcName,
      [pb.vec4('brdf'), pb.vec3('f0'), pb.vec3('diffuse'), pb.vec3('irradiance'), pb.float('NdotV'), pb.float('roughness'), pb.float('specularWeight')],
      function () {
        this.$l.f_ab = this.brdf.rg;
        this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
        this.$l.k_S = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NdotV), 5)));
        this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x, this.specularWeight), pb.vec3(this.f_ab.y));
        this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
        this.$l.F_avg = pb.mul(pb.add(this.f0, pb.div(pb.sub(pb.vec3(1), this.f0), 21)), this.specularWeight);
        this.$l.FmsEms = pb.div(pb.mul(this.FssEss, this.F_avg, this.Ems), pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems)));
        this.$l.k_D = pb.mul(this.diffuse, pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms));
        this.$return(pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance));
      }
    );
    return pb.getGlobalScope()[funcName](brdf, f0, diffuse, irradiance, NdotV, roughness, specularWeight);
  }
  /** @internal */
  protected illumEnvLight(scope: PBInsideFunctionScope, envLight: EnvironmentLighting) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      PBRLightModelBase.funcNameIllumEnvLight,
      [],
      function () {
        if (envLight.hasRadiance()) {
          this.$l.iblSpecular = that.iblSpecular(this, this.surfaceData.ggxLutSample, this.surfaceData.f0.rgb, this.surfaceData.radiance, this.surfaceData.NdotV, this.surfaceData.roughness, this.surfaceData.specularWeight);
          this.surfaceData.accumSpecular = pb.add(
            this.surfaceData.accumSpecular,
            pb.mul(this.iblSpecular, this.surfaceData.occlusion.r)
          );
        }
        if (envLight.hasIrradiance()) {
          this.$l.iblDiffuse = that.iblDiffuse(this, this.surfaceData.ggxLutSample, this.surfaceData.f0.rgb, this.surfaceData.diffuse.rgb, this.surfaceData.irradiance, this.surfaceData.NdotV, this.surfaceData.roughness, this.surfaceData.specularWeight);
          this.surfaceData.accumDiffuse = pb.add(
            this.surfaceData.accumDiffuse,
            pb.mul(this.iblDiffuse, this.surfaceData.occlusion.r)
          );
        }
        if (that._clearcoat) {
          this.$l.ccSpecular = that.iblSpecular(this, this.surfaceData.ggxLutSample, this.surfaceData.f0.rgb, this.surfaceData.radianceClearcoat, this.surfaceData.clearcoatNdotV, this.surfaceData.clearcoatFactor.y, 1);
          this.surfaceData.clearcoatContrib = pb.add(
            this.surfaceData.clearcoatContrib,
            pb.mul(this.ccSpecular, this.surfaceData.occlusion.r)
          );
        }
        if (envLight.hasIrradiance() && that._sheen) {
          this.$l.refl = pb.reflect(pb.neg(this.surfaceData.viewVec), this.surfaceData.normal);
          this.$l.sheenEnvSample = envLight.getRadiance(this, this.refl, this.surfaceData.sheenRoughness);
          this.$l.sheenBRDF = pb.textureSample(this.ggxLut, pb.clamp(pb.vec2(this.surfaceData.NdotV, this.surfaceData.sheenRoughness), pb.vec2(0), pb.vec2(1))).b;
          //this.$l.sheenBRDF = iblSheenBRDF(this, this.surfaceData.sheenRoughness, this.surfaceData.NdotV);
          this.$l.sheenLighting = pb.mul(this.surfaceData.sheenColor.rgb, this.iblDiffuse, this.sheenBRDF);
          this.surfaceData.sheenContrib = pb.add(this.surfaceData.sheenContrib, pb.mul(this.sheenLighting, this.surfaceData.occlusion.r));
        }
      }
    );
    pb.getGlobalScope()[PBRLightModelBase.funcNameIllumEnvLight]();
  }
  /**
   * {@inheritDoc LightModel.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;
  }
  /**
   * {@inheritDoc LightModel.envBRDF}
   * @override
   */
  envBRDF(envLight: EnvironmentLighting, scope: PBInsideFunctionScope): void {
    this.illumEnvLight(scope, envLight);
  }
  /**
   * {@inheritDoc LightModel.directBRDF}
   * @override
   */
  directBRDF(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    attenuation: PBShaderExp
  ): void {
    const that = this;
    const pb = scope.$builder;
    pb.func(
      PBRLightModelBase.funcNameCalcPBRLight,
      [pb.vec3('lightDir'), pb.vec3('attenuation')],
      function () {
        this.$l.L = pb.neg(this.lightDir);
        this.$l.halfVec = pb.normalize(pb.sub(this.surfaceData.viewVec, this.lightDir));
        this.$l.NdotH = pb.clamp(pb.dot(this.surfaceData.normal, this.halfVec), 0, 1);
        this.$l.NdotL = pb.clamp(pb.dot(this.surfaceData.normal, this.L), 0, 1);
        this.$l.VdotH = pb.clamp(pb.dot(this.surfaceData.viewVec, this.halfVec), 0, 1);
        this.$l.outSpecular = pb.vec3();
        this.$l.outDiffuse = pb.vec3();
        this.$l.F = fresnelSchlick(this, this.VdotH, this.surfaceData.f0.rgb, this.surfaceData.f90);
        directLighting(this, this.surfaceData.diffuse.rgb, this.surfaceData.NdotV, this.NdotH, this.NdotL, this.F, this.surfaceData.roughness, this.surfaceData.specularWeight, this.outSpecular, this.outDiffuse);
        this.surfaceData.accumSpecular = pb.add(this.surfaceData.accumSpecular, pb.mul(this.outSpecular, this.attenuation));
        this.surfaceData.accumDiffuse = pb.add(this.surfaceData.accumDiffuse, pb.mul(this.outDiffuse, this.attenuation));
        if (that._sheen) {
          this.$l.sheenLighting = directSheenLighting(this, this.surfaceData.NdotV, this.NdotL, this.NdotH, this.surfaceData.sheenColor, this.surfaceData.sheenRoughness);
          this.surfaceData.sheenContrib = pb.add(this.surfaceData.sheenContrib, pb.mul(this.sheenLighting, this.attenuation));
        }
        if (that._clearcoat) {
          this.$l.ccNdotH = pb.clamp(pb.dot(this.surfaceData.clearcoatNormal, this.halfVec), 0, 1);
          this.$l.ccNdotL = pb.clamp(pb.dot(this.surfaceData.clearcoatNormal, this.L), 0, 1);
          this.$l.ccLighting = directClearcoatLighting(this, this.surfaceData.clearcoatNdotV, this.ccNdotH, this.ccNdotL, this.F, this.surfaceData.clearcoatFactor.y);
          this.surfaceData.clearcoatContrib = pb.add(this.surfaceData.clearcoatContrib, pb.mul(this.ccLighting, this.attenuation));
        }
      }
    );
    pb.getGlobalScope()[PBRLightModelBase.funcNameCalcPBRLight](lightDir, attenuation);
  }
  /**
   * {@inheritDoc LightModel.compositeSurfaceData}
   * @override
   */
  protected compositeSurfaceData(scope: PBInsideFunctionScope) {
    // to be overriden
    const pb = scope.$builder;
    switch (Material.debugChannel) {
      case 'pbrBase': {
        break;
      }
      case 'pbrMetallic': {
        scope.surfaceData.debugColor = pb.vec4(scope.surfaceData.metallic, scope.surfaceData.metallic, scope.surfaceData.metallic, 1);
        break;
      }
      case 'pbrRoughness': {
        scope.surfaceData.debugColor = pb.vec4(scope.surfaceData.roughness, scope.surfaceData.roughness, scope.surfaceData.roughness, 1);
        break;
      }
      case 'pbrMetallicRoughness': {
        scope.surfaceData.debugColor = pb.vec4(pb.add(scope.surfaceData.accumDiffuse, scope.surfaceData.accumSpecular), 1);
        break;
      }
      case 'pbrSheen': {
        if (this._sheen) {
          scope.surfaceData.debugColor = pb.vec4(scope.surfaceData.sheenContrib, 1);
        } else {
          scope.surfaceData.debugColor = pb.vec4(0, 0, 0, 1);
        }
        break;
      }
      case 'pbrSheenColor': {
        if (this._sheen) {
          scope.surfaceData.debugColor = pb.vec4(scope.surfaceData.sheenColor, 1);
        } else {
          scope.surfaceData.debugColor = pb.vec4(0, 0, 0, 1);
        }
        break;
      }
      case 'pbrSheenRoughness': {
        if (this._sheen) {
          scope.surfaceData.debugColor = pb.vec4(scope.surfaceData.sheenRoughness, scope.surfaceData.sheenRoughness, scope.surfaceData.sheenRoughness, 1);
        } else {
          scope.surfaceData.debugColor = pb.vec4(0, 0, 0, 1);
        }
        break;
      }
      case 'pbrSheenAlbedoScaling': {
        if (this._sheen) {
          scope.surfaceData.debugColor = pb.vec4(scope.surfaceData.sheenAlbedoScaling, scope.surfaceData.sheenAlbedoScaling, scope.surfaceData.sheenAlbedoScaling, 1);
        } else {
          scope.surfaceData.debugColor = pb.vec4(0, 0, 0, 1);
        }
        break;
      }
      default: {
        if (this._sheen) {
          scope.surfaceData.accumColor = pb.add(
            pb.mul(scope.surfaceData.accumColor, scope.surfaceData.sheenAlbedoScaling),
            scope.surfaceData.sheenContrib
          );
        }
        if (this._clearcoat) {
          scope.surfaceData.accumColor = pb.add(
            pb.mul(
              scope.surfaceData.accumColor,
              pb.sub(pb.vec3(1), pb.mul(scope.surfaceData.clearcoatFresnel, scope.surfaceData.clearcoatFactor.x))
            ),
            pb.mul(scope.surfaceData.clearcoatContrib, scope.surfaceData.clearcoatFactor.x)
          );
          // surfaceData.accumColor = pb.add(pb.mul(surfaceData.clearcoatNormal, 0.5), pb.vec3(0.5));
          // surfaceData.accumColor = pb.vec3(surfaceData.clearcoatFresnel);
        }
        break;
      }
    }
    super.compositeSurfaceData(scope);
  }
}

/**
 * specular-glossness PBR light model
 * @public
 */
export class PBRLightModelSG extends PBRLightModelBase {
  /** @internal */
  protected static readonly uniformSpecularFactor = 'lib_PBRSG_specularFactor';
  /** @internal */
  protected static readonly uniformGlossinessFactor = 'lib_PBRSG_glossinessFactor';
  /** @internal */
  protected _specularFactor: Vector4;
  /** @internal */
  protected _glossinessFactor: number;
  /**
   * Creates an instance of PBRLightModelSG
   */
  constructor() {
    super();
    this._specularFactor = Vector4.one();
    this._glossinessFactor = 1;
  }
  /** The specular factor */
  get specularFactor(): Vector4 {
    return this._specularFactor;
  }
  set specularFactor(val: Vector4) {
    if (val && !this._specularFactor.equalsTo(val)) {
      this._specularFactor.set(val);
      this.optionChanged(false);
    }
  }
  /** The glossness factor */
  get glossinessFactor(): number {
    return this._glossinessFactor;
  }
  set glossinessFactor(val: number) {
    if (val !== this._glossinessFactor) {
      this._glossinessFactor = val;
      this.optionChanged(false);
    }
  }
  /** The specular texture */
  get specularMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_SPECULAR]?.texture as Texture2D) ?? null;
  }
  /** Texture coordinate index of the specular texture */
  get specularMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_SPECULAR]?.texCoordIndex ?? null;
  }
  /** Sampler of the specular texture */
  get specularSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_SPECULAR]?.sampler ?? null;
  }
  /**
   * Sets the specular texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setSpecularMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_SPECULAR, tex, sampler, texCoordIndex, texTransform);
  }
  /**
   * {@inheritDoc LightModel.applyUniforms}
   * @override
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext) {
    super.applyUniforms(bindGroup, ctx);
    bindGroup.setValue('lm_specularFactor', this._specularFactor);
    bindGroup.setValue('lm_glossinessFactor', this._glossinessFactor);
  }
  /**
   * {@inheritDoc LightModel.calculateHash}
   * @override
   */
  calculateHash(): string {
    return `${super.calculateHash()}_${this.specularMap ? `${this.specularMapTexCoord + 1}` : 0}`;
  }
  /**
   * {@inheritDoc LightModel.setupUniforms}
   * @override
   */
  setupUniforms(scope: PBGlobalScope, ctx: DrawContext): void {
    super.setupUniforms(scope, ctx);
    if (scope.$builder.shaderKind === 'fragment') {
      scope.lm_specularFactor = scope.$builder.vec4().uniform(2).tag(PBRLightModelSG.uniformSpecularFactor);
      scope.lm_glossinessFactor = scope.$builder
        .float()
        .uniform(2)
        .tag(PBRLightModelSG.uniformGlossinessFactor);
    }
  }
  /**
   * {@inheritDoc LightModel.fillSurfaceData}
   * @override
   */
  protected fillSurfaceData(
    scope: PBInsideFunctionScope,
    envLight: EnvironmentLighting
  ) {
    const funcNameFillSurfaceDataSG = 'lib_fillSurfaceDataSG';
    const that = this;
    const pb = scope.$builder;
    super.fillSurfaceData(scope, envLight);
    // surface data contains F0, metallic, roughness
    pb.func(
      funcNameFillSurfaceDataSG,
      [],
      function () {
        this.surfaceData.f0 = pb.vec4(
          this.$query(PBRLightModelSG.uniformSpecularFactor).rgb,
          this.surfaceData.f0.a
        );
        this.surfaceData.roughness = this.$query(PBRLightModelSG.uniformGlossinessFactor);
        if (that.specularMap) {
          const texCoord = this.$inputs[`texcoord${that.specularMapTexCoord ?? that.albedoMapTexCoord}`];
          this.$l.t = pb.textureSample(this[that.getTextureUniformName(TEX_NAME_SPECULAR)], texCoord);
          this.surfaceData.roughness = pb.mul(this.surfaceData.roughness, this.t.a);
          this.surfaceData.f0 = pb.mul(this.surfaceData.f0, pb.vec4(this.t.rgb, 1));
        }
        this.surfaceData.roughness = pb.sub(1, this.surfaceData.roughness);
        this.surfaceData.metallic = pb.max(
          pb.max(this.surfaceData.f0.r, this.surfaceData.f0.g),
          this.surfaceData.f0.b
        );
        if (envLight) {
          this.surfaceData.ggxLutSample = pb.clamp(pb.textureSample(this.ggxLut, pb.vec2(this.surfaceData.NdotV, this.surfaceData.roughness)), pb.vec4(0), pb.vec4(1));
        }
        this.surfaceData.diffuse = pb.vec4(
          pb.mul(this.surfaceData.diffuse.rgb, pb.sub(1, this.surfaceData.metallic)),
          this.surfaceData.diffuse.a
        );
        this.surfaceData.specularWeight = pb.float(1);
        if (that._clearcoat) {
          this.surfaceData.clearcoatFresnel = fresnelSchlick(
            this,
            this.surfaceData.clearcoatNdotV,
            this.surfaceData.f0.rgb,
            this.surfaceData.f90
          );
        }
        if (envLight?.hasIrradiance()) {
          this.surfaceData.irradiance = envLight.getIrradiance(this, this.surfaceData.normal);
        } else {
          this.surfaceData.irradiance = pb.vec3(0);
        }
        if (envLight?.hasRadiance()) {
          this.$l.refl = pb.reflect(pb.neg(this.surfaceData.viewVec), this.surfaceData.normal);
          this.surfaceData.radiance = envLight.getRadiance(this, this.refl, this.surfaceData.roughness);
          if (that.useClearcoat) {
            this.$l.ccRefl = pb.reflect(pb.neg(this.surfaceData.viewVec), this.surfaceData.clearcoatNormal);
            this.surfaceData.radianceClearcoat = envLight.getRadiance(this, this.ccRefl, this.surfaceData.clearcoatFactor.y);
          }
        } else {
          this.surfaceData.radiance = pb.vec3(0);
          if (that.useClearcoat) {
            this.surfaceData.radianceClearcoat = pb.vec3(0);
          }
        }
      }
    );
    pb.getGlobalScope()[funcNameFillSurfaceDataSG]();
  }
  /**
   * {@inheritDoc LightModel.createSurfaceDataType}
   * @override
   */
  protected createSurfaceDataType(env: EnvironmentLighting): PBStructTypeInfo {
    return super.createSurfaceDataType(env).extends('', [
      {
        name: 'specularWeight',
        type: typeF32
      }
    ]);
  }
}

/**
 * Metallic-Roughness PBR light model
 * @public
 */
export class PBRLightModelMR extends PBRLightModelBase {
  /** @internal */
  protected static readonly uniformMetallic = 'lib_PBRLM_metallic';
  /** @internal */
  protected static readonly uniformRoughness = 'lib_PBRLM_roughness';
  /** @internal */
  protected static readonly uniformSpecularFactor = 'lib_PBRLM_specularFactor';
  /** @internal */
  protected _metallic: number;
  /** @internal */
  protected _roughness: number;
  /** @internal */
  protected _metallicIndex: number;
  /** @internal */
  protected _roughnessIndex: number;
  /** @internal */
  protected _specularFactor: Vector4;
  /**
   * Creates an instance of PBRLightModelMR
   */
  constructor() {
    super();
    this._metallic = 1;
    this._roughness = 1;
    this._metallicIndex = 2;
    this._roughnessIndex = 1;
    this._specularFactor = Vector4.one();
  }
  /** The metallic factor */
  get metallic(): number {
    return this._metallic;
  }
  set metallic(val: number) {
    if (val !== this._metallic) {
      this._metallic = val;
      this.optionChanged(false);
    }
  }
  /** The roughness factor */
  get roughness(): number {
    return this._roughness;
  }
  set roughness(val: number) {
    if (val !== this._roughness) {
      this._roughness = val;
      this.optionChanged(false);
    }
  }
  /** index of the metallic channel in the metallic-roughness texture  */
  get metallicIndex(): number {
    return this._metallicIndex;
  }
  set metallicIndex(val: number) {
    if (this._metallicIndex !== val) {
      this._metallicIndex = val;
      this.optionChanged(true);
    }
  }
  /** index of the roughness channel in the metallic-roughness texture  */
  get roughnessIndex(): number {
    return this._roughnessIndex;
  }
  set roughnessIndex(val: number) {
    if (this._roughnessIndex !== val) {
      this._roughnessIndex = val;
      this.optionChanged(true);
    }
  }
  /** The metallic-roughness texture */
  get metallicMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_METALLIC]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the metallic-roughness texture */
  get metallicSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_METALLIC]?.sampler ?? null;
  }
  /** Texture coordinate index of the metallic-roughness texture */
  get metallicMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_METALLIC]?.texCoordIndex ?? null;
  }
  /**
   * Sets the metallic-roughness texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setMetallicMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_METALLIC, tex, sampler, texCoordIndex, texTransform);
  }
  /** The specular factor */
  get specularFactor(): Vector4 {
    return this._specularFactor;
  }
  set specularFactor(val: Vector4) {
    if (!val.equalsTo(this._specularFactor)) {
      this._specularFactor.set(val);
      this.optionChanged(true);
    }
  }
  /** The specular texture */
  get specularMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_SPECULAR]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the specular texture */
  get specularSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_SPECULAR]?.sampler ?? null;
  }
  /** Texture coordinate index of the specular texture */
  get specularMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_SPECULAR]?.texCoordIndex ?? null;
  }
  /**
   * Sets the specular texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setSpecularMap(tex: Texture2D, sampler: TextureSampler, texCoordIndex: number, texTransform?: Matrix4x4) {
    this.setTextureOptions(TEX_NAME_SPECULAR, tex, sampler, texCoordIndex, texTransform);
  }
  /** The specular color texture */
  get specularColorMap(): Texture2D {
    return (this._textureOptions[TEX_NAME_SPECULAR_COLOR]?.texture as Texture2D) ?? null;
  }
  /** Sampler of the specular color texture */
  get specularColorSampler(): TextureSampler {
    return this._textureOptions[TEX_NAME_SPECULAR_COLOR]?.sampler ?? null;
  }
  /** Texture coordinate index of the specular color texture */
  get specularColorMapTexCoord(): number {
    return this._textureOptions[TEX_NAME_SPECULAR_COLOR]?.texCoordIndex ?? null;
  }
  /**
   * Sets the specular color texture
   * @param tex - The texture to set
   * @param sampler - Sampler of the texture
   * @param texCoordIndex - Texture coordinate index of the texture
   * @param texTransform - Transformation matrix for texture coordinates of the texture
   */
  setSpecularColorMap(
    tex: Texture2D,
    sampler: TextureSampler,
    texCoordIndex: number,
    texTransform?: Matrix4x4
  ) {
    this.setTextureOptions(TEX_NAME_SPECULAR_COLOR, tex, sampler, texCoordIndex, texTransform);
  }
  /**
   * {@inheritDoc LightModel.applyUniforms}
   * @override
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext) {
    super.applyUniforms(bindGroup, ctx);
    bindGroup.setValue('lm_pbrMetallic', this._metallic);
    bindGroup.setValue('lm_pbrRoughness', this._roughness);
    bindGroup.setValue('lm_pbrSpecularFactor', this._specularFactor);
  }
  /**
   * {@inheritDoc LightModel.calculateHash}
   * @override
   */
  calculateHash(): string {
    const metallicMapHash = this.metallicMap
      ? `${this.metallicMapTexCoord + 1}_${this._metallicIndex}_${this._roughnessIndex}`
      : '0';
    const specularMapHash = this.specularMap ? `${this.specularMapTexCoord + 1}` : '0';
    const specularColorMapHash = this.specularColorMap ? `${this.specularColorMapTexCoord + 1}` : '0';
    return `${super.calculateHash()}_${metallicMapHash}_${specularMapHash}_${specularColorMapHash}`;
  }
  /**
   * {@inheritDoc LightModel.setupUniforms}
   * @override
   */
  setupUniforms(scope: PBGlobalScope, ctx: DrawContext): void {
    super.setupUniforms(scope, ctx);
    if (scope.$builder.shaderKind === 'fragment') {
      scope.lm_pbrMetallic = scope.$builder.float().uniform(2).tag(PBRLightModelMR.uniformMetallic);
      scope.lm_pbrRoughness = scope.$builder.float().uniform(2).tag(PBRLightModelMR.uniformRoughness);
      scope.lm_pbrSpecularFactor = scope.$builder
        .vec4()
        .uniform(2)
        .tag(PBRLightModelMR.uniformSpecularFactor);
    }
  }
  /**
   * {@inheritDoc LightModel.fillSurfaceData}
   * @override
   */
  protected fillSurfaceData(
    scope: PBInsideFunctionScope,
    envLight: EnvironmentLighting
  ) {
    const funcNameFillSurfaceDataMR = 'lib_fillSurfaceDataMR';
    const that = this;
    const pb = scope.$builder;
    super.fillSurfaceData(scope, envLight);
    // surface data contains F0, metallic, roughness
    pb.func(
      funcNameFillSurfaceDataMR,
      [],
      function () {
        const metallicMap = that.metallicMap ? this[that.getTextureUniformName(TEX_NAME_METALLIC)] : null;
        const specularMap = that.specularMap ? this[that.getTextureUniformName(TEX_NAME_SPECULAR)] : null;
        const specularColorMap = that.specularColorMap
          ? this[that.getTextureUniformName(TEX_NAME_SPECULAR_COLOR)]
          : null;
        const metallicFactor = this.$query(PBRLightModelMR.uniformMetallic);
        const roughnessFactor = this.$query(PBRLightModelMR.uniformRoughness);
        if (metallicMap) {
          const texCoord = this.$inputs[`texcoord${that.metallicMapTexCoord ?? that.albedoMapTexCoord}`];
          this.$l.t = pb.textureSample(metallicMap, texCoord);
          const metallic = this.t['xyzw'[that._metallicIndex] || 'z'];
          const roughness = this.t['xyzw'[that._roughnessIndex] || 'y'];
          this.surfaceData.metallic = metallicFactor ? pb.mul(metallic, metallicFactor) : metallic;
          this.surfaceData.roughness = roughnessFactor ? pb.mul(roughness, roughnessFactor) : roughness;
        } else {
          this.surfaceData.metallic = metallicFactor;
          this.surfaceData.roughness = roughnessFactor;
        }
        if (envLight) {
          this.surfaceData.ggxLutSample = pb.textureSample(this.ggxLut, pb.vec2(this.surfaceData.NdotV, this.surfaceData.roughness));
        }
        const specularFactor = this.$query(PBRLightModelMR.uniformSpecularFactor);
        this.$l.specularColorFactor = specularFactor.rgb;
        this.surfaceData.specularWeight = specularFactor.a;
        if (specularColorMap) {
          const texCoord =
            this.$inputs[`texcoord${that.specularColorMapTexCoord ?? that.albedoMapTexCoord}`];
          this.specularColorFactor = pb.mul(
            this.specularColorFactor,
            pb.textureSample(specularColorMap, texCoord).rgb
          );
        }
        if (specularMap) {
          const texCoord = this.$inputs[`texcoord${that.specularMapTexCoord ?? that.albedoMapTexCoord}`];
          this.surfaceData.specularWeight = pb.mul(
            this.surfaceData.specularWeight,
            pb.textureSample(specularMap, texCoord).a
          );
        }
        this.surfaceData.f0 = pb.vec4(
          pb.mix(
            pb.min(pb.mul(this.surfaceData.f0.rgb, this.specularColorFactor), pb.vec3(1)),
            this.surfaceData.diffuse.rgb,
            this.surfaceData.metallic
          ),
          this.surfaceData.f0.a
        );
        this.surfaceData.diffuse = pb.vec4(
          pb.mix(this.surfaceData.diffuse.rgb, pb.vec3(0), this.surfaceData.metallic),
          this.surfaceData.diffuse.a
        );
        if (that._clearcoat) {
          this.surfaceData.clearcoatFresnel = fresnelSchlick(
            this,
            this.surfaceData.clearcoatNdotV,
            this.surfaceData.f0.rgb,
            this.surfaceData.f90
          );
        }
        if (envLight?.hasIrradiance()) {
          this.surfaceData.irradiance = envLight.getIrradiance(this, this.surfaceData.normal);
        } else {
          this.surfaceData.irradiance = pb.vec3(0);
        }
        if (envLight?.hasRadiance()) {
          this.$l.refl = pb.reflect(pb.neg(this.surfaceData.viewVec), this.surfaceData.normal);
          this.surfaceData.radiance = envLight.getRadiance(this, this.refl, this.surfaceData.roughness);
          if (that.useClearcoat) {
            this.$l.ccRefl = pb.reflect(pb.neg(this.surfaceData.viewVec), this.surfaceData.clearcoatNormal);
            this.surfaceData.radianceClearcoat = envLight.getRadiance(this, this.ccRefl, this.surfaceData.clearcoatFactor.y);
          }
        } else {
          this.surfaceData.radiance = pb.vec3(0);
          if (that.useClearcoat) {
            this.surfaceData.radianceClearcoat = pb.vec3(0);
          }
        }
      }
    );
    pb.getGlobalScope()[funcNameFillSurfaceDataMR]();
  }
  /**
   * {@inheritDoc LightModel.createSurfaceDataType}
   * @override
   */
  protected createSurfaceDataType(env: EnvironmentLighting): PBStructTypeInfo {
    return super.createSurfaceDataType(env).extends('', [
      {
        name: 'specularWeight',
        type: typeF32
      }
    ]);
  }
  /**
   * {@inheritDoc LightModel.isTextureUsed}
   * @override
   */
  isTextureUsed(name: string): boolean {
    if (!this._sheen && (name === TEX_NAME_SHEEN_COLOR || name === TEX_NAME_SHEEN_ROUGHNESS)) {
      return false;
    }
    return super.isTextureUsed(name);
  }
}
