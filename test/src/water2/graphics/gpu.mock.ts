import { Gpu } from './gpu';

let mock: Gpu = null;
export const createMockGpu = (): Gpu =>
  mock ??
  (mock = new Gpu(document.createElement('canvas').getContext('webgl2')));
