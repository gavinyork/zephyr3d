import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { distributionGGX, fresnelSchlick, visGGX } from './pbr';

/**
 * Pre-integrated skin diffuse BRDF aligned with UE5's SubsurfaceProfile shading model.
 *
 * @remarks
 * Instead of plain Lambert, skin uses a curvature-dependent wrapped diffuse with
 * Schlick-like Fresnel attenuation at both ends (NdotL and NdotV). This produces
 * the characteristic soft terminator of skin without a post-process blur, and it
 * is what UE5's deferred lighting evaluates for shading model 5.
 *
 * Formula reverse-engineered from UEDigitalHuman.rdc deferred lighting case l(5),
 * lines 1331-1360.
 *
 * @param scope - Shader scope.
 * @param NdotL - Clamped dot(normal, lightDir), raw (not abs).
 * @param NdotV - Clamped dot(normal, viewDir).
 * @param VdotL - dot(viewDir, lightDir).
 * @param roughness - Material roughness.
 * @returns Scalar diffuse BRDF value (caller multiplies by albedo and 1/PI).
 *
 * @internal
 */
export function skinDiffuseBRDF(
  scope: PBInsideFunctionScope,
  NdotL: PBShaderExp,
  NdotV: PBShaderExp,
  VdotL: PBShaderExp,
  roughness: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinDiffuseBRDF';
  pb.func(
    funcName,
    [pb.float('NdotL'), pb.float('NdotV'), pb.float('VdotL'), pb.float('roughness')],
    function () {
      // Curvature-dependent wrapped diffuse (UE5 pre-integrated skin)
      this.$l.curvFactor = pb.inverseSqrt(pb.add(pb.mul(this.VdotL, 2), 2));
      this.$l.wrappedDiffuse = pb.clamp(pb.add(pb.mul(this.curvFactor, this.VdotL), this.curvFactor), 0, 1);
      this.$l.absNdotL = pb.min(pb.add(pb.abs(this.NdotL), 1e-5), 1);

      // Wrap factor from squared wrapped diffuse × roughness
      this.$l.wd2 = pb.mul(this.wrappedDiffuse, this.wrappedDiffuse);
      this.$l.wrapFactor = pb.sub(pb.mul(this.wd2, this.roughness), 0.5);

      // Schlick Fresnel attenuation at both NdotL and NdotV ends
      this.$l.oneMinusNdotL = pb.sub(1, this.absNdotL);
      this.$l.pow4L = pb.mul(
        pb.mul(this.oneMinusNdotL, this.oneMinusNdotL),
        pb.mul(this.oneMinusNdotL, this.oneMinusNdotL)
      );
      this.$l.pow5L = pb.mul(this.oneMinusNdotL, this.pow4L);
      this.$l.fresnel1 = pb.add(pb.mul(this.wrapFactor, this.pow5L), 1);

      this.$l.oneMinusNdotV = pb.sub(1, this.NdotV);
      this.$l.pow4V = pb.mul(
        pb.mul(this.oneMinusNdotV, this.oneMinusNdotV),
        pb.mul(this.oneMinusNdotV, this.oneMinusNdotV)
      );
      this.$l.pow5V = pb.mul(this.oneMinusNdotV, this.pow4V);
      this.$l.fresnel2 = pb.add(pb.mul(this.wrapFactor, this.pow5V), 1);

      // Combined BRDF (caller applies 1/PI)
      this.$return(pb.mul(this.fresnel1, this.fresnel2));
    }
  );
  return pb.getGlobalScope()[funcName](NdotL, NdotV, VdotL, roughness) as PBShaderExp;
}

/**
 * Dual-lobe GGX specular for skin, driven by subsurface profile parameters.
 *
 * @remarks
 * UE5 uses two GGX lobes with different roughnesses — a narrow lobe for sharp
 * highlights and a wide lobe for the soft sheen. Each lobe's roughness is
 * modified by the subsurface profile: `effectiveR = max(sssMask * (mod*2-1) + 1, 0.02) * baseR`.
 * The final result is `lerp(lobe1, lobe2, blend)`.
 *
 * UE5's deferred version uses a pre-integrated LUT and area-light representative-point
 * integration. This forward version evaluates standard GGX per lobe, which is
 * equivalent for point and directional lights.
 *
 * @param scope - Shader scope.
 * @param NoH - dot(normal, halfVec).
 * @param NoV - dot(normal, viewDir).
 * @param NoL - dot(normal, lightDir).
 * @param LoH - dot(lightDir, halfVec).
 * @param roughness - Base material roughness.
 * @param F0 - Fresnel F0 (scalar, typically 0.028 for skin).
 * @param sssMask - Subsurface mask from texture (0–1).
 * @param narrowMod - Profile narrow lobe roughness modifier (0–1, from profile row 5.x).
 * @param wideMod - Profile wide lobe roughness modifier (0–1, from profile row 5.y).
 * @param blend - Blend factor between lobes (from profile row 5.z).
 * @returns vec3 specular contribution (caller multiplies by light color and shadow).
 *
 * @internal
 */
export function skinDualLobeSpecular(
  scope: PBInsideFunctionScope,
  NoH: PBShaderExp,
  NoV: PBShaderExp,
  NoL: PBShaderExp,
  LoH: PBShaderExp,
  roughness: PBShaderExp,
  F0: PBShaderExp,
  sssMask: PBShaderExp,
  narrowMod: PBShaderExp,
  wideMod: PBShaderExp,
  blend: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_skinDualLobeSpecular';
  pb.func(
    funcName,
    [
      pb.float('NoH'),
      pb.float('NoV'),
      pb.float('NoL'),
      pb.float('LoH'),
      pb.float('roughness'),
      pb.float('F0'),
      pb.float('sssMask'),
      pb.float('narrowMod'),
      pb.float('wideMod'),
      pb.float('blend')
    ],
    function () {
      this.$l.f0 = pb.vec3(this.F0);
      this.$l.f90 = pb.vec3(1);

      // Lobe 1 (narrow highlight)
      this.$l.r1 = pb.max(
        pb.mul(
          pb.clamp(pb.add(pb.mul(this.sssMask, pb.sub(pb.mul(this.narrowMod, 2), 1)), 1), 0.02, 4),
          this.roughness
        ),
        0.02
      );
      this.$l.a1 = pb.mul(this.r1, this.r1);
      this.$l.D1 = distributionGGX(this, this.NoH, this.a1);
      this.$l.V1 = visGGX(this, this.NoV, this.NoL, this.a1);
      this.$l.F1 = fresnelSchlick(this, this.LoH, this.f0, this.f90);
      this.$l.lobe1 = pb.mul(this.D1, this.V1, this.F1);

      // Lobe 2 (wide sheen)
      this.$l.r2 = pb.max(
        pb.mul(
          pb.clamp(pb.add(pb.mul(this.sssMask, pb.sub(pb.mul(this.wideMod, 2), 1)), 1), 0.02, 4),
          this.roughness
        ),
        0.02
      );
      this.$l.a2 = pb.mul(this.r2, this.r2);
      this.$l.D2 = distributionGGX(this, this.NoH, this.a2);
      this.$l.V2 = visGGX(this, this.NoV, this.NoL, this.a2);
      this.$l.F2 = fresnelSchlick(this, this.LoH, this.f0, this.f90);
      this.$l.lobe2 = pb.mul(this.D2, this.V2, this.F2);

      // Blend
      this.$return(pb.mix(this.lobe1, this.lobe2, this.blend));
    }
  );
  return pb
    .getGlobalScope()
    [funcName](NoH, NoV, NoL, LoH, roughness, F0, sssMask, narrowMod, wideMod, blend) as PBShaderExp;
}
