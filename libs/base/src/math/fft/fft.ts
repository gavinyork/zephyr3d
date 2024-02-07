import type { Complex} from './complex';
import { add, complex, eix, mult, scale } from './complex';

/**
 * Discrete fourier transform
 * @param signal Signal to transform into fourier complex coefficients
 * @return Fourier coefficients
 */
export const dft = (signal: Complex[]): Complex[] => {
  const n = signal.length;
  const fhat = new Array<Complex>(n);
  const coeff = (-2 * Math.PI) / n;
  for (let k = 0, k1 = n; k < k1; k++) {
    fhat[k] = complex(0.0, 0.0);
    for (let j = 0; j < n; j++) {
      fhat[k] = add(fhat[k], mult(eix(coeff * k * j), signal[j]));
    }
  }
  return fhat;
};

/**
 * Inverse discrete fourier transform
 * @param fourier Fourier coefficients to restore signal from
 * @return Sourse signal as complex samples (Actualy signal will be stored in real part of samples)
 */
export const idft = (fourier: Complex[]): Complex[] => {
  const n = fourier.length;
  const fhat = new Array<Complex>(n);
  const coeff = (2 * Math.PI) / n;
  for (let k = 0, k1 = n; k < k1; k++) {
    fhat[k] = complex(0.0, 0.0);
    for (let j = 0; j < n; j++) {
      fhat[k] = add(fhat[k], mult(eix(coeff * k * j), fourier[j]));
    }
    fhat[k] = scale(fhat[k], 1 / n);
  }
  return fhat;
};

/**
 * Fast fourier transform. nlog(n) implementaion if discrete transform.
 * @param signal Signal to transform into fourier complex coefficients. Should be power of 2
 * @return Fourier coefficients
 */
export const fft = (signal: Complex[]): Complex[] => {
  if (signal.length <= 2) {
    return dft(signal);
  } else {
    const n = signal.length;
    const n2 = n / 2;
    const even = new Array<Complex>(n2);
    const odd = new Array<Complex>(n2);
    for (let i = 0, e = 0, o = 0; i < n; i++) {
      if (i % 2 === 0) {
        even[e++] = signal[i];
      } else {
        odd[o++] = signal[i];
      }
    }

    const evenFft = fft(even);
    const oddFft = fft(odd);
    const fhat = new Array<Complex>(n);
    const coeff = (-2 * Math.PI) / n;
    for (let k = 0; k < n; k++) {
      fhat[k] = add(evenFft[k % n2], mult(oddFft[k % n2], eix(coeff * k)));
    }
    return fhat;
  }
};

/**
 * Inverse fast fourier transform.
 * @param fourier Fourier coefficients to restore signal from
 * @return Sourse signal as complex samples (Actualy signal will be stored in real part of samples)
 */
export const ifft = (fourier: Complex[]): Complex[] => {
  if (fourier.length <= 2) {
    return idft(fourier);
  } else {
    const n = fourier.length;
    const n2 = n / 2;
    const even = new Array<Complex>(n2);
    const odd = new Array<Complex>(n2);
    for (let i = 0, e = 0, o = 0; i < n; i++) {
      if (i % 2 === 0) {
        even[e++] = fourier[i];
      } else {
        odd[o++] = fourier[i];
      }
    }

    const evenFft = ifft(even);
    const oddFft = ifft(odd);
    const fhat = new Array<Complex>(n);
    const coeff = (2 * Math.PI) / n;
    for (let k = 0; k < n; k++) {
      fhat[k] = scale(
        add(evenFft[k % n2], mult(oddFft[k % n2], eix(coeff * k))),
        0.5
      );
    }
    return fhat;
  }
};
