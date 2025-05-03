import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from '../material';

const MAX_FLOAT_VALUE = 3.402823466e38;

/** @internal */
export function SSR_calcJitter(scope: PBInsideFunctionScope, viewPos: PBShaderExp, roughness: PBShaderExp) {
  const pb = scope.$builder;
  pb.func('SSR_calcJitter', [pb.vec3('viewPos'), pb.float('roughness')], function () {
    this.$l.h = pb.fract(pb.mul(this.viewPos, 0.8));
    this.h = pb.add(this.h, pb.dot(this.h, pb.add(this.h.yxz, pb.vec3(19.19))));
    this.h = pb.fract(pb.mul(pb.add(this.h.xxy, this.h.yxx), this.h.zyx));
    this.h = pb.sub(this.h, pb.vec3(0.5));
    this.$return(pb.mix(pb.vec3(0), this.h, this.roughness));
  });
  return scope.SSR_calcJitter(viewPos, roughness);
}

/** @internal */
// source: https://github.com/blender/blender/blob/594f47ecd2d5367ca936cf6fc6ec8168c2b360d0/source/blender/gpu/shaders/material/gpu_shader_material_fresnel.glsl
export function SSR_fresnel(
  scope: PBInsideFunctionScope,
  viewVec: PBShaderExp,
  normal: PBShaderExp,
  eta: PBShaderExp | number = 1.5
) {
  const pb = scope.$builder;
  pb.func('SSR_fresnel', [pb.vec3('viewVec'), pb.vec3('viewNormal'), pb.float('eta')], function () {
    this.$l.cos = pb.dot(this.viewVec, this.viewNormal);
    this.$l.c = pb.abs(this.cos);
    this.$l.g = pb.add(pb.sub(pb.mul(this.eta, this.eta), 1), pb.mul(this.c, this.c));
    this.$l.r = pb.float();
    this.$if(pb.greaterThan(this.g, 0), function () {
      this.g = pb.sqrt(this.g);
      this.$l.A = pb.div(pb.sub(this.g, this.c), pb.add(this.g, this.c));
      this.$l.B = pb.div(
        pb.sub(pb.mul(this.c, pb.add(this.g, this.c)), 1),
        pb.add(pb.mul(this.c, pb.sub(this.g, this.c)), 1)
      );
      this.r = pb.mul(this.A, this.A, 0.5, pb.add(pb.mul(this.B, this.B), 1));
    }).$else(function () {
      this.r = 1;
    });
    this.$return(pb.min(1, pb.mul(this.r, 5)));
  });
  return scope.SSR_fresnel(viewVec, normal, eta);
}

/** @internal */
export function SSR_dither(scope: PBInsideFunctionScope, uv: PBShaderExp) {
  const pb = scope.$builder;
  if (pb.getDevice().type === 'webgl') {
    return pb.float(0);
  }
  if (!pb.getGlobalScope().Z_dither) {
    pb.getGlobalScope().Z_dither = [
      pb.float(0),
      pb.float(0.5),
      pb.float(0.125),
      pb.float(0.625),
      pb.float(0.75),
      pb.float(0.25),
      pb.float(0.875),
      pb.float(0.375),
      pb.float(0.187),
      pb.float(0.687),
      pb.float(0.0625),
      pb.float(0.562),
      pb.float(0.937),
      pb.float(0.437),
      pb.float(0.812),
      pb.float(0.312)
    ];
    pb.func('SSR_dither', [pb.vec2('uv')], function () {
      this.$l.ditherUV = pb.mod(this.uv, pb.vec2(4));
      this.$return(this.Z_dither.at(pb.uint(pb.add(pb.mul(this.ditherUV.x, 4), this.ditherUV.y))));
    });
    return scope.SSR_dither(uv);
  }
}
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
  hit3D: PBShaderExp,
  surfaceZ: PBShaderExp,
  thickness: PBShaderExp,
  uv: PBShaderExp,
  traceRay: PBShaderExp,
  viewMatrix: PBShaderExp,
  invProjMatrix: PBShaderExp,
  textureSize: PBShaderExp,
  normalTexture?: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = hit3D ? 'SSR_validateHit_HiZ' : 'SSR_validateHit';
  pb.func(
    funcName,
    [
      pb.vec2('hit2d'),
      ...(hit3D ? [pb.vec3('hit3d')] : []),
      ...(hit3D ? [pb.float('thickness')] : []),
      pb.float('surfaceZ'),
      pb.vec2('uv'),
      pb.vec3('viewSpaceRayDirection'),
      pb.mat4('viewMatrix'),
      pb.mat4('invProjMatrix'),
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
        pb.all(pb.lessThan(this.manhattanDist, pb.vec2(pb.div(pb.vec2(2), this.textureSize.xy)))),
        function () {
          this.$return(pb.float(0));
        }
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
      this.$l.vignette = pb.mul(this.border.x, this.border.y);
      if (this.hit3d) {
        this.$l.distance = pb.distance(this.viewSpaceSurface, this.hit3d);
        this.$l.confidence = pb.sub(1, pb.smoothStep(0, this.thickness, this.distance));
        this.$return(pb.mul(this.vignette, this.confidence, this.confidence));
      } else {
        this.$return(this.vignette);
      }
    }
  );
  return hit3D
    ? scope[funcName](hit2D, hit3D, thickness, surfaceZ, uv, traceRay, viewMatrix, invProjMatrix, textureSize)
    : scope[funcName](hit2D, surfaceZ, uv, traceRay, viewMatrix, invProjMatrix, textureSize);
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
        this.$l.sceneZ = ShaderHelper.sampleLinearDepthWithBackface(this, linearDepthTex, this.uv, 0);
        this.$l.sceneZMax01 = this.sceneZ.x;
        thickness = pb.max(this.thickness, pb.mul(pb.sub(this.sceneZ.y, this.sceneZ.x), this.cameraFar));
      } else {
        this.$l.sceneZMax01 = ShaderHelper.sampleLinearDepth(this, linearDepthTex, this.uv, 0);
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
      pb.float('stride'),
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
      this.$l.jitter = pb.float(1); //dither(this, this.P0);
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
      pb.float('stride'),
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
        this.stride,
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
      this.$if(pb.not(this.intersected), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.surfaceZ01 = ShaderHelper.sampleLinearDepth(this, linearDepthTex, this.hit2D.xy, 0);
      this.$if(pb.equal(this.surfaceZ01, 1), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.surfaceZ = ShaderHelper.linearDepthToNonLinear(
        this,
        pb.mul(this.surfaceZ01, this.cameraNearFar.y),
        this.cameraNearFar
      );
      this.$l.confidence = validateHit(
        this,
        this.hit2D.xy,
        null,
        this.surfaceZ,
        null,
        this.origin,
        this.rayDirection,
        this.viewMatrix,
        this.invProjMatrix,
        this.textureSize,
        normalTexture
      );
      this.$l.iterationAttenuation = pb.sub(1, pb.smoothStep(0, this.maxIterations, this.numIterations));
      //this.$l.iterationAttenuation = pb.smoothStep(this.maxIterations, 1, this.numIterations);
      this.confidence = pb.mul(this.confidence, this.iterationAttenuation);
      this.$l.hitPixel = pb.mul(this.hit2D.xy, this.textureSize.zw);
      this.$l.startPixel = pb.mul(this.origin.xy, this.textureSize.zw);
      this.$l.hitDistance = pb.length(pb.sub(this.hitPixel, this.startPixel));
      this.$return(pb.vec4(this.hit2D.xy, this.hitDistance, this.confidence));
    }
  );
  return scope.SSR_Linear2D(
    viewPos,
    traceRay,
    viewMatrix,
    projMatrix,
    invProjMatrix,
    stride,
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
        this.$l.surfaceZ = pb.textureSampleLevel(HiZTexture, this.hit.xy, 0).r;
        this.$if(pb.equal(this.surfaceZ, 1), function () {
          this.$return(pb.vec4(0));
        });
        this.$l.hit3D = invProjectPosition(this, this.hit.xyz, this.invProjMatrix);
        this.confidence = validateHit(
          this,
          this.hit.xy,
          this.hit3D,
          this.surfaceZ,
          this.thickness,
          this.originTS.xy,
          this.traceRay,
          this.viewMatrix,
          this.invProjMatrix,
          this.textureSize,
          normalTexture
        );
      });
      this.$l.iterationAttenuation = pb.sub(1, pb.smoothStep(0, this.maxIterations, this.numIterations));
      this.$l.viewAttenuation = pb.sub(1, pb.smoothStep(-0.5, 0, this.traceRay.z));
      //this.$l.iterationAttenuation = pb.smoothStep(this.maxIterations, 1, this.numIterations);
      this.confidence = pb.mul(this.confidence, this.iterationAttenuation, this.viewAttenuation);
      this.$l.hitPixel = pb.mul(this.hit.xy, this.textureSize.zw);
      this.$l.startPixel = pb.mul(this.originTS.xy, this.textureSize.zw);
      this.$l.hitDistance = pb.length(pb.sub(this.hitPixel, this.startPixel));
      this.$return(pb.vec4(this.hit.xy, this.hitDistance, this.confidence));
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

/*
float2 cell(float2 ray, float2 cell_count, uint camera) {
	return floor(ray.xy * cell_count);
}

float2 cell_count(float level) {
	return input_texture2_size / (level == 0.0 ? 1.0 : exp2(level));
}

float3 intersect_cell_boundary(float3 pos, float3 dir, float2 cell_id, float2 cell_count, float2 cross_step, float2 cross_offset, uint camera) {
	float2 cell_size = 1.0 / cell_count;
	float2 planes = cell_id/cell_count + cell_size * cross_step;

	float2 solutions = (planes - pos)/dir.xy;
	float3 intersection_pos = pos + dir * min(solutions.x, solutions.y);

	intersection_pos.xy += (solutions.x < solutions.y) ? float2(cross_offset.x, 0.0) : float2(0.0, cross_offset.y);

	return intersection_pos;
}

bool crossed_cell_boundary(float2 cell_id_one, float2 cell_id_two) {
	return (int)cell_id_one.x != (int)cell_id_two.x || (int)cell_id_one.y != (int)cell_id_two.y;
}

float minimum_depth_plane(float2 ray, float level, float2 cell_count, uint camera) {
	return input_texture2.Load(int3(vr_stereo_to_mono(ray.xy, camera) * cell_count, level)).r;
}

float3 hi_z_trace(float3 p, float3 v, in uint camera, out uint iterations) {
	float level = HIZ_START_LEVEL;
	float3 v_z = v/v.z;
	float2 hi_z_size = cell_count(level);
	float3 ray = p;

	float2 cross_step = float2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
	float2 cross_offset = cross_step * 0.00001;
	cross_step = saturate(cross_step);

	float2 ray_cell = cell(ray.xy, hi_z_size.xy, camera);
	ray = intersect_cell_boundary(ray, v, ray_cell, hi_z_size, cross_step, cross_offset, camera);

	iterations = 0;
	while(level >= HIZ_STOP_LEVEL && iterations < MAX_ITERATIONS) {
		// get the cell number of the current ray
		float2 current_cell_count = cell_count(level);
		float2 old_cell_id = cell(ray.xy, current_cell_count, camera);

		// get the minimum depth plane in which the current ray resides
		float min_z = minimum_depth_plane(ray.xy, level, current_cell_count, camera);

		// intersect only if ray depth is below the minimum depth plane
		float3 tmp_ray = ray;
		if(v.z > 0) {
			float min_minus_ray = min_z - ray.z;
			tmp_ray = min_minus_ray > 0 ? ray + v_z*min_minus_ray : tmp_ray;
			float2 new_cell_id = cell(tmp_ray.xy, current_cell_count, camera);
			if(crossed_cell_boundary(old_cell_id, new_cell_id)) {
				tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
				level = min(HIZ_MAX_LEVEL, level + 2.0f);
			}else{
				if(level == 1 && abs(min_minus_ray) > 0.0001) {
					tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
					level = 2;
				}
			}
		} else if(ray.z < min_z) {
			tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
			level = min(HIZ_MAX_LEVEL, level + 2.0f);
		}

		ray.xyz = tmp_ray.xyz;
		--level;

		++iterations;
	}
	return ray;
}
*/
