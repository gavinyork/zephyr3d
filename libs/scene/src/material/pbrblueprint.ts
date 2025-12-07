import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { BindGroup, PBFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import { DRef, Vector4, type Clonable } from '@zephyr3d/base';
import { mixinPBRBluePrint } from './mixins/lightmodel/pbrblueprintmixin';
import type { BluePrintUniformTexture, BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import type { DrawContext } from '../render/drawable';

/**
 * PBRBluePrintMaterial class
 * @public
 */
export class PBRBluePrintMaterial
  extends applyMaterialMixins(MeshMaterial, mixinPBRBluePrint)
  implements Clonable<PBRBluePrintMaterial>
{
  /** @internal */
  private static readonly FEATURE_VERTEX_COLOR = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_VERTEX_UV = this.defineFeature();
  /** @internal */
  private _irFrag: MaterialBlueprintIR;
  /** @internal */
  private _irVertex: MaterialBlueprintIR;
  /** @internal */
  private _uniformValues: BluePrintUniformValue[];
  /** @internal */
  private _uniformTextures: BluePrintUniformTexture[];
  /**
   * Creates an instance of PBRMetallicRoughnessMaterial class
   */
  constructor(
    irFrag: MaterialBlueprintIR,
    irVertex: MaterialBlueprintIR,
    uniformValues: BluePrintUniformValue[],
    uniformTextures: BluePrintUniformTexture[]
  ) {
    super();
    this._irFrag = irFrag ?? new MaterialBlueprintIR(null, '');
    this._irVertex = irVertex ?? new MaterialBlueprintIR(null, '');
    this._uniformValues = uniformValues;
    this._uniformTextures = uniformTextures;
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR, this._irVertex.behaviors.useVertexColor);
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_UV, this._irVertex.behaviors.useVertexUV);
  }
  get fragmentIR() {
    return this._irFrag;
  }
  set fragmentIR(ir: MaterialBlueprintIR) {
    if (ir !== this._irFrag) {
      this._irFrag = ir;
      this.clearCache();
      this.optionChanged(true);
    }
  }
  get vertexIR() {
    return this._irVertex;
  }
  set vertexIR(ir: MaterialBlueprintIR) {
    if (ir !== this._irVertex) {
      this._irVertex = ir;
      this.clearCache();
      this.optionChanged(true);
    }
  }
  /** @internal */
  get uniformValues() {
    return this._uniformValues;
  }
  set uniformValues(val: BluePrintUniformValue[]) {
    this._uniformValues = val;
    this.uniformChanged();
  }
  /** @internal */
  get uniformTextures() {
    return this._uniformTextures;
  }
  set uniformTextures(val: BluePrintUniformTexture[]) {
    if (val !== this._uniformTextures) {
      const newUniforms = val.map((v) => ({
        finalTexture: new DRef(v.finalTexture.get()),
        finalSampler: v.finalSampler,
        name: v.name,
        params: v.params?.clone() ?? Vector4.zero(),
        texture: v.texture,
        type: v.type,
        sRGB: v.sRGB,
        wrapS: v.wrapS,
        wrapT: v.wrapT,
        inFragmentShader: v.inFragmentShader,
        inVertexShader: v.inVertexShader,
        minFilter: v.minFilter,
        magFilter: v.magFilter,
        mipFilter: v.mipFilter
      }));
      for (const u of this._uniformTextures) {
        u.finalTexture.dispose();
      }
      this._uniformTextures = newUniforms;
      this.uniformChanged();
    }
  }
  clone(): PBRBluePrintMaterial {
    const other = new PBRBluePrintMaterial(
      this._irFrag,
      this._irVertex,
      this._uniformValues,
      this._uniformTextures
    );
    other.copyFrom(this);
    return other;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.zVertexPos = pb.vec3().attrib('position');
    scope.$inputs.zVertexNormal = pb.vec3().attrib('normal');
    scope.$inputs.zVertexTangent = pb.vec4().attrib('tangent');
    if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR)) {
      scope.$inputs.zVertexColor = pb.vec4().attrib('diffuse');
    }
    if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_UV)) {
      scope.$inputs.zVertexUV = pb.vec2().attrib('texCoord0');
    }

    for (const u of [...this._uniformValues, ...this._uniformTextures]) {
      if (u.inVertexShader) {
        pb.getGlobalScope()[u.name] = pb[u.type]().uniform(2);
      }
    }
    const outputs = this._irVertex.create(pb);
    scope.$l.oPos = this.getOutput(outputs, 'Position') ?? ShaderHelper.resolveVertexPosition(scope);
    const worldMatrix = ShaderHelper.getWorldMatrix(scope);
    scope.$outputs.worldPos = pb.mul(worldMatrix, pb.vec4(scope.oPos, 1)).xyz;
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    scope.$outputs.zVertexColor =
      this.getOutput(outputs, 'Color') ??
      (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR) ? scope.$inputs.zVertexColor : pb.vec4(1));
    scope.$outputs.zVertexUV =
      this.getOutput(outputs, 'UV') ??
      (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_UV) ? scope.$inputs.zVertexUV : pb.vec2(0));
    scope.$l.oNorm = this.getOutput(outputs, 'Normal') ?? ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.zVertexNormal = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    scope.$l.oTangent = this.getOutput(outputs, 'Tangent') ?? ShaderHelper.resolveVertexTangent(scope);
    scope.$outputs.zVertexTangent = pb.mul(
      ShaderHelper.getNormalMatrix(scope),
      pb.vec4(scope.oTangent.xyz, 0)
    ).xyz;
    scope.$outputs.zVertexBinormal = pb.mul(
      pb.cross(scope.$outputs.zVertexNormal, scope.$outputs.zVertexTangent),
      scope.oTangent.w
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      for (const u of [...this._uniformValues, ...this._uniformTextures]) {
        if (u.inFragmentShader) {
          pb.getGlobalScope()[u.name] = pb[u.type]().uniform(2);
        }
      }
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.commonData = this.getCommonDatasStruct(scope)();
      this.getCommonData(
        scope,
        scope.commonData,
        scope.viewVec,
        scope.$inputs.worldPos,
        scope.$inputs.zVertexNormal,
        scope.$inputs.zVertexTangent,
        scope.$inputs.zVertexBinormal,
        scope.$inputs.zVertexColor,
        scope.$inputs.zVertexUV,
        this._irFrag
      );
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
          scope.$l.outRoughness = pb.vec4();
          scope.$l.litColor = this.PBRLight(
            scope,
            scope.$inputs.worldPos,
            scope.viewVec,
            scope.commonData,
            scope.outRoughness
          );
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            scope.litColor,
            scope.outRoughness,
            pb.vec4(pb.add(pb.mul(scope.commonData.normal, 0.5), pb.vec3(0.5)), 1)
          );
        } else {
          scope.$l.litColor = this.PBRLight(scope, scope.$inputs.worldPos, scope.viewVec, scope.commonData);
          this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.litColor);
        }
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.commonData.albedo);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      for (const u of this._uniformValues) {
        bindGroup.setValue(u.name, u.finalValue);
      }
      for (const u of this._uniformTextures) {
        bindGroup.setTexture(u.name, u.finalTexture.get(), u.finalSampler);
      }
    }
  }
  protected _createHash(): string {
    return `${this._irFrag.hash}:${this._irVertex.hash}`;
  }
  protected createProgram(ctx: DrawContext, pass: number) {
    const program = super.createProgram(ctx, pass);
    //console.log(program.getShaderSource('vertex'));
    //console.log(program.getShaderSource('fragment'));
    return program;
  }
  protected onDispose(): void {
    super.onDispose();
    for (const u of this._uniformTextures) {
      u.finalTexture.dispose();
    }
  }
  private getOutput(
    outputs: {
      name: string;
      exp: number | boolean | PBShaderExp;
    }[],
    name: string
  ) {
    return outputs.find((output) => output.name === name)?.exp;
  }
}
