import type { MeshMaterial } from '../meshmaterial';
import type { PBFunctionScope, PBInsideFunctionScope } from '@zephyr3d/device';

/**
 * Interface for vertex color mixin
 *
 * @public
 */
export interface IMixinVertexColor {
  vertexColor: boolean;
  getVertexColor(scope: PBInsideFunctionScope);
}

/**
 * Vertex color mixin
 *
 * @param BaseCls - Base class to mix in
 * @returns Mixed class
 *
 * @public
 */
function mixinVertexColor<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).vertexColorMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinVertexColor };
  }
  let FEATURE_VERTEX_COLOR = 0;
  const cls = class extends (BaseCls as typeof MeshMaterial) {
    static vertexColorMixed = true;
    constructor(poolId?: symbol) {
      super(poolId);
    }
    /** Albedo color */
    get vertexColor(): boolean {
      return this.featureUsed(FEATURE_VERTEX_COLOR);
    }
    set vertexColor(val: boolean) {
      this.useFeature(FEATURE_VERTEX_COLOR, !!val);
    }
    vertexShader(scope: PBFunctionScope): void {
      super.vertexShader(scope);
      if (this.needFragmentColor()) {
        if (this.vertexColor) {
          if (scope.$getVertexAttrib('diffuse')) {
            throw new Error('mixinVertexColor.vertexShader(): diffuse vertex stream already defined');
          }
          scope.$inputs.zDiffuse = scope.$builder.vec4().attrib('diffuse');
          scope.$outputs.zOutDiffuse = scope.$inputs.zDiffuse;
        }
      }
    }
    getVertexColor(scope: PBInsideFunctionScope) {
      if (!this.needFragmentColor()) {
        throw new Error(
          'mixinVertexColor.getVertexColor(): No need to calculate albedo color, make sure needFragmentColor() returns true'
        );
      }
      if (scope.$builder.shaderKind === 'fragment') {
        return scope.$inputs.zOutDiffuse;
      } else {
        return scope.$inputs.zDiffuse;
      }
    }
  } as unknown as T & { new (...args: any[]): IMixinVertexColor };
  FEATURE_VERTEX_COLOR = cls.defineFeature();
  return cls;
}

export { mixinVertexColor };
