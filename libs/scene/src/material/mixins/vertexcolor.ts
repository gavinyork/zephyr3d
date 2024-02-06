import type { IMeshMaterial } from "../meshmaterial";
import type { PBFunctionScope, PBInsideFunctionScope } from "@zephyr3d/device";
import { DrawContext } from "../../render";
import { RENDER_PASS_TYPE_FORWARD } from "../../values";

export interface IMixinVertexColor {
  vertexColor: boolean;
  getVertexColor(scope: PBInsideFunctionScope, ctx: DrawContext);
}

function mixinVertexColor<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).vertexColorMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinVertexColor };
  }
  const FEATURE_VERTEX_COLOR = 'z-feature-vertex-color';
  return class extends (BaseCls as { new (...args: any[]): IMeshMaterial }) {
    static vertexColorMixed = true;
    constructor(...args: any[]) {
      super(...args);
    }
    /** Albedo color */
    get vertexColor(): boolean {
      return this.featureUsed(FEATURE_VERTEX_COLOR, RENDER_PASS_TYPE_FORWARD);
    }
    set vertexColor(val: boolean) {
      this.useFeature(FEATURE_VERTEX_COLOR, !!val);
    }
    vertexShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.vertexShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        if (this.vertexColor) {
          if (scope.$getVertexAttrib('diffuse')) {
            throw new Error('mixinVertexColor.vertexShader(): diffuse vertex stream already defined');
          }
          scope.$inputs.zDiffuse = scope.$builder.vec4().attrib('diffuse');
          scope.$outputs.zOutDiffuse = scope.$inputs.zDiffuse;
        }
      }
    }
    getVertexColor(scope: PBInsideFunctionScope, ctx: DrawContext) {
      if (!this.needFragmentColor(ctx)) {
        throw new Error('mixinVertexColor.getVertexColor(): No need to calculate albedo color, make sure needFragmentColor() returns true');
      }
      if (scope.$builder.shaderKind === 'fragment') {
        return scope.$inputs.zOutDiffuse;
      } else {
        return scope.$inputs.zDiffuse;
      }
    }
  } as unknown as { new (...args: any[]): T & IMixinVertexColor };
}

export { mixinVertexColor };
