import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/** @internal */
export function fresnelSchlick(
  scope: PBInsideFunctionScope,
  VdotH: PBShaderExp,
  f0: PBShaderExp,
  f90: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'fresnelSchlick';
  pb.func(funcName, [pb.float('VdotH'), pb.vec3('F0'), pb.vec3('F90')], function () {
    this.$return(
      pb.add(this.F0, pb.mul(pb.sub(this.F90, this.F0), pb.pow(pb.clamp(pb.sub(1, this.VdotH), 0, 1), 5)))
    );
  });
  return pb.getGlobalScope()[funcName](VdotH, f0, f90);
}

/** @internal */
export function distributionGGX(
  scope: PBInsideFunctionScope,
  NdotH: PBShaderExp,
  alphaRoughness: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'distributionGGX';
  pb.func(funcName, [pb.float('NdotH'), pb.float('roughness')], function () {
    this.$l.a2 = pb.mul(this.roughness, this.roughness);
    this.$l.NdotH2 = pb.mul(this.NdotH, this.NdotH);
    this.$l.num = this.a2;
    this.$l.denom = pb.add(pb.mul(this.NdotH2, pb.sub(this.a2, 1)), 1);
    this.denom = pb.mul(pb.mul(3.14159265, this.denom), this.denom);
    this.$return(pb.div(this.num, this.denom));
  });
  return pb.getGlobalScope()[funcName](NdotH, alphaRoughness);
}

/** @internal */
export function visGGX(
  scope: PBInsideFunctionScope,
  NdotV: PBShaderExp,
  NdotL: PBShaderExp,
  alphaRoughness: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'visGGX';
  pb.func(funcName, [pb.float('NdotV'), pb.float('NdotL'), pb.float('roughness')], function () {
    this.$l.a2 = pb.mul(this.roughness, this.roughness);
    this.$l.ggxV = pb.mul(
      this.NdotL,
      pb.sqrt(pb.add(pb.mul(this.NdotV, this.NdotV, pb.sub(1, this.a2)), this.a2))
    );
    this.$l.ggxL = pb.mul(
      this.NdotV,
      pb.sqrt(pb.add(pb.mul(this.NdotL, this.NdotL, pb.sub(1, this.a2)), this.a2))
    );
    this.$l.ggx = pb.add(this.ggxV, this.ggxL);
    this.$if(pb.greaterThan(this.ggx, 0), function () {
      this.$return(pb.div(0.5, this.ggx));
    }).$else(function () {
      this.$return(pb.float(0));
    });
  });
  return pb.getGlobalScope()[funcName](NdotV, NdotL, alphaRoughness);
}

