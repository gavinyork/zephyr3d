import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Share of the water's scattering treated as molecular rather than particulate.
 *
 * Fixed; the medium's albedo is the user-facing control for water colour.
 * @internal
 */
export const MOLECULAR_SCATTER_FRACTION = 0.12;

/**
 * Phase function of the water body: a molecular lobe and a particulate one.
 *
 * The near-symmetric molecular (Rayleigh) lobe is what returns light to a camera
 * looking down under a high sun; a forward-peaked HG lobe alone returns almost
 * nothing there. The split is achromatic and both lobes integrate to 1 over the
 * sphere. Shared by the surface shading and the underwater light shafts.
 *
 * @param scope - Current shader scope.
 * @param cosTheta - Cosine between the light's travel and the scattered direction.
 * @param g - Mean cosine of a single particulate scattering event.
 * @returns Phase value per steradian.
 * @internal
 */
export function waterScatterPhase(
  scope: PBInsideFunctionScope,
  cosTheta: PBShaderExp,
  g: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'Z_waterScatterPhase';
  pb.func(funcName, [pb.float('cosTheta'), pb.float('g')], function () {
    // Henyey-Greenstein: the particulate lobe, forward-peaked at g > 0.
    this.$l.g2 = pb.mul(this.g, this.g);
    // Clamp the cosine so a slightly unnormalised direction cannot drive the
    // denominator to the floor and blow the phase up.
    this.$l.cosClamped = pb.clamp(this.cosTheta, -1, 1);
    this.$l.denom = pb.add(1, this.g2, pb.mul(-2, this.g, this.cosClamped));
    this.$l.mie = pb.div(pb.sub(1, this.g2), pb.mul(4 * Math.PI, pb.pow(pb.max(this.denom, 1e-4), 1.5)));
    // Rayleigh: symmetric about 90 degrees. 3/(16 pi) * (1 + cos^2).
    this.$l.rayleigh = pb.mul(3 / (16 * Math.PI), pb.add(1, pb.mul(this.cosClamped, this.cosClamped)));
    this.$return(
      pb.add(
        pb.mul(this.rayleigh, MOLECULAR_SCATTER_FRACTION),
        pb.mul(this.mie, 1 - MOLECULAR_SCATTER_FRACTION)
      )
    );
  });
  return pb.getGlobalScope()[funcName](cosTheta, g) as PBShaderExp;
}
