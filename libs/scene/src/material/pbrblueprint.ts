import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { BindGroup, PBFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { Clonable } from '@zephyr3d/base';
import { mixinPBRBluePrint } from './mixins/lightmodel/pbrblueprintmixin';
import type { IRUniformTexture, IRUniformValue } from '../utility/blueprint/material/ir';
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
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_VERTEX_UV = this.defineFeature();
  /** @internal */
  private _irFrag: MaterialBlueprintIR;
  /** @internal */
  private _irVertex: MaterialBlueprintIR;
  /** @internal */
  private _uniformValues: IRUniformValue[];
  /** @internal */
  private _uniformTextures: IRUniformTexture[];
  /**
   * Creates an instance of PBRMetallicRoughnessMaterial class
   */
  constructor(irFrag: MaterialBlueprintIR, irVertex: MaterialBlueprintIR) {
    super();
    this._irFrag = irFrag ?? new MaterialBlueprintIR(null, '');
    this._irVertex = irVertex ?? new MaterialBlueprintIR(null, '');
    this._uniformValues = [];
    this._uniformTextures = [];
    this.updateUniforms();
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_TANGENT, this._irVertex.behaviors.useVertexTangent);
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
      this.updateUniforms();
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
      this.updateUniforms();
      this.optionChanged(true);
    }
  }
  /** @internal */
  get uniformValues() {
    return this._uniformValues;
  }
  set uniformValues(val: IRUniformValue[]) {
    this._uniformValues = val;
    this.uniformChanged();
  }
  /** @internal */
  get uniformTextures() {
    return this._uniformTextures;
  }
  set uniformTextures(val: IRUniformTexture[]) {
    this._uniformTextures = val;
    this.uniformChanged();
  }
  clone(): PBRBluePrintMaterial {
    const other = new PBRBluePrintMaterial(this._irFrag, this._irVertex);
    other.copyFrom(this);
    return other;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    const outputs = this._irVertex.create(pb);
    scope.$l.oPos = this.getOutput(outputs, 'Position') ?? ShaderHelper.resolveVertexPosition(scope);
    const worldMatrix = ShaderHelper.getWorldMatrix(scope);
    scope.$outputs.worldPos = pb.mul(worldMatrix, pb.vec4(scope.oPos, 1)).xyz;
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR)) {
      scope.$inputs.vertexColor = pb.vec4().attrib('diffuse');
    }
    scope.$outputs.zVertexColor =
      this.getOutput(outputs, 'Color') ??
      (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR) ? scope.$inputs.vertexColor : pb.vec4(1));
    if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_UV)) {
      scope.$inputs.vertexUV = pb.vec2().attrib('texCoord0');
    }
    scope.$outputs.zVertexUV =
      this.getOutput(outputs, 'UV') ??
      (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_UV) ? scope.$inputs.vertexUV : pb.vec2(0));
    scope.$l.oNorm = this.getOutput(outputs, 'Normal') ?? ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.zVertexNormal = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    scope.$l.oTangent =
      this.getOutput(outputs, 'Tangent') ??
      (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_TANGENT)
        ? ShaderHelper.resolveVertexTangent(scope)
        : pb.vec4(1, 0, 0, 1));
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
        bindGroup.setValue(u.name, u.value);
      }
      for (const u of this._uniformTextures) {
        bindGroup.setTexture(u.name, u.texture.get(), u.sampler.get());
      }
    }
  }
  protected _createHash(): string {
    return this._irFrag.hash;
  }
  /*
  protected createProgram(ctx: DrawContext, pass: number) {
    const program = super.createProgram(ctx, pass);
    console.log(program.getShaderSource('vertex'));
    console.log(program.getShaderSource('fragment'));
    return program;
  }
  */
  private getOutput(
    outputs: {
      name: string;
      exp: number | PBShaderExp;
    }[],
    name: string
  ) {
    return outputs.find((output) => output.name === name)?.exp;
  }
  private updateUniforms() {
    this._uniformValues = [];
    for (const u of [...(this._irFrag.uniformValues ?? []), ...(this._irVertex.uniformValues ?? [])]) {
      if (!this._uniformValues.findIndex((val) => val.name === u.name)) {
        this._uniformValues.push(u);
      }
    }
    this._uniformTextures = [];
    for (const u of [...(this._irFrag.uniformTextures ?? []), ...(this._irVertex.uniformTextures ?? [])]) {
      if (!this._uniformTextures.findIndex((val) => val.name === u.name)) {
        this._uniformTextures.push(u);
      }
    }
  }
}
