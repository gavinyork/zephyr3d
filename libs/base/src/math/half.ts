/**
 * Convert float16 to float32
 * @param f16 - float16 value
 * @returns float32 value
 * @public
 */
export function half2float(f16: number) {
  const s = (f16 & 0x8000) >> 15; // sign
  const e = (f16 & 0x7c00) >> 10; // exponent
  const f = f16 & 0x03ff; // fraction

  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 0x0400);
  } else if (e === 0x1f) {
    return f ? NaN : (s ? -1 : 1) * Infinity;
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 0x0400);
}

/**
 * Convert float32 to float16
 * @param f32 - float32 value
 * @returns float16 value
 * @public
 */
export function float2half(f32: number) {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setFloat32(0, f32, false);

  const i32 = view.getInt32(0, false);

  const sign = (i32 >>> 31) & 0x1;
  const exponent = (i32 >>> 23) & 0xff;
  let fraction = i32 & 0x7fffff;

  if (exponent === 0xff) {
    if (fraction === 0) {
      return (sign << 15) | 0x7c00;
    } else {
      return (sign << 15) | 0x7c00 | (fraction >>> 13);
    }
  }

  if (exponent <= 112) {
    return sign << 15;
  }

  if (exponent >= 143) {
    return (sign << 15) | 0x7c00;
  }

  let e = exponent - 127 + 15;
  const extra = fraction & 0x1fff;
  fraction = fraction >>> 13;

  if (extra > 0x1000 || (extra === 0x1000 && (fraction & 0x1) === 1)) {
    fraction++;
    if (fraction === 0x400) {
      fraction = 0;
      e++;
    }
  }

  if (e >= 31) {
    return (sign << 15) | 0x7c00;
  }

  return (sign << 15) | (e << 10) | fraction;
}
