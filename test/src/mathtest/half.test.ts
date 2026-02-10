// half.test.ts
import { half2float, float2half } from '@zephyr3d/base'; // 路径按实际修改

// half 常量方便阅读
const H_POS_ZERO = 0x0000;
const H_NEG_ZERO = 0x8000;
const H_POS_INF = 0x7c00;
const H_NEG_INF = 0xfc00;
const H_NAN = 0x7e00; // 一个典型的 NaN（实现会保留部分 payload）

describe('half2float', () => {
  test('zero (positive and negative)', () => {
    expect(half2float(H_POS_ZERO)).toBe(0);
    expect(Object.is(half2float(H_NEG_ZERO), -0)).toBe(true);
  });

  test('infinities', () => {
    expect(half2float(H_POS_INF)).toBe(Infinity);
    expect(half2float(H_NEG_INF)).toBe(-Infinity);
  });

  test('NaN', () => {
    const v = half2float(H_NAN);
    expect(Number.isNaN(v)).toBe(true);
  });

  test('smallest positive subnormal (0x0001)', () => {
    // 2^-14 * (1 / 2^10) = 2^-24
    const v = half2float(0x0001);
    expect(v).toBeCloseTo(Math.pow(2, -24));
  });

  test('largest subnormal (0x03ff)', () => {
    // 2^-14 * (1023 / 1024)
    const v = half2float(0x03ff);
    expect(v).toBeCloseTo(Math.pow(2, -14) * (1023 / 1024));
  });

  test('smallest positive normal (0x0400)', () => {
    // e = 1, f = 0 -> 2^-14 * 1
    const v = half2float(0x0400);
    expect(v).toBeCloseTo(Math.pow(2, -14));
  });

  test('1.0 (0x3c00)', () => {
    const v = half2float(0x3c00);
    expect(v).toBeCloseTo(1.0);
  });

  test('negative 2.0 (-2.0 -> 0xc000)', () => {
    const v = half2float(0xc000);
    expect(v).toBeCloseTo(-2.0);
  });

  test('max finite half (0x7bff)', () => {
    // 最大正规半精度 (~65504)
    const v = half2float(0x7bff);
    expect(v).toBeCloseTo(65504, 0);
  });
});

describe('float2half', () => {
  test('zero (positive and negative)', () => {
    expect(float2half(0)).toBe(H_POS_ZERO);
    expect(float2half(-0)).toBe(H_NEG_ZERO);
  });

  test('infinities', () => {
    expect(float2half(Infinity)).toBe(H_POS_INF);
    expect(float2half(-Infinity)).toBe(H_NEG_INF);
  });

  test('NaN produces a NaN half pattern (exponent all 1, fraction non-zero)', () => {
    const h = float2half(NaN);
    expect((h & 0x7c00) === 0x7c00).toBe(true); // exponent all 1
    expect((h & 0x03ff) !== 0).toBe(true); // fraction non-zero
  });

  test('1.0 -> 0x3c00', () => {
    expect(float2half(1.0)).toBe(0x3c00);
  });

  test('-2.0 -> 0xc000', () => {
    expect(float2half(-2.0)).toBe(0xc000);
  });

  test('largest finite half (~65504) 不溢出为 Inf', () => {
    // 65504 对应 0x7bff
    expect(float2half(65504)).toBe(0x7bff);
  });

  test('大于最大半精度的值溢出为 Inf', () => {
    expect(float2half(70000)).toBe(H_POS_INF);
    expect(float2half(-70000)).toBe(H_NEG_INF);
  });

  test('非常小的数 underflow 为 0', () => {
    // 比最小 subnormal 还小
    expect(float2half(Math.pow(2, -30))).toBe(H_POS_ZERO);
  });

  test('rounding: value near half-precision step is correctly rounded', () => {
    // 1.0009765625 是离 1.0 最近的一个 half step (约 1 + 1/1024)
    const half = float2half(1.0009765625);
    expect(half).toBe(0x3c01);
  });
});

describe('round-trip conversions', () => {
  test('smallest positive subnormal round-trip', () => {
    const x = half2float(0x0001);
    expect(float2half(x)).toBe(0x0001);
  });

  test('largest subnormal round-trip', () => {
    const x = half2float(0x03ff);
    expect(float2half(x)).toBe(0x03ff);
  });

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
