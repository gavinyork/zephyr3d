import { DRef, Vector4 } from '@zephyr3d/base';
import { type BluePrintUniformTexture, type BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { Sprite3DBlockNode } from '../utility/blueprint/material/pbr';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import { Sprite3DMaterial } from './sprite3d';
import type { BindGroup, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { DrawContext } from '../render';

/**
 * Sprite3D material driven by a blueprint graph.
 *
 * @remarks
 * This material extends {@link Sprite3DMaterial} and uses a
 * {@link MaterialBlueprintIR} fragment graph to compute the final
 * sprite color. All fragment shading logic is defined in the
 * blueprint instead of being hard-coded in the material.
 *
 * @public
 */
export class Sprite3DBlueprintMaterial extends Sprite3DMaterial {
  /** @internal */
  private _irFrag: MaterialBlueprintIR;
  /** @internal */
  private _uniformValues: BluePrintUniformValue[];
  /** @internal */
  private _uniformTextures: BluePrintUniformTexture[];
  /**
   * Creates a new {@link Sprite3DBlueprintMaterial} instance.
   *
   * @param irFrag - Optional fragment blueprint IR. If omitted, a default
   *   IR containing a single {@link Sprite3DBlockNode} is created.
   * @param uniformValues - Optional initial list of uniform value descriptors.
   * @param uniformTextures - Optional initial list of texture uniform descriptors.
   */
  constructor(
    irFrag?: MaterialBlueprintIR,
    uniformValues?: BluePrintUniformValue[],
    uniformTextures?: BluePrintUniformTexture[]
  ) {
    super();
    this._irFrag =
      irFrag ??
      new MaterialBlueprintIR(
        {
          nodeMap: { '1': new Sprite3DBlockNode() },
          roots: [1],
          order: [1],
          graph: { incoming: {}, outgoing: {} }
        },
        '',
        {
          nodes: [{ id: 1, title: '', locked: true, node: { ClassName: 'Sprite3DBlockNode', Object: '' } }],
          links: []
        }
      );
    this._uniformValues = uniformValues ?? [];
    this._uniformTextures = uniformTextures ?? [];
  }
  /**
   * Gets the fragment blueprint IR used to generate the fragment shader.
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
   * Gets the list of uniform value descriptors used by the blueprint.
   */
  get uniformValues() {
    return this._uniformValues;
  }
  set uniformValues(val: BluePrintUniformValue[]) {
    this._uniformValues = (val ?? []).map((v) => ({ ...v }));
    this.uniformChanged();
  }
  /**
   * Gets the list of texture uniform descriptors used by the blueprint.
   */
  get uniformTextures() {
    return this._uniformTextures;
  }
  set uniformTextures(val: BluePrintUniformTexture[]) {
    val = val ?? [];
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
   * Creates a deep copy of this blueprint material.
   *
   * @remarks
   * The clone shares the same fragment IR reference and copies the
   * current uniform descriptors, then calls {@link Sprite3DMaterial.copyFrom}
   * to copy base-class state.
   *
   * @returns A new {@link Sprite3DBlueprintMaterial} instance.
   */
  clone() {
    const other = new Sprite3DBlueprintMaterial(this._irFrag, this._uniformValues, this._uniformTextures);
    other.copyFrom(this);
    return other;
  }
  /**
   * Applies runtime uniform values and textures to the given bind group.
   *
   * @remarks
   * - Calls the base implementation to bind sprite-related uniforms first.
   * - If fragment color is needed for the current context, all blueprint
   *   uniform values and textures are then bound by name:
   *   - `uniformValues` via `bindGroup.setValue`.
   *   - `uniformTextures` via `bindGroup.setTexture`.
   *
   * @param bindGroup - The bind group to bind material resources to.
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
   * Computes the fragment color by invoking the blueprint-generated function.
   *
   * @remarks
   * - A helper function `zCalcSpriteColor(zWorldPos, zVertexUV)` is declared
   *   on the shader builder using the current fragment IR.
   * - The blueprint IR is asked to create its node network via
   *   {@link MaterialBlueprintIR.create}, and the output named `"Color"`
   *   is used as the return value.
   * - The resulting function is invoked with the current world position and
   *   UV coordinates for each fragment.
   *
   * @param scope - The current fragment shader function scope.
   * @returns A shader expression representing the final fragment color.
   */
  protected calcFragmentColor(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    const that = this;
    pb.func('zCalcSpriteColor', [pb.vec3('zWorldPos'), pb.vec2('zVertexUV')], function () {
      const outputs = that._irFrag.create(pb)!;
      this.$return(that.getOutput(outputs, 'Color') as PBShaderExp);
    });
    return scope.zCalcSpriteColor(scope.$inputs.zWorldPos, scope.$inputs.zVertexUV) as PBShaderExp;
  }
  /**
   * Creates a unique hash string used for program caching.
   *
   * @remarks
   * The hash includes the base {@link Sprite3DMaterial} hash and the
   * fragment IR hash, so that different blueprints will produce
   * different shader programs.
   *
   * @returns A hash string that identifies this material configuration.
   */
  protected _createHash() {
    return `${super._createHash()}:${this._irFrag.hash}`;
  }
  /**
   * Creates the GPU program for this material.
   *
   * @remarks
   * This simply delegates to the base implementation and returns its result.
   * Commented-out logging lines are available for debugging the generated
   * vertex and fragment shader sources.
   *
   * @param ctx - The current draw context.
   * @param pass - Index of the active material pass.
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
   * - Disposes all `finalTexture` references from the blueprint texture
   *   uniform descriptors.
   *
   * This method is intended to be called by the engine's resource management
   * system rather than directly from user code.
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
   * @param outputs - List of outputs generated by the blueprint graph.
   * @param name - Name of the output to look for (e.g. `"Color"`).
   * @returns The matching output expression, or `undefined` if not found.
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
