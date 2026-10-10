import { Vector3 } from '@zephyr3d/base';
import {
  Collider,
  FOLIAGE_INSTANCE_STRIDE,
  FoliageSystem,
  NodePhysics,
  Scene,
  SceneNode
} from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import type { PhysicsSimulation } from '@zephyr3d/physics';
import { initPhysics } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';

// The terrain height reader runs a worker and the editor command system, neither of which a
// layer on any surface without a place script needs
jest.mock('../../../utility/editor/src/helpers/mcpterrain', () => ({ readWorldHeights: jest.fn() }));
jest.mock('../../../utility/editor/src/helpers/foliagescatterworker', () => ({
  runScatterWorker: jest.fn()
}));

import {
  applyPaintStrokes,
  parsePaintStrokes,
  regenerateLayers
} from '../../../utility/editor/src/helpers/mcpfoliage_paint';

beforeAll(async () => {
  await RAPIER.init();
  await initPhysics(rapierPhysics, { rapier: RAPIER });
});

/** A scene as the editor has it, with a ground and a ledge, and a foliage layer on any surface */
function stage() {
  const scene = new Scene();
  (scene.physicsWorld as PhysicsSimulation).enabled = false;
  const box = (y: number, size: number, x = 0) => {
    const node = new SceneNode(scene);
    node.position.setXYZ(x, y, 0);
    const c = new Collider();
    c.size = new Vector3(size, 1, size);
    node.physics = new NodePhysics({ colliders: [c] });
    return node;
  };
  box(-0.5, 200);
  // A ledge whose top is at 4, over x -10..10
  const ledge = box(3.5, 20);
  const foliage = new FoliageSystem(scene);
  foliage.parent = scene.rootNode;
  foliage.addLayer('', { generation: { spacing: 2, surface: 'any', seed: 3 } });
  return { scene, foliage, ledge };
}

function instances(foliage: FoliageSystem) {
  const d = foliage.getLayer(0)!.getInstances('generated');
  const out: number[][] = [];
  for (let k = 0; k < d.length; k += FOLIAGE_INSTANCE_STRIDE) {
    out.push(Array.from(d.subarray(k, k + FOLIAGE_INSTANCE_STRIDE)));
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('foliage paint through MCP', () => {
  it('grows painted instances on whatever lies below, in the painted circles only', async () => {
    const { foliage } = stage();
    const strokes = parsePaintStrokes(foliage, { center: [0, 0], radius: 20 });
    expect(typeof strokes).not.toBe('string');
    await applyPaintStrokes(foliage, 0, strokes as any, 'set', 1, 0);
    const out = instances(foliage);
    expect(out.length).toBeGreaterThan(50);
    for (const [x, z, y] of out) {
      expect(Math.hypot(x, z)).toBeLessThan(21);
      // On the ledge top or on the ground
      expect(y).toBeCloseTo(Math.abs(x) < 10 && Math.abs(z) < 10 ? 4 : 0, 3);
    }
  });

  it('leaves what is outside a later stroke untouched, and placed instances alone', async () => {
    const { foliage } = stage();
    foliage.setInstances(0, [50, 50, 0, 0, 1]);
    await applyPaintStrokes(foliage, 0, [{ x: -30, z: 0, radius: 12 }], 'set', 1, 0);
    const first = instances(foliage);
    await applyPaintStrokes(foliage, 0, [{ x: 30, z: 0, radius: 12 }], 'set', 1, 0);
    const second = instances(foliage);
    const key = (r: number[]) => r.join(',');
    const after = new Set(second.map(key));
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((r) => after.has(key(r)))).toBe(true);
    expect(second.length).toBeGreaterThan(first.length);
    expect(foliage.getLayer(0)!.manualCount).toBe(1);
    // Erasing lowers the density, so no painted instance is left where it was cleared
    await applyPaintStrokes(foliage, 0, [{ x: -30, z: 0, radius: 13 }], 'erase', 1, 0);
    expect(instances(foliage).every(([x]) => x > 0)).toBe(true);
  });

  it('regenerates a layer from its mask after its settings change', async () => {
    const { foliage, ledge } = stage();
    await applyPaintStrokes(foliage, 0, [{ x: 0, z: 0, radius: 8 }], 'set', 1, 0);
    expect(instances(foliage).every(([, , y]) => Math.abs(y - 4) < 1e-3)).toBe(true);
    // Lower the ledge and widen the spacing; nothing changes until regenerated
    ledge.position.setXYZ(0, 1.5, 0);
    const layer = foliage.getLayer(0)!;
    const before = layer.generatedCount;
    layer.generation = { spacing: 4 };
    expect(layer.generatedCount).toBe(before);
    await regenerateLayers(foliage, [0]);
    const out = instances(foliage);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(before);
    expect(out.every(([, , y]) => Math.abs(y - 2) < 1e-3)).toBe(true);
  });

  it('rejects strokes without a centre or radius', () => {
    const { foliage } = stage();
    expect(typeof parsePaintStrokes(foliage, {})).toBe('string');
    expect(typeof parsePaintStrokes(foliage, { center: [0, 0], radius: 0 })).toBe('string');
    expect(typeof parsePaintStrokes(foliage, { strokes: [{ center: [1], radius: 2 }] })).toBe('string');
  });
});
