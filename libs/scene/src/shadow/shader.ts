import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from '../material';

export function computeShadowBiasCSM(
  scope: PBInsideFunctionScope,
  NdotL: PBShaderExp,
  split: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const depthBiasParam = ShaderHelper.getDepthBiasValues(scope);
  const splitFlags = pb.vec4(
    pb.float(pb.equal(split, 0)),
    pb.float(pb.equal(split, 1)),
    pb.float(pb.equal(split, 2)),
    pb.float(pb.equal(split, 3))
  );
  const depthBiasScale = pb.dot(ShaderHelper.getDepthBiasScales(scope), splitFlags);
  return pb.dot(pb.mul(depthBiasParam.xy, pb.vec2(1, pb.sub(1, NdotL)), depthBiasScale), pb.vec2(1, 1));
}

export function computeShadowBias(
  lightType: number,
  scope: PBInsideFunctionScope,
  z: PBShaderExp,
  NdotL: PBShaderExp,
  linear: boolean
): PBShaderExp {
  const pb = scope.$builder;
  const depthBiasParam = ShaderHelper.getDepthBiasValues(scope);
  if (lightType) {
    return pb.dot(pb.mul(depthBiasParam.xy, pb.vec2(1, pb.sub(1, NdotL))), pb.vec2(1, 1));
  } else {
    const nearFar = ShaderHelper.getShadowCameraParams(scope).xy;
    const linearDepth = linear ? z : ShaderHelper.nonLinearDepthToLinearNormalized(scope, z, nearFar);
    const biasScaleFactor = pb.mix(1, depthBiasParam.w, linearDepth);
    return pb.dot(pb.mul(depthBiasParam.xy, pb.vec2(1, pb.sub(1, NdotL)), biasScaleFactor), pb.vec2(1, 1));
  }
}
