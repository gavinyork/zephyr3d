import { vec2 } from 'gl-matrix';

import { createMockGpu } from '../graphics/gpu.mock';
import { OceanFieldBuilder } from './ocean-field-builder';
import { float4ToComplex2d, ifft2, abs, sub, im } from '../fft';

export const testOceanFieldIfft2 = () => {
  const gpu = createMockGpu();
  const builder = new OceanFieldBuilder(gpu);
  const oceanField = builder.build({
    alignment: 0.0,
    resolution: 512,
    wind: vec2.fromValues(28.0, 28.0),
    randomSeed: 0,
  });

  // Arrange
  const framebuffer = gpu.createRenderTarget();
  const buffer = new Float32Array(
    oceanField.params.resolution *
      oceanField.params.resolution *
      4
  );

  for (let slot of [0, 1, 2, 3, 4, 5]) {
    for (let couple of [0, 1]) {
      oceanField['generateSpectrum'](performance.now());
      gpu.readValues(
        oceanField['spectrumFramebuffer'],
        buffer,
        oceanField.params.resolution,
        oceanField.params.resolution,
        WebGL2RenderingContext.RGBA,
        WebGL2RenderingContext.FLOAT,
        slot
      );

      const expected = ifft2(
        float4ToComplex2d(
          buffer,
          oceanField.params.resolution,
          couple * 2
        )
      ).flat(1);

      // Act
      oceanField['ifft2']();
      gpu.attachTexture(
        framebuffer,
        oceanField['ifftTextures'][slot],
        0
      );
      gpu.readValues(
        framebuffer,
        buffer,
        oceanField.params.resolution,
        oceanField.params.resolution,
        WebGL2RenderingContext.RGBA,
        WebGL2RenderingContext.FLOAT,
        0
      );

      const actual = float4ToComplex2d(
        buffer,
        oceanField.params.resolution,
        couple * 2
      ).flat(1);

      // Assert
      const diff = actual.map((a, i) => abs(sub(a, expected[i])));
      const closeEnougth = diff.every((v) => v <= 1.0e-5);
      if (!closeEnougth) {
        console.warn(
          `testOceanFieldIfft2 [slot ${slot}-${couple}]: Test don't passesd: `,
          diff
        );
        return;
      }
      console.log(`testOceanFieldIfft2 [slot ${slot}-${couple}]: Test passed!`);
    }
  }
};
