import { IntegratorInterface } from '../interfaces';
import { VpVxS } from '../math';

export class EulerIntegrator implements IntegratorInterface {
  integrate(
    out: Float32Array,
    x: Float32Array,
    dxdt: Float32Array,
    dt: number
  ): void {
    VpVxS(out, x, dxdt, dt);
  }
}
