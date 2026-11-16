import {
  cityBlockGroundParts,
  generateBuilding,
  generateBuildingParts,
  generateCityBlock
} from '@zephyr3d/procgen';

type Box = { id?: string; size: [number, number, number]; position: [number, number, number] };

const BUILDING = {
  seed: 1234,
  footprint: [26, 22] as [number, number],
  origin: [-13, 0, -11] as [number, number, number]
};

function key(node: unknown) {
  return JSON.stringify(node);
}

describe('generateBuildingParts', () => {
  test('without a part height limit, the parts hold exactly the generateBuilding nodes', () => {
    for (const floors of [4, 12, 40]) {
      const whole = generateBuilding({ ...BUILDING, params: { floors } });
      const parts = generateBuildingParts({ ...BUILDING, params: { floors } });
      expect(parts.every((p) => /^mass\d+$/.test(p.part))).toBe(true);
      const merged = parts
        .flatMap((p) => p.spec.nodes ?? [])
        .map(key)
        .sort();
      expect(merged).toEqual((whole.nodes ?? []).map(key).sort());
    }
  });

  test('a part height limit splits tall masses without changing the building', () => {
    const params = { floors: 60, podiumChance: 0, setbackChance: 0 };
    const plain = generateBuildingParts({ ...BUILDING, params });
    const split = generateBuildingParts({ ...BUILDING, params: { ...params, maxPartHeight: 62 } });
    expect(plain.map((p) => p.part)).toEqual(['mass0']);
    expect(split.length).toBeGreaterThan(2);
    // Same random choices: the canopy and rooftop units match
    const nodes = (parts: typeof plain) =>
      parts.flatMap((p) => (p.spec.nodes ?? []) as unknown as Box[]).filter((n) => n.id !== 'glass');
    const pieceKeys = nodes(split).map(key).sort();
    const wholeKeys = nodes(plain)
      .filter((n) => n.id !== 'frame')
      .map(key);
    // Bands, roof and trim are emitted identically; piers are cut per part
    for (const k of wholeKeys) {
      expect(pieceKeys).toContain(k);
    }
    for (const part of split) {
      if (part.part === 'mass0') {
        continue; // the roof
      }
      const glass = (part.spec.nodes as unknown as Box[]).filter((n) => n.id === 'glass');
      expect(glass.length).toBe(1);
      expect(glass[0].size[1]).toBeLessThanOrEqual(62 + 1e-6);
    }
  });
});

describe('cityBlockGroundParts', () => {
  test('slabs tile the block and margin exactly without overlap, the carriageway a kerb lower', () => {
    const layout = generateCityBlock({ width: 7, height: 5, cellSize: 20, seed: 3 });
    const margin = 50;
    const parts = cityBlockGroundParts(layout, { margin, depth: 1.5 });
    const all = parts.flatMap((p) => (p.spec.nodes ?? []) as unknown as Box[]);
    const boxes = all.filter((b) => b.id !== 'marking');
    expect(all.length).toBeGreaterThan(boxes.length);
    expect(boxes.some((b) => b.id === 'kerb')).toBe(true);
    let area = 0;
    for (const b of boxes) {
      expect(b.position[1] + b.size[1] * 0.5).toBeCloseTo(b.id === 'road' ? -0.15 : 0, 6);
      area += b.size[0] * b.size[2];
    }
    const total = (7 * 20 + 2 * margin) * (5 * 20 + 2 * margin);
    expect(area).toBeCloseTo(total, 3);
    // Pairwise interiors are disjoint
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox =
          Math.min(a.position[0] + a.size[0] / 2, b.position[0] + b.size[0] / 2) -
          Math.max(a.position[0] - a.size[0] / 2, b.position[0] - b.size[0] / 2);
        const oz =
          Math.min(a.position[2] + a.size[2] / 2, b.position[2] + b.size[2] / 2) -
          Math.max(a.position[2] - a.size[2] / 2, b.position[2] - b.size[2] / 2);
        expect(ox <= 1e-6 || oz <= 1e-6).toBe(true);
      }
    }
    // Chunks of 2 × 2 cells
    expect(parts.filter((p) => p.part.startsWith('chunk_')).length).toBe(4 * 3);
    // Markings lie on the carriageway, within road slabs in plan
    const roads = boxes.filter((b) => b.id === 'road');
    const inside = (p: number, b: Box, c: 0 | 2) =>
      p >= b.position[c] - b.size[c] / 2 - 1e-6 && p <= b.position[c] + b.size[c] / 2 + 1e-6;
    for (const mark of all.filter((b) => b.id === 'marking')) {
      expect(mark.position[1]).toBeCloseTo(-0.15, 6);
      for (const [dx, dz] of [
        [-1, -1],
        [1, 1]
      ]) {
        const px = mark.position[0] + (dx * mark.size[0]) / 2;
        const pz = mark.position[2] + (dz * mark.size[2]) / 2;
        expect(roads.some((r) => inside(px, r, 0) && inside(pz, r, 2))).toBe(true);
      }
    }
  });
});
