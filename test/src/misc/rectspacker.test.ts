import { RectsPacker, type PackRect } from '@zephyr3d/base';

function expectRectWithinBin(rect: PackRect, binWidth: number, binHeight: number) {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(binWidth);
  expect(rect.y + rect.height).toBeLessThanOrEqual(binHeight);
}

function expectNoOverlap(rects: PackRect[]) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];

      if (a.binIndex !== b.binIndex) {
        continue;
      }

      const separated =
        a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

      expect(separated).toBe(true);
    }
  }
}

describe('RectsPacker', () => {
  const BIN_W = 64;
  const BIN_H = 64;

  describe('basic insertion in a single bin', () => {
    test('packs a single rectangle that fits exactly', () => {
      const packer = new RectsPacker(BIN_W, BIN_H);

      const rect = packer.insert(BIN_W, BIN_H);
      expect(rect).not.toBeNull();

      const r = rect as PackRect;
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
      expect(r.width).toBe(BIN_W);
      expect(r.height).toBe(BIN_H);
      expect(r.binIndex).toBe(0);
    });

    test('returns null when rectangle is larger than bin', () => {
      const packer = new RectsPacker(BIN_W, BIN_H);

      expect(packer.insert(BIN_W + 1, BIN_H)).toBeNull();
      expect(packer.insert(BIN_W, BIN_H + 1)).toBeNull();
      expect(packer.insert(BIN_W + 10, BIN_H + 10)).toBeNull();
    });

    test('packs several small rectangles into the first bin without overlap', () => {
      const packer = new RectsPacker(BIN_W, BIN_H);

      const r1 = packer.insert(16, 16);
      const r2 = packer.insert(16, 16);
      const r3 = packer.insert(32, 32);
      const r4 = packer.insert(8, 8);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r3).not.toBeNull();
      expect(r4).not.toBeNull();

      const rects = [r1!, r2!, r3!, r4!];

      for (const r of rects) {
        expect(r.binIndex).toBe(0);
        expectRectWithinBin(r, BIN_W, BIN_H);
      }

      expectNoOverlap(rects);
    });
  });

  describe('multiple bins and maxBins behavior', () => {
    test('creates a new bin when the current bin is full (default maxBins = 0 => unlimited)', () => {
      const smallBinW = 32;
      const smallBinH = 32;
      const packer = new RectsPacker(smallBinW, smallBinH); // unlimited bins

      // Fill first bin with four 16x16 rects
      const r1 = packer.insert(16, 16)!;
      const r2 = packer.insert(16, 16)!;
      const r3 = packer.insert(16, 16)!;
      const r4 = packer.insert(16, 16)!;

      expect(r1.binIndex).toBe(0);
      expect(r2.binIndex).toBe(0);
      expect(r3.binIndex).toBe(0);
      expect(r4.binIndex).toBe(0);

      // This one will not fit in bin 0 and should trigger a new bin
      const r5 = packer.insert(16, 16);
      expect(r5).not.toBeNull();
      expect(r5!.binIndex).toBe(1);
    });

    test('respects maxBins and returns null once all bins are full', () => {
      const smallBinW = 32;
      const smallBinH = 32;
      const maxBins = 2;
      const packer = new RectsPacker(smallBinW, smallBinH, maxBins);

      // Each bin can hold exactly four 16x16 rects
      const rects: PackRect[] = [];
      for (let i = 0; i < maxBins * 4; i++) {
        const r = packer.insert(16, 16);
        expect(r).not.toBeNull();
        rects.push(r!);
      }

      // All current bins should be either 0 or 1
      const binIndexes = new Set(rects.map((r) => r.binIndex));
      expect(binIndexes).toEqual(new Set([0, 1]));

      // Next insert should fail (would need a third bin, but maxBins = 2)
      const failRect = packer.insert(16, 16);
      expect(failRect).toBeNull();
    });
  });

  describe('clear()', () => {
    test('resets internal state and starts packing into bin 0 again', () => {
      const packer = new RectsPacker(BIN_W, BIN_H);

      const r1 = packer.insert(32, 32);
      const r2 = packer.insert(32, 32);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();

      packer.clear();

      // After clear, we should be able to reuse full bin area
      const r3 = packer.insert(BIN_W, BIN_H);
      expect(r3).not.toBeNull();
      expect(r3!.binIndex).toBe(0);
      expect(r3!.x).toBe(0);
      expect(r3!.y).toBe(0);
    });
  });

  describe('packing characteristics and edge cases', () => {
    test('inserts rectangles whose size matches remaining free space exactly in a single bin', () => {
      // Limit to 1 bin so that when the bin is full, insert must fail.
      const packer = new RectsPacker(32, 32, 1);

      const r1 = packer.insert(16, 32);
      const r2 = packer.insert(16, 32);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();

      const rects = [r1!, r2!];
      for (const r of rects) {
        expect(r.binIndex).toBe(0);
        expectRectWithinBin(r, 32, 32);
      }
      expectNoOverlap(rects);

      // Bin should be effectively full, and we cannot create new bins (maxBins = 1)
      const r3 = packer.insert(1, 1);
      expect(r3).toBeNull();
    });

    test('many small rectangles are packed without overlap (may spill into multiple bins)', () => {
      const packer = new RectsPacker(64, 64); // unlimited bins by default

      const rects: PackRect[] = [];
      // Try to pack many 4x4 rects; some may end up in different bins
      for (let i = 0; i < 100; i++) {
        const r = packer.insert(4, 4);
        if (!r) {
          break;
        }
        rects.push(r);
      }

      // At least a few should fit
      expect(rects.length).toBeGreaterThan(0);

      // All rects are within their corresponding bin bounds
      for (const r of rects) {
        expectRectWithinBin(r, 64, 64);
      }
      expectNoOverlap(rects);
    });

    test('inserting width == bin width but small height packs vertically; if more bins allowed, extra rects go to new bin', () => {
      const packer = new RectsPacker(32, 32); // unlimited bins

      const r1 = packer.insert(32, 8)!;
      const r2 = packer.insert(32, 8)!;
      const r3 = packer.insert(32, 8)!;
      const r4 = packer.insert(32, 8)!;

      const rects = [r1, r2, r3, r4];

      expect(rects.every((r) => r.binIndex === 0)).toBe(true);
      rects.forEach((r) => expectRectWithinBin(r, 32, 32));
      expectNoOverlap(rects);

      // Bin 0 has no more vertical space, but default maxBins = 0 means a new bin is allowed:
      const extra = packer.insert(32, 1);
      expect(extra).not.toBeNull();
      expect(extra!.binIndex).toBe(1);
    });

    test('inserting width == bin width but small height in a single bin fails when full', () => {
      // This case is specifically to verify "exact fill then no more" when maxBins is limited.
      const packer = new RectsPacker(32, 32, 1); // single bin

      const r1 = packer.insert(32, 8)!;
      const r2 = packer.insert(32, 8)!;
      const r3 = packer.insert(32, 8)!;
      const r4 = packer.insert(32, 8)!;

      const rects = [r1, r2, r3, r4];

      expect(rects.every((r) => r.binIndex === 0)).toBe(true);
      rects.forEach((r) => expectRectWithinBin(r, 32, 32));
      expectNoOverlap(rects);

      // Now bin is full and we cannot create new bins => should fail
      const extra = packer.insert(32, 1);
      expect(extra).toBeNull();
    });
  });
});
