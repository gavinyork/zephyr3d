import type { PBInsideFunctionScope, PBShaderExp, Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';

let foamTexture: Texture2D | null = null;

/**
 * Default foam texture: plain white, so the foam shows as a soft white
 * coverage following its density, with no pattern of its own. Water lets a
 * foam texture of one's own replace it, its value in the red channel.
 *
 * @internal
 */
export function getDefaultFoamTexture() {
  if (!foamTexture) {
    foamTexture = getDevice().createTexture2D('rgba8unorm', 1, 1, { mipmapping: false })!;
    foamTexture.name = '@WaterFoam';
    foamTexture.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
  }
  return foamTexture;
}

/**
 * Samples a foam texture at `uv`, filtered with the screen gradients of the
 * world XZ it was taken from; its value is the red channel.
 * @param uvScale - uv per metre of world XZ.
 * @param mipScale - Factor on the filter footprint, above 1 to blur.
 * @param withSlope - Also take the slope of the value, by differencing a texel
 *   along u and v.
 * @returns (value, its slope along world x, along world z), slopes per metre,
 *   0 without `withSlope`
 * @internal
 */
export function sampleFoamTexture(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  uv: PBShaderExp,
  xzGrad: PBShaderExp,
  uvScale: number | PBShaderExp,
  mipScale = 1,
  withSlope = true
): PBShaderExp {
  const pb = scope.$builder;
  const dx = pb.mul(xzGrad.xy, uvScale, mipScale);
  const dy = pb.mul(xzGrad.zw, uvScale, mipScale);
  const s0 = pb.textureSampleGrad(tex, uv, dx, dy).r;
  if (!withSlope) {
    return pb.vec3(s0, 0, 0);
  }
  const texel = pb.div(pb.vec2(1), pb.vec2(pb.textureDimensions(tex, 0)));
  const su = pb.textureSampleGrad(tex, pb.add(uv, pb.vec2(texel.x, 0)), dx, dy).r;
  const sv = pb.textureSampleGrad(tex, pb.add(uv, pb.vec2(0, texel.y)), dx, dy).r;
  return pb.vec3(s0, pb.mul(pb.div(pb.vec2(pb.sub(su, s0), pb.sub(sv, s0)), texel), uvScale));
}

/**
 * Metres of world XZ per texel of a foam texture, at `uvScale` uv per metre.
 * @internal
 */
export function foamTexelSize(scope: PBInsideFunctionScope, tex: PBShaderExp, uvScale: PBShaderExp) {
  const pb = scope.$builder;
  return pb.div(1, pb.mul(uvScale, pb.float(pb.textureDimensions(tex, 0).x)));
}
