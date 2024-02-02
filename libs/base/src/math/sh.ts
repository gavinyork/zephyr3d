import { Vector3 } from "./vector";

/**
 * Spherical harmonics utilities
 * 
 * @public
 */
export class SH {
  /** Minimum supported harmonics order */
  static readonly MIN_ORDER = 2;
  /** Maximum supported harmonics order */
  static readonly MAX_ORDER = 3;
  /**
   * Evaluate SH basis for specific order
   * 
   * @param direction - Direction to evaluate, must be normalized
   * @param order - SH order
   * 
   * @returns The SH basis evaluate at given direction
   */
  static evalBasis(direction: Vector3, order: number): number[] {
    if (order < this.MIN_ORDER || order > this.MAX_ORDER) {
      throw new Error(`SH.evalBasis(): order must between ${this.MIN_ORDER} and ${this.MAX_ORDER}`);
    }
    const x = direction.x;
    const y = direction.y;
    const z = direction.z;
    const out: number[] = [];
    // L=0, M=0
    out[0] = 0.28209479177387814;
    if (order >= 2) {
      // L=1, M=-1
      out[1] = -0.48860251190291992 * y;
      // L=1, M=0
      out[2] = 0.4886025119 * z;
      // L=1, M=1
      out[3] = -0.4886025119 * x;
    }
    if (order >= 3) {
      // L=2, M=-2
      out[4] = 1.0925484306 * x * y;
      // L=2, M=-1
      out[5] = -1.0925484306 * y * z;
      // L=2, M=0
      out[6] = 0.9461746956 * z * z + -0.3153915652
      // L=2, M=1
      out[7] = -1.0925484306 * x * z;
      // L=2, M=2
      out[8] = 0.5462742153 * (x * x - y * y);
    }
    return out;
  }
  /**
   * Evaluates a directional light and returns spectral SH data
   * 
   * @param direction - Direction of the light
   * @param color - Light color
   * @param order - SH order
   * 
   * @returns Evaluated SH data
   */
  static evalDirectionLight(direction: Vector3, color: Vector3, order: number): Vector3[] {
    if (order < this.MIN_ORDER || order > this.MAX_ORDER) {
      throw new Error(`SH.evalBasis(): order must between ${this.MIN_ORDER} and ${this.MAX_ORDER}`);
    }
    const tmp = this.evalBasis(direction, order);

    let cosWtInt = 0.75;
    if (order > 2) {
      cosWtInt += 5.0 / 16.0;
    }
    const fNorm = Math.PI / cosWtInt;
    const colorScale = Vector3.scale(color, fNorm);
    const result: Vector3[] = [];
    for (let i = 0; i < order * order; i++) {
      result[i] = Vector3.scale(colorScale, tmp[i]);
    }
    return result;
  }
}
  
  