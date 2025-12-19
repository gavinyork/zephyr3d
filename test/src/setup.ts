import { numberEquals } from './mathtest/common';

expect.extend({
  toBeNear(received: number, expected: number, tol = 0.01) {
    const pass = numberEquals(received, expected, tol);
    if (pass) {
      return {
        pass: true,
        message: () => `Expected ${received} not to be near ${expected} within ${tol}`
      };
    } else {
      return {
        pass: false,
        message: () =>
          `Expected ${received} to be near ${expected} within ${tol}, ` + `diff = ${received - expected}`
      };
    }
  }
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeNear(expected: number, tol?: number): R;
    }
  }
}
