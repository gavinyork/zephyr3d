import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../meshmaterial';

/**
 * Interface for foliage mixin
 * @public
 */
export interface IMixinFoliage {
  calculateFoliageAlbedo(
    scope: PBInsideFunctionScope,
    albedoColor: PBShaderExp,
    texelCoord: PBShaderExp
  ): PBShaderExp;
}

/**
 * Foliage mixin
 *
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 *
 * @public
 */
function mixinFoliage<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).foliageMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinFoliage };
  }
  return class extends (BaseCls as typeof MeshMaterial) {
    static foliageMixed = true;
    constructor(poolId?: symbol) {
      super(poolId);
      this.cullMode = 'none';
    }
    calculateFoliageAlbedo(
      scope: PBInsideFunctionScope,
      albedoColor: PBShaderExp,
      texelCoord: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const funcNameCalcMipLevel = 'Z_CalcFoliageMipLevel';
      pb.func(funcNameCalcMipLevel, [pb.vec2('coord')], function () {
        this.$l.dx = pb.dpdx(this.coord);
        this.$l.dy = pb.dpdy(this.coord);
        this.$l.deltaMaxSqr = pb.max(pb.dot(this.dx, this.dx), pb.dot(this.dy, this.dy));
        this.$return(pb.max(0, pb.mul(pb.log2(this.deltaMaxSqr), 0.5)));
      });
      const funcNameCalcFoliageAlbedo = 'Z_calcFoliageAlbedo';
      pb.func(funcNameCalcFoliageAlbedo, [pb.vec4('albedo'), pb.vec2('coord')], function () {
        this.$l.a = pb.mul(
          this.albedo.a,
          pb.add(1, pb.mul(pb.max(0, scope[funcNameCalcMipLevel](this.coord)), 0.25))
        );
        if (that.alphaToCoverage) {
          this.a = pb.add(pb.div(pb.sub(this.a, 0.4), pb.max(pb.fwidth(this.albedo.a), 0.0001)), 0.5);
        }
        this.$return(pb.vec4(this.albedo.rgb, this.a));
      });
      return pb.getGlobalScope()[funcNameCalcFoliageAlbedo](albedoColor, texelCoord);
    }
  } as unknown as T & { new (...args: any[]): IMixinFoliage };
}

export { mixinFoliage };
