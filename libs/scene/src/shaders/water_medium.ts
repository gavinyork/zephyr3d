import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Share of the water's scattering treated as molecular rather than particulate.
 *
 * Clear ocean water is dominated by the molecular term; coastal water carries
 * enough suspended matter to shift the balance, but the medium's albedo is
 * already the knob for that, so this stays fixed.
 * @internal
 */
export const MOLECULAR_SCATTER_FRACTION = 0.12;

/**
 * Phase function of the water body: a molecular lobe and a particulate one.
 *
 * Two lobes rather than one because the common camera setup - looking down at
 * water under a high sun - asks the light to turn almost completely around, and
 * a forward-scattering particulate lobe returns essentially nothing there
 * (HG(0.7) gives 0.009/sr against an isotropic 0.080). Water looks blue from
 * above because of molecular scattering, which is near-symmetric.
 *
 * The split is achromatic - the medium's own albedo already carries the author's
 * colour - and only the shape differs. Both lobes are normalized to integrate to
 * 1 over the sphere; the 1/4pi is part of that.
 *
 * Shared by the surface shading and the underwater light shafts, which are two
 * views of one medium: a shaft that scattered by a different law than the water
 * it runs through would not line up with the body colour around it.
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
    // The denominator is (1 - g)^2 at worst for a cosine in range, so the floor
    // below only ever catches an out-of-range one. Clamped rather than left to
    // the floor because pow(1e-4, 1.5) is about 1e-6 and the reciprocal of that
    // is a phase in the tens of thousands - a caller passing a slightly
    // unnormalised direction gets a dim lobe, not a blown-out one.
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
