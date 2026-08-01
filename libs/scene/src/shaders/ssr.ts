import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from '../material/shader/helper';
import type { Nullable } from '@zephyr3d/base';
import { REVERSE_Z } from '@zephyr3d/base';

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
    this.$l.c = pb.vec3(
      pb.sub(pb.mul(this.p.xy, 2), pb.vec2(1)),
      ShaderHelper.deviceDepthToClipZ(this, this.p.z)
    );
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
  hit3D: Nullable<PBShaderExp>,
  surfaceZ: PBShaderExp,
  thickness: Nullable<PBShaderExp>,
  uv: PBShaderExp,
  traceRay: PBShaderExp,
  viewMatrix: PBShaderExp,
  invProjMatrix: PBShaderExp,
  textureSize: PBShaderExp,
  normalTexture?: PBShaderExp,
  debugValidationOut?: PBShaderExp
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
      pb.vec4('textureSize'),
      ...(debugValidationOut ? [pb.vec3('debugValidation').out()] : [])
    ],
    function () {
      if (debugValidationOut) {
        this.debugValidation = pb.vec3(1, 1, 0);
      }
      this.$if(
        pb.or(pb.any(pb.lessThan(this.hit2d, pb.vec2(0))), pb.any(pb.greaterThan(this.hit2d, pb.vec2(1)))),
        function () {
          if (debugValidationOut) {
            this.debugValidation = pb.vec3(0);
          }
          this.$return(pb.float(0));
        }
      );
      this.$l.manhattanDist = pb.abs(pb.sub(this.hit2d, this.uv));
      this.$if(
        pb.all(pb.lessThan(this.manhattanDist, pb.vec2(pb.div(pb.vec2(2), this.textureSize.xy)))),
        function () {
          if (debugValidationOut) {
            this.debugValidation.x = 0;
          }
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
          if (debugValidationOut) {
            this.debugValidation.y = 0;
          }
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
        if (debugValidationOut) {
          this.debugValidation.z = this.confidence;
        }
        this.$return(pb.mul(this.vignette, this.confidence, this.confidence));
      } else {
        this.$return(this.vignette);
      }
    }
  );
  return hit3D
    ? debugValidationOut
      ? scope[funcName](
          hit2D,
          hit3D,
          thickness,
          surfaceZ,
          uv,
          traceRay,
          viewMatrix,
          invProjMatrix,
          textureSize,
          debugValidationOut
        )
      : scope[funcName](
          hit2D,
          hit3D,
          thickness,
          surfaceZ,
          uv,
          traceRay,
          viewMatrix,
          invProjMatrix,
          textureSize
        )
    : scope[funcName](hit2D, surfaceZ, uv, traceRay, viewMatrix, invProjMatrix, textureSize);
}

/**
 * Optional `giTraceOut` (both tracers): `vec3(occluded, escaped, rawConfidence)`.
 *
 * Reflections only care whether a hit is usable, so the returned confidence folds
 * together "was the ray blocked" and "can its radiance be trusted". Diffuse GI
 * needs those apart: a hit whose colour is unusable still occludes the sky.
 * - `occluded`: the march intersected geometry (not a sky texel).
 * - `escaped`: the march missed and the ray was provably unoccluded where it
 *   stopped. Neither flag set means the outcome is indeterminate (ran out of
 *   screen or iterations behind geometry) and callers should exclude the sample
 *   rather than treat it as unoccluded.
 * - `certainty`: how certain the intersection is *geometrically* — the hit's
 *   distance from the sampled surface relative to the thickness, so a thin-object
 *   false positive does not occlude. Deliberately excludes the screen-border,
 *   near-self and backface vetoes {@link validateHit} applies: those bound
 *   reflection artifacts, whereas for diffuse GI a border, adjacent or
 *   back-facing hit is real geometry whose screen colour is still the best
 *   available estimate of its outgoing radiance. The march-length attenuation is
 *   excluded too, as it would make occlusion depend on camera distance.
 *
 * Callers that omit the parameter generate exactly the same shader as before.
 */
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
  useBackfaceDepth?: boolean,
  giTraceOut?: PBShaderExp
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
      this.skippedIterations = pb.min(this.maxIterations, 1);
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
    giTraceOut ? 'SSR_Linear2D_GI' : 'SSR_Linear2D',
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
      pb.vec4('textureSize'),
      ...(giTraceOut ? [pb.vec3('giTrace').out()] : [])
    ],
    function () {
      if (giTraceOut) {
        this.giTrace = pb.vec3(0);
      }
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
      if (giTraceOut) {
        // Depth where the march stopped. A miss only counts as a free escape
        // when the ray was still in front of the depth buffer there; a ray that
        // left the screen from behind geometry is indeterminate, not unoccluded.
        this.$l.exitSurfaceZ01 = ShaderHelper.sampleLinearDepth(this, linearDepthTex, this.hit2D.xy, 0);
        this.$if(pb.not(this.intersected), function () {
          this.$l.exitSceneZ = pb.neg(pb.mul(this.exitSurfaceZ01, this.cameraNearFar.y));
          this.giTrace = pb.vec3(
            0,
            pb.float(
              pb.or(
                pb.greaterThanEqual(this.exitSurfaceZ01, 1),
                pb.greaterThan(this.hit2D.z, this.exitSceneZ)
              )
            ),
            0
          );
          this.$return(pb.vec4(0));
        });
      } else {
        this.$if(pb.not(this.intersected), function () {
          this.$return(pb.vec4(0));
        });
      }
      this.$l.surfaceZ01 = giTraceOut
        ? this.exitSurfaceZ01
        : ShaderHelper.sampleLinearDepth(this, linearDepthTex, this.hit2D.xy, 0);
      this.$if(pb.equal(this.surfaceZ01, 1), function () {
        if (giTraceOut) {
          // The intersection resolved onto a sky texel, so the ray escaped.
          this.giTrace = pb.vec3(0, 1, 0);
        }
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
      if (giTraceOut) {
        // rayIntersectDepth already enforced the thickness window, so an
        // intersection here is geometrically certain regardless of the vetoes
        // validateHit applies for reflections.
        this.giTrace = pb.vec3(1, 0, 1);
      }
      this.$l.iterationAttenuation = pb.sub(1, pb.smoothStep(0, this.maxIterations, this.numIterations));
      //this.$l.iterationAttenuation = pb.smoothStep(this.maxIterations, 1, this.numIterations);
      this.confidence = pb.mul(this.confidence, this.iterationAttenuation);
      this.$l.hitPixel = pb.mul(this.hit2D.xy, this.textureSize.zw);
      this.$l.startPixel = pb.mul(this.origin.xy, this.textureSize.zw);
      this.$l.hitDistance = pb.length(pb.sub(this.hitPixel, this.startPixel));
      this.$return(pb.vec4(this.hit2D.xy, this.hitDistance, this.confidence));
    }
  );
  return giTraceOut
    ? scope.SSR_Linear2D_GI(
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
        textureSize,
        giTraceOut
      )
    : scope.SSR_Linear2D(
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

/**
 * UE5 Random.ush InterleavedGradientNoise. Used as the temporal jitter
 * (StepOffset) for the fixed-step HZB march below.
 */
export function SSR_interleavedGradientNoise(
  scope: PBInsideFunctionScope,
  uv: PBShaderExp,
  frameId: PBShaderExp | number
) {
  const pb = scope.$builder;
  pb.func('SSR_IGN', [pb.vec2('uv'), pb.float('frameId')], function () {
    this.$l.p = pb.add(this.uv, pb.mul(pb.vec2(47, 17), 0.695, this.frameId));
    this.$return(pb.fract(pb.mul(52.9829189, pb.fract(pb.dot(this.p, pb.vec2(0.06711056, 0.00583715))))));
  });
  return scope.SSR_IGN(uv, frameId);
}

/**
 * Screen space ray intersection against the HZB, ported from UE5's
 * SSRTRayCast.ush (InitScreenSpaceRayFromWorldSpace + CastScreenSpaceRay):
 * a fixed-step linear march over the ray clipped/extended to the screen
 * border, sampling the furthest-depth pyramid at a mip level that grows with
 * roughness, with a slope-based CompareTolerance hit window and line-segment
 * hit refinement.
 *
 * Convention differences vs UE5:
 * - UE is reversed-Z (larger = closer); we use standard Z, so every depth
 *   difference is mirrored (`Diff = SampleDepth - SampleZ`).
 * - UE view space has +z forward; ours has -z forward.
 * - UE's HZB is a half-res pow2 pyramid and starts marching at its mip 1;
 *   ours is full-res at mip0. Under standard-Z the march starts at
 *   START_MIP = 0, because the coarse furthest-depth blocks quantize into a
 *   staircase that grazing rays periodically self-intersect, showing up as
 *   regular stripes TAA cannot converge. Under reverse-Z depth precision is
 *   nearly uniform, so the march starts at mip 1 like UE; rough reflections
 *   still climb the pyramid via the roughness mip ramp in both cases.
 *
 * `maxIterations` is the number of linear samples along the ray (UE NumSteps,
 * typically 8..64), no longer the traversal iteration cap of the previous
 * FidelityFX-style implementation.
 */
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
  maxDistance: PBShaderExp | number,
  thickness: PBShaderExp | number,
  textureSize: PBShaderExp,
  HiZTexture: PBShaderExp,
  normalTexture?: PBShaderExp,
  giTraceOut?: PBShaderExp,
  roughness?: PBShaderExp | number,
  stepOffset?: PBShaderExp | number
) {
  const pb = scope.$builder;
  // The r32f pyramid stores the furthest depth (max reduction; mip0 is the
  // raw depth). Matches UE5 marching against the FurthestHZBTexture (UE is
  // reversed-Z, so its furthest pyramid is the min reduction instead).
  pb.func('SSR_loadDepth', [pb.vec2('uv'), pb.float('level')], function () {
    this.$return(pb.textureSampleLevel(HiZTexture, this.uv, this.level).r);
  });
  pb.func('invProjectPosition', [pb.vec3('p'), pb.mat4('mat')], function () {
    this.$l.c = pb.vec3(
      pb.sub(pb.mul(this.p.xy, 2), pb.vec2(1)),
      ShaderHelper.deviceDepthToClipZ(this, this.p.z)
    );
    this.$l.u = pb.mul(this.mat, pb.vec4(this.c, 1));
    this.u = pb.div(this.u, this.u.w);
    this.$return(this.u.xyz);
  });
  // Port of UE5 GetStepScreenFactorToClipAtScreenEdge. Returns the multiplier
  // for rayStepNDC so the ray ends exactly at the screen border. A factor
  // above 1 extends short rays to the border (UE bExtendRayToScreenBorder).
  pb.func('SSR_clipRayToScreenEdge', [pb.vec2('rayStartNDC'), pb.vec2('rayStepNDC')], function () {
    this.$l.rayStepInvFactor = pb.mul(0.5, pb.length(this.rayStepNDC));
    this.$l.absStep = pb.max(pb.abs(this.rayStepNDC), pb.vec2(1e-8));
    this.$l.s = pb.sub(
      pb.vec2(1),
      pb.div(
        pb.max(
          pb.sub(
            pb.abs(pb.add(this.rayStepNDC, pb.mul(this.rayStartNDC, this.rayStepInvFactor))),
            pb.vec2(this.rayStepInvFactor)
          ),
          pb.vec2(0)
        ),
        this.absStep
      )
    );
    this.$return(pb.div(pb.min(this.s.x, this.s.y), pb.max(this.rayStepInvFactor, 1e-8)));
  });
  // Port of UE5 InitScreenSpaceRayFromWorldSpace, in view space (-z forward).
  // Outputs the ray in "texture space": uv in [0,1], z = device depth in
  // [0,1], the same mapping the HZB stores.
  pb.func(
    'SSR_initScreenSpaceRay',
    [
      pb.vec3('viewPos'),
      pb.vec3('rayDirection'),
      pb.float('maxDistance'),
      pb.float('slopeCompareToleranceScale'),
      pb.mat4('projMatrix'),
      pb.vec3('rayStartTS').out(),
      pb.vec3('rayStepTS').out(),
      pb.float('compareTolerance').out()
    ],
    function () {
      // Rays heading towards the camera stop before reaching 5% of the
      // surface view depth (UE: min(-0.95 * SceneDepth / ViewDirZ, TMax)).
      this.$l.rayLength = this.$choice(
        pb.greaterThan(this.rayDirection.z, 0),
        pb.min(this.maxDistance, pb.div(pb.mul(-0.95, this.viewPos.z), pb.max(this.rayDirection.z, 1e-6))),
        this.maxDistance
      );
      this.$l.rayEnd = pb.add(this.viewPos, pb.mul(this.rayDirection, this.rayLength));
      this.$l.startH = pb.mul(this.projMatrix, pb.vec4(this.viewPos, 1));
      this.$l.endH = pb.mul(this.projMatrix, pb.vec4(this.rayEnd, 1));
      this.$l.startNDC = pb.div(this.startH.xyz, this.startH.w);
      this.$l.endNDC = pb.div(this.endH.xyz, this.endH.w);
      this.$l.stepNDC = pb.sub(this.endNDC, this.startNDC);
      // Always extend/clip the ray to the screen border so NumSteps samples
      // cover the whole visible segment.
      this.stepNDC = pb.mul(this.stepNDC, this.SSR_clipRayToScreenEdge(this.startNDC.xy, this.stepNDC.xy));
      if (REVERSE_Z) {
        // Reverse ZO canonical clip space: NDC z is already the device depth.
        this.rayStartTS = pb.vec3(pb.add(pb.mul(this.startNDC.xy, 0.5), pb.vec2(0.5)), this.startNDC.z);
        this.rayStepTS = pb.vec3(pb.mul(this.stepNDC.xy, 0.5), this.stepNDC.z);
      } else {
        this.rayStartTS = pb.add(pb.mul(this.startNDC, 0.5), pb.vec3(0.5));
        this.rayStepTS = pb.mul(this.stepNDC, 0.5);
      }
      // Depth-only step (UE RayDepthScreen): project the point at rayLength
      // straight along the view forward axis for the slope tolerance.
      this.$l.depthH = pb.mul(
        this.projMatrix,
        pb.vec4(this.viewPos.xy, pb.sub(this.viewPos.z, this.rayLength), 1)
      );
      this.$l.depthTSz = REVERSE_Z
        ? pb.div(this.depthH.z, this.depthH.w)
        : pb.add(pb.mul(pb.div(this.depthH.z, this.depthH.w), 0.5), 0.5);
      // Under standard Z depth grows away from the camera, mirroring UE's
      // reversed-Z expression (RayStartScreen.z - RayDepthScreen.z); under
      // reverse-Z the UE orientation applies directly.
      this.compareTolerance = pb.max(
        pb.abs(this.rayStepTS.z),
        pb.mul(
          REVERSE_Z
            ? pb.sub(this.rayStartTS.z, this.depthTSz)
            : pb.sub(this.depthTSz, this.rayStartTS.z),
          this.slopeCompareToleranceScale
        )
      );
    }
  );
  // Port of UE5 CastScreenSpaceRay: NumSteps uniform samples in batches of 4,
  // mip level ramped by roughness, tolerance-window hit test, uncertainty
  // tracking and line-segment hit refinement.
  // Standard-Z keeps 0 instead of UE's StartMipLevel=1: coarse-mip depth
  // staircases combined with the poor far-depth resolution near 1.0 cause
  // grazing-angle stripe artifacts. Under reverse-Z depth precision is nearly
  // uniform along the ray, so the march starts at mip 1 like UE for better
  // texture cache behavior.
  const START_MIP = REVERSE_Z ? 1 : 0;
  pb.func(
    'SSR_castScreenSpaceRay',
    [
      pb.vec3('rayStartTS'),
      pb.vec3('rayStepTS'),
      pb.float('compareToleranceIn'),
      pb.float('numSteps'),
      pb.float('stepOffset'),
      pb.float('roughness'),
      pb.float('maxMipLevel'),
      pb.vec3('hitUVz').out(),
      pb.bool('foundHit').out(),
      pb.bool('uncertain').out(),
      pb.float('numIterations').out()
    ],
    function () {
      this.$l.step = pb.div(1, this.numSteps);
      this.$l.compareTolerance = pb.mul(this.compareToleranceIn, this.step);
      this.$l.rayStepUVz = pb.mul(this.rayStepTS, this.step);
      this.$l.rayUVz = pb.add(this.rayStartTS, pb.mul(this.rayStepUVz, this.stepOffset));
      this.$l.level = pb.float(START_MIP);
      this.$l.mipInc = pb.mul(pb.div(8, this.numSteps), this.roughness);
      this.$l.lastDiff = pb.float(0);
      this.foundHit = false;
      this.uncertain = false;
      this.$l.marchBase = pb.float(0);
      // Depth diffs / hit flags of the current 4-sample batch, kept for the
      // post-loop hit refinement.
      this.$l.diff0 = pb.float(0);
      this.$l.diff1 = pb.float(0);
      this.$l.diff2 = pb.float(0);
      this.$l.diff3 = pb.float(0);
      this.$l.hit0 = pb.bool(false);
      this.$l.hit1 = pb.bool(false);
      this.$l.hit2 = pb.bool(false);
      this.$l.hit3 = pb.bool(false);
      this.$l.numBatches = pb.ceil(pb.mul(this.numSteps, 0.25));
      this.$for(pb.float('i'), 0, pb.getDevice().type === 'webgl' ? 64 : this.numBatches, function () {
        if (pb.getDevice().type === 'webgl') {
          this.$if(pb.greaterThanEqual(this.i, this.numBatches), function () {
            this.$break();
          });
        }
        this.marchBase = pb.mul(this.i, 4);
        // Two samples per mip step (UE: SamplesMip.xy = Level; Level += inc).
        this.$l.mip01 = pb.min(this.level, this.maxMipLevel);
        this.$l.mip23 = pb.min(pb.add(this.level, this.mipInc), this.maxMipLevel);
        this.level = pb.add(this.level, pb.mul(this.mipInc, 2));
        for (let j = 0; j < 4; j++) {
          this.$l[`sampleT${j}`] = pb.add(this.marchBase, j + 1);
          this.$l[`sampleUV${j}`] = pb.add(this.rayUVz.xy, pb.mul(this.rayStepUVz.xy, this[`sampleT${j}`]));
          this.$l[`sampleZ${j}`] = pb.add(this.rayUVz.z, pb.mul(this.rayStepUVz.z, this[`sampleT${j}`]));
          // Negative when the ray is behind the surface, hit window (-2T, 0).
          // Under reverse-Z this is UE's original `SamplesZ - SampleDepth`;
          // under standard Z the difference is mirrored.
          this[`diff${j}`] = REVERSE_Z
            ? pb.sub(
                this[`sampleZ${j}`],
                this.SSR_loadDepth(this[`sampleUV${j}`], j < 2 ? this.mip01 : this.mip23)
              )
            : pb.sub(
                this.SSR_loadDepth(this[`sampleUV${j}`], j < 2 ? this.mip01 : this.mip23),
                this[`sampleZ${j}`]
              );
          this[`hit${j}`] = pb.lessThan(
            pb.abs(pb.add(this[`diff${j}`], this.compareTolerance)),
            this.compareTolerance
          );
          this.foundHit = pb.or(this.foundHit, this[`hit${j}`]);
          // The ray went far behind geometry before any hit: its outcome
          // cannot be resolved from the depth buffer (UE bUncertain).
          this.uncertain = pb.or(
            this.uncertain,
            pb.and(
              pb.lessThan(pb.add(this[`diff${j}`], this.compareTolerance), pb.neg(this.compareTolerance)),
              pb.not(this.foundHit)
            )
          );
        }
        this.$if(this.foundHit, function () {
          this.$break();
        });
        this.lastDiff = this.diff3;
      });
      this.$if(this.foundHit, function () {
        // Locate the first hit sample of the batch, then refine with a line
        // segment intersection (UE: TimeLerp = saturate(D0 / (D0 - D1))).
        this.$l.depthDiff0 = this.diff2;
        this.$l.depthDiff1 = this.diff3;
        this.$l.time0 = pb.float(3);
        this.$if(this.hit2, function () {
          this.depthDiff0 = this.diff1;
          this.depthDiff1 = this.diff2;
          this.time0 = 2;
        });
        this.$if(this.hit1, function () {
          this.depthDiff0 = this.diff0;
          this.depthDiff1 = this.diff1;
          this.time0 = 1;
        });
        this.$if(this.hit0, function () {
          this.depthDiff0 = this.lastDiff;
          this.depthDiff1 = this.diff0;
          this.time0 = 0;
        });
        this.time0 = pb.add(this.time0, this.marchBase);
        this.$l.denom = pb.sub(this.depthDiff0, this.depthDiff1);
        this.$l.timeLerp = this.$choice(
          pb.greaterThan(pb.abs(this.denom), 1e-20),
          pb.clamp(pb.div(this.depthDiff0, this.denom), 0, 1),
          pb.float(0.5)
        );
        this.$l.intersectTime = pb.add(this.time0, this.timeLerp);
        this.hitUVz = pb.add(this.rayUVz, pb.mul(this.rayStepUVz, this.intersectTime));
        this.numIterations = this.intersectTime;
      }).$else(function () {
        // No certain intersection - the march covered the whole clipped ray.
        this.hitUVz = pb.add(this.rayUVz, pb.mul(this.rayStepUVz, this.numSteps));
        this.numIterations = this.numSteps;
      });
    }
  );
  pb.func(
    giTraceOut ? 'SSR_HiZ_GI' : 'SSR_HiZ',
    [
      pb.vec3('viewPos'),
      pb.vec3('traceRay'),
      pb.mat4('viewMatrix'),
      pb.mat4('projMatrix'),
      pb.mat4('invProjMatrix'),
      pb.vec2('cameraNearFar'),
      pb.float('maxDistance'),
      pb.float('thickness'),
      pb.vec4('textureSize'),
      pb.int('maxMipLevel'),
      pb.float('maxIterations'),
      pb.float('roughness'),
      pb.float('stepOffset'),
      ...(giTraceOut ? [pb.vec3('giTrace').out()] : [])
    ],
    function () {
      if (giTraceOut) {
        this.giTrace = pb.vec3(0);
      }
      this.$l.rayDirection = pb.normalize(this.traceRay);
      this.$l.rayStartTS = pb.vec3();
      this.$l.rayStepTS = pb.vec3();
      this.$l.compareTolerance = pb.float();
      // UE uses SlopeCompareToleranceScale 4 for SSR and 2 for SSGI.
      this.SSR_initScreenSpaceRay(
        this.viewPos,
        this.rayDirection,
        this.maxDistance,
        pb.float(giTraceOut ? 2 : 4),
        this.projMatrix,
        this.rayStartTS,
        this.rayStepTS,
        this.compareTolerance
      );
      this.$l.hitUVz = pb.vec3();
      this.$l.foundHit = pb.bool();
      this.$l.uncertain = pb.bool();
      this.$l.numIterations = pb.float();
      this.SSR_castScreenSpaceRay(
        this.rayStartTS,
        this.rayStepTS,
        this.compareTolerance,
        pb.max(this.maxIterations, 4),
        this.stepOffset,
        this.roughness,
        pb.float(this.maxMipLevel),
        this.hitUVz,
        this.foundHit,
        this.uncertain,
        this.numIterations
      );
      this.$l.confidence = pb.float(0);
      const hitBranch = this.$if(this.foundHit, function () {
        this.$l.surfaceZ = this.SSR_loadDepth(this.hitUVz.xy, 0);
        this.$if(ShaderHelper.isFarthestDepth(this, this.surfaceZ), function () {
          if (giTraceOut) {
            // The intersection resolved onto a sky texel, so the ray escaped.
            this.giTrace = pb.vec3(0, 1, 0);
          }
          this.$return(pb.vec4(0));
        });
        this.$l.hit3D = invProjectPosition(this, this.hitUVz, this.invProjMatrix);
        this.confidence = validateHit(
          this,
          this.hitUVz.xy,
          this.hit3D,
          this.surfaceZ,
          this.thickness,
          this.rayStartTS.xy,
          this.rayDirection,
          this.viewMatrix,
          this.invProjMatrix,
          this.textureSize,
          normalTexture
        );
        if (giTraceOut) {
          // Keep only the thickness term of validateHit: a hit far from the
          // sampled surface may be a thin-object false positive, which is a
          // genuine geometric doubt. The border, near-self and backface vetoes
          // bound reflection artifacts and must not gate diffuse occlusion.
          this.$l.giSurfaceVS = invProjectPosition(
            this,
            pb.vec3(this.hitUVz.xy, this.surfaceZ),
            this.invProjMatrix
          );
          this.$l.giThicknessFade = pb.sub(
            1,
            pb.smoothStep(0, this.thickness, pb.distance(this.giSurfaceVS, this.hit3D))
          );
          this.giTrace = pb.vec3(1, 0, pb.mul(this.giThicknessFade, this.giThicknessFade));
        }
      });
      if (giTraceOut) {
        hitBranch.$else(function () {
          // The ray is always extended to the screen border, so a march that
          // finished without ever going behind geometry is a proven escape.
          // An uncertain march (went far behind geometry before any hit) is
          // indeterminate, not unoccluded (UE bUncertain semantics).
          this.giTrace = pb.vec3(0, pb.float(pb.not(this.uncertain)), 0);
        });
      }
      this.$l.iterationAttenuation = pb.sub(1, pb.smoothStep(0, this.maxIterations, this.numIterations));
      this.confidence = pb.mul(this.confidence, this.iterationAttenuation);
      this.$l.hitPixel = pb.mul(this.hitUVz.xy, this.textureSize.zw);
      this.$l.startPixel = pb.mul(this.rayStartTS.xy, this.textureSize.zw);
      this.$l.hitDistance = pb.length(pb.sub(this.hitPixel, this.startPixel));
      this.$return(pb.vec4(this.hitUVz.xy, this.hitDistance, this.confidence));
    }
  );
  const roughnessArg = roughness ?? 0;
  const stepOffsetArg = stepOffset ?? 0.5;
  return (
    giTraceOut
      ? scope.SSR_HiZ_GI(
          viewPos,
          traceRay,
          viewMatrix,
          projMatrix,
          invProjMatrix,
          cameraNearFar,
          maxDistance,
          thickness,
          textureSize,
          pb.sub(maxMipLevel, 1),
          maxIterations,
          roughnessArg,
          stepOffsetArg,
          giTraceOut
        )
      : scope.SSR_HiZ(
          viewPos,
          traceRay,
          viewMatrix,
          projMatrix,
          invProjMatrix,
          cameraNearFar,
          maxDistance,
          thickness,
          textureSize,
          pb.sub(maxMipLevel, 1),
          maxIterations,
          roughnessArg,
          stepOffsetArg
        )
  ) as PBShaderExp;
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
