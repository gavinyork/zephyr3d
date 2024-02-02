import { vec2 } from 'gl-matrix';
import { merge } from 'lodash-es';

import { createMockGpu } from '../graphics/gpu.mock';
import { OceanFieldBuilder } from './ocean-field-builder';
import {
  float4ToComplex2d,
  ifft2,
  im,
  eix,
  add,
  mult,
  conj,
  complex,
} from '../fft';
import {
  OceanFieldBuildParams,
  defaultBuildParams,
} from './ocean-field-build-params';

export const testOceanFieldBuilderHermitianSpectrum = () => {
  // Arrange
  const gpu = createMockGpu();
  const builder = new OceanFieldBuilder(gpu);
  const framebuffer = gpu.createRenderTarget();
  const params: OceanFieldBuildParams = merge({}, defaultBuildParams, {
    alignment: 0.01,
    resolution: 512,
    wind: vec2.fromValues(21.0, 24.7),
    randomSeed: 0,
    cascades: [
      {
        size: 100.0,
        strength: 3e12,
      },
      {
        size: 200.0,
        strength: 2e12,
      },
      {
        size: 300.0,
        strength: 1e12,
      },
    ],
  });
  const buffer = new Float32Array(params.resolution ** 2 * 4);
  const h0textures = builder['createH0Textures'](params.resolution);
  gpu.attachTextures(framebuffer, h0textures);

  const bounds = (array: number[]) => {
    return array.reduce(
      (acc, curr) => {
        if (curr < acc[0]) {
          acc[0] = curr;
        }
        if (curr > acc[1]) {
          acc[1] = curr;
        }
        return acc;
      },
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
    );
  };

  // Act
  builder['generateInitialSpectrum'](h0textures, params);

  // Assert
  for (let slot = 0; slot < h0textures.length; slot++) {
    gpu.readValues(
      framebuffer,
      buffer,
      params.resolution,
      params.resolution,
      WebGL2RenderingContext.RGBA,
      WebGL2RenderingContext.FLOAT,
      slot
    );

    const t = 36000;
    const h0 = float4ToComplex2d(buffer, params.resolution, 0);
    const h0MinConj = float4ToComplex2d(buffer, params.resolution, 2);

    const h = h0.map((row, i) => {
      return row.map((h0, j) => {
        const k = vec2.fromValues(
          j - params.resolution / 2,
          i - params.resolution / 2
        );
        const kLen = vec2.len(k);
        if (i !== 0 && j !== 0) {
          const w = Math.sqrt(9.8 * kLen);
          const e = eix(t * w);
          return add(mult(h0, e), mult(h0MinConj[i][j], conj(e)));
        } else {
          return complex(0.0, 0.0);
        }
      });
    });

    const signal = ifft2(h).flat(1);
    const isCloseToReal = signal.every((v) => Math.abs(im(v)) <= 1.0e-10);

    if (!isCloseToReal) {
      const [min, max] = bounds(signal.map((e) => im(e)));
      console.warn(
        `testOceanFieldBuilderHermitianSpectrum [slot ${slot}]: Test didn't pass: [min: ${min}, max: ${max}]`
      );
      return;
    }
    console.log(
      `testOceanFieldBuilderHermitianSpectrum [slot ${slot}]: Test passed!`
    );
  }
};
