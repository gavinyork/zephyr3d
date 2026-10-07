// half.test.ts
import { half2float, float2half } from '@zephyr3d/base'; // 路径按实际修改

// half 常量方便阅读
const H_POS_ZERO = 0x0000;
const H_NEG_ZERO = 0x8000;
const H_POS_INF = 0x7c00;
const H_NEG_INF = 0xfc00;
const H_NAN = 0x7e00; // 一个典型的 NaN（实现会保留部分 payload）

describe('half2float', () => {
  // [half bits, expected float]
  test.each([
    [H_POS_ZERO, 0],
    [H_POS_INF, Infinity],
    [H_NEG_INF, -Infinity],
    [0x0001, Math.pow(2, -24)], // smallest positive subnormal
    [0x03ff, Math.pow(2, -14) * (1023 / 1024)], // largest subnormal
    [0x0400, Math.pow(2, -14)], // smallest positive normal
    [0x3c00, 1],
    [0xc000, -2],
    [0x7bff, 65504] // max finite half
  ])('0x%s', (h, expected) => {
    const v = half2float(h);
    if (Number.isFinite(expected)) {
      expect(v).toBeCloseTo(expected, expected > 1000 ? 0 : 2);
    } else {
      expect(v).toBe(expected);
    }
  });

  test('negative zero and NaN', () => {
    expect(Object.is(half2float(H_NEG_ZERO), -0)).toBe(true);
    expect(Number.isNaN(half2float(H_NAN))).toBe(true);
  });
});

describe('float2half', () => {
  // [float, expected half bits]
  test.each([
    [0, H_POS_ZERO],
    [-0, H_NEG_ZERO],
    [Infinity, H_POS_INF],
    [-Infinity, H_NEG_INF],
    [1, 0x3c00],
    [-2, 0xc000],
    [65504, 0x7bff], // largest finite half does not overflow
    [70000, H_POS_INF], // larger values overflow to Inf
    [-70000, H_NEG_INF],
    [Math.pow(2, -30), H_POS_ZERO], // below the smallest subnormal underflows to 0
    [1.0009765625, 0x3c01] // one half step above 1 is kept, not rounded away
  ])('%s', (f, expected) => {
    expect(float2half(f)).toBe(expected);
  });

  test('NaN produces a NaN half pattern (exponent all 1, fraction non-zero)', () => {
    const h = float2half(NaN);
    expect((h & 0x7c00) === 0x7c00).toBe(true);
    expect((h & 0x03ff) !== 0).toBe(true);
  });
});

describe('round-trip conversions', () => {
  test('float -> half -> float (允许精度损失)', () => {
    const cases: number[] = [
      0,
      -0,
      1,
      -1,
      0.5,
      -0.5,
      2,
      -2,
      3.1415926,
      1e-5,
      1e-4,
      1e-3,
      1e2,
      1e3,
      65504, // max finite half
      -65504
    ];

    for (const x of cases) {
      const h = float2half(x);
      const back = half2float(h);

      if (!Number.isFinite(x)) {
        continue;
      }

      const abs = Math.abs(x);
      const diff = Math.abs(back - x);

      if (abs === 0) {
        // 对 0，区分 +0 / -0
        expect(Object.is(back, x)).toBe(true);
      } else if (abs < 1e-3) {
        // 非常小的数，half 精度很粗，可能直接量化到 0
        expect(diff).toBeLessThan(1e-4);
      } else {
        const relErr = diff / abs;
        expect(relErr).toBeLessThan(1e-3);
      }
    }
  });

  test('half -> float -> half 数值保持一致', () => {
    const halfValues = [
      0x0000, // +0
      0x8000, // -0
      0x7c00, // +Inf
      0xfc00, // -Inf
      0x0001, // smallest subnormal
      0x03ff, // largest subnormal
      0x0400, // smallest normal
      0x3c00, // 1.0
      0xc000, // -2.0
      0x7bff // max finite
    ];

    for (const h of halfValues) {
      const f = half2float(h);
      const back = float2half(f);

      // Do not test NaN
      const isNaNHalf = (h & 0x7c00) === 0x7c00 && (h & 0x03ff) !== 0;
      if (isNaNHalf) {
        continue;
      }

      const again = half2float(back);

      if ((h & 0x7fff) === 0) {
        // ±0：保符号
        expect(Object.is(again, half2float(h))).toBe(true);
      } else if ((h & 0x7c00) === 0x7c00) {
        // ±Infinity：保持 Infinity
        const orig = half2float(h);
        expect(again).toBe(orig);
      } else {
        // 有限非零数：比较值，允许半精度量化误差
        const orig = half2float(h);
        const abs = Math.abs(orig);
        const diff = Math.abs(again - orig);

        if (abs < 1e-3) {
          expect(diff).toBeLessThan(1e-4);
        } else {
          const relErr = diff / abs;
          expect(relErr).toBeLessThan(1e-3);
        }
      }
    }
  });

  test('NaN half -> float -> half 仍然为 NaN', () => {
    const nanHalfs = [
      0x7e00, // quiet-NaN
      0x7fff, // signalling/quiet
      0xfe00 // signed NaN
    ];

    for (const h of nanHalfs) {
      const f = half2float(h);
      expect(Number.isNaN(f)).toBe(true);

      const back = float2half(f);
      expect((back & 0x7c00) === 0x7c00).toBe(true);
      expect((back & 0x03ff) !== 0).toBe(true);
    }
  });
});
