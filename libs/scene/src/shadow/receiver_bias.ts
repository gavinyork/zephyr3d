import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';

/**
 * Receiver-dependent tuning shared by the depth bias and the normal offset.
 *
 * @remarks
 * These read nothing but the shader scope, deliberately: the depth bias lives in
 * `shadow/shader.ts` and the normal offset in `material/shader/helper.ts`, and a
 * shared leaf module is what keeps those two from importing each other.
 */

/** @internal */
export function isMaskedPerspectiveShadowLight(scope: PBInsideFunctionScope, lightType: number) {
  const alphaCutoff = (scope as PBInsideFunctionScope & { zAlphaCutoff?: PBShaderExp }).zAlphaCutoff;
  return !!alphaCutoff && (lightType === LIGHT_TYPE_SPOT || lightType === LIGHT_TYPE_POINT);
}

/** @internal */
export function getShadowReceiverBiasFactor(scope: PBInsideFunctionScope) {
  const pb = scope.$builder;
  const alphaCutoff = (scope as PBInsideFunctionScope & { zAlphaCutoff?: PBShaderExp }).zAlphaCutoff;
  if (alphaCutoff) {
    // Thin masked geometry such as layered hair cards needs a tighter receiver bias,
    // otherwise nearby layers lose self-shadow before the shadow map is even sampled.
    const cutoff = pb.clamp(alphaCutoff, 0, 1);
    return pb.mix(0.22, 0.4, cutoff) as PBShaderExp;
  }
  return pb.float(1) as PBShaderExp;
}

/** @internal */
export function getShadowReceiverNoL(scope: PBInsideFunctionScope, NdotL: PBShaderExp, lightType?: number) {
  const pb = scope.$builder;
  const alphaCutoff = (scope as PBInsideFunctionScope & { zAlphaCutoff?: PBShaderExp }).zAlphaCutoff;
  if (alphaCutoff) {
    // Layered masked cards should not explode slope bias at grazing angles.
    // This is especially visible for back / rim spot lights on hair cards.
    const cutoff = pb.clamp(alphaCutoff, 0, 1);
    if (lightType != null && isMaskedPerspectiveShadowLight(scope, lightType)) {
      return pb.max(NdotL, pb.mix(0.85, 0.95, cutoff)) as PBShaderExp;
    }
    return pb.max(NdotL, pb.mix(0.45, 0.65, cutoff)) as PBShaderExp;
  }
  return NdotL as PBShaderExp;
}
