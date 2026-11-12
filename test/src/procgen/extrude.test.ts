import { generatePrimitive, type GeneratedModelSpec } from '@zephyr3d/modelgen';

function build(spec: GeneratedModelSpec) {
  const result = generatePrimitive(spec, Infinity);
  const p = result.primitive.vertices.position.data;
  const n = result.primitive.vertices.normal.data;
  const idx = Array.from(result.primitive.indices);
  return { p, n, idx, result };
}

/** Signed volume by the divergence theorem; positive when every face winds outward */
function signedVolume(p: Float32Array, idx: number[]) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

// An L shape: a 4 x 4 square missing its 2 x 2 corner, area 12
const L_SHAPE: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [2, 2],
  [2, 4],
  [0, 4]
];

describe('extrude node', () => {
  test('a concave outline makes a closed, outward-wound prism of the right volume in either winding', () => {
    for (const profile of [L_SHAPE, [...L_SHAPE].reverse()]) {
      const { p, idx, result } = build({ nodes: [{ type: 'extrude', profile, height: 3 }] });
      expect(signedVolume(p, idx)).toBeCloseTo(12 * 3, 4);
      expect(result.boxMin).toEqual([0, 0, 0]);
      expect(result.boxMax).toEqual([4, 3, 4]);
    }
  });

  test('wall normals point out of the outline; caps point up and down', () => {
    const { p, n, idx } = build({
      nodes: [{ type: 'extrude', profile: L_SHAPE, height: 1, smoothAngle: 0 }]
    });
    for (let t = 0; t < idx.length; t += 3) {
      const corners = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const [nx, ny, nz] = [0, 1, 2].map((c) => corners.reduce((s, i) => s + n[i + c], 0) / 3);
      const [cx, cy, cz] = [0, 1, 2].map((c) => corners.reduce((s, i) => s + p[i + c], 0) / 3);
      if (Math.abs(ny) > 0.5) {
        expect(Math.abs(ny)).toBeCloseTo(1, 6);
        expect(cy).toBeCloseTo(ny > 0 ? 1 : 0, 6);
        continue;
      }
      // Stepping along the normal from the middle of a wall triangle leaves the L
      const x = cx + nx * 0.01;
      const z = cz + nz * 0.01;
      const inL = x > 0 && z > 0 && x < 4 && z < 4 && !(x > 2 && z > 2);
      expect(inL).toBe(false);
    }
  });

  test('caps can be left open, and a sampled arc is smoothed', () => {
    const open = build({ nodes: [{ type: 'extrude', profile: L_SHAPE, capTop: false, capBottom: false }] });
    expect(open.idx.length).toBe(6 * L_SHAPE.length);
    const arc: [number, number][] = [[0, 0]];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      arc.push([Math.cos(a), Math.sin(a)]);
    }
    const { n } = build({ nodes: [{ type: 'extrude', profile: arc, capTop: false, capBottom: false }] });
    // A vertex in the middle of the arc gets the averaged radial normal
    const radial = new Set<string>();
    for (let i = 0; i < n.length; i += 3) {
      radial.add(`${n[i].toFixed(3)},${n[i + 2].toFixed(3)}`);
    }
    // 17 smoothed arc points + 2 sharp straight walls with distinct normals at the arc ends
    expect(radial.size).toBeGreaterThan(17);
  });

  test('a profile without area is rejected', () => {
    expect(() =>
      build({
        nodes: [
          {
            type: 'extrude',
            profile: [
              [0, 0],
              [1, 0],
              [2, 0]
            ]
          }
        ]
      })
    ).toThrow(/no area/);
  });
});
