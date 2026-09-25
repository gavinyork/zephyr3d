import type { Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import { LTC_AMP_LUT_F16_BASE64, LTC_LUT_SIZE, LTC_MAT_LUT_F16_BASE64 } from './ltcdata';

const LUT_SIZE = LTC_LUT_SIZE;
let ltcMatLut: Texture2D | null = null;
let ltcAmpLut: Texture2D | null = null;

function decodeBase64(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const out: number[] = [];
  let i = 0;
  while (i < clean.length) {
    const enc1 = chars.indexOf(clean.charAt(i++));
    const enc2 = chars.indexOf(clean.charAt(i++));
    const enc3 = chars.indexOf(clean.charAt(i++));
    const enc4 = chars.indexOf(clean.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    out.push(chr1);
    if (enc3 !== 64) {
      out.push(chr2);
    }
    if (enc4 !== 64) {
      out.push(chr3);
    }
  }
  return new Uint8Array(out);
}

// The LTC coefficients are signed and exceed 1 (the inverse matrix's z scale reaches ~1.66, and
// grazing angles need negative skew terms), and near-mirror roughness needs values around 1e-5, so
// the tables must stay floating point: an 8-bit unorm copy clamps the negatives, saturates at 1 and
// quantizes the low-roughness column to a singular matrix, which zeroes glossy reflections.
function createTexture(base64: string, name: string) {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength !== LUT_SIZE * LUT_SIZE * 4 * 2) {
    throw new Error(`createTexture(): invalid LTC LUT size for ${name}`);
  }
  // Rebuild the halves from explicit little-endian byte pairs rather than aliasing the buffer,
  // so the result does not depend on host endianness or the byte offset of the decoded array.
  const data = new Uint16Array(LUT_SIZE * LUT_SIZE * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  }
  const device = getDevice();
  const tex = device.createTexture2D('rgba16f', LUT_SIZE, LUT_SIZE, { mipmapping: false })!;
  tex.update(data, 0, 0, LUT_SIZE, LUT_SIZE);
  tex.name = name;
  return tex;
}

function createLTCTextures() {
  ltcMatLut = createTexture(LTC_MAT_LUT_F16_BASE64, 'LTC_Mat');
  ltcAmpLut = createTexture(LTC_AMP_LUT_F16_BASE64, 'LTC_Amp');
}

export function getLTCMatLUT() {
  if (!ltcMatLut) {
    createLTCTextures();
  }
  return ltcMatLut!;
}

export function getLTCAmpLUT() {
  if (!ltcAmpLut) {
    createLTCTextures();
  }
  return ltcAmpLut!;
}
