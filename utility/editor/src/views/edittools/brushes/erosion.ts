import type { BindGroup, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { TerrainHeightBrush } from './height';

export class TerrainErosoinBrush extends TerrainHeightBrush {
  private _randomSeed: number;
  constructor() {
    super();
    this._randomSeed = 0;
  }
  get randomSeed() {
    return this._randomSeed;
  }
  set randomSeed(val: number) {
    this._randomSeed = val;
  }
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp,
    centerUV: PBShaderExp
  ) {
    const pb = scope.$builder;
    const EROSION_STRENGTH = 0.3; // 侵蚀强度
    const DEPOSITION_STRENGTH = 0.1; // 沉积强度
    const TRANSPORT_CAPACITY = 0.05; // 水流携带沉积物容量
    const GRAVITY = 1.0; // 重力系数
    const PATH_STEPS = 12; // 水流路径步数
    const MIN_SLOPE_FOR_EROSION = 0.01; // 最小侵蚀坡度（相对高度差）
    const INERTIA = 0.6; // 水流惯性，值越大水流方向变化越慢

    pb.func('random', [pb.vec2('st')], function () {
      this.$return(
        pb.fract(
          pb.mul(pb.sin(pb.add(pb.dot(this.st, pb.vec2(12.9898, 78.233)), this.randomSeed)), 43758.5453123)
        )
      );
    });

    scope.$l.brushEffect = pb.clamp(pb.mul(strength, mask), 0, 1);
    scope.$if(pb.lessThan(scope.brushEffect, 0.001), function () {
      pb.discard();
    });

    const heightMap = this.getOriginHeightMap(scope);
    scope.$l.texelSize = pb.div(pb.vec2(1), pb.vec2(pb.textureDimensions(heightMap, 0)));
    scope.$l.currentHeight = pb.textureSampleLevel(heightMap, heightMapUV, 0).r;
    scope.$l.erosionAmount = pb.float(0);
    scope.$l.sedimentAmount = pb.float(0);
    scope.$l.waterPos = heightMapUV;
    scope.$l.randomDir = pb.vec2(
      pb.sub(pb.mul(scope.random(pb.add(heightMapUV, pb.vec2(0.123, 0.456))), 2), 1),
      pb.sub(pb.mul(scope.random(pb.add(heightMapUV, pb.vec2(0.789, 0.321))), 2), 1)
    );
    scope.$l.waterDir = scope.randomDir;
    scope.$for(pb.int('i'), 0, PATH_STEPS, function () {
      this.$l.posHeight = pb.textureSampleLevel(heightMap, this.waterPos, 0).r;
      this.$l.heightL = pb.textureSampleLevel(
        heightMap,
        pb.sub(this.waterPos, pb.vec2(this.texelSize.x, 0)),
        0
      ).r;
      this.$l.heightR = pb.textureSampleLevel(
        heightMap,
        pb.add(this.waterPos, pb.vec2(this.texelSize.x, 0)),
        0
      ).r;
      this.$l.heightT = pb.textureSampleLevel(
        heightMap,
        pb.add(this.waterPos, pb.vec2(0, this.texelSize.y)),
        0
      ).r;
      this.$l.heightB = pb.textureSampleLevel(
        heightMap,
        pb.sub(this.waterPos, pb.vec2(0, this.texelSize.y)),
        0
      ).r;
      this.$l.gradient = pb.mul(
        pb.vec2(pb.sub(this.heightL, this.heightR), pb.sub(this.heightB, this.heightT)),
        0.5
      );
      this.$if(pb.lessThan(pb.length(this.gradient), MIN_SLOPE_FOR_EROSION), function () {
        this.gradient = pb.add(this.gradient, pb.mul(this.randomDir, MIN_SLOPE_FOR_EROSION));
      });
      this.waterDir = pb.mix(this.gradient, this.waterDir, INERTIA);
      this.$if(pb.greaterThan(pb.length(this.waterDir), 0), function () {
        this.waterDir = pb.normalize(this.waterDir);
      }).$else(function () {
        this.waterDir = this.randomDir;
      });
      this.$l.prevPos = this.waterPos;
      this.waterPos = pb.add(this.waterPos, pb.mul(this.waterDir, this.texelSize, GRAVITY));
      this.waterPos = pb.clamp(this.waterPos, pb.vec2(0), pb.sub(pb.vec2(1), this.texelSize));
      this.$l.newPosHeight = pb.textureSampleLevel(heightMap, this.waterPos, 0).r;
      this.$l.heightDiff = pb.sub(this.posHeight, this.newPosHeight);
      this.$if(pb.greaterThan(this.heightDiff, 0), function () {
        this.$l.erosionForce = pb.mul(this.heightDiff, EROSION_STRENGTH, this.brushEffect);
        this.$l.maxCapacity = pb.mul(TRANSPORT_CAPACITY, pb.length(this.waterDir), GRAVITY);
        this.$l.availableCapacity = pb.max(0, pb.sub(this.maxCapacity, this.sedimentAmount));
        this.$l.actualErosion = pb.min(this.erosionForce, this.availableCapacity);
        this.$if(pb.lessThan(pb.distance(this.prevPos, heightMapUV), pb.length(this.texelSize)), function () {
          this.erosionAmount = pb.add(this.erosionAmount, this.actualErosion);
        });
        this.sedimentAmount = pb.add(this.sedimentAmount, this.actualErosion);
      }).$elseif(pb.or(pb.lessThan(this.heightDiff, 0), pb.greaterThan(this.sedimentAmount, 0)), function () {
        this.$l.depositionForce = pb.mul(
          this.$choice(pb.lessThan(this.heightDiff, 0), pb.neg(this.heightDiff), 0.1),
          DEPOSITION_STRENGTH
        );
        this.$l.actualDeposition = pb.min(this.sedimentAmount, this.depositionForce);
        this.sedimentAmount = pb.sub(this.sedimentAmount, this.actualDeposition);
        this.$if(
          pb.lessThan(pb.distance(this.waterPos, heightMapUV), pb.length(this.texelSize)),
          function () {
            this.erosionAmount = pb.sub(this.erosionAmount, this.actualDeposition);
          }
        );
      });
    });
    scope.$l.newHeight = pb.sub(scope.currentHeight, scope.erosionAmount);
    return pb.vec4(pb.vec3(scope.newHeight), 1);
  }
  protected setupBrushUniforms(scope: PBGlobalScope): void {
    super.setupBrushUniforms(scope);
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.randomSeed = pb.float().uniform(0);
    }
  }
  protected applyUniformValues(bindGroup: BindGroup): void {
    super.applyUniformValues(bindGroup);
    bindGroup.setValue('randomSeed', this._randomSeed);
  }
}
