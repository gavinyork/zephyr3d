import type { TextureFormat, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { hasDepthChannel } from '@zephyr3d/device';
import { Application } from '../app';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT } from '../values';
import { decode2HalfFromRGBA, decodeNormalizedFloatFromRGBA, encodeNormalizedFloatToRGBA } from './misc';
import { ShaderHelper } from '../material/shader/helper';
import { interleavedGradientNoise } from './noise';

/*
  const PCF_KERNEL_3x3 = [
    [0.5, 1.0, 0.5],
    [1.0, 1.0, 1.0],
    [0.5, 1.0, 0.5]
  ];
  const PCF_KERNEL_SUM_3x3 = 7;

  const PCF_KERNEL_5x5 = [
    [0.0, 0.5, 1.0, 0.5, 0.0],
    [0.5, 1.0, 1.0, 1.0, 0.5],
    [1.0, 1.0, 1.0, 1.0, 1.0],
    [0.5, 1.0, 1.0, 1.0, 0.5],
    [0.0, 0.5, 1.0, 0.5, 0.0]
  ];
  const PCF_KERNEL_SUM_5x5 = 17;

  const PCF_KERNEL_7x7 = [
    [0.0, 0.0, 0.5, 1.0, 0.5, 0.0, 0.0],
    [0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0],
    [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5],
    [0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0],
    [0.0, 0.0, 0.5, 1.0, 0.5, 0.0, 0.0]
  ];
  const PCF_KERNEL_SUM_7x7 = 33;

  const PCF_KERNEL_9x9 = [
    [0.0, 0.0, 0.0, 0.5, 1.0, 0.5, 0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0],
    [0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0],
    [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5],
    [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5],
    [0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0],
    [0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.5, 1.0, 0.5, 0.0, 0.0, 0.0]
  ];
  const PCF_KERNEL_SUM_9x9 = 53;
  */

const PCF_POISSON_DISC = [
  [0.511749, 0.547686],
  [0.58929, 0.257224],
  [0.165018, 0.57663],
  [0.407692, 0.742285],
  [0.707012, 0.646523],
  [0.31463, 0.466825],
  [0.801257, 0.485186],
  [0.418136, 0.146517],
  [0.579889, 0.0368284],
  [0.79801, 0.140114],
  [-0.0413185, 0.371455],
  [-0.0529108, 0.627352],
  [0.0821375, 0.882071],
  [0.17308, 0.301207],
  [-0.120452, 0.867216],
  [0.371096, 0.916454],
  [-0.178381, 0.146101],
  [-0.276489, 0.550525],
  [0.12542, 0.126643],
  [-0.296654, 0.286879],
  [0.261744, -0.00604975],
  [-0.213417, 0.715776],
  [0.425684, -0.153211],
  [-0.480054, 0.321357],
  [-0.0717878, -0.0250567],
  [-0.328775, -0.169666],
  [-0.394923, 0.130802],
  [-0.553681, -0.176777],
  [-0.722615, 0.120616],
  [-0.693065, 0.309017],
  [0.603193, 0.791471],
  [-0.0754941, -0.297988],
  [0.109303, -0.156472],
  [0.260605, -0.280111],
  [0.129731, -0.487954],
  [-0.537315, 0.520494],
  [-0.42758, 0.800607],
  [0.77309, -0.0728102],
  [0.908777, 0.328356],
  [0.985341, 0.0759158],
  [0.947536, -0.11837],
  [-0.103315, -0.610747],
  [0.337171, -0.584],
  [0.210919, -0.720055],
  [0.41894, -0.36769],
  [-0.254228, -0.49368],
  [-0.428562, -0.404037],
  [-0.831732, -0.189615],
  [-0.922642, 0.0888026],
  [-0.865914, 0.427795],
  [0.706117, -0.311662],
  [0.545465, -0.520942],
  [-0.695738, 0.664492],
  [0.389421, -0.899007],
  [0.48842, -0.708054],
  [0.760298, -0.62735],
  [-0.390788, -0.707388],
  [-0.591046, -0.686721],
  [-0.769903, -0.413775],
  [-0.604457, -0.502571],
  [-0.557234, 0.00451362],
  [0.147572, -0.924353],
  [-0.0662488, -0.892081],
  [0.863832, -0.4072]
];

function getShadowMapTexelSize(scope: PBInsideFunctionScope): PBShaderExp {
  return scope.$builder.div(1, ShaderHelper.getShadowCameraParams(scope).z);
}

function getShadowMapSize(scope: PBInsideFunctionScope): PBShaderExp {
  return ShaderHelper.getShadowCameraParams(scope).z;
}

/** @internal */
export function computeShadowMapDepth(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  targetFormat: TextureFormat
): PBShaderExp {
  const funcNameComputeShadowMapDepth = 'Z_computeShadowMapDepth';
  const pb = scope.$builder;
  pb.func(funcNameComputeShadowMapDepth, [pb.vec3('worldPos')], function () {
    if (hasDepthChannel(targetFormat)) {
      // use native shadowmap
      this.$return(
        pb.vec4(
          pb.emulateDepthClamp ? pb.clamp(scope.$inputs.clamppedDepth, 0, 1) : scope.$builtins.fragCoord.z,
          0,
          0,
          1
        )
      );
    } else {
      this.$l.depth = pb.float();
      this.$l.lightType = ShaderHelper.getLightTypeForShadow(this);
      this.$if(pb.equal(this.lightType, LIGHT_TYPE_DIRECTIONAL), function () {
        this.depth = pb.emulateDepthClamp
          ? pb.clamp(this.$inputs.clamppedDepth, 0, 1)
          : this.$builtins.fragCoord.z;
      })
        .$elseif(pb.equal(this.lightType, LIGHT_TYPE_POINT), function () {
          this.$l.lightSpacePos = pb.mul(
            ShaderHelper.getLightViewMatrixForShadow(this),
            pb.vec4(this.worldPos, 1)
          );
          this.depth = pb.clamp(
            pb.div(pb.length(this.lightSpacePos.xyz), ShaderHelper.getLightPositionAndRangeForShadow(this).w),
            0,
            1
          );
        })
        .$else(function () {
          this.$l.lightSpacePos = pb.mul(
            ShaderHelper.getLightViewMatrixForShadow(this),
            pb.vec4(this.worldPos, 1)
          );
          this.depth = pb.clamp(
            pb.div(pb.neg(this.lightSpacePos.z), ShaderHelper.getLightPositionAndRangeForShadow(this).w),
            0,
            1
          );
        });
      this.$return(
        targetFormat === 'rgba8unorm'
          ? encodeNormalizedFloatToRGBA(this, this.depth)
          : pb.vec4(this.depth, 0, 0, 1)
      );
    }
  });
  return pb.getGlobalScope()[funcNameComputeShadowMapDepth](worldPos);
}

/** @internal */
export function computeReceiverPlaneDepthBias(
  scope: PBInsideFunctionScope,
  texCoord: PBShaderExp
): PBShaderExp {
  const funcNameComputeReceiverPlaneDepthBias = 'lib_computeReceiverPlaneDepthBias';
  const pb = scope.$builder;
  pb.func(funcNameComputeReceiverPlaneDepthBias, [pb.vec4('coords')], function () {
    this.$l.dx = pb.dpdx(this.coords);
    this.$l.dy = pb.dpdy(this.coords);
    this.$l.biasMultiply = pb.float(1);
    this.$l.uv = pb.vec2(
      pb.sub(pb.mul(this.dy.y, this.dx.z), pb.mul(this.dx.y, this.dy.z)),
      pb.sub(pb.mul(this.dx.x, this.dy.z), pb.mul(this.dy.x, this.dx.z))
    );
    this.$l.uv = pb.mul(
      this.$l.uv,
      pb.div(this.biasMultiply, pb.sub(pb.mul(this.dx.x, this.dy.y), pb.mul(this.dx.y, this.dy.x)))
    );
    // from unity shader
    this.$l.minFractionalError = pb.float(0.01);
    this.$l.fractionalSamplingError = pb.dot(pb.vec2(getShadowMapTexelSize(this)), pb.abs(this.$l.uv));
    this.$l.staticBias = pb.min(this.$l.fractionalSamplingError, this.$l.minFractionalError);
    // return
    this.$return(pb.vec3(this.$l.uv, this.$l.staticBias));
  });
  return pb.getGlobalScope()[funcNameComputeReceiverPlaneDepthBias](texCoord);
}

function getRandomRotationMatrix(scope: PBInsideFunctionScope, fragCoord: PBShaderExp): PBShaderExp {
  const funcNameGetRandomRotationMatrix = 'lib_getRandomRotationMatrix';
  const pb = scope.$builder;
  pb.func(funcNameGetRandomRotationMatrix, [pb.vec2('fragCoord')], function () {
    this.$l.randomAngle = pb.mul(interleavedGradientNoise(this, fragCoord), 2 * Math.PI);
    this.$l.randomBase = pb.vec2(pb.cos(this.randomAngle), pb.sin(this.randomAngle));
    this.$return(pb.mat2(this.randomBase.x, this.randomBase.y, pb.neg(this.randomBase.y), this.randomBase.x));
  });
  return pb.getGlobalScope()[funcNameGetRandomRotationMatrix](fragCoord);
}

function getPoissonDiscSampleRadius(scope: PBInsideFunctionScope): PBShaderExp {
  return ShaderHelper.getDepthBiasValues(scope).z;
}

function sampleShadowMapPCF(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  offset: PBShaderExp,
  depth: PBShaderExp,
  cascade?: PBShaderExp
): PBShaderExp {
  const funcName = cascade ? 'lib_sampleShadowMapCascadePCF' : 'lib_sampleShadowMapPCF';
  const pb = scope.$builder;
  const nativeShadowMap = hasDepthChannel(shadowMapFormat);
  pb.func(
    funcName,
    [pb.vec2('coords'), pb.float('z'), pb.vec2('offset'), ...(cascade ? [pb.int('cascade')] : [])],
    function () {
      const sampleDepth = this.z;
      const uv = pb.add(this.coords, this.offset);
      if (nativeShadowMap) {
        this.$return(
          cascade && Application.instance.device.type !== 'webgl'
            ? pb.textureArraySampleCompareLevel(
                ShaderHelper.getShadowMap(this),
                uv,
                this.cascade,
                sampleDepth
              )
            : pb.textureSampleCompareLevel(ShaderHelper.getShadowMap(this), uv, sampleDepth)
        );
      } else {
        this.$l.shadowTex =
          cascade && Application.instance.device.type !== 'webgl'
            ? pb.textureArraySampleLevel(ShaderHelper.getShadowMap(this), uv, this.cascade, 0)
            : pb.textureSampleLevel(ShaderHelper.getShadowMap(this), uv, 0);
        if (shadowMapFormat === 'rgba8unorm') {
          this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
        }
        this.$return(pb.step(sampleDepth, this.shadowTex.x));
      }
    }
  );
  return pb.getGlobalScope()[funcName](pos, depth, offset, ...(cascade ? [cascade] : []));
}

function sampleShadowMap(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  depth: PBShaderExp,
  cascade?: PBShaderExp
): PBShaderExp {
  const funcNameSampleShadowMap = 'lib_sampleShadowMap';
  const pb = scope.$builder;
  const nativeShadowMap = hasDepthChannel(shadowMapFormat);
  pb.func(
    funcNameSampleShadowMap,
    [
      lightType === LIGHT_TYPE_POINT ? pb.vec3('coords') : pb.vec2('coords'),
      pb.float('z'),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      if (lightType === LIGHT_TYPE_POINT) {
        if (nativeShadowMap) {
          this.$return(
            pb.clamp(pb.textureSampleCompareLevel(ShaderHelper.getShadowMap(this), this.coords, this.z), 0, 1)
          );
        } else {
          this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.coords, 0);
          if (shadowMapFormat === 'rgba8unorm') {
            this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
          }
          this.$return(pb.step(this.z, this.shadowTex.x));
        }
      } else {
        if (nativeShadowMap) {
          this.$return(
            cascade && Application.instance.device.type !== 'webgl'
              ? pb.textureArraySampleCompareLevel(
                  ShaderHelper.getShadowMap(this),
                  this.coords,
                  this.cascade,
                  this.z
                )
              : pb.textureSampleCompareLevel(ShaderHelper.getShadowMap(this), this.coords, this.z)
          );
        } else {
          this.$l.shadowTex =
            cascade && Application.instance.device.type !== 'webgl'
              ? pb.textureArraySampleLevel(ShaderHelper.getShadowMap(this), this.coords, this.cascade, 0)
              : pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.coords, 0);
          if (shadowMapFormat === 'rgba8unorm') {
            this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
          }
          this.$return(pb.step(this.z, this.shadowTex.x));
        }
      }
    }
  );
  return cascade
    ? pb.getGlobalScope()[funcNameSampleShadowMap](pos, depth, cascade)
    : pb.getGlobalScope()[funcNameSampleShadowMap](pos, depth);
}

function chebyshevUpperBound(
  scope: PBInsideFunctionScope,
  distance: PBShaderExp,
  occluder: PBShaderExp
): PBShaderExp {
  const funcNameChebyshevUpperBound = 'lib_chebyshevUpperBound';
  const pb = scope.$builder;
  pb.func(funcNameChebyshevUpperBound, [pb.float('distance'), pb.vec2('occluder')], function () {
    this.$l.shadow = pb.float(1);
    this.$l.test = pb.step(this.distance, this.occluder.x);
    this.$if(pb.notEqual(this.test, 1), function () {
      this.$l.d = pb.sub(this.distance, this.occluder.x);
      this.$l.variance = pb.max(pb.mul(this.occluder.y, this.occluder.y), 0);
      const darkness = ShaderHelper.getDepthBiasValues(this).z;
      this.shadow = pb.div(this.variance, pb.add(this.variance, pb.mul(this.d, this.d)));
      this.shadow = pb.clamp(pb.div(pb.sub(this.shadow, darkness), pb.sub(1, darkness)), 0, 1);
    });
    this.$return(this.shadow);
  });
  return pb.getGlobalScope()[funcNameChebyshevUpperBound](distance, occluder);
}

/** @internal */
export function filterShadowVSM(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  texCoord: PBShaderExp,
  cascade?: PBShaderExp
): PBShaderExp {
  const funcNameFilterShadowVSM = 'lib_filterShadowVSM';
  const pb = scope.$builder;
  pb.func(
    funcNameFilterShadowVSM,
    [pb.vec4('texCoord'), ...(cascade ? [pb.int('cascade')] : [])],
    function () {
      if (lightType === LIGHT_TYPE_POINT) {
        this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.texCoord.xyz, 0);
        this.$return(
          chebyshevUpperBound(
            this,
            this.texCoord.w,
            shadowMapFormat === 'rgba8unorm' ? decode2HalfFromRGBA(this, this.shadowTex) : this.shadowTex.rg
          )
        );
      } else {
        if (Application.instance.device.type !== 'webgl' && cascade) {
          this.$l.shadowTex = pb.textureArraySampleLevel(
            ShaderHelper.getShadowMap(this),
            this.texCoord.xy,
            this.cascade,
            0
          );
        } else {
          this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.texCoord.xy, 0);
        }
        this.$return(
          chebyshevUpperBound(
            this,
            this.texCoord.z,
            shadowMapFormat === 'rgba8unorm' ? decode2HalfFromRGBA(this, this.shadowTex) : this.shadowTex.rg
          )
        );
      }
    }
  );
  return pb.getGlobalScope()[funcNameFilterShadowVSM](texCoord, ...(cascade ? [cascade] : []));
}

/** @internal */
export function filterShadowESM(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  shadowVertex: PBShaderExp,
  cascade?: PBShaderExp
): PBShaderExp {
  const funcNameFilterShadowESM = 'lib_filterShadowESM';
  const pb = scope.$builder;
  pb.func(
    funcNameFilterShadowESM,
    [
      lightType === LIGHT_TYPE_POINT ? pb.vec3('shadowVertex') : pb.vec4('shadowVertex'),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      if (lightType === LIGHT_TYPE_POINT) {
        this.$l.depth = pb.div(
          pb.length(this.shadowVertex.xyz),
          ShaderHelper.getLightPositionAndRangeForShadow(this).w
        );
        this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.shadowVertex.xyz, 0);
        if (shadowMapFormat === 'rgba8unorm') {
          this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
        }
      } else {
        if (cascade && Application.instance.device.type !== 'webgl') {
          this.$l.shadowTex = pb.textureArraySampleLevel(
            ShaderHelper.getShadowMap(this),
            this.shadowVertex.xy,
            this.cascade,
            0
          );
        } else {
          this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.shadowVertex.xy, 0);
        }
        if (shadowMapFormat === 'rgba8unorm') {
          this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
        }
        if (lightType === LIGHT_TYPE_SPOT) {
          this.$l.nearFar = ShaderHelper.getShadowCameraParams(this).xy;
          this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(
            this,
            this.shadowVertex.z,
            this.nearFar
          );
        } else {
          this.$l.depth = this.shadowVertex.z;
        }
      }
      const depthScale = ShaderHelper.getDepthBiasValues(this).z;
      this.$return(
        pb.clamp(pb.exp(pb.min(87, pb.mul(depthScale, pb.sub(this.shadowTex.x, this.depth)))), 0, 1)
      );
    }
  );
  return pb.getGlobalScope()[funcNameFilterShadowESM](shadowVertex, ...(cascade ? [cascade] : []));
}

/** @internal */
export function filterShadowPCF(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  kernelSize: number,
  texCoord: PBShaderExp,
  receiverPlaneDepthBias?: PBShaderExp,
  cascade?: PBShaderExp
): PBShaderExp {
  const funcNameFilterShadowPCF = `lib_filterShadowPCF${kernelSize}x${kernelSize}`;
  const pb = scope.$builder;
  pb.func(
    funcNameFilterShadowPCF,
    [
      pb.vec4('texCoord'),
      ...(receiverPlaneDepthBias ? [pb.vec3('receiverPlaneDepthBias')] : []),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      this.$l.lightDepth = this.texCoord.z;
      if (receiverPlaneDepthBias) {
        this.lightDepth = pb.sub(this.lightDepth, this.receiverPlaneDepthBias.z);
      }
      const shadowMapTexelSize = getShadowMapTexelSize(this);
      this.$l.uv = pb.add(pb.mul(this.texCoord.xy, pb.vec2(getShadowMapSize(this))), pb.vec2(0));
      this.$l.st = pb.fract(this.uv);
      this.$l.baseUV = pb.sub(pb.floor(this.uv), pb.vec2(0.5));
      this.baseUV = pb.mul(this.baseUV, shadowMapTexelSize);
      this.$l.shadow = pb.float(0);
      if (kernelSize === 3) {
        this.$l.uvw0 = pb.sub(pb.vec2(3), pb.mul(2, this.st));
        this.$l.uvw1 = pb.add(pb.vec2(1), pb.mul(2, this.st));
        this.$l.u = pb.mul(
          pb.vec2(
            pb.sub(pb.div(pb.sub(2, this.st.x), this.uvw0.x), 1),
            pb.add(pb.div(this.st.x, this.uvw1.x), 1)
          ),
          shadowMapTexelSize
        );
        this.$l.v = pb.mul(
          pb.vec2(
            pb.sub(pb.div(pb.sub(2, this.st.y), this.uvw0.y), 1),
            pb.add(pb.div(this.st.y, this.uvw1.y), 1)
          ),
          shadowMapTexelSize
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.x, this.v.x),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.y, this.v.x),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.x, this.v.y),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.y, this.v.y),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.div(this.shadow, 16);
      } else if (kernelSize === 5) {
        this.$l.uvw0 = pb.sub(pb.vec2(4), pb.mul(this.st, 3));
        this.$l.uvw1 = pb.vec2(7);
        this.$l.uvw2 = pb.add(pb.vec2(1), pb.mul(this.st, 3));
        this.$l.u = pb.mul(
          pb.vec3(
            pb.sub(pb.div(pb.sub(3, pb.mul(this.st.x, 2)), this.uvw0.x), 2),
            pb.div(pb.add(this.st.x, 3), this.uvw1.x),
            pb.add(pb.div(this.st.x, this.uvw2.x), 2)
          ),
          shadowMapTexelSize
        );
        this.$l.v = pb.mul(
          pb.vec3(
            pb.sub(pb.div(pb.sub(3, pb.mul(this.st.y, 2)), this.uvw0.y), 2),
            pb.div(pb.add(this.st.y, 3), this.uvw1.y),
            pb.add(pb.div(this.st.y, this.uvw2.y), 2)
          ),
          shadowMapTexelSize
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.x, this.v.x),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.y, this.v.x),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.z, this.v.x),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.x, this.v.y),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.y, this.v.y),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.z, this.v.y),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.x, this.v.z),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.y, this.v.z),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.vec2(this.u.z, this.v.z),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.div(this.shadow, 144);
      } else if (kernelSize === 7) {
        this.$l.uvw0 = pb.sub(pb.mul(this.st, 5), pb.vec2(6));
        this.$l.uvw1 = pb.sub(pb.mul(this.st, 11), pb.vec2(28));
        this.$l.uvw2 = pb.sub(pb.mul(this.st, -11), pb.vec2(17));
        this.$l.uvw3 = pb.sub(pb.mul(this.st, -5), 1);
        this.$l.u = pb.vec4(
          pb.sub(pb.div(pb.sub(pb.mul(this.st.x, 4), 5), this.uvw0.x), 3),
          pb.sub(pb.div(pb.sub(pb.mul(this.st.x, 4), 16), this.uvw1.x), 1),
          pb.add(pb.div(pb.sub(pb.mul(this.st.x, -7), 5), this.uvw2.x), 1),
          pb.add(pb.div(pb.neg(this.st.x), this.uvw3.x), 3)
        );
        this.$l.v = pb.vec4(
          pb.sub(pb.div(pb.sub(pb.mul(this.st.y, 4), 5), this.uvw0.y), 3),
          pb.sub(pb.div(pb.sub(pb.mul(this.st.y, 4), 16), this.uvw1.y), 1),
          pb.add(pb.div(pb.sub(pb.mul(this.st.y, -7), 5), this.uvw2.y), 1),
          pb.add(pb.div(pb.neg(this.st.y), this.uvw3.y), 3)
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.x, this.v.x), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.y, this.v.x), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.z, this.v.x), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.w, this.v.x), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw3.x,
            this.uvw0.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.x, this.v.y), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.y, this.v.y), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.z, this.v.y), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.w, this.v.y), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw3.x,
            this.uvw1.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.x, this.v.z), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.y, this.v.z), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.z, this.v.z), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.w, this.v.z), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw3.x,
            this.uvw2.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.x, this.v.w), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw0.x,
            this.uvw3.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.y, this.v.w), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw1.x,
            this.uvw3.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.z, this.v.w), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw2.x,
            this.uvw3.y
          )
        );
        this.shadow = pb.add(
          this.shadow,
          pb.mul(
            sampleShadowMapPCF(
              this,
              shadowMapFormat,
              this.baseUV,
              pb.mul(pb.vec2(this.u.w, this.v.w), shadowMapTexelSize),
              this.lightDepth,
              this.cascade
            ),
            this.uvw3.x,
            this.uvw3.y
          )
        );
        this.shadow = pb.div(this.shadow, 2704);
      }
      this.$return(this.shadow);
    }
  );
  return pb
    .getGlobalScope()
    [funcNameFilterShadowPCF](
      texCoord,
      ...(receiverPlaneDepthBias ? [receiverPlaneDepthBias] : []),
      ...(cascade ? [cascade] : [])
    );
}

/** @internal */
export function filterShadowPoissonDisc(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  tapCount: number,
  texCoord: PBShaderExp,
  receiverPlaneDepthBias?: PBShaderExp,
  cascade?: PBShaderExp
): PBShaderExp {
  const funcNameFilterShadowPoissonDisc = 'lib_filterShadowPoissonDisc';
  const pb = scope.$builder;
  pb.func(
    funcNameFilterShadowPoissonDisc,
    [
      pb.vec4('texCoord'),
      ...(receiverPlaneDepthBias ? [pb.vec3('receiverPlaneDepthBias')] : []),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      this.$l.lightDepth = this.texCoord.z;
      if (receiverPlaneDepthBias) {
        this.lightDepth = pb.sub(this.lightDepth, this.receiverPlaneDepthBias.z);
      }
      this.$l.duv = pb.vec2();
      this.$l.filterRadius = pb.mul(getShadowMapTexelSize(this), getPoissonDiscSampleRadius(this));
      this.$l.matrix = getRandomRotationMatrix(this, this.$builtins.fragCoord.xy);
      this.$l.shadow = pb.float(0);
      for (let i = 0; i < tapCount; i++) {
        this.duv = pb.mul(
          this.matrix,
          pb.mul(pb.vec2(PCF_POISSON_DISC[i][0], PCF_POISSON_DISC[i][1]), this.filterRadius)
        );
        const sampleDepth = receiverPlaneDepthBias
          ? pb.add(this.lightDepth, pb.dot(this.duv, this.receiverPlaneDepthBias.xy))
          : this.lightDepth;
        this.shadow = pb.add(
          this.shadow,
          sampleShadowMap(
            this,
            lightType,
            shadowMapFormat,
            pb.add(this.texCoord.xy, this.duv),
            sampleDepth,
            this.cascade
          )
        );
      }
      this.shadow = pb.div(this.shadow, tapCount);
      this.$return(this.shadow);
    }
  );
  return pb
    .getGlobalScope()
    [funcNameFilterShadowPoissonDisc](
      texCoord,
      ...(receiverPlaneDepthBias ? [receiverPlaneDepthBias] : []),
      ...(cascade ? [cascade] : [])
    );
}
