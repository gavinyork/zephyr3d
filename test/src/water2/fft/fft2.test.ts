import { vec2 } from 'gl-matrix';
import {
  abs,
  add,
  mult,
  Complex,
  complex,
  sub,
  eix,
  conj,
  im,
} from './complex';
import { dft2, fft2, idft2, ifft2 } from './fft2';

export const testDft2 = () => {
  for (let pow of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const size = 1 << pow;
    const signal: Complex[][] = [...Array(size).keys()].map(() =>
      [...Array(size).keys()]
        .map(() => Math.random() * 2.0 - 1.0)
        .map((v) => complex(v, 0.0))
    );

    // Act
    const fourier = dft2(signal);
    const inverse = idft2(fourier);

    // Assert
    const sf = signal.flat();
    const iftf = inverse.flat();

    const diff = sf.map((v, i) => abs(sub(v, iftf[i])));
    const closeEnougth = diff.every((v) => v <= 1.0e-5);
    if (!closeEnougth) {
      console.warn("testDft2: Test don't passesd: ", diff);
      return;
    }
  }

  console.log('testDft2: Test passed!');
};

export const testFft2 = () => {
  for (let pow of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const size = 1 << pow;
    const signal: Complex[][] = [...Array(size).keys()].map(() =>
      [...Array(size).keys()]
        .map(() => Math.random() * 2.0 - 1.0)
        .map((v) => complex(v, 0.0))
    );

    // Act
    const fourier = fft2(signal);
    const inverse = ifft2(fourier);

    // Assert
    const sf = signal.flat();
    const iftf = inverse.flat();

    const diff = sf.map((v, i) => abs(sub(v, iftf[i])));
    const closeEnougth = diff.every((v) => v <= 1.0e-5);
    if (!closeEnougth) {
      console.warn("testFft2: Test don't passesd: ", diff);
      return;
    }
  }

  console.log('testFft2: Test passed!');
};

export const testFft2Combined = () => {
  const I = complex(0.0, 1.0);

  for (let pow of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const size = 1 << pow;
    const signal0: Complex[][] = [...Array(size).keys()].map(() =>
      [...Array(size).keys()]
        .map(() => Math.random() * 2.0 - 1.0)
        .map((v) => complex(v, 0.0))
    );
    const signal1: Complex[][] = [...Array(size).keys()].map(() =>
      [...Array(size).keys()]
        .map(() => Math.random() * 2.0 - 1.0)
        .map((v) => complex(v, 0.0))
    );

    // Act
    const spectrum0 = fft2(signal0);
    const spectrum1 = fft2(signal1);
    const combined: Complex[][] = [];
    for (let i = 0; i < size; i++) {
      const row: Complex[] = [];
      for (let j = 0; j < size; j++) {
        row.push(add(spectrum0[i][j], mult(I, spectrum1[i][j])));
      }
      combined.push(row);
    }

    const inverse = ifft2(combined);

    // Assert
    const s0f = signal0.flat(2).filter((v) => v !== 0.0);
    const s1f = signal1.flat(2).filter((v) => v !== 0.0);
    const ifftf = inverse.flat();

    const diff = ifftf.map((v, i) => abs(sub(v, complex(s0f[i], s1f[i]))));
    const closeEnougth = diff.every((v) => v <= 1.0e-5);
    if (!closeEnougth) {
      console.warn("testFft2Combined: Test don't passesd: ", diff);
      return;
    }
  }

  console.log('testFft2Combined: Test passed!');
};

export const testFft2Hermitian = () => {
  for (let pow of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const size = 1 << pow;

    const spectrum: Complex[][] = [];
    const A = 1.0;
    const wind = vec2.fromValues(4.0, 4.0);
    const g = 9.8;
    const L = vec2.dot(wind, wind) / g;
    const L2 = L * L;

    for (let i = 0; i < size; i++) {
      const row: Complex[] = [];
      for (let j = 0; j < size; j++) {
        const x = vec2.fromValues(j, i);
        vec2.sub(x, x, vec2.fromValues(size * 0.5, size * 0.5));
        const k = vec2.scale(x, x, (2.0 * Math.PI) / size);
        const kLen = vec2.len(k);
        const w = Math.sqrt(g * kLen);
        const h0k = Math.sqrt(
          (A / kLen ** 4) * Math.exp(-1.0 / (kLen * kLen * L2)) * 0.5
        );

        const h0 = complex(h0k, h0k);

        if (kLen === 0) {
          row.push(complex(0.0, 0.0));
        } else {
          row.push(add(mult(h0, eix(-w)), mult(conj(h0), eix(w))));
        }
      }

      spectrum.push(row);
    }
    // Act
    const inverse = ifft2(spectrum);

    // Assert
    const ifftf = inverse.flat();
    const _im = ifftf.map((v) => im(v));
    const isReal = _im.every((v) => Math.abs(v) <= 1.0e-6);
    if (!isReal) {
      console.warn(`testFft2Hermitian: Test don't pass`);
      return;
    }
  }

  console.log('testFft2Hermitian: Test passed!');
};
