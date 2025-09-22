import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { Clonable } from '@zephyr3d/base';
import { mixinPBRBluePrint } from './mixins/lightmodel/pbrblueprintmixin';
import type { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import type { DrawContext } from '../render';

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
  private static readonly FEATURE_VERTEX_NORMAL = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_VERTEX_TANGENT = this.defineFeature();
  /** @internal */
  private _ir: MaterialBlueprintIR;
  /**
   * Creates an instance of PBRMetallicRoughnessMaterial class
   */
  constructor(ir: MaterialBlueprintIR) {
    super();
    this._ir = ir;
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_NORMAL, this._ir.behaviors.useVertexNormal);
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_TANGENT, this._ir.behaviors.useVertexTangent);
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR, this._ir.behaviors.useVertexColor);
  }
  clone(): PBRBluePrintMaterial {
    const other = new PBRBluePrintMaterial(this._ir);
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this._ir = other._ir;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    const worldMatrix = ShaderHelper.getWorldMatrix(scope);
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(worldMatrix, pb.vec4(scope.oPos, 1)).xyz;
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR)) {
      scope.$inputs.vertexColor = pb.vec4().attrib('diffuse');
      scope.$outputs.zVertexColor = scope.$inputs.vertexColor;
    }
    if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_NORMAL)) {
      scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
      scope.$outputs.zVertexNormal = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
      if (this.featureUsed(PBRBluePrintMaterial.FEATURE_VERTEX_TANGENT)) {
        scope.$l.oTangent = ShaderHelper.resolveVertexTangent(scope);
        scope.$outputs.zVertexTangent = pb.mul(
          ShaderHelper.getNormalMatrix(scope),
          pb.vec4(scope.oTangent.xyz, 0)
        ).xyz;
        scope.$outputs.zVertexBinormal = pb.mul(
          pb.cross(scope.$outputs.zVertexNormal, scope.$outputs.zVertexTangent),
          scope.oTangent.w
        );
      }
    }
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.$l.commonData = this.getCommonData(scope, this._ir);
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
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
            pb.vec4(pb.add(pb.mul(scope.normalInfo.normal, 0.5), pb.vec3(0.5)), 1)
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
      for (const u of this._ir.uniformValues) {
        bindGroup.setValue(u.name, u.value);
      }
      for (const u of this._ir.uniformTextures) {
        bindGroup.setTexture(u.name, u.defaultTexture.get(), u.sampler.get());
      }
    }
  }
  protected _createHash(): string {
    return this._ir.hash;
  }
}
