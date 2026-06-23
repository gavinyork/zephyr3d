import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { DRef, Vector4, type Clonable } from '@zephyr3d/base';
import { ShaderHelper } from './shader/helper';
import type { BluePrintUniformTexture, BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import type { IGraphNode } from '../utility/blueprint/node';
import { PBRBlockNode, VertexBlockNode } from '../utility/blueprint/material/pbr';
import { PBRMetallicRoughnessMaterial } from './pbrmr';
import type { DrawContext } from '../render/drawable';
import type { PBRReflectionMode } from './mixins/lightmodel/pbrmetallicroughness';

const PBR_REFLECTION_MODE: Record<PBRReflectionMode, number> = {
  none: 0,
  ggx: 1,
  anisotropic: 2,
  glint: 3
};

type BlueprintOutputMap = Partial<Record<PBRBlueprintOutputName, number | boolean | PBShaderExp>>;
type VertexBlueprintOutputName = 'Position' | 'Normal' | 'Tangent' | 'Color' | 'UV';
type VertexBlueprintOutputMap = Partial<Record<VertexBlueprintOutputName, number | boolean | PBShaderExp>>;

export type PBRBlueprintOutputName =
  | 'BaseColor'
  | 'Metallic'
  | 'Roughness'
  | 'Specular'
  | 'Emissive'
  | 'Normal'
  | 'Tangent'
  | 'Opacity'
  | 'SpecularWeight'
  | 'AO';

const DEFAULT_OUTPUT_NAMES: readonly PBRBlueprintOutputName[] = [
  'BaseColor',
  'Metallic',
  'Roughness',
  'Specular',
  'Emissive',
  'Normal',
  'Tangent',
  'Opacity',
  'SpecularWeight',
  'AO'
] as const;

function getBlueprintAutoSamplerKey(
  uniform: Pick<
    BluePrintUniformTexture,
    'type' | 'wrapS' | 'wrapT' | 'minFilter' | 'magFilter' | 'mipFilter'
  >
) {
  return [
    'blueprint',
    uniform.type,
    uniform.wrapS,
    uniform.wrapT,
    uniform.minFilter,
    uniform.magFilter,
    uniform.mipFilter
  ].join('_');
}

/**
 * Physically-based rendering material driven by blueprint graphs, but shaded by the
 * same PBR metallic/roughness backend used by {@link PBRMetallicRoughnessMaterial}.
 *
 * @remarks
 * The blueprint graph only produces surface inputs. Final direct/indirect lighting,
 * transmission, clearcoat, sheen, iridescence and anisotropic reflection still run
 * through the standard PBRM backend so imported GLTF materials and blueprint materials
 * stay on the same shading path.
 *
 * @public
 */
export class PBRBluePrintMaterial
  extends PBRMetallicRoughnessMaterial
  implements Clonable<PBRBluePrintMaterial>
{
  /** @internal */
  private static readonly FEATURE_BLUEPRINT_VERTEX_COLOR = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_BLUEPRINT_VERTEX_UV = this.defineFeature();
  /** @internal */
  private _irFrag: MaterialBlueprintIR;
  /** @internal */
  private _irVertex: MaterialBlueprintIR;
  /** @internal */
  private _uniformValues: BluePrintUniformValue[];
  /** @internal */
  private _uniformTextures: BluePrintUniformTexture[];
  /** @internal */
  private _connectedOutputs: Set<PBRBlueprintOutputName>;
  /** @internal */
  private _vertexUsesColor: boolean;
  /** @internal */
  private _vertexUsesUV: boolean;

  constructor(
    irFrag?: MaterialBlueprintIR,
    irVertex?: MaterialBlueprintIR,
    uniformValues?: BluePrintUniformValue[],
    uniformTextures?: BluePrintUniformTexture[]
  ) {
    super();
    this._irFrag =
      irFrag ??
      new MaterialBlueprintIR(
        {
          nodeMap: { '1': new PBRBlockNode() },
          roots: [1],
          order: [1],
          graph: { incoming: {}, outgoing: {} }
        },
        '',
        {
          nodes: [{ id: 1, title: '', locked: true, node: { ClassName: 'PBRBlockNode', Object: '' } }],
          links: []
        }
      );
    this._irVertex =
      irVertex ??
      new MaterialBlueprintIR(
        {
          nodeMap: { '1': new VertexBlockNode() },
          roots: [1],
          order: [1],
          graph: { incoming: {}, outgoing: {} }
        },
        '',
        {
          nodes: [{ id: 1, title: '', locked: true, node: { ClassName: 'VertexBlockNode', Object: '' } }],
          links: []
        }
      );
    this._uniformValues = uniformValues ?? [];
    this._uniformTextures = uniformTextures ?? [];
    this._connectedOutputs = new Set();
    this._vertexUsesColor = false;
    this._vertexUsesUV = false;
    this.syncBlueprintMetadata();
  }

  get fragmentIR() {
    return this._irFrag;
  }
  set fragmentIR(ir: MaterialBlueprintIR) {
    if (ir && ir !== this._irFrag) {
      this._irFrag = ir;
      this.syncBlueprintMetadata();
      this.clearCache();
      this.optionChanged(true);
    }
  }

  get vertexIR() {
    return this._irVertex;
  }
  set vertexIR(ir: MaterialBlueprintIR) {
    if (ir && ir !== this._irVertex) {
      this._irVertex = ir;
      this.syncBlueprintMetadata();
      this.clearCache();
      this.optionChanged(true);
    }
  }

  get uniformValues() {
    return this._uniformValues;
  }
  set uniformValues(val: BluePrintUniformValue[]) {
    this._uniformValues = (val ?? []).map((v) => ({ ...v }));
    this.uniformChanged();
  }

  get uniformTextures() {
    return this._uniformTextures;
  }
  set uniformTextures(val: BluePrintUniformTexture[]) {
    if (val !== this._uniformTextures) {
      const newUniforms = (val ?? []).map((v) => ({
        finalTexture: new DRef(v.finalTexture?.get() ?? null),
        finalSampler: v.finalSampler,
        inFragmentShader: v.inFragmentShader,
        inVertexShader: v.inVertexShader,
        magFilter: v.magFilter,
        minFilter: v.minFilter,
        mipFilter: v.mipFilter,
        name: v.name,
        params: v.params?.clone() ?? Vector4.zero(),
        sRGB: v.sRGB,
        texture: v.texture,
        type: v.type,
        wrapS: v.wrapS,
        wrapT: v.wrapT
      }));
      for (const u of this._uniformTextures) {
        u.finalTexture?.dispose();
      }
      this._uniformTextures = newUniforms;
      this.uniformChanged();
    }
  }

  hasConnectedOutput(name: PBRBlueprintOutputName) {
    return this._connectedOutputs.has(name);
  }

  clone() {
    const other = new PBRBluePrintMaterial(
      this._irFrag,
      this._irVertex,
      this._uniformValues,
      this._uniformTextures
    );
    other.copyFrom(this);
    return other;
  }

  copyFrom(other: this) {
    super.copyFrom(other);
    if (other instanceof PBRBluePrintMaterial) {
      this.fragmentIR = other.fragmentIR;
      this.vertexIR = other.vertexIR;
      this.uniformValues = other.uniformValues;
      this.uniformTextures = other.uniformTextures;
    }
  }

  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;

    scope.zVertexColor = this.getBlueprintVertexColor(scope);
    scope.zVertexUV = this.getBlueprintVertexUV(scope);
    scope.zVertexNormal = (scope.$outputs.wNorm ?? pb.vec3(0, 0, 1)) as PBShaderExp;
    scope.zVertexTangent = (scope.$outputs.wTangent ?? pb.vec3(1, 0, 0)) as PBShaderExp;
    scope.zVertexBinormal = (scope.$outputs.wBinormal ?? pb.vec3(0, 1, 0)) as PBShaderExp;
    scope.zWorldPos = scope.$outputs.worldPos as PBShaderExp;
    if (this._vertexUsesColor && !scope.$outputs.zOutDiffuse) {
      scope.$outputs.zOutDiffuse = scope.zVertexColor;
    }
    if (this._vertexUsesUV) {
      scope.$outputs.zVertexUV = scope.zVertexUV;
    }

    for (const u of [...this._uniformValues, ...this._uniformTextures]) {
      if (u.inVertexShader) {
        // @ts-ignore dynamic shader type constructor
        const exp = pb[u.type]().uniform(2);
        if ('texture' in u) {
          exp.$autoSamplerKey = getBlueprintAutoSamplerKey(u);
        }
        pb.getGlobalScope()[u.name] = exp;
      }
    }

    const outputs = this._irVertex.create(pb);
    if (!outputs) {
      return;
    }
    const vertexOut = this.toVertexOutputMap(outputs);
    const worldMatrix = ShaderHelper.getWorldMatrix(scope);

    if (vertexOut.Position) {
      scope.$l.oPos = vertexOut.Position as PBShaderExp;
      scope.$outputs.worldPos = pb.mul(worldMatrix, pb.vec4(scope.oPos, 1)).xyz;
      scope.zWorldPos = scope.$outputs.worldPos as PBShaderExp;
      scope.$l.csPos = pb.mul(
        ShaderHelper.getViewProjectionMatrix(scope),
        pb.vec4(scope.$outputs.worldPos, 1)
      );
      ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    }
    if (vertexOut.Color) {
      scope.zVertexColor = this.toVec4(scope as unknown as PBInsideFunctionScope, vertexOut.Color, 1);
      if (scope.$outputs.zOutDiffuse) {
        scope.$outputs.zOutDiffuse = scope.zVertexColor;
      }
    }
    if (vertexOut.UV) {
      scope.zVertexUV = this.toVec2(scope as unknown as PBInsideFunctionScope, vertexOut.UV);
      if (this._vertexUsesUV) {
        scope.$outputs.zVertexUV = scope.zVertexUV;
      }
    }
    if (vertexOut.Normal) {
      scope.$l.oNorm = this.toVec3(scope as unknown as PBInsideFunctionScope, vertexOut.Normal);
      scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
      scope.zVertexNormal = scope.$outputs.wNorm as PBShaderExp;
    }
    if (vertexOut.Tangent) {
      const tangent = vertexOut.Tangent as PBShaderExp;
      scope.$l.oTangent =
        tangent.getTypeName() === 'vec4'
          ? tangent
          : pb.vec4(this.toVec3(scope as unknown as PBInsideFunctionScope, tangent), 1);
      scope.$outputs.wTangent = pb.mul(
        ShaderHelper.getNormalMatrix(scope),
        pb.vec4(scope.oTangent.xyz, 0)
      ).xyz;
      scope.$outputs.wBinormal = pb.mul(
        pb.cross(scope.$outputs.wNorm as PBShaderExp, scope.$outputs.wTangent as PBShaderExp),
        scope.oTangent.w
      );
      scope.zVertexTangent = scope.$outputs.wTangent as PBShaderExp;
      scope.zVertexBinormal = scope.$outputs.wBinormal as PBShaderExp;
    }
  }

  fragmentShader(scope: PBFunctionScope) {
    const pb = scope.$builder;
    if (this.needFragmentColorInput()) {
      for (const u of [...this._uniformValues, ...this._uniformTextures]) {
        if (u.inFragmentShader) {
          // @ts-ignore dynamic shader type constructor
          const exp = pb[u.type]().uniform(2);
          if ('texture' in u) {
            exp.$autoSamplerKey = getBlueprintAutoSamplerKey(u);
          }
          pb.getGlobalScope()[u.name] = exp;
        }
      }
      scope.zVertexColor = scope.$inputs.zOutDiffuse ?? pb.vec4(1);
      scope.zVertexUV = scope.$inputs.zVertexUV ?? pb.vec2(0);
      scope.zVertexNormal = scope.$inputs.wNorm ?? pb.vec3(0, 0, 1);
      scope.zVertexTangent = scope.$inputs.wTangent ?? pb.vec3(1, 0, 0);
      scope.zVertexBinormal = scope.$inputs.wBinormal ?? pb.vec3(0, 1, 0);
      scope.zWorldPos = scope.$inputs.worldPos as PBShaderExp;
    }
    super.fragmentShader(scope);
  }

  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColorInput(ctx)) {
      for (const u of this._uniformValues) {
        bindGroup.setValue(u.name, u.finalValue!);
      }
      for (const u of this._uniformTextures) {
        const texture = u.finalTexture?.get();
        if (texture) {
          bindGroup.setTexture(u.name, texture, u.finalSampler);
        }
      }
    }
  }

  protected createProgram(ctx: DrawContext, pass: number) {
    return super.createProgram(ctx, pass);
  }

  protected _createHash() {
    return `${super._createHash()}:${this._irFrag.hash}:${this._irVertex.hash}:${this._connectedOutputHash()}:${this._suppressedBackendTextureHash()}`;
  }

  protected onDispose() {
    super.onDispose();
    for (const u of this._uniformTextures) {
      u.finalTexture?.dispose();
    }
  }

  calculateAlbedoColor(scope: PBInsideFunctionScope, uv?: PBShaderExp) {
    const baseColor = this.getBlueprintOutput(scope, 'BaseColor');
    const opacity = this.getBlueprintOutput(scope, 'Opacity');
    if (baseColor !== undefined) {
      const pb = scope.$builder;
      return pb.vec4(this.toVec3(scope, baseColor), (opacity as PBShaderExp | number) ?? 1);
    }
    const albedo = super.calculateAlbedoColor(scope, uv);
    if (opacity !== undefined) {
      const pb = scope.$builder;
      return pb.vec4(albedo.rgb, opacity as PBShaderExp | number);
    }
    return albedo;
  }

  calculateMetallic(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp) {
    const value = this.getBlueprintOutput(scope, 'Metallic');
    if (value !== undefined) {
      return this.toFloat(scope, value);
    }
    return super.calculateMetallic(scope, albedo, normal);
  }

  calculateRoughness(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp) {
    const value = this.getBlueprintOutput(scope, 'Roughness');
    if (value !== undefined) {
      return this.toFloat(scope, value);
    }
    return super.calculateRoughness(scope, albedo, normal);
  }

  calculateSpecularFactor(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp) {
    const pb = scope.$builder;
    const base = super.calculateSpecularFactor(scope, albedo, normal);
    const specular = this.getBlueprintOutput(scope, 'Specular');
    const weight = this.getBlueprintOutput(scope, 'SpecularWeight');
    if (specular !== undefined || weight !== undefined) {
      return pb.vec4(
        specular !== undefined ? this.toVec3(scope, specular) : base.rgb,
        (weight as PBShaderExp | number | undefined) ?? base.a
      );
    }
    return base;
  }

  calculateCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp,
    data: PBShaderExp
  ) {
    const pb = scope.$builder;
    const metallic = this.calculateMetallic(scope, albedo, normal);
    const roughness = this.calculateRoughness(scope, albedo, normal);
    const specularFactor = this.calculateSpecularFactor(scope, albedo, normal);
    const reflectionMode = this.calculateReflectionMode(scope) as PBShaderExp;
    if (this.hasMetallicRoughnessTexture()) {
      scope.$l.metallicRoughnessSample = this.sampleMetallicRoughnessTexture(scope);
      data.metallic = this._connectedOutputs.has('Metallic')
        ? metallic
        : pb.mul(metallic, scope.metallicRoughnessSample.z);
      data.roughness = this._connectedOutputs.has('Roughness')
        ? roughness
        : pb.mul(roughness, scope.metallicRoughnessSample.y);
    } else {
      data.metallic = metallic;
      data.roughness = roughness;
    }
    data.roughness = pb.mul(data.roughness, ShaderHelper.getCameraRoughnessFactor(scope));
    if (this.hasSpecularColorTexture()) {
      scope.$l.specularColor = pb.mul(specularFactor.rgb, this.sampleSpecularColorTexture(scope).rgb);
    } else {
      scope.$l.specularColor = specularFactor.rgb;
    }
    if (this.hasSpecularTexture()) {
      data.specularWeight = pb.mul(specularFactor.a, this.sampleSpecularTexture(scope).a);
    } else {
      data.specularWeight = specularFactor.a;
    }
    data.specularWeight = pb.mul(
      data.specularWeight,
      pb.float(pb.notEqual(reflectionMode, PBR_REFLECTION_MODE.none))
    );
    data.f0 = pb.vec4(
      pb.mix(
        pb.min(pb.mul(this.getF0(scope).rgb, scope.specularColor), pb.vec3(1)),
        albedo.rgb,
        data.metallic
      ),
      this.getF0(scope).a
    );
    data.f90 = pb.vec3(1);
    data.diffuse = pb.vec4(pb.mix(albedo.rgb, pb.vec3(0), data.metallic), albedo.a);
    super.calculateCommonData(scope, albedo, normal, viewVec, TBN, data);
  }

  calculateEmissiveColor(scope: PBInsideFunctionScope) {
    const emissive = this.getBlueprintOutput(scope, 'Emissive');
    if (emissive !== undefined) {
      return this.toVec3(scope, emissive);
    }
    return super.calculateEmissiveColor(scope);
  }

  calculateNormalAndTBN(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ) {
    const outputNormal = this.getBlueprintOutput(scope, 'Normal');
    const outputTangent = this.getBlueprintOutput(scope, 'Tangent');
    if (outputNormal === undefined && outputTangent === undefined) {
      return super.calculateNormalAndTBN(scope, worldPos, worldNormal, worldTangent, worldBinormal);
    }
    const pb = scope.$builder;
    const NormalStruct = pb.defineStruct([pb.mat3('TBN'), pb.vec3('normal')]);
    const funcName = 'Z_calculateBlueprintNormalAndTBN';
    const that = this;
    pb.func(
      funcName,
      [
        pb.vec3('worldPos'),
        pb.vec3('worldNormal'),
        pb.vec3('worldTangent'),
        pb.vec3('worldBinormal'),
        pb.vec3('surfaceNormal'),
        pb.vec3('surfaceTangent')
      ],
      function () {
        this.$l.TBN = that.calculateTBN(
          this,
          this.worldPos,
          this.worldNormal,
          this.worldTangent,
          this.worldBinormal
        );
        this.$l.ng = this.TBN[2];
        this.$l.t = this.TBN[0];
        this.$l.b = this.TBN[1];
        this.$if(pb.greaterThan(pb.length(this.surfaceTangent), 0.0001), function () {
          this.$l.t_ = pb.normalize(this.surfaceTangent);
          this.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
          this.b = pb.normalize(pb.cross(this.ng, this.t));
        });
        this.TBN = pb.mat3(this.t, this.b, this.ng);
        this.$l.surfaceNormalTS = this.surfaceNormal;
        this.$if(pb.lessThanEqual(pb.length(this.surfaceNormalTS), 0.0001), function () {
          this.surfaceNormalTS = pb.vec3(0, 0, 1);
        });
        this.$l.surfaceNormalWS = pb.normalize(pb.mul(this.TBN, this.surfaceNormalTS));
        this.$return(NormalStruct(this.TBN, this.surfaceNormalWS));
      }
    );
    return pb
      .getGlobalScope()
      [
        funcName
      ](worldPos, (worldNormal ?? scope.zVertexNormal) as PBShaderExp, (worldTangent ?? scope.zVertexTangent) as PBShaderExp, (worldBinormal ?? scope.zVertexBinormal) as PBShaderExp, outputNormal !== undefined ? this.toVec3(scope, outputNormal) : pb.vec3(0, 0, 1), outputTangent !== undefined ? this.toVec3(scope, outputTangent) : pb.vec3(0)) as PBShaderExp;
  }

  indirectLighting(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    outColor: PBShaderExp,
    outRoughness?: PBShaderExp,
    outDiffuseColor?: PBShaderExp
  ) {
    const ao = this.getBlueprintOutput(scope, 'AO');
    if (ao === undefined) {
      super.indirectLighting(scope, normal, viewVec, commonData, outColor, outRoughness, outDiffuseColor);
      return;
    }
    const pb = scope.$builder;
    const funcName = `Z_applyBlueprintAO${outDiffuseColor ? '_D' : ''}`;
    pb.func(
      funcName,
      [
        pb.vec3('outColor').inout(),
        ...(outDiffuseColor ? [pb.vec3('outDiffuseColor').inout()] : []),
        pb.float('ao')
      ],
      function () {
        this.outColor = pb.mul(this.outColor, this.ao);
        if (outDiffuseColor) {
          this.outDiffuseColor = pb.mul(this.outDiffuseColor, this.ao);
        }
      }
    );
    super.indirectLighting(scope, normal, viewVec, commonData, outColor, outRoughness, outDiffuseColor);
    if (outDiffuseColor) {
      pb.getGlobalScope()[funcName](outColor, outDiffuseColor, ao as PBShaderExp | number);
    } else {
      pb.getGlobalScope()[funcName](outColor, ao as PBShaderExp | number);
    }
  }

  private syncBlueprintMetadata() {
    this._connectedOutputs = this.collectConnectedOutputs(this._irFrag, PBRBlockNode);
    const fragmentUsesColor = this._irFrag.behaviors.useVertexColor;
    const fragmentUsesUV = this._irFrag.behaviors.useVertexUV;
    const vertexUsesColor = this._irVertex.behaviors.useVertexColor;
    const vertexUsesUV = this._irVertex.behaviors.useVertexUV;
    this._vertexUsesColor = fragmentUsesColor || vertexUsesColor;
    this._vertexUsesUV = fragmentUsesUV || vertexUsesUV;
    this.useFeature(PBRBluePrintMaterial.FEATURE_BLUEPRINT_VERTEX_COLOR, this._vertexUsesColor);
    this.useFeature(PBRBluePrintMaterial.FEATURE_BLUEPRINT_VERTEX_UV, this._vertexUsesUV);
  }

  private collectConnectedOutputs<T extends IGraphNode>(
    ir: MaterialBlueprintIR,
    rootCtor: new (...args: any[]) => T
  ): Set<PBRBlueprintOutputName> {
    const outputs = new Set<PBRBlueprintOutputName>();
    for (const rootId of ir.DAG.roots) {
      const rootNode = ir.DAG.nodeMap[rootId];
      if (!(rootNode instanceof rootCtor)) {
        continue;
      }
      for (const input of rootNode.inputs) {
        if (input.inputNode) {
          outputs.add(input.name as PBRBlueprintOutputName);
        }
      }
    }
    return outputs;
  }

  private getBlueprintVertexColor(scope: PBFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    if (this.vertexColor) {
      return this.getVertexColor(scope as unknown as PBInsideFunctionScope);
    }
    if (this._vertexUsesColor) {
      if (scope.$inputs.zDiffuse) {
        return scope.$inputs.zDiffuse as PBShaderExp;
      }
      if (scope.$getVertexAttrib('diffuse')) {
        return scope.$getVertexAttrib('diffuse') as PBShaderExp;
      }
      scope.$inputs.zDiffuse = pb.vec4().attrib('diffuse');
      return scope.$inputs.zDiffuse as PBShaderExp;
    }
    return pb.vec4(1);
  }

  private getBlueprintVertexUV(scope: PBFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    if (this._vertexUsesUV) {
      if (scope.$inputs.zVertexUV) {
        return scope.$inputs.zVertexUV as PBShaderExp;
      }
      if (scope.$getVertexAttrib('texCoord0')) {
        return scope.$getVertexAttrib('texCoord0') as PBShaderExp;
      }
      scope.$inputs.zVertexUV = pb.vec2().attrib('texCoord0');
      return scope.$inputs.zVertexUV as PBShaderExp;
    }
    if (this.hasAlbedoTexture()) {
      return (this.getAlbedoTexCoord(scope as unknown as PBInsideFunctionScope) ?? pb.vec2(0)) as PBShaderExp;
    }
    return pb.vec2(0);
  }

  protected isMaterialTextureEnabled(name: string) {
    switch (name) {
      case 'albedo':
        return !this._connectedOutputs.has('BaseColor');
      case 'specularColor':
        return !this._connectedOutputs.has('Specular');
      case 'specular':
        return !this._connectedOutputs.has('SpecularWeight');
      case 'emissive':
        return !this._connectedOutputs.has('Emissive');
      case 'normal':
        return !(this._connectedOutputs.has('Normal') || this._connectedOutputs.has('Tangent'));
      case 'occlusion':
        return !this._connectedOutputs.has('AO');
      case 'metallicRoughness':
        return !(this._connectedOutputs.has('Metallic') && this._connectedOutputs.has('Roughness'));
      default:
        return super.isMaterialTextureEnabled(name);
    }
  }

  private getBlueprintOutput(
    scope: PBInsideFunctionScope,
    name: PBRBlueprintOutputName
  ): number | boolean | PBShaderExp | undefined {
    if (!this._connectedOutputs.has(name)) {
      return undefined;
    }
    return this.getBlueprintOutputMap(scope)[name];
  }

  private getBlueprintOutputMap(scope: PBInsideFunctionScope): BlueprintOutputMap {
    const pb = scope.$builder;
    const funcName = 'Z_GetPBRBlueprintOutputs';
    const that = this;
    const outputsStruct = pb.defineStruct(
      DEFAULT_OUTPUT_NAMES.map((name) => {
        switch (name) {
          case 'BaseColor':
            return pb.vec3(name);
          case 'Specular':
          case 'Emissive':
          case 'Normal':
          case 'Tangent':
            return pb.vec3(name);
          default:
            return pb.float(name);
        }
      })
    );
    if (!pb.getGlobalScope()[funcName]) {
      pb.func(
        funcName,
        [
          pb.vec3('worldPos'),
          pb.vec4('vertexColor'),
          pb.vec2('vertexUV'),
          pb.vec3('vertexNormal'),
          pb.vec3('vertexTangent'),
          pb.vec3('vertexBinormal')
        ],
        function () {
          this.zWorldPos = this.worldPos;
          this.zVertexColor = this.vertexColor;
          this.zVertexUV = this.vertexUV;
          this.zVertexNormal = this.vertexNormal;
          this.zVertexTangent = this.vertexTangent;
          this.zVertexBinormal = this.vertexBinormal;
          const outputs = that._irFrag.create(pb);
          let baseColor: number | PBShaderExp = pb.vec3(1);
          let metallic: number | PBShaderExp = 0;
          let roughness: number | PBShaderExp = 1;
          let specular: number | PBShaderExp = pb.vec3(1);
          let emissive: number | PBShaderExp = pb.vec3(0);
          let normal: number | PBShaderExp = pb.vec3(0);
          let tangent: number | PBShaderExp = pb.vec3(0);
          let opacity: number | PBShaderExp = 1;
          let specularWeight: number | PBShaderExp = 1;
          let ao: number | PBShaderExp = 1;
          if (outputs) {
            const map = that.toOutputMap(outputs);
            if (map.BaseColor !== undefined) {
              baseColor = that.toVec3(scope, map.BaseColor);
            }
            if (map.Metallic !== undefined) {
              metallic = map.Metallic as PBShaderExp | number;
            }
            if (map.Roughness !== undefined) {
              roughness = map.Roughness as PBShaderExp | number;
            }
            if (map.Specular !== undefined) {
              specular = that.toVec3(scope, map.Specular);
            }
            if (map.Emissive !== undefined) {
              emissive = that.toVec3(scope, map.Emissive);
            }
            if (map.Normal !== undefined) {
              normal = that.toVec3(scope, map.Normal);
            }
            if (map.Tangent !== undefined) {
              tangent = that.toVec3(scope, map.Tangent);
            }
            if (map.Opacity !== undefined) {
              opacity = map.Opacity as PBShaderExp | number;
            }
            if (map.SpecularWeight !== undefined) {
              specularWeight = map.SpecularWeight as PBShaderExp | number;
            }
            if (map.AO !== undefined) {
              ao = map.AO as PBShaderExp | number;
            }
          }
          this.$return(
            outputsStruct(
              baseColor,
              metallic,
              roughness,
              specular,
              emissive,
              normal,
              tangent,
              opacity,
              specularWeight,
              ao
            )
          );
        }
      );
    }
    const result = pb
      .getGlobalScope()
      [
        funcName
      ](this.getBlueprintWorldPos(scope), this.getBlueprintFragmentVertexColor(scope), this.getBlueprintFragmentVertexUV(scope), this.getBlueprintFragmentVertexNormal(scope), this.getBlueprintFragmentVertexTangent(scope), this.getBlueprintFragmentVertexBinormal(scope)) as PBShaderExp;
    const map: BlueprintOutputMap = {};
    for (const name of DEFAULT_OUTPUT_NAMES) {
      map[name] = result[name] as PBShaderExp;
    }
    return map;
  }

  private getBlueprintWorldPos(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (scope.$inputs.worldPos ?? scope.zWorldPos ?? pb.vec3(0)) as PBShaderExp;
  }

  private getBlueprintFragmentVertexColor(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (scope.$inputs.zOutDiffuse ?? scope.zVertexColor ?? pb.vec4(1)) as PBShaderExp;
  }

  private getBlueprintFragmentVertexUV(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (scope.$inputs.zVertexUV ?? scope.zVertexUV ?? pb.vec2(0)) as PBShaderExp;
  }

  private _suppressedBackendTextureHash() {
    return [
      Number(!this.isMaterialTextureEnabled('albedo')),
      Number(!this.isMaterialTextureEnabled('metallicRoughness')),
      Number(!this.isMaterialTextureEnabled('specularColor')),
      Number(!this.isMaterialTextureEnabled('specular')),
      Number(!this.isMaterialTextureEnabled('emissive')),
      Number(!this.isMaterialTextureEnabled('normal')),
      Number(!this.isMaterialTextureEnabled('occlusion'))
    ].join('');
  }

  private getBlueprintFragmentVertexNormal(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (scope.$inputs.wNorm ?? scope.zVertexNormal ?? pb.vec3(0, 0, 1)) as PBShaderExp;
  }

  private getBlueprintFragmentVertexTangent(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (scope.$inputs.wTangent ?? scope.zVertexTangent ?? pb.vec3(1, 0, 0)) as PBShaderExp;
  }

  private getBlueprintFragmentVertexBinormal(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (scope.$inputs.wBinormal ?? scope.zVertexBinormal ?? pb.vec3(0, 1, 0)) as PBShaderExp;
  }

  private toOutputMap(
    outputs: {
      name: string;
      exp: number | boolean | PBShaderExp;
    }[]
  ): BlueprintOutputMap {
    const map: BlueprintOutputMap = {};
    for (const output of outputs) {
      map[output.name as PBRBlueprintOutputName] = output.exp;
    }
    return map;
  }

  private toVertexOutputMap(
    outputs: {
      name: string;
      exp: number | boolean | PBShaderExp;
    }[]
  ): VertexBlueprintOutputMap {
    const map: VertexBlueprintOutputMap = {};
    for (const output of outputs) {
      map[output.name as VertexBlueprintOutputName] = output.exp;
    }
    return map;
  }

  private toFloat(scope: PBInsideFunctionScope, value: number | boolean | PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    if (typeof value === 'number') {
      return pb.float(value);
    }
    const exp = value as PBShaderExp;
    return exp.getTypeName() === 'float' ? exp : exp.x;
  }

  private toVec2(scope: PBInsideFunctionScope, value: number | boolean | PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    if (typeof value === 'number') {
      return pb.vec2(value);
    }
    const exp = value as PBShaderExp;
    const type = exp.getTypeName();
    if (type === 'float') {
      return pb.vec2(exp);
    }
    if (type === 'vec3' || type === 'vec4') {
      return exp.xy;
    }
    return exp;
  }

  private toVec3(scope: PBInsideFunctionScope, value: number | boolean | PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    if (typeof value === 'number') {
      return pb.vec3(value);
    }
    const exp = value as PBShaderExp;
    const type = exp.getTypeName();
    if (type === 'float') {
      return pb.vec3(exp);
    }
    if (type === 'vec2') {
      return pb.vec3(exp, 0);
    }
    if (type === 'vec4') {
      return exp.xyz;
    }
    return exp;
  }

  private toVec4(
    scope: PBInsideFunctionScope,
    value: number | boolean | PBShaderExp,
    alpha: number | PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    if (typeof value === 'number') {
      return pb.vec4(value, value, value, alpha);
    }
    const exp = value as PBShaderExp;
    const type = exp.getTypeName();
    if (type === 'float') {
      return pb.vec4(pb.vec3(exp), alpha);
    }
    if (type === 'vec2') {
      return pb.vec4(exp, 0, alpha);
    }
    if (type === 'vec3') {
      return pb.vec4(exp, alpha);
    }
    return exp;
  }

  private _connectedOutputHash() {
    return DEFAULT_OUTPUT_NAMES.map((name) => (this._connectedOutputs.has(name) ? '1' : '0')).join('');
  }
}
