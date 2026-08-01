/**
 * Tests for the depth convention constant module: resolution precedence of
 * the REVERSE_Z switch and the exact legacy values of every derived constant
 * under the standard-Z convention.
 */

const MODULE_PATH = '../../../libs/base/src/zconvention';

type ZConventionModule = typeof import('../../../libs/base/src/zconvention');

function loadWithGlobal(value: boolean | undefined): ZConventionModule {
  const g = globalThis as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(g, '__ZEPHYR3D_REVERSE_Z__');
  const saved = g.__ZEPHYR3D_REVERSE_Z__;
  if (value === undefined) {
    delete g.__ZEPHYR3D_REVERSE_Z__;
  } else {
    g.__ZEPHYR3D_REVERSE_Z__ = value;
  }
  try {
    let mod: ZConventionModule;
    jest.isolateModules(() => {
      mod = require(MODULE_PATH);
    });
    return mod!;
  } finally {
    if (hadOwn) {
      g.__ZEPHYR3D_REVERSE_Z__ = saved;
    } else {
      delete g.__ZEPHYR3D_REVERSE_Z__;
    }
  }
}

describe('zconvention resolution precedence', () => {
  test('defaults to standard-Z when nothing is injected', () => {
    const mod = loadWithGlobal(undefined);
    expect(mod.REVERSE_Z).toBe(false);
    expect(mod.Z_CONVENTION).toBe('standard');
  });

  test('globalThis.__ZEPHYR3D_REVERSE_Z__ = true selects reverse-Z', () => {
    const mod = loadWithGlobal(true);
    expect(mod.REVERSE_Z).toBe(true);
    expect(mod.Z_CONVENTION).toBe('reverse');
  });

  test('globalThis.__ZEPHYR3D_REVERSE_Z__ = false selects standard-Z explicitly', () => {
    const mod = loadWithGlobal(false);
    expect(mod.REVERSE_Z).toBe(false);
  });
});

describe('derived constants', () => {
  test('standard-Z values match the legacy literals they replace', () => {
    const mod = loadWithGlobal(false);
    expect(mod.DEPTH_CLEAR_VALUE).toBe(1);
    expect(mod.DEPTH_FARTHEST).toBe(1);
    expect(mod.DEPTH_NEAREST).toBe(0);
    expect(mod.DEPTH_COMPARE_DEFAULT).toBe('le');
    expect(mod.DEPTH_COMPARE_CLOSER).toBe('lt');
    expect(mod.DEPTH_COMPARE_CLOSER_EQUAL).toBe('le');
    expect(mod.DEPTH_COMPARE_FARTHER).toBe('gt');
    expect(mod.DEPTH_COMPARE_FARTHER_EQUAL).toBe('ge');
    expect(mod.DEPTH_REDUCE_CLOSER).toBe('min');
    expect(mod.DEPTH_REDUCE_FARTHER).toBe('max');
    expect(mod.closerDepth(0.25, 0.75)).toBe(0.25);
    expect(mod.fartherDepth(0.25, 0.75)).toBe(0.75);
  });

  test('reverse-Z values are the exact mirror of standard-Z', () => {
    const mod = loadWithGlobal(true);
    expect(mod.DEPTH_CLEAR_VALUE).toBe(0);
    expect(mod.DEPTH_FARTHEST).toBe(0);
    expect(mod.DEPTH_NEAREST).toBe(1);
    expect(mod.DEPTH_COMPARE_DEFAULT).toBe('ge');
    expect(mod.DEPTH_COMPARE_CLOSER).toBe('gt');
    expect(mod.DEPTH_COMPARE_CLOSER_EQUAL).toBe('ge');
    expect(mod.DEPTH_COMPARE_FARTHER).toBe('lt');
    expect(mod.DEPTH_COMPARE_FARTHER_EQUAL).toBe('le');
    expect(mod.DEPTH_REDUCE_CLOSER).toBe('max');
    expect(mod.DEPTH_REDUCE_FARTHER).toBe('min');
    expect(mod.closerDepth(0.25, 0.75)).toBe(0.75);
    expect(mod.fartherDepth(0.25, 0.75)).toBe(0.25);
  });
});
