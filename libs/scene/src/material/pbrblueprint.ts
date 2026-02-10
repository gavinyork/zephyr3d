import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import type { BindGroup, PBFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../values';
import { DRef, Vector4, type Clonable } from '@zephyr3d/base';
import { mixinPBRBluePrint } from './mixins/lightmodel/pbrblueprintmixin';
import type { BluePrintUniformTexture, BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import type { DrawContext } from '../render/drawable';
import { PBRBlockNode, VertexBlockNode } from '../utility/blueprint/material/pbr';

/**
 * Physically-based rendering material driven by blueprint graphs.
 *
 * @remarks
 * This material extends {@link MeshMaterial} with PBR behavior via
 * {@link mixinPBRBluePrint}, and uses {@link MaterialBlueprintIR}
 * graphs for both vertex and fragment stages.
 *
 * - The **vertex blueprint IR** (`vertexIR`) controls vertex
 *   transformations and per-vertex data.
 * - The **fragment blueprint IR** (`fragmentIR`) produces inputs
 *   for the PBR shading model (albedo, roughness, metalness, etc.).
 *
 * Uniform values and textures for the blueprints are provided via
 * {@link PBRBluePrintMaterial.uniformValues} and
 * {@link PBRBluePrintMaterial.uniformTextures}.
 *
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
   * Creates a new {@link PBRBluePrintMaterial} instance.
   *
   * @param irFrag - Optional fragment blueprint IR. If omitted, a default
   *   IR containing a single {@link PBRBlockNode} is created.
   * @param irVertex - Optional vertex blueprint IR. If omitted, a default
   *   IR containing a single {@link VertexBlockNode} is created.
   * @param uniformValues - Optional initial list of uniform value descriptors.
   * @param uniformTextures - Optional initial list of texture uniform descriptors.
   */
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
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR, this._irVertex.behaviors.useVertexColor);
    this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_UV, this._irVertex.behaviors.useVertexUV);
  }
  /**
   * Gets the fragment blueprint IR.
   */
  get fragmentIR() {
    return this._irFrag;
  }
  set fragmentIR(ir: MaterialBlueprintIR) {
    if (ir && ir !== this._irFrag) {
      this._irFrag = ir;
      this.clearCache();
      this.optionChanged(true);
    }
  }
  /**
   * Gets the vertex blueprint IR.
   */
  get vertexIR() {
    return this._irVertex;
  }
  set vertexIR(ir: MaterialBlueprintIR) {
    if (ir && ir !== this._irVertex) {
      this._irVertex = ir;
      this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_COLOR, this._irVertex.behaviors.useVertexColor);
      this.useFeature(PBRBluePrintMaterial.FEATURE_VERTEX_UV, this._irVertex.behaviors.useVertexUV);
      this.clearCache();
      this.optionChanged(true);
    }
  }
  /**
   * Gets the list of uniform value descriptors used by the blueprints.
   */
  get uniformValues() {
    return this._uniformValues;
  }
  set uniformValues(val: BluePrintUniformValue[]) {
    this._uniformValues = (val ?? []).map((v) => ({ ...v }));
    this.uniformChanged();
  }
  /**
   * Gets the list of texture uniform descriptors used by the blueprints.
   */
  get uniformTextures() {
    return this._uniformTextures;
  }
  set uniformTextures(val: BluePrintUniformTexture[]) {
    if (val !== this._uniformTextures) {
      const newUniforms = val.map((v) => ({
        finalTexture: new DRef(v.finalTexture!.get()),
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
        u.finalTexture!.dispose();
      }
      this._uniformTextures = newUniforms;
      this.uniformChanged();
    }
  }
  /**
   * Creates a deep copy of this material.
   *
   * @remarks
   * The clone shares the same vertex/fragment IR references and copies
   * the current blueprint uniform descriptors, then calls `copyFrom`
   * to copy base-class and mixin state.
   *
   * @returns A new {@link PBRBluePrintMaterial} instance.
   */
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
  /**
   * Builds the vertex shader for this PBR blueprint material.
   *
   * @param scope - The current vertex shader function scope.
   */
  vertexShader(scope: PBFunctionScope) {
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
        // @ts-ignore
        pb.getGlobalScope()[u.name] = pb[u.type]().uniform(2);
      }
    }
    const outputs = this._irVertex.create(pb)!;
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
  /**
   * Builds the fragment shader for this PBR blueprint material.
   *
   * @param scope - The current fragment shader function scope.
   */
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      for (const u of [...this._uniformValues, ...this._uniformTextures]) {
        if (u.inFragmentShader) {
          // @ts-ignore
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
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
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
  /**
   * Applies runtime uniform values and textures to the given bind group.
   *
   * @remarks
   * - Calls the base implementation first to bind standard mesh/PBR uniforms.
   * - If fragment color is needed for the current context, all blueprint
   *   scalar/vector uniform values and textures are then bound by name.
   *
   * @param bindGroup - The bind group to which material resources are bound.
   * @param ctx - The current draw context.
   * @param pass - Index of the active render pass.
   */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      for (const u of this._uniformValues) {
        bindGroup.setValue(u.name, u.finalValue!);
      }
      for (const u of this._uniformTextures) {
        bindGroup.setTexture(u.name, u.finalTexture!.get()!, u.finalSampler);
      }
    }
  }
  /**
   * Creates a unique hash string used for program caching.
   *
   * @remarks
   * The hash includes:
   * - The base material hash (`super._createHash()`).
   * - The fragment IR hash.
   * - The vertex IR hash.
   *
   * Different blueprint graphs will therefore produce different programs.
   *
   * @returns A hash string that uniquely identifies this material configuration.
   */
  protected _createHash() {
    return `${super._createHash()}:${this._irFrag.hash}:${this._irVertex.hash}`;
  }
  /**
   * Creates the GPU program for this blueprint PBR material.
   *
   * @remarks
   * This calls the base implementation and returns its result.
   * Commented-out `console.log` lines are provided for debugging the
   * generated vertex and fragment shader sources.
   *
   * @param ctx - The current draw context.
   * @param pass - Index of the active render pass.
   * @returns The created GPU program.
   */
  protected createProgram(ctx: DrawContext, pass: number) {
    const program = super.createProgram(ctx, pass);
    //console.log(program.getShaderSource('vertex'));
    //console.log(program.getShaderSource('fragment'));
    return program;
  }
  /**
   * Disposes resources associated with this material.
   *
   * @remarks
   * - Calls the base `onDispose` to clean up inherited resources.
   * - Disposes all `finalTexture` references from the blueprint
   *   texture uniform descriptors.
   *
   * This method is intended to be called by the engine's resource
   * management system rather than directly by user code.
   */
  protected onDispose() {
    super.onDispose();
    for (const u of this._uniformTextures) {
      u.finalTexture!.dispose();
    }
  }
  /**
   * Retrieves a named output expression from a blueprint output list.
   *
   * @param outputs - The list of outputs generated by a blueprint graph.
   * @param name - The desired output name (e.g. `"Position"`, `"Color"`, `"UV"`).
   * @returns The expression associated with the given name, or `undefined` if not found.
   */
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
