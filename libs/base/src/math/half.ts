const tmpArrayBuffer = new ArrayBuffer(4);
const tmpFloatArray = new Float32Array(tmpArrayBuffer);
const tmpUint32Array = new Uint32Array(tmpArrayBuffer);

/**
 * Convert float16 to float32
 * @param f16 - float16 value
 * @returns float32 value
 * @public
 */
export function half2float(f16: number): number {
  let mantissa = f16 & 0x3ff;
  let exponent = f16 & 0x7c00;
  if (exponent === 0x7c00) {
    exponent = 0x8f;
  } else if (exponent !== 0) {
    exponent = (f16 >>> 10) & 0x1f;
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
  tmpUint32Array[0] = ((f16 & 0x8000) << 16) | (((exponent + 112) << 23) | (mantissa << 13));
  return tmpFloatArray[0];
}

/**
 * Convert float32 to float16
 * @param f32 - float32 value
 * @returns float16 value
 * @public
 */
export function float2half(f32: number): number {
  tmpFloatArray[0] = f32;
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
