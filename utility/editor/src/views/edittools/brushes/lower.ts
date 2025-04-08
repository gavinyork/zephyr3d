import { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { TerrainHeightBrush } from './height';

export class TerrainLowerBrush extends TerrainHeightBrush {
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp
  ) {
    const pb = scope.$builder;
    scope.$l.oldHeight = pb.textureSampleLevel(this.getOriginHeightMap(scope), heightMapUV, 0).r;
    scope.$l.newHeight = pb.sub(scope.oldHeight, pb.mul(strength, mask));
    return pb.vec4(pb.vec3(scope.newHeight), 1);
  }
}
