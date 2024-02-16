import { Vector4 } from '@zephyr3d/base';
import { applyMaterialMixins, MeshMaterial } from '../meshmaterial';
import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
} from '@zephyr3d/device';
import type { DrawContext } from '../../render';
import { mixinTextureProps, TextureMixinInstanceTypes } from './texture';

export type IMixinAlbedoColor = {
  albedoColor: Vector4;
  calculateAlbedoColor(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp;
} & TextureMixinInstanceTypes<['albedo']>;

function mixinAlbedoColor<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).albedoColorMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinAlbedoColor };
  }
  const S = applyMaterialMixins(
    BaseCls,
    mixinTextureProps('albedo'),
  );
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
    calculateAlbedoColor(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
      const pb = scope.$builder;
      if (!this.needFragmentColor(ctx)) {
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
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
        scope.$g.kkAlbedo = pb.vec4().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('kkAlbedo', this._albedoColor);
      }
    }
  } as unknown as T & { new (...args: any[]): IMixinAlbedoColor };
}

export { mixinAlbedoColor };
