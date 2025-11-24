import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { TerrainHeightBrush } from './height';

export class TerrainSmoothBrush extends TerrainHeightBrush {
  getName(): string {
    return 'smooth';
  }
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp
  ) {
    const pb = scope.$builder;
    const heightMap = this.getOriginHeightMap(scope);
    scope.$l.texelSize = pb.div(pb.vec2(1), pb.vec2(pb.textureDimensions(heightMap, 0)));
    scope.$l.currentHeight = pb.textureSampleLevel(heightMap, heightMapUV, 0).r;
    scope.$l.h = pb.mul(scope.currentHeight, 4);
    scope.h = pb.add(
      scope.h,
      pb.mul(pb.textureSampleLevel(heightMap, pb.add(heightMapUV, pb.vec2(scope.texelSize.x, 0)), 0).r, 2)
    );
    scope.h = pb.add(
      scope.h,
      pb.mul(pb.textureSampleLevel(heightMap, pb.sub(heightMapUV, pb.vec2(scope.texelSize.x, 0)), 0).r, 2)
    );
    scope.h = pb.add(
      scope.h,
      pb.mul(pb.textureSampleLevel(heightMap, pb.add(heightMapUV, pb.vec2(0, scope.texelSize.y)), 0).r, 2)
    );
    scope.h = pb.add(
      scope.h,
      pb.mul(pb.textureSampleLevel(heightMap, pb.sub(heightMapUV, pb.vec2(0, scope.texelSize.y)), 0).r, 2)
    );
    scope.h = pb.add(scope.h, pb.textureSampleLevel(heightMap, pb.add(heightMapUV, scope.texelSize), 0).r);
    scope.h = pb.add(scope.h, pb.textureSampleLevel(heightMap, pb.sub(heightMapUV, scope.texelSize), 0).r);
    scope.h = pb.add(
      scope.h,
      pb.textureSampleLevel(
        heightMap,
        pb.add(heightMapUV, pb.vec2(scope.texelSize.x, pb.neg(scope.texelSize.y))),
        0
      ).r
    );
    scope.h = pb.add(
      scope.h,
      pb.textureSampleLevel(
        heightMap,
        pb.add(heightMapUV, pb.vec2(pb.neg(scope.texelSize.x), scope.texelSize.y)),
        0
      ).r
    );
    scope.h = pb.div(scope.h, 16);
    scope.$l.newHeight = pb.mix(scope.currentHeight, scope.h, pb.clamp(pb.mul(strength, mask), 0, 1));
    return pb.vec4(pb.vec3(scope.newHeight), 1);
  }
}
