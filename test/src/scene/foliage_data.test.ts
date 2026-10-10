import { MemoryFS } from '@zephyr3d/base';
import {
  FOLIAGE_INSTANCE_STRIDE,
  FOLIAGE_MASK_TILE_SIZE,
  FoliageDensityMask,
  FoliageLayer,
  FoliageSystem,
  ResourceManager,
  Scene,
  foliageBrushWeight,
  setPhysicsWorldFactory
} from '@zephyr3d/scene';

beforeAll(() => {
  setPhysicsWorldFactory(null);
});

/** Instances sorted by position, so groups compare regardless of bucket order */
function sorted(data: Float32Array) {
  const rows: number[][] = [];
  for (let k = 0; k < data.length; k += FOLIAGE_INSTANCE_STRIDE) {
    rows.push(Array.from(data.subarray(k, k + FOLIAGE_INSTANCE_STRIDE)));
  }
  return rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function instance(x: number, z: number) {
  return [x, z, 0.5, 1, 1.25];
}

describe('foliage density mask', () => {
  it('stores only tiles holding painted cells', () => {
    const mask = new FoliageDensityMask(1);
    expect(mask.empty).toBe(true);
    mask.setCell(3, -2, 0.5);
    expect(mask.numTiles).toBe(1);
    expect(mask.getCell(3, -2)).toBeCloseTo(0.5, 2);
    // Same tile as (3, -2): both rows -64..-1, columns 0..63
    mask.setCell(FOLIAGE_MASK_TILE_SIZE - 4, -FOLIAGE_MASK_TILE_SIZE, 1);
    expect(mask.numTiles).toBe(1);
    // Negative columns are in the tile left of the origin
    mask.setCell(-1, -1, 1);
    expect(mask.numTiles).toBe(2);
    mask.setCell(-1, -1, 0);
    expect(mask.numTiles).toBe(1);
  });

  it('interpolates between cell centres', () => {
    const mask = new FoliageDensityMask(2);
    mask.setCell(0, 0, 1);
    expect(mask.sample(1, 1)).toBeCloseTo(1, 5);
    // Halfway between the centres of cell 0 and cell 1
    expect(mask.sample(2, 1)).toBeCloseTo(0.5, 5);
    expect(mask.sample(3, 1)).toBeCloseTo(0, 5);
  });

  it('paints with a soft edge and erases with a negative amount', () => {
    const mask = new FoliageDensityMask(1);
    const region = mask.paintCircle(0, 0, 8, 1, 0.5);
    expect(region).not.toBeNull();
    expect(mask.getCell(0, 0)).toBe(1);
    const edge = mask.getCell(6, 0);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(mask.getCell(9, 0)).toBe(0);
    mask.paintCircle(0, 0, 8, -1, 0);
    expect(mask.empty).toBe(true);
    expect(mask.paintCircle(0, 0, 8, -1, 0)).toBeNull();
  });

  it('writes and reads back the same cells', () => {
    const mask = new FoliageDensityMask(1);
    mask.paintCircle(100, -40, 30, 0.7, 0.3);
    const bytes = new Uint8Array(mask.byteSize);
    expect(mask.write(new DataView(bytes.buffer), 0)).toBe(bytes.length);
    const copy = new FoliageDensityMask(1);
    copy.read(new DataView(bytes.buffer), 0);
    expect(copy.numTiles).toBe(mask.numTiles);
    for (let j = -80; j <= 0; j += 3) {
      for (let i = 60; i <= 140; i += 3) {
        expect(copy.getCell(i, j)).toBe(mask.getCell(i, j));
      }
    }
  });

  it('restores copied tiles, including ones that did not exist', () => {
    const mask = new FoliageDensityMask(1);
    mask.setCell(1, 1, 0.25);
    // Covers everything the brush below reaches
    const region: [number, number, number, number] = [0, -10, 200, 20];
    const before = mask.copyTiles(region);
    mask.paintCircle(150, 5, 10, 1, 0);
    mask.setCell(1, 1, 1);
    mask.restoreTiles(before);
    expect(mask.getCell(1, 1)).toBeCloseTo(0.25, 2);
    expect(mask.getCell(150, 5)).toBe(0);
    expect(mask.numTiles).toBe(1);
  });

  it('weights the brush fully inside and smoothly to the edge', () => {
    expect(foliageBrushWeight(0, 0.5)).toBe(1);
    expect(foliageBrushWeight(0.5, 0.5)).toBe(1);
    expect(foliageBrushWeight(0.75, 0.5)).toBeCloseTo(0.5, 5);
    expect(foliageBrushWeight(1, 0.5)).toBe(0);
    expect(foliageBrushWeight(0.9, 0)).toBe(1);
  });
});

describe('foliage instance groups', () => {
  it('keeps placed and generated instances apart', () => {
    const foliage = new FoliageSystem(new Scene());
    const index = foliage.addLayer('');
    foliage.setInstances(index, [...instance(1, 1), ...instance(70, 2)]);
    foliage.addInstances(index, instance(3, 3), 'generated');
    const layer = foliage.getLayer(index)!;
    expect(layer.manualCount).toBe(2);
    expect(layer.generatedCount).toBe(1);
    expect(layer.count).toBe(3);
    expect(foliage.numInstances).toBe(3);
    // Placing again replaces only the placed ones
    foliage.setInstances(index, instance(5, 5));
    expect(layer.manualCount).toBe(1);
    expect(layer.generatedCount).toBe(1);
    expect(sorted(layer.getInstances())).toEqual(
      sorted(new Float32Array([...instance(3, 3), ...instance(5, 5)]))
    );
    foliage.setInstances(index, [], 'all');
    expect(layer.count).toBe(0);
  });

  it('replaces generated instances within a region only', () => {
    const foliage = new FoliageSystem(new Scene());
    const index = foliage.addLayer('');
    foliage.addInstances(index, [...instance(1, 1), ...instance(10, 1), ...instance(200, 1)], 'generated');
    foliage.addInstances(index, instance(2, 2));
    foliage.replaceGeneratedInRegion(index, [0, 0, 20, 20], instance(5, 5));
    const layer = foliage.getLayer(index)!;
    expect(sorted(layer.getInstances('generated'))).toEqual(
      sorted(new Float32Array([...instance(5, 5), ...instance(200, 1)]))
    );
    expect(layer.manualCount).toBe(1);
  });

  it('keeps the instances when the chunk size changes', () => {
    const foliage = new FoliageSystem(new Scene());
    const index = foliage.addLayer('');
    const data = new Float32Array([...instance(1, 1), ...instance(130, -70), ...instance(-5, 300)]);
    foliage.setInstances(index, data);
    foliage.chunkSize = 16;
    expect(sorted(foliage.getLayer(index)!.getInstances())).toEqual(sorted(data));
  });

  it('erases generated instances through the mask, so they do not grow back', () => {
    const foliage = new FoliageSystem(new Scene());
    const index = foliage.addLayer('');
    const layer = foliage.getLayer(index)!;
    layer.mask.fillCircle(0, 0, 20, 1);
    foliage.addInstances(index, [...instance(1, 1), ...instance(30, 30)], 'generated');
    foliage.addInstances(index, instance(2, 2));
    expect(foliage.removeInstancesInCircle(0, 0, 5)).toBe(2);
    expect(layer.mask.sample(1, 1)).toBe(0);
    expect(layer.mask.sample(10, 10)).toBe(1);
    expect(layer.count).toBe(1);
  });

  it('thins placed instances out towards the edge of a soft brush, the same way every time', () => {
    const scene = new Scene();
    const make = () => {
      const foliage = new FoliageSystem(scene);
      const index = foliage.addLayer('');
      const data: number[] = [];
      for (let z = -10; z <= 10; z += 0.5) {
        for (let x = -10; x <= 10; x += 0.5) {
          data.push(...instance(x, z));
        }
      }
      foliage.setInstances(index, data);
      return foliage;
    };
    const a = make();
    const b = make();
    const weight = (t: number) => foliageBrushWeight(t, 1);
    a.eraseManualInstances(0, 0, 0, 8, 1, weight);
    b.eraseManualInstances(0, 0, 0, 8, 1, weight);
    expect(sorted(a.getLayer(0)!.getInstances())).toEqual(sorted(b.getLayer(0)!.getInstances()));
    const left = sorted(a.getLayer(0)!.getInstances());
    const within = (r0: number, r1: number) =>
      left.filter(([x, z]) => {
        const r = Math.hypot(x, z);
        return r >= r0 && r < r1;
      }).length;
    // Nothing survives near the centre, most survive near the edge
    expect(within(0, 1)).toBe(0);
    expect(within(6.5, 8)).toBeGreaterThan(within(2, 3.5));
  });

  it('moves a layer between systems with its instances and mask', () => {
    const scene = new Scene();
    const a = new FoliageSystem(scene);
    const b = new FoliageSystem(scene);
    b.maskCellSize = 2;
    const layer = new FoliageLayer('tree.zprefab');
    a.insertLayer(layer);
    a.addInstances(0, instance(1, 1));
    layer.mask.setCell(0, 0, 1);
    b.insertLayer(layer);
    expect(a.numLayers).toBe(0);
    expect(layer.owner).toBe(b);
    expect(layer.count).toBe(1);
    expect(layer.mask.cellSize).toBe(2);
    expect(layer.mask.getCell(0, 0)).toBe(1);
  });
});

describe('foliage serialization', () => {
  it('saves both instance groups, the mask and the generation settings', async () => {
    const fs = new MemoryFS();
    const manager = new ResourceManager(fs);
    const scene = new Scene();
    const foliage = new FoliageSystem(scene);
    foliage.parent = scene.rootNode;
    foliage.maskCellSize = 0.5;
    const index = foliage.addLayer('', {
      castShadow: false,
      generation: { spacing: 2.5, slopeRange: [5, 30], heightRange: [1, 50], seed: 1234, surface: 'any' }
    });
    foliage.setInstances(index, [...instance(1, 2), ...instance(-100, 40)]);
    foliage.addInstances(index, [...instance(3, 4), ...instance(500, -2)], 'generated');
    foliage.getLayer(index)!.mask.paintCircle(10, 10, 6, 0.8, 0.5);

    const asyncTasks: Promise<unknown>[] = [];
    const json = await manager.serializeObject(foliage, null, asyncTasks);
    await Promise.all(asyncTasks);

    const restored = (await manager.deserializeObject<FoliageSystem>(scene.rootNode, json))!;
    expect(restored).toBeInstanceOf(FoliageSystem);
    expect(restored.maskCellSize).toBe(0.5);
    const a = foliage.getLayer(index)!;
    const b = restored.getLayer(0)!;
    expect(b.castShadow).toBe(false);
    expect(b.generation).toEqual(a.generation);
    expect(sorted(b.getInstances('manual'))).toEqual(sorted(a.getInstances('manual')));
    expect(sorted(b.getInstances('generated'))).toEqual(sorted(a.getInstances('generated')));
    expect(b.mask.cellSize).toBe(0.5);
    expect(b.mask.numTiles).toBe(a.mask.numTiles);
    for (let j = 0; j < 40; j += 2) {
      for (let i = 0; i < 40; i += 2) {
        expect(b.mask.getCell(i, j)).toBe(a.mask.getCell(i, j));
      }
    }
  });
});
