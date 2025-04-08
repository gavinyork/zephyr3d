import { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { TerrainHeightBrush } from './height';

export class TerrainFlattenBrush extends TerrainHeightBrush {
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp,
    centerUV: PBShaderExp
  ) {
    const pb = scope.$builder;
    const heightMap = this.getOriginHeightMap(scope);
    scope.$l.currentHeight = pb.textureSampleLevel(heightMap, heightMapUV, 0).r;
    scope.$l.targetHeight = pb.textureSampleLevel(heightMap, centerUV, 0).r;
    scope.$l.newHeight = pb.mix(
      scope.currentHeight,
      scope.targetHeight,
      pb.clamp(pb.mul(strength, mask), 0, 1)
    );
    return pb.vec4(pb.vec3(scope.newHeight), 1);
  }
}
