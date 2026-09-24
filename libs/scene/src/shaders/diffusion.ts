import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Burley (Christensen-Burley) normalized diffusion weight for one channel.
 *
 * @remarks
 * The profile is
 *
 * ```
 * R(r) = (exp(-r/d) + exp(-r/(3d))) / (8 * pi * d * r)
 * ```
 *
 * where `d` is the shaping distance. The `1/r` factor is the 2D-to-1D Jacobian
 * of the radially symmetric profile; a separable screen-space blur integrates
 * along a line rather than over a disc, so it is dropped here and the weights
 * are renormalized by their own sum instead. That is the standard separable
 * approximation - it is not exactly the 2D profile, but the error is far below
 * what the depth-aware tap rejection introduces anyway.
 *
 * Two exponentials rather than one Gaussian is what gives skin its
 * characteristic shape: a sharp peak that keeps detail near the source, plus a
 * long tail that carries the bleed. A single Gaussian can match one or the
 * other, not both, which is why Gaussian SSS reads as haze.
 *
 * {@link SSS} in `posteffect/sss.ts` carries a more elaborate variant driven by
 * per-pixel profile slots and a LUT. This one is deliberately separate and much
 * smaller: {@link SkinSSS} has a single global profile in uniforms, so it needs
 * no LUT plumbing. Unifying the two is worthwhile but would mean editing a
 * 2500-line shader that has no pixel-regression coverage.
 *
 * @param scope - Shader scope.
 * @param distance - Absolute distance from the kernel center, in the same units as `d`.
 * @param d - Shaping distance for this channel. Larger values scatter further.
 * @returns Unnormalized weight; callers must divide by the accumulated sum.
 *
 * @internal
 */
export function burleyDiffusionWeight(
  scope: PBInsideFunctionScope,
  distance: PBShaderExp,
  d: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_burleyDiffusionWeight';
  pb.func(funcName, [pb.float('distance'), pb.float('d')], function () {
    this.$l.safeD = pb.max(this.d, 1e-4);
    this.$l.r = pb.div(pb.abs(this.distance), this.safeD);
    // exp() of a large negative is flushed to zero anyway; clamping keeps the
    // argument in range on backends that are less forgiving about it.
    this.$l.e1 = pb.exp(pb.neg(pb.min(this.r, 40)));
    this.$l.e2 = pb.exp(pb.neg(pb.min(pb.div(this.r, 3), 40)));
    this.$return(pb.div(pb.add(this.e1, this.e2), this.safeD));
  });
  return pb.getGlobalScope()[funcName](distance, d) as PBShaderExp;
}
