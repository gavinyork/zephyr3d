import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from '../material/shader/helper';
import { LIGHT_TYPE_DIRECTIONAL } from '../values';
import { getShadowReceiverBiasFactor, isMaskedPerspectiveShadowLight } from './receiver_bias';

function getShadowReceiverPerspectiveBiasScale(
  scope: PBInsideFunctionScope,
  lightType: number,
  linearDepth: PBShaderExp,
  farNearRatio: PBShaderExp
) {
  const pb = scope.$builder;
  const alphaCutoff = (scope as PBInsideFunctionScope & { zAlphaCutoff?: PBShaderExp }).zAlphaCutoff;
  if (alphaCutoff && isMaskedPerspectiveShadowLight(scope, lightType)) {
    const cutoff = pb.clamp(alphaCutoff, 0, 1);
    // Perspective shadow cameras (spot / point) can over-amplify receiver bias at depth.
    // Keep masked layered geometry in a much tighter range so hair cards can still self-occlude.
    const cappedFarNearRatio = pb.min(farNearRatio, pb.mix(1.15, 1.6, cutoff));
    return pb.mix(1, cappedFarNearRatio, linearDepth) as PBShaderExp;
  }
  return pb.mix(1, farNearRatio, linearDepth) as PBShaderExp;
}

/**
 * Constant depth bias for a cascaded directional shadow.
 *
 * @remarks
 * The slope-scaled term that used to occupy `depthBiasValues.y` is gone: `.y`
 * now carries the normal offset distance, and normal offsetting (see
 * `ShaderHelper.applyShadowNormalOffset`) is what handles receiver slope. A
 * depth bias cannot, because the depth spanned by one texel diverges as the
 * surface turns away from the light.
 */
export function computeShadowBiasCSM(scope: PBInsideFunctionScope, _NdotL: PBShaderExp, split: PBShaderExp) {
  const pb = scope.$builder;
  return pb.mul(
    ShaderHelper.getDepthBiasValues(scope).x,
    getShadowReceiverBiasFactor(scope),
    ShaderHelper.getShadowCascadeBiasScale(scope, split)
  );
}

/**
 * Constant depth bias for a single-cascade shadow. See {@link computeShadowBiasCSM}
 * for why there is no slope-scaled term.
 */
export function computeShadowBias(
  lightType: number,
  scope: PBInsideFunctionScope,
  z: PBShaderExp,
  _NdotL: PBShaderExp,
  linear: boolean
) {
  const pb = scope.$builder;
  const depthBiasParam = ShaderHelper.getDepthBiasValues(scope);
  const receiverBiasFactor = getShadowReceiverBiasFactor(scope);
  if (lightType === LIGHT_TYPE_DIRECTIONAL) {
    return pb.mul(depthBiasParam.x, receiverBiasFactor);
  } else {
    const nearFar = ShaderHelper.getShadowCameraParams(scope).xy;
    const linearDepth = linear ? z : ShaderHelper.nonLinearDepthToLinearNormalized(scope, z, nearFar);
    const biasScaleFactor = getShadowReceiverPerspectiveBiasScale(
      scope,
      lightType,
      linearDepth,
      depthBiasParam.w
    );
    let bias = pb.mul(depthBiasParam.x, receiverBiasFactor, biasScaleFactor) as PBShaderExp;
    if (isMaskedPerspectiveShadowLight(scope, lightType)) {
      const alphaCutoff = (scope as PBInsideFunctionScope & { zAlphaCutoff?: PBShaderExp }).zAlphaCutoff!;
      bias = pb.mul(bias, pb.mix(0.12, 0.22, pb.clamp(alphaCutoff, 0, 1))) as PBShaderExp;
    }
    return bias;
  }
}
