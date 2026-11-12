import {
  cityBlockGroundParts,
  cityBlockStreetLights,
  generateBuilding,
  generateCityBlock
} from '@zephyr3d/procgen';

type Box = { id?: string; size: [number, number, number]; position: [number, number, number] };

describe('lit windows', () => {
  for (const style of ['modern-office', 'urban-residential']) {
    test(`${style}: none by default, panes on the glazing when asked`, () => {
      const options = { style, seed: 11, footprint: [24, 20] as [number, number] };
      const dark = generateBuilding({ ...options, params: { floors: 8 } });
      expect((dark.nodes ?? []).some((n) => n.id === 'glass-lit')).toBe(false);
      const lit = generateBuilding({ ...options, params: { floors: 8, litWindowChance: 1 } });
      const panes = (lit.nodes ?? []).filter((n) => n.id === 'glass-lit') as unknown as Box[];
      expect(panes.length).toBeGreaterThan(20);
      for (const pane of panes) {
        // Inside the footprint, standing on the glazing a few tenths of a metre in
        expect(pane.position[0]).toBeGreaterThan(0);
        expect(pane.position[0]).toBeLessThan(24);
        expect(pane.position[2]).toBeGreaterThan(0);
        expect(pane.position[2]).toBeLessThan(20);
        expect(Math.min(...pane.size)).toBeCloseTo(0.1, 6);
      }
      const half = generateBuilding({ ...options, params: { floors: 8, litWindowChance: 0.5 } });
      const halfPanes = (half.nodes ?? []).filter((n) => n.id === 'glass-lit').length;
      expect(halfPanes).toBeGreaterThan(panes.length * 0.3);
      expect(halfPanes).toBeLessThan(panes.length * 0.7);
    });
  }
});

describe('street lights', () => {
  test('stand on the pavement of straight road cells, facing the road', () => {
    const layout = generateCityBlock({ width: 9, height: 9, cellSize: 20, seed: 1 });
    const lights = cityBlockStreetLights(layout, { roadWidth: 9 });
    expect(lights.length).toBeGreaterThan(5);
    const slabs = cityBlockGroundParts(layout, { roadWidth: 9 }).flatMap(
      (p) => (p.spec.nodes ?? []) as unknown as Box[]
    );
    const under = (x: number, z: number) =>
      slabs.find(
        (b) =>
          b.id !== 'marking' &&
          Math.abs(x - b.position[0]) <= b.size[0] / 2 &&
          Math.abs(z - b.position[2]) <= b.size[2] / 2
      );
    for (const light of lights) {
      expect(under(light.position[0], light.position[2])?.id).toBe('sidewalk');
      // A few metres towards the road is carriageway
      const ahead = under(light.position[0] + light.toward[0] * 2, light.position[2] + light.toward[1] * 2);
      expect(ahead?.id).toBe('road');
    }
  });
});
