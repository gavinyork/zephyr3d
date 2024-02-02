import { vec4 } from 'gl-matrix';

import { eix } from '../fft';

export const reverseBits = (v: number, width: number): number =>
  parseInt(v.toString(2).padStart(width, '0').split('').reverse().join(''), 2);

export const createButterflyTexture = (size: number): Float32Array => {
  const width = Math.log2(size);
  const height = size;
  const texture = new Float32Array(width * height * 4);
  const w = (2.0 * Math.PI) / size;
  const bitReversed = [...Array(size).keys()].map((v) => reverseBits(v, width));

  for (let j = 0; j < width; j++) {
    for (let i = 0; i < height; i++) {
      const k = i * (size >> (j + 1));
      const twiddle = eix(k * w);
      const span = 2 ** j;
      const wing = i % 2 ** (j + 1) < span ? 0 : 1; // 0 - top wing, 1 - bottom wing
      const texel = vec4.create();
      if (j === 0) {
        if (wing === 0) {
          vec4.set(
            texel,
            twiddle[0],
            twiddle[1],
            bitReversed[i],
            bitReversed[i + 1]
          );
        } else {
          vec4.set(
            texel,
            twiddle[0],
            twiddle[1],
            bitReversed[i - 1],
            bitReversed[i]
          );
        }
      } else {
        if (wing === 0) {
          vec4.set(texel, twiddle[0], twiddle[1], i, i + span);
        } else {
          vec4.set(texel, twiddle[0], twiddle[1], i - span, i);
        }
      }

      texture[(width * i + j) * 4] = texel[0];
      texture[(width * i + j) * 4 + 1] = texel[1];
      texture[(width * i + j) * 4 + 2] = texel[2];
      texture[(width * i + j) * 4 + 3] = texel[3];
    }
  }
  return texture;
};
