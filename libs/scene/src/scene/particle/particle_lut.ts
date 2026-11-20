import type { Interpolator, Nullable } from '@zephyr3d/base';
import type { ParticleGradient } from './particle_modules';

/** Samples per curve over the normalized age 0..1 */
export const PARTICLE_LUT_SIZE = 64;

const tmp4 = new Float32Array(4);

/**
 * The curves over a particle's life baked into tables, read the same way by both backends: 64
 * colors (rgba) followed by 64 scalar rows (x: size factor; y, z, w spare), each interpolated
 * linearly between the samples.
 * @internal
 */
export class ParticleLUT {
  /** 128 vec4, the layout uploaded to the GPU */
  readonly data: Float32Array<ArrayBuffer>;
  constructor() {
    this.data = new Float32Array(PARTICLE_LUT_SIZE * 8);
    this.bake(null, null);
  }
  /**
   * Bakes the curves
   * @param size - Size factor curve, 1 if null
   * @param color - Color gradient, white if null
   */
  bake(size: Nullable<Interpolator>, color: Nullable<ParticleGradient>) {
    const data = this.data;
    const rgb = color?.rgb ?? null;
    const alpha = color?.alpha ?? null;
    for (let i = 0; i < PARTICLE_LUT_SIZE; i++) {
      const t = i / (PARTICLE_LUT_SIZE - 1);
      let r = 1;
      let g = 1;
      let b = 1;
      let a = 1;
      if (rgb && rgb.inputs.length > 0) {
        tmp4.fill(1);
        rgb.interpolate(t, tmp4);
        r = tmp4[0];
        g = rgb.stride > 1 ? tmp4[1] : r;
        b = rgb.stride > 2 ? tmp4[2] : r;
        if (rgb.stride > 3 && !alpha) {
          a = tmp4[3];
        }
      }
      if (alpha && alpha.inputs.length > 0) {
        alpha.interpolate(t, tmp4);
        a = tmp4[0];
      }
      data[i * 4 + 0] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = a;
      let s = 1;
      if (size && size.inputs.length > 0) {
        size.interpolate(t, tmp4);
        s = tmp4[0];
      }
      const o = (PARTICLE_LUT_SIZE + i) * 4;
      data[o + 0] = s;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
    }
  }
  /** Largest size factor, for the bounds */
  get maxSize() {
    let m = 0;
    for (let i = 0; i < PARTICLE_LUT_SIZE; i++) {
      m = Math.max(m, Math.abs(this.data[(PARTICLE_LUT_SIZE + i) * 4]));
    }
    return m;
  }
}
