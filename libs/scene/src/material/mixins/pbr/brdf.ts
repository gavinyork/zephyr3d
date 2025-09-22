import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';

/**
 * Interface for common PBR mixin
 *
 * @public
 */
export type IMixinPBRBRDF = {
  fresnelSchlick(
    scope: PBInsideFunctionScope,
    cosTheta: PBShaderExp,
    F0: PBShaderExp,
    F90: PBShaderExp
  ): PBShaderExp;
  distributionGGX(scope: PBInsideFunctionScope, NdotH: PBShaderExp, alphaRoughness: PBShaderExp): PBShaderExp;
  visGGX(
    scope: PBInsideFunctionScope,
    NdotV: PBShaderExp,
    NdotL: PBShaderExp,
    alphaRoughness: PBShaderExp
  ): PBShaderExp;
};

/**
 * PBR common stuff mixin
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 *
 * @public
 */
export function mixinPBRBRDF<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrBRDFMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRBRDF };
  }

  const cls = class extends (BaseCls as typeof MeshMaterial) {
    static readonly pbrBRDFMixed = true;
    fresnel0ToIor(scope: PBInsideFunctionScope, fresnel0: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_fresnel0ToIor';
      pb.func(funcName, [pb.vec3('fresnel0')], function () {
        this.$l.sqrtF0 = pb.sqrt(this.fresnel0);
        this.$return(pb.div(pb.add(this.sqrtF0, pb.vec3(1)), pb.sub(pb.vec3(1), this.sqrtF0)));
      });
      return pb.getGlobalScope()[funcName](fresnel0);
    }
    iorToFresnel0v(
      scope: PBInsideFunctionScope,
      transmittedIor: PBShaderExp,
      incidentIor: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_iorToFresnel0v';
      pb.func(funcName, [pb.vec3('transmittedIor'), pb.float('incidentIor')], function () {
        this.$l.t = pb.div(
          pb.sub(this.transmittedIor, pb.vec3(this.incidentIor)),
          pb.add(this.transmittedIor, pb.vec3(this.incidentIor))
        );
        this.$return(pb.mul(this.t, this.t));
      });
      return pb.getGlobalScope()[funcName](transmittedIor, incidentIor);
    }
    iorToFresnel0(
      scope: PBInsideFunctionScope,
      transmittedIor: PBShaderExp,
      incidentIor: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_iorToFresnel0';
      pb.func(funcName, [pb.float('transmittedIor'), pb.float('incidentIor')], function () {
        this.$l.t = pb.div(
          pb.sub(this.transmittedIor, this.incidentIor),
          pb.add(this.transmittedIor, this.incidentIor)
        );
        this.$return(pb.mul(this.t, this.t));
      });
      return pb.getGlobalScope()[funcName](transmittedIor, incidentIor);
    }
    evalSensitivity(scope: PBInsideFunctionScope, OPD: PBShaderExp, shift: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_evalSensitivity';
      pb.func(funcName, [pb.float('OPD'), pb.vec3('shift')], function () {
        this.$l.phase = pb.mul(Math.PI * 2, this.OPD, 1e-9);
        this.$l.val = pb.vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
        this.$l.pos = pb.vec3(1.681e6, 1.7953e6, 2.2084e6);
        this.$l.va = pb.vec3(4.3278e9, 9.3046e9, 6.6121e9);
        this.$l.xyz = pb.mul(
          this.val,
          pb.sqrt(pb.mul(Math.PI * 2, this.va)),
          pb.cos(pb.add(pb.mul(this.pos, this.phase), this.shift)),
          pb.exp(pb.neg(pb.mul(this.phase, this.phase, this.va)))
        );
        this.xyz.x = pb.add(
          this.xyz.x,
          pb.mul(
            9.747e-14,
            Math.sqrt(Math.PI * 2 * 4.5282e9),
            pb.cos(pb.add(pb.mul(this.phase, 2.2399e6), this.shift.x)),
            pb.exp(pb.mul(-4.5282e9, this.phase, this.phase))
          )
        );
        this.xyz = pb.div(this.xyz, 1.0685e-7);
        this.$return(
          pb.mul(
            pb.mat3(
              3.2404542,
              -0.969266,
              0.0556434,
              -1.5371385,
              1.8760108,
              -0.2040259,
              -0.4985314,
              0.041556,
              1.0572252
            ),
            this.xyz
          )
        );
      });
      return pb.getGlobalScope()[funcName](OPD, shift);
    }
    schlickToF0(
      scope: PBInsideFunctionScope,
      f: PBShaderExp,
      f90: PBShaderExp,
      VdotH: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_schlickToF0';
      pb.func(funcName, [pb.vec3('f'), pb.vec3('f90'), pb.float('VdotH')], function () {
        this.$l.x = pb.clamp(pb.sub(1, this.VdotH), 0, 1);
        this.$l.x2 = pb.mul(this.x, this.x);
        this.$l.x5 = pb.clamp(pb.mul(this.x, this.x2, this.x2), 0, 0.9999);
        this.$return(pb.div(pb.sub(this.f, pb.mul(this.f90, this.x5)), pb.sub(1, this.x5)));
      });
      return pb.getGlobalScope()[funcName](f, f90, VdotH);
    }
    fresnelSchlick(
      scope: PBInsideFunctionScope,
      cosTheta: PBShaderExp,
      F0: PBShaderExp,
      F90: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_fresnelSchlick';
      pb.func(funcName, [pb.float('cosTheta'), pb.vec3('f0'), pb.vec3('f90')], function () {
        this.$return(
          pb.add(
            this.f0,
            pb.mul(pb.sub(this.f90, this.f0), pb.pow(pb.clamp(pb.sub(1, this.cosTheta), 0, 1), 5))
          )
        );
      });
      return scope.$g[funcName](cosTheta, F0, F90);
    }
    distributionGGX(
      scope: PBInsideFunctionScope,
      NdotH: PBShaderExp,
      alphaRoughness: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_distributionGGX';
      pb.func(funcName, [pb.float('NdotH'), pb.float('roughness')], function () {
        this.$l.a2 = pb.mul(this.roughness, this.roughness);
        this.$l.NdotH2 = pb.mul(this.NdotH, this.NdotH);
        this.$l.num = this.a2;
        this.$l.denom = pb.add(pb.mul(this.NdotH2, pb.sub(this.a2, 1)), 1);
        this.denom = pb.mul(pb.mul(3.14159265, this.denom), this.denom);
        this.$return(pb.div(this.num, this.denom));
      });
      return scope.$g[funcName](NdotH, alphaRoughness);
    }
    visGGX(
      scope: PBInsideFunctionScope,
      NdotV: PBShaderExp,
      NdotL: PBShaderExp,
      alphaRoughness: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_visGGX';
      pb.func(funcName, [pb.float('NdotV'), pb.float('NdotL'), pb.float('roughness')], function () {
        this.$l.a = this.roughness;
        this.$l.ggxV = pb.mul(
          this.NdotL,
          pb.sqrt(pb.add(pb.mul(this.NdotV, this.NdotV, pb.sub(1, this.a)), this.a))
        );
        this.$l.ggxL = pb.mul(
          this.NdotV,
          pb.sqrt(pb.add(pb.mul(this.NdotL, this.NdotL, pb.sub(1, this.a)), this.a))
        );
        this.$l.ggx = pb.add(this.ggxV, this.ggxL, 1e-5);
        this.$if(pb.greaterThan(this.ggx, 0), function () {
          this.$return(pb.div(0.5, this.ggx));
        }).$else(function () {
          this.$return(pb.float(0));
        });
      });
      return scope.$g[funcName](NdotV, NdotL, alphaRoughness);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRBRDF };
  return cls;
}
