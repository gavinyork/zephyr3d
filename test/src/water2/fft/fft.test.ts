import { abs, complex, re, sub } from './complex';
import { dft, fft, idft, ifft } from './fft';

export const testFft = () => {
  for (let pow of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const size = 1 << pow;
    const signal = [...Array(size).keys()]
      .map(() => Math.random() * 2.0 - 1.0)
      .map((v) => complex(v, 0.0));

    // Act
    const fourier = fft(signal);
    const inverse = ifft(fourier);

    // Assert
    const diff = inverse.map((v, i) => abs(sub(v, signal[i])));
    const closeEnougth = diff.every((v) => v <= 1.0e-5);
    if (!closeEnougth) {
      console.warn("testFft: Test don't passesd: ", diff);
      return;
    }
  }

  console.log('testFft: Test passed!');
};

export const testDft = () => {
  for (let pow of [1, 2, 3, 4, 5, 6, 7, 8]) {
    // Arrange
    const size = 1 << pow;
    const signal = [...Array(size).keys()]
      .map(() => Math.random() * 2.0 - 1.0)
      .map((v) => complex(v, 0.0));

    // Act
    const fourier = dft(signal);
    const inverse = idft(fourier);

    // Assert
    const diff = inverse.map((v, i) => abs(sub(v, signal[i])));
    const closeEnougth = diff.every((v) => v <= 1.0e-5);
    if (!closeEnougth) {
      console.warn("testDft: Test don't passesd: ", diff);
      return;
    }
  }

  console.log('testDft: Test passed!');
};
