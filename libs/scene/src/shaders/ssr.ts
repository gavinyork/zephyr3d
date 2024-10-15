import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { decodeNormalizedFloatFromRGBA } from './misc';
import { ShaderHelper } from '../material';

const MAX_FLOAT_VALUE = 3.402823466e38;

/** @internal */
function invProjectPosition(scope: PBInsideFunctionScope, pos: PBShaderExp, mat: PBShaderExp) {
  const pb = scope.$builder;
  pb.func('invProjectPosition', [pb.vec3('p'), pb.mat4('mat')], function () {
    this.$l.c = pb.sub(pb.mul(this.p, 2), pb.vec3(1));
    this.$l.u = pb.mul(this.mat, pb.vec4(this.c, 1));
    this.u = pb.div(this.u, this.u.w);
    this.$return(this.u.xyz);
  });
  return scope.invProjectPosition(pos, mat);
}

/** @internal */
function validateHit(
  scope: PBInsideFunctionScope,
  hit2D: PBShaderExp,
  uv: PBShaderExp,
  traceRay: PBShaderExp,
  viewMatrix: PBShaderExp,
  invProjMatrix: PBShaderExp,
  cameraNearFar: PBShaderExp,
  textureSize: PBShaderExp,
  depthTexture: PBShaderExp,
  normalTexture?: PBShaderExp
) {
  const pb = scope.$builder;
  pb.func(
    'SSR_validateHit',
    [
      pb.vec2('hit2d'),
      pb.vec2('uv'),
      pb.vec3('viewSpaceRayDirection'),
      pb.mat4('viewMatrix'),
      pb.mat4('invProjMatrix'),
      pb.vec2('cameraNearFar'),
      pb.vec4('textureSize')
    ],
    function () {
      this.$if(
        pb.or(pb.any(pb.lessThan(this.hit2d, pb.vec2(0))), pb.any(pb.greaterThan(this.hit2d, pb.vec2(1)))),
        function () {
          this.$return(pb.float(0));
        }
      );
      this.$l.manhattanDist = pb.abs(pb.sub(this.hit2d, this.uv));
      this.$if(
        pb.all(pb.lessThan(this.manhattanDist, pb.vec2(pb.div(pb.vec2(4), this.textureSize.xy)))),
        function () {
          this.$return(pb.float(0));
        }
      );
      //this.$l.texCoord = pb.mul(this.textureSize.zw, this.hit.xy);
      this.$l.surfaceZ01 = sampleLinearDepth(this, depthTexture, this.hit2d, 0);
      this.$if(pb.equal(this.surfaceZ01, 1), function () {
        this.$return(pb.float(0));
      });
      this.$l.surfaceZ = ShaderHelper.linearDepthToNonLinear(
        this,
        pb.mul(this.surfaceZ01, this.cameraNearFar.y),
        this.cameraNearFar
      );
      if (normalTexture) {
        this.$l.hitNormalWS = pb.sub(
          pb.mul(pb.textureSampleLevel(normalTexture, this.hit2d, 0).rgb, 2),
          pb.vec3(1)
        );
        this.$l.hitNormalVS = pb.mul(this.viewMatrix, pb.vec4(this.hitNormalWS, 0)).xyz;
        this.$if(pb.greaterThan(pb.dot(this.hitNormalVS, this.viewSpaceRayDirection), 0), function () {
          this.$return(pb.float(0));
        });
      }
      this.$l.viewSpaceSurface = invProjectPosition(
        this,
        pb.vec3(this.hit2d, this.surfaceZ),
        this.invProjMatrix
      );
      this.$l.fov = pb.mul(pb.vec2(pb.div(this.textureSize.y, this.textureSize.x), 1), 0.05);
      this.$l.border = pb.mul(
        pb.smoothStep(pb.vec2(0), this.fov, this.hit2d),
        pb.sub(pb.vec2(1), pb.smoothStep(pb.sub(pb.vec2(1), this.fov), pb.vec2(1), this.hit2d))
      );
      this.$return(pb.mul(this.border.x, this.border.y));
    }
  );
  return scope.SSR_validateHit(hit2D, uv, traceRay, viewMatrix, invProjMatrix, cameraNearFar, textureSize);
}

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

export function sampleLinearDepthWithBackface(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  uv: PBShaderExp,
  level: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  return pb.textureSampleLevel(tex, uv, level).rg;
}

export function screenSpaceRayTracing_Linear2D(
  scope: PBInsideFunctionScope,
  viewPos: PBShaderExp,
  traceRay: PBShaderExp,
  viewMatrix: PBShaderExp,
  projMatrix: PBShaderExp,
  invProjMatrix: PBShaderExp,
  cameraNearFar: PBShaderExp,
  maxDistance: PBShaderExp | number,
  maxIterations: PBShaderExp | number,
  thickness: PBShaderExp | number,
  stride: PBShaderExp | number,
  textureSize: PBShaderExp,
  linearDepthTex: PBShaderExp,
  normalTexture?: PBShaderExp,
  useBackfaceDepth?: boolean
) {
  const pb = scope.$builder;
  pb.func('distanceSquared', [pb.vec2('a'), pb.vec2('b')], function () {
    this.$l.x = pb.sub(this.a, this.b);
    this.$return(pb.dot(this.x, this.x));
  });
  pb.func(
    'rayIntersectDepth',
    [pb.float('zA'), pb.float('zB'), pb.float('thickness'), pb.vec2('uv'), pb.float('cameraFar')],
    function () {
      let thickness = this.thickness;
      if (useBackfaceDepth) {
        this.$l.sceneZ = sampleLinearDepthWithBackface(this, linearDepthTex, this.uv, 0);
        this.$l.sceneZMax01 = this.sceneZ.x;
        thickness = pb.max(this.thickness, pb.mul(pb.sub(this.sceneZ.y, this.sceneZ.x), this.cameraFar));
      } else {
        this.$l.sceneZMax01 = sampleLinearDepth(this, linearDepthTex, this.uv, 0);
      }
      this.sceneZMax = pb.neg(pb.mul(this.sceneZMax01, this.cameraFar));
      this.$return(
        pb.and(
          pb.lessThan(this.sceneZMax01, 1),
          pb.greaterThanEqual(this.zA, pb.sub(this.sceneZMax, thickness)),
          pb.lessThanEqual(this.zB, this.sceneZMax)
        )
      );
    }
  );
  pb.func(
    'traceRayLinear2D',
    [
      pb.vec3('rayOrigin'),
      pb.vec3('rayDirection'),
      pb.float('jitter'),
      pb.float('stride'),
      pb.float('strideZCutoff'),
      pb.float('maxDistance'),
      pb.float('maxIterations'),
      pb.float('thickness'),
      pb.vec2('cameraNearFar'),
      pb.mat4('projMatrix'),
      pb.vec4('textureSize'),
      pb.vec3('hit2D').out(),
      pb.vec3('hit3D').out(),
      pb.vec2('origin').out(),
      pb.float('numIterations').out()
    ],
    function () {
      this.$l.rayLen = this.$choice(
        pb.greaterThan(
          pb.add(this.rayOrigin.z, pb.mul(this.rayDirection.z, this.maxDistance)),
          pb.neg(this.cameraNearFar.x)
        ),
        pb.div(pb.sub(pb.neg(this.cameraNearFar.x), this.rayOrigin.z), this.rayDirection.z),
        this.maxDistance
      );
      this.$l.rayEnd = pb.add(this.rayOrigin, pb.mul(this.rayDirection, this.rayLen));
      this.$l.zMin = pb.min(this.rayOrigin.z, this.rayEnd.z);
      this.$l.zMax = pb.max(this.rayOrigin.z, this.rayEnd.z);
      this.$l.rayOriginH = pb.mul(this.projMatrix, pb.vec4(this.rayOrigin, 1));
      this.$l.rayEndH = pb.mul(this.projMatrix, pb.vec4(this.rayEnd, 1));
      this.$l.k0 = pb.div(1, this.rayOriginH.w);
      this.$l.k1 = pb.div(1, this.rayEndH.w);
      this.$l.Q0 = pb.mul(this.rayOrigin, this.k0);
      this.$l.Q1 = pb.mul(this.rayEnd, this.k1);
      this.$l.rayOriginNDC = pb.mul(this.rayOriginH, this.k0);
      this.$l.rayEndNDC = pb.mul(this.rayEndH, this.k1);
      this.origin = pb.add(pb.mul(this.rayOriginNDC.xy, 0.5), pb.vec2(0.5));
      this.$l.P0 = pb.mul(this.origin, this.textureSize.zw);
      this.$l.P1 = pb.mul(pb.add(pb.mul(this.rayEndNDC.xy, 0.5), pb.vec2(0.5)), this.textureSize.zw);
      this.$l.xMin = 0.5;
      this.$l.xMax = pb.sub(this.textureSize.z, 0.5);
      this.$l.yMin = 0.5;
      this.$l.yMax = pb.sub(this.textureSize.w, 0.5);
      this.$l.t = pb.float();
      this.$if(pb.or(pb.greaterThan(this.P1.y, this.yMax), pb.lessThan(this.P1.y, this.yMin)), function () {
        this.t = pb.div(
          pb.sub(this.P1.y, this.$choice(pb.greaterThan(this.P1.y, this.yMax), this.yMax, this.yMin)),
          pb.sub(this.P1.y, this.P0.y)
        );
      });
      this.$if(pb.or(pb.greaterThan(this.P1.x, this.xMax), pb.lessThan(this.P1.x, this.xMin)), function () {
        this.t2 = pb.div(
          pb.sub(this.P1.x, this.$choice(pb.greaterThan(this.P1.x, this.xMax), this.xMax, this.xMin)),
          pb.sub(this.P1.x, this.P0.x)
        );
        this.t = pb.max(this.t, this.t2);
      });
      this.P1 = pb.mix(this.P1, this.P0, this.t);
      this.k1 = pb.mix(this.k1, this.k0, this.t);
      this.Q1 = pb.mix(this.Q1, this.Q0, this.t);
      this.P1 = this.$choice(
        pb.lessThan(this.distanceSquared(this.P0, this.P1), 0.0001),
        pb.add(this.P1, pb.vec2(0.01)),
        this.P1
      );
      this.$l.delta = pb.sub(this.P1, this.P0);
      this.$l.permute = false;
      this.$if(pb.lessThan(pb.abs(this.delta.x), pb.abs(this.delta.y)), function () {
        this.permute = true;
        this.delta = this.delta.yx;
        this.P0 = this.P0.yx;
        this.P1 = this.P1.yx;
      });
      this.$l.stepDir = pb.sign(this.delta.x);
      this.$l.invdx = pb.div(this.stepDir, this.delta.x);
      this.$l.dQ = pb.mul(pb.sub(this.Q1, this.Q0), this.invdx);
      this.$l.dK = pb.mul(pb.sub(this.k1, this.k0), this.invdx);
      this.$l.dP = pb.vec2(this.stepDir, pb.mul(this.delta.y, this.invdx));
      //this.$l.strideScalar = pb.sub(1, pb.min(1, pb.div(pb.neg(this.rayOrigin.z), this.strideZCutoff)));
      //this.$l.pixelStride = pb.add(1, pb.mul(this.strideScalar, this.stride));
      this.$l.pixelStride = this.stride;
      this.dP = pb.mul(this.dP, this.pixelStride);
      this.dQ = pb.mul(this.dQ, this.pixelStride);
      this.dK = pb.mul(this.dK, this.pixelStride);
      this.P0 = pb.add(this.P0, pb.mul(this.dP, this.jitter));
      this.Q0 = pb.add(this.Q0, pb.mul(this.dQ, this.jitter));
      this.k0 = pb.add(this.k0, pb.mul(this.dK, this.jitter));
      this.$l.prevZMaxEstimate = this.rayOrigin.z;
      this.$l.zA = this.prevZMaxEstimate;
      this.$l.zB = this.prevZMaxEstimate;
      this.$l.pqk = pb.vec4(this.P0, this.Q0.z, this.k0);
      this.$l.dpqk = pb.vec4(this.dP, this.dQ.z, this.dK);
      this.$l.invRenderTargetSize = pb.div(pb.vec2(1), this.textureSize.zw);
      this.$l.intersected = false;
      this.$l.hitUV = pb.vec2();
      this.$l.hitZ = pb.float();
      this.numIterations = 0;
      this.skippedIterations = pb.min(this.maxIterations, 2);
      this.$for(pb.float('i'), 0, pb.getDevice().type === 'webgl' ? 1000 : this.maxIterations, function () {
        if (pb.getDevice().type === 'webgl') {
          this.$if(pb.greaterThanEqual(this.i, this.maxIterations), function () {
            this.$break();
          });
        }
        this.$if(pb.and(this.intersected, pb.greaterThanEqual(this.i, this.skippedIterations)), function () {
          this.$break();
        });
        this.numIterations = pb.add(this.numIterations, 1);
        this.pqk = pb.add(this.pqk, this.dpqk);
        this.zA = this.prevZMaxEstimate;
        this.zB = pb.div(
          pb.add(pb.mul(this.dpqk.z, 0.5), this.pqk.z),
          pb.add(pb.mul(this.dpqk.w, 0.5), this.pqk.w)
        );
        this.zB = pb.clamp(this.zB, this.zMin, this.zMax);
        this.prevZMaxEstimate = this.zB;
        this.hitZ = this.zB;
        this.$if(pb.greaterThan(this.zB, this.zA), function () {
          this.$l.t = this.zB;
          this.zB = this.zA;
          this.zA = this.t;
        });
        this.hitUV = this.$choice(this.permute, this.pqk.yx, this.pqk.xy);
        this.hitUV = pb.mul(this.hitUV, this.invRenderTargetSize);
        this.intersected = this.rayIntersectDepth(
          this.zA,
          this.zB,
          this.thickness,
          this.hitUV,
          this.cameraNearFar.y
        );
      });
      this.hit2D = pb.vec3(this.hitUV, this.hitZ);
      this.Q0 = pb.vec3(pb.add(this.Q0.xy, pb.mul(this.dQ.xy, this.numIterations)), this.pqk.z);
      this.hit3D = pb.div(this.Q0, this.pqk.w);
      this.$return(this.intersected);
    }
  );
  pb.func(
    'SSR_Linear2D',
    [
      pb.vec3('rayOrigin'),
      pb.vec3('rayDirection'),
      pb.mat4('viewMatrix'),
      pb.mat4('projMatrix'),
      pb.mat4('invProjMatrix'),
      pb.float('jitter'),
      pb.float('stride'),
      pb.float('strideZCutoff'),
      pb.float('maxDistance'),
      pb.float('maxIterations'),
      pb.float('thickness'),
      pb.vec2('cameraNearFar'),
      pb.vec4('textureSize')
    ],
    function () {
      this.$l.hit2D = pb.vec3();
      this.$l.hit3D = pb.vec3();
      this.$l.origin = pb.vec2();
      this.$l.numIterations = pb.float();
      this.$l.intersected = this.traceRayLinear2D(
        this.rayOrigin,
        this.rayDirection,
        this.jitter,
        this.stride,
        this.strideZCutoff,
        this.maxDistance,
        this.maxIterations,
        this.thickness,
        this.cameraNearFar,
        this.projMatrix,
        this.textureSize,
        this.hit2D,
        this.hit3D,
        this.origin,
        this.numIterations
      );
      this.$if(
        pb.or(
          pb.not(this.intersected),
          pb.any(pb.lessThan(this.hit2D.xy, pb.vec2(0))),
          pb.any(pb.greaterThan(this.hit2D.xy, pb.vec2(1)))
        ),
        function () {
          this.$return(pb.vec4(0));
        }
      );
      this.$l.confidence = validateHit(
        this,
        this.hit2D.xy,
        this.origin,
        this.rayDirection,
        this.viewMatrix,
        this.invProjMatrix,
        this.cameraNearFar,
        this.textureSize,
        linearDepthTex,
        normalTexture
      );
      this.$l.iterationAttenuation = pb.smoothStep(this.maxIterations, 1, this.numIterations);
      this.confidence = pb.mul(this.confidence, this.iterationAttenuation);
      this.$return(pb.vec4(this.hit2D, this.confidence));
    }
  );
  return scope.SSR_Linear2D(
    viewPos,
    traceRay,
    viewMatrix,
    projMatrix,
    invProjMatrix,
    0,
    stride,
    100,
    maxDistance,
    maxIterations,
    thickness,
    cameraNearFar,
    textureSize
  );
}

export function screenSpaceRayTracing_HiZ(
  scope: PBInsideFunctionScope,
  viewPos: PBShaderExp,
  traceRay: PBShaderExp,
  viewMatrix: PBShaderExp,
  projMatrix: PBShaderExp,
  invProjMatrix: PBShaderExp,
  cameraNearFar: PBShaderExp,
  maxMipLevel: PBShaderExp | number,
  maxIterations: PBShaderExp | number,
  thickness: PBShaderExp | number,
  textureSize: PBShaderExp,
  HiZTexture: PBShaderExp,
  normalTexture?: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  pb.func('getMipResolution', [pb.int('mipLevel')], function () {
    this.$return(pb.vec2(pb.textureDimensions(HiZTexture, this.mipLevel)));
  });
  pb.func('SSR_loadDepth', [pb.vec2('uv'), pb.float('level')], function () {
    this.$return(pb.textureSampleLevel(HiZTexture, this.uv, this.level).r);
  });
  pb.func('invProjectPosition', [pb.vec3('p'), pb.mat4('mat')], function () {
    this.$l.c = pb.sub(pb.mul(this.p, 2), pb.vec3(1));
    this.$l.u = pb.mul(this.mat, pb.vec4(this.c, 1));
    this.u = pb.div(this.u, this.u.w);
    this.$return(this.u.xyz);
  });
  pb.func('projectPosition', [pb.vec3('p'), pb.mat4('mat')], function () {
    this.$l.projected = pb.mul(this.mat, pb.vec4(this.p, 1));
    this.projected = pb.div(this.projected, this.projected.w);
    this.projected = pb.add(pb.mul(this.projected, 0.5), pb.vec4(0.5));
    this.$return(this.projected.xyz);
  });
  pb.func(
    'projectDirection',
    [pb.vec3('p'), pb.vec3('d'), pb.vec3('screenSpacePos'), pb.mat4('mat')],
    function () {
      this.$return(pb.sub(this.projectPosition(pb.add(this.p, this.d), this.mat), this.screenSpacePos));
    }
  );
  pb.func(
    'SSR_initialAdvanceRay',
    [
      pb.vec3('origin'),
      pb.vec3('direction'),
      pb.vec3('invDirection'),
      pb.vec2('currentMipResolution'),
      pb.vec2('invCurrentMipResolution'),
      pb.vec2('floorOffset'),
      pb.vec2('uvOffset'),
      pb.vec3('position').out(),
      pb.float('currentT').out()
    ],
    function () {
      this.$l.currentMipPosition = pb.mul(this.currentMipResolution, this.origin.xy);
      this.$l.xyPlane = pb.add(pb.floor(this.currentMipPosition), this.floorOffset);
      this.xyPlane = pb.add(pb.mul(this.xyPlane, this.invCurrentMipResolution), this.uvOffset);
      this.$l.t = pb.mul(pb.sub(this.xyPlane, this.origin.xy), this.invDirection.xy);
      this.currentT = pb.min(this.t.x, this.t.y);
      this.position = pb.add(this.origin, pb.mul(this.direction, this.currentT));
    }
  );
  pb.func(
    'SSR_advanceRay',
    [
      pb.vec3('origin'),
      pb.vec3('direction'),
      pb.vec3('invDirection'),
      pb.vec2('currentMipPosition'),
      pb.vec2('invCurrentMipResolution'),
      pb.vec2('floorOffset'),
      pb.vec2('uvOffset'),
      pb.float('surfaceZ'),
      pb.vec3('position').inout(),
      pb.float('currentT').inout()
    ],
    function () {
      this.$l.xyPlane = pb.add(pb.floor(this.currentMipPosition), this.floorOffset);
      this.xyPlane = pb.add(pb.mul(this.xyPlane, this.invCurrentMipResolution), this.uvOffset);
      this.$l.boundaryPlanes = pb.vec3(this.xyPlane, this.surfaceZ);
      this.$l.t = pb.mul(pb.sub(this.boundaryPlanes, this.origin), this.invDirection);
      this.t.z = this.$choice(pb.greaterThan(this.direction.z, 0), this.t.z, MAX_FLOAT_VALUE);
      this.$l.tMin = pb.min(pb.min(this.t.x, this.t.y), this.t.z);
      this.$l.aboveSurface = pb.greaterThan(this.surfaceZ, this.position.z);
      this.$l.skippedTile = pb.and(
        pb.notEqual(pb.floatBitsToUint(this.tMin), pb.floatBitsToUint(this.t.z)),
        this.aboveSurface
      );
      this.currentT = this.$choice(this.aboveSurface, this.tMin, this.currentT);
      this.position = pb.add(this.origin, pb.mul(this.direction, this.currentT));
      this.$return(this.skippedTile);
    }
  );
  pb.func(
    'SSR_RaymarchHiZ',
    [
      pb.vec3('screenSpacePos'),
      pb.vec3('screenSpaceDirection'),
      pb.vec2('cameraNearFar'),
      pb.vec2('screenSize'),
      pb.int('mostDetailMip'),
      pb.int('maxMipLevel'),
      pb.float('maxIterations'),
      pb.float('numIterations').out()
    ],
    function () {
      this.$l.invDirection = this.$choice(
        pb.all(pb.compNotEqual(this.screenSpaceDirection, pb.vec3(0))),
        pb.div(pb.vec3(1), this.screenSpaceDirection),
        pb.vec3(MAX_FLOAT_VALUE)
      );
      this.$l.currentMip = this.mostDetailMip;
      this.$l.currentMipResolution = this.getMipResolution(this.currentMip);
      this.$l.invCurrentMipResolution = pb.div(pb.vec2(1), this.currentMipResolution);
      this.$l.uvOffset = pb.div(pb.mul(0.005, pb.exp2(pb.float(this.mostDetailMip))), this.screenSize);
      /*
      this.$l.uvOffset = pb.div(
        pb.vec2(0.001),
        //pb.mul(pb.exp2(pb.float(this.mostDetailMip)), 0.005),
        pb.vec2(pb.textureDimensions(HiZTexture, this.mostDetailMip))
      );
      */
      this.uvOffset = pb.vec2(
        this.$choice(pb.lessThan(this.screenSpaceDirection.x, 0), pb.neg(this.uvOffset.x), this.uvOffset.x),
        this.$choice(pb.lessThan(this.screenSpaceDirection.y, 0), pb.neg(this.uvOffset.y), this.uvOffset.y)
      );
      this.$l.floorOffset = pb.vec2(
        this.$choice(pb.lessThan(this.screenSpaceDirection.x, 0), pb.float(0), pb.float(1)),
        this.$choice(pb.lessThan(this.screenSpaceDirection.y, 0), pb.float(0), pb.float(1))
      );
      this.$l.currentT = pb.float();
      this.$l.position = pb.vec3();
      this.SSR_initialAdvanceRay(
        this.screenSpacePos,
        this.screenSpaceDirection,
        this.invDirection,
        this.currentMipResolution,
        this.invCurrentMipResolution,
        this.floorOffset,
        this.uvOffset,
        this.position,
        this.currentT
      );
      this.numIterations = pb.float(0);
      this.$while(
        pb.and(
          pb.lessThan(this.numIterations, this.maxIterations),
          pb.greaterThanEqual(this.currentMip, this.mostDetailMip)
        ),
        function () {
          this.$l.currentMipPosition = pb.mul(this.currentMipResolution, this.position.xy);
          this.$l.surfaceZ = pb.textureLoad(HiZTexture, pb.ivec2(this.currentMipPosition), this.currentMip).r;
          this.$l.skippedTile = this.SSR_advanceRay(
            this.screenSpacePos,
            this.screenSpaceDirection,
            this.invDirection,
            this.currentMipPosition,
            this.invCurrentMipResolution,
            this.floorOffset,
            this.uvOffset,
            this.surfaceZ,
            this.position,
            this.currentT
          );
          this.$l.nextMipIsOutOfRange = pb.and(
            this.skippedTile,
            pb.greaterThanEqual(this.currentMip, this.maxMipLevel)
          );
          this.$if(pb.not(this.nextMipIsOutOfRange), function () {
            this.currentMip = pb.add(this.currentMip, this.$choice(this.skippedTile, pb.int(1), pb.int(-1)));
            this.currentMipResolution = pb.mul(
              this.currentMipResolution,
              this.$choice(this.skippedTile, 0.5, 2)
            );
            this.invCurrentMipResolution = pb.mul(
              this.invCurrentMipResolution,
              this.$choice(this.skippedTile, 2, 0.5)
            );
          });
          this.numIterations = pb.add(this.numIterations, 1);
        }
      );
      this.$l.validHit = this.$choice(
        pb.lessThanEqual(this.numIterations, this.maxIterations),
        pb.float(1),
        pb.float(0)
      );
      this.$return(pb.vec4(this.position, this.validHit));
    }
  );
  pb.func(
    'SSR_HiZ',
    [
      pb.vec3('viewPos'),
      pb.vec3('traceRay'),
      pb.mat4('viewMatrix'),
      pb.mat4('projMatrix'),
      pb.mat4('invProjMatrix'),
      pb.vec2('cameraNearFar'),
      pb.float('thickness'),
      pb.vec4('textureSize'),
      pb.int('maxMipLevel'),
      pb.float('maxIterations')
    ],
    function () {
      this.$if(pb.greaterThan(this.traceRay.z, 0), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.originH = pb.mul(this.projMatrix, pb.vec4(this.viewPos, 1));
      this.$l.originCS = pb.div(this.originH.xyz, this.originH.w);
      this.$l.originTS = pb.add(pb.mul(this.originCS, 0.5), pb.vec3(0.5));
      this.$l.directionTS = this.projectDirection(
        this.viewPos,
        this.traceRay,
        this.originTS,
        this.projMatrix
      );
      this.$l.mostDetailMip = pb.int(0);
      this.$l.numIterations = pb.float();
      this.$l.hit = this.SSR_RaymarchHiZ(
        this.originTS,
        this.directionTS,
        this.cameraNearFar,
        this.textureSize.zw,
        this.mostDetailMip,
        this.maxMipLevel,
        this.maxIterations,
        this.numIterations
      );
      this.$l.confidence = pb.float(0);
      this.$if(pb.notEqual(this.hit.w, 0), function () {
        this.confidence = validateHit(
          this,
          this.hit.xy,
          this.originTS.xy,
          this.traceRay,
          this.viewMatrix,
          this.invProjMatrix,
          this.cameraNearFar,
          this.textureSize,
          HiZTexture,
          normalTexture
        );
      });
      this.$l.iterationAttenuation = pb.smoothStep(this.maxIterations, 1, this.numIterations);
      this.confidence = pb.mul(this.confidence, this.iterationAttenuation);
      this.$return(pb.vec4(this.hit.xyz, this.confidence));
    }
  );
  return scope.SSR_HiZ(
    viewPos,
    traceRay,
    viewMatrix,
    projMatrix,
    invProjMatrix,
    cameraNearFar,
    thickness,
    textureSize,
    pb.sub(maxMipLevel, 1),
    maxIterations
  );
}

export function screenSpaceRayTracing_HiZ_old(
  scope: PBInsideFunctionScope,
  viewPos: PBShaderExp,
  traceRay: PBShaderExp,
  viewMatrix: PBShaderExp,
  projMatrix: PBShaderExp,
  invProjMatrix: PBShaderExp,
  cameraNearFar: PBShaderExp,
  maxDistance: PBShaderExp | number,
  maxIteraions: PBShaderExp | number,
  thickness: PBShaderExp | number,
  textureSize: PBShaderExp,
  HiZTextureMipLevels: PBShaderExp | number,
  HiZTexture: PBShaderExp,
  normalTexture?: PBShaderExp
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
      this.$l.cell_size = pb.div(pb.vec2(1), this.cell_count);
      this.$l.planes = pb.add(pb.div(this.cell, this.cell_count), pb.mul(this.cell_size, this.crossStep));
      this.$l.solutions = pb.div(pb.sub(this.planes, this.o.xy), this.d.xy);
      this.$l.intersection_pos = pb.add(this.o, pb.mul(this.d, pb.min(this.solutions.x, this.solutions.y)));
      this.$l.p = this.$choice(
        pb.lessThan(this.solutions.x, this.solutions.y),
        pb.vec2(this.crossOffset.x, 0),
        pb.vec2(0, this.crossOffset.y)
      );
      this.$return(pb.vec3(pb.add(this.intersection_pos.xy, this.p), this.intersection_pos.z));
    }
  );
  pb.func('SSR_HiZ_getCellCount', [pb.vec2('fullSize'), pb.int('level')], function () {
    this.$return(
      pb.div(this.fullSize, this.$choice(pb.equal(this.level, 0), pb.float(1), pb.exp2(pb.float(this.level))))
    );
  });
  pb.func('SSR_HiZ_crossedCellBoundary', [pb.vec2('oldCellIndex'), pb.vec2('newCellIndex')], function () {
    this.$return(
      pb.or(
        pb.notEqual(pb.int(this.oldCellIndex.x), pb.int(this.newCellIndex.x)),
        pb.notEqual(pb.int(this.oldCellIndex.y), pb.int(this.newCellIndex.y))
      )
    );
  });
  pb.func('SSR_HiZ_getMinimumDepth', [pb.vec2('uv'), pb.float('level')], function () {
    this.$return(pb.textureSampleLevel(HiZTexture, this.uv, this.level).r);
  });
  pb.func(
    'SSR_HiZ_tracing',
    [
      pb.vec3('samplePosInTS'),
      pb.vec3('reflectVecInTS'),
      pb.float('maxDistance'),
      pb.float('thickness'),
      pb.int('maxIteration'),
      pb.int('depthMipLevels'),
      pb.vec2('depthFullSize')
    ],
    function () {
      this.$l.HIZ_START_LEVEL = pb.float(0);
      this.$l.HIZ_STOP_LEVEL = pb.float(0);
      this.$l.HIZ_MAX_LEVEL = pb.float(pb.sub(this.depthMipLevels, 1));

      this.$l.level = this.HIZ_START_LEVEL;
      this.$l.d = pb.mul(this.reflectVecInTS, this.maxDistance);
      this.$l.v_z = pb.div(this.d, this.d.z);
      this.$l.hi_z_size = this.SSR_HiZ_getCellCount(this.depthFullSize, this.level);
      this.$l.ray = this.samplePosInTS;
      this.$l.cross_step = pb.vec2(
        this.$choice(pb.greaterThanEqual(this.reflectVecInTS.x, 0), pb.float(1), pb.float(-1)),
        this.$choice(pb.greaterThanEqual(this.reflectVecInTS.y, 0), pb.float(1), pb.float(-1))
      );
      this.$l.cross_offset = pb.mul(this.cross_step, pb.div(pb.vec2(0.5), this.depthFullSize));
      this.cross_step = pb.clamp(this.cross_step, pb.vec2(0), pb.vec2(1));
      this.$l.ray_cell = this.SSR_HiZ_getCell(this.ray.xy, this.hi_z_size.xy);
      this.ray = this.SSR_HiZ_intersectCellBoundary(
        this.ray,
        this.d,
        this.ray_cell,
        this.hi_z_size,
        this.cross_step,
        this.cross_offset
      );
      this.$l.iterations = pb.int(0);
      this.min_z = pb.float(0);
      this.$while(
        pb.and(
          pb.greaterThanEqual(this.level, this.HIZ_STOP_LEVEL),
          pb.lessThan(this.iterations, this.maxIteration)
        ),
        function () {
          this.$l.current_cell_count = this.SSR_HiZ_getCellCount(this.depthFullSize, this.level);
          this.$l.old_cell_id = this.SSR_HiZ_getCell(this.ray.xy, this.current_cell_count);
          this.min_z = this.SSR_HiZ_getMinimumDepth(this.ray.xy, this.level);
          this.$l.tmp_ray = this.ray;
          this.$if(pb.greaterThan(this.reflectVecInTS.z, 0), function () {
            this.$l.min_minus_ray = pb.sub(this.min_z, this.ray.z);
            this.tmp_ray = this.$choice(
              pb.greaterThan(this.min_minus_ray, 0),
              pb.add(this.ray, pb.mul(this.v_z, this.min_minus_ray)),
              this.tmp_ray
            );
            this.$l.new_cell_id = this.SSR_HiZ_getCell(this.tmp_ray.xy, this.current_cell_count);
            this.$if(this.SSR_HiZ_crossedCellBoundary(this.old_cell_id, this.new_cell_id), function () {
              this.tmp_ray = this.SSR_HiZ_intersectCellBoundary(
                this.ray,
                this.d,
                this.old_cell_id,
                this.current_cell_count,
                this.cross_step,
                this.cross_offset
              );
              this.level = pb.min(this.HIZ_MAX_LEVEL, pb.add(this.level, 2));
            }).$else(function () {
              this.$if(
                pb.and(pb.equal(this.level, 1), pb.greaterThan(pb.abs(this.min_minus_ray), this.thickness)),
                function () {
                  this.tmp_ray = this.SSR_HiZ_intersectCellBoundary(
                    this.ray,
                    this.d,
                    this.old_cell_id,
                    this.current_cell_count,
                    this.cross_step,
                    this.cross_offset
                  );
                  this.level = 2;
                }
              );
            });
          }).$elseif(pb.lessThan(this.ray.z, this.min_z), function () {
            this.tmp_ray = this.SSR_HiZ_intersectCellBoundary(
              this.ray,
              this.d,
              this.old_cell_id,
              this.current_cell_count,
              this.cross_step,
              this.cross_offset
            );
            this.level = pb.min(this.HIZ_MAX_LEVEL, pb.add(this.level, 2));
          });
          this.ray = this.tmp_ray;
          this.level = pb.sub(this.level, 1);
          this.iterations = pb.add(this.iterations);
        }
      );
      this.$l.vis = this.$choice(
        pb.and(
          pb.greaterThanEqual(this.level, this.HIZ_STOP_LEVEL),
          pb.lessThan(this.iterations, this.maxIteration)
        ),
        pb.float(1),
        pb.float(0)
      );
      this.$return(pb.vec4(this.ray.xy, this.min_z, this.vis));
      /*
      this.$l.maxLevel = pb.sub(this.depthMipLevels, 1);
      this.$l.crossStep = pb.vec2(
        this.$choice(pb.greaterThanEqual(this.reflectVecInTS.x, 0), pb.float(1), pb.float(-1)),
        this.$choice(pb.greaterThanEqual(this.reflectVecInTS.y, 0), pb.float(1), pb.float(-1))
      );
      this.$l.crossOffset = pb.mul(this.crossStep, 0.0001);
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
        pb.mul(this.crossOffset, 64)
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
          this.$l.thick = this.$choice(pb.equal(this.level, 0), pb.sub(this.ray.z, this.cell_minZ), 0);
          this.$l.crossed = pb.or(
            pb.and(this.isBackwardRay, pb.greaterThan(this.cell_minZ, this.ray.z)),
            pb.greaterThan(this.thick, this.thickness),
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
      this.$l.vis = this.$choice(
        pb.and(pb.lessThan(this.cell_minZ, 1), pb.lessThan(this.level, this.stopLevel)),
        pb.float(1),
        pb.float(0)
      );
      this.$return(pb.vec4(this.ray.xy, this.cell_minZ, this.vis));
      */
    }
  );
  pb.func(
    'SSR_HiZ',
    [
      pb.vec3('viewPos'),
      pb.vec3('traceRay'),
      pb.mat4('viewMatrix'),
      pb.mat4('projMatrix'),
      pb.mat4('invProjMatrix'),
      pb.vec2('cameraNearFar'),
      pb.float('maxDistance'),
      pb.float('iteration'),
      pb.float('thickness'),
      pb.vec4('textureSize'),
      pb.int('depthMipLevels')
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
      this.$l.hit = this.SSR_HiZ_tracing(
        this.fragStartTS,
        this.reflectVecTS,
        this.maxDist,
        this.thickness,
        pb.int(this.iteration),
        this.depthMipLevels,
        this.textureSize.zw
      );
      this.$l.confidence = pb.float(0);
      this.$if(pb.notEqual(this.hit.w, 0), function () {
        this.confidence = validateHit(
          this,
          this.hit.xy,
          this.fragStartTS.xy,
          this.traceRay,
          this.viewMatrix,
          this.invProjMatrix,
          this.cameraNearFar,
          this.textureSize,
          HiZTexture,
          normalTexture
        );
        //this.confidence = 1;
      });
      this.$return(pb.vec4(this.hit.xyz, this.confidence));
    }
  );
  return scope.SSR_HiZ(
    viewPos,
    traceRay,
    viewMatrix,
    projMatrix,
    invProjMatrix,
    cameraNearFar,
    maxDistance,
    maxIteraions,
    thickness,
    textureSize,
    HiZTextureMipLevels
  );
}
