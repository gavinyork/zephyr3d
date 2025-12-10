import { DRef, Vector4 } from '@zephyr3d/base';
import { type BluePrintUniformTexture, type BluePrintUniformValue } from '../utility/blueprint/material/ir';
import { Sprite3DBlockNode } from '../utility/blueprint/material/pbr';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import { Sprite3DMaterial } from './sprite3d';
import type { BindGroup, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { DrawContext } from '../render';

export class Sprite3DBlueprintMaterial extends Sprite3DMaterial {
  /** @internal */
  private _irFrag: MaterialBlueprintIR;
  /** @internal */
  private _uniformValues: BluePrintUniformValue[];
  /** @internal */
  private _uniformTextures: BluePrintUniformTexture[];
  /**
   * Creates an instance of Sprite3DBlueprintMaterial class
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
  /** @internal */
  get uniformValues() {
    return this._uniformValues;
  }
  set uniformValues(val: BluePrintUniformValue[]) {
    this._uniformValues = (val ?? []).map((v) => ({ ...v }));
    this.uniformChanged();
  }
  /** @internal */
  get uniformTextures() {
    return this._uniformTextures;
  }
  set uniformTextures(val: BluePrintUniformTexture[]) {
    val = val ?? [];
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
  clone(): Sprite3DBlueprintMaterial {
    const other = new Sprite3DBlueprintMaterial(this._irFrag, this._uniformValues, this._uniformTextures);
    other.copyFrom(this);
    return other;
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
  protected calcFragmentColor(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('zCalcSpriteColor', [pb.vec3('zWorldPos'), pb.vec2('zVertexUV')], function () {
      const outputs = that._irFrag.create(pb);
      this.$return(that.getOutput(outputs, 'Color') as PBShaderExp);
    });
    return scope.zCalcSpriteColor(scope.$inputs.zWorldPos, scope.$inputs.zVertexUV);
  }
  protected _createHash(): string {
    return `${super._createHash()}:${this._irFrag.hash}`;
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
