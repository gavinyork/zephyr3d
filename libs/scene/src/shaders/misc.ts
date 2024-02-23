import type { PBShaderExp } from '@zephyr3d/device';
import { PBInsideFunctionScope, PBPrimitiveType } from '@zephyr3d/device';
import { ShaderHelper } from '../material/shader/helper';

/**
 * Calculates the TBN matrix
 *
 * @remarks
 * This function computes the tangent frame for normal mapping without world normal
 *
 * @param scope - Current shader scope
 * @param worldPosition - World position of current fragment
 * @param uv - Texture coordinate for normal map
 * @returns The calculated TBN matrix
 *
 * @public
 */
export function calculateTBN(
  scope: PBInsideFunctionScope,
  worldPosition: PBShaderExp,
  uv: PBShaderExp,
  doubleSideLighting: boolean
): PBShaderExp {
  const funcName = 'lib_calculateTBN';
  const pb = scope.$builder;
  pb.func(funcName, [pb.vec3('posW'), pb.vec2('uv')], function () {
    this.$l.uv_dx = pb.dpdx(pb.vec3(this.uv, 0));
    this.$l.uv_dy = pb.dpdy(pb.vec3(this.uv, 0));
    this.$if(pb.lessThanEqual(pb.add(pb.length(this.uv_dx), pb.length(this.uv_dy)), 0.000001), function () {
      this.uv_dx = pb.vec3(1, 0, 0);
      this.uv_dy = pb.vec3(0, 1, 0);
    });
    this.$l.t_ = pb.div(
      pb.sub(pb.mul(pb.dpdx(this.posW), this.uv_dy.y), pb.mul(pb.dpdy(this.posW), this.uv_dx.y)),
      pb.sub(pb.mul(this.uv_dx.x, this.uv_dy.y), pb.mul(this.uv_dx.y, this.uv_dy.x))
    );
    this.$l.ng = pb.normalize(pb.cross(pb.dpdx(this.posW), pb.dpdy(this.posW)));
    this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
    this.$l.b = pb.cross(this.ng, this.t);
    if (doubleSideLighting) {
      this.$if(pb.not(this.$builtins.frontFacing), function () {
        this.t = pb.mul(this.t, -1);
        this.b = pb.mul(this.b, -1);
        this.ng = pb.mul(this.ng, -1);
      });
    }
    this.$return(pb.mat3(this.t, this.b, this.ng));
  });
  return pb.getGlobalScope()[funcName](worldPosition.xyz, uv);
}

/**
 * Calculates the TBN matrix
 *
 * @remarks
 * This function computes the tangent frame for normal mapping with world normal
 *
 * @param scope - Current shader scope
 * @param worldPosition - World position of current fragment
 * @param worldNormal - World normal of current fragment
 * @param uv - Texture coordinate for normal map
 * @returns The calculated TBN matrix
 *
 * @public
 */
export function calculateTBNWithNormal(
  scope: PBInsideFunctionScope,
  worldPosition: PBShaderExp,
  worldNormal: PBShaderExp,
  uv: PBShaderExp,
  doubleSideLighting: boolean
): PBShaderExp {
  const funcName = 'lib_calculateTBNWithNormal';
  const pb = scope.$builder;
  pb.func(funcName, [pb.vec3('posW'), pb.vec3('normalW'), pb.vec2('uv')], function () {
    this.$l.uv_dx = pb.dpdx(pb.vec3(this.uv, 0));
    this.$l.uv_dy = pb.dpdy(pb.vec3(this.uv, 0));
    this.$if(pb.lessThanEqual(pb.add(pb.length(this.uv_dx), pb.length(this.uv_dy)), 0.000001), function () {
      this.uv_dx = pb.vec3(1, 0, 0);
      this.uv_dy = pb.vec3(0, 1, 0);
    });
    this.$l.t_ = pb.div(
      pb.sub(pb.mul(pb.dpdx(this.posW), this.uv_dy.y), pb.mul(pb.dpdy(this.posW), this.uv_dx.y)),
      pb.sub(pb.mul(this.uv_dx.x, this.uv_dy.y), pb.mul(this.uv_dx.y, this.uv_dy.x))
    );
    this.$l.ng = pb.normalize(this.normalW);
    this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
    this.$l.b = pb.cross(this.ng, this.t);
    if (doubleSideLighting) {
      this.$if(pb.not(this.$builtins.frontFacing), function () {
        this.t = pb.mul(this.t, -1);
        this.b = pb.mul(this.b, -1);
        this.ng = pb.mul(this.ng, -1);
      });
    }
    this.$return(pb.mat3(this.t, this.b, this.ng));
  });
  return pb.getGlobalScope()[funcName](worldPosition, worldNormal, uv);
}

/**
 * Calculates the non-linear depth from linear depth
 *
 * @param scope - Current shader scope
 * @param depth - The linear depth
 * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
 * @returns The calculated non-linear depth
 *
 * @public
 */
export function linearDepthToNonLinear(
  scope: PBInsideFunctionScope,
  depth: PBShaderExp,
  nearFar?: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  nearFar = nearFar ?? ShaderHelper.getCameraParams(scope);
  return pb.div(pb.sub(nearFar.y, pb.div(pb.mul(nearFar.x, nearFar.y), depth)), pb.sub(nearFar.y, nearFar.x));
}

/**
 * Calculates the linear depth from non-linear depth
 *
 * @param scope - Current shader scope
 * @param depth - The non-linear depth
 * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
 * @returns The calculated linear depth
 *
 * @public
 */
export function nonLinearDepthToLinear(
  scope: PBInsideFunctionScope,
  depth: PBShaderExp,
  nearFar?: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  nearFar = nearFar ?? ShaderHelper.getCameraParams(scope);
  return pb.div(pb.mul(nearFar.x, nearFar.y), pb.mix(nearFar.y, nearFar.x, depth));
}

/**
 * Calculates the normalized linear depth from non-linear depth
 *
 * @param scope - Current shader scope
 * @param depth - The non-linear depth
 * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
 * @returns The calculated normalized linear depth
 *
 * @public
 */
export function nonLinearDepthToLinearNormalized(
  scope: PBInsideFunctionScope,
  depth: PBShaderExp,
  nearFar?: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  nearFar = nearFar ?? ShaderHelper.getCameraParams(scope);
  return pb.div(nearFar.x, pb.mix(nearFar.y, nearFar.x, depth));
}

/**
 * Decodes a float that was encoded into a rgba8unorm
 *
 * @param scope - Current shader scope
 * @param value - The rgba8unorm to be decoded
 * @returns The decoded float value
 *
 * @public
 */
export function decodeFloatFromRGBA(scope: PBInsideFunctionScope, value: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  if (
    !value ||
    !value.$typeinfo.isPrimitiveType() ||
    value.$typeinfo.primitiveType !== PBPrimitiveType.F32VEC4
  ) {
    throw new Error('decodeFloatFromRGBA() failed: parameter type must be vec4');
  }
  if (!scope || !(scope instanceof PBInsideFunctionScope)) {
    throw new Error(
      'decodeFloatFromRGBA() failed: decodeNormalizedFloatFromRGBA() must be called inside a function'
    );
  }
  const funcName = 'lib_DecodeFloatFromRGBA';
  pb.func(funcName, [pb.vec4('value')], function () {
    this.$l.pack = pb.floor(pb.add(pb.mul(this.value, 255), 0.5));

    // Extract bits
    this.$l.bitSign = pb.float(pb.greaterThan(this.pack.x, 127.0));
    this.$l.bitExpn = pb.float(pb.greaterThan(this.pack.y, 127.0));
    this.pack.x = pb.sub(this.pack.x, pb.mul(this.bitSign, 128));
    this.pack.y = pb.sub(this.pack.y, pb.mul(this.bitExpn, 128));

    // Compute parts of number
    this.$l.exponent = pb.add(pb.mul(this.pack.x, 2.0), this.bitExpn);
    this.exponent = pb.pow(2.0, pb.sub(this.exponent, 127.0));
    this.$l.mantissa = pb.float(1.0);
    this.mantissa = pb.add(this.mantissa, pb.div(this.pack.y, 128.0));
    this.mantissa = pb.add(this.mantissa, pb.div(this.pack.z, 32768.0));
    this.mantissa = pb.add(this.mantissa, pb.div(this.pack.w, 8388608.0));

    // Return result
    this.$return(pb.mul(pb.sub(1.0, pb.mul(this.bitSign, 2)), this.exponent, this.mantissa));
  });
  return scope[funcName](value);
}

/**
 * Encodes a float into a rgba8unorm
 *
 * @param scope - Current shader scope
 * @param value - The float value to be encode
 * @returns The encoded rgba8unorm
 *
 * @public
 */
export function encodeFloatToRGBA(scope: PBInsideFunctionScope, value: PBShaderExp | number): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_EncodeFloatToRGBA';
  pb.func(funcName, [pb.float('value')], function () {
    this.$l.floatMax = pb.mul(1.70141184, pb.pow(10, 38));
    this.$l.floatMin = pb.mul(1.17549435, pb.pow(10, -38));
    this.$l.absvalue = pb.abs(this.value);
    this.$if(pb.lessThanEqual(this.absvalue, this.floatMin), function () {
      this.$return(pb.vec4(0));
    });
    this.$if(pb.greaterThanEqual(this.value, this.floatMax), function () {
      this.$return(pb.vec4(127 / 255, 128 / 255, 0, 0));
    });
    this.$if(pb.lessThanEqual(this.value, pb.neg(this.floatMax)), function () {
      this.$return(pb.vec4(1, 128 / 255, 0, 0));
    });
    this.$l.pack = pb.vec4(0);

    // Compute Exponent and Mantissa
    this.$l.exponent = pb.floor(pb.log2(this.absvalue));
    this.$l.mantissa = pb.sub(pb.mul(this.absvalue, pb.pow(2.0, pb.neg(this.exponent))), 1.0);

    // Pack Mantissa into bytes
    this.pack.y = pb.floor(pb.mul(this.mantissa, 128.0));
    this.mantissa = pb.sub(this.mantissa, pb.div(this.pack.y, 128.0));
    this.pack.z = pb.floor(pb.mul(this.mantissa, 32768.0));
    this.mantissa = pb.sub(this.mantissa, pb.div(this.pack.z, 32768.0));
    this.pack.w = pb.floor(pb.mul(this.mantissa, 8388608.0));

    // Pack Sing and Exponent into bytes
    this.$l.expbias = pb.add(this.exponent, 127.0);
    this.pack.x = pb.add(this.pack.x, pb.floor(pb.div(this.expbias, 2.0)));
    this.expbias = pb.sub(this.expbias, pb.mul(this.pack.x, 2.0));
    this.pack.y = pb.add(this.pack.y, pb.mul(pb.floor(this.expbias), 128.0));
    this.pack.x = pb.add(this.pack.x, pb.mul(128.0, pb.float(pb.lessThan(this.value, 0)))); // Sign
    this.$return(pb.div(pb.floor(pb.add(this.pack, pb.vec4(0.5))), 255.0));
  });
  return pb.getGlobalScope()[funcName](value);
}

/**
 * Decodes a float that was encoded into a rgba8unorm
 *
 * @param scope - Current shader scope
 * @param value - The rgba8unorm to be decoded
 * @returns The decoded float value
 *
 * @public
 */
export function decodeNormalizedFloatFromRGBA(scope: PBInsideFunctionScope, value: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  if (
    !value ||
    !value.$typeinfo.isPrimitiveType() ||
    value.$typeinfo.primitiveType !== PBPrimitiveType.F32VEC4
  ) {
    throw new Error('decodeNormalizedFloatFromRGBA() failed: parameter type must be vec4');
  }
  if (!scope || !(scope instanceof PBInsideFunctionScope)) {
    throw new Error(
      'decodeNormalizedFloatFromRGBA() failed: decodeNormalizedFloatFromRGBA() must be called inside a function'
    );
  }
  const funcName = 'lib_DecodeNormalizedFloatFromRGBA';
  pb.func(funcName, [pb.vec4('value')], function () {
    this.$l.bitShift = pb.vec4(1 / (256 * 256 * 256), 1 / (256 * 256), 1 / 256, 1);
    this.$return(pb.dot(this.value, this.bitShift));
  });
  return scope[funcName](value);
}

/**
 * Encodes a float into a rgba8unorm
 *
 * @param scope - Current shader scope
 * @param value - The float value to be encode
 * @returns The encoded rgba8unorm
 *
 * @public
 */
export function encodeNormalizedFloatToRGBA(
  scope: PBInsideFunctionScope,
  value: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_EncodeNormalizedFloatToRGBA';
  pb.func(funcName, [pb.float('value')], function () {
    this.$l.bitShift = pb.vec4(256 * 256 * 256, 256 * 256, 256, 1);
    this.$l.bitMask = pb.vec4(0, 1 / 256, 1 / 256, 1 / 256);
    this.$l.t = pb.fract(pb.mul(this.value, this.bitShift));
    this.$return(pb.sub(this.t, pb.mul(this.t.xxyz, this.bitMask)));
  });
  return pb.getGlobalScope()[funcName](value);
}

/**
 * Encodes two half floats into a rgba8unorm
 *
 * @param scope - Current shader scope
 * @param a - The first half float to be encode
 * @param b - The second half float to be encode
 * @returns The encoded rgba8unorm
 *
 * @public
 */
export function encode2HalfToRGBA(
  scope: PBInsideFunctionScope,
  a: PBShaderExp | number,
  b: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_Encode2HalfToRGBA';
  pb.func(funcName, [pb.float('a'), pb.float('b')], function () {
    this.$l.t = pb.vec4(this.a, pb.fract(pb.mul(this.a, 255)), this.b, pb.fract(pb.mul(this.b, 255)));
    this.$return(
      pb.vec4(
        pb.sub(this.t.x, pb.div(this.t.y, 255)),
        this.t.y,
        pb.sub(this.t.z, pb.div(this.t.w, 255)),
        this.t.w
      )
    );
  });
  return pb.getGlobalScope()[funcName](a, b);
}
/**
 * Decodes two half floats that was encoded into a rgba8unorm
 *
 * @param scope - Current shader scope
 * @param value - The rgba8unorm to be decoded
 * @returns A vec2 that contains the two half floats
 *
 * @public
 */
export function decode2HalfFromRGBA(scope: PBInsideFunctionScope, value: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_Decode2HalfFromRGBA';
  pb.func(funcName, [pb.vec4('value')], function () {
    this.$return(
      pb.vec2(
        pb.add(this.value.x, pb.div(this.value.y, 255)),
        pb.add(this.value.z, pb.div(this.value.w, 255))
      )
    );
  });
  return pb.getGlobalScope()[funcName](value);
}

/**
 * Transform color to sRGB color space if nessesary
 *
 * @param scope - Current shader scope
 * @param outputColor - The color to be transformed
 * @returns The transformed color
 *
 * @public
 */
export function encodeColorOutput(scope: PBInsideFunctionScope, outputColor: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_EncodeColorOutput';
  pb.func(funcName, [pb.vec4('outputColor')], function () {
    const params = ShaderHelper.getCameraParams(this);
    this.$if(pb.notEqual(params.w, 0), function () {
      this.$return(pb.vec4(linearToGamma(this, this.outputColor.rgb), this.outputColor.w));
    }).$else(function () {
      this.$return(this.outputColor);
    });
  });
  return pb.getGlobalScope()[funcName](outputColor);
}

/**
 * Encodes a color value into RGBM format
 *
 * @param scope - Current shader scope
 * @param rgb - The color value to be encoded
 * @param maxRange - The max range of color components
 * @returns The encoded RGBA value
 *
 * @public
 */
export function encodeRGBM(
  scope: PBInsideFunctionScope,
  rgb: PBShaderExp,
  maxRange: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_encodeRGBM';
  pb.func(funcName, [pb.vec3('rgb'), pb.float('range')], function () {
    this.$l.maxRGB = pb.max(this.rgb.r, pb.max(this.rgb.g, this.rgb.b));
    this.$l.M = pb.div(this.maxRGB, this.range);
    this.M = pb.div(pb.ceil(pb.mul(this.M, 255)), 255);
    this.$return(pb.vec4(pb.div(this.rgb, pb.mul(this.M, this.range)), this.M));
  });
  return pb.getGlobalScope()[funcName](rgb, maxRange);
}

/**
 * Decodes color value that was encoded into RGBM format
 *
 * @param scope - Current shader scope
 * @param rgbm - The RGBM to be decoded
 * @param maxRange - The max range of color components
 * @returns The decoded RGB color value
 *
 * @public
 */
export function decodeRGBM(
  scope: PBInsideFunctionScope,
  rgbm: PBShaderExp,
  maxRange: PBShaderExp | number
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_decodeRGBM';
  pb.func(funcName, [pb.vec4('rgbm'), pb.float('range')], function () {
    this.$return(pb.mul(this.rgbm.rgb, this.rgbm.a, this.range));
  });
  return pb.getGlobalScope()[funcName](rgbm, maxRange);
}

/**
 * Converts a vec3 color from gamma space to linear space
 *
 * @param scope - Current shader scope
 * @param color - The vec3 color to be converted
 * @returns The linear space vec3 color
 *
 * @public
 */
export function gammaToLinear(scope: PBInsideFunctionScope, color: PBShaderExp): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'lib_gammaToLinear';
  pb.func(funcName, [pb.vec3('color')], function () {
    // Approximate version from http://chilliant.blogspot.com.au/2012/08/srgb-approximations-for-hlsl.html?m=1
    // float3 RGB = sRGB * (sRGB * (sRGB * 0.305306011 + 0.682171111) + 0.012522878);
    this.$return(
      pb.mul(
        this.color,
        pb.add(
          pb.mul(this.color, pb.add(pb.mul(this.color, 0.305306011), pb.vec3(0.682171111))),
          pb.vec3(0.012522878)
        )
      )
    );
  });
  return pb.getGlobalScope()[funcName](color);
}

/**
 * Converts a vec3 color from linear space to gamma space
 *
 * @param scope - Current shader scope
 * @param color - The vec3 color to be converted
 * @returns The gamma space vec3 color
 *
 * @public
 */
export function linearToGamma(scope: PBInsideFunctionScope, color: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'lib_linearToGamma';
  pb.func(funcName, [pb.vec3('color')], function () {
    // Almost perfect version from http://chilliant.blogspot.com.au/2012/08/srgb-approximations-for-hlsl.html?m=1
    // C_srgb_2 = max(1.055 * pow(C_lin, 0.416666667) - 0.055, 0);
    this.$return(
      pb.max(pb.sub(pb.mul(pb.pow(this.color, pb.vec3(0.416666667)), 1.055), pb.vec3(0.055)), pb.vec3(0))
    );
  });
  return pb.getGlobalScope()[funcName](color);
}
