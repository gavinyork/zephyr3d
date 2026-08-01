import type { TextureFormat, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { hasDepthChannel } from '@zephyr3d/device';
import { DEPTH_FARTHEST, REVERSE_Z } from '@zephyr3d/base';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_RECT, LIGHT_TYPE_SPOT } from '../values';
import { decode2HalfFromRGBA, decodeNormalizedFloatFromRGBA, encodeNormalizedFloatToRGBA } from './misc';
import { ShaderHelper } from '../material/shader/helper';
import { smoothNoise3D } from './noise';
import { getDevice } from '../app/api';

/**
 * Whether the shadow-space depth compared by a filter is the device depth
 * (direction flips under reverse-Z) or a linear distance encoding
 * (direction independent). Directional/rect receivers use the light
 * projection device depth; point uses distance/range and spot a linear
 * view-depth encoding.
 * @internal
 */
export function isDeviceDepthShadow(lightType: number): boolean {
  return lightType !== LIGHT_TYPE_POINT && lightType !== LIGHT_TYPE_SPOT;
}

/**
 * Maps the shadow-space NDC position to shadow map coordinates: xy to
 * [0, 1] texture space, depth to the device depth range. Under standard-Z
 * all components map from GL [-1, 1]; under reverse-Z the depth is already
 * zero-to-one and passes through.
 * @internal
 */
export function ndcToShadowCoord(scope: PBInsideFunctionScope, ndc: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  return REVERSE_Z
    ? pb.vec4(pb.add(pb.mul(ndc.xy, 0.5), pb.vec2(0.5)), ndc.z, ndc.w)
    : pb.add(pb.mul(ndc, 0.5), 0.5);
}

/**
 * vec3 variant of {@link ndcToShadowCoord}.
 * @internal
 */
export function ndcToShadowCoord3(scope: PBInsideFunctionScope, ndc: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  return REVERSE_Z
    ? pb.vec3(pb.add(pb.mul(ndc.xy, 0.5), pb.vec2(0.5)), ndc.z)
    : pb.add(pb.mul(ndc, 0.5), 0.5);
}

/**
 * Whether a shadow map device depth lies within the far bound of the
 * shadow projection ("not beyond the shadow far plane").
 * @internal
 */
export function shadowCoordDepthInRange(scope: PBInsideFunctionScope, z: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  return REVERSE_Z ? pb.greaterThanEqual(z, 0) : pb.lessThanEqual(z, 1);
}

/**
 * Applies a depth bias that moves the receiver towards the light in the
 * encoding of the compared shadow depth.
 * @internal
 */
export function applyShadowDepthBias(
  scope: PBInsideFunctionScope,
  z: PBShaderExp,
  bias: PBShaderExp,
  deviceEncoded: boolean
): PBShaderExp {
  const pb = scope.$builder;
  return REVERSE_Z && deviceEncoded ? pb.add(z, bias) : pb.sub(z, bias);
}

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

function getPCSSRotationMatrix(
  scope: PBInsideFunctionScope,
  sampleCoord: PBShaderExp,
  temporalJitter: boolean
) {
  const funcName = `lib_getPCSSRotationMatrix_${temporalJitter ? 1 : 0}`;
  const pb = scope.$builder;
  pb.func(funcName, [pb.vec2('sampleCoord')], function () {
    if (temporalJitter) {
      this.$l.frame = pb.mod(pb.float(ShaderHelper.getFramestamp(this)), 64);
      this.$l.randomAngle = pb.mul(
        smoothNoise3D(this, pb.vec3(pb.mul(this.sampleCoord, 0.35), pb.mul(this.frame, 0.61803398875))),
        2 * Math.PI
      );
      this.$l.randomBase = pb.vec2(pb.cos(this.randomAngle), pb.sin(this.randomAngle));
      this.$return(
        pb.mat2(this.randomBase.x, this.randomBase.y, pb.neg(this.randomBase.y), this.randomBase.x)
      );
    } else {
      this.$return(pb.mat2(0.8660254, 0.5, -0.5, 0.8660254));
    }
  });
  return pb.getGlobalScope()[funcName](sampleCoord) as PBShaderExp;
}

function getShadowMapTexelSize(scope: PBInsideFunctionScope) {
  return scope.$builder.div(1, ShaderHelper.getShadowCameraParams(scope).z) as PBShaderExp;
}

function getShadowMapSize(scope: PBInsideFunctionScope) {
  return ShaderHelper.getShadowCameraParams(scope).z as PBShaderExp;
}

/** @internal */
export function computeShadowMapDepth(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  targetFormat: TextureFormat
) {
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
      this.$if(
        pb.or(pb.equal(this.lightType, LIGHT_TYPE_DIRECTIONAL), pb.equal(this.lightType, LIGHT_TYPE_RECT)),
        function () {
          this.depth = pb.emulateDepthClamp
            ? pb.clamp(this.$inputs.clamppedDepth, 0, 1)
            : this.$builtins.fragCoord.z;
        }
      )
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
  return pb.getGlobalScope()[funcNameComputeShadowMapDepth](worldPos) as PBShaderExp;
}

/** @internal */
export function computeReceiverPlaneDepthBias(scope: PBInsideFunctionScope, texCoord: PBShaderExp) {
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
  return pb.getGlobalScope()[funcNameComputeReceiverPlaneDepthBias](texCoord) as PBShaderExp;
}

function getRandomRotationMatrix(scope: PBInsideFunctionScope, sampleCoord: PBShaderExp) {
  const funcNameGetRandomRotationMatrix = 'lib_getRandomRotationMatrix';
  const pb = scope.$builder;
  pb.func(funcNameGetRandomRotationMatrix, [pb.vec2('sampleCoord')], function () {
    this.$l.randomAngle = pb.mul(
      smoothNoise3D(this, pb.vec3(pb.mul(this.sampleCoord, 0.35), 0)),
      2 * Math.PI
    );
    this.$l.randomBase = pb.vec2(pb.cos(this.randomAngle), pb.sin(this.randomAngle));
    this.$return(pb.mat2(this.randomBase.x, this.randomBase.y, pb.neg(this.randomBase.y), this.randomBase.x));
  });
  return pb.getGlobalScope()[funcNameGetRandomRotationMatrix](sampleCoord) as PBShaderExp;
}

function getPoissonDiscSampleRadius(scope: PBInsideFunctionScope) {
  return ShaderHelper.getDepthBiasValues(scope).z as PBShaderExp;
}

function sampleShadowMapPCF(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  offset: PBShaderExp,
  depth: PBShaderExp,
  cascade?: PBShaderExp
) {
  const funcName = `${cascade ? 'lib_sampleShadowMapCascadePCF' : 'lib_sampleShadowMapPCF'}_${shadowMapFormat}`;
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
          cascade && getDevice().type !== 'webgl'
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
          cascade && getDevice().type !== 'webgl'
            ? pb.textureArraySampleLevel(ShaderHelper.getShadowMap(this), uv, this.cascade, 0)
            : pb.textureSampleLevel(ShaderHelper.getShadowMap(this), uv, 0);
        if (shadowMapFormat === 'rgba8unorm') {
          this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
        }
        // Receiver and stored depth are device-encoded here; under reverse-Z
        // "lit" means receiver depth >= stored depth.
        this.$return(
          REVERSE_Z ? pb.step(this.shadowTex.x, sampleDepth) : pb.step(sampleDepth, this.shadowTex.x)
        );
      }
    }
  );
  return pb.getGlobalScope()[funcName](pos, depth, offset, ...(cascade ? [cascade] : [])) as PBShaderExp;
}

function sampleShadowMap(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  depth: PBShaderExp,
  cascade?: PBShaderExp
) {
  const funcNameSampleShadowMap = `lib_sampleShadowMap_${lightType}_${shadowMapFormat}_${cascade ? 1 : 0}`;
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
            cascade && getDevice().type !== 'webgl'
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
            cascade && getDevice().type !== 'webgl'
              ? pb.textureArraySampleLevel(ShaderHelper.getShadowMap(this), this.coords, this.cascade, 0)
              : pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.coords, 0);
          if (shadowMapFormat === 'rgba8unorm') {
            this.shadowTex.x = decodeNormalizedFloatFromRGBA(this, this.shadowTex);
          }
          // directional/rect compare device depth (flips under reverse-Z);
          // spot receivers convert to a linear encoding beforehand.
          this.$return(
            REVERSE_Z && isDeviceDepthShadow(lightType)
              ? pb.step(this.shadowTex.x, this.z)
              : pb.step(this.z, this.shadowTex.x)
          );
        }
      }
    }
  );
  return (
    cascade
      ? pb.getGlobalScope()[funcNameSampleShadowMap](pos, depth, cascade)
      : pb.getGlobalScope()[funcNameSampleShadowMap](pos, depth)
  ) as PBShaderExp;
}

function sampleShadowMapPoissonTap(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  depth: PBShaderExp,
  filterRadius: PBShaderExp,
  cascade?: PBShaderExp
) {
  const funcName = `lib_sampleShadowMapPoissonTap_${lightType}_${shadowMapFormat}_${cascade ? 1 : 0}`;
  const pb = scope.$builder;
  pb.func(
    funcName,
    [pb.vec2('coords'), pb.float('z'), pb.float('filterRadius'), ...(cascade ? [pb.int('cascade')] : [])],
    function () {
      this.$l.tap = pb.float(0);
      this.$l.tapCoord = pb.vec2();
      this.$l.tapInside = pb.bool();
      const offsets = [
        [-0.375, -0.375],
        [0.375, -0.375],
        [-0.375, 0.375],
        [0.375, 0.375]
      ];
      for (const [ox, oy] of offsets) {
        this.tapCoord = pb.add(this.coords, pb.mul(pb.vec2(ox, oy), this.filterRadius));
        this.tapInside = pb.all(
          pb.bvec4(
            pb.greaterThanEqual(this.tapCoord.x, 0),
            pb.lessThanEqual(this.tapCoord.x, 1),
            pb.greaterThanEqual(this.tapCoord.y, 0),
            pb.lessThanEqual(this.tapCoord.y, 1)
          )
        );
        this.$if(this.tapInside, function () {
          this.tap = pb.add(
            this.tap,
            sampleShadowMap(this, lightType, shadowMapFormat, this.tapCoord, this.z, this.cascade)
          );
        }).$else(function () {
          this.tap = pb.add(this.tap, 1);
        });
      }
      this.$return(pb.mul(this.tap, 0.25));
    }
  );
  return (
    cascade
      ? pb.getGlobalScope()[funcName](pos, depth, filterRadius, cascade)
      : pb.getGlobalScope()[funcName](pos, depth, filterRadius)
  ) as PBShaderExp;
}

function sampleShadowDepthPCSS(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  bounds: PBShaderExp,
  cascade?: PBShaderExp
) {
  const funcName = `lib_sampleShadowDepthPCSS_${shadowMapFormat}_${cascade ? 1 : 0}`;
  const pb = scope.$builder;
  pb.func(
    funcName,
    [pb.vec2('coords'), pb.vec4('bounds'), ...(cascade ? [pb.int('cascade')] : [])],
    function () {
      // out-of-bounds samples read as "farthest" (no blocker)
      this.$l.depth = pb.float(DEPTH_FARTHEST);
      this.$l.sampleInside = pb.all(
        pb.bvec4(
          pb.greaterThanEqual(this.coords.x, this.bounds.x),
          pb.lessThanEqual(this.coords.x, this.bounds.z),
          pb.greaterThanEqual(this.coords.y, this.bounds.y),
          pb.lessThanEqual(this.coords.y, this.bounds.w)
        )
      );
      this.$if(this.sampleInside, function () {
        this.$l.boundsPadding = pb.mul(
          pb.sub(this.bounds.zw, this.bounds.xy),
          getShadowMapTexelSize(this),
          0.5
        );
        this.$l.sampleCoord = pb.clamp(
          this.coords,
          pb.add(this.bounds.xy, this.boundsPadding),
          pb.sub(this.bounds.zw, this.boundsPadding)
        );
        this.$l.shadowTex =
          cascade && getDevice().type !== 'webgl'
            ? pb.textureArraySampleLevel(ShaderHelper.getShadowMap(this), this.sampleCoord, this.cascade, 0)
            : pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.sampleCoord, 0);
        this.depth =
          shadowMapFormat === 'rgba8unorm'
            ? decodeNormalizedFloatFromRGBA(this, this.shadowTex)
            : this.shadowTex.x;
      });
      this.$return(this.depth);
    }
  );
  return pb.getGlobalScope()[funcName](pos, bounds, ...(cascade ? [cascade] : [])) as PBShaderExp;
}

function samplePointShadowDepthPCSS(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  dir: PBShaderExp
) {
  const funcName = `lib_samplePointShadowDepthPCSS_${shadowMapFormat}`;
  const pb = scope.$builder;
  pb.func(funcName, [pb.vec3('dir')], function () {
    this.$l.shadowTex = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.dir, 0);
    this.$return(
      shadowMapFormat === 'rgba8unorm'
        ? decodeNormalizedFloatFromRGBA(this, this.shadowTex)
        : this.shadowTex.x
    );
  });
  return pb.getGlobalScope()[funcName](dir) as PBShaderExp;
}

function compareShadowDepthPCSS(
  scope: PBInsideFunctionScope,
  sampleDepth: PBShaderExp,
  compareDepth: PBShaderExp,
  transitionWidth: PBShaderExp,
  deviceEncoded: boolean
) {
  // Lit when the stored depth is farther than the receiver; farther means a
  // smaller value for device-encoded depth under reverse-Z.
  const flip = REVERSE_Z && deviceEncoded;
  const funcName = flip ? 'lib_compareShadowDepthPCSSRev' : 'lib_compareShadowDepthPCSS';
  const pb = scope.$builder;
  pb.func(
    funcName,
    [pb.float('sampleDepth'), pb.float('compareDepth'), pb.float('transitionWidth')],
    function () {
      this.$l.depthDelta = flip
        ? pb.sub(this.compareDepth, this.sampleDepth)
        : pb.sub(this.sampleDepth, this.compareDepth);
      this.$return(pb.smoothStep(pb.neg(this.transitionWidth), this.transitionWidth, this.depthDelta));
    }
  );
  return pb.getGlobalScope()[funcName](sampleDepth, compareDepth, transitionWidth) as PBShaderExp;
}

function sampleShadowPCFPCSS(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  pos: PBShaderExp,
  bounds: PBShaderExp,
  compareDepth: PBShaderExp,
  texelSize: PBShaderExp,
  receiverPlaneDepthBias?: PBShaderExp,
  cascade?: PBShaderExp
) {
  const funcName = `lib_sampleShadowPCFPCSS_${shadowMapFormat}_${receiverPlaneDepthBias ? 1 : 0}_${cascade ? 1 : 0}`;
  const pb = scope.$builder;
  pb.func(
    funcName,
    [
      pb.vec2('coords'),
      pb.vec4('bounds'),
      pb.float('compareDepth'),
      pb.vec2('texelSize'),
      ...(receiverPlaneDepthBias ? [pb.vec3('receiverPlaneDepthBias')] : []),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      this.$l.shadow = pb.float(0);
      this.$l.transitionWidth = receiverPlaneDepthBias
        ? pb.max(pb.dot(pb.abs(this.receiverPlaneDepthBias.xy), this.texelSize), 1 / 65535)
        : pb.float(1 / 65535);
      this.$l.offset = pb.vec2();
      this.$l.tapCoord = pb.vec2();
      this.$l.sampleDepth = pb.float();
      this.$l.tapCompareDepth = pb.float();
      const offsets = [
        [-0.35, -0.35],
        [0.35, -0.35],
        [-0.35, 0.35],
        [0.35, 0.35]
      ];
      for (const [ox, oy] of offsets) {
        this.offset = pb.mul(pb.vec2(ox, oy), this.texelSize);
        this.tapCoord = pb.add(this.coords, this.offset);
        this.sampleDepth = sampleShadowDepthPCSS(
          this,
          shadowMapFormat,
          this.tapCoord,
          this.bounds,
          this.cascade
        );
        this.tapCompareDepth = receiverPlaneDepthBias
          ? pb.add(this.compareDepth, pb.dot(this.offset, this.receiverPlaneDepthBias.xy))
          : this.compareDepth;
        this.shadow = pb.add(
          this.shadow,
          compareShadowDepthPCSS(this, this.sampleDepth, this.tapCompareDepth, this.transitionWidth, true)
        );
      }
      this.$return(pb.mul(this.shadow, 0.25));
    }
  );
  return pb
    .getGlobalScope()
    [
      funcName
    ](pos, bounds, compareDepth, texelSize, ...(receiverPlaneDepthBias ? [receiverPlaneDepthBias] : []), ...(cascade ? [cascade] : [])) as PBShaderExp;
}

function samplePointShadowPCFPCSS(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  dir: PBShaderExp,
  compareDepth: PBShaderExp,
  texelSize: PBShaderExp,
  tangent: PBShaderExp,
  bitangent: PBShaderExp
) {
  const funcName = `lib_samplePointShadowPCFPCSS_${shadowMapFormat}`;
  const pb = scope.$builder;
  pb.func(
    funcName,
    [
      pb.vec3('dir'),
      pb.float('compareDepth'),
      pb.float('texelSize'),
      pb.vec3('tangent'),
      pb.vec3('bitangent')
    ],
    function () {
      this.$l.shadow = pb.float(0);
      this.$l.transitionWidth = pb.float(1 / 65535);
      this.$l.offset = pb.vec2();
      this.$l.sampleDir = pb.vec3();
      this.$l.sampleDepth = pb.float();
      const offsets = [
        [-0.35, -0.35],
        [0.35, -0.35],
        [-0.35, 0.35],
        [0.35, 0.35]
      ];
      for (const [ox, oy] of offsets) {
        this.offset = pb.mul(pb.vec2(ox, oy), this.texelSize);
        this.sampleDir = pb.normalize(
          pb.add(this.dir, pb.add(pb.mul(this.tangent, this.offset.x), pb.mul(this.bitangent, this.offset.y)))
        );
        this.sampleDepth = samplePointShadowDepthPCSS(this, shadowMapFormat, this.sampleDir);
        this.shadow = pb.add(
          this.shadow,
          compareShadowDepthPCSS(this, this.sampleDepth, this.compareDepth, this.transitionWidth, false)
        );
      }
      this.$return(pb.mul(this.shadow, 0.25));
    }
  );
  return pb.getGlobalScope()[funcName](dir, compareDepth, texelSize, tangent, bitangent) as PBShaderExp;
}

function findBlockerPCSS(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  tapCount: PBShaderExp,
  texCoord: PBShaderExp,
  bounds: PBShaderExp,
  searchRadius: PBShaderExp,
  transitionWidth: PBShaderExp,
  matrix: PBShaderExp,
  cascade?: PBShaderExp
) {
  const funcName = `lib_findBlockerPCSS_${shadowMapFormat}_${cascade ? 1 : 0}`;
  const pb = scope.$builder;
  pb.func(
    funcName,
    [
      pb.vec4('texCoord'),
      pb.vec4('bounds'),
      pb.vec2('searchRadius'),
      pb.float('tapCount'),
      pb.float('transitionWidth'),
      pb.mat2('matrix'),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      this.$l.blockerDepthSum = pb.float(0);
      this.$l.blockerCount = pb.float(0);
      this.$l.duv = pb.vec2();
      this.$l.sampleCoord = pb.vec2();
      this.$l.sampleDepth = pb.float();
      this.$l.blockerWeight = pb.float();
      this.$for(pb.float('i'), 0, this.tapCount, function () {
        this.duv = pb.mul(
          pb.mul(
            this.matrix,
            this.PCSSpdSamples.at(pb.mod(pb.mul(pb.int(this.i), 19), PCF_POISSON_DISC.length))
          ),
          this.searchRadius
        );
        this.sampleCoord = pb.add(this.texCoord.xy, this.duv);
        this.sampleDepth = sampleShadowDepthPCSS(
          this,
          shadowMapFormat,
          this.sampleCoord,
          this.bounds,
          this.cascade
        );
        // Blocker when the sample is closer to the light than the receiver;
        // device-encoded depth mirrors the difference under reverse-Z.
        this.blockerWeight = pb.sub(
          1,
          pb.smoothStep(
            pb.neg(this.transitionWidth),
            this.transitionWidth,
            REVERSE_Z
              ? pb.sub(this.texCoord.z, this.sampleDepth)
              : pb.sub(this.sampleDepth, this.texCoord.z)
          )
        );
        this.blockerDepthSum = pb.add(this.blockerDepthSum, pb.mul(this.sampleDepth, this.blockerWeight));
        this.blockerCount = pb.add(this.blockerCount, this.blockerWeight);
      });
      this.$return(
        pb.vec2(
          this.$choice(
            pb.greaterThan(this.blockerCount, 0),
            pb.div(this.blockerDepthSum, pb.max(this.blockerCount, 0.0001)),
            -1
          ),
          this.blockerCount
        )
      );
    }
  );
  return pb
    .getGlobalScope()
    [
      funcName
    ](texCoord, bounds, searchRadius, tapCount, transitionWidth, matrix, ...(cascade ? [cascade] : [])) as PBShaderExp;
}

function findPointBlockerPCSS(
  scope: PBInsideFunctionScope,
  shadowMapFormat: TextureFormat,
  tapCount: PBShaderExp,
  dir: PBShaderExp,
  compareDepth: PBShaderExp,
  searchRadius: PBShaderExp,
  transitionWidth: PBShaderExp,
  matrix: PBShaderExp,
  tangent: PBShaderExp,
  bitangent: PBShaderExp
) {
  const funcName = `lib_findPointBlockerPCSS_${shadowMapFormat}`;
  const pb = scope.$builder;
  pb.func(
    funcName,
    [
      pb.vec3('dir'),
      pb.float('compareDepth'),
      pb.float('searchRadius'),
      pb.float('tapCount'),
      pb.float('transitionWidth'),
      pb.mat2('matrix'),
      pb.vec3('tangent'),
      pb.vec3('bitangent')
    ],
    function () {
      this.$l.blockerDepthSum = pb.float(0);
      this.$l.blockerCount = pb.float(0);
      this.$l.duv = pb.vec2();
      this.$l.sampleDir = pb.vec3();
      this.$l.sampleDepth = pb.float();
      this.$l.blockerWeight = pb.float();
      this.$for(pb.float('i'), 0, this.tapCount, function () {
        this.duv = pb.mul(
          pb.mul(
            this.matrix,
            this.PCSSpdSamples.at(pb.mod(pb.mul(pb.int(this.i), 19), PCF_POISSON_DISC.length))
          ),
          this.searchRadius
        );
        this.sampleDir = pb.normalize(
          pb.add(this.dir, pb.add(pb.mul(this.tangent, this.duv.x), pb.mul(this.bitangent, this.duv.y)))
        );
        this.sampleDepth = samplePointShadowDepthPCSS(this, shadowMapFormat, this.sampleDir);
        this.blockerWeight = pb.sub(
          1,
          pb.smoothStep(
            pb.neg(this.transitionWidth),
            this.transitionWidth,
            pb.sub(this.sampleDepth, this.compareDepth)
          )
        );
        this.blockerDepthSum = pb.add(this.blockerDepthSum, pb.mul(this.sampleDepth, this.blockerWeight));
        this.blockerCount = pb.add(this.blockerCount, this.blockerWeight);
      });
      this.$return(
        pb.vec2(
          this.$choice(
            pb.greaterThan(this.blockerCount, 0),
            pb.div(this.blockerDepthSum, pb.max(this.blockerCount, 0.0001)),
            -1
          ),
          this.blockerCount
        )
      );
    }
  );
  return pb
    .getGlobalScope()
    [
      funcName
    ](dir, compareDepth, searchRadius, tapCount, transitionWidth, matrix, tangent, bitangent) as PBShaderExp;
}

function chebyshevUpperBound(
  scope: PBInsideFunctionScope,
  distance: PBShaderExp,
  occluder: PBShaderExp,
  deviceEncoded: boolean
) {
  const flip = REVERSE_Z && deviceEncoded;
  const funcNameChebyshevUpperBound = flip ? 'lib_chebyshevUpperBoundRev' : 'lib_chebyshevUpperBound';
  const pb = scope.$builder;
  pb.func(funcNameChebyshevUpperBound, [pb.float('distance'), pb.vec3('occluder')], function () {
    this.$l.shadow = pb.float(1);
    this.$l.coverage = this.occluder.z;
    this.$l.invCoverage = pb.div(1, pb.max(this.coverage, 0.00001));
    this.$l.moments = pb.mul(this.occluder.xy, this.invCoverage);
    // The one-sided Chebyshev bound applies when the receiver is farther
    // than the mean occluder depth; variance and squared difference are
    // invariant under the reverse-Z d -> 1-d mirror, only the side test
    // flips.
    this.$l.test = flip
      ? pb.step(this.moments.x, this.distance)
      : pb.step(this.distance, this.moments.x);
    this.$if(pb.notEqual(this.test, 1), function () {
      this.$l.d = pb.sub(this.distance, this.moments.x);
      this.$l.variance = pb.max(pb.sub(this.moments.y, pb.mul(this.moments.x, this.moments.x)), 0.000002);
      const darkness = ShaderHelper.getDepthBiasValues(this).z;
      this.shadow = pb.div(this.variance, pb.add(this.variance, pb.mul(this.d, this.d)));
      this.shadow = pb.clamp(pb.div(pb.sub(this.shadow, darkness), pb.sub(1, darkness)), 0, 1);
    });
    this.shadow = pb.mix(1, this.shadow, pb.clamp(this.coverage, 0, 1));
    this.$return(this.shadow);
  });
  return pb.getGlobalScope()[funcNameChebyshevUpperBound](distance, occluder) as PBShaderExp;
}

/** @internal */
export function filterShadowVSM(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  texCoord: PBShaderExp,
  cascade?: PBShaderExp
) {
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
            shadowMapFormat === 'rgba8unorm'
              ? pb.vec3(decode2HalfFromRGBA(this, this.shadowTex), 1)
              : this.shadowTex.rgb,
            false
          )
        );
      } else {
        if (getDevice().type !== 'webgl' && cascade) {
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
            shadowMapFormat === 'rgba8unorm'
              ? pb.vec3(decode2HalfFromRGBA(this, this.shadowTex), 1)
              : this.shadowTex.rgb,
            isDeviceDepthShadow(lightType)
          )
        );
      }
    }
  );
  return pb.getGlobalScope()[funcNameFilterShadowVSM](texCoord, ...(cascade ? [cascade] : [])) as PBShaderExp;
}

/** @internal */
export function filterShadowESM(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  logSpace: boolean,
  shadowVertex: PBShaderExp,
  cascade?: PBShaderExp,
  depthBias?: PBShaderExp
) {
  const funcNameFilterShadowESM = 'lib_filterShadowESM';
  const pb = scope.$builder;
  pb.func(
    funcNameFilterShadowESM,
    [
      lightType === LIGHT_TYPE_POINT ? pb.vec3('shadowVertex') : pb.vec4('shadowVertex'),
      ...(cascade ? [pb.int('cascade')] : []),
      ...(depthBias ? [pb.float('depthBias')] : [])
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
        if (cascade && getDevice().type !== 'webgl') {
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
      const deviceEncoded = isDeviceDepthShadow(lightType);
      if (depthBias) {
        this.depth =
          REVERSE_Z && deviceEncoded
            ? pb.min(1, pb.add(this.depth, this.depthBias))
            : pb.max(0, pb.sub(this.depth, this.depthBias));
      }
      const depthScale = ShaderHelper.getDepthBiasValues(this).z;
      // ESM expects exp(k * (occluder - receiver)) with depth growing away
      // from the light; device-encoded depth grows towards the light under
      // reverse-Z, so the difference is mirrored.
      this.$l.shadow =
        REVERSE_Z && deviceEncoded
          ? logSpace
            ? pb.clamp(pb.exp(pb.min(87, pb.sub(pb.mul(depthScale, this.depth), this.shadowTex.x))), 0, 1)
            : pb.clamp(pb.exp(pb.min(87, pb.mul(depthScale, pb.sub(this.depth, this.shadowTex.x)))), 0, 1)
          : logSpace
            ? pb.clamp(pb.exp(pb.min(87, pb.sub(this.shadowTex.x, pb.mul(depthScale, this.depth)))), 0, 1)
            : pb.clamp(pb.exp(pb.min(87, pb.mul(depthScale, pb.sub(this.shadowTex.x, this.depth)))), 0, 1);
      if (shadowMapFormat !== 'rgba8unorm') {
        this.shadow = pb.mix(1, this.shadow, pb.clamp(this.shadowTex.y, 0, 1));
      }
      this.$return(this.shadow);
    }
  );
  return pb
    .getGlobalScope()
    [
      funcNameFilterShadowESM
    ](shadowVertex, ...(cascade ? [cascade] : []), ...(depthBias ? [depthBias] : [])) as PBShaderExp;
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
) {
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
        this.lightDepth = REVERSE_Z
          ? pb.add(this.lightDepth, this.receiverPlaneDepthBias.z)
          : pb.sub(this.lightDepth, this.receiverPlaneDepthBias.z);
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
    [
      funcNameFilterShadowPCF
    ](texCoord, ...(receiverPlaneDepthBias ? [receiverPlaneDepthBias] : []), ...(cascade ? [cascade] : [])) as PBShaderExp;
}

/** @internal */
export function filterShadowPCSS(
  scope: PBInsideFunctionScope,
  lightType: number,
  shadowMapFormat: TextureFormat,
  texCoord: PBShaderExp,
  receiverPlaneDepthBias?: PBShaderExp,
  cascade?: PBShaderExp,
  temporalJitter = true,
  numCascades = 1
) {
  const funcNameFilterShadowPCSS = `lib_filterShadowPCSS_${lightType}_${shadowMapFormat}_${receiverPlaneDepthBias ? 1 : 0}_${cascade ? 1 : 0}_${temporalJitter ? 1 : 0}_${numCascades}`;
  const pb = scope.$builder;
  pb.func(
    funcNameFilterShadowPCSS,
    [
      pb.vec4('texCoord'),
      ...(receiverPlaneDepthBias ? [pb.vec3('receiverPlaneDepthBias')] : []),
      ...(cascade ? [pb.int('cascade')] : [])
    ],
    function () {
      this.$l.PCSSblockerSampleCount = ShaderHelper.getShadowImplParams(this).y;
      this.$l.PCSSfilterSampleCount = ShaderHelper.getShadowImplParams(this).z;
      this.$l.PCSSlightRadius = ShaderHelper.getShadowImplParams(this).x;
      this.$l.PCSSmaxFilterRadius = ShaderHelper.getShadowImplParams(this).w;
      this.$l.PCSSsearchRadius = this.$choice(
        pb.greaterThan(this.PCSSlightRadius, 0),
        pb.max(this.PCSSlightRadius, this.PCSSmaxFilterRadius),
        0
      );

      if (!pb.getGlobalScope().PCSSpdSamples) {
        pb.getGlobalScope().PCSSpdSamples = PCF_POISSON_DISC.map((s) => pb.vec2(s[0], s[1]));
      }

      if (lightType === LIGHT_TYPE_POINT) {
        this.$l.lightDepth = this.texCoord.w;
        this.$l.sampleDir = pb.normalize(this.texCoord.xyz);
        this.$l.shadowMapTexelSize = pb.mul(getShadowMapTexelSize(this), 2);
        this.$l.matrix = getPCSSRotationMatrix(
          this,
          pb.mul(this.sampleDir.xy, pb.vec2(getShadowMapSize(this))),
          temporalJitter
        );
        this.$l.searchRadius = pb.mul(
          pb.clamp(this.PCSSsearchRadius, 0, pb.max(0, this.PCSSmaxFilterRadius)),
          this.shadowMapTexelSize
        );
        this.$l.blockerTransitionWidth = pb.float(1 / 65535);
        this.$l.up = this.$choice(
          pb.lessThan(pb.abs(this.sampleDir.y), 0.999),
          pb.vec3(0, 1, 0),
          pb.vec3(1, 0, 0)
        );
        this.$l.tangent = pb.normalize(pb.cross(this.up, this.sampleDir));
        this.$l.bitangent = pb.cross(this.sampleDir, this.tangent);
        this.$l.blocker = findPointBlockerPCSS(
          this,
          shadowMapFormat,
          this.PCSSblockerSampleCount,
          this.sampleDir,
          this.lightDepth,
          this.searchRadius,
          this.blockerTransitionWidth,
          this.matrix,
          this.tangent,
          this.bitangent
        );
        this.$if(pb.lessThanEqual(this.blocker.y, 0), function () {
          this.$return(pb.float(1));
        });
        this.$l.penumbra = pb.div(
          pb.max(pb.sub(this.lightDepth, this.blocker.x), 0),
          pb.max(this.blocker.x, 0.0001)
        );
        this.$l.filterRadius = pb.mul(
          pb.clamp(pb.mul(this.penumbra, this.PCSSlightRadius), 0, pb.max(0, this.PCSSmaxFilterRadius)),
          this.shadowMapTexelSize
        );
        this.$l.shadow = pb.float(0);
        this.$l.duv = pb.vec2();
        this.$l.samplePointDir = pb.vec3();
        this.$for(pb.float('i'), 0, this.PCSSfilterSampleCount, function () {
          this.duv = pb.mul(
            pb.mul(
              this.matrix,
              this.PCSSpdSamples.at(pb.mod(pb.mul(pb.int(this.i), 19), PCF_POISSON_DISC.length))
            ),
            this.filterRadius
          );
          this.samplePointDir = pb.normalize(
            pb.add(
              this.sampleDir,
              pb.add(pb.mul(this.tangent, this.duv.x), pb.mul(this.bitangent, this.duv.y))
            )
          );
          this.shadow = pb.add(
            this.shadow,
            samplePointShadowPCFPCSS(
              this,
              shadowMapFormat,
              this.samplePointDir,
              this.lightDepth,
              this.shadowMapTexelSize,
              this.tangent,
              this.bitangent
            )
          );
        });
        this.shadow = pb.div(this.shadow, this.PCSSfilterSampleCount);
        this.$return(this.shadow);
        return;
      }

      this.$l.lightDepth = this.texCoord.z;
      if (receiverPlaneDepthBias) {
        this.lightDepth = REVERSE_Z
          ? pb.add(this.lightDepth, this.receiverPlaneDepthBias.z)
          : pb.sub(this.lightDepth, this.receiverPlaneDepthBias.z);
      }
      this.$l.sampleBounds = pb.vec4(0, 0, 1, 1);
      if (cascade && getDevice().type === 'webgl' && numCascades > 1) {
        const numCols = numCascades > 1 ? 2 : 1;
        const numRows = numCascades > 2 ? 2 : 1;
        this.$l.cascadeIndex = pb.float(this.cascade);
        this.$l.cascadeCol = pb.mod(this.cascadeIndex, 2);
        this.$l.cascadeRow = pb.floor(pb.mul(this.cascadeIndex, 0.5));
        this.sampleBounds = pb.vec4(
          pb.mul(this.cascadeCol, 1 / numCols),
          pb.mul(this.cascadeRow, 1 / numRows),
          pb.mul(pb.add(this.cascadeCol, 1), 1 / numCols),
          pb.mul(pb.add(this.cascadeRow, 1), 1 / numRows)
        );
      }
      this.$l.shadowMapTexelSize = pb.mul(
        pb.sub(this.sampleBounds.zw, this.sampleBounds.xy),
        getShadowMapTexelSize(this)
      );
      this.$l.matrix = getPCSSRotationMatrix(
        this,
        pb.mul(this.texCoord.xy, pb.vec2(getShadowMapSize(this))),
        temporalJitter
      );
      this.$l.searchRadius = pb.mul(
        pb.clamp(this.PCSSsearchRadius, 0, pb.max(0, this.PCSSmaxFilterRadius)),
        this.shadowMapTexelSize
      );
      this.$l.blockerTransitionWidth = receiverPlaneDepthBias
        ? pb.max(pb.dot(pb.abs(this.receiverPlaneDepthBias.xy), this.searchRadius), 1 / 65535)
        : pb.float(1 / 65535);

      this.$l.blocker = findBlockerPCSS(
        this,
        shadowMapFormat,
        this.PCSSblockerSampleCount,
        pb.vec4(this.texCoord.xy, this.lightDepth, this.texCoord.w),
        this.sampleBounds,
        this.searchRadius,
        this.blockerTransitionWidth,
        this.matrix,
        this.cascade
      );
      this.$if(pb.lessThanEqual(this.blocker.y, 0), function () {
        this.$return(pb.float(1));
      });
      // Penumbra estimation (receiver - blocker) / blocker in device depth;
      // under reverse-Z apply the d -> 1-d mirror of the same expression.
      this.$l.penumbra = REVERSE_Z
        ? pb.div(
            pb.max(pb.sub(this.blocker.x, this.lightDepth), 0),
            pb.max(pb.sub(1, this.blocker.x), 0.0001)
          )
        : pb.div(pb.max(pb.sub(this.lightDepth, this.blocker.x), 0), pb.max(this.blocker.x, 0.0001));
      this.$l.filterRadius = pb.mul(
        pb.clamp(pb.mul(this.penumbra, this.PCSSlightRadius), 0, pb.max(0, this.PCSSmaxFilterRadius)),
        this.shadowMapTexelSize
      );
      this.$l.shadow = pb.float(0);
      this.$l.duv = pb.vec2();
      this.$l.sampleCoord = pb.vec2();
      this.$l.compareDepth = pb.float();
      this.$for(pb.float('i'), 0, this.PCSSfilterSampleCount, function () {
        this.duv = pb.mul(
          pb.mul(
            this.matrix,
            this.PCSSpdSamples.at(pb.mod(pb.mul(pb.int(this.i), 19), PCF_POISSON_DISC.length))
          ),
          this.filterRadius
        );
        this.sampleCoord = pb.add(this.texCoord.xy, this.duv);
        this.compareDepth = receiverPlaneDepthBias
          ? pb.add(this.lightDepth, pb.dot(this.duv, this.receiverPlaneDepthBias.xy))
          : this.lightDepth;
        this.shadow = pb.add(
          this.shadow,
          sampleShadowPCFPCSS(
            this,
            shadowMapFormat,
            this.sampleCoord,
            this.sampleBounds,
            this.compareDepth,
            this.shadowMapTexelSize,
            this.receiverPlaneDepthBias,
            this.cascade
          )
        );
      });
      this.shadow = pb.div(this.shadow, this.PCSSfilterSampleCount);
      this.$return(this.shadow);
    }
  );
  return pb
    .getGlobalScope()
    [
      funcNameFilterShadowPCSS
    ](texCoord, ...(receiverPlaneDepthBias ? [receiverPlaneDepthBias] : []), ...(cascade ? [cascade] : [])) as PBShaderExp;
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
) {
  const funcNameFilterShadowPoissonDisc = `lib_filterShadowPoissonDisc_${lightType}_${shadowMapFormat}_${tapCount}_${receiverPlaneDepthBias ? 1 : 0}_${cascade ? 1 : 0}`;
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
        this.lightDepth = REVERSE_Z
          ? pb.add(this.lightDepth, this.receiverPlaneDepthBias.z)
          : pb.sub(this.lightDepth, this.receiverPlaneDepthBias.z);
      }
      this.$l.duv = pb.vec2();
      this.$l.sampleCoord = pb.vec2();
      this.$l.sampleInside = pb.bool();
      this.$l.tapFilterRadius = pb.mul(getShadowMapTexelSize(this), 0.85);
      this.$l.filterRadius = pb.mul(getShadowMapTexelSize(this), getPoissonDiscSampleRadius(this));
      this.$l.matrix = getRandomRotationMatrix(
        this,
        pb.mul(this.texCoord.xy, pb.vec2(getShadowMapSize(this)))
      );
      this.$l.shadow = pb.float(0);
      for (let i = 0; i < tapCount; i++) {
        this.duv = pb.mul(
          this.matrix,
          pb.mul(pb.vec2(PCF_POISSON_DISC[i][0], PCF_POISSON_DISC[i][1]), this.filterRadius)
        );
        this.sampleCoord = pb.add(this.texCoord.xy, this.duv);
        this.sampleInside = pb.all(
          pb.bvec4(
            pb.greaterThanEqual(this.sampleCoord.x, 0),
            pb.lessThanEqual(this.sampleCoord.x, 1),
            pb.greaterThanEqual(this.sampleCoord.y, 0),
            pb.lessThanEqual(this.sampleCoord.y, 1)
          )
        );
        this.$if(this.sampleInside, function () {
          const sampleDepth = receiverPlaneDepthBias
            ? pb.add(this.lightDepth, pb.dot(this.duv, this.receiverPlaneDepthBias.xy))
            : this.lightDepth;
          this.shadow = pb.add(
            this.shadow,
            sampleShadowMapPoissonTap(
              this,
              lightType,
              shadowMapFormat,
              this.sampleCoord.xy,
              sampleDepth,
              this.tapFilterRadius,
              this.cascade
            )
          );
        }).$else(function () {
          this.shadow = pb.add(this.shadow, 1);
        });
      }
      this.shadow = pb.div(this.shadow, tapCount);
      this.$return(this.shadow);
    }
  );
  return pb
    .getGlobalScope()
    [
      funcNameFilterShadowPoissonDisc
    ](texCoord, ...(receiverPlaneDepthBias ? [receiverPlaneDepthBias] : []), ...(cascade ? [cascade] : [])) as PBShaderExp;
}
