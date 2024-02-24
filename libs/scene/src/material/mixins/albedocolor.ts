import { Vector4 } from '@zephyr3d/base';
import type { MeshMaterial } from '../meshmaterial';
import { applyMaterialMixins } from '../meshmaterial';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { DrawContext } from '../../render';
import type { TextureMixinInstanceTypes } from './texture';
import { mixinTextureProps } from './texture';

export type IMixinAlbedoColor = {
  albedoColor: Vector4;
  calculateAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp;
} & TextureMixinInstanceTypes<['albedo']>;

function mixinAlbedoColor<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).albedoColorMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinAlbedoColor };
  }
  const S = applyMaterialMixins(BaseCls, mixinTextureProps('albedo'));
  return class extends S {
    static albedoColorMixed = true;
    private _albedoColor: Vector4;
    constructor() {
      super();
      this._albedoColor = Vector4.one();
    }
    /** Albedo color */
    get albedoColor(): Vector4 {
      return this._albedoColor;
    }
    set albedoColor(val: Vector4) {
      this._albedoColor.set(val);
      this.optionChanged(false);
    }
    calculateAlbedoColor(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      if (!this.needFragmentColor()) {
        console.warn(
          'mixinAlbedoColor.calculateAlbedoColor(): No need to calculate albedo color, make sure needFragmentColor() returns true'
        );
        return pb.vec4(1);
      }
      let color = scope.kkAlbedo;
      if (this.albedoTexture) {
        color = pb.mul(color, this.sampleAlbedoTexture(scope));
      }
      return color;
    }
    fragmentShader(scope: PBFunctionScope): void {
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        const pb = scope.$builder;
        scope.kkAlbedo = pb.vec4().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('kkAlbedo', this._albedoColor);
      }
    }
  } as unknown as T & { new (...args: any[]): IMixinAlbedoColor };
}

export { mixinAlbedoColor };
