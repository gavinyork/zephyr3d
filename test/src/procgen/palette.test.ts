import { applyMaterialTone, getStyle, availableStyles, pickMaterialScheme, Random } from '@zephyr3d/procgen';

describe('material schemes', () => {
  test('a zero tone leaves the albedo unchanged, a hint without variation is never touched', () => {
    availableStyles();
    const style = getStyle('modern-office');
    for (const set of Object.values(style.schemeSets ?? {})) {
      for (const scheme of set) {
        for (const hint of Object.values(scheme.palette)) {
          const same = applyMaterialTone(hint, { lightness: 0, hue: 0, saturation: 0 });
          for (let c = 0; c < 3; c++) {
            expect(same.albedo[c]).toBeCloseTo(hint.albedo[c], 6);
          }
          const shifted = applyMaterialTone(hint, { lightness: 1, hue: 0.05, saturation: -1 });
          if (!hint.variation) {
            expect(shifted).toBe(hint);
          }
          for (const v of shifted.albedo) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  test('modern office offers realistic and vivid sets, every scheme dressing all groups', () => {
    availableStyles();
    const style = getStyle('modern-office');
    for (const name of ['realistic', 'vivid']) {
      const set = style.schemeSets?.[name] ?? [];
      expect(set.length).toBeGreaterThan(3);
      for (const scheme of set) {
        expect(Object.keys(scheme.palette).sort()).toEqual(['frame', 'glass', 'trim', 'wall']);
      }
      const rng = new Random(7);
      const picked = new Set(Array.from({ length: 200 }, () => pickMaterialScheme(set, rng)!.id));
      expect(picked.size).toBe(set.length);
    }
    expect(pickMaterialScheme([], new Random(1))).toBeNull();
  });
});
