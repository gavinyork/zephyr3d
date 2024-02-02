export interface IntegratorInterface {
  integrate(
    out: Float32Array,
    x: Float32Array,
    dxdt: Float32Array,
    dt: number
  ): void;
}
