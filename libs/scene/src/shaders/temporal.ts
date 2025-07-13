import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

export const TAA_DEBUG_NONE = 0;
export const TAA_DEBUG_CURRENT_COLOR = 1;
export const TAA_DEBUG_HISTORY_COLOR = 2;
export const TAA_DEBUG_VELOCITY = 3;
export const TAA_DEBUG_EDGE = 4;
export const TAA_DEBUG_ALAPH = 5;
export const TAA_DEBUG_MOTION_VECTOR = 6;
export const TAA_DEBUG_STRENGTH = 7;

const FLT_MIN = 0.00000001;
const FLT_MAX = 32767;

export function temporalResolve(
  scope: PBInsideFunctionScope,
  currentColorTex: PBShaderExp,
  historyColorTex: PBShaderExp,
  currentDepthTex: PBShaderExp,
  motionVectorTex: PBShaderExp,
  prevMotionVectorTex: PBShaderExp,
  uv: PBShaderExp,
  workSize: PBShaderExp,
  bf: PBShaderExp,
  debug = TAA_DEBUG_NONE
): PBShaderExp {
  const pb = scope.$builder;
  pb.func('getClosestVelocity', [pb.vec2('uv'), pb.vec2('texSize')], function () {
    this.$l.minDepth = pb.float(1);
    this.$l.closestUV = this.uv;
    this.$l.tmpDepth = pb.float();
    this.$l.tmpUV = pb.vec2();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        this.tmpUV = pb.add(this.uv, pb.div(pb.vec2(i, j), this.texSize));
        this.tmpDepth = pb.textureSampleLevel(currentDepthTex, this.tmpUV, 0).r;
        this.$if(pb.lessThan(this.tmpDepth, this.minDepth), function () {
          this.minDepth = this.tmpDepth;
          this.closestUV = this.tmpUV;
        });
      }
    }
    this.$l.motionVector = pb.textureSampleLevel(motionVectorTex, this.closestUV, 0);
    this.$return(this.motionVector.xyz);
  });
  pb.func('clipAABB', [pb.vec3('aabbMin'), pb.vec3('aabbMax'), pb.vec3('p'), pb.vec3('q')], function () {
    this.$l.r = pb.sub(this.q, this.p);
    this.$l.rMax = pb.sub(this.aabbMax, this.p);
    this.$l.rMin = pb.sub(this.aabbMin, this.p);
    this.$if(pb.greaterThan(this.r.x, pb.add(this.rMax.x, FLT_MIN)), function () {
      this.r = pb.mul(this.r, pb.div(this.rMax.x, this.r.x));
    });
    this.$if(pb.greaterThan(this.r.y, pb.add(this.rMax.y, FLT_MIN)), function () {
      this.r = pb.mul(this.r, pb.div(this.rMax.y, this.r.y));
    });
    this.$if(pb.greaterThan(this.r.z, pb.add(this.rMax.z, FLT_MIN)), function () {
      this.r = pb.mul(this.r, pb.div(this.rMax.z, this.r.z));
    });
    this.$if(pb.lessThan(this.r.x, pb.sub(this.rMin.x, FLT_MIN)), function () {
      this.r = pb.mul(this.r, pb.div(this.rMin.x, this.r.x));
    });
    this.$if(pb.lessThan(this.r.y, pb.sub(this.rMin.y, FLT_MIN)), function () {
      this.r = pb.mul(this.r, pb.div(this.rMin.y, this.r.y));
    });
    this.$if(pb.lessThan(this.r.z, pb.sub(this.rMin.z, FLT_MIN)), function () {
      this.r = pb.mul(this.r, pb.div(this.rMin.z, this.r.z));
    });
    this.$return(pb.add(this.p, this.r));
  });
  pb.func(
    'clipHistoryColor',
    [pb.vec2('uv'), pb.vec3('historyColor'), pb.vec2('closestVelocity'), pb.vec2('texSize')],
    function () {
      let n = 1;
      this.$l.colorAvg = pb.vec3(0);
      this.$l.colorAvg2 = pb.vec3(0);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          this.$l[`s${n}`] = pb.textureSampleLevel(
            currentColorTex,
            pb.add(this.uv, pb.div(pb.vec2(i, j), this.texSize)),
            0
          ).rgb;
          this.colorAvg = pb.add(this.colorAvg, this[`s${n}`]);
          this.colorAvg2 = pb.add(this.colorAvg2, pb.mul(this[`s${n}`], this[`s${n}`]));
          n++;
        }
      }
      this.colorAvg = pb.div(this.colorAvg, n - 1);
      this.colorAvg2 = pb.div(this.colorAvg2, n - 1);
      this.$l.boxSize = pb.mix(2.5, 0, pb.smoothStep(0, 0.02, pb.length(this.closestVelocity)));
      this.$l.dev = pb.mul(
        pb.sqrt(pb.abs(pb.sub(this.colorAvg2, pb.mul(this.colorAvg, this.colorAvg)))),
        this.boxSize
      );
      this.$l.colorMin = pb.sub(this.colorAvg, this.dev);
      this.$l.colorMax = pb.add(this.colorAvg, this.dev);
      this.$l.color = this.clipAABB(
        this.colorMin,
        this.colorMax,
        pb.clamp(this.colorAvg, this.colorMin, this.colorMax),
        this.historyColor
      );
      this.color = pb.clamp(this.color, pb.vec3(FLT_MIN), pb.vec3(FLT_MAX));
      this.$return(this.color);
    }
  );
  pb.func('reinhard', [pb.vec3('hdr')], function () {
    this.$return(pb.div(this.hdr, pb.add(this.hdr, pb.vec3(1))));
  });
  pb.func('reinhardInv', [pb.vec3('sdr')], function () {
    this.$return(pb.div(this.sdr, pb.sub(pb.vec3(1), this.sdr)));
  });
  pb.func('luminance', [pb.vec3('color')], function () {
    this.$return(pb.max(pb.dot(this.color, pb.vec3(0.299, 0.587, 0.114)), 0.0001));
  });
  pb.func('getDisocclusionFactor', [pb.vec2('uv'), pb.vec2('velocity'), pb.vec2('texSize')], function () {
    this.$l.prevVelocitySample = pb.textureSampleLevel(prevMotionVectorTex, this.uv, 0);
    this.$l.prevVelocity = this.prevVelocitySample.xy;
    this.$l.disocclusion = pb.sub(
      pb.length(pb.mul(pb.sub(this.velocity, this.prevVelocity), this.texSize)),
      2.5
    );
    this.$return(pb.clamp(pb.mul(this.disocclusion, 0.01), 0, 1));
  });
  pb.func('sampleHistoryColorCatmulRom9', [pb.vec2('uv'), pb.vec2('texSize')], function () {
    this.$l.samplePos = pb.mul(this.uv, this.texSize);
    this.$l.texPos1 = pb.add(pb.floor(pb.sub(this.samplePos, pb.vec2(0.5))), pb.vec2(0.5));
    this.$l.f = pb.sub(this.samplePos, this.texPos1);
    this.$l.w0 = pb.mul(
      this.f,
      pb.sub(pb.mul(this.f, pb.sub(pb.vec2(1), pb.mul(this.f, 0.5))), pb.vec2(0.5))
    );
    this.$l.w1 = pb.add(pb.vec2(1), pb.mul(this.f, this.f, pb.sub(pb.mul(this.f, 1.5), pb.vec2(2.5))));
    this.$l.w2 = pb.mul(
      this.f,
      pb.add(pb.vec2(0.5), pb.mul(this.f, pb.sub(pb.vec2(2), pb.mul(this.f, 1.5))))
    );
    this.$l.w3 = pb.mul(this.f, this.f, pb.sub(pb.mul(this.f, 0.5), pb.vec2(0.5)));
    this.$l.w12 = pb.add(this.w1, this.w2);
    this.$l.offset12 = pb.div(this.w2, pb.add(this.w1, this.w2));
    this.$l.texPos0 = pb.sub(this.texPos1, pb.vec2(1));
    this.$l.texPos3 = pb.add(this.texPos1, pb.vec2(2));
    this.$l.texPos12 = pb.add(this.texPos1, this.offset12);
    this.texPos0 = pb.div(this.texPos0, this.texSize);
    this.texPos3 = pb.div(this.texPos3, this.texSize);
    this.texPos12 = pb.div(this.texPos12, this.texSize);
    this.$l.result = pb.vec3(0);
    this.result = pb.add(
      this.result,
      pb.mul(pb.textureSampleLevel(historyColorTex, this.texPos0, 0).rgb, this.w0.x, this.w0.y)
    );
    this.result = pb.add(
      this.result,
      pb.mul(
        pb.textureSampleLevel(historyColorTex, pb.vec2(this.texPos12.x, this.texPos0.y), 0).rgb,
        this.w12.x,
        this.w0.y
      )
    );
    this.result = pb.add(
      this.result,
      pb.mul(
        pb.textureSampleLevel(historyColorTex, pb.vec2(this.texPos3.x, this.texPos0.y), 0).rgb,
        this.w3.x,
        this.w0.y
      )
    );
    this.result = pb.add(
      this.result,
      pb.mul(
        pb.textureSampleLevel(historyColorTex, pb.vec2(this.texPos0.x, this.texPos12.y), 0).rgb,
        this.w0.x,
        this.w12.y
      )
    );
    this.result = pb.add(
      this.result,
      pb.mul(pb.textureSampleLevel(historyColorTex, this.texPos12, 0).rgb, this.w12.x, this.w12.y)
    );
    this.result = pb.add(
      this.result,
      pb.mul(
        pb.textureSampleLevel(historyColorTex, pb.vec2(this.texPos3.x, this.texPos12.y), 0).rgb,
        this.w3.x,
        this.w12.y
      )
    );
    this.result = pb.add(
      this.result,
      pb.mul(
        pb.textureSampleLevel(historyColorTex, pb.vec2(this.texPos0.x, this.texPos3.y), 0).rgb,
        this.w0.x,
        this.w3.y
      )
    );
    this.result = pb.add(
      this.result,
      pb.mul(
        pb.textureSampleLevel(historyColorTex, pb.vec2(this.texPos12.x, this.texPos3.y), 0).rgb,
        this.w12.x,
        this.w3.y
      )
    );
    this.result = pb.add(
      this.result,
      pb.mul(pb.textureSampleLevel(historyColorTex, this.texPos3, 0).rgb, this.w3.x, this.w3.y)
    );
    this.$return(pb.max(this.result, pb.vec3(0)));
  });
  pb.func('temporalResolve', [pb.vec2('screenUV'), pb.vec2('texSize'), pb.float('bf')], function () {
    this.$l.velocitySample = pb.textureSampleLevel(motionVectorTex, this.screenUV, 0);
    this.$l.velocity = this.velocitySample.xy;
    this.$l.sampleColor = pb.textureSampleLevel(currentColorTex, this.screenUV, 0).rgb;
    this.$if(
      pb.and(pb.greaterThanEqual(this.velocity.x, 5e4), pb.greaterThanEqual(this.velocity.y, 5e4)),
      function () {
        this.$return(this.sampleColor);
      }
    );
    this.$l.reprojectedUV = pb.sub(this.screenUV, this.velocity);
    //this.$l.historyColor = pb.textureSampleLevel(historyColorTex, this.reprojectedUV, 0).rgb;
    this.$l.historyColor = this.sampleHistoryColorCatmulRom9(this.reprojectedUV, this.texSize);
    this.$l.velocityClosest = this.getClosestVelocity(this.screenUV, this.texSize);
    this.$l.blendFactor = pb.div(this.velocityClosest.z, 50000);
    this.prevColor = this.clipHistoryColor(
      this.screenUV,
      this.historyColor,
      this.velocityClosest.xy,
      this.texSize
    );
    this.$l.screenFactor = this.$choice(
      pb.or(
        pb.any(pb.lessThan(this.reprojectedUV, pb.vec2(0))),
        pb.any(pb.greaterThan(this.reprojectedUV, pb.vec2(1)))
      ),
      pb.float(1),
      pb.float(0)
    );
    this.$l.disocclusionFactor = this.getDisocclusionFactor(this.reprojectedUV, this.velocity, this.texSize);
    this.$l.alpha = pb.clamp(pb.add(this.blendFactor, this.screenFactor, this.disocclusionFactor), 0, 1);
    this.prevColor = this.reinhard(this.prevColor);
    this.currentColor = this.reinhard(this.sampleColor);
    this.$l.currentLum = this.luminance(this.currentColor);
    this.$l.prevLum = this.luminance(this.prevColor);
    this.$l.diff = pb.div(
      pb.abs(pb.sub(this.currentLum, this.prevLum)),
      pb.max(this.currentLum, pb.max(this.prevLum, 1.001))
    );
    this.diff = pb.sub(1, this.diff);
    this.diff = pb.mul(this.diff, this.diff);
    this.alpha = pb.mix(0, this.alpha, this.diff);
    this.$l.resolvedColor = pb.vec3();
    if (debug === TAA_DEBUG_CURRENT_COLOR) {
      this.resolvedColor = this.currentColor.rgb;
      this.resolvedColor = this.reinhardInv(this.resolvedColor);
    } else if (debug === TAA_DEBUG_HISTORY_COLOR) {
      this.resolvedColor = this.prevColor.rgb;
      this.resolvedColor = this.reinhardInv(this.resolvedColor);
    } else if (debug === TAA_DEBUG_EDGE) {
      this.resolvedColor = pb.vec3(this.screenFactor);
    } else if (debug === TAA_DEBUG_ALAPH) {
      this.resolvedColor = pb.vec3(this.alpha);
    } else if (debug === TAA_DEBUG_VELOCITY) {
      this.resolvedColor = pb.abs(pb.sub(this.sampleColor, this.historyColor));
    } else if (debug === TAA_DEBUG_MOTION_VECTOR) {
      this.resolvedColor = pb.abs(pb.mul(this.velocityClosest, 20));
    } else if (debug === TAA_DEBUG_STRENGTH) {
      this.resolvedColor = pb.vec3(this.blendFactor);
    } else {
      this.resolvedColor = pb.mix(this.prevColor.rgb, this.currentColor.rgb, this.alpha);
      this.resolvedColor = this.reinhardInv(this.resolvedColor);
    }
    this.$return(this.resolvedColor);
  });
  return scope.temporalResolve(uv, workSize, bf);
}
