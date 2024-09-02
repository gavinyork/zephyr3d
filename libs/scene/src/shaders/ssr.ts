import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { decodeNormalizedFloatFromRGBA } from './misc';

export function sampleLinearDepth(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  uv: PBShaderExp,
  level: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const depth = pb.textureSampleLevel(tex, uv, level);
  return pb.getDevice().type === 'webgl' ? decodeNormalizedFloatFromRGBA(scope, depth) : depth.r;
}

export function screenSpaceRayTracing_VS(
  scope: PBInsideFunctionScope,
  viewPos: PBShaderExp,
  traceRay: PBShaderExp,
  projMatrix: PBShaderExp,
  cameraFarPlane: PBShaderExp | number,
  maxDistance: PBShaderExp | number,
  maxIterations: PBShaderExp | number,
  thickness: PBShaderExp | number,
  binarySearchSteps: PBShaderExp | number,
  linearDepthTex: PBShaderExp
) {
  const pb = scope.$builder;
  pb.func(
    'SSR_VS',
    [
      pb.vec3('viewPos'),
      pb.vec3('traceRay'),
      pb.mat4('projMatrix'),
      pb.float('cameraFar'),
      pb.float('maxDistance'),
      pb.float('iteration'),
      pb.float('thickness'),
      pb.int('binarySearchSteps')
    ],
    function () {
      this.$l.reflectVec = this.traceRay;
      this.$l.maxIterations = pb.max(this.iteration, 1);
      this.$l.reflectVecNorm = pb.normalize(this.reflectVec);
      this.$l.reflectVecEnd = pb.add(this.viewPos, pb.mul(this.reflectVecNorm, this.maxDistance));
      this.$l.rayDelta = pb.mul(this.reflectVecNorm, this.maxDistance);
      this.$l.step = pb.div(this.rayDelta, this.maxIterations);
      this.$l.search0 = pb.float(0);
      this.$l.search1 = pb.float(0);
      this.$l.hit0 = pb.int(0);
      this.$l.hit1 = pb.int(0);
      this.$l.uv = pb.vec2(0);
      this.$l.depth = pb.float(0);
      this.$l.positionTo = pb.float(0);
      this.$for(
        pb.int('i'),
        0,
        pb.getDevice().type === 'webgl' ? 200 : pb.int(this.maxIterations),
        function () {
          if (pb.getDevice().type === 'webgl') {
            this.$if(pb.greaterThanEqual(this.i, pb.int(this.maxIterations)), function () {
              this.$break();
            });
          }
          this.$l.pos = pb.add(this.viewPos, pb.mul(this.step, pb.float(this.i)));
          this.$l.fragH = pb.mul(this.projMatrix, pb.vec4(this.pos, 1));
          this.uv = pb.add(pb.mul(pb.div(this.fragH.xy, this.fragH.w), 0.5), pb.vec2(0.5));
          this.positionTo = sampleLinearDepth(this, linearDepthTex, this.uv, 0);
          this.search1 = pb.clamp(pb.div(pb.float(this.i), this.maxIterations), 0, 1);
          this.$l.viewDistance = pb.neg(this.pos.z);
          this.depth = pb.sub(this.viewDistance, pb.mul(this.positionTo, this.cameraFar));
          this.$if(
            pb.and(pb.greaterThan(this.depth, 0), pb.lessThan(this.depth, this.thickness)),
            function () {
              this.hit0 = 1;
              this.$break();
            }
          ).$else(function () {
            this.search0 = this.search1;
          });
        }
      );
      this.search1 = pb.add(this.search0, pb.div(pb.sub(this.search1, this.search0), 2));
      this.$l.steps = pb.mul(this.binarySearchSteps, this.hit0);
      this.$for(pb.int('i'), 0, pb.getDevice().type === 'webgl' ? 10 : this.steps, function () {
        if (pb.getDevice().type === 'webgl') {
          this.$if(pb.greaterThanEqual(this.i, this.steps), function () {
            this.$break();
          });
        }
        this.$l.pos = pb.mix(this.viewPos, this.reflectVecEnd, this.search1);
        this.$l.fragH = pb.mul(this.projMatrix, pb.vec4(this.pos, 1));
        this.uv = pb.add(pb.mul(pb.div(this.fragH.xy, this.fragH.w), 0.5), pb.vec2(0.5));
        this.positionTo = sampleLinearDepth(this, linearDepthTex, this.uv, 0);
        this.$l.viewDistance = pb.neg(this.pos.z);
        this.depth = pb.sub(this.viewDistance, pb.mul(this.positionTo, this.cameraFar));
        this.$if(pb.and(pb.greaterThan(this.depth, 0), pb.lessThan(this.depth, this.thickness)), function () {
          this.hit1 = 1;
          this.search1 = pb.add(this.search0, pb.div(pb.sub(this.search1, this.search0), 2));
        }).$else(function () {
          this.$l.tmp = this.search1;
          this.search1 = pb.add(this.search1, pb.div(pb.sub(this.search1, this.search0), 2));
          this.search0 = this.tmp;
        });
      });
      this.$l.vis = pb.mul(
        pb.float(this.hit1),
        //pb.sub(1, pb.max(pb.dot(pb.neg(this.normalizedViewPos), this.reflectVec), 0)),
        pb.sub(1, pb.clamp(pb.div(this.depth, this.thickness), 0, 1)),
        this.$choice(
          pb.or(pb.lessThan(this.uv.x, 0), pb.greaterThan(this.uv.x, 1)),
          pb.float(0),
          pb.float(1)
        ),
        this.$choice(pb.or(pb.lessThan(this.uv.y, 0), pb.greaterThan(this.uv.y, 1)), pb.float(0), pb.float(1))
      );
      this.vis = pb.clamp(this.vis, 0, 1);
      this.$return(pb.vec4(this.uv, this.positionTo, this.vis));
    }
  );
  return scope.SSR_VS(
    viewPos,
    traceRay,
    projMatrix,
    cameraFarPlane,
    maxDistance,
    maxIterations,
    thickness,
    binarySearchSteps
  );
}

export function screenSpaceRayTracing_Linear(
  scope: PBInsideFunctionScope,
  viewPos: PBShaderExp,
  traceRay: PBShaderExp,
  projMatrix: PBShaderExp,
  cameraFarPlane: PBShaderExp | number,
  maxDistance: PBShaderExp | number,
  maxIterations: PBShaderExp | number,
  thickness: PBShaderExp | number,
  binarySearchSteps: PBShaderExp | number,
  linearDepthTex: PBShaderExp
) {
  const pb = scope.$builder;
  pb.func(
    'SSR_Linear',
    [
      pb.vec3('viewPos'),
      pb.vec3('traceRay'),
      pb.mat4('projMatrix'),
      pb.float('cameraFar'),
      pb.float('maxDistance'),
      pb.float('iteration'),
      pb.float('thickness'),
      pb.int('binarySearchSteps')
    ],
    function () {
      //this.$l.normalizedViewPos = pb.normalize(this.viewPos);
      this.$l.reflectVec = this.traceRay;
      this.$if(pb.greaterThan(this.reflectVec.z, 0), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.viewPosEnd = pb.add(this.viewPos, pb.mul(this.reflectVec, this.maxDistance));
      this.$l.fragStartH = pb.mul(this.projMatrix, pb.vec4(this.viewPos, 1));
      this.$l.fragStart = pb.mul(
        pb.add(pb.mul(pb.div(this.fragStartH.xy, this.fragStartH.w), 0.5), pb.vec2(0.5)),
        this.targetSize.xy
      );
      this.$l.fragEndH = pb.mul(this.projMatrix, pb.vec4(this.viewPosEnd, 1));
      this.$l.fragEnd = pb.mul(
        pb.add(pb.mul(pb.div(this.fragEndH.xy, this.fragEndH.w), 0.5), pb.vec2(0.5)),
        this.targetSize.xy
      );
      this.$l.frag = this.fragStart.xy;
      this.$l.deltaX = pb.sub(this.fragEnd.x, this.fragStart.x);
      this.$l.deltaY = pb.sub(this.fragEnd.y, this.fragStart.y);
      this.$l.useX = this.$choice(
        pb.greaterThan(pb.abs(this.deltaX), pb.abs(this.deltaY)),
        pb.float(1),
        pb.float(0)
      );
      this.$l.delta = this.iteration;
      this.$l.increment = pb.div(pb.vec2(this.deltaX, this.deltaY), pb.max(this.delta, 0.001));
      this.$l.search0 = pb.float(0);
      this.$l.search1 = pb.float(0);
      this.$l.hit0 = pb.int(0);
      this.$l.hit1 = pb.int(0);
      this.$l.uv = pb.vec2(0);
      this.$l.depth = pb.float(0);
      this.$l.positionTo = pb.float(0);
      this.$for(pb.int('i'), 0, pb.getDevice().type === 'webgl' ? 200 : pb.int(this.delta), function () {
        if (pb.getDevice().type === 'webgl') {
          this.$if(pb.greaterThanEqual(this.i, pb.int(this.delta)), function () {
            this.$break();
          });
        }
        this.frag = pb.add(this.frag, this.increment);
        this.uv = pb.div(this.frag, this.targetSize.xy);
        this.positionTo = sampleLinearDepth(this, linearDepthTex, this.uv, 0);
        this.search1 = pb.clamp(
          pb.mix(
            pb.div(pb.sub(this.frag.y, this.fragStart.y), this.deltaY),
            pb.div(pb.sub(this.frag.x, this.fragStart.x), this.deltaX),
            this.useX
          ),
          0,
          1
        );
        this.$l.viewDistance = pb.div(
          pb.mul(this.viewPos.z, this.viewPosEnd.z),
          pb.mix(pb.neg(this.viewPosEnd.z), pb.neg(this.viewPos.z), this.search1)
        );
        this.depth = pb.sub(this.viewDistance, pb.mul(this.positionTo, this.cameraFar));
        this.$if(pb.and(pb.greaterThan(this.depth, 0), pb.lessThan(this.depth, this.thickness)), function () {
          this.hit0 = 1;
          this.$break();
        }).$else(function () {
          this.search0 = this.search1;
        });
      });
      this.search1 = pb.add(this.search0, pb.div(pb.sub(this.search1, this.search0), 2));
      this.$l.steps = pb.mul(this.binarySearchSteps, this.hit0);
      this.$for(pb.int('i'), 0, pb.getDevice().type === 'webgl' ? 10 : this.steps, function () {
        if (pb.getDevice().type === 'webgl') {
          this.$if(pb.greaterThanEqual(this.i, this.steps), function () {
            this.$break();
          });
        }
        this.$l.frag = pb.mix(this.fragStart.xy, this.fragEnd.xy, this.search1);
        this.uv = pb.div(this.frag, this.targetSize.xy);
        this.positionTo = sampleLinearDepth(this, linearDepthTex, this.uv, 0);
        this.$l.viewDistance = pb.div(
          pb.mul(this.viewPos.z, this.viewPosEnd.z),
          pb.mix(pb.neg(this.viewPosEnd.z), pb.neg(this.viewPos.z), this.search1)
        );
        this.depth = pb.sub(this.viewDistance, pb.mul(this.positionTo, this.cameraFar));
        this.$if(pb.and(pb.greaterThan(this.depth, 0), pb.lessThan(this.depth, this.thickness)), function () {
          this.hit1 = 1;
          this.search1 = pb.add(this.search0, pb.div(pb.sub(this.search1, this.search0), 2));
        }).$else(function () {
          this.$l.tmp = this.search1;
          this.search1 = pb.add(this.search1, pb.div(pb.sub(this.search1, this.search0), 2));
          this.search0 = this.tmp;
        });
      });
      this.$l.vis = pb.mul(
        pb.float(this.hit1),
        //pb.sub(1, pb.max(pb.dot(pb.neg(this.normalizedViewPos), this.reflectVec), 0)),
        pb.sub(1, pb.clamp(pb.div(this.depth, this.thickness), 0, 1)),
        this.$choice(
          pb.or(pb.lessThan(this.uv.x, 0), pb.greaterThan(this.uv.x, 1)),
          pb.float(0),
          pb.float(1)
        ),
        this.$choice(pb.or(pb.lessThan(this.uv.y, 0), pb.greaterThan(this.uv.y, 1)), pb.float(0), pb.float(1))
      );
      this.vis = pb.clamp(this.vis, 0, 1);
      this.$return(pb.vec4(this.uv, this.positionTo, this.vis));
    }
  );
  return scope.SSR_Linear(
    viewPos,
    traceRay,
    projMatrix,
    cameraFarPlane,
    maxDistance,
    maxIterations,
    thickness,
    binarySearchSteps
  );
}

export function screenSpaceRayTracing_HiZ(
  scope: PBInsideFunctionScope,
  viewPos: PBShaderExp,
  traceRay: PBShaderExp,
  projMatrix: PBShaderExp,
  maxDistance: PBShaderExp | number,
  maxIteraions: PBShaderExp | number,
  HiZTexture: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  pb.func('SSR_HiZ_intersectDepthPlane', [pb.vec3('o'), pb.vec3('d'), pb.float('z')], function () {
    this.$return(pb.add(this.o, pb.mul(this.d, this.z)));
  });
  pb.func('SSR_HiZ_getCell', [pb.vec2('pos'), pb.vec2('cell_count')], function () {
    this.$return(pb.floor(pb.mul(this.pos, this.cell_count)));
  });
  pb.func(
    'SSR_HiZ_intersectCellBoundary',
    [
      pb.vec3('o'),
      pb.vec3('d'),
      pb.vec2('cell'),
      pb.vec2('cell_count'),
      pb.vec2('crossStep'),
      pb.vec2('crossOffset')
    ],
    function () {
      this.$l.index = pb.add(this.cell, this.crossStep);
      this.$l.boundary = pb.add(
        pb.div(this.index, this.cell_count),
        pb.div(this.crossOffset, this.cell_count)
      );
      this.$l.delta = pb.div(pb.sub(this.boundary, this.o.xy), this.d.xy);
      this.$l.t = pb.min(this.delta.x, this.delta.y);
      this.$return(this.SSR_HiZ_intersectDepthPlane(this.o, this.d, this.t));
    }
  );
  pb.func('SSR_HiZ_getCellCount', [pb.int('level')], function () {
    this.$return(pb.vec2(pb.textureDimensions(HiZTexture, this.level)));
  });
  pb.func('SSR_HiZ_crossedCellBoundary', [pb.vec2('oldCellIndex'), pb.vec2('newCellIndex')], function () {
    this.$return(
      pb.or(
        pb.notEqual(this.oldCellIndex.x, this.newCellIndex.x),
        pb.notEqual(this.oldCellIndex.y, this.newCellIndex.y)
      )
    );
  });
  pb.func('SSR_HiZ_getMinimumDepth', [pb.vec2('uv'), pb.float('level')], function () {
    this.$return(pb.textureSampleLevel(HiZTexture, this.uv, this.level).r);
  });
  pb.func(
    'SSR_HiZ_tracing',
    [pb.vec3('samplePosInTS'), pb.vec3('reflectVecInTS'), pb.float('maxDistance'), pb.int('maxIteration')],
    function () {
      this.$l.maxLevel = pb.sub(this.depthMipLevels, 1);
      this.$l.crossStep = pb.vec2(
        this.$choice(pb.greaterThanEqual(this.reflectVecInTS.x, 0), pb.float(1), pb.float(-1)),
        this.$choice(pb.greaterThanEqual(this.reflectVecInTS.y, 0), pb.float(1), pb.float(-1))
      );
      this.$l.crossOffset = pb.mul(this.crossStep, 0.00001);
      this.crossStep = pb.clamp(this.crossStep, pb.vec2(0), pb.vec2(1));
      this.$l.ray = this.samplePosInTS;
      this.$l.minZ = this.ray.z;
      this.$l.maxZ = pb.add(this.minZ, pb.mul(this.reflectVecInTS.z, this.maxDistance));
      this.$l.deltaZ = pb.sub(this.maxZ, this.minZ);
      this.$l.o = this.ray;
      this.$l.d = pb.mul(this.reflectVecInTS, this.maxDistance);
      this.$l.startLevel = pb.int(0);
      this.$l.stopLevel = pb.int(0);
      this.$l.startCellCount = this.SSR_HiZ_getCellCount(this.startLevel);
      this.$l.rayCell = this.SSR_HiZ_getCell(this.ray.xy, this.startCellCount);
      this.ray = this.SSR_HiZ_intersectCellBoundary(
        this.o,
        this.d,
        this.rayCell,
        this.startCellCount,
        this.crossStep,
        this.crossOffset
      );
      this.$l.level = this.startLevel;
      this.$l.iter = pb.int(0);
      this.$l.isBackwardRay = pb.lessThan(this.reflectVecInTS.z, 0);
      this.$l.rayDir = this.$choice(this.isBackwardRay, pb.float(-1), pb.float(1));
      this.$l.cell_minZ = pb.float();
      this.$while(
        pb.and(
          pb.greaterThanEqual(this.level, this.stopLevel),
          pb.lessThanEqual(pb.mul(this.ray.z, this.rayDir), pb.mul(this.maxZ, this.rayDir)),
          pb.lessThan(this.iter, this.maxIteration)
        ),
        function () {
          this.$l.cellCount = this.SSR_HiZ_getCellCount(this.level);
          this.$l.oldCellIndex = this.SSR_HiZ_getCell(this.ray.xy, this.cellCount);
          this.cell_minZ = this.SSR_HiZ_getMinimumDepth(
            pb.div(pb.add(this.oldCellIndex, pb.vec2(0.5)), this.cellCount),
            pb.float(this.level)
          );
          this.$l.tmpRay = this.$choice(
            pb.and(pb.greaterThan(this.cell_minZ, this.ray.z), pb.not(this.isBackwardRay)),
            this.SSR_HiZ_intersectDepthPlane(
              this.o,
              this.d,
              pb.div(pb.sub(this.cell_minZ, this.minZ), this.deltaZ)
            ),
            this.ray
          );
          this.$l.newCellIndex = this.SSR_HiZ_getCell(this.tmpRay.xy, this.cellCount);
          this.$l.thickness = this.$choice(pb.equal(this.level, 0), pb.sub(this.ray.z, this.cell_minZ), 0);
          this.$l.crossed = pb.or(
            pb.and(this.isBackwardRay, pb.greaterThan(this.cell_minZ, this.ray.z)),
            pb.greaterThan(this.thickness, 0.0001),
            this.SSR_HiZ_crossedCellBoundary(this.oldCellIndex, this.newCellIndex)
          );
          this.ray = this.$choice(
            this.crossed,
            this.SSR_HiZ_intersectCellBoundary(
              this.o,
              this.d,
              this.oldCellIndex,
              this.cellCount,
              this.crossStep,
              this.crossOffset
            ),
            this.tmpRay
          );
          this.level = this.$choice(
            this.crossed,
            pb.min(this.maxLevel, pb.add(this.level, 1)),
            pb.sub(this.level, 1)
          );
          this.iter = pb.add(this.iter, 1);
        }
      );
      this.$l.intersected = pb.and(pb.lessThan(this.cell_minZ, 1), pb.lessThan(this.level, this.stopLevel));
      this.$return(
        pb.vec4(this.ray.xy, this.cell_minZ, this.$choice(this.intersected, pb.float(1), pb.float(0)))
      );
    }
  );
  pb.func(
    'SSR_HiZ',
    [
      pb.vec3('viewPos'),
      pb.vec3('traceRay'),
      pb.mat4('projMatrix'),
      pb.float('maxDistance'),
      pb.float('iteration')
    ],
    function () {
      //this.$l.normalizedViewPos = pb.normalize(this.viewPos);
      this.$l.reflectVec = this.traceRay;
      this.$if(pb.greaterThan(this.reflectVec.z, 0), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.maxDist = pb.float(100);
      this.$l.viewPosEnd = pb.add(this.viewPos, pb.mul(this.reflectVec, this.maxDist));
      this.$l.fragStartH = pb.mul(this.projMatrix, pb.vec4(this.viewPos, 1));
      this.$l.fragEndH = pb.mul(this.projMatrix, pb.vec4(this.viewPosEnd, 1));
      this.$l.fragStartCS = pb.div(this.fragStartH.xyz, this.fragStartH.w);
      this.$l.fragEndCS = pb.div(this.fragEndH.xyz, this.fragEndH.w);
      this.$l.reflectVecCS = pb.normalize(pb.sub(this.fragEndCS, this.fragStartCS));
      this.$l.fragStartTS = pb.add(pb.mul(this.fragStartCS, pb.vec3(0.5, 0.5, 0.5)), pb.vec3(0.5, 0.5, 0.5));
      this.$l.fragEndTS = pb.add(pb.mul(this.fragEndCS, pb.vec3(0.5, 0.5, 0.5)), pb.vec3(0.5, 0.5, 0.5));
      this.$l.reflectVecTS = pb.mul(this.reflectVecCS, pb.vec3(0.5, 0.5, 0.5));
      this.maxDist = this.$choice(
        pb.greaterThanEqual(this.reflectVecTS.x, 0),
        pb.div(pb.sub(1, this.fragStartTS.x), this.reflectVecTS.x),
        pb.div(pb.neg(this.fragStartTS.x), this.reflectVecTS.x)
      );
      this.maxDist = pb.min(
        this.maxDist,
        this.$choice(
          pb.lessThan(this.reflectVecTS.y, 0),
          pb.div(pb.neg(this.fragStartTS.y), this.reflectVecTS.y),
          pb.div(pb.sub(1, this.fragStartTS.y), this.reflectVecTS.y)
        )
      );
      this.maxDist = pb.min(
        this.maxDist,
        this.$choice(
          pb.lessThan(this.reflectVecTS.z, 0),
          pb.div(pb.neg(this.fragStartTS.z), this.reflectVecTS.z),
          pb.div(pb.sub(1, this.fragStartTS.z), this.reflectVecTS.z)
        )
      );
      this.$return(
        this.SSR_HiZ_tracing(this.fragStartTS, this.reflectVecTS, this.maxDist, pb.int(this.iteration))
      );
    }
  );
  return scope.SSR_HiZ(viewPos, traceRay, projMatrix, maxDistance, maxIteraions);
}
