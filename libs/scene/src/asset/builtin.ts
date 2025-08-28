import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { BUILTIN_ASSET_TEXTURE_SHEEN_LUT } from '../values';
import type { Texture2D, BaseTexture, TextureCube } from '@zephyr3d/device';
import type { AssetManager } from './assetmanager';
import { getDevice } from '../app/api';

/*
interface MicrofacetDistributionSample {
  pdf?: number;
  cosTheta?: number;
  sinTheta?: number;
  phi?: number;
}
*/
/** @internal */
export function testCubemapLoader(): TextureCube {
  const device = getDevice();
  const tex = device.createCubeTexture('rgba8unorm', 32, {
    samplerOptions: { mipFilter: 'none' }
  });
  const fb = device.createFrameBuffer([tex], null);
  device.pushDeviceStates();
  device.setFramebuffer(fb);
  const colors = [
    new Vector4(1, 0, 0, 1),
    new Vector4(0.2, 0, 0, 1),
    new Vector4(0, 1, 0, 1),
    new Vector4(0, 0.2, 0, 1),
    new Vector4(0, 0, 1, 1),
    new Vector4(0, 0, 0.2, 1)
  ];
  for (let i = 0; i < 6; i++) {
    fb.setColorAttachmentCubeFace(0, i);
    device.clearFrameBuffer(colors[i], null, null);
  }
  device.popDeviceStates();
  fb.dispose();

  return tex;
}

/** @internal */
export function getSheenLutLoader(textureSize: number): (assetManager: AssetManager) => Texture2D {
  const bits = new Uint32Array(1);

  //Van der Corput radical inverse
  function radicalInverse_VdC(i: number) {
    bits[0] = i;
    bits[0] = ((bits[0] << 16) | (bits[0] >> 16)) >>> 0;
    bits[0] = ((bits[0] & 0x55555555) << 1) | (((bits[0] & 0xaaaaaaaa) >>> 1) >>> 0);
    bits[0] = ((bits[0] & 0x33333333) << 2) | (((bits[0] & 0xcccccccc) >>> 2) >>> 0);
    bits[0] = ((bits[0] & 0x0f0f0f0f) << 4) | (((bits[0] & 0xf0f0f0f0) >>> 4) >>> 0);
    bits[0] = ((bits[0] & 0x00ff00ff) << 8) | (((bits[0] & 0xff00ff00) >>> 8) >>> 0);
    return bits[0] * 2.3283064365386963e-10; // / 0x100000000 or / 4294967296
  }

  function hammersley(i: number, iN: number, out: Vector2) {
    out.setXY(i * iN, radicalInverse_VdC(i));
  }
  /*
  function hammersley(i: number, iN: number, out: Vector2) {
    const tof = 0.5 / 0x80000000;
    let bits = i;
    bits = (bits << 16) | (bits >>> 16);
    bits = ((bits & 0x55555555) << 1) | ((bits & 0xAAAAAAAA) >>> 1);
    bits = ((bits & 0x33333333) << 2) | ((bits & 0xCCCCCCCC) >>> 2);
    bits = ((bits & 0x0F0F0F0F) << 4) | ((bits & 0xF0F0F0F0) >>> 4);
    bits = ((bits & 0x00FF00FF) << 8) | ((bits & 0xFF00FF00) >>> 8);
    out.setXY(i * iN, (bits >>> 0) * tof);
  }
  */
  /*
  function generateTBN(normal: Vector3, out: Matrix3x3) {
    bitangent.setXYZ(0.0, 1.0, 0.0);
    const NdotUp = Vector3.dot(normal, up);
    const epsilon = 0.0000001;
    if (1.0 - Math.abs(NdotUp) <= epsilon) {
      // Sampling +Y or -Y, so we need a more robust bitangent.
      if (NdotUp > 0.0) {
        bitangent.setXYZ(0.0, 0.0, 1.0);
      } else {
        bitangent.setXYZ(0.0, 0.0, -1.0);
      }
    }
    Vector3.cross(bitangent, normal, tangent).inplaceNormalize();
    Vector3.cross(normal, tangent, bitangent);
    out.setCol(0, tangent);
    out.setCol(1, bitangent);
    out.setCol(2, normal);
  }
  function mix(x: number, y: number, a: number): number {
    return x * (1 - a) + y * a;
  }
  function l(x: number, alphaG: number): number {
    const oneMinusAlphaSq = (1 - alphaG) * (1 - alphaG);
    const a = mix(21.5473, 25.3245, oneMinusAlphaSq);
    const b = mix(3.82987, 3.32435, oneMinusAlphaSq);
    const c = mix(0.19823, 0.16801, oneMinusAlphaSq);
    const d = mix(-1.9776, -1.27393, oneMinusAlphaSq);
    const e = mix(-4.32054, -4.85967, oneMinusAlphaSq);
    return a / (1 + b * Math.pow(x, c)) + d * x + e;
  }
  function lambdaSheen(cosTheta: number, alphaG: number): number {
    return Math.abs(cosTheta) < 0.5
      ? Math.exp(l(Math.abs(cosTheta), alphaG))
      : Math.exp(2 * l(0.5, alphaG) - l(1 - Math.abs(cosTheta), alphaG));
  }
  function visibilityCharlie(NdotV: number, NdotL: number, a: number): number {
    const alphaG = a;
    return 1 / ((1 + lambdaSheen(NdotV, alphaG) + lambdaSheen(NdotL, alphaG)) * (4 * NdotV * NdotL));
  }
  */
  function distributionCharlie(NdotH: number, roughness: number) {
    // roughness = Math.max(roughness, 0.000001);
    const invAlpha = 1 / roughness;
    const cos2h = NdotH * NdotH;
    const sin2h = 1 - cos2h;
    return ((2 + invAlpha) * Math.pow(sin2h, invAlpha * 0.5)) / (2 * Math.PI);
  }
  /*
  function charlie(xi: Vector2, roughness: number, sample: MicrofacetDistributionSample) {
    const alpha = roughness * roughness;
    sample.sinTheta = Math.pow(xi.y, alpha / (2 * alpha + 1));
    sample.cosTheta = Math.sqrt(1 - sample.sinTheta * sample.sinTheta);
    sample.phi = 2 * Math.PI * xi.x;
    sample.pdf = distributionCharlie(sample.cosTheta, Math.max(alpha, 0.000001)) / 4;
  }
  function getImportanceSample(
    sampleIndex: number,
    sampleCount: number,
    N: Vector3,
    roughness: number,
    out: Vector4
  ) {
    // generate a quasi monte carlo point in the unit square [0.1)^2
    hammersley(sampleIndex, 1 / sampleCount, xi);
    // generate the points on the hemisphere with a fitting mapping for
    // the distribution (e.g. lambertian uses a cosine importance)
    charlie(xi, roughness, importanceSample);

    // transform the hemisphere sample to the normal coordinate frame
    // i.e. rotate the hemisphere to the normal direction
    localSpaceDirection
      .setXYZ(
        importanceSample.sinTheta * Math.cos(importanceSample.phi),
        importanceSample.sinTheta * Math.sin(importanceSample.phi),
        importanceSample.cosTheta
      )
      .inplaceNormalize();
    generateTBN(N, TBN);
    TBN.transform(localSpaceDirection, direction);
    out.setXYZW(direction.x, direction.y, direction.z, importanceSample.pdf);
  }
  function lut(NdotV: number, roughness: number, numSamples: number, out: Vector4) {
    V.setXYZ(Math.sqrt(1 - NdotV * NdotV), 0, NdotV);
    N.setXYZ(0, 0, 1);
    const A = 0;
    const B = 0;
    let C = 0;
    const importanceSample = new Vector4();
    for (let i = 0; i < numSamples; i++) {
      getImportanceSample(i, numSamples, N, roughness, importanceSample);
      H.setXYZ(importanceSample.x, importanceSample.y, importanceSample.z);
      // do reflect L = normalize(reflect(-V, H)) = normalize(-V - 2.0 * dot(H, -V) * H) = normalize(2 * dot(H, V) * H - V)
      Vector3.scale(H, Vector3.dot(V, H) * 2, L)
        .subBy(V)
        .inplaceNormalize();
      const NdotL = Math.min(Math.max(L.z, 0), 1);
      const NdotH = Math.min(Math.max(H.z, 0), 1);
      const VdotH = Math.min(Math.max(Vector3.dot(V, H), 0), 1);
      if (NdotL > 0) {
        const sheenDistribution = distributionCharlie(NdotH, roughness);
        // const sheenVisibility = visibilityAshikhmin(NdotV, NdotL);
        const sheenVisibility = visibilityCharlie(NdotV, NdotL, roughness);
        C += sheenVisibility * sheenDistribution * NdotL * VdotH;
      }
    }
    out.setXYZW(4 * A, 4 * B, 4 * 2 * Math.PI * C, 0).scaleBy(1 / numSamples);
  }

  async function createSheenLUT(): Promise<Texture2D> {
    const tex = getDevice().createTexture2D('rgba8unorm', textureSize, textureSize);
    const image = new Uint8Array(textureSize * textureSize * 4);
    let p = 0;
    const c = new Vector4();
    for (let y = 0; y < textureSize; y++) {
      const coord = Math.min(Math.max((y + 0.5) / textureSize, 0), 1);
      const roughness = coord;
      for (let x = 0; x < textureSize; x++) {
        const NdotV = Math.min(Math.max((x + 0.5) / textureSize, 0), 1);
        // const c = dfvCharlieUniform(NdotV, roughness, 1024);
        // const c = Math.min(Math.max(Math.round(t * 255), 0), 255);
        lut(NdotV, roughness, 1024, c);
        image[p++] = Math.min(Math.max(Math.round(c.x * 255), 0), 255);
        image[p++] = Math.min(Math.max(Math.round(c.y * 255), 0), 255);
        image[p++] = Math.min(Math.max(Math.round(c.z * 255), 0), 255);
        image[p++] = 255;
      }
    }
    tex.update(image, 0, 0, textureSize, textureSize);
    tex.name = `builtin:${BUILTIN_ASSET_TEXTURE_SHEEN_LUT}`;
    return tex;
  }
  */

  //////////////////////////////////////////////////////////////////////////////////////////////////////

  function visibilityAshikhmin(NdotV: number, NdotL: number): number {
    return Math.min(Math.max(1 / (4 * (NdotL + NdotV - NdotL * NdotV)), 0), 1);
  }

  function hemisphereUniformSample(u: Vector2, out: Vector3) {
    const phi = 2 * Math.PI * u.x;
    const cosTheta = 1 - u.y;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    out.setXYZ(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta);
  }

  function dfvCharlieUniform(NdotV: number, roughness: number, numSamples: number): number {
    let r = 0;
    const V = new Vector3(Math.sqrt(1 - NdotV * NdotV), 0, NdotV);
    const u = new Vector2();
    const H = new Vector3();
    const L = new Vector3();
    for (let i = 0; i < numSamples; i++) {
      hammersley(i, 1 / numSamples, u);
      hemisphereUniformSample(u, H);
      Vector3.scale(H, Vector3.dot(V, H) * 2, L).subBy(V);
      const VdotH = Math.min(Math.max(Vector3.dot(V, H), 0), 1);
      const NdotL = Math.min(Math.max(L.z, 0), 1);
      const NdotH = Math.min(Math.max(H.z, 0), 1);
      if (NdotL > 0) {
        const v = visibilityAshikhmin(NdotV, NdotL);
        // const v = visibilityCharlie(NdotV, NdotL, roughness);
        const d = distributionCharlie(NdotH, roughness);
        r += v * d * NdotL * VdotH;
      }
    }
    return r * ((4 * 2 * Math.PI) / numSamples);
  }

  const _tables = (function _generateTables() {
    // float32 to float16 helpers

    const buffer = new ArrayBuffer(4);
    const floatView = new Float32Array(buffer);
    const uint32View = new Uint32Array(buffer);

    const baseTable = new Uint32Array(512);
    const shiftTable = new Uint32Array(512);

    for (let i = 0; i < 256; ++i) {
      const e = i - 127;

      // very small number (0, -0)

      if (e < -27) {
        baseTable[i] = 0x0000;
        baseTable[i | 0x100] = 0x8000;
        shiftTable[i] = 24;
        shiftTable[i | 0x100] = 24;

        // small number (denorm)
      } else if (e < -14) {
        baseTable[i] = 0x0400 >> (-e - 14);
        baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
        shiftTable[i] = -e - 1;
        shiftTable[i | 0x100] = -e - 1;

        // normal number
      } else if (e <= 15) {
        baseTable[i] = (e + 15) << 10;
        baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000;
        shiftTable[i] = 13;
        shiftTable[i | 0x100] = 13;

        // large number (Infinity, -Infinity)
      } else if (e < 128) {
        baseTable[i] = 0x7c00;
        baseTable[i | 0x100] = 0xfc00;
        shiftTable[i] = 24;
        shiftTable[i | 0x100] = 24;

        // stay (NaN, Infinity, -Infinity)
      } else {
        baseTable[i] = 0x7c00;
        baseTable[i | 0x100] = 0xfc00;
        shiftTable[i] = 13;
        shiftTable[i | 0x100] = 13;
      }
    }

    // float16 to float32 helpers

    const mantissaTable = new Uint32Array(2048);
    const exponentTable = new Uint32Array(64);
    const offsetTable = new Uint32Array(64);

    for (let i = 1; i < 1024; ++i) {
      let m = i << 13; // zero pad mantissa bits
      let e = 0; // zero exponent

      // normalized
      while ((m & 0x00800000) === 0) {
        m <<= 1;
        e -= 0x00800000; // decrement exponent
      }

      m &= ~0x00800000; // clear leading 1 bit
      e += 0x38800000; // adjust bias

      mantissaTable[i] = m | e;
    }

    for (let i = 1024; i < 2048; ++i) {
      mantissaTable[i] = 0x38000000 + ((i - 1024) << 13);
    }

    for (let i = 1; i < 31; ++i) {
      exponentTable[i] = i << 23;
    }

    exponentTable[31] = 0x47800000;
    exponentTable[32] = 0x80000000;

    for (let i = 33; i < 63; ++i) {
      exponentTable[i] = 0x80000000 + ((i - 32) << 23);
    }

    exponentTable[63] = 0xc7800000;

    for (let i = 1; i < 64; ++i) {
      if (i !== 32) {
        offsetTable[i] = 1024;
      }
    }

    return {
      floatView: floatView,
      uint32View: uint32View,
      baseTable: baseTable,
      shiftTable: shiftTable,
      mantissaTable: mantissaTable,
      exponentTable: exponentTable,
      offsetTable: offsetTable
    };
  })();

  function encodeF16(val: number): number {
    val = Math.min(Math.max(val, -65504), 65504);
    _tables.floatView[0] = val;
    const f = _tables.uint32View[0];
    const e = (f >> 23) & 0x1ff;
    return _tables.baseTable[e] + ((f & 0x007fffff) >> _tables.shiftTable[e]);
  }

  /*
  function decodeF16(val: number) {
    const exponent = (val & 0x7c00) >> 10;
    const fraction = val & 0x03ff;
    return (
      (val >> 15 ? -1 : 1) *
      (exponent
        ? exponent === 0x1f
          ? fraction
            ? NaN
            : Infinity
          : Math.pow(2, exponent - 15) * (1 + fraction / 0x400)
        : 6.103515625e-5 * (fraction / 0x400))
    );
  }
  */

  function createSheenLUTFilament(assetManager: AssetManager, texture?: BaseTexture): Texture2D {
    if (texture) {
      if (!texture.isTexture2D()) {
        throw new Error('can not reload sheen lut texture: invalid texture type');
      }
      if (texture.format !== 'rgba16f') {
        throw new Error('can not reload sheen lut texture: invalid texture format');
      }
      if (texture.width !== textureSize || texture.height !== textureSize) {
        throw new Error('can not reload sheen lut texture: invalid texture size');
      }
    }
    const tex = (texture as Texture2D) || getDevice().createTexture2D('rgba16f', textureSize, textureSize);
    const image = new Uint16Array(textureSize * textureSize * 4);
    let p = 0;
    const one = encodeF16(1);
    for (let y = textureSize - 1; y >= 0; y--) {
      const coord = Math.min(Math.max((y + 0.5) / textureSize, 0), 1);
      const roughness = coord * coord;
      for (let x = 0; x < textureSize; x++) {
        const NdotV = Math.min(Math.max((x + 0.5) / textureSize, 0), 1);
        const c = dfvCharlieUniform(NdotV, roughness, 512);
        const f16 = encodeF16(c);
        image[p++] = 0;
        image[p++] = 0;
        image[p++] = f16;
        image[p++] = one;
      }
    }
    tex.update(image, 0, 0, textureSize, textureSize);
    tex.name = `builtin:${BUILTIN_ASSET_TEXTURE_SHEEN_LUT}`;
    return tex;
  }

  return createSheenLUTFilament;
}
