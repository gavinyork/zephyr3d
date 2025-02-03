import { Vector4 } from '@zephyr3d/base';
import type { MeshMaterial } from '../meshmaterial';
import { applyMaterialMixins } from '../meshmaterial';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { DrawContext } from '../../render';
import type { TextureMixinInstanceTypes } from './texture';
import { mixinTextureProps } from './texture';
import { MaterialVaryingFlags } from '../../values';

/**
 * Interface for albedo color mixin
 * @public
 */
export type IMixinAlbedoColor = {
  albedoColor: Vector4;
  calculateAlbedoColor(scope: PBInsideFunctionScope, uv?: PBShaderExp): PBShaderExp;
} & TextureMixinInstanceTypes<['albedo']>;

/**
 * Albedo color mixin
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 *
 * @public
 */
function mixinAlbedoColor<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).albedoColorMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinAlbedoColor };
  }
  const S = applyMaterialMixins(BaseCls, mixinTextureProps('albedo'));
  const ALBEDO_COLOR_UNIFORM = S.defineInstanceUniform('albedoColor', 'rgba');
  return class extends S {
    static albedoColorMixed = true;
    private _albedoColor: Vector4;
    constructor() {
      super();
      this._albedoColor = Vector4.one();
    }
    copyFrom(other: this): void {
      super.copyFrom(other);
      this.albedoColor = other.albedoColor;
    }
    /** Albedo color */
    get albedoColor(): Vector4 {
      return this._albedoColor;
    }
    set albedoColor(val: Vector4) {
      this._albedoColor.set(val);
      this.uniformChanged();
    }
    getUniformValueAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp {
      return this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING
        ? scope.$inputs.zAlbedo
        : scope.zAlbedo;
    }
    calculateAlbedoColor(scope: PBInsideFunctionScope, uv?: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      if (!this.needFragmentColor()) {
        console.warn(
          'mixinAlbedoColor.calculateAlbedoColor(): No need to calculate albedo color, make sure needFragmentColor() returns true'
        );
        return pb.vec4(1);
      }
      let color = this.getUniformValueAlbedoColor(scope);
      if (this.albedoTexture) {
        color = pb.mul(color, this.sampleAlbedoTexture(scope, uv));
      }
      return color;
    }
    vertexShader(scope: PBFunctionScope): void {
      super.vertexShader(scope);
      if (this.needFragmentColor()) {
        if (this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
          scope.$outputs.zAlbedo = this.getInstancedUniform(scope, ALBEDO_COLOR_UNIFORM);
        }
      }
    }
    fragmentShader(scope: PBFunctionScope): void {
      super.fragmentShader(scope);
      if (this.needFragmentColor() && !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)) {
        const pb = scope.$builder;
        scope.zAlbedo = pb.vec4().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx) && !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
        bindGroup.setValue('zAlbedo', this._albedoColor);
      }
    }
  } as unknown as T & { new (...args: any[]): IMixinAlbedoColor };
}

export { mixinAlbedoColor };
