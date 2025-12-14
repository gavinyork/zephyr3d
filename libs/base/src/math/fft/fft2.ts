import type { Complex } from './complex';
import { complex } from './complex';
import { dft, fft, idft, ifft } from './fft';

/**
 *
 */
export const dft2 = (signal: Complex[][]): Complex[][] => {
  const n = signal.length;
  const m = signal?.[0].length;

  const fourier: Complex[][] = [];

  // Horizontal DFT
  for (let i = 0; i < m; i++) {
    fourier.push(dft(signal[i]));
  }

  // Vertical DFT
  const col = new Array<Complex>(m);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      col[i] = fourier[i][j];
    }
    const f = dft(col);

    for (let i = 0; i < m; i++) {
      fourier[i][j] = f[i];
    }
  }

  return fourier;
};

export const idft2 = (fourier: Complex[][]): Complex[][] => {
  const n = fourier.length;
  const m = fourier?.[0].length;
  const signal: Complex[][] = [...Array(m).keys()].map(() => []);

  // Vertical IDFT
  const col = new Array<Complex>(m);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      col[i] = fourier[i][j];
    }
    const f = idft(col);

    for (let i = 0; i < m; i++) {
      signal[i].push(f[i]);
    }
  }

  // Horizontal IDFT
  for (let i = 0; i < m; i++) {
    signal[i] = idft(signal[i]);
  }

  return signal;
};

export const fft2 = (signal: Complex[][]): Complex[][] => {
  const n = signal.length;
  const m = signal?.[0].length;

  const fourier: Complex[][] = [];

  // Horizontal DFT
  for (let i = 0; i < m; i++) {
    fourier.push(fft(signal[i]));
  }

  // Vertical DFT
  const col = new Array<Complex>(m);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      col[i] = fourier[i][j];
    }
    const f = fft(col);

    for (let i = 0; i < m; i++) {
      fourier[i][j] = f[i];
    }
  }

  return fourier;
};

export const ifft2 = (fourier: Complex[][]): Complex[][] => {
  const n = fourier.length;
  const m = fourier?.[0].length;
  const signal: Complex[][] = [...Array(m).keys()].map(() => []);

  // Vertical IDFT
  const col = new Array<Complex>(m);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      col[i] = fourier[i][j];
    }
    const f = ifft(col);

    for (let i = 0; i < m; i++) {
      signal[i].push(f[i]);
    }
  }

  // Horizontal IDFT
  for (let i = 0; i < m; i++) {
    signal[i] = ifft(signal[i]);
  }

  return signal;
};

export const float4ToComplex2d = (data: Float32Array, size: number, offset = 0): Complex[][] => {
  const result: Complex[][] = [];
  for (let i = 0; i < size; i++) {
    const row: Complex[] = [];
    for (let j = 0; j < size; j++) {
      const re = data[(i * size + j) * 4 + offset];
      const im = data[(i * size + j) * 4 + 1 + offset];
      row.push(complex(re, im));
    }
    result.push(row);
  }
  return result;
};
