const tmpArrayBuffer = new ArrayBuffer(4);
const tmpFloatArray = new Float32Array(tmpArrayBuffer);
const tmpUint32Array = new Uint32Array(tmpArrayBuffer);

/**
 * Convert a degree value to radian value.
 * @param degree - The degree value to be converted.
 * @returns The radian value.
 *
 * @public
 */
export function degree2radian(degree: number): number {
  return (degree * Math.PI) / 180;
}

/**
 * Convert a radian value to degree value.
 * @param radian - The radian value to be converted.
 * @returns The degree value.
 *
 * @public
 */
export function radian2degree(radian: number): number {
  return (radian * 180) / Math.PI;
}

/**
 * Convert a number to 32 bit float value
 * @param val - The number to be converted
 * @returns 32bit float value
 *
 * @public
 */
export function toFloat(val: number): number {
  tmpFloatArray[0] = val;
  return tmpFloatArray[0];
}

/**
 * Check if a number is a power of 2.
 *
 * @param value - The number to be checked.
 * @returns true if the number is a power of 2, otherwise false.
 *
 * @public
 */
export function isPowerOf2(value: number): boolean {
  return value % 1 === 0 && value >= 0 && (value & (value - 1)) === 0;
}

/**
 * Given a number, find the next number power of 2.
 *
 * @param value - The given number.
 * @returns The next number power of 2.
 *
 * @public
 */
export function nextPowerOf2(value: number): number {
  if (value <= 0) {
    return 1;
  }
  value--;
  value |= value >> 1;
  value |= value >> 2;
  value |= value >> 4;
  value |= value >> 8;
  value |= value >> 16;
  value |= value >> 32;
  return value + 1;
}

/**
 * Converts float value to half float
 *
 * @param val - The float value to be converted.
 * @returns A 16-bits integer presents the half float value
 *
 * @public
 */
export function floatToHalf(val: number): number {
  /*
  _floatView[0] = val;
  const x = _int32View[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) {
    return bits;
  }
  if (e > 142) {
    bits |= 0x7c00;
    bits |= (e === 255 ? 0 : 1) && x & 0x007fffff;
    return bits;
  }
  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
  */
  tmpFloatArray[0] = val;
  let ivalue = tmpUint32Array[0];
  let result: number;
  const sign = (ivalue & 0x80000000) >>> 16;
  ivalue = ivalue & 0x7fffffff;
  if (ivalue >= 0x47800000) {
    // number is too large
    result = 0x7c00 | (ivalue > 0x7f800000 ? 0x200 | ((ivalue >>> 13) & 0x3ff) : 0);
  } else if (ivalue <= 0x33000000) {
    result = 0;
  } else if (ivalue < 0x38800000) {
    const shift = 125 - (ivalue >>> 23);
    ivalue = 0x800000 | (ivalue & 0x7fffff);
    result = ivalue >>> (shift + 1);
    const s = (ivalue & ((1 << shift) - 1)) !== 0 ? 1 : 0;
    result += (result | s) & ((ivalue >>> shift) & 1);
  } else {
    ivalue += 0xc8000000;
    result = ((ivalue + 0x0fff + ((ivalue >>> 13) & 1)) >>> 13) & 0x7fff;
  }
  return result | sign;
}

/**
 * Converts half float value to float
 *
 * @param val - A 16-bits integer presents the half float value to be converted.
 * @returns The converted float value
 *
 * @public
 */
export function halfToFloat(val: number): number {
  /*
  const s = (val & 0x8000) >> 15;
  const e = (val & 0x7c00) >> 10;
  const f = val & 0x03ff;
  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
  } else if (e === 0x1f) {
    return f ? NaN : (s ? -1 : 1) * Infinity;
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / Math.pow(2, 10));
  */
  let mantissa = val & 0x3ff;
  let exponent = val & 0x7c00;
  if (exponent === 0x7c00) {
    exponent = 0x8f;
  } else if (exponent !== 0) {
    exponent = (val >>> 10) & 0x1f;
  } else if (mantissa !== 0) {
    exponent = 1;
    do {
      exponent--;
      mantissa <<= 1;
    } while ((mantissa & 0x0400) === 0);
    mantissa &= 0x3ff;
  } else {
    exponent = -112;
  }
  tmpUint32Array[0] = ((val & 0x8000) << 16) | (((exponent + 112) << 23) | (mantissa << 13));
  return tmpFloatArray[0];
}

/**
 * Compresses three floats to R11F_G11F_B10F format
 *
 * @remarks
 * The implementation is adopt from https://github.com/microsoft/DirectXMath
 *
 * @param a - first of the three floats
 * @param b - second of the three floats
 * @param c - third of the tree floats
 * @returns The compressed result
 *
 * @public
 */
export function packFloat3(a: number, b: number, c: number): number {
  /*
  const x = floatToHalf(a);
  const y = floatToHalf(b);
  const z = floatToHalf(c);
  return ((x >> 4) & 0x7ff) | (((y << 7) & 0x3ff800)) | (((z << 17) & 0xffc00000));
  */
  const ivalues: number[] = [];
  const result: number[] = [];
  tmpFloatArray[0] = a;
  ivalues[0] = tmpUint32Array[0];
  tmpFloatArray[0] = b;
  ivalues[1] = tmpUint32Array[0];
  tmpFloatArray[0] = c;
  ivalues[2] = tmpUint32Array[0];

  for (let j = 0; j < 2; j++) {
    const sign = ivalues[j] & 0x80000000;
    let I = ivalues[j] & 0x7fffffff;
    if ((I & 0x7f800000) === 0x7f800000) {
      // INF or NAN
      result[j] = 0x7c0;
      if ((I & 0x7fffff) !== 0) {
        result[j] = 0x7ff;
      } else if (sign) {
        // -INF, clamp to 0
        result[j] = 0;
      }
    } else if (sign || I < 0x35800000) {
      // clamp to 0
      result[j] = 0;
    } else if (I > 0x477e0000) {
      // too large, clamp to max
      result[j] = 0x7bf;
    } else {
      if (I < 0x38800000) {
        const shift = 113 - (I >>> 23);
        I = (0x800000 | (I & 0x7fffff)) >>> shift;
      } else {
        I += 0xc8000000;
      }
      result[j] = ((I + 0xffff + ((I >>> 17) & 1)) >>> 17) & 0x7ff;
    }
  }
  const sign = ivalues[2] & 0x80000000;
  let I = ivalues[2] & 0x7fffffff;
  if ((I & 0x7f800000) === 0x7f800000) {
    // INF or NAN
    result[2] = 0x3e0;
    if (I & 0x7fffff) {
      result[2] = 0x3ff;
    } else if (sign || I < 0x36000000) {
      result[2] = 0;
    }
  } else if (sign) {
    result[2] = 0;
  } else if (I > 0x477c0000) {
    result[2] = 0x3df;
  } else {
    if (I < 0x38800000) {
      const shift = 113 - (I >>> 23);
      I = (0x800000 | (I & 0x7fffff)) >>> shift;
    } else {
      I += 0xc8000000;
    }
    result[2] = ((I + 0x1ffff + ((I >>> 18) & 1)) >>> 18) & 0x3ff;
  }
  return (result[0] & 0x7ff) | ((result[1] & 0x7ff) << 11) | ((result[2] & 0x3ff) << 22);
}

/**
 * Decompresses the three floats that was compressed to R11F_G11F_B10F format
 *
 * @param pk - The compressed value
 * @param result - A float array that will store the decompressed floats
 *
 * @public
 */
export function unpackFloat3<T extends number[] | Float32Array>(pk: number, result: T): void {
  /*
  result[0] = halfToFloat((pk & 0x7ff) << 4);
  result[1] = halfToFloat((pk & 0x3ff800) >> 7);
  result[2] = halfToFloat(((pk & 0xffc00000) >> 17) & 0x00007FFF);
  */
  let mantissa: number;
  let exponent: number;
  const ret: number[] = [];
  const xm = pk & 0x3f;
  const xe = (pk >>> 6) & 0x1f;
  const ym = (pk >>> 11) & 0x3f;
  const ye = (pk >>> 17) & 0x1f;
  const zm = (pk >>> 22) & 0x1f;
  const ze = pk >>> 27;
  mantissa = xm;
  if (xe === 0x1f) {
    // INF or NAN
    ret[0] = 0x7f800000 | (xm << 17);
  } else {
    if (xe !== 0) {
      exponent = xe;
    } else if (mantissa !== 0) {
      exponent = 1;
      do {
        exponent--;
        mantissa <<= 1;
      } while ((mantissa & 0x40) === 0);
      mantissa &= 0x3f;
    } else {
      exponent = -112;
    }
    ret[0] = ((exponent + 112) << 23) | (mantissa << 17);
  }
  mantissa = ym;
  if (ye === 0x1f) {
    ret[1] = 0x7f800000 | (ym << 17);
  } else {
    if (ye !== 0) {
      exponent = ye;
    } else if (mantissa !== 0) {
      exponent = 1;
      do {
        exponent--;
        mantissa <<= 1;
      } while ((mantissa & 0x40) === 0);
      mantissa &= 0x3f;
    } else {
      exponent = -112;
    }
    ret[1] = ((exponent + 112) << 23) | (mantissa << 17);
  }
  mantissa = zm;
  if (ze === 0x1f) {
    ret[2] = 0x7f800000 | (zm << 17);
  } else {
    if (ze !== 0) {
      exponent = ze;
    } else if (mantissa !== 0) {
      exponent = 1;
      do {
        exponent--;
        mantissa <<= 1;
      } while ((mantissa & 0x20) === 0);
      mantissa &= 0x1f;
    } else {
      exponent = -112;
    }
    ret[2] = ((exponent + 112) << 23) | (mantissa << 18);
  }
  tmpUint32Array[0] = ret[0];
  result[0] = tmpFloatArray[0];
  tmpUint32Array[0] = ret[1];
  result[1] = tmpFloatArray[0];
  tmpUint32Array[0] = ret[2];
  result[2] = tmpFloatArray[0];
}

/**
 * Calculates the weighted average of a set of values.
 *
 * @param weights - An array of weights for each value.
 * @param values - An array of values to be averaged.
 * @param funcLerp - A function that performs linear interpolation between two values of type T.
 * @returns The weighted average of the values.
 *
 * @public
 */
export function weightedAverage<T>(
  weights: number[],
  values: T[],
  funcLerp: (a: T, b: T, w: number) => T
): T {
  let totalWeight = weights[0];
  let t = values[0];
  for (let i = 1; i < weights.length; i++) {
    totalWeight += weights[i];
    t = funcLerp(t, values[i], weights[i] / totalWeight);
  }
  return t;
}
